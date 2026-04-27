"""Integration test: dry-check trigger runtime behavior (Phase 3 Step 4).

Text-scan in ``test_migration_dry_check_trigger.py`` pins the SQL literal
in the migration file. This test actually exercises the installed trigger
end-to-end against the dev DB, catching runtime contract bugs the file
scan can't — out-of-order-read semantics, re-wet clears, first-reading
behavior when no prior reading exists.

Uses a throwaway pin + readings the test creates and cleans up. Reads
and writes through a direct psycopg2 connection with the service-role
URL (respects RLS only where policies permit — but since the trigger
fires on INSERT via the same path the API uses, the RLS path is the
meaningful one anyway).
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
    """Autocommit connection to the dev DB, or skip if unreachable."""
    if not _db_reachable():
        pytest.skip("DATABASE_URL not reachable — skipping integration test")
    url = _resolve_database_url()
    assert url is not None
    c = psycopg2.connect(url)
    c.autocommit = True
    yield c
    c.close()


@pytest.fixture()
def scratch_pin(conn):
    """Create a throwaway pin + a single initial reading for the test to
    manipulate. Tears the pin + all its readings down after the test —
    the moisture_pin_readings FK cascades on pin delete so we only need
    one DELETE statement for cleanup.
    """
    cur = conn.cursor()
    # Find an existing job + room to anchor the pin against. Any room
    # whose job is active will do — pick the most-recently touched so
    # we don't collide with ancient fixture data.
    cur.execute(
        """
        SELECT jr.id as room_id, jr.job_id, jr.company_id
          FROM job_rooms jr
          JOIN jobs j ON j.id = jr.job_id AND j.deleted_at IS NULL
         WHERE jr.floor_plan_id IS NOT NULL
         ORDER BY jr.updated_at DESC
         LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        pytest.skip("no active room with floor_plan available for fixture")
    room_id, job_id, company_id = row

    pin_id = str(uuid.uuid4())
    # dry_standard = 16 (drywall default). Initial reading 30 — wet,
    # so dry_standard_met_at starts NULL naturally. The test sets up
    # different scenarios on top of this baseline.
    cur.execute(
        """
        INSERT INTO moisture_pins (
            id, job_id, room_id, company_id,
            canvas_x, canvas_y,
            surface, position, wall_segment_id,
            material, dry_standard, created_by
        ) VALUES (
            %s, %s, %s, %s, 100, 100,
            'floor', 'C', NULL,
            'drywall', 16.0, NULL
        )
        """,
        (pin_id, job_id, room_id, company_id),
    )
    cur.execute(
        """
        INSERT INTO moisture_pin_readings (
            pin_id, company_id, reading_value, taken_at
        ) VALUES (
            %s, %s, 30.0, '2026-04-20T12:00:00Z'::timestamptz
        )
        """,
        (pin_id, company_id),
    )

    yield {"pin_id": pin_id, "company_id": company_id}

    cur.execute("DELETE FROM moisture_pins WHERE id = %s", (pin_id,))


def _met_at(conn, pin_id: str) -> str | None:
    cur = conn.cursor()
    cur.execute(
        "SELECT dry_standard_met_at FROM moisture_pins WHERE id = %s",
        (pin_id,),
    )
    row = cur.fetchone()
    return row[0] if row else None


def test_wet_reading_leaves_met_at_null(conn, scratch_pin):
    """Initial reading was 30 (wet). The trigger should NOT have set
    dry_standard_met_at — it stays NULL until a reading crosses."""
    assert _met_at(conn, scratch_pin["pin_id"]) is None


def test_dry_reading_sets_met_at_to_reading_taken_at(conn, scratch_pin):
    """A reading ≤ dry_standard while the pin is currently not-dry sets
    dry_standard_met_at to THAT reading's taken_at (not now())."""
    cur = conn.cursor()
    dry_ts = "2026-04-22T14:30:00Z"
    cur.execute(
        """
        INSERT INTO moisture_pin_readings (
            pin_id, company_id, reading_value, taken_at
        ) VALUES (%s, %s, 12.0, %s::timestamptz)
        """,
        (scratch_pin["pin_id"], scratch_pin["company_id"], dry_ts),
    )
    met = _met_at(conn, scratch_pin["pin_id"])
    assert met is not None, "trigger did not set dry_standard_met_at"
    # Stamp equals the reading's taken_at, not server now().
    assert met.isoformat().startswith("2026-04-22T14:30:00")


def test_rewet_clears_met_at(conn, scratch_pin):
    """Dry pin getting a wetter reading clears the stamp back to NULL."""
    cur = conn.cursor()
    # First, go dry.
    cur.execute(
        """
        INSERT INTO moisture_pin_readings (
            pin_id, company_id, reading_value, taken_at
        ) VALUES (%s, %s, 12.0, '2026-04-22T12:00:00Z'::timestamptz)
        """,
        (scratch_pin["pin_id"], scratch_pin["company_id"]),
    )
    assert _met_at(conn, scratch_pin["pin_id"]) is not None

    # Then re-wet.
    cur.execute(
        """
        INSERT INTO moisture_pin_readings (
            pin_id, company_id, reading_value, taken_at
        ) VALUES (%s, %s, 22.0, '2026-04-23T09:00:00Z'::timestamptz)
        """,
        (scratch_pin["pin_id"], scratch_pin["company_id"]),
    )
    assert _met_at(conn, scratch_pin["pin_id"]) is None


