"""Spec 01H Phase 3 PR-B2 Step 5: jobs.completed_at + ensure_equipment_mutable.

Two additions that together enable the explicit "Mark Job Complete"
lifecycle without breaking existing archive semantics for floor plans,
moisture pins, and other job-scoped data:

1. Columns on ``jobs``:
   - ``completed_at TIMESTAMPTZ NULL``
   - ``completed_by UUID NULL REFERENCES users(id)``
   These stamp the CURRENT completion moment. On reopen, they go back
   to NULL — historical completion moments live in the dedicated
   ``job_completion_events`` log (Step 4). CHECK enforces that the
   pair is set atomically (both NULL or both NOT NULL) so the
   discriminant "is this job complete right now?" is trustworthy.

2. Function ``ensure_equipment_mutable(p_job_id UUID)``:
   Stricter sibling of ``ensure_job_mutable``. Blocks mutations on
   jobs whose ``status`` is in the equipment-freeze set:
   {'complete', 'submitted', 'collected'}. The standard
   ``ensure_job_mutable`` only blocks on ``'collected'`` — that
   looseness is intentional for floor plans + pins, where techs can
   still edit a job in ``'submitted'`` if carrier requests corrections
   to scope. Equipment is different: once the tech taps "Mark Job
   Complete" the billing snapshot must freeze.

   Kept separate from ``ensure_job_mutable`` so a later change to the
   equipment set doesn't quietly tighten floor plan / pin mutability
   via a shared constant. The two functions are sibling paths, never
   shared (lesson §3 — enforce invariants via shape parity between
   siblings, not via shared state).

Why no EQUIPMENT_FROZEN_STATUSES Python constant here (yet):
   Step 11 (service layer) adds the Python twin. Consistent with the
   existing ARCHIVED_JOB_STATUSES pattern — DB function is the SQL-
   side source of truth, Python constant mirrors it, a drift-check
   test keeps them aligned (see test_archive_status_drift.py).

Revision ID: d5a6b7c8e9f0
Revises: d4a5b6c7e8f9
Create Date: 2026-04-25
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5a6b7c8e9f0"
down_revision: str | None = "d4a5b6c7e8f9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ============================================================================
-- (1) jobs.completed_at + completed_by columns.
--     Nullable so existing rows don't break (backfill would be wrong —
--     we don't retroactively "complete" historical jobs).
-- ============================================================================
ALTER TABLE jobs
    ADD COLUMN completed_at TIMESTAMPTZ,
    ADD COLUMN completed_by UUID REFERENCES users(id);

-- Both-or-neither discriminant: if the job is complete, both stamps
-- must be filled. If it's not complete, both must be NULL. Prevents a
-- half-filled state where one of the two is set and the other isn't —
-- which would leave "is this job complete?" ambiguous.
--
-- Round-1 review CRITICAL #2 — original predicate was:
--     (completed_at IS NULL AND completed_by IS NULL)
--     OR (completed_at IS NOT NULL)
-- which allowed (completed_at=NOT NULL, completed_by=NULL) to slip
-- through. The second disjunct now explicitly requires completed_by
-- IS NOT NULL. Combined with the round-1 fix in complete_job (rejects
-- NULL v_caller_user with 42501), this closes the service-role /
-- soft-deleted-user NULL-actor case.
ALTER TABLE jobs
    ADD CONSTRAINT chk_completed_pair CHECK (
        (completed_at IS NULL AND completed_by IS NULL)
        OR (completed_at IS NOT NULL AND completed_by IS NOT NULL)
    );

COMMENT ON COLUMN jobs.completed_at IS
    'Current completion moment. NULL while active; stamped when tech '
    'taps Mark Job Complete; re-cleared to NULL on reopen. Historical '
    'completion events are preserved in job_completion_events.';

COMMENT ON COLUMN jobs.completed_by IS
    'Users.id of the user who marked this job complete. Cleared to '
    'NULL alongside completed_at on reopen.';


-- ============================================================================
-- (2) ensure_equipment_mutable — stricter archive guard for equipment
--     RPCs. Blocks on {complete, submitted, collected}. Siblings
--     (floor plans, pins) keep using ensure_job_mutable which blocks
--     only on 'collected'.
-- ============================================================================
CREATE OR REPLACE FUNCTION ensure_equipment_mutable(p_job_id UUID)
RETURNS VOID AS $$
DECLARE
    v_status         TEXT;
    v_caller_company UUID;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id is required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    -- Tenant-scoped fetch. Cross-tenant job id → NOT FOUND so we raise
    -- P0002, matching ensure_job_mutable's shape exactly (lesson §3 —
    -- sibling functions must have sibling error modes).
    SELECT status INTO v_status
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or not accessible';
    END IF;

    -- The equipment-freeze set. KEEP IN SYNC with the Python constant
    -- EQUIPMENT_FROZEN_STATUSES (added in PR-B2 Step 11). A drift-check
    -- test in backend/tests/ compares the two — modifying one without
    -- the other fails the drift test loudly.
    --
    -- 55006 ``invalid_prerequisite_state`` distinguishes this error
    -- from ensure_job_mutable's 55006 at the SQLSTATE level — they
    -- share a code deliberately so Python catches can collapse them
    -- to the same "job is frozen" user-facing copy. The MESSAGE
    -- surfaces the specific status so logs can tell them apart.
    IF v_status IN ('complete', 'submitted', 'collected') THEN
        RAISE EXCEPTION USING ERRCODE = '55006',
                    MESSAGE = 'Equipment is frozen on a completed/submitted/collected job (status: ' || v_status || ')';
    END IF;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION ensure_equipment_mutable(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION ensure_equipment_mutable(UUID) IS
    'Stricter archive guard for equipment mutation RPCs. Blocks on '
    'status IN (complete, submitted, collected). Sibling of '
    'ensure_job_mutable (which blocks only on ''collected''). Keep '
    'frozen-status list in sync with EQUIPMENT_FROZEN_STATUSES Python '
    'constant. Spec 01H Phase 3 PR-B2 Step 5.';
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS ensure_equipment_mutable(UUID);

ALTER TABLE jobs
    DROP CONSTRAINT IF EXISTS chk_completed_pair;
ALTER TABLE jobs
    DROP COLUMN IF EXISTS completed_by,
    DROP COLUMN IF EXISTS completed_at;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
