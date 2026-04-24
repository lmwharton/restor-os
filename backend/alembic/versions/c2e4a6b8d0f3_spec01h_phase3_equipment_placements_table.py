"""Spec 01H Phase 3 PR-B Step 2: equipment_placements table (final shape).

The table didn't exist yet. Rather than creating a "plain" version and
then altering it, this migration lands it in its final PR-B shape —
every column, every constraint, every index — in one atomic CREATE.
No intermediate state to debug, one row of spec to cross-reference.

Schema decisions (cross-referenced to the pin-attribution proposal):

- ``equipment_type`` CHECK to the 5 allowed values from Spec §2.1.
- ``equipment_size`` — nullable TEXT paired with ``equipment_type`` via
  ``chk_equipment_size_valid`` (proposal C6). A dehu can be std/large/
  xl/xxl; an air mover can be std/axial; non-drying types (scrubber,
  hydroxyl, heater) must be NULL. This is the one CHECK that both
  values-check and type-pair-check; a simpler separate CHECK for just
  the value set would be redundant.
- ``billing_scope`` NOT NULL DEFAULT 'per_pin', CHECK against the two
  allowed values. Drives the per-pin vs per-room branch in PR-B Step 7's
  ``compute_placement_billable_days`` RPC.
- ``floor_plan_id`` FK with **ON DELETE RESTRICT** (proposal A2/C1) —
  the version stamp cannot be silently nulled. Later PR-B step amends
  ``save_floor_plan_version`` to re-stamp this column on fork (lesson
  #29 extension rule) so stamps stay aligned with the job's pinned
  version.
- ``asset_tag`` + ``serial_number`` TEXT nullable (proposal S6) — optional
  inventory hooks. Index on ``(company_id, asset_tag)`` is partial
  ``WHERE asset_tag IS NOT NULL`` so the index stays small for tenants
  that don't use the feature.
- ``placed_at`` NOT NULL DEFAULT now(); ``pulled_at`` nullable (null =
  still active). This is the physical on-site span; billing math uses
  it for per_room equipment and uses the junction table's spans for
  per_pin equipment.
- ``company_id`` NOT NULL + RLS policy scoping by the JWT-derived
  company — same shape every other Phase 1/2 table uses. Without RLS
  a tenant could query another tenant's placements by crafting a
  request to the RPC.
- No ``updated_at`` column. Equipment placements don't have free-form
  mutation semantics — they're created, optionally edited (notes/
  coords) via a dedicated PATCH that's always safe to write-over, and
  closed via pull or move. The two mutation paths (Step 5 place,
  Step 6 move) use purpose-built RPCs.

Revision ID: c2e4a6b8d0f3
Revises: a1d3c5e7b9f2
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2e4a6b8d0f3"
down_revision: str | None = "a1d3c5e7b9f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE TABLE equipment_placements (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id           UUID REFERENCES job_rooms(id) ON DELETE SET NULL,
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    -- NOT NULL (review round-1 M2): the RPC contract treats this stamp
    -- as required and immutable, and the fork-restamp UPDATE relies on
    -- the JOIN against floor_plans finding a matching row. Allowing
    -- NULL here lets a direct PostgREST INSERT (which only passes RLS's
    -- USING predicate on company_id) bypass the RPC and leave a stamp
    -- that the fork-restamp query can't pick up on future forks.
    floor_plan_id     UUID NOT NULL REFERENCES floor_plans(id) ON DELETE RESTRICT,
    equipment_type    TEXT NOT NULL CHECK (equipment_type IN (
        'air_mover', 'dehumidifier', 'air_scrubber', 'hydroxyl_generator', 'heater'
    )),
    equipment_size    TEXT,
    billing_scope     TEXT NOT NULL DEFAULT 'per_pin'
                      CHECK (billing_scope IN ('per_pin', 'per_room')),
    asset_tag         TEXT,
    serial_number     TEXT,
    canvas_x          DECIMAL(8,2),
    canvas_y          DECIMAL(8,2),
    placed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    pulled_at         TIMESTAMPTZ,
    placed_by         UUID REFERENCES users(id),
    pulled_by         UUID REFERENCES users(id),
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- C6: enforce type↔size pairing. Non-drying equipment MUST have NULL
-- size (there's no Xactimate size distinction for scrubbers/hydroxyls/
-- heaters); drying equipment MUST have one of the allowed sizes. Any
-- ('dehumidifier', 'axial') or ('air_mover', 'xl') etc. combination
-- fails here loudly rather than silently mapping to a wrong Xactimate
-- code at billing time.
ALTER TABLE equipment_placements
    ADD CONSTRAINT chk_equipment_size_valid CHECK (
        (equipment_type = 'air_mover'
         AND equipment_size IN ('std', 'axial'))
        OR
        (equipment_type = 'dehumidifier'
         AND equipment_size IN ('std', 'large', 'xl', 'xxl'))
        OR
        (equipment_type IN ('air_scrubber', 'hydroxyl_generator', 'heater')
         AND equipment_size IS NULL)
    );

-- Access-pattern indexes matching the proposal + PR-C's expected queries.
CREATE INDEX idx_equip_job     ON equipment_placements(job_id);
CREATE INDEX idx_equip_active  ON equipment_placements(job_id)
    WHERE pulled_at IS NULL;
CREATE INDEX idx_equip_company ON equipment_placements(company_id);
CREATE INDEX idx_equip_asset_tag
    ON equipment_placements(company_id, asset_tag)
    WHERE asset_tag IS NOT NULL;

-- RLS: tenant isolation via the JWT-derived company. Same policy shape
-- as every other Phase 1/2 table.
ALTER TABLE equipment_placements ENABLE ROW LEVEL SECURITY;

-- Review round-1 L2: use get_my_company_id() rather than reading
-- current_setting('request.jwt.claims') directly, matching the Phase 1
-- policy shape (see e1a7c9b30201 floor_plans_tenant). One function, one
-- resolution rule across every tenant-scoped table — no divergence
-- risk if the JWT→company mapping ever gains logic.
CREATE POLICY equip_tenant ON equipment_placements USING (
    company_id = get_my_company_id()
);

COMMENT ON TABLE equipment_placements IS
    'One row per individual equipment unit placed on a job. Per-pin '
    'equipment (air_mover, dehumidifier) attribution is tracked via '
    'equipment_pin_assignments; per-room equipment (air_scrubber, '
    'hydroxyl_generator, heater) uses placed_at/pulled_at directly. '
    'Spec 01H Phase 3, table landed in PR-B Step 2.';

COMMENT ON COLUMN equipment_placements.equipment_size IS
    'Required for air_mover and dehumidifier (drives Xactimate code). '
    'Must be NULL for air_scrubber, hydroxyl_generator, heater. Enforced '
    'by chk_equipment_size_valid. Valid values: std, axial, large, xl, xxl.';

COMMENT ON COLUMN equipment_placements.billing_scope IS
    'Per-pin (air_mover, dehumidifier) vs per-room (scrubber, hydroxyl, '
    'heater). Drives the branch in compute_placement_billable_days. '
    'Derived from equipment_type at insert; kept as an explicit column '
    'so the billing RPC reads one field instead of re-deriving it.';

COMMENT ON COLUMN equipment_placements.floor_plan_id IS
    'Version stamp of the floor plan the placement was drawn against. '
    'ON DELETE RESTRICT prevents silent nulling. save_floor_plan_version '
    're-stamps this on fork so downstream queries that filter by '
    'is_current find the right row (lesson #29, extension pending in '
    'a later PR-B step).';
"""


DOWNGRADE_SQL = """
-- Drop in reverse dependency order. RLS policy rides with the table
-- drop; we name it explicitly for idempotency in case someone manually
-- flipped RLS off before downgrading.
DROP POLICY IF EXISTS equip_tenant ON equipment_placements;
DROP INDEX IF EXISTS idx_equip_asset_tag;
DROP INDEX IF EXISTS idx_equip_company;
DROP INDEX IF EXISTS idx_equip_active;
DROP INDEX IF EXISTS idx_equip_job;
DROP TABLE IF EXISTS equipment_placements;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
