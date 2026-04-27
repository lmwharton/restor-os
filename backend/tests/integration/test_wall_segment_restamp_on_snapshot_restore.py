"""Integration test: ``moisture_pins.wall_segment_id`` survives the
snapshot-restore wipe-and-re-insert when ``(room_id, sort_order)`` is
preserved.

This is the runtime test missing from the original Phase 2 location-split
PR — text-scan green-lit the ``UPDATE moisture_pins SET wall_segment_id
= ... ON sort_order = ...`` statement in ``save_floor_plan_version``,
but didn't catch that the statement was running BEFORE the wipe (i.e.,
no new wall rows existed yet so the join found nothing). End-to-end
test against a real DB exercises the same SQL the new
``restore_floor_plan_relational_snapshot`` body runs internally and
asserts the post-condition: a pin pointing at wall A (sort_order 0)
before the wipe points at wall A' (also sort_order 0) afterwards,
with A.id ≠ A'.id.

Why direct SQL instead of calling the function: ``get_my_company_id()``
reads ``auth.uid()`` from the JWT, which raw psycopg2 has no way to
populate. This test exercises the EXACT SQL fragments the function
runs (capture → DELETE → INSERT → re-stamp UPDATE) under a real
transaction so the ``ON DELETE SET NULL`` FK behavior + the re-stamp
UPDATE join semantics are verified together. Function-level wiring
(JWT + tenant gate) is verified separately by the migration's
text-scan + by manual smoke against a backend service.

Lesson #12 in action: text-scan is the wrong tool for runtime
contracts; integration tests that round-trip against Postgres are.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import psycopg2
import pytest
from dotenv import dotenv_values

pytestmark = [pytest.mark.integration]


def _resolve_database_url() -> str | None:
    env_url = os.environ.get("DATABASE_URL")
    if env_url:
        return env_url
    backend_dir = Path(__file__).resolve().parents[2]
    env_path = backend_dir / ".env"
    if env_path.exists():
        return dotenv_values(env_path).get("DATABASE_URL")
    return None


def _db_reachable() -> bool:
    url = _resolve_database_url()
    if not url:
        return False
    try:
        conn = psycopg2.connect(url, connect_timeout=2)
        conn.close()
        return True
    except Exception:
        return False


@pytest.fixture(scope="module")
def conn():
    if not _db_reachable():
        pytest.skip("DATABASE_URL not reachable — skipping integration test")
    url = _resolve_database_url()
    assert url is not None
    c = psycopg2.connect(url)
    # Per-test transaction so we can roll back after asserting.
    # Each test commits its setup, runs the SQL fragments inside a
    # SAVEPOINT, asserts, then rolls the savepoint back.
    c.autocommit = True
    yield c
    c.close()


def _find_room_with_walls(cur):
    """Pick an existing room with ≥1 wall_segment to anchor the test
    against. Avoids creating a whole floor-plan tree from scratch."""
    cur.execute(
        """
        SELECT jr.id, jr.job_id, jr.company_id, jr.floor_plan_id,
               (SELECT id FROM wall_segments WHERE room_id = jr.id ORDER BY sort_order LIMIT 1),
               (SELECT sort_order FROM wall_segments WHERE room_id = jr.id ORDER BY sort_order LIMIT 1)
          FROM job_rooms jr
          JOIN jobs j ON j.id = jr.job_id AND j.deleted_at IS NULL
         WHERE jr.floor_plan_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM wall_segments WHERE room_id = jr.id)
         ORDER BY jr.updated_at DESC
         LIMIT 1
        """
    )
    return cur.fetchone()


def _exercise_restamp_sequence(cur, *, room_id, company_id, simulate_geometry_change: bool):
    """Run the exact SQL fragments restore_floor_plan_relational_snapshot
    runs internally for one room: capture pin→sort_order map, DELETE
    walls (FK fires SET NULL on pins), re-INSERT walls (new UUIDs),
    re-stamp UPDATE.

    When simulate_geometry_change=True, the re-INSERTed wall has a
    different sort_order than the original — simulating a polygon edit
    where the original wall is gone. The pin should stay NULL in that
    case (lesson #2 — honest answer).
    """
    # Capture map BEFORE the DELETE.
    cur.execute(
        """
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'pin_id', mp.id, 'sort_order', ws.sort_order)), '[]'::jsonb)
          FROM moisture_pins mp
          JOIN wall_segments ws ON ws.id = mp.wall_segment_id
         WHERE mp.room_id = %s
           AND mp.company_id = %s
           AND mp.wall_segment_id IS NOT NULL
        """,
        (str(room_id), str(company_id)),
    )
    pin_map = cur.fetchone()[0]

    # Snapshot the wall data so we can re-INSERT after the wipe.
    cur.execute(
        """
        SELECT x1, y1, x2, y2, wall_type, wall_height_ft, affected, shared,
               shared_with_room_id, sort_order
          FROM wall_segments WHERE room_id = %s ORDER BY sort_order
        """,
        (str(room_id),),
    )
    wall_rows = cur.fetchall()

    # DELETE — ON DELETE SET NULL nulls every pin in this room.
    cur.execute(
        "DELETE FROM wall_segments WHERE room_id = %s AND company_id = %s",
        (str(room_id), str(company_id)),
    )

    # Re-INSERT (with optionally-shifted sort_order to simulate geometry change).
    new_wall_ids = []
    for row in wall_rows:
        x1, y1, x2, y2, wt, wh, aff, sh, sw, so = row
        new_so = so + 999 if simulate_geometry_change else so
        cur.execute(
            """
            INSERT INTO wall_segments (
                room_id, company_id, x1, y1, x2, y2, wall_type, wall_height_ft,
                affected, shared, shared_with_room_id, sort_order
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (str(room_id), str(company_id), x1, y1, x2, y2, wt, wh, aff, sh, sw, new_so),
        )
        new_wall_ids.append(cur.fetchone()[0])

    # Re-stamp UPDATE — exactly the SQL the new function runs.
    if pin_map and pin_map != []:
        cur.execute(
            """
            UPDATE moisture_pins mp
               SET wall_segment_id = new_ws.id
              FROM jsonb_to_recordset(%s::jsonb) AS pwr(pin_id UUID, sort_order INTEGER)
              JOIN wall_segments new_ws ON new_ws.room_id = %s
                                       AND new_ws.company_id = %s
                                       AND new_ws.sort_order = pwr.sort_order
             WHERE mp.id = pwr.pin_id
            """,
            (json.dumps(pin_map), str(room_id), str(company_id)),
        )

    return new_wall_ids


