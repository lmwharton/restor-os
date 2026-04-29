"""Spec 01K Phase 6 — re-emit floor-plan RPCs with corrected archived check.

The 01H floor-plan RPCs (`ensure_job_floor_plan`, `save_floor_plan_version`,
`rollback_floor_plan_version_atomic`) were originally written when the
terminal archived status was just `'collected'`. Spec 01K renamed the column
to `'paid'` and **added two more archived statuses**: `'cancelled'` and
`'lost'`. The historical 01H migrations were patched in-place (so fresh
installs get the corrected check) but **existing deployments still have the
old paid-only check installed in pg_proc**. This migration re-emits the
three RPCs so deployed databases pick up the corrected check too.

Source of truth: the UPGRADE_SQL strings on the historical migration
modules (which we just updated to use `IN ('paid', 'cancelled', 'lost')`).
Importing them here avoids duplicating ~300 lines of plpgsql and keeps
fresh-install + upgrade paths in sync.

Caught by Copilot review on PR #18 — the DB-level archived guard was
inconsistent with `api/shared/constants.py` ARCHIVED_JOB_STATUSES.

Revision ID: 01k_a3_archive_checks
Revises: 01k_a2_lock_rpc_search_path
Create Date: 2026-04-28

"""

import importlib.util
from pathlib import Path

from alembic import op


revision = "01k_a3_archive_checks"
down_revision = "01k_a2_lock_rpc_search_path"
branch_labels = None
depends_on = None


HISTORICAL_RPC_MIGRATIONS = (
    "b8c9d0e1f2a3_spec01h_ensure_job_floor_plan_rpc.py",
    "c9d0e1f2a3b4_spec01h_etag_into_save_and_rollback_rpc.py",
    "f6a9b0c1d2e3_spec01h_rollback_atomic_wrapper.py",
)


def _load_upgrade_sql(filename: str) -> str:
    """Import a sibling migration file and pull its UPGRADE_SQL constant.

    We deliberately do NOT call its `upgrade()` function — Alembic's
    revision graph would get confused. We just need the SQL string so we
    can re-run the function definitions through `op.execute`.
    """
    versions_dir = Path(__file__).parent
    path = versions_dir / filename
    spec = importlib.util.spec_from_file_location(f"_hist_{filename}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load historical migration: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "UPGRADE_SQL"):
        raise RuntimeError(f"{filename} does not expose UPGRADE_SQL at module level")
    return module.UPGRADE_SQL


def upgrade() -> None:
    for filename in HISTORICAL_RPC_MIGRATIONS:
        op.execute(_load_upgrade_sql(filename))


def downgrade() -> None:
    # No clean downgrade — reverting to the paid-only check would re-introduce
    # the consistency bug. If someone really wants to roll back, they can
    # apply the older UPGRADE_SQL by hand. Mark this as a one-way migration.
    pass
