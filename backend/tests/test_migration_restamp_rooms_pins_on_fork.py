"""Text-scan guardrails for the fork-restamp permanent fix migration.

Pins the two UPDATE statements the new save_floor_plan_version body adds so
any later CREATE OR REPLACE that drops them trips this test. Also verifies
the downgrade restores a body that does NOT have those UPDATEs, so rolling
back gets us back to the pre-fix behavior (not a different one).
"""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "e7b9c2f4a8d6_spec01h_phase3_restamp_rooms_pins_on_fork.py"
)


def _read() -> str:
    return MIGRATION_FILE.read_text(encoding="utf-8")


def _upgrade_block() -> str:
    text = _read()
    return text.split("DOWNGRADE_SQL")[0]


def _downgrade_block() -> str:
    text = _read()
    return text.split("DOWNGRADE_SQL")[1]


def test_migration_file_exists() -> None:
    assert MIGRATION_FILE.exists()


def test_revision_identifiers_present() -> None:
    text = _read()
    assert 'revision: str = "e7b9c2f4a8d6"' in text
    assert 'down_revision: str | None = "d3e5a7c9b1f4"' in text


def test_upgrade_restamps_job_rooms_on_fork() -> None:
    """The new RPC body must UPDATE job_rooms to the new version id, scoped to
    the caller job + floor. Missing this statement reintroduces the drift."""
    up = _upgrade_block()
    assert "UPDATE job_rooms jr" in up
    assert "SET floor_plan_id = v_new_row.id" in up
    # Scoped to the saving job (sibling jobs keep their frozen version):
    assert "AND jr.job_id = p_job_id" in up
    # Matched by (property_id, floor_number) so multi-hop drift resolves too:
    assert "AND fp.property_id = p_property_id" in up
    assert "AND fp.floor_number = p_floor_number" in up


def test_upgrade_restamps_moisture_pins_on_fork() -> None:
    up = _upgrade_block()
    assert "UPDATE moisture_pins mp" in up
    # Scoped to the saving job — symmetric with the rooms UPDATE.
    assert "AND mp.job_id = p_job_id" in up


def test_downgrade_removes_restamp_statements() -> None:
    """Downgrade restores the prior RPC body. That body must NOT contain the
    new UPDATEs — otherwise rollback is a no-op and we can't recover the
    pre-fix behavior to debug against."""
    down = _downgrade_block()
    assert "UPDATE job_rooms jr" not in down
    assert "UPDATE moisture_pins mp" not in down


def test_tenant_check_uses_jwt_not_params() -> None:
    """Lesson §3/C4 — SECURITY DEFINER derives tenant from the JWT, never
    from a caller-supplied p_company_id on its own. Regression pin."""
    up = _upgrade_block()
    assert "v_caller_company := get_my_company_id()" in up
    # The match check must be present — comparing JWT company vs the
    # passed p_company_id. Missing this check means a caller could
    # claim another tenant's company id.
    assert "v_caller_company <> p_company_id" in up


def test_search_path_pinned() -> None:
    """Every SECURITY DEFINER function must pin search_path — prevents the
    Phase 1 R3 hijack surface."""
    up = _upgrade_block()
    assert "SET search_path = pg_catalog, public" in up
