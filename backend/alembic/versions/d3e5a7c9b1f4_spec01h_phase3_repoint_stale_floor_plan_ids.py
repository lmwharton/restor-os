"""Spec 01H Phase 3 (PR-A, Step 3 follow-up): repoint stale floor_plan_id stamps.

Lesson #25 regression — denormalized truth drift:

When a floor plan forks a new version (save_canvas Case 3), the downstream
tables that hold a ``floor_plan_id`` stamp are NOT automatically retargeted
to the new ``is_current`` row. Specifically:

* ``job_rooms.floor_plan_id`` — set at room creation, never refreshed on
  a sibling job's fork.
* ``moisture_pins.floor_plan_id`` — Step 2 of this phase backfilled it
  from ``job_rooms.floor_plan_id``, so it inherits the same drift.

Consumers like the moisture-report view bucket pins by exact
``floor_plan_id`` against the set of floor plans returned by
``list_floor_plans_by_property`` (which filters ``is_current=true``). When
the pin's stamp points at an older version, it doesn't match any current
floor and falls into the "Uncategorized pins" orphan bucket — every pin
disappears from the canvas even though all the data is live.

This migration repoints any stale stamp (``floor_plan_id`` pointing at a
``is_current=false`` row) onto the current version for the same
``(property_id, floor_number)``. It's a one-shot repair; the underlying
Phase-1 drift that produced the staleness is tracked separately — the
proper fix lives in save_canvas's fork path (or in
``_create_version``) and will re-stamp downstream tables atomically.

Covers both tables in one migration so the moisture-report view's
``(property_id, floor_number)``-equivalent bucketing works immediately
after upgrade without an accompanying manual SQL step.

Revision ID: d3e5a7c9b1f4
Revises: c8f1a3d5b7e9
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3e5a7c9b1f4"
down_revision: str | None = "c8f1a3d5b7e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- Repoint job_rooms whose floor_plan_id points at a non-current version
-- onto the current version for the same (property_id, floor_number).
UPDATE job_rooms jr
   SET floor_plan_id = curr.id
  FROM floor_plans old_fp
  JOIN floor_plans curr
    ON curr.property_id = old_fp.property_id
   AND curr.floor_number = old_fp.floor_number
   AND curr.is_current = true
 WHERE jr.floor_plan_id = old_fp.id
   AND old_fp.is_current = false;

-- Same repair for moisture_pins. Step 2's backfill inherited the stale
-- stamp from job_rooms; after the update above, new writes will pick
-- up the correct current id via the RPC lookup path, but existing rows
-- need this sweep.
UPDATE moisture_pins mp
   SET floor_plan_id = curr.id
  FROM floor_plans old_fp
  JOIN floor_plans curr
    ON curr.property_id = old_fp.property_id
   AND curr.floor_number = old_fp.floor_number
   AND curr.is_current = true
 WHERE mp.floor_plan_id = old_fp.id
   AND old_fp.is_current = false;
"""


# No DOWNGRADE_SQL — the original stale state can't be reconstructed
# without an audit log we don't keep. The forward sweep only touches
# rows whose target was incorrect, so there's nothing meaningful to
# undo; downgrade is explicitly a no-op (alembic requires a callable,
# not an empty SQL string, so the function body is `pass`).


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    pass
