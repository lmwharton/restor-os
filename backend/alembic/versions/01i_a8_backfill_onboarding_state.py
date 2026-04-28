"""Spec 01I — backfill ``onboarding_step`` and ``onboarding_completed_at`` for
existing users that already have a company.

Migration ``01i_a3_add_onboarding_state_to_users`` introduced the column with
a default of ``'company_profile'`` for every row. Pre-launch this is fine —
no real users — but Brett, the Crewmatic team's test accounts, and any
already-onboarded staging users get bounced back into Step 1 of the wizard
on next login because the protected layout's gate reads
``onboarding_step != 'complete'``. Set them to ``'complete'`` so the gate
respects their existing setup, with ``onboarding_completed_at`` stamped to
their account creation time.

Found via post-implementation code review.

Revision ID: 01i_a8_backfill_onboarding_state
Revises: 01i_a7_harden_rpc_search_path
Create Date: 2026-04-27
"""

from alembic import op

revision = "01i_a8_backfill_onboarding_state"
down_revision = "01i_a7_harden_rpc_search_path"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Any user with a company_id by definition completed at least Step 1.
    # Stamp them as 'complete' with completion timestamp = created_at so
    # the protected-layout gate doesn't bounce them.
    op.execute(
        """
        UPDATE users
        SET onboarding_step = 'complete',
            onboarding_completed_at = COALESCE(onboarding_completed_at, created_at, now())
        WHERE company_id IS NOT NULL
          AND deleted_at IS NULL
          AND onboarding_step <> 'complete';
        """
    )


def downgrade() -> None:
    # No clean inverse — we don't know which users we'd have to flip back.
    # Reset all complete rows to 'company_profile' so a re-upgrade can
    # discriminate cleanly.
    op.execute(
        """
        UPDATE users
        SET onboarding_step = 'company_profile',
            onboarding_completed_at = NULL
        WHERE deleted_at IS NULL
          AND onboarding_step = 'complete';
        """
    )
