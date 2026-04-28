"""Spec 01H round-5 (Lakshman P1 #1 + P3 #5): thread expected_updated_at
through ``save_floor_plan_version`` and ``rollback_floor_plan_version_atomic``.

Lakshman round-4 review P1 #1 flagged that the round-3 etag system checks
``If-Match`` in Python but the version-creating RPC itself has no matching
param. Between the Python check and the RPC call, a concurrent writer can
land a Case 3 fork — A's stale canvas then demotes B's fresh work to
frozen history. No data is lost (history is preserved), but the etag
contract is violated.

Same shape applied to ``rollback_floor_plan_version_atomic`` closes P3 #5
(Opus/Codex split) by threading the same param into the rollback wrapper,
which internally calls save_floor_plan_version. One migration, both fixes.

Contract:
    save_floor_plan_version(
        ...existing 8 args...,
        p_expected_updated_at TIMESTAMPTZ DEFAULT NULL  -- NEW
    )
    rollback_floor_plan_version_atomic(
        ...existing 4 args...,
        p_expected_updated_at TIMESTAMPTZ DEFAULT NULL  -- NEW
    )

Behavior:
- ``p_expected_updated_at IS NULL`` — backward-compat / creation path.
  Original behavior: flip any existing is_current=true row without
  checking its updated_at. Needed for first-save (no prior row) and
  during rollout before all callers send the param.
- ``p_expected_updated_at IS NOT NULL`` — enforce atomically. The flip
  UPDATE carries ``AND updated_at = p_expected_updated_at``; zero rows
  flipped WITH a current row still present ⇒ someone else wrote in our
  window. Raise ``55006`` (invalid_prerequisite_state), Python catches
  to 412 ``VERSION_STALE``. If zero rows flipped AND no current row
  exists (first-save-on-this-floor race), proceed to insert — that's
  creation, not staleness.

SQLSTATE 55006 chosen deliberately: it's the same code the R4 frozen
trigger uses for "row is not in the state you think it is," and the
Python catches in ``save_canvas`` / ``update_floor_plan`` /
``cleanup_floor_plan`` / ``rollback_version`` already map 55006 →
VERSION_STALE / VERSION_FROZEN. Distinct from 42501 (access), 23505
(unique), 23502 (null), P0002 (not found).

Default NULL means existing call sites keep working without changes
(C7F8A9B0D1E2's 8-arg grant is still valid since Postgres dispatches
DEFAULTed params positionally). Callers opt in by passing the expected
updated_at explicitly.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: str | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ---------------------------------------------------------------------------
-- Round-5 follow-up (Lakshman M2): Postgres treats functions with
-- different arities as DISTINCT objects. CREATE OR REPLACE FUNCTION
-- with 9 args does NOT replace the existing 8-arg definition — it adds
-- a second overload, and both coexist. An earlier draft of this
-- migration's comment block asserted the opposite ("the 8-arg overload
-- no longer exists after CREATE OR REPLACE"); that was wrong.
--
-- Dispatch rules meant the behavior was accidentally correct — 8-arg
-- named calls hit the old function (no enforcement, matching the
-- p_expected_updated_at=NULL intent), 9-arg named calls hit the new —
-- but carrying two overloads forward is a maintenance hazard (lesson
-- #10 sibling-miss shape: next editor patches one and silently drifts
-- the other). Drop the prior signatures explicitly so only the new
-- 9-arg / 5-arg forms exist after upgrade. The DEFAULT NULL on the
-- new param covers every caller — no-etag callers get the original
-- no-enforcement behavior, etag-aware callers get atomic enforcement.
-- Symmetric downgrade below drops the new forms and recreates the
-- pre-round-5 8-arg / 4-arg forms.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS save_floor_plan_version(
    UUID, INTEGER, TEXT, UUID, UUID, UUID, JSONB, TEXT
);
DROP FUNCTION IF EXISTS rollback_floor_plan_version_atomic(
    UUID, UUID, UUID, TEXT
);

-- ---------------------------------------------------------------------------
-- save_floor_plan_version — add p_expected_updated_at with atomic enforcement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_floor_plan_version(
    p_property_id         UUID,
    p_floor_number        INTEGER,
    p_floor_name          TEXT,
    p_company_id          UUID,
    p_job_id              UUID,
    p_user_id             UUID,
    p_canvas_data         JSONB,
    p_change_summary      TEXT,
    p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_next_number     INTEGER;
    v_inherited_name  TEXT;
    v_new_row         floor_plans%ROWTYPE;
    v_caller_company  UUID;
    v_flipped_count   INTEGER;
BEGIN
    -- NULL param guards (unchanged).
    IF p_job_id IS NULL OR p_company_id IS NULL OR p_property_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_company_id, and p_property_id are required';
    END IF;

    -- R3 tenant check (unchanged).
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company (unauthenticated or user not linked)';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION 'Company mismatch'
              USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match the authenticated caller company';
    END IF;

    -- R3 property-on-company check (unchanged).
    PERFORM 1
      FROM properties
     WHERE id = p_property_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Property not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Property not found or does not belong to the caller company';
    END IF;

    -- R3 job-on-property check (unchanged).
    PERFORM 1
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND property_id = p_property_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not found on this property'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or does not belong to this property';
    END IF;

    -- Compute next version_number; inherit floor_name (unchanged).
    SELECT version_number + 1,
           COALESCE(p_floor_name, floor_name)
      INTO v_next_number, v_inherited_name
      FROM floor_plans
     WHERE property_id  = p_property_id
       AND floor_number = p_floor_number
     ORDER BY version_number DESC
     LIMIT 1;

    IF v_next_number IS NULL THEN
        v_next_number    := 1;
        v_inherited_name := COALESCE(p_floor_name,
                                     'Floor ' || p_floor_number::TEXT);
    END IF;

    -- Round-5 INV-2: atomic etag enforcement on the flip statement.
    --
    -- When the caller supplies p_expected_updated_at, the flip UPDATE
    -- carries AND updated_at = p_expected_updated_at. Three outcomes:
    --   (a) 1+ rows flipped ⇒ etag matched, proceed to insert.
    --   (b) 0 rows flipped AND a current row still exists ⇒ someone else
    --       wrote in our window. The WHERE updated_at clause kept us out.
    --       Raise 55006 so the Python caller can surface 412 VERSION_STALE.
    --   (c) 0 rows flipped AND no current row exists ⇒ first save on this
    --       floor. Not staleness; proceed to insert. Matches the old
    --       behavior for the first-ever save path.
    --
    -- When p_expected_updated_at IS NULL (creation / backward-compat),
    -- the flip runs without the etag filter — original behavior.
    IF p_expected_updated_at IS NOT NULL THEN
        UPDATE floor_plans
           SET is_current = false
         WHERE property_id  = p_property_id
           AND floor_number = p_floor_number
           AND is_current   = true
           AND updated_at   = p_expected_updated_at;
        GET DIAGNOSTICS v_flipped_count = ROW_COUNT;

        IF v_flipped_count = 0 THEN
            -- Discriminator: is there a current row we failed to flip
            -- (stale etag), or just no current row (first save)?
            PERFORM 1 FROM floor_plans
             WHERE property_id  = p_property_id
               AND floor_number = p_floor_number
               AND is_current   = true;
            IF FOUND THEN
                RAISE EXCEPTION 'Version stale'
                      USING ERRCODE = '55006',
                            MESSAGE = 'Current floor plan version updated_at does not match expected — another writer committed between the caller''s read and this RPC';
            END IF;
            -- else: no current row yet — fall through to insert (creation path).
        END IF;
    ELSE
        -- Backward-compat: flip without the etag filter.
        UPDATE floor_plans
           SET is_current = false
         WHERE property_id  = p_property_id
           AND floor_number = p_floor_number
           AND is_current   = true;
    END IF;

    -- Insert new version row as the current one.
    -- The partial unique index idx_floor_plans_current_unique enforces
    -- "at most one is_current=true per floor" — if a concurrent writer
    -- sneaks a flip-then-insert between our flip and this INSERT,
    -- Postgres raises 23505 and the whole transaction rolls back cleanly.
    -- Caller converts 23505 to 409 CONCURRENT_EDIT.
    INSERT INTO floor_plans (
        property_id, company_id, floor_number, floor_name,
        version_number, canvas_data, created_by_job_id, created_by_user_id,
        change_summary, is_current
    ) VALUES (
        p_property_id, p_company_id, p_floor_number, v_inherited_name,
        v_next_number, p_canvas_data, p_job_id, p_user_id,
        p_change_summary, true
    )
    RETURNING * INTO v_new_row;

    -- Pin this job to the new version, scoped by company.
    UPDATE jobs
       SET floor_plan_id = v_new_row.id
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    RETURN to_jsonb(v_new_row);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

-- The new 9-arg signature needs its own GRANT. Postgres treats functions
-- with different arity as distinct objects. The prior 8-arg form was
-- explicitly DROPped at the top of this migration (round-5 follow-up
-- on Lakshman M2) so only the new signature exists after upgrade and
-- its grant is unambiguous.
GRANT EXECUTE ON FUNCTION save_floor_plan_version(
    UUID, INTEGER, TEXT, UUID, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ
) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- rollback_floor_plan_version_atomic — thread expected_updated_at through
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rollback_floor_plan_version_atomic(
    p_target_floor_plan_id UUID,
    p_job_id               UUID,
    p_user_id              UUID,
    p_change_summary       TEXT,
    p_expected_updated_at  TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_target         RECORD;
    v_job            RECORD;
    v_new_version    JSONB;
    v_new_id         UUID;
    v_restore_result JSONB;
BEGIN
    IF p_target_floor_plan_id IS NULL OR p_job_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_target_floor_plan_id and p_job_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;

    SELECT id, property_id, floor_number, version_number, canvas_data, company_id
      INTO v_target
      FROM floor_plans
     WHERE id = p_target_floor_plan_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target version not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Rollback target not found or belongs to another company';
    END IF;

    SELECT id, property_id, status, deleted_at
      INTO v_job
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or belongs to another company';
    END IF;
    IF v_job.status = 'paid' THEN
        RAISE EXCEPTION 'Job archived'
              USING ERRCODE = '42501',
                    MESSAGE = 'Cannot rollback floor plan for a paid job';
    END IF;
    IF v_job.property_id IS NULL THEN
        RAISE EXCEPTION 'Job has no property'
              USING ERRCODE = '42501',
                    MESSAGE = 'Job has no property_id linked';
    END IF;
    IF v_job.property_id <> v_target.property_id THEN
        RAISE EXCEPTION 'Property mismatch'
              USING ERRCODE = '42501',
                    MESSAGE = 'Target version does not belong to the job''s property';
    END IF;

    -- Round-5: pass the expected updated_at through to save_floor_plan_version.
    -- save_floor_plan_version enforces it atomically on the flip (see its
    -- body). When NULL (backward-compat), both RPCs behave as before.
    v_new_version := save_floor_plan_version(
        v_target.property_id,
        v_target.floor_number,
        NULL,
        v_caller_company,
        p_job_id,
        p_user_id,
        v_target.canvas_data,
        p_change_summary,
        p_expected_updated_at
    );
    v_new_id := (v_new_version ->> 'id')::UUID;

    v_restore_result := restore_floor_plan_relational_snapshot(v_new_id);

    RETURN jsonb_build_object(
        'version', v_new_version,
        'restore', v_restore_result
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION rollback_floor_plan_version_atomic(
    UUID, UUID, UUID, TEXT, TIMESTAMPTZ
) TO authenticated, service_role;
"""


