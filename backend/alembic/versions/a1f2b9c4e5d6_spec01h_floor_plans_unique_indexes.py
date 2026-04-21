"""Spec 01H: partial unique indexes on floor_plans (C2 fix).

Migration e1a7c9b30201 merged the old floor_plans container with
floor_plan_versions and recreated indexes on the unified table. But it
recreated them as plain (non-unique) partial indexes, removing the
uniqueness guarantee the old schema enforced via UNIQUE(floor_plan_id,
version_number).

With no uniqueness barrier, _create_version has a flip-then-insert race:
two concurrent saves from mitigation + recon on the same floor can both
read the same max version_number, both flip is_current=false (each sees
zero committed rows from the other), and both INSERT the new row with
the same version_number AND is_current=true. The result is two rows
claiming to be the current version of that floor — downstream queries
become non-deterministic.

This migration adds the two partial unique indexes that make the race
self-resolving: the losing writer's INSERT raises UniqueViolation, the
service layer converts it to 409 CONCURRENT_EDIT, and the client retries.
The retry re-enters save_canvas, sees its pinned row is no longer
is_current, and takes Case 3 (fork) cleanly.

Revision ID: a1f2b9c4e5d6
Revises: e1a7c9b30201
Create Date: 2026-04-21
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1f2b9c4e5d6"
down_revision: str | None = "e1a7c9b30201"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- Only one is_current=true row per (property, floor). The losing writer's
-- INSERT in a concurrent save race raises 23505 unique_violation here.
CREATE UNIQUE INDEX idx_floor_plans_current_unique
    ON floor_plans(property_id, floor_number)
    WHERE is_current = true;

-- Only one row per (property, floor, version_number). Same purpose:
-- the losing writer's INSERT with the stale next_number fails fast
-- instead of creating a duplicate v_N row in version history.
CREATE UNIQUE INDEX idx_floor_plans_version_unique
    ON floor_plans(property_id, floor_number, version_number);
"""

DOWNGRADE_SQL = """
DROP INDEX IF EXISTS idx_floor_plans_version_unique;
DROP INDEX IF EXISTS idx_floor_plans_current_unique;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
