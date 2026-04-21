"""Spec 01H PR10 round-2 (R4 belt-and-suspenders): DB-level frozen-version
immutability trigger.

Round-2 R4 fixed the two application-level read-then-write TOCTOUs by adding
``.eq("is_current", True)`` to the UPDATE filters in ``update_floor_plan``
and ``cleanup_floor_plan``. The reviewer flagged a defense-in-depth option:
enforce the same "frozen rows are immutable" rule at the database level so
any future caller that forgets the filter is still caught.

This migration adds a BEFORE UPDATE trigger on ``floor_plans`` that raises
if the OLD row had ``is_current = false``. The only legitimate mutation of
a row that will become frozen is the flip inside the ``save_floor_plan_version``
RPC — and that flip targets rows where ``OLD.is_current = true`` (it's the
statement *performing* the flip, not one following it), so it passes the
check naturally without needing any trigger bypass.

Consequences:
* Application paths that already filter ``is_current=true`` (save_canvas
  Case 2, update_floor_plan, cleanup_floor_plan, the RPC's flip) keep
  working with no change.
* Any UPDATE whose target row is already frozen raises SQLSTATE 42501 with
  the message below. Callers treat this the same as zero-row VERSION_FROZEN.
* INSERT, DELETE, and SELECT are unaffected.

Revision ID: d8e9f0a1b2c3
Revises: c7f8a9b0d1e2
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "d8e9f0a1b2c3"
down_revision: str | None = "c7f8a9b0d1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION floor_plans_prevent_frozen_mutation()
RETURNS TRIGGER AS $$
BEGIN
    -- OLD.is_current = false ⇒ this row was already flipped off current and
    -- is frozen history. Reject the UPDATE unconditionally. The legitimate
    -- flip statement inside save_floor_plan_version moves OLD.is_current
    -- from true to false in one step, so it never reaches this branch.
    IF OLD.is_current IS FALSE THEN
        RAISE EXCEPTION 'floor_plans version is frozen (is_current=false)'
              USING ERRCODE = '42501',
                    MESSAGE = 'Cannot mutate a frozen floor_plans version. Create a new version via save_floor_plan_version instead.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog, public;

-- Alphabetically ordered so this trigger runs BEFORE
-- trg_floor_plans_updated_at — we want the frozen check to short-circuit
-- before the timestamp trigger mutates NEW.updated_at.
-- DROP IF EXISTS so the migration is re-runnable (e.g. after a manual SQL
-- apply via scripts/pr10_round2_apply.sql before alembic catches up).
DROP TRIGGER IF EXISTS trg_floor_plans_prevent_frozen_mutation ON floor_plans;
CREATE TRIGGER trg_floor_plans_prevent_frozen_mutation
    BEFORE UPDATE ON floor_plans
    FOR EACH ROW
    EXECUTE FUNCTION floor_plans_prevent_frozen_mutation();
"""

DOWNGRADE_SQL = """
DROP TRIGGER IF EXISTS trg_floor_plans_prevent_frozen_mutation ON floor_plans;
DROP FUNCTION IF EXISTS floor_plans_prevent_frozen_mutation();
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