def test_out_of_order_dry_reading_does_not_overwrite_wet_state(conn, scratch_pin):
    """A late-sync reading with an EARLIER taken_at than the latest must
    not retroactively change pin state. If the pin's current reading is
    wet, a backfilled older reading that happens to be dry doesn't flip
    it to dry."""
    cur = conn.cursor()
    # Latest reading on scratch_pin is 30% at 2026-04-20. Insert a wetter
    # reading AFTER that (to make sure state is wet).
    cur.execute(
        """
        INSERT INTO moisture_pin_readings (
            pin_id, company_id, reading_value, taken_at
        ) VALUES (%s, %s, 25.0, '2026-04-21T12:00:00Z'::timestamptz)
        """,
        (scratch_pin["pin_id"], scratch_pin["company_id"]),
    )
    assert _met_at(conn, scratch_pin["pin_id"]) is None

    # Now insert a late-sync reading DATED earlier than both existing
    # readings, but with a dry value. Trigger must skip — the pin's
    # current state reflects the newer reading.
    cur.execute(
        """
        INSERT INTO moisture_pin_readings (
            pin_id, company_id, reading_value, taken_at
        ) VALUES (%s, %s, 10.0, '2026-04-18T12:00:00Z'::timestamptz)
        """,
        (scratch_pin["pin_id"], scratch_pin["company_id"]),
    )
    # State unchanged — the stale reading didn't flip it to dry.
    assert _met_at(conn, scratch_pin["pin_id"]) is None


def test_first_reading_for_new_pin_fires_trigger(conn):
    """Regression pin for CP3 / COALESCE(-infinity) — when a pin has NO
    prior readings, MAX(taken_at) is NULL and a naive comparison would
    skip the trigger. COALESCE with -infinity lets the first reading pass."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT jr.id as room_id, jr.job_id, jr.company_id
          FROM job_rooms jr
          JOIN jobs j ON j.id = jr.job_id AND j.deleted_at IS NULL
         WHERE jr.floor_plan_id IS NOT NULL
         ORDER BY jr.updated_at DESC
         LIMIT 1
        """
    )
    room_id, job_id, company_id = cur.fetchone()
    pin_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO moisture_pins (
            id, job_id, room_id, company_id, canvas_x, canvas_y,
            surface, position, wall_segment_id,
            material, dry_standard, created_by
        ) VALUES (
            %s, %s, %s, %s, 90, 90,
            'floor', 'C', NULL,
            'drywall', 16.0, NULL
        )
        """,
        (pin_id, job_id, room_id, company_id),
    )
    try:
        cur.execute(
            """
            INSERT INTO moisture_pin_readings (
                pin_id, company_id, reading_value, taken_at
            ) VALUES (%s, %s, 10.0, '2026-04-22T12:00:00Z'::timestamptz)
            """,
            (pin_id, company_id),
        )
        met = _met_at(conn, pin_id)
        assert met is not None, "first-reading dry did not fire — COALESCE guard broken"
    finally:
        cur.execute("DELETE FROM moisture_pins WHERE id = %s", (pin_id,))


def test_per_pin_dry_standard_override_honored(conn):
    """Lesson C3 pin — the trigger must use the pin's OWN dry_standard,
    not a material default. A pin with custom threshold 40 should
    flip dry at a reading of 35 (well above the drywall default of 16)."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT jr.id as room_id, jr.job_id, jr.company_id
          FROM job_rooms jr
          JOIN jobs j ON j.id = jr.job_id AND j.deleted_at IS NULL
         WHERE jr.floor_plan_id IS NOT NULL
         ORDER BY jr.updated_at DESC
         LIMIT 1
        """
    )
    room_id, job_id, company_id = cur.fetchone()
    pin_id = str(uuid.uuid4())
    # Use drywall material but override dry_standard to 40 — the
    # material default for drywall is 16, so if the trigger was reading
    # the material instead of the column, 35 would still be "wet".
    cur.execute(
        """
        INSERT INTO moisture_pins (
            id, job_id, room_id, company_id, canvas_x, canvas_y,
            surface, position, wall_segment_id,
            material, dry_standard, created_by
        ) VALUES (
            %s, %s, %s, %s, 50, 50,
            'floor', 'C', NULL,
            'drywall', 40.0, NULL
        )
        """,
        (pin_id, job_id, room_id, company_id),
    )
    try:
        cur.execute(
            """
            INSERT INTO moisture_pin_readings (
                pin_id, company_id, reading_value, taken_at
            ) VALUES (%s, %s, 35.0, '2026-04-22T12:00:00Z'::timestamptz)
            """,
            (pin_id, company_id),
        )
        # 35 ≤ 40 (override) — should flip dry even though 35 > 16 (default).
        assert _met_at(conn, pin_id) is not None, (
            "trigger read material default (16) instead of per-pin override (40)"
        )
    finally:
        cur.execute("DELETE FROM moisture_pins WHERE id = %s", (pin_id,))
