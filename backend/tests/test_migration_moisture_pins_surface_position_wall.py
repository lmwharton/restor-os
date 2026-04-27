"""Text-scan guardrails for Spec 01H Phase 2 location-split migration.

Pins the load-bearing invariants from ``docs/pr-review-lessons.md``:

- Lesson #10 (downgrade-symmetry): every ADD COLUMN has a matching DROP
  COLUMN; the new 15-arg RPC body has a downgrade restoring the old
  13-arg shape byte-for-byte.
- Lesson #25 (denormalized truth masks missing FK): the upgrade DROPs
  ``location_name`` so the structured triple is the single source of
  truth — no two-truths drift surface.
- Lesson #29 (every floor_plan_id stamp re-stamps on fork): the new
  ``save_floor_plan_version`` body carries an UPDATE for
  ``moisture_pins.wall_segment_id`` matched by (room_id, sort_order).
- Lesson #30 (cross-job/cross-room binding): the new RPC includes a
  ``PERFORM 1 FROM wall_segments WHERE id = p_wall_segment_id AND
  room_id = p_room_id AND company_id = v_caller_company`` block — FK
  alone only validates wall existence, not parent-room binding.
- Lesson #7 (never silently drop): bidirectional CHECK
  ``chk_moisture_pin_wall_segment_only_when_wall`` rejects floor or
  ceiling pins with a stray wall_segment_id.

Text-only — runs in plain pytest, no DB required.
"""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "e2b3c4d5f6a7_spec01h_phase2_moisture_pins_surface_position_wall.py"
)


def _read() -> str:
    return MIGRATION_FILE.read_text(encoding="utf-8")


def test_migration_file_exists() -> None:
    assert MIGRATION_FILE.exists(), f"missing migration file: {MIGRATION_FILE}"


def test_revision_identifiers_present() -> None:
    text = _read()
    assert 'revision: str = "e2b3c4d5f6a7"' in text
    # down_revision pins this migration to the current head at write time.
    # Bumping head requires updating this assertion intentionally.
    assert 'down_revision: str | None = "d8b9c0d1e2f3"' in text


# --- Schema additions -------------------------------------------------------


def test_upgrade_adds_surface_column() -> None:
    text = _read()
    assert "ADD COLUMN surface         TEXT" in text


def test_upgrade_adds_position_column() -> None:
    text = _read()
    assert "ADD COLUMN position        TEXT" in text


def test_upgrade_adds_wall_segment_id_with_set_null_fk() -> None:
    text = _read()
    # Lesson #29 reasoning: SET NULL (not RESTRICT) is required because
    # the snapshot-restore RPCs wipe-and-re-insert wall_segments; RESTRICT
    # would block restores. The fork-restamp UPDATE re-targets the stamp
    # for non-geometry forks.
    assert (
        "ADD COLUMN wall_segment_id UUID REFERENCES wall_segments(id) "
        "ON DELETE SET NULL"
    ) in text


def test_upgrade_flips_surface_not_null_after_backfill() -> None:
    text = _read()
    # Order matters: SET NOT NULL must come AFTER the backfill UPDATE,
    # otherwise the ALTER fails on legacy rows that the parser skipped.
    upgrade_section = text.split("UPGRADE_SQL")[1]
    backfill_pos = upgrade_section.find("UPDATE moisture_pins")
    not_null_pos = upgrade_section.find("ALTER COLUMN surface SET NOT NULL")
    assert backfill_pos > 0
    assert not_null_pos > backfill_pos, (
        "SET NOT NULL must come after backfill, otherwise legacy rows "
        "with unparseable location_name silently fail the alter"
    )


def test_upgrade_drops_location_name() -> None:
    text = _read()
    # Lesson #25 — only one source of truth. location_name has to leave.
    assert "DROP COLUMN location_name" in text


# --- CHECK constraints ------------------------------------------------------


def test_upgrade_adds_surface_enum_check() -> None:
    text = _read()
    assert "chk_moisture_pin_surface" in text
    assert "surface IN ('floor', 'wall', 'ceiling')" in text


def test_upgrade_adds_position_enum_check_nullable() -> None:
    text = _read()
    assert "chk_moisture_pin_position" in text
    # Nullable: position IS NULL OR position IN (...) — required for
    # wall/ceiling pins which deliberately store NULL position today.
    assert "position IS NULL OR position IN ('C', 'NW', 'NE', 'SW', 'SE')" in text


def test_upgrade_adds_one_directional_wall_binding_check() -> None:
    text = _read()
    # Lesson #7: floor/ceiling pin with stray wall_segment_id is loud-
    # rejected. wall pin without a picked segment is allowed (draft
    # state — the picker UI hasn't shipped yet).
    assert "chk_moisture_pin_wall_segment_only_when_wall" in text
    assert "wall_segment_id IS NULL OR surface = 'wall'" in text


# --- RPC swap ---------------------------------------------------------------


def test_upgrade_drops_old_rpc_overload_first() -> None:
    text = _read()
    # Lesson #10 — signature change requires explicit DROP before CREATE,
    # otherwise the old overload lingers and the next caller hits an
    # ambiguous-function error.
    assert (
        "DROP FUNCTION IF EXISTS create_moisture_pin_with_reading(\n"
        "    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, UUID,\n"
        "    NUMERIC, TIMESTAMPTZ, TEXT, TEXT\n"
        ");"
    ) in text


