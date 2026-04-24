"""Spec 01H Phase 3 PR-B Step 5: place_equipment_with_pins RPC.

The big atomic placement RPC. Does four things inside one transaction:

  1. Archive-guard via ensure_job_mutable (Step 1 twin).
  2. Resolve the job's floor_plan_id for the immutable version stamp.
  3. Derive billing_scope from equipment_type + validate size pairing.
  4. For per-pin types: validate each pin via validate_pins_for_assignment
     (Step 4), then insert N placements + N×M assignments in two
     batch statements.

All-or-nothing guarantee per lesson #4. Any failure — bad pin, mismatched
asset_tags array length, dry pin, archived job — rolls back every row
this call started to write.

Why batch inserts via ``generate_series`` (Copilot #PR13-2):
  Looping ``INSERT`` per placement would do N round-trips through the
  plpgsql interpreter for N units. A tech placing 6 dehus hits 6
  loop iterations; at 20 units across a job, 20. ``generate_series``
  collapses it to one INSERT ... SELECT ... FROM generate_series that
  writes all N rows in one statement. Same for assignments — one INSERT
  with a CROSS JOIN of placement_ids × pin_ids produces N×M rows.

Inventory-metadata array length check (C7):
  If ``p_asset_tags`` is provided, its length must equal ``p_quantity`` —
  one tag per unit. A short array would silently pad with NULLs and
  misalign with physical units. Caller must pad explicitly with NULLs
  if they only have tags for some units.

Dry-pin rejection (C8):
  ``validate_pins_for_assignment`` raises 22P02 if any pin is already
  dry. Rolls back the whole call. The caller (PR-C) surfaces this as a
  specific error distinct from "pin not found" (42501).

Revision ID: f2a4c6e8b0d3
Revises: e6a8c0b2d4f7
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a4c6e8b0d3"
down_revision: str | None = "e6a8c0b2d4f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION place_equipment_with_pins(
    p_job_id            UUID,
    p_room_id           UUID,
    p_equipment_type    TEXT,
    p_equipment_size    TEXT,
    p_quantity          INT,
    p_canvas_x          NUMERIC,
    p_canvas_y          NUMERIC,
    p_moisture_pin_ids  UUID[] DEFAULT NULL,
    p_asset_tags        TEXT[] DEFAULT NULL,
    p_serial_numbers    TEXT[] DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_caller_user    UUID;  -- users.id (internal PK) — NOT auth.uid()
    v_billing_scope  TEXT;
    v_floor_plan_id  UUID;
    v_placement_ids  UUID[] := ARRAY[]::UUID[];
    v_assignments    INT := 0;
BEGIN
    -- NULL param guards for the fields we cannot default.
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_equipment_type IS NULL
       OR p_quantity IS NULL OR p_quantity < 1 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'Required parameter missing or p_quantity < 1';
    END IF;

    -- Archive + tenant guard inside the transaction (Step 1 twin).
    -- Raises P0002 / 42501 — caller already knows how to map.
    PERFORM ensure_job_mutable(p_job_id);

    v_caller_company := get_my_company_id();

    -- Review round-1 H1: cross-job room_id binding. Without this check
    -- a caller on tenant T could request job_id=A, room_id=<a room on
    -- job B in same tenant>. The room FK only validates existence;
    -- it doesn't verify the room belongs to this job. Stamp winds up
    -- with job A's floor_plan_id but room on job B's plan — canvas
    -- drops the equipment, billing bills under A, carrier report
    -- shows mystery rooms. This mirrors Phase 1's
    -- assert_job_on_floor_plan_property pattern (api/shared/guards.py).
    PERFORM 1
      FROM job_rooms
     WHERE id = p_room_id
       AND job_id = p_job_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Room not found on this job or not accessible';
    END IF;

    -- Resolve the internal users.id for placed_by / assigned_by. The
    -- users.id (PK) and users.auth_user_id (Supabase auth reference)
    -- are DIFFERENT uuids — placed_by/assigned_by FK to users.id, so
    -- auth.uid() directly would violate the FK. Scoped to caller's
    -- tenant to match every other SELECT in this function.
    SELECT id INTO v_caller_user
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    -- v_caller_user may be NULL for service-role / background contexts;
    -- placed_by is nullable so that's acceptable. The users.id is only
    -- actually unused-on-NULL — no FK violation.

    -- Derive billing_scope from equipment_type. Stored explicitly on
    -- the row so compute_placement_billable_days (Step 7) reads one
    -- column instead of re-deriving per-call.
    v_billing_scope := CASE p_equipment_type
        WHEN 'air_mover'    THEN 'per_pin'
        WHEN 'dehumidifier' THEN 'per_pin'
        ELSE 'per_room'
    END;

    -- Scope+type pairing checks that can't go in the table CHECK:
    --   per-pin REQUIRES a size (Xactimate code depends on it).
    --   per-room MUST NOT have pin ids attached (conceptually they
    --   treat the atmosphere, not specific materials).
    IF v_billing_scope = 'per_pin' AND p_equipment_size IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'equipment_size required for air_mover and dehumidifier';
    END IF;
    IF v_billing_scope = 'per_room' AND p_equipment_size IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'equipment_size must be NULL for per-room equipment types';
    END IF;
    IF v_billing_scope = 'per_room' AND p_moisture_pin_ids IS NOT NULL
       AND array_length(p_moisture_pin_ids, 1) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'per_room equipment cannot be assigned to moisture pins';
    END IF;

    -- Inventory metadata arrays must match the quantity 1:1 (C7).
    -- Silent slice/pad would misalign tags with physical units.
    IF p_asset_tags IS NOT NULL
       AND array_length(p_asset_tags, 1) <> p_quantity THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_asset_tags length must equal p_quantity';
    END IF;
    IF p_serial_numbers IS NOT NULL
       AND array_length(p_serial_numbers, 1) <> p_quantity THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_serial_numbers length must equal p_quantity';
    END IF;

    -- Resolve the job's pinned floor_plan_id. Scoped to the caller's
    -- tenant via the WHERE clause; without this, SECURITY DEFINER would
    -- let a cross-tenant caller inherit another tenant's stamp.
    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

    -- Validate every pin up front (Step 4). Empty/NULL array is a
    -- no-op — per-room equipment flows through.
    PERFORM validate_pins_for_assignment(p_job_id, p_moisture_pin_ids);

    -- Batch insert N placement rows via generate_series. One statement,
    -- one plan. ``g(i)`` is a COLUMN alias so ``p_asset_tags[i]`` and
    -- ``p_serial_numbers[i]`` resolve correctly (CP2 from the proposal
    -- review — ``AS i`` alone would make i a record alias and array
    -- subscripts would fail).
    WITH new_placements AS (
        INSERT INTO equipment_placements (
            job_id, room_id, company_id, floor_plan_id,
            equipment_type, equipment_size, billing_scope,
            canvas_x, canvas_y,
            asset_tag, serial_number,
            placed_by
        )
        SELECT p_job_id, p_room_id, v_caller_company, v_floor_plan_id,
               p_equipment_type, p_equipment_size, v_billing_scope,
               p_canvas_x, p_canvas_y,
               p_asset_tags[g.i], p_serial_numbers[g.i],
               v_caller_user
          FROM generate_series(1, p_quantity) AS g(i)
        RETURNING id
    )
    SELECT array_agg(id) INTO v_placement_ids FROM new_placements;

    -- For per-pin equipment, open N×M assignments in one statement —
    -- cartesian-join the new placement ids against the pin ids.
    -- Review round-1 M5: SELECT DISTINCT on the pin unnest so callers
    -- that accidentally pass a duplicate pin id don't trip the partial
    -- uniq_active_assignment with a raw 23505 that has no plpgsql
    -- context. Same placement + same pin already had one active row
    -- created; the dup would be a no-op anyway.
    IF array_length(p_moisture_pin_ids, 1) IS NOT NULL THEN
        INSERT INTO equipment_pin_assignments (
            equipment_placement_id, moisture_pin_id,
            job_id, company_id, assigned_by
        )
        SELECT placement_id, pin_id,
               p_job_id, v_caller_company, v_caller_user
          FROM unnest(v_placement_ids)    AS placement_id
          CROSS JOIN (
              SELECT DISTINCT pin_id FROM unnest(p_moisture_pin_ids) AS pin_id
          ) deduped;

        v_assignments := p_quantity * (
            SELECT COUNT(DISTINCT pin_id) FROM unnest(p_moisture_pin_ids) AS pin_id
        );
    END IF;

    RETURN jsonb_build_object(
        'placement_ids',    v_placement_ids,
        'placement_count',  p_quantity,
        'assignment_count', v_assignments,
        'billing_scope',    v_billing_scope,
        'floor_plan_id',    v_floor_plan_id
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION place_equipment_with_pins(
    UUID, UUID, TEXT, TEXT, INT, NUMERIC, NUMERIC, UUID[], TEXT[], TEXT[]
) TO authenticated, service_role;

COMMENT ON FUNCTION place_equipment_with_pins(
    UUID, UUID, TEXT, TEXT, INT, NUMERIC, NUMERIC, UUID[], TEXT[], TEXT[]
) IS
    'Atomic N-placement + N×M-assignment RPC. Derives billing_scope from '
    'equipment_type, validates every pin via validate_pins_for_assignment, '
    'batch-inserts via generate_series + CROSS JOIN. Spec 01H Phase 3 PR-B Step 5.';
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS place_equipment_with_pins(
    UUID, UUID, TEXT, TEXT, INT, NUMERIC, NUMERIC, UUID[], TEXT[], TEXT[]
);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
