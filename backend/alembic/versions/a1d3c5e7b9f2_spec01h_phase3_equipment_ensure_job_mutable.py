"""Spec 01H Phase 3 PR-B Step 1: ensure_job_mutable plpgsql twin.

Mirrors the Python guard at ``backend/api/shared/guards.py:33``. Every
PR-B equipment RPC (``place_equipment_with_pins``, ``move_equipment_placement``,
``archive_moisture_pin`` amendment, etc.) calls this twin at the top so
the archive + tenant check happens INSIDE the RPC's transaction, not in
a pre-flight Python step that could race with a concurrent status flip.

Semantics match the Python guard exactly:
  - Job must exist + belong to caller's company (else ``P0002``).
  - Job must not be soft-deleted (``deleted_at IS NULL``, else ``P0002``).
  - Job status must not be in ``ARCHIVED_JOB_STATUSES`` (currently only
    ``'collected'``, else ``42501``).

Contract:
  PERFORM ensure_job_mutable(p_job_id);

Raises with SQLSTATE the Python layer can catch:
  - ``P0002`` (undefined_object) for not-found / cross-tenant / soft-deleted.
    Matches ``save_floor_plan_version``'s "Job not found on this property"
    raise (lesson §5 — pick SQLSTATEs distinct from sibling catches).
  - ``42501`` (insufficient_privilege) for archived job. Same code as the
    existing floor-plan archive guards so the Python catch can unify.

Tenant is derived from the JWT via ``get_my_company_id()``; no
``p_company_id`` param is accepted. Lesson §3/C4 — SECURITY DEFINER
functions must not trust caller-supplied tenant.

Why the twin must be plpgsql, not a Python pre-check (lesson #4):
A Python guard runs before the RPC fires, leaving a TOCTOU window where
a sibling process could archive the job between "guard passed" and
"insert happens". Putting the guard inside the RPC's transaction closes
the window — the check and the write commit or roll back together.

Revision ID: a1d3c5e7b9f2
Revises: f4c7e1b9a5d2
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1d3c5e7b9f2"
down_revision: str | None = "f4c7e1b9a5d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION ensure_job_mutable(p_job_id UUID)
RETURNS VOID AS $$
DECLARE
    v_caller_company UUID;
    v_status         TEXT;
BEGIN
    -- NULL param guard — matches the §3 defensive pattern used by every
    -- sibling RPC in Phase 1 (save_floor_plan_version, rollback_atomic).
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id is required';
    END IF;

    -- Tenant from JWT, never from a param. Lesson §3 / C4.
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company — JWT did not resolve to a users row';
    END IF;

    -- Fetch status scoped to caller's tenant. A cross-tenant job_id OR
    -- a soft-deleted row both collapse into NOT FOUND so the response
    -- doesn't leak the existence of another company's data.
    SELECT status INTO v_status
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or not accessible to caller';
    END IF;

    -- Archive guard. ARCHIVED_JOB_STATUSES is a single value today
    -- (``collected``) per backend/api/shared/constants.py. If new
    -- statuses join that set in Python, ADD THEM HERE TOO — the two
    -- lists must stay in lock-step. Lesson #25 pattern: don't let the
    -- plpgsql twin and the Python guard drift.
    IF v_status IN ('collected') THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Cannot modify floor plan data for an archived job';
    END IF;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION ensure_job_mutable(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION ensure_job_mutable(UUID) IS
    'Spec 01H Phase 3 PR-B Step 1: archive + tenant guard used by every '
    'equipment RPC. Mirror of Python api.shared.guards.ensure_job_mutable. '
    'Raises P0002 for not-found/cross-tenant, 42501 for archived. Keep '
    'archived-status list in sync with ARCHIVED_JOB_STATUSES constant.';
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS ensure_job_mutable(UUID);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
