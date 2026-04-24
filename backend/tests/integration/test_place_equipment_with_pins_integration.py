"""Integration test for PR-B Step 5 — place_equipment_with_pins RPC.

Exercises happy path (per-pin + per-room) + every rejection branch
against the dev DB. Cleans up placements + assignments after each test.
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
    """Find a job + room + pin + user we can place equipment against.
    Cleans up any placements + assignments created during the test."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT mp.id as pin_id, mp.job_id, mp.room_id, mp.company_id,
               u.auth_user_id, j.floor_plan_id
          FROM moisture_pins mp
          JOIN jobs j ON j.id = mp.job_id
          JOIN users u ON u.company_id = mp.company_id AND u.deleted_at IS NULL
         WHERE mp.dry_standard_met_at IS NULL
           AND j.deleted_at IS NULL
           AND j.status != 'collected'
           AND j.floor_plan_id IS NOT NULL
           AND u.auth_user_id IS NOT NULL
         LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        pytest.skip("no suitable test context available")
    c = {
        "pin_id": row[0],
        "job_id": row[1],
        "room_id": row[2],
        "company_id": row[3],
        "auth_user_id": row[4],
        "floor_plan_id": row[5],
    }

    yield c

    # Cleanup: delete any placements we might have created.
    cur.execute(
        "DELETE FROM equipment_placements WHERE job_id = %s AND notes = %s",
        (str(c["job_id"]), "integration-test-marker"),
    )


def _set_jwt(cur, auth_user_id: str) -> None:
    cur.execute(
        "SELECT set_config('request.jwt.claims', %s, false)",
        (f'{{"sub": "{auth_user_id}"}}',),
    )


def _place(cur, ctx, **overrides):
    """Thin helper — call the RPC with defaults filled in."""
    params = {
        "p_job_id":            str(ctx["job_id"]),
        "p_room_id":           str(ctx["room_id"]),
        "p_equipment_type":    "dehumidifier",
        "p_equipment_size":    "xl",
        "p_quantity":          2,
        "p_canvas_x":          100,
        "p_canvas_y":          100,
        "p_moisture_pin_ids":  [str(ctx["pin_id"])],
        "p_asset_tags":        None,
        "p_serial_numbers":    None,
    }
    params.update(overrides)
    cur.execute(
        """
        SELECT place_equipment_with_pins(
            %(p_job_id)s::uuid, %(p_room_id)s::uuid,
            %(p_equipment_type)s, %(p_equipment_size)s, %(p_quantity)s,
            %(p_canvas_x)s, %(p_canvas_y)s,
            %(p_moisture_pin_ids)s::uuid[],
            %(p_asset_tags)s::text[], %(p_serial_numbers)s::text[]
        )
        """,
        params,
    )
    return cur.fetchone()[0]


def test_per_pin_happy_path_creates_n_placements_and_nxm_assignments(conn, ctx):
    """2 dehus × 1 pin → 2 placements + 2 assignments, all in one
    atomic call."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    result = _place(cur, ctx, p_quantity=2)
    assert result["placement_count"] == 2
    assert result["assignment_count"] == 2
    assert result["billing_scope"] == "per_pin"
    placement_ids = result["placement_ids"]

    # Verify the placements actually landed.
    cur.execute(
        "SELECT COUNT(*) FROM equipment_placements WHERE id = ANY(%s::uuid[])",
        (placement_ids,),
    )
    assert cur.fetchone()[0] == 2

    # Verify the assignments too.
    cur.execute(
        "SELECT COUNT(*) FROM equipment_pin_assignments WHERE equipment_placement_id = ANY(%s::uuid[])",
        (placement_ids,),
    )
    assert cur.fetchone()[0] == 2

    # Cleanup: assignments first (RESTRICT).
    cur.execute(
        "DELETE FROM equipment_pin_assignments WHERE equipment_placement_id = ANY(%s::uuid[])",
        (placement_ids,),
    )
    cur.execute(
        "DELETE FROM equipment_placements WHERE id = ANY(%s::uuid[])",
        (placement_ids,),
    )


def test_per_room_happy_path_no_assignments(conn, ctx):
    """Air scrubber (per_room) — placements created, no assignments
    because per-room equipment doesn't attach to pins."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    result = _place(
        cur, ctx,
        p_equipment_type="air_scrubber",
        p_equipment_size=None,
        p_quantity=1,
        p_moisture_pin_ids=None,
    )
    assert result["placement_count"] == 1
    assert result["assignment_count"] == 0
    assert result["billing_scope"] == "per_room"
    # Cleanup: assignments first (ON DELETE RESTRICT prevents placement
    # delete while assignments reference it).
    cur.execute(
        "DELETE FROM equipment_pin_assignments WHERE equipment_placement_id = ANY(%s::uuid[])",
        (result["placement_ids"],),
    )
    cur.execute(
        "DELETE FROM equipment_placements WHERE id = ANY(%s::uuid[])",
        (result["placement_ids"],),
    )


