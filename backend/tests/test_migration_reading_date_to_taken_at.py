"""Text-scan guardrails for Spec 01H Phase 3 Step 3 (c8f1a3d5b7e9).

Pins the structural shape of the migration that column-swaps
``reading_date DATE`` → ``taken_at TIMESTAMPTZ`` and rewrites the
``create_moisture_pin_with_reading`` RPC signature. Sibling to the
text-scan tests for Steps 1, 2, 4, and the Step 3 follow-ups.

Also pins the lesson #10 asymmetry fix (review round-1 H1): downgrade
must NOT re-introduce ``UNIQUE`` on ``(pin_id, reading_date)`` because
the forward direction explicitly allows multiple same-day readings.
"""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "c8f1a3d5b7e9_spec01h_phase3_reading_date_to_taken_at.py"
)


def _read() -> str:
    return MIGRATION_FILE.read_text(encoding="utf-8")


def _upgrade() -> str:
    return _read().split("DOWNGRADE_SQL")[0]


def _downgrade() -> str:
    return _read().split("DOWNGRADE_SQL")[1]


def test_migration_file_exists() -> None:
    assert MIGRATION_FILE.exists()


def test_revision_identifiers() -> None:
    text = _read()
    assert 'revision: str = "c8f1a3d5b7e9"' in text
    assert 'down_revision: str | None = "b2d4e6f8a1c3"' in text


def test_upgrade_drops_unique_daily_index() -> None:
    """The per-day UNIQUE index is gone — multiple readings per pin per
    day are now allowed (spec §0.2 B1/B3, Brett's post-demo workflow)."""
    up = _upgrade()
    assert "DROP INDEX IF EXISTS idx_pin_reading_date" in up


def test_upgrade_adds_taken_at_column_notnull_with_default() -> None:
    up = _upgrade()
    assert "ADD COLUMN taken_at TIMESTAMPTZ" in up
    # NOT NULL flipped AFTER backfill so the add-column step succeeds first.
    assert "ALTER COLUMN taken_at SET NOT NULL" in up
    assert "ALTER COLUMN taken_at SET DEFAULT now()" in up


def test_upgrade_backfill_preserves_local_calendar_day() -> None:
    """Noon Eastern was chosen so every pre-existing reading keeps its
    logged day regardless of the viewer's timezone. Pinning the string
    so a reviewer changing it to UTC midnight silently shifts days."""
    up = _upgrade()
    assert "reading_date::text || ' 12:00:00'" in up
    assert "AT TIME ZONE 'America/New_York'" in up


def test_upgrade_drops_old_reading_date_column() -> None:
    up = _upgrade()
    assert "DROP COLUMN reading_date" in up


def test_upgrade_creates_descending_index_on_taken_at() -> None:
    """Supports the 'latest reading per pin' access pattern + sparkline
    ordering in one hit. Missing this index degrades list_pins_by_job
    significantly at typical pin counts."""
    up = _upgrade()
    assert (
        "CREATE INDEX idx_pin_reading_taken_at" in up
        and "ON moisture_pin_readings(pin_id, taken_at DESC)" in up
    )


def test_upgrade_rpc_drops_old_signature_before_create() -> None:
    """Lesson #23 + M2 regression pin: DROP FUNCTION with the pre-change
    signature must precede CREATE OR REPLACE so only the new signature
    remains. Two overloads would live in pg_proc otherwise and PostgREST
    would route to the wrong one."""
    up = _upgrade()
    assert "DROP FUNCTION IF EXISTS create_moisture_pin_with_reading(" in up
    assert "NUMERIC, DATE, TEXT, TEXT" in up  # old sig shape


def test_upgrade_rpc_uses_p_taken_at_parameter() -> None:
    up = _upgrade()
    assert "p_taken_at        TIMESTAMPTZ," in up
    # Old param name absent in upgrade body.
    upgrade_only = up.split("CREATE OR REPLACE FUNCTION create_moisture_pin_with_reading")[1]
    assert "p_reading_date" not in upgrade_only


def test_upgrade_rpc_inserts_taken_at_not_reading_date() -> None:
    """Regression pin — the body must INSERT taken_at, not reading_date.
    Wrong column write would lose the TIMESTAMPTZ precision end-to-end."""
    up = _upgrade()
    upgrade_only = up.split("CREATE OR REPLACE FUNCTION create_moisture_pin_with_reading")[1]
    insert_block = upgrade_only.split("INSERT INTO moisture_pin_readings")[1].split(";")[0]
    assert "taken_at" in insert_block
    assert "reading_date" not in insert_block


def test_downgrade_restores_old_rpc_signature() -> None:
    down = _downgrade()
    assert "p_reading_date    DATE" in down
    # And drops the new-signature form first.
    assert "DROP FUNCTION IF EXISTS create_moisture_pin_with_reading(" in down
    assert "NUMERIC, TIMESTAMPTZ, TEXT, TEXT" in down  # new sig


def test_downgrade_restores_non_unique_index_not_unique() -> None:
    """Review round-1 H1 regression pin.

    Forward direction explicitly allows multiple readings per pin per day.
    Restoring a UNIQUE index on downgrade crashes with 23505 the moment
    any pin exercised that workflow, leaving the DB half-rolled-back.
    Per lesson #10's SPIRIT (downgrade must succeed against any lawful
    forward state), the restored index is intentionally non-unique.
    """
    down = _downgrade()
    # The restored index must exist...
    assert "CREATE INDEX idx_pin_reading_date" in down
    assert "ON moisture_pin_readings(pin_id, reading_date)" in down
    # ...but must NOT be UNIQUE. This single substring is the regression pin.
    assert "CREATE UNIQUE INDEX idx_pin_reading_date" not in down


def test_downgrade_adds_reading_date_column_and_backfills() -> None:
    down = _downgrade()
    assert "ADD COLUMN reading_date DATE" in down
    # Backfill from taken_at's local Eastern day.
    assert "(taken_at AT TIME ZONE 'America/New_York')::date" in down
    # Flip NOT NULL after populate.
    assert "ALTER COLUMN reading_date SET NOT NULL" in down


def test_downgrade_drops_taken_at_column() -> None:
    down = _downgrade()
    assert "DROP COLUMN taken_at" in down


def test_no_stray_p_company_id_anti_pattern() -> None:
    """Lesson §3 — new SECURITY DEFINER bodies must use get_my_company_id(),
    not trust caller-supplied p_company_id alone. Regression pin."""
    text = _read()
    assert "get_my_company_id()" in text
    # Comparison between caller's JWT-derived company and passed parameter
    # must be present in both upgrade + downgrade bodies.
    assert text.count("v_caller_company <> p_company_id") >= 2
