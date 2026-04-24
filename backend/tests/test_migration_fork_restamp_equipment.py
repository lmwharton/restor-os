"""Text-scan guardrails for PR-B Step 8 — fork-restamp extension for equipment."""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "b7d9f1a3c5e8_spec01h_phase3_fork_restamp_equipment.py"
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
    assert 'revision: str = "b7d9f1a3c5e8"' in text
    assert 'down_revision: str | None = "c5e7a9b1d3f6"' in text


def test_upgrade_adds_equipment_placements_restamp() -> None:
    """The load-bearing line. Without this UPDATE, equipment placements
    inherit the same drift moisture_pins had before PR-A's fix —
    orphaned against old floor_plan_id when this job forks."""
    up = _upgrade()
    assert "UPDATE equipment_placements ep" in up
    assert "SET floor_plan_id = v_new_row.id" in up
    assert "AND ep.job_id = p_job_id" in up
    assert "AND fp.property_id = p_property_id" in up
    assert "AND fp.floor_number = p_floor_number" in up


def test_upgrade_preserves_existing_two_restamps() -> None:
    """PR-A's UPDATEs for job_rooms + moisture_pins must still be
    there — this migration EXTENDS the set, doesn't replace it."""
    up = _upgrade()
    assert "UPDATE job_rooms jr" in up
    assert "UPDATE moisture_pins mp" in up
    assert "UPDATE equipment_placements ep" in up


def test_downgrade_removes_equipment_restamp_but_keeps_pr_a_pair() -> None:
    """Downgrade restores the PR-A body (2 UPDATEs, not 0 or 3)."""
    down = _downgrade()
    assert "UPDATE equipment_placements" not in down
    assert "UPDATE job_rooms jr" in down
    assert "UPDATE moisture_pins mp" in down


def test_security_definer_and_search_path_pinned() -> None:
    up = _upgrade()
    assert "SECURITY DEFINER" in up
    assert "SET search_path = pg_catalog, public" in up


def test_tenant_from_jwt_preserved() -> None:
    """Sanity — the existing tenant derivation from JWT must not have
    been accidentally removed when copying the body for the extension."""
    up = _upgrade()
    assert "v_caller_company := get_my_company_id()" in up
    assert "v_caller_company <> p_company_id" in up
