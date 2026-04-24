"""Text-scan guardrails for the Spec 01H Phase 3 Step 1 migration.

Asserts the migration file declares BOTH the upgrade (ADD COLUMN timezone) and
the matching downgrade (DROP COLUMN timezone). Pins lesson #10 from
``docs/pr-review-lessons.md`` — every ``CREATE/ADD`` in UPGRADE_SQL needs a
symmetric reverse in DOWNGRADE_SQL so ``alembic downgrade -1`` doesn't crash.

Runs in plain pytest — no Alembic context or DB required — so CI catches a
regression even on machines that can't apply the migration chain.
"""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "7a1f3b2c9d0e_spec01h_phase3_jobs_timezone.py"
)


def _read() -> str:
    return MIGRATION_FILE.read_text(encoding="utf-8")


def test_migration_file_exists() -> None:
    assert MIGRATION_FILE.exists(), f"missing migration file: {MIGRATION_FILE}"


def test_revision_identifiers_present() -> None:
    text = _read()
    assert 'revision: str = "7a1f3b2c9d0e"' in text
    assert 'down_revision: str | None = "f1e2d3c4b5a6"' in text


def test_upgrade_adds_timezone_column_not_null_with_default() -> None:
    text = _read()
    # Pin the three load-bearing pieces independently — a reviewer loosening
    # any one of them (dropping NOT NULL, removing the default, renaming the
    # column) fails a specific assertion rather than a generic substring.
    assert "ALTER TABLE jobs" in text
    assert "ADD COLUMN timezone TEXT NOT NULL" in text
    assert "DEFAULT 'America/New_York'" in text


def test_downgrade_drops_timezone_column() -> None:
    """Lesson #10 symmetry pin — missing downgrade = broken rollback."""
    text = _read()
    assert "DROP COLUMN timezone" in text


def test_no_stray_company_id_param_anti_pattern() -> None:
    """Lesson §3 — no SECURITY DEFINER RPCs here, but guard against drift
    if someone later adds one to this migration without reading the rules."""
    text = _read()
    assert "p_company_id" not in text