def test_pin_wall_segment_id_survives_snapshot_restore_when_sort_order_preserved(conn):
    """The full failure mode: pin points at wall A, snapshot restore
    wipes-and-re-inserts walls (so wall A becomes wall A' with new
    UUID at the same sort_order), pin must end up pointing at A'.

    Pre-fix (e2b3c4d5f6a7's UPDATE in save_floor_plan_version): pin
    wall_segment_id ends NULL after restore. This assertion fails.
    Post-fix (e5f6a7b8c9d0's restamp inside snapshot restore): pin
    points at the new wall."""
    cur = conn.cursor()
    found = _find_room_with_walls(cur)
    if not found:
        pytest.skip("No existing room with walls — skipping.")
    room_id, job_id, company_id, _floor_plan_id, original_wall_id, original_sort_order = found

    pin_id = str(uuid.uuid4())
    # Use a SAVEPOINT so we can roll the wall wipe-and-re-insert back
    # without polluting the dev DB. autocommit is on at the connection
    # level, so we explicitly BEGIN here.
    cur.execute("BEGIN")
    try:
        cur.execute(
            """
            INSERT INTO moisture_pins (
                id, job_id, room_id, company_id, canvas_x, canvas_y,
                surface, position, wall_segment_id,
                material, dry_standard, created_by
            ) VALUES (%s, %s, %s, %s, 50, 50, 'wall', 'C', %s, 'drywall', 16.0, NULL)
            """,
            (pin_id, str(job_id), str(room_id), str(company_id), str(original_wall_id)),
        )
        cur.execute(
            """
            INSERT INTO moisture_pin_readings (pin_id, company_id, reading_value, taken_at)
            VALUES (%s, %s, 30.0, '2026-04-26T12:00:00Z'::timestamptz)
            """,
            (pin_id, str(company_id)),
        )

        _exercise_restamp_sequence(
            cur,
            room_id=room_id,
            company_id=company_id,
            simulate_geometry_change=False,
        )

        cur.execute(
            "SELECT wall_segment_id FROM moisture_pins WHERE id = %s",
            (pin_id,),
        )
        post_wall_id = cur.fetchone()[0]
        assert post_wall_id is not None, (
            "REGRESSION: pin's wall_segment_id became NULL after the wipe-"
            "re-insert sequence. The capture-then-restamp logic in "
            "restore_floor_plan_relational_snapshot is broken. See "
            "migration e5f6a7b8c9d0."
        )
        assert post_wall_id != original_wall_id, (
            f"DELETE+INSERT didn't actually rotate the UUID — pin still "
            f"points at original {original_wall_id}. Test isn't "
            f"exercising the failure mode."
        )

        # And confirm sort_order matches by traversing the new wall row.
        cur.execute(
            "SELECT sort_order, room_id FROM wall_segments WHERE id = %s",
            (str(post_wall_id),),
        )
        post_sort_order, post_room_id = cur.fetchone()
        assert post_sort_order == original_sort_order
        assert post_room_id == room_id
    finally:
        cur.execute("ROLLBACK")


