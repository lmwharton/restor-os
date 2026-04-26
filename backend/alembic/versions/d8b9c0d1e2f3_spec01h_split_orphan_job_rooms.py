"""Spec 01H Phase 2 follow-up: split orphan job_rooms across floors.

The earlier backfill (``f1e2d3c4b5a6``) resolved ``job_rooms.floor_plan_id``
for two cases:

* job is pinned to a single floor plan, OR
* the room's property has exactly one ``is_current = TRUE`` floor plan.

It deliberately left the ambiguous case alone — multi-floor properties
where the job wasn't pinned. In practice that case is the worst data
state Phase 2 produced: the frontend's old name-only dedupe was
re-using an existing same-named ``job_rooms`` row across floors, so a
single backend room ended up referenced by ``canvas_data.rooms[].propertyRoomId``
on multiple ``floor_plans`` rows for the same job. Moisture pins
attached to that row inherit a NULL floor through the join and leak
visually onto every floor whose canvas references the orphan UUID
(see internal moisture-pin debugging logs from 2026-04-26).

This migration resolves the ambiguous case using the canvas_data graph:

1. **Single referencer.** The orphan room is referenced by exactly one
   floor's ``canvas_data.rooms`` — assign that floor and we're done.

2. **Multiple referencers.** The orphan is shared across floors (the
   dedupe-bug case). The pre-existing pins can't be split safely (we
   don't know which canvas the user originally tapped on), so we keep
   the original row and its pins attached to ONE floor — the lowest
   ``floor_number`` referencer for determinism. For every OTHER floor,
   we INSERT a clone of the orphan row (same name / metadata, fresh
   UUID, correct ``floor_plan_id``) and rewrite that floor's
   ``canvas_data.rooms[].propertyRoomId`` to point at the clone.
   After this runs, every canvas room owns a unique backend row, and
   subsequent pin placements on each floor land on the right room.

3. **Zero referencers.** No floor's canvas_data mentions the orphan —
   it's truly disconnected. Logged for visibility, left NULL. A future
   GC pass can decide whether to delete it.

Idempotent: every UPDATE / INSERT is gated on the orphan still being
NULL or the clone still being absent.

Reversibility: a private tracking table ``_mig_d8b9c0d1e2f3_changes``
records every change the upgrade makes (room_id assigned a floor,
clone created, canvas_data rewritten). The downgrade walks that table
in reverse to undo each change, then drops the tracking table itself.
Pins placed on cloned rooms *after* the upgrade ran will block the
downgrade with a clear error rather than silently cascade-delete —
restoring from a DB backup is the right move in that case, not a
forced downgrade.

Revision ID: d8b9c0d1e2f3
Revises: d7a8b9c0e1f2
Create Date: 2026-04-26
"""

from __future__ import annotations

import json
import logging
import uuid
from collections import defaultdict

from alembic import op

logger = logging.getLogger("alembic.env")

# revision identifiers, used by Alembic.
revision = "d8b9c0d1e2f3"
down_revision = "d7a8b9c0e1f2"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# SQL fragments
# ---------------------------------------------------------------------------

# Build the orphan-room → (floor_plan_id, floor_number, canvas_data) map
# in one shot. ``jsonb_array_elements`` expands each floor_plan's
# canvas_data.rooms array; the join filters to elements whose
# propertyRoomId matches an orphan job_rooms.id. We carry along the
# raw canvas_data so the Python upgrade() can rewrite it without a
# second round-trip per floor.
# floor_plans is property-scoped (no `job_id` column), so we resolve
# job → property → floor_plans. We restrict to `is_current = TRUE` so
# historical floor-plan snapshots (older versions of the same floor)
# don't double-count as referencers of the orphan room.
ORPHAN_REFS_SQL = """
SELECT
    jr.id::text         AS room_id,
    jr.job_id::text     AS job_id,
    jr.room_name        AS room_name,
    jr.length_ft        AS length_ft,
    jr.width_ft         AS width_ft,
    jr.height_ft        AS height_ft,
    jr.room_type        AS room_type,
    jr.ceiling_type     AS ceiling_type,
    jr.floor_level      AS floor_level,
    jr.material_flags   AS material_flags,
    jr.affected         AS affected,
    jr.company_id::text AS company_id,
    fp.id::text         AS floor_plan_id,
    fp.floor_number     AS floor_number,
    fp.canvas_data      AS canvas_data
FROM job_rooms jr
JOIN jobs j
  ON j.id = jr.job_id
JOIN floor_plans fp
  ON fp.property_id = j.property_id
 AND fp.is_current = TRUE
CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(fp.canvas_data -> 'rooms', '[]'::jsonb)
) AS canvas_room
WHERE jr.floor_plan_id IS NULL
  AND canvas_room ->> 'propertyRoomId' = jr.id::text;
"""

