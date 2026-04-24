"""Integration test for PR-B Step 6 — move_equipment_placement RPC.

Exercises the happy path + every rejection branch. Each test places
then moves then cleans up, so nothing persists in the dev DB.
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
        pytest.skip("DATABASE_URL not reachable")
    url = _resolve_database_url()
    assert url is not None
    c = psycopg2.connect(url)
    c.autocommit = True
    yield c
    c.close()


@pytest.fixture()
def ctx(conn):
    """Find a job with TWO rooms, each with a moisture pin — so we
    can move equipment between them."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT j.id, j.company_id, j.floor_plan_id, u.auth_user_id,
               r1.id as room_a, p1.id as pin_a,
               r2.id as room_b, p2.id as pin_b
          FROM jobs j
          JOIN users u ON u.company_id = j.company_id AND u.deleted_at IS NULL
          JOIN moisture_pins p1 ON p1.job_id = j.id AND p1.dry_standard_met_at IS NULL
          JOIN job_rooms r1 ON r1.id = p1.room_id
          JOIN moisture_pins p2 ON p2.job_id = j.id AND p2.dry_standard_met_at IS NULL
                                AND p2.id != p1.id
          JOIN job_rooms r2 ON r2.id = p2.room_id AND r2.id != r1.id
         WHERE j.deleted_at IS NULL
           AND j.status != 'collected'
           AND j.floor_plan_id IS NOT NULL
           AND u.auth_user_id IS NOT NULL
         LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        pytest.skip("need a job with ≥2 rooms each containing a non-dry pin")
    return {
        "job_id": row[0],
        "company_id": row[1],
        "floor_plan_id": row[2],
        "auth_user_id": row[3],
        "room_a": row[4],
        "pin_a": row[5],
        "room_b": row[6],
        "pin_b": row[7],
    }


def _set_jwt(cur, auth_user_id: str) -> None:
    cur.execute(
        "SELECT set_config('request.jwt.claims', %s, false)",
        (f'{{"sub": "{auth_user_id}"}}',),
    )


def _place_dehu(cur, ctx, room_id, pin_id):
    """Helper — place 1 dehu against the given room + pin, return its id."""
    cur.execute(
        """
        SELECT place_equipment_with_pins(
            %s::uuid, %s::uuid, 'dehumidifier', 'xl', 1,
            100, 100, ARRAY[%s]::uuid[], NULL::text[], NULL::text[]
        )
        """,
        (str(ctx["job_id"]), str(room_id), str(pin_id)),
    )
    return cur.fetchone()[0]["placement_ids"][0]


def _cleanup(cur, placement_id):
    cur.execute(
        "DELETE FROM equipment_pin_assignments WHERE equipment_placement_id = %s",
        (str(placement_id),),
    )
    cur.execute(
        "DELETE FROM equipment_placements WHERE id = %s",
        (str(placement_id),),
    )


def _move(cur, placement_id, new_room, new_pins=None, note=None):
    cur.execute(
        """
        SELECT move_equipment_placement(
            %s::uuid, %s::uuid, 200, 200, %s::uuid[], %s
        )
        """,
        (str(placement_id), str(new_room), new_pins, note),
    )
    return cur.fetchone()[0]


