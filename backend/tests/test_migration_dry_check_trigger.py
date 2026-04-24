"""Text-scan guardrails for Spec 01H Phase 3 Step 4 migration.

Pins the trigger contract at the file level. Complemented by the
integration test (test_dry_check_trigger_integration.py) that verifies
runtime behavior against the live DB.
"""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "f4c7e1b9a5d2_spec01h_phase3_dry_check_trigger.py"
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
    assert 'revision: str = "f4c7e1b9a5d2"' in text
    assert 'down_revision: str | None = "e7b9c2f4a8d6"' in text


def test_upgrade_defines_function_and_attaches_trigger() -> None:
    up = _upgrade()
    assert "CREATE OR REPLACE FUNCTION moisture_pin_dry_check()" in up
    assert "CREATE TRIGGER trg_moisture_pin_dry_check" in up
    assert "AFTER INSERT ON moisture_pin_readings" in up
    assert "FOR EACH ROW" in up
    # DROP TRIGGER IF EXISTS before CREATE so re-runs don't fail.
    assert "DROP TRIGGER IF EXISTS trg_moisture_pin_dry_check" in up


def test_trigger_reads_per_pin_dry_standard_not_material_default() -> None:
    """Lesson C3 from the Phase 3 proposal review — the trigger must read
    ``moisture_pins.dry_standard`` (the per-pin override) and NOT a
    material-type lookup. Carrier-accepted custom thresholds have to win."""
    up = _upgrade()
    # Read the pin's stored dry_standard directly.
    assert "SELECT dry_standard, dry_standard_met_at" in up
    assert "FROM moisture_pins" in up
    assert "WHERE id = NEW.pin_id" in up
    # Negative assertion — no material-default lookup.
    assert "DRY_STANDARDS" not in up  # Python service-layer constant
    assert "material =" not in up


def test_trigger_has_out_of_order_guard_with_coalesce_negative_infinity() -> None:
    """Lesson CP3 — a late-sync reading older than what's already stored
    must NOT retroactively change pin state. COALESCE with -infinity is
    required so the FIRST reading (MAX returns NULL) still passes the
    comparison."""
    up = _upgrade()
    # MAX excludes NEW.id so an AFTER-insert trigger doesn't compare to itself.
    assert "MAX(taken_at)" in up
    assert "AND id != NEW.id" in up
    # COALESCE with -infinity handles the null-first-reading case.
    assert "COALESCE(v_max_taken_at, '-infinity'::TIMESTAMPTZ)" in up


def test_trigger_sets_met_at_on_first_dry_reading() -> None:
    up = _upgrade()
    # The set branch: <= standard AND currently not-dry.
    assert "NEW.reading_value <= v_dry_standard AND v_current_met IS NULL" in up
    # The stamped time is the READING's taken_at, not now() — so the
    # recorded dry-time matches field reality even on late syncs.
    assert "SET dry_standard_met_at = NEW.taken_at" in up


def test_trigger_clears_met_at_on_rewet() -> None:
    up = _upgrade()
    # Re-wet branch: > standard AND currently dry.
    assert "NEW.reading_value > v_dry_standard AND v_current_met IS NOT NULL" in up
    # Clears to NULL, not retained.
    assert "SET dry_standard_met_at = NULL" in up


def test_trigger_serializes_concurrent_same_pin_inserts() -> None:
    """Review round-1 M2 regression pin.

    Without a per-pin row lock, two concurrent INSERTs on the same pin
    each see zero other readings under READ COMMITTED snapshot isolation
    and race to write dry_standard_met_at. The FOR NO KEY UPDATE on the
    pin row serializes the trigger body per pin (not across pins, so
    unrelated pin inserts stay parallel)."""
    up = _upgrade()
    # PERFORM (not SELECT INTO) because we're not using the value.
    assert "PERFORM id" in up
    assert "FROM moisture_pins" in up
    assert "WHERE id = NEW.pin_id" in up
    # Lock strength — FOR NO KEY UPDATE is correct for non-PK updates.
    # Pinning the exact string so a reviewer loosening it to SHARE or
    # removing it entirely fails loudly.
    assert "FOR NO KEY UPDATE" in up


def test_trigger_pins_search_path() -> None:
    """SECURITY hardening — every function we install pins search_path
    to prevent the Phase 1 R3 hijack surface."""
    up = _upgrade()
    assert "SET search_path = pg_catalog, public" in up


def test_downgrade_drops_trigger_and_function() -> None:
    down = _downgrade()
    assert "DROP TRIGGER IF EXISTS trg_moisture_pin_dry_check" in down
    assert "DROP FUNCTION IF EXISTS moisture_pin_dry_check()" in down
