"""Text-scan guardrails for PR-B Step 7 — billable-day math RPCs."""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "c5e7a9b1d3f6_spec01h_phase3_billable_days_rpcs.py"
)


def _read() -> str:
    return MIGRATION_FILE.read_text(encoding="utf-8")


def _upgrade() -> str:
    return _read().split("DOWNGRADE_SQL")[0]


def test_migration_file_exists() -> None:
    assert MIGRATION_FILE.exists()


def test_revision_identifiers() -> None:
    text = _read()
    assert 'revision: str = "c5e7a9b1d3f6"' in text
    assert 'down_revision: str | None = "a3c5e7b9d1f4"' in text


def test_both_functions_declared() -> None:
    up = _upgrade()
    assert "CREATE OR REPLACE FUNCTION compute_placement_billable_days(" in up
    assert "CREATE OR REPLACE FUNCTION validate_placement_billable_days(" in up


def test_both_functions_marked_stable() -> None:
    """Pure-read functions should be STABLE so the planner can cache
    results within a single query. Volatile would block inlining +
    prevent the query planner from knowing these don't side-effect."""
    up = _upgrade()
    # Rough count — both functions are STABLE.
    assert up.count("STABLE") >= 2


def test_both_functions_derive_tenant_from_jwt() -> None:
    up = _upgrade()
    assert up.count("v_caller_company := get_my_company_id()") >= 2
    assert up.count("AND ep.company_id = v_caller_company") >= 2


def test_cross_tenant_raises_not_silent_empty() -> None:
    """Lesson CP5 — empty-set return on cross-tenant is misleading.
    Both functions raise 42501 instead so PR-C can distinguish
    'placement not found' from 'placement has 0 billable days'."""
    up = _upgrade()
    # Two separate IF v_tz IS NULL THEN RAISE blocks, one per function.
    assert up.count("IF v_tz IS NULL THEN") >= 2
    # Both use 42501 for cross-tenant.
    assert up.count("Placement not found or not accessible") >= 2


def test_per_pin_math_uses_job_timezone_not_utc() -> None:
    """Lesson §15/H2 — day bucketing uses the job's timezone, not UTC.
    A span spanning local midnight crosses one day locally but two
    days in UTC. Without AT TIME ZONE, the count is off by one."""
    up = _upgrade()
    # Two places (per-pin and per-room math) each use v_tz.
    assert up.count("AT TIME ZONE v_tz") >= 4


def test_per_pin_spans_come_from_assignments() -> None:
    """Per-pin billing uses the junction-table spans, not the placement's
    own span. A dehu on-site for 6 days but assigned only 3 days gets
    3 billable days — idle 3 days don't count."""
    up = _upgrade()
    pin_block = up.split("IF v_scope = 'per_pin' THEN")[1].split("ELSE")[0]
    assert "equipment_pin_assignments" in pin_block
    assert "assigned_at" in pin_block
    assert "COALESCE(unassigned_at, now())" in pin_block


def test_per_room_spans_come_from_placement_itself() -> None:
    """Per-room equipment has no pin attribution; span is placed_at →
    pulled_at (or now)."""
    up = _upgrade()
    # The ELSE branch of per_pin is the per_room branch.
    per_room = up.split("IF v_scope = 'per_pin' THEN")[1].split("ELSE")[1]
    assert "ep.placed_at" in per_room
    assert "COALESCE(ep.pulled_at, now())" in per_room


def test_validate_function_returns_four_columns() -> None:
    """Contract with PR-C carrier-report — each billable day yields
    (day, supported, reading_count, has_meter_photo)."""
    up = _upgrade()
    # Slice from the CREATE statement of validate_placement_billable_days
    # to capture its RETURNS TABLE signature.
    validate_block = up.split("CREATE OR REPLACE FUNCTION validate_placement_billable_days(")[1]
    assert "day              DATE" in validate_block
    assert "supported        BOOLEAN" in validate_block
    assert "reading_count    INT" in validate_block
    assert "has_meter_photo  BOOLEAN" in validate_block


def test_validate_joins_readings_via_assignment_links() -> None:
    """A reading 'supports' a billable day iff it was taken on a pin
    actively assigned to this placement AT THAT TIME. The JOIN is what
    threads that relationship — without it we'd count readings from
    pins that were once-but-not-currently assigned.
    """
    up = _upgrade()
    validate_block = up.split("CREATE OR REPLACE FUNCTION validate_placement_billable_days(")[1]
    assert "JOIN equipment_pin_assignments epa" in validate_block
    assert "ON epa.moisture_pin_id = mpr.pin_id" in validate_block
    assert "AND epa.equipment_placement_id = p_placement_id" in validate_block


def test_validate_bounds_reading_join_by_assignment_window() -> None:
    """Review round-1 H2 regression pin.

    Earlier shape joined readings without a time bound, so a late
    reading on a pin that had been assigned WEEKS earlier to the same
    placement still supported a present-day billable day (that pin
    wasn't being dried then — another pin was). False-positive support
    flag — worse than no validator at all per the TPA-rejection story
    the function exists for (§8.4).

    Both bounds must be present: lower (reading taken AFTER assignment
    opened) and upper (reading taken BEFORE assignment closed, with
    COALESCE(now()) for still-active spans).
    """
    up = _upgrade()
    validate_block = up.split("CREATE OR REPLACE FUNCTION validate_placement_billable_days(")[1]
    assert "AND mpr.taken_at >= epa.assigned_at" in validate_block
    assert "AND mpr.taken_at <= COALESCE(epa.unassigned_at, now())" in validate_block


def test_security_definer_and_search_path() -> None:
    up = _upgrade()
    assert up.count("SECURITY DEFINER") >= 2
    assert up.count("SET search_path = pg_catalog, public") >= 2


def test_downgrade_drops_both_functions() -> None:
    down = _read().split("DOWNGRADE_SQL")[1]
    assert "DROP FUNCTION IF EXISTS validate_placement_billable_days(UUID)" in down
    assert "DROP FUNCTION IF EXISTS compute_placement_billable_days(UUID)" in down