def test_upgrade_creates_rpc_with_new_signature() -> None:
    text = _read()
    # New 15-arg signature: drops p_location_name, adds p_surface +
    # p_position + p_wall_segment_id. (Comment text in UPGRADE_SQL
    # may still reference p_location_name to explain what was removed —
    # we don't want to ban it from comments, only from real code. The
    # `test_rpc_inserts_new_columns_not_location_name` test verifies
    # the actual INSERT block doesn't reference it.)
    assert "p_surface         TEXT," in text
    assert "p_position        TEXT," in text
    assert "p_wall_segment_id UUID," in text


def test_rpc_inserts_new_columns_not_location_name() -> None:
    text = _read()
    upgrade = text.split("UPGRADE_SQL")[1].split("DOWNGRADE_SQL")[0]
    assert "surface, position, wall_segment_id," in upgrade
    # Negative — make sure no INSERT in the upgrade still references
    # location_name as a column (lesson #1: claim-vs-fix gap).
    assert "INSERT INTO moisture_pins" in upgrade
    insert_block = upgrade.split("INSERT INTO moisture_pins")[1].split(")")[0]
    assert "location_name" not in insert_block


def test_rpc_includes_cross_room_wall_binding_check() -> None:
    text = _read()
    # Lesson #30 — FK on wall_segment_id only validates existence; without
    # an explicit room_id + company_id check, a caller could pick a wall
    # from a different room (or another tenant if RLS were ever bypassed).
    assert "PERFORM 1 FROM wall_segments" in text
    assert "AND room_id = p_room_id" in text
    assert "AND company_id = v_caller_company" in text
    assert "USING ERRCODE = 'P0002'" in text


# --- Fork-restamp extension -------------------------------------------------


def test_save_floor_plan_version_restamps_wall_segment_id() -> None:
    text = _read()
    upgrade = text.split("UPGRADE_SQL")[1].split("DOWNGRADE_SQL")[0]
    # The new UPDATE block re-points moisture_pins.wall_segment_id to the
    # new wall_segments row at the same (room_id, sort_order). Lesson #29
    # — must be in the same RPC body that re-stamps job_rooms +
    # moisture_pins.floor_plan_id + equipment_placements.floor_plan_id.
    assert "UPDATE moisture_pins mp\n       SET wall_segment_id = new_walls.id" in upgrade
    assert "new_walls.sort_order = old_walls.sort_order" in upgrade
    assert "new_walls.id <> old_walls.id" in upgrade


def test_save_floor_plan_version_keeps_existing_three_restamps() -> None:
    text = _read()
    upgrade = text.split("UPGRADE_SQL")[1].split("DOWNGRADE_SQL")[0]
    # Sibling-miss guard (lesson #1): adding a 4th UPDATE shouldn't drop
    # the prior three. Pin all four explicitly.
    assert "UPDATE job_rooms jr" in upgrade
    assert "UPDATE moisture_pins mp\n       SET floor_plan_id = v_new_row.id" in upgrade
    assert "UPDATE equipment_placements ep" in upgrade


# --- Downgrade symmetry -----------------------------------------------------


def test_downgrade_restores_location_name_not_null() -> None:
    text = _read()
    downgrade = text.split("DOWNGRADE_SQL")[1]
    # Re-add nullable, backfill from new fields + room name, then NOT NULL.
    assert "ADD COLUMN location_name TEXT;" in downgrade
    assert "ALTER COLUMN location_name SET NOT NULL;" in downgrade


def test_downgrade_drops_three_new_columns() -> None:
    text = _read()
    downgrade = text.split("DOWNGRADE_SQL")[1]
    assert "DROP COLUMN wall_segment_id," in downgrade
    assert "DROP COLUMN position," in downgrade
    assert "DROP COLUMN surface;" in downgrade


def test_downgrade_drops_three_new_check_constraints() -> None:
    text = _read()
    downgrade = text.split("DOWNGRADE_SQL")[1]
    assert "DROP CONSTRAINT IF EXISTS chk_moisture_pin_wall_segment_only_when_wall" in downgrade
    assert "DROP CONSTRAINT IF EXISTS chk_moisture_pin_position" in downgrade
    assert "DROP CONSTRAINT IF EXISTS chk_moisture_pin_surface" in downgrade


def test_downgrade_restores_old_rpc_signature_byte_for_byte() -> None:
    text = _read()
    downgrade = text.split("DOWNGRADE_SQL")[1]
    # Old 13-arg signature must come back exactly. Drop the new 15-arg
    # overload first (lesson #10 reverse direction).
    assert (
        "DROP FUNCTION IF EXISTS create_moisture_pin_with_reading(\n"
        "    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, UUID, TEXT, NUMERIC, UUID,\n"
        "    NUMERIC, TIMESTAMPTZ, TEXT, TEXT\n"
        ");"
    ) in downgrade
    assert "p_location_name   TEXT," in downgrade


def test_downgrade_restores_save_floor_plan_version_without_wall_restamp() -> None:
    text = _read()
    downgrade = text.split("DOWNGRADE_SQL")[1]
    # Must restore the prior body (with the three floor_plan_id UPDATEs)
    # but WITHOUT the wall_segment_id UPDATE — that block is what this
    # migration introduced.
    assert "UPDATE job_rooms jr" in downgrade
    assert "UPDATE equipment_placements ep" in downgrade
    assert "SET wall_segment_id = new_walls.id" not in downgrade
