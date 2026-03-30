"""add_jobs_fulltext_search_index

Revision ID: a1b2c3d4e5f6
Revises: 8fb2083bb9c9
Create Date: 2026-03-30
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "8fb2083bb9c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
-- Generated tsvector column for full-text search on jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(address_line1, '') || ' ' ||
      coalesce(customer_name, '') || ' ' ||
      coalesce(job_number, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(carrier, '') || ' ' ||
      coalesce(claim_number, '')
    )
  ) STORED;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_jobs_search ON jobs USING gin(search_vector);

-- Btree index on status for dashboard pipeline aggregation
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status) WHERE deleted_at IS NULL;
""")


def downgrade() -> None:
    op.execute("""
DROP INDEX IF EXISTS idx_jobs_status;
DROP INDEX IF EXISTS idx_jobs_search;
ALTER TABLE jobs DROP COLUMN IF EXISTS search_vector;
""")