# Discover orphans that still have NULL floor after Step 1 (resolve
# unambiguous) — used purely for logging visibility.
ZERO_REF_ORPHANS_SQL = """
SELECT jr.id::text, jr.job_id::text, jr.room_name
FROM job_rooms jr
WHERE jr.floor_plan_id IS NULL;
"""


# ---------------------------------------------------------------------------
# Migration body
# ---------------------------------------------------------------------------


TRACKING_TABLE = "_mig_d8b9c0d1e2f3_changes"


def _ensure_tracking_table(conn) -> None:
    """Create the tracking table if it doesn't already exist.

    Schema:
      kind                — 'assign' | 'clone' | 'canvas_rewrite'
      room_id             — affected job_rooms.id (kept room or clone)
      original_room_id    — for 'clone', the orphan it was cloned from
      floor_plan_id       — affected floor_plans.id (assign target / canvas owner)
      previous_canvas_data— pre-rewrite canvas_data jsonb (for 'canvas_rewrite')
    """
    conn.exec_driver_sql(
        f"""
        CREATE TABLE IF NOT EXISTS {TRACKING_TABLE} (
            id                   SERIAL PRIMARY KEY,
            kind                 TEXT NOT NULL CHECK (kind IN ('assign','clone','canvas_rewrite')),
            room_id              UUID,
            original_room_id     UUID,
            floor_plan_id        UUID,
            previous_canvas_data JSONB
        )
        """
    )


