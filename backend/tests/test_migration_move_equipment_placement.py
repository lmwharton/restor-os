"""Text-scan guardrails for PR-B Step 6 — move_equipment_placement RPC."""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "a3c5e7b9d1f4_spec01h_phase3_move_equipment_placement.py"
)


def _read() -> str:
    return MIGRATION_FILE.read_text(encoding="utf-8")


def _upgrade() -> str:
    return _read().split("DOWNGRADE_SQL")[0]


def test_migration_file_exists() -> None:
    assert MIGRATION_FILE.exists()


def test_revision_identifiers() -> None:
    text = _read()
    assert 'revision: str = "a3c5e7b9d1f4"' in text
    assert 'down_revision: str | None = "f2a4c6e8b0d3"' in text


def test_concurrency_lock_at_placement_fetch() -> None:
    """PR-A M2 pattern — FOR NO KEY UPDATE locks the placement row at
    entry. Two concurrent moves on the same placement would otherwise
    race and the later committer would silently overwrite the earlier
    one's location."""
    up = _upgrade()
    assert "SELECT * INTO v_placement" in up
    assert "FROM equipment_placements" in up
    assert "FOR NO KEY UPDATE" in up


def test_tenant_scope_in_placement_fetch() -> None:
    """Cross-tenant placement_id must resolve as not-found (P0002),
    not as "locked a different tenant's row" — which would leak
    existence AND hold a lock on someone else's data."""
    up = _upgrade()
    assert "AND company_id = v_caller_company" in up
    assert "USING ERRCODE = 'P0002'" in up


def test_calls_ensure_job_mutable_from_placement_job() -> None:
    """Archive guard fires inside the transaction. Derives the job
    from the placement — caller doesn't pass p_job_id separately."""
    up = _upgrade()
    assert "PERFORM ensure_job_mutable(v_placement.job_id)" in up


def test_calls_validate_pins_only_for_per_pin() -> None:
    """Per-room placements ignore p_new_moisture_pin_ids entirely —
    they don't use the junction table. Guarding the validator call
    with ``IF billing_scope = 'per_pin'`` prevents confusing errors
    on per-room moves."""
    up = _upgrade()
    assert "IF v_placement.billing_scope = 'per_pin' THEN" in up
    # Validator is called inside the per_pin branch.
    per_pin_block = (
        up.split("IF v_placement.billing_scope = 'per_pin' THEN")[1]
        .split("END IF")[0]
    )
    assert "validate_pins_for_assignment(" in per_pin_block


def test_pulled_placement_rejected_22023() -> None:
    """Moving a placement that's already been pulled is nonsensical —
    there's nothing on-site to move. Silent-succeed would confuse
    billing (pulled_at span doesn't align with the new location)."""
    up = _upgrade()
    assert "IF v_placement.pulled_at IS NOT NULL THEN" in up


def test_close_old_assignments_with_equipment_moved_reason() -> None:
    """Audit trail: the close reason must be the specific 'equipment_moved'
    enum value so carrier reports can distinguish this from a pull
    (equipment_pulled), a dry-close (pin_dry_standard_met), etc."""
    up = _upgrade()
    assert "unassign_reason = 'equipment_moved'" in up
    # Only the open assignments close (partial WHERE).
    assert "WHERE equipment_placement_id = p_placement_id" in up
    assert "AND unassigned_at IS NULL" in up


def test_floor_plan_id_is_NOT_updated_on_move() -> None:
    """The floor_plan_id stamp is the VERSION the unit was drawn on.
    Moving between rooms on the same job keeps the stamp. This is
    deliberate — the two placements (pre- and post-move) share a
    version via jobs.floor_plan_id, and rewriting the stamp here
    would drift from that. Negative assertion: no UPDATE on
    floor_plan_id in the location-update statement."""
    up = _upgrade()
    update_block = (
        up.split("UPDATE equipment_placements")[1]
        .split(";")[0]
    )
    # Only room_id + canvas_x + canvas_y are updated.
    assert "room_id  = p_new_room_id" in update_block
    assert "canvas_x = p_new_canvas_x" in update_block
    assert "canvas_y = p_new_canvas_y" in update_block
    # Not floor_plan_id.
    assert "floor_plan_id" not in update_block


def test_per_room_move_with_pin_ids_rejected_22023() -> None:
    """Review round-1 H3 regression pin.

    Earlier body ran the validator + INSERT both gated on
    billing_scope = 'per_pin'. A per-room caller passing pin ids saw
    the array silently dropped. Same-PR sibling-miss of lesson #3 —
    place_equipment_with_pins correctly rejects this combination; move
    didn't, and would never have caught a PR-C UX bug that reused the
    same pin array across both paths.
    """
    up = _upgrade()
    assert "v_placement.billing_scope = 'per_room'" in up
    # The array-length check — NULL and empty array don't trigger.
    assert "array_length(p_new_moisture_pin_ids, 1) > 0" in up
    assert "per_room equipment cannot be assigned to moisture pins" in up


def test_cross_job_new_room_id_check_present() -> None:
    """Review round-1 H1 regression pin — sibling to the place RPC.

    p_new_room_id must belong to the placement's own job. Without this,
    a move could relocate equipment to a room on a DIFFERENT job in
    the same tenant — stamping floor_plan_id drift + canvas orphaning.
    """
    up = _upgrade()
    assert "FROM job_rooms" in up
    assert "WHERE id = p_new_room_id" in up
    assert "AND job_id = v_placement.job_id" in up
    assert "AND company_id = v_caller_company" in up
    assert "New room not found on this placement" in up


def test_p_note_param_present_on_move() -> None:
    """Review round-1 L3 — Proposal §0.4 Q3 resolution: the note
    column exists on assignments for after-the-fact corrections. Move
    is the natural write path for that narrative ("moved at adjuster's
    request"), so the RPC takes p_note and stamps it on both closed
    and opened assignment rows.
    """
    up = _upgrade()
    assert "p_note                  TEXT   DEFAULT NULL" in up
    # Signature appears in GRANT + COMMENT with 6-element form.
    assert "UUID, UUID, NUMERIC, NUMERIC, UUID[], TEXT" in up
    # Close path stamps note via COALESCE (preserves any prior note).
    assert "note            = COALESCE(note, p_note)" in up


def test_users_lookup_for_unassigned_by_not_auth_uid_directly() -> None:
    """Same FK trap as Step 5 — auth.uid() is the Supabase auth id,
    not users.id. Lookup is required or the UPDATE on
    equipment_pin_assignments violates its FK to users(id)."""
    up = _upgrade()
    assert "SELECT id INTO v_caller_user" in up
    assert "FROM users" in up
    assert "WHERE auth_user_id = auth.uid()" in up


def test_returns_jsonb_with_declared_keys() -> None:
    up = _upgrade()
    for key in [
        "'placement_id'",
        "'old_room_id'",
        "'new_room_id'",
        "'assignments_closed'",
        "'assignments_opened'",
        "'billing_scope'",
    ]:
        assert key in up


def test_security_definer_and_search_path() -> None:
    up = _upgrade()
    assert "SECURITY DEFINER" in up
    assert "SET search_path = pg_catalog, public" in up
