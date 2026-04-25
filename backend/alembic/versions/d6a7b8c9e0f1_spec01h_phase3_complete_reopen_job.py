"""Spec 01H Phase 3 PR-B2 Step 6: complete_job + reopen_job RPCs.

The explicit job-lifecycle surface. ``complete_job`` transitions a job
from its active drying state to ``'complete'``, freezes equipment
billing, and appends an audit row. ``reopen_job`` reverses the status
+ clears the current completion stamps but leaves ALL equipment rows
and the audit log intact.

complete_job(p_job_id, p_notes) — available to any authenticated caller
on the job's tenant. One transaction:

  1. ``ensure_job_mutable(p_job_id)`` — block double-completion. This
     is the LOOSER guard (only blocks 'collected') — a 'drying' or
     'mitigation' job is fine to complete from here. ``ensure_equipment_mutable``
     would block 'complete' too, which is what we want to PREVENT
     here (double-complete on an already-complete job).
  2. Transition: ``jobs.status = 'complete'``, stamp ``completed_at``
     + ``completed_by``. Atomic UPDATE scoped to company.
  3. Auto-pull every active ``equipment_placements`` row on the job:
     ``UPDATE ... SET pulled_at = <completed_at>`` where
     ``pulled_at IS NULL``. Uses the SAME timestamp as the jobs row so
     billing math treats "pulled at completion" as an extension of the
     completion moment itself — no off-by-a-millisecond drift.
  4. Append ``job_completion_events`` row. Future reopen + re-complete
     cycles stack additional rows; this one is the first.

reopen_job(p_job_id, p_reason) — **owner-only**. Checks caller's
``users.role = 'owner'`` before anything else. One transaction:

  1. Verify caller is an owner (lesson §3 — permission check derives
     from JWT-bound user, not a param).
  2. Verify current state is ``'complete'``. Reopening from
     'submitted' or 'collected' requires unsubmitting / uncollecting
     first through those flows — we don't short-circuit here.
  3. Transition: ``jobs.status = 'drying'``, clear completed_at + by.
  4. UPDATE the LATEST ``job_completion_events`` row for this job:
     stamp ``reopened_at``, ``reopened_by``, ``reopen_reason``.
  5. Equipment rows are NOT touched. The auto-pulled rows stay pulled;
     their billing contribution is locked at the completion moment.
     If the tech resumes any unit, they'll use restart_equipment_placement
     which creates a new chain link.

Status-transition decision: reopen goes back to ``'drying'`` (not
'mitigation' or 'new') on the assumption that a job being reopened
has already passed the drying phase once. If in practice we see
customers want to go further back, that's an audit / UX decision,
not a data integrity one — we'll update the literal without
schema changes.

Revision ID: d6a7b8c9e0f1
Revises: d5a6b7c8e9f0
Create Date: 2026-04-25
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d6a7b8c9e0f1"
down_revision: str | None = "d5a6b7c8e9f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ============================================================================
-- complete_job — transition to 'complete', auto-pull, audit.
-- ============================================================================
CREATE OR REPLACE FUNCTION complete_job(
    p_job_id  UUID,
    p_notes   TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company    UUID;
    v_caller_user       UUID;
    v_current_status    TEXT;
    v_completed_at      TIMESTAMPTZ;
    v_auto_pulled_count INT := 0;
    v_event_id          UUID;
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

    -- Looser guard so we catch the "job is already collected" case
    -- clearly. We'll add our own "already complete" rejection below
    -- for the 'complete' / 'submitted' states.
    PERFORM ensure_job_mutable(p_job_id);

    -- Look up internal users.id + current status in one query. Also
    -- filter the job SELECT by deleted_at IS NULL so a soft-deleted
    -- job can't be completed (out-of-scope #1 from round-1 review).
    SELECT j.status,
           (SELECT id FROM users
             WHERE auth_user_id = auth.uid()
               AND company_id = v_caller_company
               AND deleted_at IS NULL)
      INTO v_current_status, v_caller_user
      FROM jobs j
     WHERE j.id = p_job_id
       AND j.company_id = v_caller_company
       AND j.deleted_at IS NULL;
    IF v_current_status IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or not accessible';
    END IF;

    -- Round-1 review CRITICAL #2 part 2 — the SELECT above sources the
    -- caller user via auth.uid() → users.id. When called by service_role
    -- (grant is authenticated, service_role), auth.uid() is NULL → no
    -- matching user → v_caller_user = NULL. Without this guard, the
    -- subsequent UPDATE writes completed_by = NULL; the CHK_COMPLETED_PAIR
    -- constraint (post-fix) blocks it, but the error surfaces as a raw
    -- 23514 with no plpgsql context. Reject upfront with a clear 42501
    -- so the caller knows the real problem ("use an authenticated user
    -- context, not service-role, for this action").
    IF v_caller_user IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Caller could not be resolved to an internal user (service-role or soft-deleted actor) — complete_job requires an authenticated user context';
    END IF;

    -- Reject double-completion. 'submitted' + 'collected' are archive
    -- states ensure_job_mutable would already have caught for 'collected';
    -- 'submitted' is mutable by ensure_job_mutable's set but complete_job
    -- shouldn't run on it (submitting is a forward move, not a completion
    -- redo). Loud-fail with a crisp message.
    IF v_current_status IN ('complete', 'submitted', 'collected') THEN
        RAISE EXCEPTION USING ERRCODE = '55006',
                    MESSAGE = 'Job cannot be marked complete from status: ' || v_current_status;
    END IF;

    v_completed_at := now();

    -- Transition the job. CHECK chk_completed_pair requires both
    -- stamps together, so we set them in one statement.
    UPDATE jobs
       SET status       = 'complete',
           completed_at = v_completed_at,
           completed_by = v_caller_user,
           updated_at   = v_completed_at
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    -- Auto-pull every still-active equipment placement on this job.
    -- Stamp with the SAME v_completed_at so the billing timeline has
    -- a clean edge at completion rather than a smear of timestamps
    -- that differ by microseconds.
    WITH pulled AS (
        UPDATE equipment_placements
           SET pulled_at  = v_completed_at,
               pulled_by  = v_caller_user,
               updated_at = v_completed_at
         WHERE job_id = p_job_id
           AND company_id = v_caller_company
           AND pulled_at IS NULL
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_auto_pulled_count FROM pulled;

    -- Append audit row. job_completion_events.completed_at uses
    -- v_completed_at so the log moment matches the jobs row moment
    -- exactly (reopen_job reads this row later to mark reopened_at).
    INSERT INTO job_completion_events (
        company_id, job_id, completed_at, completed_by, notes
    ) VALUES (
        v_caller_company, p_job_id, v_completed_at, v_caller_user, p_notes
    )
    RETURNING id INTO v_event_id;

    RETURN jsonb_build_object(
        'job_id',             p_job_id,
        'completed_at',       v_completed_at,
        'auto_pulled_count',  v_auto_pulled_count,
        'completion_event_id', v_event_id
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION complete_job(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION complete_job(UUID, TEXT) IS
    'Mark job complete: transition status to ''complete'', stamp '
    'completed_at, auto-pull active equipment, append audit row. Spec '
    '01H Phase 3 PR-B2 Step 6.';


-- ============================================================================
-- reopen_job — owner-only. Reverts status, clears stamps, logs reopen.
-- ============================================================================
CREATE OR REPLACE FUNCTION reopen_job(
    p_job_id  UUID,
    p_reason  TEXT
) RETURNS JSONB AS $$
DECLARE
    v_caller_company     UUID;
    v_caller_user        UUID;
    v_caller_role        TEXT;
    v_current_status     TEXT;
    v_job_type           TEXT;
    v_target_status      TEXT;
    v_prev_completed_at  TIMESTAMPTZ;
    v_reopened_at        TIMESTAMPTZ;
    v_event_id           UUID;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id is required';
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_reason is required — reopen must be logged with a reason';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    -- Role check. users.role column has two values: 'owner' or
    -- 'employee' (bootstrap migration 001). Only owner can reopen.
    SELECT id, role INTO v_caller_user, v_caller_role
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF v_caller_user IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Caller not found in users table';
    END IF;
    IF v_caller_role <> 'owner' THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Only the company owner can reopen a completed job';
    END IF;

    -- Current state must be 'complete'. Reopening from 'submitted'
    -- or 'collected' requires going through those states' own undo
    -- flows (which we don't ship here). Reopening from 'drying' or
    -- earlier is a no-op — there's nothing to reopen from.
    --
    -- Round-1 review HIGH #1 — also read job_type so we can pick a
    -- target status that's VALID for the job type. Original code
    -- hardcoded 'drying' which is mitigation-only; reconstruction jobs
    -- have no 'drying' stage and the subsequent UPDATE would fail the
    -- jobs_status_check CHECK constraint.
    --
    -- Out-of-scope #1 fix — filter by deleted_at IS NULL so a
    -- soft-deleted job can't be reopened.
    SELECT status, job_type, completed_at
      INTO v_current_status, v_job_type, v_prev_completed_at
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF v_current_status IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or not accessible';
    END IF;
    IF v_current_status <> 'complete' THEN
        RAISE EXCEPTION USING ERRCODE = '55006',
                    MESSAGE = 'Only complete jobs can be reopened (current status: ' || v_current_status || ')';
    END IF;

    -- HIGH #1 — pick the reopen target status per job type.
    -- Mitigation jobs resume in 'drying' (active moisture work).
    -- Reconstruction jobs resume in 'in_progress' (active build work).
    -- Both are valid values in the jobs_status_check CHECK constraint
    -- and in their respective job-type allowlist in Python
    -- (MITIGATION_STATUSES / RECONSTRUCTION_STATUSES).
    v_target_status := CASE v_job_type
        WHEN 'mitigation'     THEN 'drying'
        WHEN 'reconstruction' THEN 'in_progress'
        ELSE NULL
    END;
    IF v_target_status IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'Unknown job_type ' || COALESCE(v_job_type, '<NULL>') || ' — reopen cannot pick a target status';
    END IF;

    v_reopened_at := now();

    -- Revert status + clear current completion stamps. chk_completed_pair
    -- requires both stamps to flip together, so this single UPDATE
    -- satisfies the constraint.
    UPDATE jobs
       SET status       = v_target_status,
           completed_at = NULL,
           completed_by = NULL,
           updated_at   = v_reopened_at
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    -- Stamp the latest completion event row (the one whose
    -- completed_at matches v_prev_completed_at — there may be older
    -- rows for prior completion cycles, we want only the active one).
    --
    -- Round-1 review MEDIUM #2 — FOR UPDATE on the inner SELECT so two
    -- concurrent reopens on the same job serialize. Without the lock,
    -- both reopens could read the same open-event row's id, both
    -- UPDATEs succeed, and the later write's reopen_reason /
    -- reopened_by overwrites the earlier one. The row-lock queues the
    -- second call behind the first; when it unblocks, the row's
    -- reopened_at IS NOT NULL so the inner SELECT returns zero rows
    -- and the outer UPDATE's WHERE id IS NULL matches nothing → our
    -- defensive "audit log out of sync" branch below fires and the
    -- second caller learns the first one won.
    UPDATE job_completion_events
       SET reopened_at   = v_reopened_at,
           reopened_by   = v_caller_user,
           reopen_reason = p_reason
     WHERE id = (
         SELECT id FROM job_completion_events
          WHERE job_id = p_job_id
            AND reopened_at IS NULL
          ORDER BY completed_at DESC
          LIMIT 1
          FOR UPDATE
     )
    RETURNING id INTO v_event_id;

    -- Defensive: if no matching event row found, the audit log is
    -- out of sync with the jobs table. Raise loud — this is a bug.
    IF v_event_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55006',
                    MESSAGE = 'No open completion event found for this job — audit log out of sync';
    END IF;

    -- Note: we intentionally do NOT un-pull equipment. Pulled rows
    -- stay pulled with their existing pulled_at timestamps. Billing
    -- for that span is frozen in place. If the tech resumes a unit,
    -- they call restart_equipment_placement which creates a new row.

    RETURN jsonb_build_object(
        'job_id',                 p_job_id,
        'reopened_at',            v_reopened_at,
        'previous_completed_at',  v_prev_completed_at,
        'completion_event_id',    v_event_id
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION reopen_job(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION reopen_job(UUID, TEXT) IS
    'Owner-only reopen of a complete job. Reverts status to '
    '''drying'', clears completed_at/completed_by, stamps reopened_at '
    'on the latest completion event. Does NOT un-pull equipment. '
    'Spec 01H Phase 3 PR-B2 Step 6.';
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS reopen_job(UUID, TEXT);
DROP FUNCTION IF EXISTS complete_job(UUID, TEXT);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
