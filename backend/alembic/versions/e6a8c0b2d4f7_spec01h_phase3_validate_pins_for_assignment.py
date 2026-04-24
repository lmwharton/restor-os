"""Spec 01H Phase 3 PR-B Step 4: validate_pins_for_assignment helper RPC.

Shared validation helper called by place_equipment_with_pins (Step 5)
and move_equipment_placement (Step 6). One place, one set of rules —
both writers route through it so the rejection criteria can't drift
between them.

What it rejects:
  - NULL p_job_id (22023).
  - Missing JWT (42501).
  - Any pin in the array that doesn't exist, belongs to a different
    company, or belongs to a different job (42501 — collapsed into one
    error so the response doesn't leak which specific failure applied,
    matching ensure_job_mutable's P0002 pattern).
  - Any pin whose ``dry_standard_met_at IS NOT NULL`` — "dry pin"
    rejection per proposal C8 (22P02 — 'invalid_text_representation'
    repurposed; picked distinct from 42501 so PR-C can map it to a
    different HTTP status/copy: "this pin is already dry, pick a
    different one" vs "you don't have access to this pin").

Per-room equipment has no pins to validate — an empty or NULL array
passes trivially. The caller (PR-B Step 5) decides whether calling
this helper is appropriate based on ``billing_scope``.

Revision ID: e6a8c0b2d4f7
Revises: d4f6b8a0c2e5
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6a8c0b2d4f7"
down_revision: str | None = "d4f6b8a0c2e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION validate_pins_for_assignment(
    p_job_id            UUID,
    p_moisture_pin_ids  UUID[]
) RETURNS VOID AS $$
DECLARE
    v_caller_company UUID;
    v_invalid_count  INT;
    v_dry_count      INT;
BEGIN
    -- NULL job_id is always an error. Empty array is a no-op —
    -- per-room equipment doesn't pass pins, and the caller decides
    -- whether to even invoke this helper based on billing_scope.
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id is required';
    END IF;

    IF p_moisture_pin_ids IS NULL OR array_length(p_moisture_pin_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    -- Count pins in the input array that fail the tenant + job check
    -- in one scan. A mismatch surfaces as ``v_invalid_count > 0``.
    -- Collapsing the three failure modes (not-found, cross-tenant,
    -- cross-job) into one 42501 matches the lesson §3 pattern —
    -- distinguishing them would leak existence across tenants.
    SELECT COUNT(*) INTO v_invalid_count
      FROM unnest(p_moisture_pin_ids) AS requested_id
     WHERE NOT EXISTS (
         SELECT 1 FROM moisture_pins mp
          WHERE mp.id = requested_id
            AND mp.company_id = v_caller_company
            AND mp.job_id = p_job_id
     );
    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'One or more pins not found on this job or not accessible to caller';
    END IF;

    -- Proposal C8 + review round-1 M4: reject pins already marked dry.
    -- FOR SHARE locks each pin's row so a concurrent trg_moisture_pin_dry_check
    -- trigger (from an INSERT to moisture_pin_readings in another session)
    -- serializes AFTER this lock is released. Without the lock, a
    -- concurrent dry-flip between this validation and the caller's
    -- subsequent INSERT into equipment_pin_assignments would leave a new
    -- assignment bound to a now-dry pin that would silently bill until
    -- the next wet reading arrives.
    --
    -- Postgres doesn't allow FOR SHARE together with aggregate functions
    -- (like COUNT), so split the lock-then-check into two steps: (1) lock
    -- every input pin via a PERFORM-style SELECT, (2) count the dry ones
    -- in a separate COUNT query. The lock from step 1 is held to end of
    -- transaction, so the count in step 2 sees the stable state.
    PERFORM 1
      FROM moisture_pins
     WHERE id = ANY(p_moisture_pin_ids)
       FOR SHARE;

    SELECT COUNT(*) INTO v_dry_count
      FROM moisture_pins
     WHERE id = ANY(p_moisture_pin_ids)
       AND dry_standard_met_at IS NOT NULL;
    IF v_dry_count > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22P02',
                    MESSAGE = 'Cannot assign equipment to a pin that already met dry standard';
    END IF;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION validate_pins_for_assignment(UUID, UUID[])
    TO authenticated, service_role;

COMMENT ON FUNCTION validate_pins_for_assignment(UUID, UUID[]) IS
    'Shared pin-input validator for equipment RPCs. Rejects not-found / '
    'cross-tenant / cross-job (42501) and already-dry pins (22P02, C8). '
    'Empty array is a no-op. Spec 01H Phase 3 PR-B Step 4.';
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS validate_pins_for_assignment(UUID, UUID[]);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