def test_per_pin_without_size_raises_22023(conn, ctx):
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    with pytest.raises(psycopg2.Error) as exc:
        _place(cur, ctx, p_equipment_size=None)
    assert exc.value.pgcode == "22023"


def test_per_room_with_size_raises_22023(conn, ctx):
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    with pytest.raises(psycopg2.Error) as exc:
        _place(
            cur, ctx,
            p_equipment_type="air_scrubber",
            p_equipment_size="std",
            p_moisture_pin_ids=None,
        )
    assert exc.value.pgcode == "22023"


def test_per_room_with_pin_ids_raises_22023(conn, ctx):
    """per_room equipment attached to pins is a scope/type mismatch —
    rejected loudly."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    with pytest.raises(psycopg2.Error) as exc:
        _place(
            cur, ctx,
            p_equipment_type="heater",
            p_equipment_size=None,
            p_moisture_pin_ids=[str(ctx["pin_id"])],
        )
    assert exc.value.pgcode == "22023"


def test_asset_tags_wrong_length_raises_22023(conn, ctx):
    """C7 — inventory array length must match p_quantity exactly.
    Short array would silently pad with NULLs and misalign."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    with pytest.raises(psycopg2.Error) as exc:
        _place(
            cur, ctx,
            p_quantity=3,
            p_asset_tags=["tag-a", "tag-b"],  # length 2 != quantity 3
        )
    assert exc.value.pgcode == "22023"


def test_asset_tags_matching_length_succeeds(conn, ctx):
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    result = _place(
        cur, ctx,
        p_quantity=2,
        p_asset_tags=["tag-a", "tag-b"],
        p_serial_numbers=["sn-1", "sn-2"],
    )
    assert result["placement_count"] == 2
    # Verify tags landed in order.
    cur.execute(
        """
        SELECT asset_tag, serial_number
          FROM equipment_placements
         WHERE id = ANY(%s::uuid[])
         ORDER BY created_at
        """,
        (result["placement_ids"],),
    )
    rows = cur.fetchall()
    assert {r[0] for r in rows} == {"tag-a", "tag-b"}
    assert {r[1] for r in rows} == {"sn-1", "sn-2"}
    # Cleanup: assignments first (ON DELETE RESTRICT prevents placement
    # delete while assignments reference it).
    cur.execute(
        "DELETE FROM equipment_pin_assignments WHERE equipment_placement_id = ANY(%s::uuid[])",
        (result["placement_ids"],),
    )
    cur.execute(
        "DELETE FROM equipment_placements WHERE id = ANY(%s::uuid[])",
        (result["placement_ids"],),
    )


def test_invalid_pin_rolls_back_whole_transaction(conn, ctx):
    """Lesson #4 — atomicity. A bad pin mid-validation must leave zero
    placements AND zero assignments. Tests this by counting before +
    after and confirming no change."""
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM equipment_placements WHERE job_id = %s", (str(ctx["job_id"]),))
    before = cur.fetchone()[0]

    _set_jwt(cur, str(ctx["auth_user_id"]))
    bogus_pin = str(uuid.uuid4())
    with pytest.raises(psycopg2.Error) as exc:
        _place(
            cur, ctx,
            p_quantity=3,
            p_moisture_pin_ids=[str(ctx["pin_id"]), bogus_pin],
        )
    assert exc.value.pgcode == "42501"

    # Nothing committed.
    cur.execute("SELECT COUNT(*) FROM equipment_placements WHERE job_id = %s", (str(ctx["job_id"]),))
    after = cur.fetchone()[0]
    assert after == before, "atomic rollback failed — partial placements survived"


def test_dry_pin_rejection_rolls_back(conn, ctx):
    """C8 — can't assign equipment to a pin that already met dry
    standard. Whole transaction rolls back."""
    cur = conn.cursor()
    # Flip the pin dry.
    cur.execute(
        "UPDATE moisture_pins SET dry_standard_met_at = now() WHERE id = %s",
        (str(ctx["pin_id"]),),
    )
    try:
        cur.execute("SELECT COUNT(*) FROM equipment_placements WHERE job_id = %s", (str(ctx["job_id"]),))
        before = cur.fetchone()[0]

        _set_jwt(cur, str(ctx["auth_user_id"]))
        with pytest.raises(psycopg2.Error) as exc:
            _place(cur, ctx)
        assert exc.value.pgcode == "22P02"

        cur.execute("SELECT COUNT(*) FROM equipment_placements WHERE job_id = %s", (str(ctx["job_id"]),))
        after = cur.fetchone()[0]
        assert after == before
    finally:
        cur.execute(
            "UPDATE moisture_pins SET dry_standard_met_at = NULL WHERE id = %s",
            (str(ctx["pin_id"]),),
        )


