"""Spec 01H Phase 3 PR-B Step 3: equipment_pin_assignments junction table.

The heart of Phase 3. Links a specific equipment unit to a specific
moisture pin for a specific time window — the link that makes per-pin
billing justifiable to a carrier. Without this row, billing can only
answer "the dehu was on site from Apr 20 to Apr 26." With it, billing
answers "the dehu was actively drying pin A from Apr 20 to Apr 22 and
pin B from Apr 20 to Apr 22 — 3 distinct calendar days."

Schema decisions (cross-referenced to proposal §3.2):

- **equipment_placement_id / moisture_pin_id FKs: ON DELETE RESTRICT.**
  The audit trail is the point. Hard-deleting a placement or a pin
  with open or historical assignments would silently erase billing
  evidence. Soft-archive is the expected path (Phase 2's
  ``archive_moisture_pin`` RPC bulk-closes assignments, §7 amends it
  to cover this table in a later step). Any hard delete must
  explicitly handle the dependent assignments first — CASCADE would
  hide the data-loss, RESTRICT surfaces it.

- **job_id / company_id FKs: ON DELETE CASCADE.** Denormalized for the
  hot-path billing + RLS queries so we don't re-JOIN through two FK
  levels. When a job or tenant is fully purged, these assignments go
  with it by design.

- **CHECK (unassigned_at > assigned_at) — strict ``>``, not ``>=``.**
  Zero-duration assignments are misclicks (open-and-immediately-close
  in the same millisecond). The proposal §3.2 calls them out as
  "loudly reject, not silently drop" per lesson §7.

- **Partial unique index ``WHERE unassigned_at IS NULL``.** Prevents
  double-active-assignment (same placement assigned to the same pin
  twice simultaneously) but ALLOWS historical re-opens after a close
  (needed for the re-wet flow: close Apr 22, open new row Apr 26).
  Non-partial unique would block legitimate re-wet.

- **unassign_reason CHECK with 5 values.** Each value maps to
  different carrier-report copy:
    ``equipment_pulled``       — tech pulled the unit from site
    ``pin_dry_standard_met``  — auto-close via trigger (PR-A Step 4)
    ``manual_edit``           — tech manually closed via UI
    ``pin_archived``          — pin was archived (§7 amendment)
    ``equipment_moved``       — move_equipment_placement RPC (Step 6)
  Lesson #28 — when a discriminant produces different UI, each cause
  needs its own enum value. NULL is allowed while the row is still
  active (``unassigned_at IS NULL``); on close, the reason must be set
  explicitly by the caller.

- **note TEXT nullable.** Proposal §0.4 Q3: tech can annotate after-the-
  fact corrections ("moved to Room B at adjuster's request") without
  polluting the structured fields.

- **Three access-pattern indexes:**
    ``idx_epa_pin_active`` (partial) — "what's serving pin X right now"
    ``idx_epa_placement`` — "billable span for placement Y"
    ``idx_epa_job`` — "job-level billing rollup"
  Each matches a query PR-C will hit; scope-of-use documented inline
  on the index so a later optimizer sees the access pattern the index
  was built for.

Revision ID: d4f6b8a0c2e5
Revises: c2e4a6b8d0f3
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f6b8a0c2e5"
down_revision: str | None = "c2e4a6b8d0f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE TABLE equipment_pin_assignments (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FKs: RESTRICT on the two the audit trail rides on (placement + pin);
    -- CASCADE on the denorm handles (job + company).
    equipment_placement_id   UUID NOT NULL REFERENCES equipment_placements(id) ON DELETE RESTRICT,
    moisture_pin_id          UUID NOT NULL REFERENCES moisture_pins(id)        ON DELETE RESTRICT,
    job_id                   UUID NOT NULL REFERENCES jobs(id)                 ON DELETE CASCADE,
    company_id               UUID NOT NULL REFERENCES companies(id)            ON DELETE CASCADE,
    assigned_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    unassigned_at            TIMESTAMPTZ,
    assigned_by              UUID REFERENCES users(id),
    unassigned_by            UUID REFERENCES users(id),
    unassign_reason          TEXT CHECK (unassign_reason IN (
        'equipment_pulled',
        'pin_dry_standard_met',
        'manual_edit',
        'pin_archived',
        'equipment_moved'
    )),
    note                     TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Strict `>` rejects zero-duration assignments (misclicks). Null
    -- unassigned_at (row is still active) passes trivially.
    CONSTRAINT chk_assign_order CHECK (
        unassigned_at IS NULL OR unassigned_at > assigned_at
    )
);

-- One active assignment per (placement, pin) pair. Partial index on
-- WHERE unassigned_at IS NULL means closed rows can share the pair
-- freely — re-opens after close are legitimate.
CREATE UNIQUE INDEX uniq_active_assignment
    ON equipment_pin_assignments(equipment_placement_id, moisture_pin_id)
    WHERE unassigned_at IS NULL;

-- Access-pattern indexes. Each is targeted at a specific PR-C query;
-- comments in the docstring of this migration describe which.
CREATE INDEX idx_epa_pin_active  ON equipment_pin_assignments(moisture_pin_id)
    WHERE unassigned_at IS NULL;
CREATE INDEX idx_epa_placement   ON equipment_pin_assignments(equipment_placement_id);
CREATE INDEX idx_epa_job         ON equipment_pin_assignments(job_id);

-- RLS: tenant isolation via JWT-derived company. Same shape as every
-- other Phase 1/2/3 table. The SECURITY DEFINER RPCs (validate, place,
-- move) are one layer of defense; RLS is the other in case a direct
-- PostgREST select reaches this table.
ALTER TABLE equipment_pin_assignments ENABLE ROW LEVEL SECURITY;

-- Review round-1 L2: use get_my_company_id() to match the Phase 1
-- policy shape. Consistent with equipment_placements and every other
-- tenant-scoped table.
CREATE POLICY epa_tenant ON equipment_pin_assignments USING (
    company_id = get_my_company_id()
);

COMMENT ON TABLE equipment_pin_assignments IS
    'Time-windowed link between an equipment unit and a moisture pin. '
    'Billing = distinct local calendar days covered by any assignment '
    'span on a placement. Spec 01H Phase 3 PR-B Step 3.';

COMMENT ON COLUMN equipment_pin_assignments.unassign_reason IS
    'Null while row is active; set on close. Five distinguishable '
    'causes, each produces different carrier-report copy (lesson #28): '
    'equipment_pulled / pin_dry_standard_met / manual_edit / '
    'pin_archived / equipment_moved.';

COMMENT ON COLUMN equipment_pin_assignments.note IS
    'Free-text explanation for after-the-fact corrections. Distinct '
    'from unassign_reason (structured enum) — this is tech narrative '
    '(proposal §0.4 Q3). Surfaced in the carrier-report appendix.';
"""


DOWNGRADE_SQL = """
DROP POLICY IF EXISTS epa_tenant ON equipment_pin_assignments;
DROP INDEX IF EXISTS uniq_active_assignment;
DROP INDEX IF EXISTS idx_epa_pin_active;
DROP INDEX IF EXISTS idx_epa_placement;
DROP INDEX IF EXISTS idx_epa_job;
DROP TABLE IF EXISTS equipment_pin_assignments;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
