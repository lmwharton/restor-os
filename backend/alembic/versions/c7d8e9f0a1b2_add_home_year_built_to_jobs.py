"""add_home_year_built_to_jobs

Revision ID: c7d8e9f0a1b2
Revises: 785e9f316e2b
Create Date: 2026-04-08

Adds home_year_built column to jobs table for lead/asbestos hazmat flagging.
"""
from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: str | None = "785e9f316e2b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add home_year_built integer column to jobs."""
    op.execute("""
        ALTER TABLE jobs
        ADD COLUMN IF NOT EXISTS home_year_built INTEGER;
    """)
    op.execute("""
        COMMENT ON COLUMN jobs.home_year_built
        IS 'Year the home was built — used for lead-based paint (pre-1978) and asbestos (pre-1980s) hazmat flagging';
    """)


def downgrade() -> None:
    """Remove home_year_built column."""
    op.execute("ALTER TABLE jobs DROP COLUMN IF EXISTS home_year_built;")
