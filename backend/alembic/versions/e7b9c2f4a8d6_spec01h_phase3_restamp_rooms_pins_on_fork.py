"""Spec 01H Phase 3 (PR-A, Step 3 permanent fix): re-stamp rooms + pins on fork.

Root cause of the stale ``floor_plan_id`` drift that triggered the
one-shot repair in ``d3e5a7c9b1f4``:

When ``save_floor_plan_version`` forks a new version (Case 3 in the
spec's state machine, and also the creation path when Case 1 is the
first save on a floor), it atomically:
  1. Flips the old current row's ``is_current = false``,
  2. INSERTs a new row as ``is_current = true``,
  3. Repoints ``jobs.floor_plan_id`` to the new row.

What it did NOT do was repoint the downstream stamps — ``job_rooms``
and (post-Phase-3-Step-2) ``moisture_pins``. Every subsequent fork by
the SAME JOB left its own rooms + pins pointing at the prior version,
so the frontend's exact-id bucketing against current-version floor
plans put every pin into the "Uncategorized" orphan bucket.

Fix: inside the same transaction, UPDATE the caller job's rooms and
pins on THIS floor to the new version id. The filter keys on
``(property_id, floor_number)`` so any multi-hop drift (job edits floor
after another fork happened) still resolves in one statement — we
don't walk the version chain, we just retarget anything on this floor
for this job.

Why it must be inside the RPC (lesson #4): atomicity. If we moved this
to the Python caller, a transient failure between the flip and the
stamp would leave the drift in place for another revision cycle. One
function, one transaction, all-or-nothing.

Rollback path inherits automatically — ``rollback_floor_plan_version_atomic``
composes by calling this RPC, so the re-stamp fires on rollback too.

Revision ID: e7b9c2f4a8d6
Revises: d3e5a7c9b1f4
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7b9c2f4a8d6"
down_revision: str | None = "d3e5a7c9b1f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION save_floor_plan_version(
    p_property_id           UUID,
    p_floor_number          INTEGER,
    p_floor_name            TEXT,
    p_company_id            UUID,
    p_job_id                UUID,
    p_user_id               UUID,
    p_canvas_data           JSONB,
    p_change_summary        TEXT,
    p_expected_updated_at   TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_next_number     INTEGER;
    v_inherited_name  TEXT;
    v_new_row         floor_plans%ROWTYPE;
    v_caller_company  UUID;
    v_flipped_count   INTEGER;
BEGIN
    -- NULL param guards.
    IF p_job_id IS NULL OR p_company_id IS NULL OR p_property_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_company_id, and p_property_id are required';
    END IF;

    -- R3 tenant check.
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company (unauthenticated or user not linked)';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match the authenticated caller company';
    END IF;

    -- R3 property-on-company check.
    PERFORM 1
      FROM properties
     WHERE id = p_property_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Property not found or does not belong to the caller company';
    END IF;

    -- R3 job-on-property check.
    PERFORM 1
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND property_id = p_property_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or does not belong to this property';
    END IF;

    -- Compute next version_number; inherit floor_name.
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
    IF p_expected_updated_at IS NOT NULL THEN
        UPDATE floor_plans
           SET is_current = false
         WHERE property_id  = p_property_id
           AND floor_number = p_floor_number
           AND is_current   = true
           AND updated_at   = p_expected_updated_at;
        GET DIAGNOSTICS v_flipped_count = ROW_COUNT;

        IF v_flipped_count = 0 THEN
            PERFORM 1 FROM floor_plans
             WHERE property_id  = p_property_id
               AND floor_number = p_floor_number
               AND is_current   = true;
            IF FOUND THEN
                RAISE EXCEPTION USING ERRCODE = '55006',
                    MESSAGE = 'Current floor plan version updated_at does not match expected — another writer committed between the caller''s read and this RPC';
            END IF;
        END IF;
    ELSE
        UPDATE floor_plans
           SET is_current = false
         WHERE property_id  = p_property_id
           AND floor_number = p_floor_number
           AND is_current   = true;
    END IF;

    -- Insert new version row as the current one.
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

    -- ==========================================================================
    -- Phase 3 Step 3 permanent fix: re-stamp this job's rooms + pins on this
    -- floor to the new version. Closes the drift that caused the one-shot
    -- repair in d3e5a7c9b1f4.
    --
    -- Filter keys on (property_id, floor_number) rather than the specific
    -- prior version id. That way, if a job's rooms point at any older
    -- version of this floor (not necessarily the immediate predecessor),
    -- they're all retargeted correctly in one statement.
    --
    -- Scoped to p_job_id so sibling jobs' rooms on the same floor are NOT
    -- disturbed — frozen-version semantics (Phase 1: a job's pin only
    -- moves when THAT job saves) apply equally to rooms and pins. Another
    -- job that's still pinned to the old version keeps its rooms there.
    -- ==========================================================================

    UPDATE job_rooms jr
       SET floor_plan_id = v_new_row.id
      FROM floor_plans fp
     WHERE jr.floor_plan_id = fp.id
       AND jr.job_id = p_job_id
       AND fp.property_id = p_property_id
       AND fp.floor_number = p_floor_number;

    UPDATE moisture_pins mp
       SET floor_plan_id = v_new_row.id
      FROM floor_plans fp
     WHERE mp.floor_plan_id = fp.id
       AND mp.job_id = p_job_id
       AND fp.property_id = p_property_id
       AND fp.floor_number = p_floor_number;

    RETURN to_jsonb(v_new_row);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;
"""


# Restore the prior body (identical to the one in c9d0e1f2a3b4 — no re-stamp).
DOWNGRADE_SQL = """
CREATE OR REPLACE FUNCTION save_floor_plan_version(
    p_property_id           UUID,
    p_floor_number          INTEGER,
    p_floor_name            TEXT,
    p_company_id            UUID,
    p_job_id                UUID,
    p_user_id               UUID,
    p_canvas_data           JSONB,
    p_change_summary        TEXT,
    p_expected_updated_at   TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_next_number     INTEGER;
    v_inherited_name  TEXT;
    v_new_row         floor_plans%ROWTYPE;
    v_caller_company  UUID;
    v_flipped_count   INTEGER;
BEGIN
    IF p_job_id IS NULL OR p_company_id IS NULL OR p_property_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_company_id, and p_property_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company (unauthenticated or user not linked)';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match the authenticated caller company';
    END IF;

    PERFORM 1
      FROM properties
     WHERE id = p_property_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Property not found or does not belong to the caller company';
    END IF;

    PERFORM 1
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND property_id = p_property_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
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

    IF p_expected_updated_at IS NOT NULL THEN
        UPDATE floor_plans
           SET is_current = false
         WHERE property_id  = p_property_id
           AND floor_number = p_floor_number
           AND is_current   = true
           AND updated_at   = p_expected_updated_at;
        GET DIAGNOSTICS v_flipped_count = ROW_COUNT;

        IF v_flipped_count = 0 THEN
            PERFORM 1 FROM floor_plans
             WHERE property_id  = p_property_id
               AND floor_number = p_floor_number
               AND is_current   = true;
            IF FOUND THEN
                RAISE EXCEPTION USING ERRCODE = '55006',
                    MESSAGE = 'Current floor plan version updated_at does not match expected — another writer committed between the caller''s read and this RPC';
            END IF;
        END IF;
    ELSE
        UPDATE floor_plans
           SET is_current = false
         WHERE property_id  = p_property_id
           AND floor_number = p_floor_number
           AND is_current   = true;
    END IF;

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
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
