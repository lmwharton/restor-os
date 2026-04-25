"""Text-scan guardrails for PR-B Step 2 — equipment_placements table.

Pins the load-bearing constraints and indexes. Runtime behavior (RLS
isolation, FK cascade, CHECK enforcement on real inserts) is verified
by the integration test later in PR-B once the RPCs that write to the
table land.

PR-B2 note: the ``billing_scope`` column was dropped in migration
d1a2b3c4e5f6 as part of the pin-attachment rollback. Tests that asserted
on billing_scope have been removed. The column still appears in the
ORIGINAL migration text (c2e4a6b8d0f3) because we never edit old
migrations, which is why some assertions below still reference it in
"what this migration declares" — those remain valid for this migration
in isolation. The current DB schema no longer has the column.
"""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "c2e4a6b8d0f3_spec01h_phase3_equipment_placements_table.py"
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
    assert 'revision: str = "c2e4a6b8d0f3"' in text
    assert 'down_revision: str | None = "a1d3c5e7b9f2"' in text


def test_creates_table_with_all_columns() -> None:
    up = _upgrade()
    assert "CREATE TABLE equipment_placements" in up
    for col in [
        "id                UUID PRIMARY KEY",
        "job_id",
        "room_id",
        "company_id",
        "floor_plan_id",
        "equipment_type",
        "equipment_size",
        "billing_scope",
        "asset_tag",
        "serial_number",
        "canvas_x",
        "canvas_y",
        "placed_at",
        "pulled_at",
        "placed_by",
        "pulled_by",
        "notes",
        "created_at",
    ]:
        assert col in up, f"missing column: {col}"


def test_floor_plan_id_fk_is_restrict_not_set_null_and_not_null() -> None:
    """Proposal A2/C1 — the version stamp must not be silently nulled.
    ON DELETE RESTRICT forces callers to explicitly archive placements
    before deleting the plan.

    Review round-1 M2: column is NOT NULL so a direct PostgREST INSERT
    (bypassing the RPC's 42501 check for jobs.floor_plan_id IS NULL)
    can't land a row with no stamp. Without NOT NULL, the fork-restamp
    UPDATE's JOIN against floor_plans wouldn't catch NULL-stamped rows
    on future forks and they'd drift permanently.
    """
    up = _upgrade()
    assert (
        "floor_plan_id     UUID NOT NULL REFERENCES floor_plans(id) ON DELETE RESTRICT"
        in up
    )
    # Negative pin — reviewer "fixing" this to SET NULL or dropping
    # NOT NULL would silently regress.
    assert "floor_plan_id     UUID REFERENCES floor_plans(id) ON DELETE SET NULL" not in up
    assert "floor_plan_id     UUID REFERENCES floor_plans(id) ON DELETE RESTRICT" not in up


def test_equipment_type_check_has_five_values() -> None:
    up = _upgrade()
    assert "equipment_type IN (" in up
    for t in ["air_mover", "dehumidifier", "air_scrubber", "hydroxyl_generator", "heater"]:
        assert f"'{t}'" in up


def test_billing_scope_default_and_check() -> None:
    up = _upgrade()
    assert "billing_scope     TEXT NOT NULL DEFAULT 'per_pin'" in up
    assert "billing_scope IN ('per_pin', 'per_room')" in up


def test_chk_equipment_size_valid_pairs_type_and_size() -> None:
    """Proposal C6 — the constraint must pair equipment_type with its
    allowed sizes, and reject mismatched combos. Checking that all three
    branches (air_mover / dehumidifier / non-drying) are present, and
    that the non-drying branch enforces NULL (not just any-value).
    """
    up = _upgrade()
    assert "CONSTRAINT chk_equipment_size_valid CHECK" in up
    # air_mover allowed sizes
    assert "equipment_type = 'air_mover'" in up
    assert "equipment_size IN ('std', 'axial')" in up
    # dehumidifier allowed sizes
    assert "equipment_type = 'dehumidifier'" in up
    assert "equipment_size IN ('std', 'large', 'xl', 'xxl')" in up
    # Non-drying must be NULL
    assert "equipment_type IN ('air_scrubber', 'hydroxyl_generator', 'heater')" in up
    assert "equipment_size IS NULL" in up


def test_rls_policy_uses_get_my_company_id_helper() -> None:
    """Review round-1 L2: match the Phase 1 pattern by reading company
    via ``get_my_company_id()`` rather than re-parsing the JWT claim.
    One resolution rule across every tenant-scoped table — no risk of
    divergence if the JWT→company mapping ever gains logic.
    """
    up = _upgrade()
    assert "ALTER TABLE equipment_placements ENABLE ROW LEVEL SECURITY" in up
    assert "CREATE POLICY equip_tenant" in up
    assert "company_id = get_my_company_id()" in up
    # Negative pin — the raw JWT parse must NOT be used as a USING
    # predicate. Checking the CREATE POLICY body in isolation so the
    # literal doesn't flag on comment mentions elsewhere in the file.
    import re
    policy_match = re.search(
        r"CREATE POLICY equip_tenant ON equipment_placements USING \((.*?)\);",
        up,
        re.DOTALL,
    )
    assert policy_match is not None, "couldn't find policy body"
    assert "current_setting('request.jwt.claims')" not in policy_match.group(1)


def test_access_pattern_indexes_present() -> None:
    up = _upgrade()
    # "by job" — list-per-job endpoint (PR-C).
    assert "CREATE INDEX idx_equip_job     ON equipment_placements(job_id)" in up
    # "active only" — the hot path for current-equipment-on-floor queries.
    assert "CREATE INDEX idx_equip_active  ON equipment_placements(job_id)" in up
    assert "WHERE pulled_at IS NULL" in up
    # "by company" — billing rollups.
    assert "CREATE INDEX idx_equip_company ON equipment_placements(company_id)" in up
    # "by asset tag, partial" — inventory lookups; partial keeps it small
    # for tenants that don't tag.
    assert "CREATE INDEX idx_equip_asset_tag" in up
    assert "ON equipment_placements(company_id, asset_tag)" in up
    assert "WHERE asset_tag IS NOT NULL" in up


def test_cascade_shapes_match_proposal() -> None:
    """Verify FK cascade behaviors match the proposal:
      - job_id: CASCADE (placement dies with its job)
      - room_id: SET NULL (placement survives if the room is reshaped)
      - company_id: CASCADE (tenant-wide purge)
      - floor_plan_id: RESTRICT (version stamps preserved)
      - placed_by / pulled_by: no explicit, defaults to NO ACTION
    """
    up = _upgrade()
    assert "job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE" in up
    assert "room_id           UUID REFERENCES job_rooms(id) ON DELETE SET NULL" in up
    assert "company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE" in up


def test_downgrade_drops_table_and_policy() -> None:
    down = _downgrade()
    assert "DROP POLICY IF EXISTS equip_tenant" in down
    assert "DROP TABLE IF EXISTS equipment_placements" in down
    # Indexes drop automatically with the table, but we also list them
    # explicitly for readability and idempotency.
    for idx in [
        "idx_equip_job",
        "idx_equip_active",
        "idx_equip_company",
        "idx_equip_asset_tag",
    ]:
        assert f"DROP INDEX IF EXISTS {idx}" in down
