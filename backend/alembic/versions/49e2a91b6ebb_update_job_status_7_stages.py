"""Update job status to industry-standard 7-stage pipeline.

Revision ID: 49e2a91b6ebb
Revises: ca59c5bf87c9
Create Date: 2026-03-26

Old: needs_scope | scoped | submitted
New: new | contracted | mitigation | drying | job_complete | submitted | collected

Migrates existing data:
  needs_scope → new
  scoped → mitigation
  submitted → submitted (unchanged)
"""

from collections.abc import Sequence

from alembic import op

revision: str = "49e2a91b6ebb"
down_revision: str | None = "ca59c5bf87c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
-- 1. Migrate existing status values to new stages
UPDATE jobs SET status = 'new' WHERE status = 'needs_scope';
UPDATE jobs SET status = 'mitigation' WHERE status = 'scoped';

-- 2. Drop old CHECK constraint and add new one
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
    CHECK (status IN ('new', 'contracted', 'mitigation', 'drying', 'job_complete', 'submitted', 'collected'));
    """)


def downgrade() -> None:
    op.execute("""
-- Reverse: map new stages back to old 3-stage flow
UPDATE jobs SET status = 'needs_scope' WHERE status IN ('new', 'contracted');
UPDATE jobs SET status = 'scoped' WHERE status IN ('mitigation', 'drying', 'job_complete');
-- 'submitted' stays as-is
UPDATE jobs SET status = 'submitted' WHERE status = 'collected';

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
    CHECK (status IN ('needs_scope', 'scoped', 'submitted'));
    """)
