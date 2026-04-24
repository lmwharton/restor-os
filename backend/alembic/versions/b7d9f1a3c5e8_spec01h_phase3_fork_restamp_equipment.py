"""Spec 01H Phase 3 PR-B Step 8: extend fork-restamp to equipment_placements.

Lesson #29 extension rule in action. PR-A's ``save_floor_plan_version``
re-stamps ``job_rooms`` + ``moisture_pins`` on every version fork so
downstream consumers that filter by current-version id don't lose them
to the orphan bucket. PR-B added ``equipment_placements.floor_plan_id``
as a third stamped column — it needs the same treatment.

This migration amends ``save_floor_plan_version`` to add a third UPDATE
inside the fork transaction. Pattern is identical to the existing two:
filter by ``(job_id, property_id, floor_number)`` so only the saving
job's equipment on this floor gets retargeted; sibling jobs pinned to
older versions keep their own stamps (frozen-version semantics,
Phase 1 rule).

Also extends ``tests/integration/test_fork_restamp_invariant.py``'s
``EXPECTED_RESTAMP_TABLES`` so future migrations that drop the
equipment UPDATE fail the invariant test (lesson #29 — the integration
test is the single place that enumerates the full set of tables the
fork RPC must keep in sync; new stamped tables must be appended).

Revision ID: b7d9f1a3c5e8
Revises: c5e7a9b1d3f6
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d9f1a3c5e8"
down_revision: str | None = "c5e7a9b1d3f6"
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
                    MESSAGE = 'JWT did not resolve to a company';
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

    -- Round-5 INV-2: atomic etag enforcement on the flip.
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

    -- Pin this job to the new version.
    UPDATE jobs
       SET floor_plan_id = v_new_row.id
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    -- ==========================================================================
    -- Re-stamp downstream tables inside the fork transaction.
    -- Scoped to p_job_id so sibling jobs' stamps don't move (frozen-
    -- version semantics). Filter on (property_id, floor_number) so any
    -- multi-hop drift — where this job's rows point at an older version
    -- of this same floor — gets retargeted in one statement.
    --
    -- PR-A installed the first two:
    --   * job_rooms (PR-A Step 3 permanent fix, migration e7b9c2f4a8d6)
    --   * moisture_pins (PR-A Step 3 permanent fix)
    --
    -- PR-B adds the third via the lesson #29 extension rule:
    --   * equipment_placements (this migration)
    --
    -- Any future job-scoped table that stamps floor_plan_id must also
    -- land here + append itself to EXPECTED_RESTAMP_TABLES in
    -- tests/integration/test_fork_restamp_invariant.py.
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

    UPDATE equipment_placements ep
       SET floor_plan_id = v_new_row.id
      FROM floor_plans fp
     WHERE ep.floor_plan_id = fp.id
       AND ep.job_id = p_job_id
       AND fp.property_id = p_property_id
       AND fp.floor_number = p_floor_number;

    RETURN to_jsonb(v_new_row);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;
"""


# Restore the PR-A body (two UPDATEs only — no equipment_placements).
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
                    MESSAGE = 'JWT did not resolve to a company';
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


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
