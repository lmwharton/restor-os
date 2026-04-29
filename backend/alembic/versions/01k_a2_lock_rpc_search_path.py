"""Spec 01K Phase 5 — lock search_path on lifecycle + closeout-seed RPCs.

`rpc_update_job_status` and `rpc_seed_closeout_settings` were created in
01k_a1 as SECURITY DEFINER without `SET search_path`. Per the codebase's
established convention (see `rpc_create_jobs_batch`, `rpc_onboard_user`),
SECURITY DEFINER functions MUST pin search_path so a malicious `pg_temp`
schema can't shadow built-ins like `format()`, `now()`,
`gen_random_uuid()`, or `jsonb_array_elements()`.

Caught by /feature-validator's DB track (D9 finding). This migration
uses ALTER FUNCTION rather than CREATE OR REPLACE — no need to re-emit
the function bodies (which are 80+ lines of plpgsql each), the runtime
ALTER is enough to attach the SET clause.

Revision ID: 01k_a2_lock_rpc_search_path
Revises: 01k_a1_lifecycle_status
Create Date: 2026-04-28

"""

from alembic import op


revision = "01k_a2_lock_rpc_search_path"
down_revision = "01k_a1_lifecycle_status"
branch_labels = None
depends_on = None


# Argument signatures must exactly match what 01k_a1 created — Postgres looks
# up functions by (name, arg-types). One signature per RPC.
RPC_UPDATE_JOB_STATUS_SIG = (
    "rpc_update_job_status("
    "p_job_id UUID, p_company_id UUID, p_user_id UUID, "
    "p_target_status TEXT, p_expected_current_status TEXT, "
    "p_event_type TEXT, p_event_data JSONB, p_timestamp_field TEXT, "
    "p_increment_dispute_count BOOLEAN, "
    "p_on_hold_reason TEXT, p_on_hold_resume_date DATE, "
    "p_cancel_reason TEXT, p_cancel_reason_other TEXT, p_dispute_reason TEXT)"
)

RPC_SEED_CLOSEOUT_SETTINGS_SIG = "rpc_seed_closeout_settings(p_company_id UUID)"


def upgrade() -> None:
    op.execute(
        f"ALTER FUNCTION {RPC_UPDATE_JOB_STATUS_SIG} "
        "SET search_path = pg_catalog, public;"
    )
    op.execute(
        f"ALTER FUNCTION {RPC_SEED_CLOSEOUT_SETTINGS_SIG} "
        "SET search_path = pg_catalog, public;"
    )


def downgrade() -> None:
    # Undo the lock — RESET search_path returns to the role's default.
    op.execute(
        f"ALTER FUNCTION {RPC_UPDATE_JOB_STATUS_SIG} RESET search_path;"
    )
    op.execute(
        f"ALTER FUNCTION {RPC_SEED_CLOSEOUT_SETTINGS_SIG} RESET search_path;"
    )