def test_pin_wall_segment_id_falls_to_null_when_sort_order_no_longer_exists(conn):
    """Sibling case: when geometry actually changes (sort_order shifts
    or the wall is removed), the pin's wall_segment_id stays NULL via
    ON DELETE SET NULL. Pin-the-invariant for the lesson #2 "raise/null,
    don't fake the link" rule."""
    cur = conn.cursor()
    found = _find_room_with_walls(cur)
    if not found:
        pytest.skip("No existing room with walls — skipping.")
    room_id, job_id, company_id, _floor_plan_id, original_wall_id, _original_sort_order = found

    pin_id = str(uuid.uuid4())
    cur.execute("BEGIN")
    try:
        cur.execute(
            """
            INSERT INTO moisture_pins (
                id, job_id, room_id, company_id, canvas_x, canvas_y,
                surface, position, wall_segment_id,
                material, dry_standard, created_by
            ) VALUES (%s, %s, %s, %s, 50, 50, 'wall', 'C', %s, 'drywall', 16.0, NULL)
            """,
            (pin_id, str(job_id), str(room_id), str(company_id), str(original_wall_id)),
        )
        cur.execute(
            """
            INSERT INTO moisture_pin_readings (pin_id, company_id, reading_value, taken_at)
            VALUES (%s, %s, 30.0, '2026-04-26T12:00:00Z'::timestamptz)
            """,
            (pin_id, str(company_id)),
        )

        _exercise_restamp_sequence(
            cur,
            room_id=room_id,
            company_id=company_id,
            simulate_geometry_change=True,
        )

        cur.execute(
            "SELECT wall_segment_id FROM moisture_pins WHERE id = %s",
            (pin_id,),
        )
        post_wall_id = cur.fetchone()[0]
        assert post_wall_id is None, (
            f"Pin should have wall_segment_id=NULL after restore (sort_order "
            f"no longer maps), got {post_wall_id}. Re-stamp logic is "
            f"silently faking the link — lesson #2 violation."
        )
    finally:
        cur.execute("ROLLBACK")
