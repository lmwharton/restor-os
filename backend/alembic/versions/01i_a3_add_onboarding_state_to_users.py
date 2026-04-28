"""Spec 01I (Onboarding): per-user onboarding state on users.

Decision Log #4: state lives on users, not companies. An invited team member
should not be trapped behind the owner's company-setup wizard.

Decision Log #5: completion booleans (has_jobs, has_pricing) are server-derived
from real data via EXISTS queries. Only step + setup_banner_dismissed_at are
user-asserted flags.

New columns on users:
- onboarding_step TEXT DEFAULT 'company_profile'
    CHECK (onboarding_step IN ('company_profile', 'jobs_import', 'pricing',
                               'first_job', 'complete'))
- onboarding_completed_at TIMESTAMPTZ
- setup_banner_dismissed_at TIMESTAMPTZ

Revision ID: 01i_a3_onboarding_state
Revises: 01i_a2_rename_role
Create Date: 2026-04-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "01i_a3_onboarding_state"
down_revision: str | None = "01i_a2_rename_role"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS onboarding_step TEXT
                NOT NULL DEFAULT 'company_profile',
            ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS setup_banner_dismissed_at TIMESTAMPTZ;

        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE conname = 'users_onboarding_step_check'
                   AND conrelid = 'public.users'::regclass
            ) THEN
                ALTER TABLE users
                    ADD CONSTRAINT users_onboarding_step_check
                    CHECK (onboarding_step IN (
                        'company_profile', 'jobs_import', 'pricing',
                        'first_job', 'complete'
                    ));
            END IF;
        END$$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE conname = 'users_onboarding_step_check'
                   AND conrelid = 'public.users'::regclass
            ) THEN
                ALTER TABLE users DROP CONSTRAINT users_onboarding_step_check;
            END IF;
        END$$;

        ALTER TABLE users
            DROP COLUMN IF EXISTS setup_banner_dismissed_at,
            DROP COLUMN IF EXISTS onboarding_completed_at,
            DROP COLUMN IF EXISTS onboarding_step;
        """
    )