def test_happy_path_moves_placement_and_reassigns(conn, ctx):
    """Place dehu in room A against pin A, move to room B against
    pin B. Old assignment closes with 'equipment_moved', new
    assignment opens, placement's room_id + coords update."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    placement_id = _place_dehu(cur, ctx, ctx["room_a"], ctx["pin_a"])
    try:
        result = _move(cur, placement_id, ctx["room_b"], [str(ctx["pin_b"])])
        assert result["assignments_closed"] == 1
        assert result["assignments_opened"] == 1
        assert result["billing_scope"] == "per_pin"
        # Placement relocated.
        cur.execute(
            "SELECT room_id, canvas_x, canvas_y FROM equipment_placements WHERE id = %s",
            (str(placement_id),),
        )
        room_id, cx, cy = cur.fetchone()
        assert str(room_id) == str(ctx["room_b"])
        assert cx == 200 and cy == 200
        # Old assignment closed with the right reason.
        cur.execute(
            """
            SELECT unassigned_at, unassign_reason
              FROM equipment_pin_assignments
             WHERE equipment_placement_id = %s AND moisture_pin_id = %s
            """,
            (str(placement_id), str(ctx["pin_a"])),
        )
        unassigned_at, reason = cur.fetchone()
        assert unassigned_at is not None
        assert reason == "equipment_moved"
        # New assignment opened + active.
        cur.execute(
            """
            SELECT unassigned_at
              FROM equipment_pin_assignments
             WHERE equipment_placement_id = %s AND moisture_pin_id = %s
            """,
            (str(placement_id), str(ctx["pin_b"])),
        )
        assert cur.fetchone()[0] is None
    finally:
        _cleanup(cur, placement_id)


def test_move_without_new_pins_closes_but_does_not_open(conn, ctx):
    """Moving a per-pin dehu WITHOUT specifying new pins closes the
    old assignments but leaves the placement unassigned in the new
    room. Tech can assign later via a separate call."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    placement_id = _place_dehu(cur, ctx, ctx["room_a"], ctx["pin_a"])
    try:
        result = _move(cur, placement_id, ctx["room_b"], None)
        assert result["assignments_closed"] == 1
        assert result["assignments_opened"] == 0
    finally:
        _cleanup(cur, placement_id)


def test_move_pulled_placement_rejected_22023(conn, ctx):
    """A pulled placement has nothing on-site to move. Rejected
    loudly; silent-succeed would misalign billing."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    placement_id = _place_dehu(cur, ctx, ctx["room_a"], ctx["pin_a"])
    try:
        cur.execute(
            "UPDATE equipment_placements SET pulled_at = now() WHERE id = %s",
            (str(placement_id),),
        )
        with pytest.raises(psycopg2.Error) as exc:
            _move(cur, placement_id, ctx["room_b"], [str(ctx["pin_b"])])
        assert exc.value.pgcode == "22023"
    finally:
        _cleanup(cur, placement_id)


def test_move_to_dry_pin_rejected_22P02_and_rolls_back(conn, ctx):
    """Validation helper rejects dry pins. Whole move rolls back —
    old assignment stays open."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    placement_id = _place_dehu(cur, ctx, ctx["room_a"], ctx["pin_a"])
    try:
        # Flip pin_b dry.
        cur.execute(
            "UPDATE moisture_pins SET dry_standard_met_at = now() WHERE id = %s",
            (str(ctx["pin_b"]),),
        )
        with pytest.raises(psycopg2.Error) as exc:
            _move(cur, placement_id, ctx["room_b"], [str(ctx["pin_b"])])
        assert exc.value.pgcode == "22P02"
        # Rollback check: old assignment to pin_a should STILL be open.
        cur.execute(
            """
            SELECT unassigned_at FROM equipment_pin_assignments
             WHERE equipment_placement_id = %s AND moisture_pin_id = %s
            """,
            (str(placement_id), str(ctx["pin_a"])),
        )
        assert cur.fetchone()[0] is None, "atomic rollback failed"
    finally:
        cur.execute(
            "UPDATE moisture_pins SET dry_standard_met_at = NULL WHERE id = %s",
            (str(ctx["pin_b"]),),
        )
        _cleanup(cur, placement_id)


def test_bogus_placement_id_raises_P0002(conn, ctx):
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    bogus = str(uuid.uuid4())
    with pytest.raises(psycopg2.Error) as exc:
        _move(cur, bogus, ctx["room_b"], [str(ctx["pin_b"])])
    assert exc.value.pgcode == "P0002"


def test_null_params_raise_22023(conn, ctx):
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    with pytest.raises(psycopg2.Error) as exc:
        cur.execute(
            "SELECT move_equipment_placement(NULL::uuid, %s::uuid, 100, 100, NULL::uuid[])",
            (str(ctx["room_b"]),),
        )
    assert exc.value.pgcode == "22023"


