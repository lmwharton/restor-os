"""Text-scan guardrails for PR-B Step 3 — equipment_pin_assignments table."""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "d4f6b8a0c2e5_spec01h_phase3_equipment_pin_assignments.py"
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
    assert 'revision: str = "d4f6b8a0c2e5"' in text
    assert 'down_revision: str | None = "c2e4a6b8d0f3"' in text


def test_creates_table_with_all_columns() -> None:
    up = _upgrade()
    assert "CREATE TABLE equipment_pin_assignments" in up
    for col in [
        "id                       UUID PRIMARY KEY",
        "equipment_placement_id",
        "moisture_pin_id",
        "job_id",
        "company_id",
        "assigned_at",
        "unassigned_at",
        "assigned_by",
        "unassigned_by",
        "unassign_reason",
        "note",
        "created_at",
    ]:
        assert col in up, f"missing column: {col}"


def test_placement_and_pin_fks_are_restrict_not_cascade() -> None:
    """The audit trail is the point. CASCADE on these would silently
    erase billing evidence when the parent is hard-deleted. RESTRICT
    forces soft-archive flows (Phase 2 archive_moisture_pin) to close
    assignments explicitly first. Reviewer "fixing" either to CASCADE
    would regress the evidence-preservation invariant."""
    up = _upgrade()
    assert (
        "equipment_placement_id   UUID NOT NULL REFERENCES equipment_placements(id) ON DELETE RESTRICT"
        in up
    )
    assert (
        "moisture_pin_id          UUID NOT NULL REFERENCES moisture_pins(id)        ON DELETE RESTRICT"
        in up
    )
    # Negative pins — no CASCADE on these two FKs.
    assert "REFERENCES equipment_placements(id) ON DELETE CASCADE" not in up
    assert "REFERENCES moisture_pins(id)        ON DELETE CASCADE" not in up


def test_job_and_company_fks_are_cascade() -> None:
    """Denormalized handles. CASCADE is correct — when a job or tenant
    is fully purged, these assignments go with it by design."""
    up = _upgrade()
    assert (
        "job_id                   UUID NOT NULL REFERENCES jobs(id)                 ON DELETE CASCADE"
        in up
    )
    assert (
        "company_id               UUID NOT NULL REFERENCES companies(id)            ON DELETE CASCADE"
        in up
    )


def test_assign_order_check_uses_strict_greater_than() -> None:
    """Lesson §7 — zero-duration assignments (misclicks) must be
    rejected loudly. Strict `>`, not `>=`. Also handles active rows
    cleanly (``unassigned_at IS NULL`` passes trivially)."""
    up = _upgrade()
    assert "CONSTRAINT chk_assign_order CHECK" in up
    assert "unassigned_at IS NULL OR unassigned_at > assigned_at" in up


def test_partial_unique_index_on_active_assignments() -> None:
    """Lesson: the partial WHERE clause is what makes re-opens
    legitimate. A non-partial UNIQUE would block close-then-reopen
    (the re-wet flow). This exact shape is how two wet-dry-wet cycles
    can exist as separate audit rows for the same (placement, pin)
    pair."""
    up = _upgrade()
    assert "CREATE UNIQUE INDEX uniq_active_assignment" in up
    assert "ON equipment_pin_assignments(equipment_placement_id, moisture_pin_id)" in up
    assert "WHERE unassigned_at IS NULL" in up


def test_unassign_reason_check_enumerates_five_values() -> None:
    """Lesson #28 — each distinguishable cause needs its own enum
    value because each produces different carrier-report copy.
    Collapsing any two would force the consumer to guess context."""
    up = _upgrade()
    for reason in [
        "equipment_pulled",
        "pin_dry_standard_met",
        "manual_edit",
        "pin_archived",
        "equipment_moved",
    ]:
        assert f"'{reason}'" in up


def test_rls_policy_uses_get_my_company_id_helper() -> None:
    """Review round-1 L2 — mirror the Phase 1 pattern."""
    up = _upgrade()
    assert "ALTER TABLE equipment_pin_assignments ENABLE ROW LEVEL SECURITY" in up
    assert "CREATE POLICY epa_tenant" in up
    assert "company_id = get_my_company_id()" in up
    assert "current_setting('request.jwt.claims')" not in up


def test_access_pattern_indexes_present() -> None:
    up = _upgrade()
    # "what's serving pin X right now" — partial WHERE active, hot-path.
    assert "CREATE INDEX idx_epa_pin_active  ON equipment_pin_assignments(moisture_pin_id)" in up
    # Partial so only active rows are indexed; closed historical rows
    # don't bloat the index on busy jobs.
    epa_active_block = (
        up.split("CREATE INDEX idx_epa_pin_active")[1]
        .split(";")[0]
    )
    assert "WHERE unassigned_at IS NULL" in epa_active_block
    # "billable span for placement Y" — drives compute_placement_billable_days.
    assert "CREATE INDEX idx_epa_placement   ON equipment_pin_assignments(equipment_placement_id)" in up
    # "job-level billing rollup".
    assert "CREATE INDEX idx_epa_job         ON equipment_pin_assignments(job_id)" in up


def test_downgrade_drops_table_and_indexes() -> None:
    down = _downgrade()
    assert "DROP POLICY IF EXISTS epa_tenant" in down
    assert "DROP TABLE IF EXISTS equipment_pin_assignments" in down
    for idx in [
        "uniq_active_assignment",
        "idx_epa_pin_active",
        "idx_epa_placement",
        "idx_epa_job",
    ]:
        assert f"DROP INDEX IF EXISTS {idx}" in down
