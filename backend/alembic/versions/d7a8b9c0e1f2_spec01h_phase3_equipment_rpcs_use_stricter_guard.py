"""Spec 01H Phase 3 PR-B2 Step 7: equipment RPCs use ensure_equipment_mutable.

Last step of the rollback branch. The four equipment mutation RPCs
(``place_equipment``, ``restart_equipment_placement``,
``pull_equipment_placement``, ``move_equipment_placement``) currently
call ``ensure_job_mutable`` which only blocks ``'collected'``. Step 5
introduced the stricter ``ensure_equipment_mutable`` that also blocks
``'complete'`` + ``'submitted'``. This migration swaps every
equipment RPC over to the stricter guard so the moment a tech taps
"Mark Job Complete," every further place / restart / pull / move
attempt raises 55006 from the DB.

Why one migration for all four: sibling symmetry (lesson §32). Any
sibling that ends up on the looser guard becomes the backdoor — a
tech could still mutate equipment on a complete job by going
through whichever RPC was forgotten. The only defense is changing all
four in one landing + a grep test pinning the invariant.

Since signatures don't change, pure CREATE OR REPLACE — no DROP needed.
Bodies are copied from d1a2b3c4e5f6 (move) and d3a4b5c6e7f8 (place /
restart / pull) with the PERFORM ensure_job_mutable call swapped to
PERFORM ensure_equipment_mutable and short PR-B2-Step-7 comments added
above each swap to document the guard-strictening rationale inline.
Structure-wise the bodies are equivalent to their Step 1 / Step 3
counterparts; the substantive invariant (every equipment RPC uses the
stricter guard) is enforced by
``tests/test_migration_pr_b2_equipment_rpcs.py::test_step7_all_four_equipment_rpcs_call_stricter_guard``,
which counts guard call-sites inside UPGRADE_SQL and asserts 4 strict,
0 loose.

Revision ID: d7a8b9c0e1f2
Revises: d6a7b8c9e0f1
Create Date: 2026-04-25
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7a8b9c0e1f2"
down_revision: str | None = "d6a7b8c9e0f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ============================================================================
-- place_equipment — swap to ensure_equipment_mutable.
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

    -- PR-B2 Step 7: stricter guard blocks 'complete' + 'submitted'
    -- on top of 'collected'. Equipment is frozen the moment the tech
    -- taps Mark Job Complete.
    PERFORM ensure_equipment_mutable(p_job_id);

    v_caller_company := get_my_company_id();

    PERFORM 1
      FROM job_rooms
     WHERE id = p_room_id
       AND job_id = p_job_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Room not found on this job or not accessible';
    END IF;

    SELECT id INTO v_caller_user
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;

    IF p_equipment_type IN ('air_mover', 'dehumidifier') AND p_equipment_size IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'equipment_size required for air_mover and dehumidifier';
    END IF;
    IF p_equipment_type NOT IN ('air_mover', 'dehumidifier') AND p_equipment_size IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'equipment_size must be NULL for per-room equipment types';
    END IF;

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

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

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


-- ============================================================================
-- restart_equipment_placement — swap to ensure_equipment_mutable.
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

    -- PR-B2 Step 7: stricter guard.
    PERFORM ensure_equipment_mutable(p_job_id);

    v_caller_company := get_my_company_id();

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

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

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

    -- Cycle-safe chain walk (see round-1 review MEDIUM #1 fix in Step 3).
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


-- ============================================================================
-- pull_equipment_placement — swap to ensure_equipment_mutable.
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

    -- PR-B2 Step 7: stricter guard. Note: this means ONCE the job is
    -- marked complete, even pulling a still-active unit is blocked —
    -- which is correct because complete_job auto-pulls everything in
    -- the same transaction. There's no legitimate reason to pull post-
    -- completion; reopen the job first.
    PERFORM ensure_equipment_mutable(p_job_id);

    v_caller_company := get_my_company_id();

    SELECT id INTO v_caller_user
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;

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


-- ============================================================================
-- move_equipment_placement — swap to ensure_equipment_mutable.
-- ============================================================================
CREATE OR REPLACE FUNCTION move_equipment_placement(
    p_placement_id  UUID,
    p_new_room_id   UUID,
    p_new_canvas_x  NUMERIC,
    p_new_canvas_y  NUMERIC,
    p_note          TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_placement      equipment_placements%ROWTYPE;
    v_floor_plan_id  UUID;
BEGIN
    IF p_placement_id IS NULL OR p_new_room_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_placement_id and p_new_room_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    SELECT * INTO v_placement
      FROM equipment_placements
     WHERE id = p_placement_id
       AND company_id = v_caller_company
       FOR UPDATE;
    IF v_placement.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Placement not found or not accessible';
    END IF;

    -- PR-B2 Step 7: stricter guard. The move RPC resolves the job_id
    -- from the locked placement row (not a param), so the guard call
    -- comes after the SELECT. Still inside the txn.
    PERFORM ensure_equipment_mutable(v_placement.job_id);

    PERFORM 1
      FROM job_rooms
     WHERE id = p_new_room_id
       AND job_id = v_placement.job_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Target room not found on this job or not accessible';
    END IF;

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = v_placement.job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

    UPDATE equipment_placements
       SET room_id       = p_new_room_id,
           canvas_x      = p_new_canvas_x,
           canvas_y      = p_new_canvas_y,
           floor_plan_id = v_floor_plan_id,
           notes         = COALESCE(p_note, notes),
           updated_at    = now()
     WHERE id = p_placement_id;

    RETURN jsonb_build_object(
        'placement_id',  p_placement_id,
        'room_id',       p_new_room_id,
        'floor_plan_id', v_floor_plan_id
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;
"""