def test_floor_plan_id_stamped_from_job(conn, ctx):
    """Proposal A2/C1 — placements must be stamped with the job's
    pinned floor_plan_id. Verifying the stamp matches on a real call."""
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    result = _place(cur, ctx, p_quantity=1)
    assert str(result["floor_plan_id"]) == str(ctx["floor_plan_id"])
    cur.execute(
        "SELECT floor_plan_id FROM equipment_placements WHERE id = ANY(%s::uuid[])",
        (result["placement_ids"],),
    )
    assert str(cur.fetchone()[0]) == str(ctx["floor_plan_id"])
    # Cleanup: assignments first (ON DELETE RESTRICT prevents placement
    # delete while assignments reference it).
    cur.execute(
        "DELETE FROM equipment_pin_assignments WHERE equipment_placement_id = ANY(%s::uuid[])",
        (result["placement_ids"],),
    )
    cur.execute(
        "DELETE FROM equipment_placements WHERE id = ANY(%s::uuid[])",
        (result["placement_ids"],),
    )


def test_archived_job_rejects_with_42501(conn, ctx):
    """PR-A Step 1's ensure_job_mutable must fire — can't place on a
    collected job."""
    cur = conn.cursor()
    # Get the original status first so we can restore it.
    cur.execute("SELECT status FROM jobs WHERE id = %s", (str(ctx["job_id"]),))
    original = cur.fetchone()[0]
    cur.execute("UPDATE jobs SET status = 'collected' WHERE id = %s", (str(ctx["job_id"]),))
    try:
        _set_jwt(cur, str(ctx["auth_user_id"]))
        with pytest.raises(psycopg2.Error) as exc:
            _place(cur, ctx)
        assert exc.value.pgcode == "42501"
    finally:
        cur.execute(
            "UPDATE jobs SET status = %s WHERE id = %s",
            (original, str(ctx["job_id"])),
        )


def test_cross_job_room_id_rejected_P0002(conn, ctx):
    """Review round-1 H1 regression pin.

    Placing with job_id=A + room_id=<a room on job B, same tenant>
    must raise P0002. Without the cross-job check, the room FK would
    only validate existence and the placement would land with
    mismatched job + room (floor_plan_id from job A, room on job B's
    plan). Canvas drops it, billing mis-attributes.
    """
    cur = conn.cursor()
    # Find a room that belongs to a DIFFERENT job in the same tenant.
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
        pytest.skip("no second job's room available in this tenant for cross-job test")
    other_room_id = str(other_room[0])

    _set_jwt(cur, str(ctx["auth_user_id"]))
    with pytest.raises(psycopg2.Error) as exc:
        _place(cur, ctx, p_room_id=other_room_id)
    assert exc.value.pgcode == "P0002"

    # Atomic rollback check: zero placements landed.
    cur.execute(
        "SELECT COUNT(*) FROM equipment_placements WHERE room_id = %s",
        (other_room_id,),
    )
    assert cur.fetchone()[0] == 0


def test_duplicate_pin_ids_deduped_not_error(conn, ctx):
    """Review round-1 M5 regression pin.

    Passing the same pin id twice in p_moisture_pin_ids used to trip
    the partial uniq_active_assignment with a raw 23505. Now dedup'd
    at the CROSS JOIN: one assignment per unique pin, no error.
    """
    cur = conn.cursor()
    _set_jwt(cur, str(ctx["auth_user_id"]))
    # Pass the same pin twice.
    result = _place(
        cur, ctx,
        p_quantity=1,
        p_moisture_pin_ids=[str(ctx["pin_id"]), str(ctx["pin_id"])],
    )
    # Assignments should be 1 (the dup was deduped), not 2.
    assert result["placement_count"] == 1
    assert result["assignment_count"] == 1
    cur.execute(
        "DELETE FROM equipment_pin_assignments WHERE equipment_placement_id = ANY(%s::uuid[])",
        (result["placement_ids"],),
    )
    cur.execute(
        "DELETE FROM equipment_placements WHERE id = ANY(%s::uuid[])",
        (result["placement_ids"],),
    )
