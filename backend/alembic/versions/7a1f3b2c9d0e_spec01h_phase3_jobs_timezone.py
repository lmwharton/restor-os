"""Spec 01H Phase 3 (PR-A, Step 1): add jobs.timezone for local-day billing math.

Phase 3's equipment-billing formula counts distinct local calendar days in the
job's timezone. Without a stored timezone, billable days silently miscount by
up to one per span boundary for any job outside ``America/New_York`` — a span
from 11 PM PT Monday to 1 AM PT Tuesday crosses 2 local days but 4 UTC days,
overbilling PT/MT/CT jobs.

This migration is additive only. It does NOT change any existing code path.
A NOT NULL column with a default is chosen so existing rows backfill to
``'America/New_York'`` automatically — an acceptable V1 default until PR-D
wires a zip-based resolver into the job-create flow (Spec 01F hook).

Revision ID: 7a1f3b2c9d0e
Revises: f1e2d3c4b5a6
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7a1f3b2c9d0e"
down_revision: str | None = "f1e2d3c4b5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
ALTER TABLE jobs
    ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York';

COMMENT ON COLUMN jobs.timezone IS
    'IANA timezone for this job. Drives distinct-local-calendar-day billing math '
    'for Spec 01H Phase 3 equipment placements. Default America/New_York; future: '
    'resolve from property zip at job-create (Spec 01F hook, PR-D).';
"""


DOWNGRADE_SQL = """
ALTER TABLE jobs DROP COLUMN timezone;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
