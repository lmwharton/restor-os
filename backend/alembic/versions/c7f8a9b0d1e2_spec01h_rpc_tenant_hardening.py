"""Spec 01H PR10 round-2 (R3): harden save_floor_plan_version RPC tenancy.

The round-1 RPC (b2c3d4e5f6a7) is ``SECURITY DEFINER`` and granted to
``authenticated``. Its tenant check was ``WHERE jobs.company_id = p_company_id``
— but ``p_company_id`` is a caller-supplied parameter. Any authenticated user
could pass a foreign tenant's ``(p_company_id, p_job_id, p_property_id)``
trio and the function would happily insert into that company's ``floor_plans``
table. SECURITY DEFINER bypasses RLS, so RLS does not save us.

This migration replaces the function body so that:

* the caller's company is derived from the JWT via ``get_my_company_id()`` and
  must match ``p_company_id`` (otherwise 42501 insufficient_privilege);
* ``p_property_id`` must belong to that company (otherwise P0002 no_data_found);
* ``jobs.property_id`` must equal ``p_property_id`` — the job's floor plan
  must live on the job's property (otherwise P0002);
* the function definition pins ``search_path`` so a tenant cannot shadow
  ``public`` names to hijack the SECURITY DEFINER context.

Signature is unchanged — existing callers keep working. Rollback restores
the pre-R3 body verbatim.

Revision ID: c7f8a9b0d1e2
Revises: b2c3d4e5f6a7
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c7f8a9b0d1e2"
down_revision: str | None = "b2c3d4e5f6a7"
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
    v_next_number     INTEGER;
    v_inherited_name  TEXT;
    v_new_row         floor_plans%ROWTYPE;
    v_caller_company  UUID;
BEGIN
    -- NULL param guards (unchanged behavior from b2c3d4e5f6a7).
    IF p_job_id IS NULL OR p_company_id IS NULL OR p_property_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_company_id, and p_property_id are required';
    END IF;

    -- R3: derive the caller's company from the JWT (auth.uid() → users.company_id
    -- via get_my_company_id()), never trust the client-supplied p_company_id.
    -- SECURITY DEFINER bypasses RLS, so without this check any authenticated
    -- user could pass a foreign tenant's (job_id, company_id, property_id)
    -- trio and the function would insert into that tenant's floor_plans table.
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

    -- R3: property must belong to the caller's company and not be soft-deleted.
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

    -- R3: job must belong to caller's company AND live on the given property.
    -- This enforces the invariant "a job's floor plan lives on the job's
    -- property" at the RPC boundary, not just the service layer.
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
       AND company_id = v_caller_company;

    RETURN to_jsonb(v_new_row);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

-- Grants are idempotent and inherited from b2c3d4e5f6a7; re-assert in case
-- the function was dropped and recreated without them.
GRANT EXECUTE ON FUNCTION save_floor_plan_version(UUID, INTEGER, TEXT, UUID, UUID, UUID, JSONB, TEXT)
    TO authenticated, service_role;
"""


# Downgrade restores the pre-R3 function body verbatim (from b2c3d4e5f6a7).
DOWNGRADE_SQL = """
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
    IF p_job_id IS NULL OR p_company_id IS NULL OR p_property_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_company_id, and p_property_id are required';
    END IF;

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
       AND company_id = p_company_id;

    RETURN to_jsonb(v_new_row);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION save_floor_plan_version(UUID, INTEGER, TEXT, UUID, UUID, UUID, JSONB, TEXT)
    TO authenticated, service_role;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
