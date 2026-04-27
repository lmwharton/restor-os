"""Text-scan guardrails for migration e4d5f6a7b8c9 — the wall_segment_id
↔ room_id binding trigger that closes the lesson-#32 paired-write
asymmetry between create RPC and update path.

Mirrors the existing ``test_migration_moisture_pins_surface_position_wall.py``
shape: pure text-scan, no DB. The trigger's runtime semantics are
exercised by the smoke probe documented in the migration's docstring;
this file just guarantees the migration file ships the right SQL and
the symmetric downgrade.
"""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "e4d5f6a7b8c9_spec01h_phase2_wall_segment_binding_trigger.py"
)


def _read() -> str:
    return MIGRATION_FILE.read_text(encoding="utf-8")


def test_migration_file_exists() -> None:
    assert MIGRATION_FILE.exists(), f"missing migration file: {MIGRATION_FILE}"


def test_revision_chain() -> None:
    text = _read()
    assert 'revision: str = "e4d5f6a7b8c9"' in text
    # Chains directly off the position-NOT-NULL migration so the
    # trigger lands after the column constraints are settled.
    assert 'down_revision: str | None = "e3c4d5f6a7b8"' in text


def test_trigger_function_creates_check_against_wall_segments() -> None:
    text = _read()
    upgrade = text.split("UPGRADE_SQL")[1].split("DOWNGRADE_SQL")[0]
    # Lesson #30 invariant lives in this SELECT — wall existence (FK) is
    # not enough; parent-room + tenant binding are separate predicates.
    assert "FROM wall_segments" in upgrade
    assert "WHERE id = NEW.wall_segment_id" in upgrade
    assert "AND room_id = NEW.room_id" in upgrade
    assert "AND company_id = NEW.company_id" in upgrade


def test_trigger_skips_when_wall_segment_id_is_null() -> None:
    text = _read()
    upgrade = text.split("UPGRADE_SQL")[1].split("DOWNGRADE_SQL")[0]
    # Skip path keeps the trigger free for non-wall surfaces and for
    # wall pins in draft state (no segment picked yet).
    assert "IF NEW.wall_segment_id IS NULL THEN" in upgrade
    assert "RETURN NEW;" in upgrade


def test_trigger_raises_p0002_on_mismatch() -> None:
    text = _read()
    upgrade = text.split("UPGRADE_SQL")[1].split("DOWNGRADE_SQL")[0]
    # Same SQLSTATE the create RPC raises — keeps the API-edge catch
    # site uniform across both paths (lesson #5 / #32).
    assert "USING ERRCODE = 'P0002'" in upgrade


def test_trigger_runs_before_insert_or_update() -> None:
    text = _read()
    upgrade = text.split("UPGRADE_SQL")[1].split("DOWNGRADE_SQL")[0]
    # BEFORE blocks the write rather than racing to repair afterward.
    # Scoped to UPDATE OF (wall_segment_id, room_id) — UPDATEs that
    # don't touch those columns shouldn't fire the trigger.
    assert "BEFORE INSERT OR UPDATE OF wall_segment_id, room_id" in upgrade


def test_downgrade_drops_trigger_and_function() -> None:
    text = _read()
    downgrade = text.split("DOWNGRADE_SQL")[1]
    assert "DROP TRIGGER IF EXISTS trg_moisture_pin_wall_segment_binding" in downgrade
    assert "DROP FUNCTION IF EXISTS validate_moisture_pin_wall_segment_binding()" in downgrade
