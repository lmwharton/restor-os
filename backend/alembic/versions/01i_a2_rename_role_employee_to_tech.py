"""Spec 01I (Onboarding): rename users.role 'employee' to 'tech'.

Spec 00 bootstrap shipped with CHECK (role IN ('owner', 'employee')). Brett's
PRD uses 'tech' (matches contractor terminology). Pre-launch, no production
data — cheap migration. Avoids ongoing app-layer aliasing.

Strategy:
1. Drop the old CHECK constraint.
2. UPDATE rows: 'employee' -> 'tech'.
3. Add new CHECK (role IN ('owner', 'tech')).

The constraint name from bootstrap is the postgres default
``users_role_check`` — re-derive on downgrade.

Revision ID: 01i_a2_rename_role
Revises: 01i_a1_service_area
Create Date: 2026-04-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "01i_a2_rename_role"
down_revision: str | None = "01i_a1_service_area"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            -- Drop the existing role check constraint (default name from bootstrap)
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE conname = 'users_role_check'
                   AND conrelid = 'public.users'::regclass
            ) THEN
                ALTER TABLE users DROP CONSTRAINT users_role_check;
            END IF;
        END$$;

        UPDATE users SET role = 'tech' WHERE role = 'employee';

        -- Update the column default if it was 'employee' (it shouldn't be —
        -- bootstrap defaults to 'owner' — but be defensive).
        ALTER TABLE users ALTER COLUMN role SET DEFAULT 'owner';

        ALTER TABLE users
            ADD CONSTRAINT users_role_check
            CHECK (role IN ('owner', 'tech'));
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE conname = 'users_role_check'
                   AND conrelid = 'public.users'::regclass
            ) THEN
                ALTER TABLE users DROP CONSTRAINT users_role_check;
            END IF;
        END$$;

        UPDATE users SET role = 'employee' WHERE role = 'tech';

        ALTER TABLE users
            ADD CONSTRAINT users_role_check
            CHECK (role IN ('owner', 'employee'));
        """
    )
