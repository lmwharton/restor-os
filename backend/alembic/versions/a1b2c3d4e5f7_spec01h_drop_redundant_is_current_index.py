"""Spec 01H PR10 round-2 (R13): drop redundant non-unique is_current index.

``idx_floor_plans_is_current`` (from e1a7c9b30201) is a non-unique partial
index on ``(property_id, floor_number) WHERE is_current = true``.
``idx_floor_plans_current_unique`` (from a1f2b9c4e5d6) covers the same
columns with the same predicate plus UNIQUE. Postgres will always prefer
the unique index for reads, so the non-unique one is dead weight —
INSERT/UPDATE pay an extra index write for no read benefit.

Revision ID: a1b2c3d4e5f7
Revises: f0a1b2c3d4e5
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a1b2c3d4e5f7"
down_revision: str | None = "f0a1b2c3d4e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_floor_plans_is_current;")


def downgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_floor_plans_is_current
            ON floor_plans(property_id, floor_number)
            WHERE is_current = true;
        """
    )