def upgrade() -> None:  # noqa: C901 - migration logic intentionally explicit
    conn = op.get_bind()
    _ensure_tracking_table(conn)

    before = conn.exec_driver_sql(
        "SELECT COUNT(*) FROM job_rooms WHERE floor_plan_id IS NULL"
    ).scalar_one()
    logger.info(
        "split_orphan_job_rooms: %s orphan rooms with NULL floor_plan_id at start",
        before,
    )

    # Group every (orphan_room, floor) reference. Sort by floor_number so
    # the ``[0]`` referencer is deterministic — basement (0) keeps the
    # original row when the orphan is shared with main + upper.
    refs_by_room: dict[str, list[dict]] = defaultdict(list)
    for row in conn.exec_driver_sql(ORPHAN_REFS_SQL).mappings():
        refs_by_room[row["room_id"]].append(dict(row))

    if not refs_by_room:
        logger.info("split_orphan_job_rooms: no canvas_data references found; nothing to do")
        # `Result.rowcount` is implementation-defined for SELECT (psycopg2
        # returns -1 before iteration), so an explicit COUNT(*) gives the
        # honest number — matches the post-loop logger below.
        zero_count = conn.exec_driver_sql(
            "SELECT COUNT(*) FROM job_rooms WHERE floor_plan_id IS NULL"
        ).scalar_one()
        logger.info(
            "split_orphan_job_rooms: %s orphan rooms remain with no canvas_data referencer (left NULL)",
            zero_count,
        )
        return

    resolved_unambiguous = 0
    split_total = 0
    clones_created = 0

    for room_id, refs in refs_by_room.items():
        refs.sort(key=lambda r: (r["floor_number"], r["floor_plan_id"]))

        # Step 1: single referencer — straight assignment.
        if len(refs) == 1:
            target = refs[0]
            updated = conn.exec_driver_sql(
                "UPDATE job_rooms SET floor_plan_id = %s WHERE id = %s AND floor_plan_id IS NULL",
                (target["floor_plan_id"], room_id),
            ).rowcount
            if updated:
                conn.exec_driver_sql(
                    f"INSERT INTO {TRACKING_TABLE} (kind, room_id, floor_plan_id) VALUES ('assign', %s, %s)",
                    (room_id, target["floor_plan_id"]),
                )
            resolved_unambiguous += 1
            continue

        # Step 2: multiple referencers — keep original on the lowest-
        # floor_number referencer, clone for every other floor, and
        # rewrite each other floor's canvas_data to point at the clone.
        keep, *others = refs
        updated = conn.exec_driver_sql(
            "UPDATE job_rooms SET floor_plan_id = %s WHERE id = %s AND floor_plan_id IS NULL",
            (keep["floor_plan_id"], room_id),
        ).rowcount
        if updated:
            conn.exec_driver_sql(
                f"INSERT INTO {TRACKING_TABLE} (kind, room_id, floor_plan_id) VALUES ('assign', %s, %s)",
                (room_id, keep["floor_plan_id"]),
            )
        split_total += 1

        for other in others:
            new_id = str(uuid.uuid4())
            # Capture the canvas_data we're about to rewrite so the
            # downgrade can restore it byte-for-byte.
            canvas_before = other["canvas_data"]
            if isinstance(canvas_before, dict):
                canvas_before_json = json.dumps(canvas_before)
            else:
                canvas_before_json = canvas_before  # already JSON text from psycopg2
            # ``material_flags`` is JSONB on disk; psycopg2 won't auto-
            # cast a Python list to JSONB (it tries text[] and fails),
            # so serialize to JSON text and cast explicitly. Same
            # treatment for any other JSONB column the schema may grow.
            material_flags_json = (
                json.dumps(keep["material_flags"])
                if keep["material_flags"] is not None
                else None
            )
            conn.exec_driver_sql(
                """
                INSERT INTO job_rooms (
                    id, job_id, company_id, room_name,
                    length_ft, width_ft, height_ft,
                    room_type, ceiling_type, floor_level,
                    material_flags, affected, floor_plan_id
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s::jsonb, %s, %s
                )
                """,
                (
                    new_id,
                    keep["job_id"],
                    keep["company_id"],
                    keep["room_name"],
                    keep["length_ft"],
                    keep["width_ft"],
                    keep["height_ft"],
                    keep["room_type"],
                    keep["ceiling_type"],
                    keep["floor_level"],
                    material_flags_json,
                    keep["affected"],
                    other["floor_plan_id"],
                ),
            )
            clones_created += 1
            # Track the clone so downgrade can DELETE it (and notice
            # if pins arrived on it post-migration).
            conn.exec_driver_sql(
                f"""
                INSERT INTO {TRACKING_TABLE} (kind, room_id, original_room_id, floor_plan_id)
                VALUES ('clone', %s, %s, %s)
                """,
                (new_id, room_id, other["floor_plan_id"]),
            )

            # Rewrite this floor's canvas_data.rooms entries that point
            # at the original orphan UUID — they should now point at
            # the clone. We rewrite the whole canvas_data because
            # JSONB subscript-update on array elements is awkward in
            # SQL, and per-floor canvas_data is bounded in size.
            canvas_data = other["canvas_data"]
            if isinstance(canvas_data, str):
                canvas_data = json.loads(canvas_data)
            rooms_arr = (canvas_data or {}).get("rooms") or []
            rewrote = 0
            for canvas_room in rooms_arr:
                if canvas_room.get("propertyRoomId") == room_id:
                    canvas_room["propertyRoomId"] = new_id
                    rewrote += 1
            if rewrote > 0:
                conn.exec_driver_sql(
                    "UPDATE floor_plans SET canvas_data = %s::jsonb WHERE id = %s",
                    (json.dumps(canvas_data), other["floor_plan_id"]),
                )
                # Track the canvas_data rewrite so downgrade can
                # restore the pre-rewrite JSONB.
                conn.exec_driver_sql(
                    f"""
                    INSERT INTO {TRACKING_TABLE}
                        (kind, floor_plan_id, previous_canvas_data)
                    VALUES ('canvas_rewrite', %s, %s::jsonb)
                    """,
                    (other["floor_plan_id"], canvas_before_json),
                )

    # Step 3 visibility — orphans with no canvas_data referencer at all.
    zero_after = conn.exec_driver_sql(
        "SELECT COUNT(*) FROM job_rooms WHERE floor_plan_id IS NULL"
    ).scalar_one()

    after = conn.exec_driver_sql(
        "SELECT COUNT(*) FROM job_rooms WHERE floor_plan_id IS NULL"
    ).scalar_one()
    logger.info(
        "split_orphan_job_rooms: resolved %s, split %s (clones=%s), %s remain NULL "
        "(unreferenced by any canvas_data — left for manual review)",
        resolved_unambiguous,
        split_total,
        clones_created,
        zero_after,
    )
    logger.info(
        "split_orphan_job_rooms: orphan count %s -> %s (resolved %s)",
        before,
        after,
        before - after,
    )


