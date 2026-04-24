"""Spec 01H Phase 3 PR-B Step 6: move_equipment_placement RPC.

Atomic "move a placement to a different room" operation. Does four
things in one transaction so billing continuity is preserved:

  1. Archive guard + tenant check on the placement row.
  2. Close all active assignments with unassign_reason='equipment_moved'.
  3. Update the placement's room_id + canvas_x + canvas_y.
  4. (Per-pin only) open fresh assignments against the new-room pins.

Billing continuity: distinct-local-calendar-days math naturally handles
the move. If Dehu A is moved at 2 PM on Apr 22, the old-room assignment
closes at 14:00 and the new-room assignment opens at 14:00; Apr 22
counts once in the union because it's the same local day. No fake
idle day. No double-count.

Concurrency lock (PR-A M2 pattern): ``SELECT ... FOR NO KEY UPDATE`` on
the placement row at entry. Two concurrent moves on the same placement
would otherwise each read the same pre-move state under READ COMMITTED
and race to write — the later committer would silently overwrite the
earlier one's location. The lock serializes moves per placement (not
across placements, so unrelated moves stay parallel).

Revision ID: a3c5e7b9d1f4
Revises: f2a4c6e8b0d3
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3c5e7b9d1f4"
down_revision: str | None = "f2a4c6e8b0d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION move_equipment_placement(
    p_placement_id          UUID,
    p_new_room_id           UUID,
    p_new_canvas_x          NUMERIC,
    p_new_canvas_y          NUMERIC,
    p_new_moisture_pin_ids  UUID[] DEFAULT NULL,
    p_note                  TEXT   DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_caller_user    UUID;
    v_placement      equipment_placements%ROWTYPE;
    v_closed_count   INT := 0;
    v_opened_count   INT := 0;
BEGIN
    -- NULL param guards.
    IF p_placement_id IS NULL OR p_new_room_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_placement_id and p_new_room_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    -- Lock + fetch the placement (PR-A M2 pattern). FOR NO KEY UPDATE
    -- is the right strength — we update non-key columns (room_id,
    -- canvas coords) and want to block concurrent moves on the same
    -- placement without blocking readers. Tenant scope in the same
    -- SELECT so a cross-tenant placement_id resolves as not-found,
    -- not as "locked other tenant's row."
    SELECT * INTO v_placement
      FROM equipment_placements
     WHERE id = p_placement_id
       AND company_id = v_caller_company
       FOR NO KEY UPDATE;
    IF v_placement.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Placement not found or not accessible';
    END IF;

    -- Can't move a placement that's already been pulled — nothing there
    -- to move. Silent-succeed would confuse billing (the pulled_at
    -- span wouldn't match the new location).
    IF v_placement.pulled_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'Cannot move a pulled placement';
    END IF;

    -- Archive guard: inherit from the placement's job. Callers don't
    -- need to pass p_job_id separately — we derive it.
    PERFORM ensure_job_mutable(v_placement.job_id);

    -- Review round-1 H3: reject pin ids on per_room moves loudly,
    -- matching place_equipment_with_pins's behavior. The prior code
    -- silently dropped pins on per_room moves (validate ran only on
    -- per_pin; the INSERT was gated per_pin too). Same-PR sibling-miss
    -- per lesson #3; fix both sites with the same shape.
    IF v_placement.billing_scope = 'per_room'
       AND p_new_moisture_pin_ids IS NOT NULL
       AND array_length(p_new_moisture_pin_ids, 1) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'per_room equipment cannot be assigned to moisture pins';
    END IF;

    -- Review round-1 H1: cross-job room_id binding on the new room.
    -- Same shape as place_equipment_with_pins — the FK only checks
    -- existence; we need the room to belong to THIS placement's job.
    PERFORM 1
      FROM job_rooms
     WHERE id = p_new_room_id
       AND job_id = v_placement.job_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'New room not found on this placement''s job or not accessible';
    END IF;

    -- For per_pin placements, validate the new pins before any writes.
    -- Step 4's helper rejects cross-tenant / cross-job / dry pins.
    -- Per_room placements ignore p_new_moisture_pin_ids entirely (the
    -- scope-mismatch check above already rejected non-empty arrays).
    IF v_placement.billing_scope = 'per_pin' THEN
        PERFORM validate_pins_for_assignment(
            v_placement.job_id,
            p_new_moisture_pin_ids
        );
    END IF;

    -- Resolve caller's internal user id for unassigned_by / assigned_by.
    SELECT id INTO v_caller_user
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;

    -- Close all currently-open assignments with the 'equipment_moved'
    -- reason. Review round-1 L3: stamp p_note on the closing row when
    -- supplied, so the after-the-fact correction narrative Proposal
    -- §0.4 Q3 describes ("moved at adjuster's request") is preserved
    -- on the audit trail. COALESCE preserves any prior note on the
    -- row that was set via a manual edit — we append narrative, we
    -- don't overwrite history.
    WITH closed AS (
        UPDATE equipment_pin_assignments
           SET unassigned_at   = now(),
               unassigned_by   = v_caller_user,
               unassign_reason = 'equipment_moved',
               note            = COALESCE(note, p_note)
         WHERE equipment_placement_id = p_placement_id
           AND unassigned_at IS NULL
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_closed_count FROM closed;

    -- Update placement location. floor_plan_id STAYS — the stamp is the
    -- version the unit was drawn on, not the version it's currently
    -- rendered against. Two placements (one original, one moved) on the
    -- same job share a floor_plan_id via jobs.floor_plan_id.
    UPDATE equipment_placements
       SET room_id  = p_new_room_id,
           canvas_x = p_new_canvas_x,
           canvas_y = p_new_canvas_y
     WHERE id = p_placement_id;

    -- For per-pin placements, open fresh assignments to the new pins.
    -- Per-room placements skip this step; their billing comes from the
    -- placement's own span, not assignment spans.
    -- L3: stamp the note on newly-opened assignments too so the
    -- narrative anchors to the new span, not just the closing one.
    -- DISTINCT mirrors place_equipment_with_pins's M5 dedup.
    IF v_placement.billing_scope = 'per_pin'
       AND p_new_moisture_pin_ids IS NOT NULL
       AND array_length(p_new_moisture_pin_ids, 1) IS NOT NULL THEN
        WITH opened AS (
            INSERT INTO equipment_pin_assignments (
                equipment_placement_id, moisture_pin_id,
                job_id, company_id, assigned_by, note
            )
            SELECT p_placement_id, pin_id,
                   v_placement.job_id, v_caller_company, v_caller_user,
                   p_note
              FROM (
                  SELECT DISTINCT pin_id FROM unnest(p_new_moisture_pin_ids) AS pin_id
              ) deduped
            RETURNING 1
        )
        SELECT COUNT(*) INTO v_opened_count FROM opened;
    END IF;

    RETURN jsonb_build_object(
        'placement_id',      p_placement_id,
        'old_room_id',       v_placement.room_id,
        'new_room_id',       p_new_room_id,
        'assignments_closed', v_closed_count,
        'assignments_opened', v_opened_count,
        'billing_scope',     v_placement.billing_scope
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION move_equipment_placement(
    UUID, UUID, NUMERIC, NUMERIC, UUID[], TEXT
) TO authenticated, service_role;

COMMENT ON FUNCTION move_equipment_placement(UUID, UUID, NUMERIC, NUMERIC, UUID[], TEXT) IS
    'Atomic cross-room move for an equipment placement. Closes old '
    'assignments, updates location, opens new assignments — one '
    'transaction. Spec 01H Phase 3 PR-B Step 6.';
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS move_equipment_placement(
    UUID, UUID, NUMERIC, NUMERIC, UUID[], TEXT
);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
