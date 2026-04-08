"""add_notifications_seen_to_users

Revision ID: c5e8f1a2b3d4
Revises: 93a19ccbfe45
Create Date: 2026-04-07

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5e8f1a2b3d4"
down_revision: str | None = "93a19ccbfe45"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_notifications_seen_at TIMESTAMPTZ"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE users DROP COLUMN IF EXISTS last_notifications_seen_at"
    )