def test_per_room_move_with_pin_ids_raises_22023(conn, ctx):
    """Review round-1 H3 regression pin.

    Move on a per-room placement (air scrubber / hydroxyl / heater)
    must reject a non-empty p_new_moisture_pin_ids array. Previously
    silently dropped. Same-PR sibling-miss: place rejected but move
    didn't.
    """
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    # Place a per-room air scrubber in room A.
    cur.execute(
        """
        SELECT place_equipment_with_pins(
            %s::uuid, %s::uuid, 'air_scrubber', NULL, 1,
            100, 100, NULL::uuid[], NULL::text[], NULL::text[]
        )
        """,
        (str(ctx["job_id"]), str(ctx["room_a"])),
    )
    result = cur.fetchone()[0]
    placement_id = result["placement_ids"][0]
    try:
        with pytest.raises(psycopg2.Error) as exc:
            _move(cur, placement_id, ctx["room_b"], [str(ctx["pin_b"])])
        assert exc.value.pgcode == "22023"
    finally:
        _cleanup(cur, placement_id)


def test_cross_job_new_room_id_rejected_P0002(conn, ctx):
    """Review round-1 H1 regression pin (mirror of the place-RPC test).

    Moving to a room on a DIFFERENT job in the same tenant must fail.
    The room FK only validates existence; the cross-job check is what
    keeps equipment from drifting across job boundaries.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT jr.id
          FROM job_rooms jr
         WHERE jr.company_id = %s AND jr.job_id != %s
         LIMIT 1
        """,
        (str(ctx["company_id"]), str(ctx["job_id"])),
    )
    other_room = cur.fetchone()
    if not other_room:
        pytest.skip("no cross-job room available in this tenant")
    other_room_id = str(other_room[0])

    _set_jwt(cur, str(ctx["auth_user_id"]))
    placement_id = _place_dehu(cur, ctx, ctx["room_a"], ctx["pin_a"])
    try:
        with pytest.raises(psycopg2.Error) as exc:
            _move(cur, placement_id, other_room_id, [str(ctx["pin_b"])])
        assert exc.value.pgcode == "P0002"
        # Atomic rollback: old assignment to pin_a must still be open.
        cur.execute(
            """
            SELECT unassigned_at FROM equipment_pin_assignments
             WHERE equipment_placement_id = %s AND moisture_pin_id = %s
            """,
            (str(placement_id), str(ctx["pin_a"])),
        )
        assert cur.fetchone()[0] is None
    finally:
        _cleanup(cur, placement_id)


def test_p_note_stamped_on_closed_and_opened_assignments(conn, ctx):
    """Review round-1 L3 — the narrative note for after-the-fact
    corrections (§0.4 Q3) lands on BOTH the closing row and the
    opening row so the audit trail carries it across the transition."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    placement_id = _place_dehu(cur, ctx, ctx["room_a"], ctx["pin_a"])
    try:
        _move(
            cur, placement_id, ctx["room_b"], [str(ctx["pin_b"])],
            note="moved at adjuster's request",
        )
        # Closing row (pin_a) has the note.
        cur.execute(
            """
            SELECT note FROM equipment_pin_assignments
             WHERE equipment_placement_id = %s AND moisture_pin_id = %s
            """,
            (str(placement_id), str(ctx["pin_a"])),
        )
        assert cur.fetchone()[0] == "moved at adjuster's request"
        # Opening row (pin_b) has the note too.
        cur.execute(
            """
            SELECT note FROM equipment_pin_assignments
             WHERE equipment_placement_id = %s AND moisture_pin_id = %s
            """,
            (str(placement_id), str(ctx["pin_b"])),
        )
        assert cur.fetchone()[0] == "moved at adjuster's request"
    finally:
        _cleanup(cur, placement_id)


def test_floor_plan_id_unchanged_after_move(conn, ctx):
    """Proposal §6.6 — the floor_plan_id stamp is the VERSION the unit
    was drawn on. Moving between rooms on the same job keeps that
    version. Rewriting it here would drift from jobs.floor_plan_id."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    placement_id = _place_dehu(cur, ctx, ctx["room_a"], ctx["pin_a"])
    try:
        cur.execute(
            "SELECT floor_plan_id FROM equipment_placements WHERE id = %s",
            (str(placement_id),),
        )
        before = cur.fetchone()[0]

        _move(cur, placement_id, ctx["room_b"], [str(ctx["pin_b"])])

        cur.execute(
            "SELECT floor_plan_id FROM equipment_placements WHERE id = %s",
            (str(placement_id),),
        )
        after = cur.fetchone()[0]
        assert before == after
    finally:
        _cleanup(cur, placement_id)