def downgrade() -> None:
    """Reverse upgrade() using the tracking table populated above.

    Order matters:
      1. Restore each floor's canvas_data from its tracked snapshot.
      2. Delete clone rooms — guarded against the realistic risk that
         pins were created on the clone after upgrade ran. If any
         clone has dependent pins, raise so the operator restores from
         a DB backup instead of cascade-orphaning post-migration data.
      3. Re-NULL the floor_plan_id on rooms whose floor we assigned.
      4. Drop the tracking table.

    If the tracking table doesn't exist (upgrade was never run, or
    table was dropped manually), downgrade is a no-op.
    """
    conn = op.get_bind()

    exists = conn.exec_driver_sql(
        "SELECT to_regclass(%s) IS NOT NULL",
        (TRACKING_TABLE,),
    ).scalar_one()
    if not exists:
        logger.info(
            "split_orphan_job_rooms downgrade: %s missing; nothing to undo",
            TRACKING_TABLE,
        )
        return

    # Step 1: restore canvas_data. Reverse insertion order so the most
    # recent rewrite is applied first — but for this migration there
    # is at most one rewrite per (floor_plan_id), so order is moot;
    # ORDER BY id DESC keeps semantics correct if that ever changes.
    rewrites = conn.exec_driver_sql(
        f"SELECT floor_plan_id::text, previous_canvas_data FROM {TRACKING_TABLE} "
        f"WHERE kind = 'canvas_rewrite' ORDER BY id DESC"
    ).mappings().all()
    for row in rewrites:
        conn.exec_driver_sql(
            "UPDATE floor_plans SET canvas_data = %s::jsonb WHERE id = %s",
            (json.dumps(row["previous_canvas_data"]), row["floor_plan_id"]),
        )

    # Step 2: delete clones. Guard against post-migration pin
    # attachments — those pins reference the clone's UUID; deleting
    # the clone would force a CASCADE delete on real user data, which
    # is not a safe rollback. Bail with a clear error instead.
    clones = conn.exec_driver_sql(
        f"SELECT room_id::text FROM {TRACKING_TABLE} WHERE kind = 'clone'"
    ).scalars().all()
    if clones:
        ids_csv = ",".join(f"'{c}'" for c in clones)
        pin_count = conn.exec_driver_sql(
            f"SELECT COUNT(*) FROM moisture_pins WHERE room_id IN ({ids_csv})"
        ).scalar_one()
        if pin_count:
            raise RuntimeError(
                f"split_orphan_job_rooms downgrade: {pin_count} moisture_pins "
                f"reference clone rooms created by the upgrade. Forced rollback "
                f"would cascade-delete user data. Restore from a DB backup "
                f"instead, or DELETE those pins manually before retrying."
            )
        conn.exec_driver_sql(
            f"DELETE FROM job_rooms WHERE id IN ({ids_csv})"
        )

    # Step 3: re-NULL the assigned rows. We only undo rows whose
    # current floor_plan_id matches the one we assigned (idempotent —
    # if the operator already changed the floor_plan_id between
    # upgrade and downgrade, leave their value alone).
    assigns = conn.exec_driver_sql(
        f"SELECT room_id::text, floor_plan_id::text FROM {TRACKING_TABLE} "
        f"WHERE kind = 'assign'"
    ).mappings().all()
    for row in assigns:
        conn.exec_driver_sql(
            "UPDATE job_rooms SET floor_plan_id = NULL "
            "WHERE id = %s AND floor_plan_id = %s",
            (row["room_id"], row["floor_plan_id"]),
        )

    # Step 4: drop the tracking table.
    conn.exec_driver_sql(f"DROP TABLE {TRACKING_TABLE}")
    logger.info(
        "split_orphan_job_rooms downgrade: restored %s canvas_data rewrites, "
        "deleted %s clones, re-NULLed %s assignments",
        len(rewrites),
        len(clones),
        len(assigns),
    )
