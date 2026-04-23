"""Spec 01H: save_floor_plan_version RPC (C4 fix).

_create_version + _pin_job_to_version were two separate database calls.
If the pin call failed (network blip, permission flap) after the version
row was inserted, the database was left half-committed:

- new version row exists with is_current=true
- but job.floor_plan_id still points at the OLD row (now is_current=false)

Next save on that job re-read the stale pin, saw is_current=false, fell
into Case 3, and forked yet another version — orphaning the one we just
created. Every transient network error between insert and pin bifurcated
version history.

This migration merges flip + insert + pin into one plpgsql function that
runs as a single transaction. Postgres rolls back all three writes if any
step fails, so the half-committed state is no longer reachable.

Tenant isolation lives inside the function (explicit company_id check on
the jobs row) since SECURITY DEFINER bypasses RLS.

Revision ID: b2c3d4e5f6a7
Revises: a1f2b9c4e5d6
Create Date: 2026-04-21
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1f2b9c4e5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
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
    v_next_number    INTEGER;
    v_inherited_name TEXT;
    v_new_row        floor_plans%ROWTYPE;
BEGIN
    -- NULL param guards. Without these, a malformed call with NULL job_id or
    -- company_id would fall through to the tenant check below — which returns
    -- NOT FOUND (NULL = anything is NULL in SQL) and raises the generic
    -- "Job not found" error. Failing loudly on NULLs makes client bugs easier
    -- to diagnose and closes any theoretical NULL-coalescence exploit path.
    IF p_job_id IS NULL OR p_company_id IS NULL OR p_property_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_company_id, and p_property_id are required';
    END IF;

    -- Tenant check: the job must belong to the caller's company and not be
    -- soft-deleted. SECURITY DEFINER bypasses RLS so this is our only guard.
    PERFORM 1
      FROM jobs
     WHERE id = p_job_id
       AND company_id = p_company_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not found'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or not accessible';
    END IF;

    -- Compute next version_number; inherit floor_name from latest sibling
    -- if caller didn't supply one.
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

    -- Flip any existing is_current=true rows on this floor to false BEFORE
    -- inserting the new current row. The partial unique index
    -- idx_floor_plans_current_unique enforces "at most one is_current=true
    -- per floor" — if a concurrent writer lands the same flip-then-insert
    -- sequence between our UPDATE and INSERT, Postgres raises 23505 here
    -- and the whole transaction rolls back cleanly. Caller converts to 409.
    UPDATE floor_plans
       SET is_current = false
     WHERE property_id  = p_property_id
       AND floor_number = p_floor_number
       AND is_current   = true;

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

    -- Pin this job to the new version. Scoped by company_id so a malformed
    -- job_id that slipped the tenant check can't update a foreign job.
    UPDATE jobs
       SET floor_plan_id = v_new_row.id
     WHERE id = p_job_id
       AND company_id = p_company_id;

    RETURN to_jsonb(v_new_row);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to the roles that use authenticated Supabase clients.
-- SECURITY DEFINER means the function's body runs as the definer (superuser),
-- but the EXECUTE grant controls who can call the function.
GRANT EXECUTE ON FUNCTION save_floor_plan_version(UUID, INTEGER, TEXT, UUID, UUID, UUID, JSONB, TEXT)
    TO authenticated, service_role;
"""

DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS save_floor_plan_version(UUID, INTEGER, TEXT, UUID, UUID, UUID, JSONB, TEXT);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
