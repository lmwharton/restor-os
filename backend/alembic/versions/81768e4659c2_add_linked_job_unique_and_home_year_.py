"""add_linked_job_unique_and_home_year_check

Revision ID: 81768e4659c2
Revises: e62979fbcd17
Create Date: 2026-04-09 22:26:24.599734

"""
from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '81768e4659c2'
down_revision: str | None = 'e62979fbcd17'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Codex #2: Prevent duplicate reconstruction jobs linked to the same mitigation job
    op.execute("""
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_linked_job_unique
  ON jobs(linked_job_id) WHERE linked_job_id IS NOT NULL AND deleted_at IS NULL;
    """)

    # I3: DB-level CHECK constraint for home_year_built
    op.execute("""
ALTER TABLE jobs ADD CONSTRAINT chk_home_year_built
  CHECK (home_year_built IS NULL OR (home_year_built >= 1600 AND home_year_built <= 2100));
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_jobs_linked_job_unique")
    op.execute("ALTER TABLE jobs DROP CONSTRAINT IF EXISTS chk_home_year_built")
