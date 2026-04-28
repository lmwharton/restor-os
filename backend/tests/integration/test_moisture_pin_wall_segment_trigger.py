"""Integration test: ``trg_moisture_pin_wall_segment_binding`` (added by
migration ``e4d5f6a7b8c9``) actually rejects cross-room and cross-tenant
``wall_segment_id`` writes at the table level.

The migration text-scan test asserts the trigger exists with the right
SQL shape; that's syntax. This test exercises the runtime contract:
that an UPDATE setting ``wall_segment_id`` to a wall in a different
room (or owned by a different tenant) raises ``P0002`` before the row
lands. Lesson #12 — text-scan green-lights syntax, not semantics —
applies the same as e5 (see
``test_wall_segment_restamp_on_snapshot_restore.py``).

Why direct SQL instead of going through the FastAPI service: the
service-level lesson #30 check raises the same SQLSTATE before the
write ever reaches the trigger, so a service-layer test wouldn't tell
us whether the trigger itself works. Hitting the table directly with
psycopg2 bypasses Python and verifies the DB-level invariant —
exactly what the trigger was added to enforce for callers that bypass
the FastAPI service (admin tooling, future RPCs, direct PostgREST
writes).
"""

from __future__ import annotations

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
    c.autocommit = True
    yield c
    c.close()


def _find_two_rooms_with_walls_same_tenant(cur):
    """Pick two rooms in the same company that each have ≥1 wall.
    Used to test the cross-room rejection path."""
    cur.execute(
        """
        SELECT jr.id, jr.job_id, jr.company_id,
               (SELECT id FROM wall_segments
                 WHERE room_id = jr.id ORDER BY sort_order LIMIT 1)
          FROM job_rooms jr
          JOIN jobs j ON j.id = jr.job_id AND j.deleted_at IS NULL
         WHERE EXISTS (SELECT 1 FROM wall_segments WHERE room_id = jr.id)
         ORDER BY jr.company_id, jr.updated_at DESC
        """
    )
    rows = cur.fetchall()
    by_company: dict = {}
    for r in rows:
        by_company.setdefault(r[2], []).append(r)
    for _company, two_or_more in by_company.items():
        if len(two_or_more) >= 2:
            return two_or_more[0], two_or_more[1]
    return None


def _find_wall_in_other_tenant(cur, exclude_company_id):
    """Pick a wall_segments row whose company_id differs from the given
    one. Used to test the cross-tenant rejection path."""
    cur.execute(
        """
        SELECT ws.id, ws.room_id, ws.company_id
          FROM wall_segments ws
         WHERE ws.company_id <> %s
         LIMIT 1
        """,
        (str(exclude_company_id),),
    )
    return cur.fetchone()


def test_trigger_blocks_cross_room_wall_segment_id_update(conn):
    """An UPDATE setting wall_segment_id to a wall in a different
    (same-tenant) room raises P0002. The lesson #30 contract that the
    create RPC carries inline must hold for every UPDATE path too."""
    cur = conn.cursor()
    pair = _find_two_rooms_with_walls_same_tenant(cur)
    if not pair:
        pytest.skip(
            "No two rooms with walls in the same company — skipping "
            "cross-room rejection test."
        )
    (room_a_id, job_id, company_id, wall_a_id), (room_b_id, _job_b, _co_b, wall_b_id) = pair

    pin_id = str(uuid.uuid4())
    cur.execute("BEGIN")
    try:
        # Seed a pin on room A pointing at wall A. Trigger fires on the
        # INSERT (defense-in-depth alongside the create RPC's check)
        # and accepts because the binding is correct.
        cur.execute(
            """
            INSERT INTO moisture_pins (
                id, job_id, room_id, company_id, canvas_x, canvas_y,
                surface, position, wall_segment_id,
                material, dry_standard, created_by
            ) VALUES (%s, %s, %s, %s, 50, 50, 'wall', 'C', %s, 'drywall', 16.0, NULL)
            """,
            (pin_id, str(job_id), str(room_a_id), str(company_id), str(wall_a_id)),
        )
        cur.execute(
            """
            INSERT INTO moisture_pin_readings (pin_id, company_id, reading_value, taken_at)
            VALUES (%s, %s, 30.0, '2026-04-26T12:00:00Z'::timestamptz)
            """,
            (pin_id, str(company_id)),
        )

        # The actual UPDATE we expect the trigger to block: keep room_id
        # at room A but point wall_segment_id at room B's wall. Lesson
        # #30 says the FK alone allows this; the trigger must reject.
        with pytest.raises(psycopg2.errors.NoDataFound):
            cur.execute(
                "UPDATE moisture_pins SET wall_segment_id = %s WHERE id = %s",
                (str(wall_b_id), pin_id),
            )
    finally:
        cur.execute("ROLLBACK")


