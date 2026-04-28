"""Spec 01H Phase 2: backfill job_rooms.floor_plan_id.

The ``handleCreateRoom`` path on the frontend was omitting
``floor_plan_id`` when POSTing a new room for the lifetime of Phase 1 +
early Phase 2. The FK column exists and defaults to NULL, so every
pre-fix row silently landed with ``floor_plan_id IS NULL``.

Phase 2's Moisture Report View is the first consumer to actually JOIN
on this column (via the PostgREST embed in ``list_pins_by_job``). Rather
than fixing the frontend only and leaving a data-state bomb for every
pre-fix environment, this migration resolves NULLs from context:

1. **Job-pinned floor plan** — when ``jobs.floor_plan_id`` is set, that
   is the floor the job has been operating on; every room for that job
   belongs to it.

2. **Property's sole current floor** — when the job isn't pinned but
   the room's property has exactly ONE ``is_current = TRUE`` row in
   ``floor_plans``, it's unambiguous which floor the room belongs to.

Ambiguous rooms (multi-floor property, job not pinned) are left NULL.
Those rooms genuinely *cannot* be resolved without user intent — a tech
who drew a room on a multi-floor property without an active floor is a
bug upstream, and the Moisture Report View's anyPinHasFloorId fallback
handles the lingering NULLs gracefully.

The detection pattern comes from pr-review-lessons #25 ("Denormalized
truth in one consumer masks a missing FK everywhere else"): every
consumer that depends on ``floor_plan_id`` — not just moisture report
— benefits from this one-time cleanup.

Safety: the UPDATE is WHERE floor_plan_id IS NULL so running twice is
idempotent. Downgrade is a no-op — we cannot reconstruct which rooms
*were* NULL pre-migration, and re-NULLing them would break the very
consumer this migration enables.

Revision ID: f1e2d3c4b5a6
Revises: e1f2a3b4c5d6
Create Date: 2026-04-23
"""

from __future__ import annotations

import logging

from alembic import op

logger = logging.getLogger("alembic.env")

# revision identifiers, used by Alembic.
revision = "f1e2d3c4b5a6"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


UPGRADE_SQL_JOB_PIN = """
-- Strategy 1: use the job's pinned floor_plan_id when present. This
-- covers any room whose job was pinned to a specific floor plan by
-- ensure_job_floor_plan (the atomic room-create RPC path).
UPDATE job_rooms jr
   SET floor_plan_id = j.floor_plan_id
  FROM jobs j
 WHERE jr.job_id = j.id
   AND jr.floor_plan_id IS NULL
   AND j.floor_plan_id IS NOT NULL;
"""

UPGRADE_SQL_PROPERTY_UNAMBIGUOUS = """
-- Strategy 2: job isn't pinned, but the property has exactly one
-- is_current=TRUE floor_plans row. The room unambiguously belongs to
-- that floor. Single-floor properties (the common case for SFR water
-- damage) all resolve here.
WITH sole_current AS (
    -- array_agg because MIN(uuid) isn't a defined aggregate in
    -- PostgreSQL. HAVING COUNT(*) = 1 guarantees the array has
    -- exactly one element, so [1] is safe.
    SELECT property_id, (array_agg(id))[1] AS floor_plan_id
      FROM floor_plans
     WHERE is_current = TRUE
     GROUP BY property_id
    HAVING COUNT(*) = 1
)
UPDATE job_rooms jr
   SET floor_plan_id = sc.floor_plan_id
  FROM jobs j
  JOIN sole_current sc ON sc.property_id = j.property_id
 WHERE jr.job_id = j.id
   AND jr.floor_plan_id IS NULL;
"""

ASSERTION_SQL = """
SELECT COUNT(*) FROM job_rooms jr
 JOIN jobs j ON j.id = jr.job_id
 WHERE jr.floor_plan_id IS NULL
   AND EXISTS (SELECT 1 FROM floor_plans fp WHERE fp.property_id = j.property_id);
"""


def upgrade() -> None:
    conn = op.get_bind()
    # Count NULLs up front so the log line shows the cleanup impact.
    before = conn.exec_driver_sql(
        "SELECT COUNT(*) FROM job_rooms WHERE floor_plan_id IS NULL"
    ).scalar_one()
    logger.info("backfill_job_rooms_floor_plan_id: %s rooms with NULL floor_plan_id", before)

    conn.exec_driver_sql(UPGRADE_SQL_JOB_PIN)
    conn.exec_driver_sql(UPGRADE_SQL_PROPERTY_UNAMBIGUOUS)

    # Post-migration: any room whose property has ANY floor plans but
    # still has NULL floor_plan_id is ambiguous (multi-floor property,
    # unpinned job). We don't fail the migration — that'd strand the
    # deploy — but we do log a warning so the ops channel notices.
    ambiguous = conn.exec_driver_sql(ASSERTION_SQL).scalar_one()
    after = conn.exec_driver_sql(
        "SELECT COUNT(*) FROM job_rooms WHERE floor_plan_id IS NULL"
    ).scalar_one()
    resolved = before - after
    logger.info(
        "backfill_job_rooms_floor_plan_id: resolved %s, remaining NULL %s (%s "
        "on properties with floor plans — ambiguous, left NULL)",
        resolved,
        after,
        ambiguous,
    )


def downgrade() -> None:
    # Intentional no-op. Re-NULLing backfilled rows would re-introduce
    # the silent-drop bug in the Moisture Report View that motivated
    # this migration.
    pass
