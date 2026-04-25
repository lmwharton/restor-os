"""Spec 01H Phase 3 PR-B2 Step 3: place / restart / pull equipment RPCs.

Three mutation RPCs that form the write API for the rolled-back
equipment model. All atomic, all SECURITY DEFINER with pinned
search_path, all derive tenant from JWT (never from params — lesson §3).

place_equipment(...)
    Drops N placement rows for a new unit (or units — quantity N).
    Derives floor_plan_id from the job's current stamp inside the
    transaction. No pin attachment — equipment is tied to rooms only.
    Returns JSONB { placement_ids, placement_count, floor_plan_id }.

restart_equipment_placement(job_id, previous_placement_id)
    Creates a new row linked to a pulled parent via
    restarted_from_placement_id. Copies type/size/room/position/tags
    from parent. Re-stamps floor_plan_id from the job (the parent's
    stamp may be an older version if the floor plan forked since).
    Returns JSONB { placement_id, chain_head_id, floor_plan_id }.

pull_equipment_placement(job_id, placement_id, note)
    Stamps pulled_at + pulled_by on one row. NOT FOUND raises P0002
    ("nothing to pull — either doesn't exist or already pulled").
    Returns JSONB { placement_id, pulled_at }.

Why each of these is an RPC (vs a plain UPDATE via PostgREST):
    - archive guard (ensure_job_mutable) must run in the same txn
    - tenant check must derive from JWT, not from caller params
    - multi-row writes (place with quantity>1) need atomicity
    - cross-job validation (chain parent must be same job) needs
      server-side enforcement

Chain head resolution for the restart RPC is done with a recursive
CTE — walks backward following restarted_from_placement_id until it
hits NULL. O(chain length) worst case, typically 1-3 hops.

Revision ID: d3a4b5c6e7f8
Revises: d2a3b4c5e6f7
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3a4b5c6e7f8"
down_revision: str | None = "d2a3b4c5e6f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ============================================================================
-- place_equipment — simpler replacement for place_equipment_with_pins.
-- ============================================================================
CREATE OR REPLACE FUNCTION place_equipment(
    p_job_id           UUID,
    p_room_id          UUID,
    p_equipment_type   TEXT,
    p_equipment_size   TEXT,
    p_quantity         INT,
    p_canvas_x         NUMERIC,
    p_canvas_y         NUMERIC,
    p_asset_tags       TEXT[] DEFAULT NULL,
    p_serial_numbers   TEXT[] DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_caller_user    UUID;
    v_floor_plan_id  UUID;
    v_placement_ids  UUID[] := ARRAY[]::UUID[];
BEGIN
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_equipment_type IS NULL
       OR p_quantity IS NULL OR p_quantity < 1 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'Required parameter missing or p_quantity < 1';
    END IF;

    -- Archive + tenant guard inside the txn (PR-B Step 1 twin).
    PERFORM ensure_job_mutable(p_job_id);

    v_caller_company := get_my_company_id();

    -- Lesson #30 — cross-job room binding. FK only validates existence.
    PERFORM 1
      FROM job_rooms
     WHERE id = p_room_id
       AND job_id = p_job_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Room not found on this job or not accessible';
    END IF;

    -- Resolve internal users.id for placed_by audit (auth.uid() returns
    -- the Supabase auth id — different UUID space than users.id).
    SELECT id INTO v_caller_user
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;

    -- Type↔size pairing enforced by the table CHECK constraint, but we
    -- surface a clearer message here for the drying-equipment case
    -- (rolled-back place_equipment_with_pins had the same guard; we
    -- keep it for parity so error copy doesn't regress).
    IF p_equipment_type IN ('air_mover', 'dehumidifier') AND p_equipment_size IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'equipment_size required for air_mover and dehumidifier';
    END IF;
    IF p_equipment_type NOT IN ('air_mover', 'dehumidifier') AND p_equipment_size IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'equipment_size must be NULL for per-room equipment types';
    END IF;

    -- Inventory-metadata array lengths must match quantity 1:1 (C7).
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

    -- Resolve the job's current floor_plan_id. Tenant-scoped SELECT so
    -- SECURITY DEFINER can't leak cross-tenant stamps (lesson §3).
    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

    -- Batch insert N rows via generate_series. ``AS g(i)`` gives i a
    -- COLUMN alias so p_asset_tags[g.i] resolves (CP2).
    WITH new_placements AS (
        INSERT INTO equipment_placements (
            job_id, room_id, company_id, floor_plan_id,
            equipment_type, equipment_size,
            canvas_x, canvas_y,
            asset_tag, serial_number,
            placed_by
        )
        SELECT p_job_id, p_room_id, v_caller_company, v_floor_plan_id,
               p_equipment_type, p_equipment_size,
               p_canvas_x, p_canvas_y,
               p_asset_tags[g.i], p_serial_numbers[g.i],
               v_caller_user
          FROM generate_series(1, p_quantity) AS g(i)
        RETURNING id
    )
    SELECT array_agg(id) INTO v_placement_ids FROM new_placements;

    RETURN jsonb_build_object(
        'placement_ids',   v_placement_ids,
        'placement_count', p_quantity,
        'floor_plan_id',   v_floor_plan_id
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION place_equipment(
    UUID, UUID, TEXT, TEXT, INT, NUMERIC, NUMERIC, TEXT[], TEXT[]
) TO authenticated, service_role;

COMMENT ON FUNCTION place_equipment(
    UUID, UUID, TEXT, TEXT, INT, NUMERIC, NUMERIC, TEXT[], TEXT[]
) IS
    'Place N equipment units in a room. Simpler than the rolled-back '
    'place_equipment_with_pins — no pin attachment. Spec 01H Phase 3 '
    'PR-B2 Step 3.';


-- ============================================================================
-- restart_equipment_placement — chain-link a new row to a pulled parent.
-- ============================================================================
CREATE OR REPLACE FUNCTION restart_equipment_placement(
    p_job_id                UUID,
    p_previous_placement_id UUID,
    p_note                  TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_caller_user    UUID;
    v_parent         equipment_placements%ROWTYPE;
    v_new_id         UUID;
    v_chain_head     UUID;
    v_floor_plan_id  UUID;
BEGIN
    IF p_job_id IS NULL OR p_previous_placement_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id and p_previous_placement_id are required';
    END IF;

    PERFORM ensure_job_mutable(p_job_id);

    v_caller_company := get_my_company_id();

    -- Lock + validate parent. Must be pulled (chain integrity trigger
    -- enforces this again on insert, but we check upfront so the error
    -- message is crisp — trigger says "parent active", we say "nothing
    -- to restart"). Tenant-scoped SELECT prevents cross-tenant probing.
    SELECT * INTO v_parent
      FROM equipment_placements
     WHERE id = p_previous_placement_id
       AND job_id = p_job_id
       AND company_id = v_caller_company
       AND pulled_at IS NOT NULL
       FOR UPDATE;
    IF v_parent.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'No pulled placement matching this id on this job (already active, not found, or cross-tenant)';
    END IF;

    SELECT id INTO v_caller_user
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;

    -- Re-stamp floor_plan from the job — the parent's stamp may be
    -- older if a fork happened while the unit was paused. Lesson #29
    -- still holds: every new row on this table carries the current
    -- job floor_plan_id.
    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

    -- Insert the new chain link. Trigger trg_equipment_chain_integrity
    -- (Step 2) validates same-job + same-type/size + parent-pulled as
    -- a belt-and-suspenders check.
    INSERT INTO equipment_placements (
        job_id, room_id, company_id, floor_plan_id,
        equipment_type, equipment_size,
        canvas_x, canvas_y,
        asset_tag, serial_number,
        notes,
        placed_by,
        restarted_from_placement_id
    ) VALUES (
        v_parent.job_id, v_parent.room_id, v_caller_company, v_floor_plan_id,
        v_parent.equipment_type, v_parent.equipment_size,
        v_parent.canvas_x, v_parent.canvas_y,
        v_parent.asset_tag, v_parent.serial_number,
        COALESCE(p_note, v_parent.notes),
        v_caller_user,
        p_previous_placement_id
    )
    RETURNING id INTO v_new_id;

    -- Walk chain backward to find the root (UI labels the unit by the
    -- head's id so all chain members render as one). Recursive CTE;
    -- typical depth 1-3 in practice.
    -- Round-1 review MEDIUM #1 — cycle detection. The chk_chain_not_self
    -- CHECK blocks 1-cycles (id = parent) but 2+ cycles are only
    -- blocked at write time by the integrity trigger, which never sees
    -- a chain walk. If a cycle somehow exists (direct PostgREST UPDATE
    -- bypassing the RPCs; corrupted restore; future migration drift),
    -- this recursive CTE would loop until Postgres aborts — DoS shape.
    -- The Postgres 14+ CYCLE clause (Supabase runs PG 15) tracks the
    -- visited path and flags cycles without infinite loop. If a cycle
    -- is seen we filter it out of the chain_head match; the fallback
    -- defensive NULL check below (if v_chain_head IS NULL) then
    -- surfaces the corruption with a clear error.
    WITH RECURSIVE chain(id, parent) AS (
        SELECT id, restarted_from_placement_id
          FROM equipment_placements
         WHERE id = v_new_id
        UNION ALL
        SELECT ep.id, ep.restarted_from_placement_id
          FROM equipment_placements ep
          JOIN chain c ON ep.id = c.parent
    ) CYCLE id SET is_cycle USING path
    SELECT id INTO v_chain_head
      FROM chain
     WHERE parent IS NULL
       AND NOT is_cycle
     LIMIT 1;

    IF v_chain_head IS NULL THEN
        -- Only reachable if the CTE hit a cycle with no NULL-parent
        -- head, or an upstream row was deleted after the insert.
        -- Either way, the chain is broken — raise to surface the
        -- corruption rather than returning a misleading NULL.
        RAISE EXCEPTION USING ERRCODE = '55006',
                    MESSAGE = 'Placement chain has a cycle or is broken — no root found';
    END IF;

    RETURN jsonb_build_object(
        'placement_id',   v_new_id,
        'chain_head_id',  v_chain_head,
        'floor_plan_id',  v_floor_plan_id
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION restart_equipment_placement(UUID, UUID, TEXT)
    TO authenticated, service_role;

COMMENT ON FUNCTION restart_equipment_placement(UUID, UUID, TEXT) IS
    'Resume a pulled equipment unit as a new chain link. Copies type/'
    'size/room/position/tags from parent; re-stamps floor_plan_id from '
    'the current job state. Spec 01H Phase 3 PR-B2 Step 3.';


-- ============================================================================
-- pull_equipment_placement — stop billing for one placement row.
-- ============================================================================
CREATE OR REPLACE FUNCTION pull_equipment_placement(
    p_job_id        UUID,
    p_placement_id  UUID,
    p_note          TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_caller_user    UUID;
    v_pulled_at      TIMESTAMPTZ;
BEGIN
    IF p_job_id IS NULL OR p_placement_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id and p_placement_id are required';
    END IF;

    PERFORM ensure_job_mutable(p_job_id);

    v_caller_company := get_my_company_id();

    SELECT id INTO v_caller_user
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;

    -- Atomic compare-and-set: only updates if still active. The WHERE
    -- clause covers tenant + job + not-already-pulled in one shot.
    -- RETURNING captures pulled_at so the caller knows the exact
    -- moment billing stopped (UI displays it).
    UPDATE equipment_placements
       SET pulled_at  = now(),
           pulled_by  = v_caller_user,
           notes      = COALESCE(p_note, notes),
           updated_at = now()
     WHERE id = p_placement_id
       AND job_id = p_job_id
       AND company_id = v_caller_company
       AND pulled_at IS NULL
    RETURNING pulled_at INTO v_pulled_at;

    IF v_pulled_at IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'No active placement matching this id on this job (already pulled, not found, or cross-tenant)';
    END IF;

    RETURN jsonb_build_object(
        'placement_id', p_placement_id,
        'pulled_at',    v_pulled_at
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION pull_equipment_placement(UUID, UUID, TEXT)
    TO authenticated, service_role;

COMMENT ON FUNCTION pull_equipment_placement(UUID, UUID, TEXT) IS
    'Stamp pulled_at on one equipment placement. Atomic compare-and-set '
    'on pulled_at IS NULL so double-pull is a loud P0002, not silent '
    'success. Spec 01H Phase 3 PR-B2 Step 3.';
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS pull_equipment_placement(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS restart_equipment_placement(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS place_equipment(
    UUID, UUID, TEXT, TEXT, INT, NUMERIC, NUMERIC, TEXT[], TEXT[]
);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
