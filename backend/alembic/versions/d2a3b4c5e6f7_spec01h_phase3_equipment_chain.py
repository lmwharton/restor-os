"""Spec 01H Phase 3 PR-B2 Step 2: equipment placement chain column.

Adds ``equipment_placements.restarted_from_placement_id`` — a self-
referential FK that lets a new placement row point at the most recent
prior placement it's "resuming." This is how a single physical unit
(think Scrubber #2) stays one icon on the canvas across pause/restart
cycles while still being N separate rows in the database.

Data model:

    ┌───────────────────────────────────────────────┐
    │ placement A: restarted_from_placement_id=NULL │
    │ placement B: restarted_from_placement_id = A  │
    │ placement C: restarted_from_placement_id = B  │
    └───────────────────────────────────────────────┘
    → UI walks the chain backward to render one unit
    → billing sums each row independently (chain is
      transparent to the billing math)

What this migration installs:

1. ``restarted_from_placement_id UUID NULL REFERENCES
   equipment_placements(id) ON DELETE SET NULL``
   — the column itself. Nullable so the first placement in any chain
   has no parent. ``SET NULL`` on delete means if a parent row is
   ever hard-deleted (unlikely — we prefer soft-delete), the child
   becomes a new chain head rather than dangling a bad FK.

2. ``chk_chain_not_self`` CHECK (restarted_from_placement_id IS NULL
   OR restarted_from_placement_id <> id)
   — guard against a caller setting a row to reference itself. Would
   never be useful + would make the chain walker loop forever.

3. ``trg_equipment_chain_integrity`` BEFORE INSERT OR UPDATE trigger
   — runtime enforcement that the parent row:
     - belongs to the same (job_id, company_id) as the child
     - has the same (equipment_type, equipment_size) — a chain must
       be one physical unit, not a mixed reincarnation
     - has pulled_at IS NOT NULL — you can only restart a unit that
       was actually pulled. Restarting an active unit makes no sense
       and would create two active rows for the same physical thing.
   Room_id is intentionally NOT required to match — a tech can pull
   a unit from Room A and restart it in Room B; billing doesn't care.

4. ``idx_equip_chain`` partial index on restarted_from_placement_id
   WHERE restarted_from_placement_id IS NOT NULL
   — lookup "rows that restarted from this one" in O(log N) for the
   UI's chain-walk query. Partial because most rows have NULL here.

Why no generated chain_head_id column: tempting but a normalized
chain walker (recursive CTE) is fine for the read side, and materializing
a head would double-write every insert (update the head, update the
new row) — more synchronization risk than it's worth.

Revision ID: d2a3b4c5e6f7
Revises: d1a2b3c4e5f6
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2a3b4c5e6f7"
down_revision: str | None = "d1a2b3c4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- (1) Column + FK + self-reference CHECK.
ALTER TABLE equipment_placements
    ADD COLUMN restarted_from_placement_id UUID
        REFERENCES equipment_placements(id) ON DELETE SET NULL;

ALTER TABLE equipment_placements
    ADD CONSTRAINT chk_chain_not_self CHECK (
        restarted_from_placement_id IS NULL
        OR restarted_from_placement_id <> id
    );

-- (2) Partial index for the chain-walk read pattern.
CREATE INDEX idx_equip_chain
    ON equipment_placements(restarted_from_placement_id)
    WHERE restarted_from_placement_id IS NOT NULL;

-- (3) Integrity trigger. Runs BEFORE INSERT OR UPDATE so invalid
--     writes never land. Returns NULL on a rejection path would silence
--     the INSERT; we always RAISE on rejection (lesson §7 — loud-fail,
--     never silent-drop).
CREATE OR REPLACE FUNCTION equipment_chain_integrity()
RETURNS TRIGGER AS $$
DECLARE
    v_parent equipment_placements%ROWTYPE;
BEGIN
    -- No parent → this row is a chain head. Nothing to validate.
    IF NEW.restarted_from_placement_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Fetch the parent. Locking with FOR SHARE so a concurrent UPDATE
    -- of the parent's pulled_at can't race the check.
    SELECT * INTO v_parent
      FROM equipment_placements
     WHERE id = NEW.restarted_from_placement_id
       FOR SHARE;

    IF v_parent.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'restarted_from_placement_id references a non-existent placement';
    END IF;

    -- Same job + tenant. A chain must live inside one job — crossing
    -- jobs would tangle billing rollups. Mirrors lesson #30: FK
    -- existence isn't enough; the binding must be explicit.
    IF v_parent.job_id <> NEW.job_id THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'Chain parent must belong to the same job as the child placement';
    END IF;
    IF v_parent.company_id <> NEW.company_id THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Chain parent belongs to a different tenant';
    END IF;

    -- Same physical unit → same type + size. Keeps the chain coherent
    -- for billing rollups (air_mover · xl days count as one line,
    -- can't accidentally inherit from a dehumidifier).
    IF v_parent.equipment_type <> NEW.equipment_type THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'Chain parent has a different equipment_type — restart must continue the same unit';
    END IF;
    -- equipment_size can be NULL for per-room types on both sides;
    -- IS DISTINCT FROM handles NULL-equality cleanly.
    IF v_parent.equipment_size IS DISTINCT FROM NEW.equipment_size THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'Chain parent has a different equipment_size — restart must continue the same unit';
    END IF;

    -- Parent must be pulled. You can't restart a unit that's currently
    -- active — there'd be two rows representing the same physical thing
    -- running simultaneously, which corrupts the canvas (two icons for
    -- one unit) and billing (double-counting).
    IF v_parent.pulled_at IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'Cannot restart a placement whose pulled_at is NULL (parent is still active)';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_equipment_chain_integrity ON equipment_placements;
CREATE TRIGGER trg_equipment_chain_integrity
    BEFORE INSERT OR UPDATE OF restarted_from_placement_id
    ON equipment_placements
    FOR EACH ROW
    EXECUTE FUNCTION equipment_chain_integrity();

COMMENT ON COLUMN equipment_placements.restarted_from_placement_id IS
    'Self-FK that links a restarted placement to the pulled placement '
    'it resumed. Chain = one physical unit across pause/restart cycles. '
    'UI walks backward to render one icon; billing sums each row '
    'independently. Spec 01H Phase 3 PR-B2 Step 2.';
"""


DOWNGRADE_SQL = """
DROP TRIGGER IF EXISTS trg_equipment_chain_integrity ON equipment_placements;
DROP FUNCTION IF EXISTS equipment_chain_integrity();
DROP INDEX IF EXISTS idx_equip_chain;
ALTER TABLE equipment_placements
    DROP CONSTRAINT IF EXISTS chk_chain_not_self;
ALTER TABLE equipment_placements
    DROP COLUMN IF EXISTS restarted_from_placement_id;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
