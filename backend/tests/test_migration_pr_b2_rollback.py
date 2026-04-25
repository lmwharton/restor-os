"""Text-scan guardrails for PR-B2 Step 1: rollback of the pin-attachment layer.

Pins the drops + the simplified bodies that replace them. Because the
rollback is atomic (one migration), a reviewer "fixing" any one drop
back to a CREATE would also trip the corresponding simplified-body
assertion below.
"""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "d1a2b3c4e5f6_spec01h_phase3_rollback_pin_attachment.py"
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
    assert 'revision: str = "d1a2b3c4e5f6"' in text
    assert 'down_revision: str | None = "b7d9f1a3c5e8"' in text


def test_drops_pin_attachment_objects() -> None:
    up = _upgrade()
    # Drop 1: place_equipment_with_pins with full signature (lesson #10).
    assert "DROP FUNCTION IF EXISTS place_equipment_with_pins(" in up
    assert (
        "UUID, UUID, TEXT, TEXT, INT, NUMERIC, NUMERIC, UUID[], TEXT[], TEXT[]"
        in up
    )
    # Drop 2: validate_pins_for_assignment.
    assert "DROP FUNCTION IF EXISTS validate_pins_for_assignment(UUID, UUID[]);" in up
    # Drop 3: junction table with CASCADE so its indexes/policy go with it.
    assert "DROP TABLE IF EXISTS equipment_pin_assignments CASCADE;" in up


def test_drops_billing_scope_column() -> None:
    up = _upgrade()
    assert "ALTER TABLE equipment_placements DROP COLUMN IF EXISTS billing_scope;" in up


def test_simplified_move_drops_pin_param_and_drops_old_signature_first() -> None:
    """Signature change from 6 params → 5 requires DROP before CREATE (lesson #10).

    The old move had ``p_new_moisture_pin_ids UUID[]`` as param 5 + pin-
    reassignment logic. The simplified body has no pin concept at all.
    """
    up = _upgrade()
    # DROP the old signature explicitly.
    assert "DROP FUNCTION IF EXISTS move_equipment_placement(" in up
    assert "UUID, UUID, NUMERIC, NUMERIC, UUID[], TEXT" in up
    # The new signature has 5 params; p_note is the last.
    assert "p_new_canvas_y  NUMERIC," in up
    assert "p_note          TEXT DEFAULT NULL" in up
    # No pin-array anywhere in the simplified body.
    new_move_start = up.find("CREATE OR REPLACE FUNCTION move_equipment_placement(")
    new_move_end = up.find("END;", new_move_start)
    new_body = up[new_move_start:new_move_end]
    assert "moisture_pin_ids" not in new_body
    assert "equipment_pin_assignments" not in new_body
    assert "billing_scope" not in new_body


def test_simplified_billable_days_drops_per_pin_branch() -> None:
    """After rollback, there's one formula: placed_at → COALESCE(pulled_at, now())
    in distinct local calendar days. The per_pin branch (junction-table
    aware) is gone; the per_room branch is the only remaining shape.
    """
    up = _upgrade()
    cpbd_start = up.find("CREATE OR REPLACE FUNCTION compute_placement_billable_days(")
    cpbd_end = up.find("$$ LANGUAGE plpgsql", cpbd_start)
    cpbd_body = up[cpbd_start:cpbd_end]
    # No junction-table reference.
    assert "equipment_pin_assignments" not in cpbd_body
    # No billing_scope branch.
    assert "v_scope" not in cpbd_body
    assert "IF v_scope" not in cpbd_body
    # The unified formula is present.
    assert "COALESCE(ep.pulled_at, now())" in cpbd_body


def test_simplified_validate_billable_days_has_per_row_only_output() -> None:
    """Per-pin audit logic (joining readings to assignment spans) is
    gone. Every day gets supported=false because per-room equipment has
    no pin attribution to validate against.
    """
    up = _upgrade()
    vpbd_start = up.find("CREATE OR REPLACE FUNCTION validate_placement_billable_days(")
    vpbd_end = up.find("$$ LANGUAGE plpgsql", vpbd_start)
    vpbd_body = up[vpbd_start:vpbd_end]
    assert "equipment_pin_assignments" not in vpbd_body
    assert "moisture_pin_readings" not in vpbd_body
    # The per-row-only shape explicitly returns supported=false.
    assert "false AS supported" in vpbd_body


def test_cross_job_room_check_preserved_in_simplified_move() -> None:
    """Lesson #30 carried forward. The simplified move still explicitly
    validates that the target room belongs to the placement's job —
    FK to job_rooms only validates existence."""
    up = _upgrade()
    new_move_start = up.find("CREATE OR REPLACE FUNCTION move_equipment_placement(")
    new_move_end = up.find("END;", new_move_start)
    new_body = up[new_move_start:new_move_end]
    assert "FROM job_rooms" in new_body
    assert "AND job_id = v_placement.job_id" in new_body
    assert "AND company_id = v_caller_company" in new_body


def test_downgrade_restores_all_four_dropped_objects() -> None:
    """Lesson #10 symmetry — every DROP in upgrade needs a matching
    CREATE in downgrade. Includes the DROP of the NEW move signature
    before recreating the OLD one."""
    down = _downgrade()
    # billing_scope column.
    assert "ALTER TABLE equipment_placements" in down
    assert "ADD COLUMN IF NOT EXISTS billing_scope" in down
    # Junction table.
    assert "CREATE TABLE IF NOT EXISTS equipment_pin_assignments" in down
    # Validator function.
    assert "CREATE OR REPLACE FUNCTION validate_pins_for_assignment(" in down
    # place_equipment_with_pins.
    assert "CREATE OR REPLACE FUNCTION place_equipment_with_pins(" in down
    # Signature change back requires DROP on the new 5-arg move first.
    assert "DROP FUNCTION IF EXISTS move_equipment_placement(" in down
    assert "UUID, UUID, NUMERIC, NUMERIC, TEXT" in down