DOWNGRADE_SQL = """
-- Restore the pre-round-5 (8-arg) save_floor_plan_version from c7f8a9b0d1e2.
DROP FUNCTION IF EXISTS save_floor_plan_version(
    UUID, INTEGER, TEXT, UUID, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION save_floor_plan_version(
    p_property_id   UUID,
    p_floor_number  INTEGER,
    p_floor_name    TEXT,
    p_company_id    UUID,
    p_job_id        UUID,
    p_user_id       UUID,
    p_canvas_data   JSONB,
    p_change_summary TEXT
) RETURNS JSONB AS $$
DECLARE
    v_next_number     INTEGER;
    v_inherited_name  TEXT;
    v_new_row         floor_plans%ROWTYPE;
    v_caller_company  UUID;
BEGIN
    IF p_job_id IS NULL OR p_company_id IS NULL OR p_property_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_company_id, and p_property_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company (unauthenticated or user not linked)';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION 'Company mismatch'
              USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match the authenticated caller company';
    END IF;

    PERFORM 1
      FROM properties
     WHERE id = p_property_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Property not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Property not found or does not belong to the caller company';
    END IF;

    PERFORM 1
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND property_id = p_property_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not found on this property'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or does not belong to this property';
    END IF;

    SELECT version_number + 1,
           COALESCE(p_floor_name, floor_name)
      INTO v_next_number, v_inherited_name
      FROM floor_plans
     WHERE property_id  = p_property_id
       AND floor_number = p_floor_number
     ORDER BY version_number DESC
     LIMIT 1;

    IF v_next_number IS NULL THEN
        v_next_number    := 1;
        v_inherited_name := COALESCE(p_floor_name,
                                     'Floor ' || p_floor_number::TEXT);
    END IF;

    UPDATE floor_plans
       SET is_current = false
     WHERE property_id  = p_property_id
       AND floor_number = p_floor_number
       AND is_current   = true;

    INSERT INTO floor_plans (
        property_id, company_id, floor_number, floor_name,
        version_number, canvas_data, created_by_job_id, created_by_user_id,
        change_summary, is_current
    ) VALUES (
        p_property_id, p_company_id, p_floor_number, v_inherited_name,
        v_next_number, p_canvas_data, p_job_id, p_user_id,
        p_change_summary, true
    )
    RETURNING * INTO v_new_row;

    UPDATE jobs
       SET floor_plan_id = v_new_row.id
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    RETURN to_jsonb(v_new_row);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION save_floor_plan_version(
    UUID, INTEGER, TEXT, UUID, UUID, UUID, JSONB, TEXT
) TO authenticated, service_role;


-- Restore the pre-round-5 (4-arg) rollback_floor_plan_version_atomic from
-- f6a9b0c1d2e3, which calls save_floor_plan_version with the old 8-arg shape.
DROP FUNCTION IF EXISTS rollback_floor_plan_version_atomic(
    UUID, UUID, UUID, TEXT, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION rollback_floor_plan_version_atomic(
    p_target_floor_plan_id UUID,
    p_job_id               UUID,
    p_user_id              UUID,
    p_change_summary       TEXT
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_target         RECORD;
    v_job            RECORD;
    v_new_version    JSONB;
    v_new_id         UUID;
    v_restore_result JSONB;
BEGIN
    IF p_target_floor_plan_id IS NULL OR p_job_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_target_floor_plan_id and p_job_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;

    SELECT id, property_id, floor_number, version_number, canvas_data, company_id
      INTO v_target
      FROM floor_plans
     WHERE id = p_target_floor_plan_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target version not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Rollback target not found or belongs to another company';
    END IF;

    SELECT id, property_id, status, deleted_at
      INTO v_job
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or belongs to another company';
    END IF;
    IF v_job.status = 'paid' THEN
        RAISE EXCEPTION 'Job archived'
              USING ERRCODE = '42501',
                    MESSAGE = 'Cannot rollback floor plan for a paid job';
    END IF;
    IF v_job.property_id IS NULL THEN
        RAISE EXCEPTION 'Job has no property'
              USING ERRCODE = '42501',
                    MESSAGE = 'Job has no property_id linked';
    END IF;
    IF v_job.property_id <> v_target.property_id THEN
        RAISE EXCEPTION 'Property mismatch'
              USING ERRCODE = '42501',
                    MESSAGE = 'Target version does not belong to the job''s property';
    END IF;

    v_new_version := save_floor_plan_version(
        v_target.property_id,
        v_target.floor_number,
        NULL,
        v_caller_company,
        p_job_id,
        p_user_id,
        v_target.canvas_data,
        p_change_summary
    );
    v_new_id := (v_new_version ->> 'id')::UUID;

    v_restore_result := restore_floor_plan_relational_snapshot(v_new_id);

    RETURN jsonb_build_object(
        'version', v_new_version,
        'restore', v_restore_result
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION rollback_floor_plan_version_atomic(
    UUID, UUID, UUID, TEXT
) TO authenticated, service_role;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
