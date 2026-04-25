"""Spec 01H Phase 3 PR-B2 Step 4: job_completion_events audit table.

Insert-only append log of "tech marked this job complete" moments, with
follow-up stamps for subsequent reopen. ``jobs.status`` + ``jobs.completed_at``
tell us the CURRENT state; this table preserves the FULL HISTORY of
every completion cycle even when a reopen wipes ``jobs.completed_at``
back to NULL.

Why a separate table vs. a single snapshot on jobs:

The product wants the "Mark Job Complete" action to be reversible
(admin can reopen if customer calls back and drying needs to continue).
Reopen flips jobs.status = 'drying' + clears completed_at, so the
snapshot-on-jobs approach loses the first completion moment the
second you reopen. An append log preserves every completion + every
reopen reason. Downstream consumers (customer-success export, audit
report, carrier documentation) read the history; the jobs row only
needs to answer "is this currently open or closed."

Schema highlights:

- ``job_id ON DELETE CASCADE`` — when a job is hard-deleted, its
  completion log goes with it. Soft delete (deleted_at) preserves
  the log, which is the expected path.
- ``completed_at`` is NOT NULL — every row represents one actual
  completion moment.
- ``reopened_at`` is NULL while this row is the current active
  completion; set the moment an admin reopens. Once reopened, this
  row is historical — the next complete_job creates a NEW row rather
  than updating this one.
- ``reopen_reason`` is TEXT (not enum) — reasons vary too much to
  pre-enumerate ("customer called back", "insurance flagged",
  "moisture returned"). Free-text with UI-side prompting is fine.
- ``CHECK (reopened_at IS NULL OR reopened_at > completed_at)`` —
  can't reopen before you completed. Physical impossibility; loud-
  fail (lesson §7).
- Index on ``(job_id, completed_at DESC)`` — the hot read pattern
  is "latest completion for this job" (for UI + for the reopen RPC
  which finds the row to stamp reopened_at on). DESC lets the index
  serve that query with a LIMIT 1 forward scan.

RLS + write path:

- Policy ``jce_tenant`` restricts SELECT to same-company rows via
  ``get_my_company_id()`` — standard Phase 1 shape.
- INSERT path is ONLY via ``complete_job`` RPC (Step 6). Direct
  INSERTs via REST would bypass the status-flip + auto-pull logic
  that makes a completion meaningful. We don't add a hard block;
  the application-layer contract is that consumers call the RPC.
- UPDATE path is ONLY for ``reopened_at / reopened_by / reopen_reason``
  columns via ``reopen_job`` RPC (Step 6).

Revision ID: d4a5b6c7e8f9
Revises: d3a4b5c6e7f8
Create Date: 2026-04-25
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4a5b6c7e8f9"
down_revision: str | None = "d3a4b5c6e7f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE TABLE job_completion_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_id          UUID NOT NULL REFERENCES jobs(id)      ON DELETE CASCADE,
    completed_at    TIMESTAMPTZ NOT NULL,
    completed_by    UUID REFERENCES users(id),
    reopened_at     TIMESTAMPTZ,
    reopened_by     UUID REFERENCES users(id),
    reopen_reason   TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Physical ordering invariant.
    CONSTRAINT chk_reopen_after_complete CHECK (
        reopened_at IS NULL OR reopened_at > completed_at
    )
);

-- Hot read pattern: "latest completion event for this job." DESC lets
-- the reopen RPC + UI lookup serve via one-row forward scan.
CREATE INDEX idx_job_completions_job
    ON job_completion_events(job_id, completed_at DESC);

-- Company-level scan for admin dashboards (optional, cheap on the
-- expected row-count scale — typical job has 1-2 completion events).
CREATE INDEX idx_job_completions_company
    ON job_completion_events(company_id, completed_at DESC);

-- RLS — same shape as every Phase 1/2/3 tenant-scoped table.
ALTER TABLE job_completion_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY jce_tenant ON job_completion_events USING (
    company_id = get_my_company_id()
);

COMMENT ON TABLE job_completion_events IS
    'Append-only audit log of "job marked complete" moments plus their '
    'subsequent reopen stamps. Preserves full completion history across '
    'reopen cycles that wipe jobs.completed_at. Spec 01H Phase 3 PR-B2 Step 4.';

COMMENT ON COLUMN job_completion_events.reopened_at IS
    'NULL while this row is the current open completion. Set when the '
    'job is reopened. Once set, a later complete_job creates a NEW row '
    'rather than updating this one — this column is historical state.';

COMMENT ON COLUMN job_completion_events.reopen_reason IS
    'Free-text reason an admin gave when reopening. Surfaced in audit '
    'views. Not enum because causes vary (customer request, insurance '
    'flag, moisture returned, mistake).';
"""


DOWNGRADE_SQL = """
DROP POLICY IF EXISTS jce_tenant ON job_completion_events;
DROP INDEX IF EXISTS idx_job_completions_company;
DROP INDEX IF EXISTS idx_job_completions_job;
DROP TABLE IF EXISTS job_completion_events;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