# Downgrade restores the ensure_job_mutable call in all four RPCs.
# Bodies are identical except for that one line.
DOWNGRADE_SQL = """
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

    PERFORM ensure_job_mutable(p_job_id);

    v_caller_company := get_my_company_id();

    PERFORM 1
      FROM job_rooms
     WHERE id = p_room_id
       AND job_id = p_job_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Room not found on this job or not accessible';
    END IF;

    SELECT id INTO v_caller_user
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;

    IF p_equipment_type IN ('air_mover', 'dehumidifier') AND p_equipment_size IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'equipment_size required for air_mover and dehumidifier';
    END IF;
    IF p_equipment_type NOT IN ('air_mover', 'dehumidifier') AND p_equipment_size IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'equipment_size must be NULL for per-room equipment types';
    END IF;

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

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

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

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

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

    -- Cycle-safe chain walk (see round-1 review MEDIUM #1 fix in Step 3).
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


CREATE OR REPLACE FUNCTION move_equipment_placement(
    p_placement_id  UUID,
    p_new_room_id   UUID,
    p_new_canvas_x  NUMERIC,
    p_new_canvas_y  NUMERIC,
    p_note          TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_placement      equipment_placements%ROWTYPE;
    v_floor_plan_id  UUID;
BEGIN
    IF p_placement_id IS NULL OR p_new_room_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_placement_id and p_new_room_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    SELECT * INTO v_placement
      FROM equipment_placements
     WHERE id = p_placement_id
       AND company_id = v_caller_company
       FOR UPDATE;
    IF v_placement.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Placement not found or not accessible';
    END IF;

    PERFORM ensure_job_mutable(v_placement.job_id);

    PERFORM 1
      FROM job_rooms
     WHERE id = p_new_room_id
       AND job_id = v_placement.job_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Target room not found on this job or not accessible';
    END IF;

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = v_placement.job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

    UPDATE equipment_placements
       SET room_id       = p_new_room_id,
           canvas_x      = p_new_canvas_x,
           canvas_y      = p_new_canvas_y,
           floor_plan_id = v_floor_plan_id,
           notes         = COALESCE(p_note, notes),
           updated_at    = now()
     WHERE id = p_placement_id;

    RETURN jsonb_build_object(
        'placement_id',  p_placement_id,
        'room_id',       p_new_room_id,
        'floor_plan_id', v_floor_plan_id
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
