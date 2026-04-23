"""Spec 01H PR10 round-2 (R18): document wall_openings.swing mapping.

The column is declared ``swing INTEGER CHECK IN (0, 1, 2, 3)`` — four
possible values with no DB-level indication of what they mean. Reading
``\\d+ wall_openings`` today shows the check constraint but leaves the
semantic mapping invisible. Future devs have to grep the frontend
(``floor-plan-tools.ts``) to decode each integer.

Attach a COMMENT ON COLUMN so psql's describe output carries the
mapping. The values encode hinge side × swing direction quadrants,
matching ``FloorOpeningData.swing`` in the frontend type.

Revision ID: d4e5f8a9b0c1
Revises: c3d4e5f8a9b0
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d4e5f8a9b0c1"
down_revision: str | None = "c3d4e5f8a9b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
COMMENT ON COLUMN wall_openings.swing IS
    'Door hinge + swing quadrant. 0=hinge-left-swing-up, 1=hinge-left-swing-down, '
    '2=hinge-right-swing-down, 3=hinge-right-swing-up. Cycles on re-tap via (swing+1)%4. '
    'Source of truth: FloorOpeningData.swing in web/src/components/sketch/floor-plan-tools.ts. '
    'NULL for windows / missing walls (doors only).';
"""

DOWNGRADE_SQL = """
-- Note: this downgrade CLEARS the comment (sets it to NULL) rather than
-- restoring a prior comment — because this column had no comment before
-- this migration. If you clone this pattern for a column that DID have
-- a prior comment, explicitly re-attach that prior text here so the
-- downgrade is a true round-trip.
COMMENT ON COLUMN wall_openings.swing IS NULL;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
