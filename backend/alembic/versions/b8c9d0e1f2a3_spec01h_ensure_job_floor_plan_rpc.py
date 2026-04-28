"""Spec 01H round-3: ensure_job_floor_plan atomic RPC.

Round-3 critical review flagged that `create_floor_plan_by_job_endpoint`'s
try-create-catch-409-fallback path regressed the R12 cache reconciliation
fix on the error branch. Root cause: optimistic create + error recovery is
the wrong shape for this problem. Two techs on the same job (common in
restoration work — multiple techs on the same property) race to create
a floor plan, the database throws 23505 at one of them, and the recovery
branch is subtly broken.

Replace with the established round-2 pattern from ensure_job_property:
an idempotent plpgsql RPC that runs "return existing or create new" in
one transactional function. Callers get the same floor plan regardless
of race order. The 409 code path becomes unreachable and can be deleted.

Contract:
    ensure_job_floor_plan(
        p_job_id         UUID   -- required
        p_floor_number   INTEGER -- required; floor the tech is creating
        p_floor_name     TEXT   -- optional; defaults to "Floor N"
        p_user_id        UUID   -- required for created_by_user_id stamp
    ) RETURNS JSONB (full floor_plans row)

Tenant + SECURITY DEFINER hygiene mirrors R3's save_floor_plan_version:
    - company derived from get_my_company_id() (JWT), NEVER from params
    - search_path pinned to pg_catalog, public
    - GRANT EXECUTE to authenticated + service_role

Behavior:
    1. Derive caller's company from JWT. NULL → 42501 "no JWT company".
    2. SELECT ... FOR UPDATE on the jobs row (scoped to caller's company,
       soft-delete-filtered). Not found → P0002. Collected (archived) →
       55006 "object_not_in_prerequisite_state" (matches the frozen-row
       trigger convention). NULL property_id → 23502 "not_null_violation"
       so the Python caller can disambiguate and instruct the user to
       ensure_job_property first.
       Post-review MEDIUM #4: previously all three distinct prerequisite
       states (no JWT company, archived, null property) raised 42501,
       making it impossible for the Python catch block to tell them
       apart — a SQLSTATE collision that lessons-doc §5 warned against.
    3. Idempotent fast path: if the job's pinned floor_plan_id points at
       a row that is (still is_current) AND (on the job's property) AND
       (matches p_floor_number), return that row. This handles retries.
    4. Same-floor reuse: SELECT the existing is_current=true row for
       (property_id, floor_number). If found, pin the job to it and
       return. This is the path that closes Lakshman's race — both tabs
       get the same row.
    5. Create: INSERT a new version=1, is_current=true row with empty
       canvas_data, stamped with created_by_user_id + created_by_job_id.
       Pin the job. Return it. Partial unique index idx_floor_plans_current_unique
       is the defense-in-depth; we let 23505 bubble to the Python caller,
       which retries once (same pattern as ensure_job_property).

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: str | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION ensure_job_floor_plan(
    p_job_id       UUID,
    p_floor_number INTEGER,
    p_floor_name   TEXT,
    p_user_id      UUID
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_job            RECORD;
    v_existing       floor_plans%ROWTYPE;
    v_new            floor_plans%ROWTYPE;
    v_floor_name     TEXT;
BEGIN
    IF p_job_id IS NULL OR p_floor_number IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_floor_number, p_user_id are required';
    END IF;

    -- Tenant check — derive from JWT, never trust the caller. Same
    -- pattern as ensure_job_property / save_floor_plan_version.
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;

    -- Lock the jobs row so concurrent callers on THE SAME JOB serialize
    -- here. Two different jobs on the same property at the same floor
    -- number still race past this lock; the partial unique address-level
    -- index on floor_plans catches them, and the Python caller's 23505
    -- retry-once resolves by taking the idempotent fast path on retry.
    SELECT id, company_id, property_id, floor_plan_id, status, deleted_at
      INTO v_job
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or does not belong to the caller company';
    END IF;

    -- Post-review MEDIUM #4: distinct SQLSTATEs per prerequisite state
    -- so the Python caller can emit the right user-facing error. 55006
    -- (object_not_in_prerequisite_state) matches the convention used
    -- by the frozen-version trigger for "row is not in a mutable state",
    -- which is exactly what an archived job is.
    -- Spec 01K — three archived terminal statuses, not just paid.
    -- Mirror api/shared/constants.py ARCHIVED_JOB_STATUSES so DB-level
    -- guards stay consistent with service-layer guards.
    IF v_job.status IN ('paid', 'cancelled', 'lost') THEN
        RAISE EXCEPTION 'Job archived'
              USING ERRCODE = '55006',
                    MESSAGE = 'Cannot create floor plan for an archived job';
    END IF;

    -- 23502 (not_null_violation) semantically fits: the RPC's invariant
    -- is "job MUST have a property_id before a floor plan can exist",
    -- and the input has property_id=NULL. Lets the router return 409
    -- JOB_NO_PROPERTY with actionable guidance (call ensure_job_property)
    -- instead of a generic JOB_NOT_MUTABLE.
    IF v_job.property_id IS NULL THEN
        RAISE EXCEPTION 'Job has no property'
              USING ERRCODE = '23502',
                    MESSAGE = 'Job has no property_id — call ensure_job_property first';
    END IF;

    v_floor_name := COALESCE(p_floor_name, 'Floor ' || p_floor_number::TEXT);

    -- Idempotent fast path: the job is already pinned to an is_current
    -- row on its property, at the right floor. Return it unchanged. This
    -- keeps retries cheap and handles "user double-tapped the Create
    -- button" without creating a new version.
    IF v_job.floor_plan_id IS NOT NULL THEN
        SELECT *
          INTO v_existing
          FROM floor_plans
         WHERE id = v_job.floor_plan_id
           AND company_id = v_caller_company
           AND is_current = TRUE
           AND property_id = v_job.property_id
           AND floor_number = p_floor_number;
        IF FOUND THEN
            RETURN to_jsonb(v_existing);
        END IF;
    END IF;

    -- Same-floor reuse: another writer (same job retrying, or a sibling
    -- job on the same property) already created the row for this
    -- (property, floor_number). Pin this job to it and return. THIS IS
    -- THE PATH THAT CLOSES THE RACE: both tabs' callers converge here.
    SELECT *
      INTO v_existing
      FROM floor_plans
     WHERE property_id = v_job.property_id
       AND floor_number = p_floor_number
       AND company_id = v_caller_company
       AND is_current = TRUE;
    IF FOUND THEN
        UPDATE jobs
           SET floor_plan_id = v_existing.id
         WHERE id = p_job_id
           AND company_id = v_caller_company;
        RETURN to_jsonb(v_existing);
    END IF;

    -- No existing row — create. The partial unique index
    -- idx_floor_plans_current_unique on (property_id, floor_number)
    -- WHERE is_current=true enforces the invariant: if a sibling job's
    -- RPC lands its INSERT between our SELECT above and our INSERT here,
    -- Postgres raises 23505. The Python caller catches that and retries
    -- once, landing in the same-floor-reuse branch above.
    INSERT INTO floor_plans (
        property_id, company_id, floor_number, floor_name,
        canvas_data, version_number, is_current,
        created_by_user_id, created_by_job_id
    ) VALUES (
        v_job.property_id, v_caller_company, p_floor_number, v_floor_name,
        '{}'::jsonb, 1, TRUE,
        p_user_id, p_job_id
    )
    RETURNING * INTO v_new;

    UPDATE jobs
       SET floor_plan_id = v_new.id
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    RETURN to_jsonb(v_new);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION ensure_job_floor_plan(UUID, INTEGER, TEXT, UUID)
    TO authenticated, service_role;
"""

DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS ensure_job_floor_plan(UUID, INTEGER, TEXT, UUID);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
