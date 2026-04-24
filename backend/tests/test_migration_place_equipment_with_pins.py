"""Text-scan guardrails for PR-B Step 5 — place_equipment_with_pins RPC."""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "f2a4c6e8b0d3_spec01h_phase3_place_equipment_with_pins.py"
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
    assert 'revision: str = "f2a4c6e8b0d3"' in text
    assert 'down_revision: str | None = "e6a8c0b2d4f7"' in text


def test_calls_ensure_job_mutable_inside_transaction() -> None:
    """Lesson §1 / R6 — archive guard must fire inside the RPC's
    transaction, not as a Python pre-check."""
    up = _upgrade()
    assert "PERFORM ensure_job_mutable(p_job_id)" in up


def test_cross_job_room_id_check_present() -> None:
    """Review round-1 H1 regression pin.

    The room FK only validates existence; it does NOT verify the room
    belongs to p_job_id. Without the explicit check, a same-tenant
    caller can place equipment with job_id=A against a room on Job B.
    Canvas drops the equipment, billing mis-attributes. Same shape
    Phase 1 explicitly hardened via assert_job_on_floor_plan_property.
    """
    up = _upgrade()
    # Pin the exact 3-condition subquery so a reviewer loosening any
    # filter (dropping job_id or company_id) fails this test loudly.
    assert "FROM job_rooms" in up
    assert "WHERE id = p_room_id" in up
    assert "AND job_id = p_job_id" in up
    assert "AND company_id = v_caller_company" in up
    # The raise must fire on NOT FOUND with P0002.
    assert "Room not found on this job or not accessible" in up


def test_duplicate_pins_deduped_before_cross_join() -> None:
    """Review round-1 M5 regression pin.

    Duplicate pin ids in p_moisture_pin_ids previously hit the partial
    uniq_active_assignment and raised a raw 23505 with no plpgsql
    message context. SELECT DISTINCT on the unnest in the CROSS JOIN
    dedupes before the INSERT — loud-fail is replaced by silently-
    correct, matching intent (one assignment per unique pin).
    """
    up = _upgrade()
    assert "SELECT DISTINCT pin_id FROM unnest(p_moisture_pin_ids)" in up


def test_calls_validate_pins_helper() -> None:
    """Step 4's validator is the single source of truth for pin-input
    rejection. Inline re-validation would drift."""
    up = _upgrade()
    assert "PERFORM validate_pins_for_assignment(p_job_id, p_moisture_pin_ids)" in up


def test_derives_billing_scope_from_equipment_type() -> None:
    """billing_scope is a derived column — explicit in the row so the
    billing RPC reads one field. CASE must branch on the 5 types
    correctly: air_mover + dehu → per_pin; everything else → per_room."""
    up = _upgrade()
    assert "v_billing_scope := CASE p_equipment_type" in up
    assert "WHEN 'air_mover'    THEN 'per_pin'" in up
    assert "WHEN 'dehumidifier' THEN 'per_pin'" in up
    assert "ELSE 'per_room'" in up


def test_per_pin_requires_size_per_room_rejects_pins() -> None:
    """Proposal C6 semantic checks that can't live in the table CHECK
    (they involve p_moisture_pin_ids + billing_scope, not just row
    columns)."""
    up = _upgrade()
    # per_pin demands size.
    assert "v_billing_scope = 'per_pin' AND p_equipment_size IS NULL" in up
    # per_room demands NULL size.
    assert "v_billing_scope = 'per_room' AND p_equipment_size IS NOT NULL" in up
    # per_room with pins attached is rejected.
    assert "v_billing_scope = 'per_room' AND p_moisture_pin_ids IS NOT NULL" in up


def test_inventory_array_length_checks() -> None:
    """Proposal C7 — asset_tag / serial_number arrays must match
    p_quantity 1:1 or get explicitly NULL-padded by the caller. Silent
    slice/pad would misalign tags with physical units."""
    up = _upgrade()
    assert "array_length(p_asset_tags, 1) <> p_quantity" in up
    assert "array_length(p_serial_numbers, 1) <> p_quantity" in up


def test_floor_plan_stamp_from_job_scoped_to_tenant() -> None:
    """Lesson §3/C4 — the SELECT that resolves floor_plan_id must
    filter on company_id, or SECURITY DEFINER lets cross-tenant callers
    inherit another tenant's floor plan stamp."""
    up = _upgrade()
    assert "SELECT floor_plan_id INTO v_floor_plan_id" in up
    assert "AND company_id = v_caller_company" in up


def test_batch_insert_uses_generate_series_with_column_alias() -> None:
    """Proposal CP2 — ``AS g(i)`` gives ``i`` a column alias so
    ``p_asset_tags[g.i]`` resolves. ``AS i`` alone would make i a
    record alias and array subscripts would fail at runtime."""
    up = _upgrade()
    assert "FROM generate_series(1, p_quantity) AS g(i)" in up
    assert "p_asset_tags[g.i]" in up
    assert "p_serial_numbers[g.i]" in up


def test_assignment_insert_uses_cross_join_with_dedup() -> None:
    """N placements × M pins = N×M assignments in one statement. CROSS
    JOIN is the idiom. Post-M5 fix: the pin unnest is wrapped in a
    SELECT DISTINCT subquery so duplicate pin ids in the caller's array
    don't trip the partial uniq_active_assignment with a raw 23505.
    """
    up = _upgrade()
    assert "INSERT INTO equipment_pin_assignments" in up
    assert "FROM unnest(v_placement_ids)" in up
    # CROSS JOIN against the dedup'd pin set (not the raw unnest).
    assert "CROSS JOIN (" in up
    assert "SELECT DISTINCT pin_id FROM unnest(p_moisture_pin_ids)" in up


def test_security_definer_and_search_path() -> None:
    up = _upgrade()
    assert "SECURITY DEFINER" in up
    assert "SET search_path = pg_catalog, public" in up


def test_returns_jsonb_with_declared_keys() -> None:
    """Response shape is part of the contract PR-C will consume.
    Pinning the keys so a later signature change surfaces via this
    test before PR-C's mapping breaks."""
    up = _upgrade()
    assert "'placement_ids'" in up
    assert "'placement_count'" in up
    assert "'assignment_count'" in up
    assert "'billing_scope'" in up
    assert "'floor_plan_id'" in up


def test_downgrade_drops_function_with_full_signature() -> None:
    """Lesson #10 / #23 — signature-changing drops must name the full
    signature (10 params). Partial signatures would leave stale
    overloads around and PostgREST would route to the wrong one."""
    down = _downgrade()
    assert "DROP FUNCTION IF EXISTS place_equipment_with_pins(" in down
    assert (
        "UUID, UUID, TEXT, TEXT, INT, NUMERIC, NUMERIC, UUID[], TEXT[], TEXT[]"
        in down
    )