def test_trigger_blocks_cross_tenant_wall_segment_id_update(conn):
    """An UPDATE setting wall_segment_id to a wall owned by a different
    company must raise P0002. Even though RLS would block the SELECT
    of that wall on most code paths, the trigger has to enforce it
    independently — admin tooling and SECURITY DEFINER callers bypass
    RLS but must not bypass tenant isolation."""
    cur = conn.cursor()
    pair = _find_two_rooms_with_walls_same_tenant(cur)
    if not pair:
        pytest.skip(
            "No two rooms with walls — need a starting pin to UPDATE."
        )
    (room_a_id, job_id, company_id, wall_a_id), _ = pair

    foreign = _find_wall_in_other_tenant(cur, company_id)
    if not foreign:
        pytest.skip(
            "No wall in a different company exists — skipping "
            "cross-tenant rejection test."
        )
    foreign_wall_id, _foreign_room_id, _foreign_company_id = foreign

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
            (pin_id, str(job_id), str(room_a_id), str(company_id), str(wall_a_id)),
        )
        cur.execute(
            """
            INSERT INTO moisture_pin_readings (pin_id, company_id, reading_value, taken_at)
            VALUES (%s, %s, 30.0, '2026-04-26T12:00:00Z'::timestamptz)
            """,
            (pin_id, str(company_id)),
        )

        # Foreign wall write must be rejected. The trigger's lookup
        # filter uses NEW.company_id (the pin's tenant) so a wall
        # owned by another tenant fails the EXISTS check.
        with pytest.raises(psycopg2.errors.NoDataFound):
            cur.execute(
                "UPDATE moisture_pins SET wall_segment_id = %s WHERE id = %s",
                (str(foreign_wall_id), pin_id),
            )
    finally:
        cur.execute("ROLLBACK")


def test_trigger_skips_when_wall_segment_id_is_null(conn):
    """Early-return path: NULL wall_segment_id skips the EXISTS check
    (no wall to validate). Floor and ceiling pins go through this
    branch on every write and must not be impacted."""
    cur = conn.cursor()
    pair = _find_two_rooms_with_walls_same_tenant(cur)
    if not pair:
        pytest.skip("No suitable rooms — skipping NULL-skip test.")
    (room_a_id, job_id, company_id, _wall_a_id), _ = pair

    pin_id = str(uuid.uuid4())
    cur.execute("BEGIN")
    try:
        # Floor pin — surface='floor' / wall_segment_id=NULL. Must
        # INSERT cleanly even though the trigger fires.
        cur.execute(
            """
            INSERT INTO moisture_pins (
                id, job_id, room_id, company_id, canvas_x, canvas_y,
                surface, position, wall_segment_id,
                material, dry_standard, created_by
            ) VALUES (%s, %s, %s, %s, 50, 50, 'floor', 'C', NULL, 'drywall', 16.0, NULL)
            """,
            (pin_id, str(job_id), str(room_a_id), str(company_id)),
        )
        cur.execute(
            """
            INSERT INTO moisture_pin_readings (pin_id, company_id, reading_value, taken_at)
            VALUES (%s, %s, 30.0, '2026-04-26T12:00:00Z'::timestamptz)
            """,
            (pin_id, str(company_id)),
        )

        # UPDATE that doesn't touch wall_segment_id — trigger fires
        # only on INSERT or UPDATE OF wall_segment_id, room_id, so a
        # canvas_x update should pass without re-running the lookup
        # (and even if it did, NULL wall_segment_id short-circuits).
        cur.execute(
            "UPDATE moisture_pins SET canvas_x = 75 WHERE id = %s",
            (pin_id,),
        )

        cur.execute(
            "SELECT canvas_x, wall_segment_id FROM moisture_pins WHERE id = %s",
            (pin_id,),
        )
        row = cur.fetchone()
        assert row[0] == 75
        assert row[1] is None
    finally:
        cur.execute("ROLLBACK")
