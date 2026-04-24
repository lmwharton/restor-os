"""Text-scan guardrails for Spec 01H Phase 3 Step 2 migration.

Pins the invariants from ``docs/pr-review-lessons.md`` that apply to this
migration:

- Lesson #10 (downgrade-symmetry): every ADD COLUMN has a matching DROP
  COLUMN; every CREATE OR REPLACE FUNCTION in UPGRADE has one in DOWNGRADE
  restoring the old body.
- Lesson §3 / C4 (tenant from JWT): RPC uses ``get_my_company_id()``,
  never accepts ``p_company_id`` as sole source of truth.
- Lesson #25 (FK populated on every insert path): UPGRADE stamps
  ``floor_plan_id`` inside the RPC INSERT.

Text-only — runs in plain pytest, no DB required.
"""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "b2d4e6f8a1c3_spec01h_phase3_moisture_pins_floor_plan_dry_met.py"
)


def _read() -> str:
    return MIGRATION_FILE.read_text(encoding="utf-8")


def test_migration_file_exists() -> None:
    assert MIGRATION_FILE.exists(), f"missing migration file: {MIGRATION_FILE}"


def test_revision_identifiers_present() -> None:
    text = _read()
    assert 'revision: str = "b2d4e6f8a1c3"' in text
    assert 'down_revision: str | None = "7a1f3b2c9d0e"' in text


def test_upgrade_adds_floor_plan_id_with_restrict() -> None:
    text = _read()
    # floor_plan_id must be FK to floor_plans (the merged Phase 1 table — not
    # the removed floor_plan_versions) with ON DELETE RESTRICT per S3/C1.
    assert "ADD COLUMN floor_plan_id UUID REFERENCES floor_plans(id) ON DELETE RESTRICT" in text


def test_upgrade_adds_dry_standard_met_at_nullable() -> None:
    text = _read()
    assert "ADD COLUMN dry_standard_met_at TIMESTAMPTZ" in text
    # Explicitly NOT "NOT NULL" — nullable is the contract (NULL = still drying).
    assert "dry_standard_met_at TIMESTAMPTZ NOT NULL" not in text


def test_upgrade_backfills_from_rooms() -> None:
    text = _read()
    # Backfill must JOIN through job_rooms (not jobs.floor_plan_id directly) —
    # a room is on one specific floor, and that's the right stamping source.
    assert "UPDATE moisture_pins" in text
    assert "FROM job_rooms" in text
    assert "mp.room_id = jr.id" in text


def test_upgrade_creates_partial_index() -> None:
    text = _read()
    assert "CREATE INDEX idx_moisture_pins_floor_plan" in text
    assert "WHERE floor_plan_id IS NOT NULL" in text


def test_rpc_stamps_floor_plan_id_inside_insert() -> None:
    """Lesson #25 — every CREATE path populates the new FK column.

    The RPC is the single path for create_pin (service layer calls it). If the
    INSERT doesn't include floor_plan_id, every future pin lands NULL.
    """
    text = _read()
    # Both occurrences — UPGRADE installs the new RPC body; DOWNGRADE removes it.
    # UPGRADE must have floor_plan_id in the INSERT column list.
    upgrade_body = text.split("DOWNGRADE_SQL")[0]
    assert "INSERT INTO moisture_pins" in upgrade_body
    # The column list includes floor_plan_id:
    assert "floor_plan_id" in upgrade_body.split("INSERT INTO moisture_pins")[1].split("VALUES")[0]
    # And the VALUES clause references v_floor_plan_id:
    assert "v_floor_plan_id" in upgrade_body


def test_rpc_resolves_floor_plan_id_with_tenant_check() -> None:
    """Lesson §3/C4 — the SELECT that resolves floor_plan_id must include a
    company_id filter. Without it, a caller could theoretically ask about a
    room in another tenant's job.
    """
    text = _read()
    upgrade_body = text.split("DOWNGRADE_SQL")[0]
    # The SELECT ... FROM job_rooms WHERE ... must filter on company_id.
    select_block = upgrade_body.split("SELECT floor_plan_id INTO v_floor_plan_id")[1].split(";")[0]
    assert "company_id = v_caller_company" in select_block


def test_rpc_still_derives_company_from_jwt() -> None:
    """Lesson §3 — never trust p_company_id alone. get_my_company_id() is the
    authoritative source. Unchanged from e1f2a3b4c5d6 — regression-pin it."""
    text = _read()
    assert "get_my_company_id()" in text
    # v_caller_company <> p_company_id check still present in both bodies:
    assert text.count("v_caller_company <> p_company_id") >= 2


def test_downgrade_drops_both_columns() -> None:
    """Lesson #10 symmetry — missing downgrade = broken rollback."""
    text = _read()
    downgrade_body = text.split("DOWNGRADE_SQL")[1]
    assert "DROP COLUMN dry_standard_met_at" in downgrade_body
    assert "DROP COLUMN floor_plan_id" in downgrade_body
    assert "DROP INDEX IF EXISTS idx_moisture_pins_floor_plan" in downgrade_body


def test_downgrade_restores_old_rpc_body_without_floor_plan_id() -> None:
    """Lesson #10 — function-signature changes need symmetric restoration."""
    text = _read()
    downgrade_body = text.split("DOWNGRADE_SQL")[1]
    # Downgrade replaces the RPC body with one that doesn't reference the new col.
    assert "CREATE OR REPLACE FUNCTION create_moisture_pin_with_reading" in downgrade_body
    # The restored INSERT column list must NOT include floor_plan_id.
    insert_block = downgrade_body.split("INSERT INTO moisture_pins")[1].split("VALUES")[0]
    assert "floor_plan_id" not in insert_block
