"""Text-scan guardrails for PR-B2 Step 2: equipment placement chain column."""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "d2a3b4c5e6f7_spec01h_phase3_equipment_chain.py"
)


def _read() -> str:
    return MIGRATION_FILE.read_text(encoding="utf-8")


def _upgrade() -> str:
    return _read().split("DOWNGRADE_SQL")[0]


def _downgrade() -> str:
    return _read().split("DOWNGRADE_SQL")[1]


def test_revision_identifiers() -> None:
    text = _read()
    assert 'revision: str = "d2a3b4c5e6f7"' in text
    assert 'down_revision: str | None = "d1a2b3c4e5f6"' in text


def test_adds_nullable_self_fk_with_set_null_on_delete() -> None:
    """Parent delete → child becomes a new chain head, not a dangling
    row. ON DELETE SET NULL (not CASCADE — we want to preserve
    historical billing rows even if their parent is hard-deleted)."""
    up = _upgrade()
    assert "ADD COLUMN restarted_from_placement_id UUID" in up
    assert "REFERENCES equipment_placements(id) ON DELETE SET NULL" in up


def test_chk_no_self_reference() -> None:
    """A row can't be its own parent — would loop the chain walker."""
    up = _upgrade()
    assert "chk_chain_not_self" in up
    assert "restarted_from_placement_id <> id" in up


def test_integrity_trigger_enforces_same_job_type_size_and_pulled_parent() -> None:
    """BEFORE INSERT OR UPDATE trigger rejects invalid parents (lesson §7 —
    loud-fail, never silent-drop)."""
    up = _upgrade()
    # Trigger function exists and covers INSERT OR UPDATE.
    assert "CREATE OR REPLACE FUNCTION equipment_chain_integrity()" in up
    assert "BEFORE INSERT OR UPDATE OF restarted_from_placement_id" in up

    trigger_start = up.find("CREATE OR REPLACE FUNCTION equipment_chain_integrity()")
    trigger_end = up.find("$$ LANGUAGE plpgsql", trigger_start)
    trigger_body = up[trigger_start:trigger_end]

    # Same job (lesson #30 cross-binding).
    assert "v_parent.job_id <> NEW.job_id" in trigger_body
    # Same tenant.
    assert "v_parent.company_id <> NEW.company_id" in trigger_body
    # Same equipment_type.
    assert "v_parent.equipment_type <> NEW.equipment_type" in trigger_body
    # Same equipment_size (IS DISTINCT FROM for NULL-safe comparison).
    assert "v_parent.equipment_size IS DISTINCT FROM NEW.equipment_size" in trigger_body
    # Parent must be pulled.
    assert "v_parent.pulled_at IS NULL" in trigger_body


def test_integrity_trigger_locks_parent_for_share() -> None:
    """Concurrency: a parent's pulled_at can flip between our probe and
    our insert. FOR SHARE serializes against a concurrent UPDATE of the
    parent row."""
    up = _upgrade()
    assert "FOR SHARE" in up


def test_partial_chain_index() -> None:
    """Index only over rows that have a parent — most rows are chain
    heads (NULL) and don't need an entry."""
    up = _upgrade()
    assert "CREATE INDEX idx_equip_chain" in up
    assert "ON equipment_placements(restarted_from_placement_id)" in up
    assert "WHERE restarted_from_placement_id IS NOT NULL" in up


def test_downgrade_removes_trigger_function_index_constraint_column() -> None:
    down = _downgrade()
    assert "DROP TRIGGER IF EXISTS trg_equipment_chain_integrity" in down
    assert "DROP FUNCTION IF EXISTS equipment_chain_integrity()" in down
    assert "DROP INDEX IF EXISTS idx_equip_chain" in down
    assert "DROP CONSTRAINT IF EXISTS chk_chain_not_self" in down
    assert "DROP COLUMN IF EXISTS restarted_from_placement_id" in down
