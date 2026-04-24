"""Text-scan guardrails for PR-B Step 4 — validate_pins_for_assignment RPC."""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "e6a8c0b2d4f7_spec01h_phase3_validate_pins_for_assignment.py"
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
    assert 'revision: str = "e6a8c0b2d4f7"' in text
    assert 'down_revision: str | None = "d4f6b8a0c2e5"' in text


def test_signature() -> None:
    up = _upgrade()
    assert (
        "CREATE OR REPLACE FUNCTION validate_pins_for_assignment(\n"
        "    p_job_id            UUID,\n"
        "    p_moisture_pin_ids  UUID[]\n"
        ") RETURNS VOID" in up
    )


def test_empty_array_is_noop() -> None:
    """Per-room equipment has no pins. An empty or NULL array must
    return cleanly so the caller doesn't need a billing_scope branch
    at every call site."""
    up = _upgrade()
    assert (
        "IF p_moisture_pin_ids IS NULL OR array_length(p_moisture_pin_ids, 1) IS NULL THEN"
        in up
    )


def test_tenant_derived_from_jwt() -> None:
    up = _upgrade()
    assert "v_caller_company := get_my_company_id()" in up
    assert "AND mp.company_id = v_caller_company" in up


def test_invalid_pins_raise_42501_collapsed() -> None:
    """Not-found + cross-tenant + cross-job all collapse into the
    same 42501 so the response doesn't leak existence. Separate
    SQLSTATEs for each case would let a caller probe for pin IDs
    across tenants/jobs."""
    up = _upgrade()
    # The COUNT query checks all three conditions in one pass.
    assert "NOT EXISTS (" in up
    assert "mp.id = requested_id" in up
    assert "mp.company_id = v_caller_company" in up
    assert "mp.job_id = p_job_id" in up
    # Single 42501 raise.
    assert "IF v_invalid_count > 0 THEN" in up
    assert "USING ERRCODE = '42501'" in up


def test_dry_pin_rejection_uses_22P02_with_for_share_lock() -> None:
    """Proposal C8 — dry pins get their own SQLSTATE distinct from
    the access-denied one so PR-C can surface different copy:
    "pin is already dry, pick a different one" vs "you don't have
    access to this pin". Collapsing them would confuse the tech.

    Review round-1 M4: FOR SHARE on the pin rows serializes the
    dry-check against a concurrent trg_moisture_pin_dry_check UPDATE
    in another session. Without the lock, a reading commit between
    validate and the caller's subsequent INSERT could leave a new
    assignment bound to a now-dry pin — overbill window until the
    next wet reading arrives.
    """
    up = _upgrade()
    assert "dry_standard_met_at IS NOT NULL" in up
    assert "IF v_dry_count > 0 THEN" in up
    assert "USING ERRCODE = '22P02'" in up
    # The FOR SHARE lock is what closes the TOCTOU window.
    assert "FOR SHARE" in up


def test_security_definer_and_search_path_pinned() -> None:
    up = _upgrade()
    assert "SECURITY DEFINER" in up
    assert "SET search_path = pg_catalog, public" in up


def test_downgrade_drops_function() -> None:
    down = _downgrade()
    assert "DROP FUNCTION IF EXISTS validate_pins_for_assignment(UUID, UUID[])" in down
