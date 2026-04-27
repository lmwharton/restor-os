"""Spec 01H Phase 2: normalize moisture_pins location into surface + position + wall_segment_id.

Drops the denormalized ``location_name`` (TEXT, currently composed by the
frontend as ``"{Surface}, {PositionWord}, {Room}"``) in favor of three
structured columns:

* ``surface TEXT NOT NULL`` — one of ``floor``, ``wall``, ``ceiling``.
* ``position TEXT`` — nullable, one of ``C/NW/NE/SW/SE`` (quadrant within
  the surface). Position semantics for wall/ceiling are deferred — keep
  NULL for now and revisit once the picker UI exists.
* ``wall_segment_id UUID REFERENCES wall_segments(id) ON DELETE SET NULL`` —
  populated only when ``surface = 'wall'``. NULL is allowed (draft state:
  pin saved on a wall before the picker resolved which segment).

A one-directional CHECK enforces the binding: ``wall_segment_id IS NULL OR
surface = 'wall'``. Floor or ceiling pin with a stray wall reference is
loud-rejected (lesson #7). Wall pin without a segment is allowed (draft
state).

The atomic ``create_moisture_pin_with_reading`` RPC swaps ``p_location_name``
for ``p_surface`` + ``p_position`` + ``p_wall_segment_id``. New body adds:

* Surface enum + position enum guards (mirror DB CHECKs at function level
  for clearer error messages).
* Cross-room wall binding check (lesson #30): when ``p_wall_segment_id``
  is non-NULL, ``PERFORM 1 FROM wall_segments WHERE id = p_wall_segment_id
  AND room_id = p_room_id AND company_id = v_caller_company`` — relying on
  the FK alone permits cross-room walls (FK only validates existence).

``save_floor_plan_version`` is extended to re-stamp
``moisture_pins.wall_segment_id`` after walls are wipe-and-re-inserted on
fork. Match by ``(room_id, sort_order)`` — stable across forks that
don't edit this room's polygon. When sort_order doesn't match (room
geometry was edited and walls renumbered), the stamp falls to NULL via
``ON DELETE SET NULL`` — the original wall genuinely no longer exists,
so honest NULL beats fake-restamp (lesson #2).

Lesson #29 extension: ``EXPECTED_RESTAMP_TABLES`` in
``tests/integration/test_fork_restamp_invariant.py`` gets a new entry for
``moisture_pins.wall_segment_id``.

Lesson #23 (PostgREST schema-cache drift): RPC param count changes
(13 → 15). Live envs need ``NOTIFY pgrst, 'reload schema';`` post-upgrade.

Backfill: parses existing ``location_name`` into surface + position. Any
unparseable row aborts the migration loud. Wall surface backfilled rows
get NULL ``position`` + NULL ``wall_segment_id`` (no link in legacy data).

Revision ID: e2b3c4d5f6a7
Revises: d7a8b9c0e1f2
Create Date: 2026-04-26
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2b3c4d5f6a7"
down_revision: str | None = "d8b9c0d1e2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ============================================================================
-- Step 1: add new columns nullable so the backfill has room to write.
-- ============================================================================

ALTER TABLE moisture_pins
    ADD COLUMN surface         TEXT,
    ADD COLUMN position        TEXT,
    ADD COLUMN wall_segment_id UUID REFERENCES wall_segments(id) ON DELETE SET NULL;

-- ============================================================================
-- Step 2: backfill from location_name. Format: "{Surface}, {PositionWord}, {Room}".
-- Surface lowercased; position word mapped to the 5-value enum.
-- For wall/ceiling: position is set NULL (semantically meaningless under the
-- new model — defer to picker UX). wall_segment_id stays NULL for all
-- backfilled rows (legacy data has no link).
-- Any row whose location_name doesn't parse aborts the migration via the
-- final NOT NULL flip below.
-- ============================================================================

UPDATE moisture_pins
   SET surface = CASE
                   WHEN location_name ILIKE 'Floor,%'   THEN 'floor'
                   WHEN location_name ILIKE 'Wall,%'    THEN 'wall'
                   WHEN location_name ILIKE 'Ceiling,%' THEN 'ceiling'
                   ELSE NULL
                 END,
       position = CASE
                   WHEN location_name ILIKE 'Floor,%' THEN
                     CASE
                       WHEN location_name ILIKE '%, Center, %'    THEN 'C'
                       WHEN location_name ILIKE '%, Northwest, %' THEN 'NW'
                       WHEN location_name ILIKE '%, Northeast, %' THEN 'NE'
                       WHEN location_name ILIKE '%, Southwest, %' THEN 'SW'
                       WHEN location_name ILIKE '%, Southeast, %' THEN 'SE'
                       ELSE NULL
                     END
                   ELSE NULL  -- wall + ceiling: position is NULL by design
                 END;

-- ============================================================================
-- Step 3: flip surface NOT NULL. Fails loudly if any backfill missed (good
-- signal — surfaces a malformed legacy location_name that needs hand-fixing
-- before this migration ships).
-- ============================================================================

ALTER TABLE moisture_pins
    ALTER COLUMN surface SET NOT NULL;

-- ============================================================================
-- Step 4: CHECK constraints.
--   * surface enum: floor / wall / ceiling.
--   * position enum: C/NW/NE/SW/SE (nullable — only required for floor under
--     today's UX, but the CHECK doesn't tie surface↔position so future UX
--     for wall/ceiling positions can land without a CHECK rewrite).
--   * Bidirectional binding: wall_segment_id may only be set when surface='wall'.
--     Floor/ceiling pin with a stray wall ref is loud-rejected (lesson #7).
--     Wall pin with NULL wall_segment_id is allowed (draft state — picker
--     hasn't shipped yet).
-- ============================================================================

ALTER TABLE moisture_pins
    ADD CONSTRAINT chk_moisture_pin_surface
        CHECK (surface IN ('floor', 'wall', 'ceiling'));

ALTER TABLE moisture_pins
    ADD CONSTRAINT chk_moisture_pin_position
        CHECK (position IS NULL OR position IN ('C', 'NW', 'NE', 'SW', 'SE'));

ALTER TABLE moisture_pins
    ADD CONSTRAINT chk_moisture_pin_wall_segment_only_when_wall
        CHECK (wall_segment_id IS NULL OR surface = 'wall');

-- ============================================================================
-- Step 5: drop the denormalized column.
-- ============================================================================

ALTER TABLE moisture_pins
    DROP COLUMN location_name;

-- ============================================================================
-- Step 6: replace create_moisture_pin_with_reading. Signature changes
-- (drop p_location_name, add p_surface + p_position + p_wall_segment_id) so
-- DROP the existing 13-arg overload before CREATE — lesson #10.
-- ============================================================================

DROP FUNCTION IF EXISTS create_moisture_pin_with_reading(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, UUID,
    NUMERIC, TIMESTAMPTZ, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION create_moisture_pin_with_reading(
    p_job_id          UUID,
    p_room_id         UUID,
    p_company_id      UUID,
    p_canvas_x        NUMERIC,
    p_canvas_y        NUMERIC,
    p_surface         TEXT,
    p_position        TEXT,
    p_wall_segment_id UUID,
    p_material        TEXT,
    p_dry_standard    NUMERIC,
    p_created_by      UUID,
    p_reading_value   NUMERIC,
    p_taken_at        TIMESTAMPTZ,
    p_meter_photo_url TEXT,
    p_notes           TEXT
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_floor_plan_id  UUID;
    v_pin            moisture_pins%ROWTYPE;
    v_reading        moisture_pin_readings%ROWTYPE;
BEGIN
    -- NULL-required guards. surface is required; position + wall_segment_id
    -- are optional (CHECK handles their cross-field constraints).
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_company_id IS NULL
       OR p_canvas_x IS NULL OR p_canvas_y IS NULL
       OR p_surface IS NULL OR p_material IS NULL
       OR p_dry_standard IS NULL
       OR p_reading_value IS NULL OR p_taken_at IS NULL
    THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023';
    END IF;

    -- Tenancy: JWT-derived company must match p_company_id (lesson §3).
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION 'Company mismatch'
              USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match caller company';
    END IF;

    -- Cross-room wall binding (lesson #30). FK on wall_segment_id only
    -- validates existence; without this check a caller could pick a wall
    -- from a different room (or another tenant's room if RLS were ever
    -- bypassed). PERFORM scoped to (id, room_id, company_id) closes both.
    IF p_wall_segment_id IS NOT NULL THEN
        PERFORM 1 FROM wall_segments
         WHERE id = p_wall_segment_id
           AND room_id = p_room_id
           AND company_id = v_caller_company;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Wall segment does not belong to this room or tenant'
                  USING ERRCODE = 'P0002';
        END IF;
    END IF;

    -- Resolve the room's floor_plan_id (Phase 2 stamp). NULL is acceptable
    -- (legacy ambiguous room) — the pin's stamp tracks the room's stamp.
    SELECT floor_plan_id INTO v_floor_plan_id
      FROM job_rooms
     WHERE id = p_room_id
       AND company_id = v_caller_company;

    -- INSERT the pin. surface/position/wall_segment_id replace location_name.
    INSERT INTO moisture_pins (
        job_id, room_id, company_id,
        canvas_x, canvas_y,
        surface, position, wall_segment_id,
        material, dry_standard, created_by,
        floor_plan_id
    ) VALUES (
        p_job_id, p_room_id, p_company_id,
        p_canvas_x, p_canvas_y,
        p_surface, p_position, p_wall_segment_id,
        p_material, p_dry_standard, p_created_by,
        v_floor_plan_id
    )
    RETURNING * INTO v_pin;

    -- INSERT the initial reading. Function-level transaction rolls back both
    -- on any failure inside the function. Lesson #4.
    INSERT INTO moisture_pin_readings (
        pin_id, company_id, reading_value, taken_at,
        recorded_by, meter_photo_url, notes
    ) VALUES (
        v_pin.id, p_company_id, p_reading_value, p_taken_at,
        p_created_by, p_meter_photo_url, p_notes
    )
    RETURNING * INTO v_reading;

    RETURN jsonb_build_object(
        'pin', to_jsonb(v_pin),
        'reading', to_jsonb(v_reading)
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION create_moisture_pin_with_reading(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, UUID, TEXT, NUMERIC, UUID,
    NUMERIC, TIMESTAMPTZ, TEXT, TEXT
) TO authenticated, service_role;

-- ============================================================================
-- Step 7: extend save_floor_plan_version to re-stamp
-- moisture_pins.wall_segment_id after walls are wiped-and-re-inserted on
-- fork. The wipe-and-re-insert lives in the application layer (snapshot
-- restore RPCs e5f8a9b0c1d2 + f6a9b0c1d2e3); save_floor_plan_version
-- itself doesn't touch wall_segments — but pins stamped against the old
-- wall UUIDs need to flip to the new ones whenever those occur in the
-- same fork window.
--
-- Match by (room_id, sort_order). When sort_order doesn't match (the
-- room's polygon was edited and walls renumbered or removed), the
-- ON DELETE SET NULL on wall_segment_id has already nulled the stamp —
-- nothing to re-target. This UPDATE is a no-op in that case.
--
-- Body copied byte-for-byte from b7d9f1a3c5e8 + the new UPDATE block
-- inserted alongside the existing job_rooms / moisture_pins.floor_plan_id /
-- equipment_placements UPDATEs. Symmetric downgrade restores the prior body.
-- ============================================================================

CREATE OR REPLACE FUNCTION save_floor_plan_version(
    p_property_id           UUID,
    p_floor_number          INTEGER,
    p_floor_name            TEXT,
    p_company_id            UUID,
    p_job_id                UUID,
    p_user_id               UUID,
    p_canvas_data           JSONB,
    p_change_summary        TEXT,
    p_expected_updated_at   TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_next_number     INTEGER;
    v_inherited_name  TEXT;
    v_new_row         floor_plans%ROWTYPE;
    v_caller_company  UUID;
    v_flipped_count   INTEGER;
BEGIN
    IF p_job_id IS NULL OR p_company_id IS NULL OR p_property_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_company_id, and p_property_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match the authenticated caller company';
    END IF;

    PERFORM 1
      FROM properties
     WHERE id = p_property_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Property not found or does not belong to the caller company';
    END IF;

    PERFORM 1
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND property_id = p_property_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or does not belong to this property';
    END IF;

    SELECT version_number + 1,
           COALESCE(p_floor_name, floor_name)
      INTO v_next_number, v_inherited_name
      FROM floor_plans
     WHERE property_id  = p_property_id
       AND floor_number = p_floor_number
     ORDER BY version_number DESC
     LIMIT 1;

    IF v_next_number IS NULL THEN
        v_next_number    := 1;
        v_inherited_name := COALESCE(p_floor_name,
                                     'Floor ' || p_floor_number::TEXT);
    END IF;

    IF p_expected_updated_at IS NOT NULL THEN
        UPDATE floor_plans
           SET is_current = false
         WHERE property_id  = p_property_id
           AND floor_number = p_floor_number
           AND is_current   = true
           AND updated_at   = p_expected_updated_at;
        GET DIAGNOSTICS v_flipped_count = ROW_COUNT;

        IF v_flipped_count = 0 THEN
            PERFORM 1 FROM floor_plans
             WHERE property_id  = p_property_id
               AND floor_number = p_floor_number
               AND is_current   = true;
            IF FOUND THEN
                RAISE EXCEPTION USING ERRCODE = '55006',
                    MESSAGE = 'Current floor plan version updated_at does not match expected — another writer committed between the caller''s read and this RPC';
            END IF;
        END IF;
    ELSE
        UPDATE floor_plans
           SET is_current = false
         WHERE property_id  = p_property_id
           AND floor_number = p_floor_number
           AND is_current   = true;
    END IF;

    INSERT INTO floor_plans (
        property_id, company_id, floor_number, floor_name,
        version_number, canvas_data, created_by_job_id, created_by_user_id,
        change_summary, is_current
    ) VALUES (
        p_property_id, p_company_id, p_floor_number, v_inherited_name,
        v_next_number, p_canvas_data, p_job_id, p_user_id,
        p_change_summary, true
    )
    RETURNING * INTO v_new_row;

    UPDATE jobs
       SET floor_plan_id = v_new_row.id
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    -- ==========================================================================
    -- Re-stamp downstream tables inside the fork transaction.
    -- Existing entries (lesson #29 — EXPECTED_RESTAMP_TABLES enumeration):
    --   * job_rooms.floor_plan_id (e7b9c2f4a8d6)
    --   * moisture_pins.floor_plan_id (e7b9c2f4a8d6)
    --   * equipment_placements.floor_plan_id (b7d9f1a3c5e8)
    -- New entry (this migration):
    --   * moisture_pins.wall_segment_id (matched by room_id + sort_order)
    -- ==========================================================================

    UPDATE job_rooms jr
       SET floor_plan_id = v_new_row.id
      FROM floor_plans fp
     WHERE jr.floor_plan_id = fp.id
       AND jr.job_id = p_job_id
       AND fp.property_id = p_property_id
       AND fp.floor_number = p_floor_number;

    UPDATE moisture_pins mp
       SET floor_plan_id = v_new_row.id
      FROM floor_plans fp
     WHERE mp.floor_plan_id = fp.id
       AND mp.job_id = p_job_id
       AND fp.property_id = p_property_id
       AND fp.floor_number = p_floor_number;

    UPDATE equipment_placements ep
       SET floor_plan_id = v_new_row.id
      FROM floor_plans fp
     WHERE ep.floor_plan_id = fp.id
       AND ep.job_id = p_job_id
       AND fp.property_id = p_property_id
       AND fp.floor_number = p_floor_number;

    -- Re-target moisture_pins.wall_segment_id from the OLD wall_segments row
    -- (now-orphaned UUID after the snapshot-restore wipe-and-re-insert) to
    -- the NEW row that occupies the same (room_id, sort_order) slot. When
    -- sort_order shifted (room polygon edited), no match is found and
    -- ON DELETE SET NULL has already nulled the pin's stamp — this UPDATE
    -- is a no-op for those pins.
    UPDATE moisture_pins mp
       SET wall_segment_id = new_walls.id
      FROM wall_segments old_walls
      JOIN wall_segments new_walls
        ON new_walls.room_id    = old_walls.room_id
       AND new_walls.sort_order = old_walls.sort_order
       AND new_walls.id <> old_walls.id
     WHERE mp.wall_segment_id = old_walls.id
       AND mp.job_id = p_job_id
       AND old_walls.room_id IN (
           SELECT id FROM job_rooms
            WHERE job_id = p_job_id
              AND floor_plan_id = v_new_row.id
       );

    RETURN to_jsonb(v_new_row);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;
"""


# Symmetric downgrade. Reverse order: restore the old RPC body first (so any
# in-flight caller mid-downgrade sees a consistent function), then add
# location_name back nullable, backfill from surface/position/room name,
# flip NOT NULL, drop the new columns + CHECKs.
DOWNGRADE_SQL = """
-- ============================================================================
-- Step 1: restore save_floor_plan_version to the b7d9f1a3c5e8 body (without
-- the wall_segment_id re-stamp UPDATE).
-- ============================================================================

CREATE OR REPLACE FUNCTION save_floor_plan_version(
    p_property_id           UUID,
    p_floor_number          INTEGER,
    p_floor_name            TEXT,
    p_company_id            UUID,
    p_job_id                UUID,
    p_user_id               UUID,
    p_canvas_data           JSONB,
    p_change_summary        TEXT,
    p_expected_updated_at   TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_next_number     INTEGER;
    v_inherited_name  TEXT;
    v_new_row         floor_plans%ROWTYPE;
    v_caller_company  UUID;
    v_flipped_count   INTEGER;
BEGIN
    IF p_job_id IS NULL OR p_company_id IS NULL OR p_property_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_company_id, and p_property_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match the authenticated caller company';
    END IF;

    PERFORM 1
      FROM properties
     WHERE id = p_property_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Property not found or does not belong to the caller company';
    END IF;

    PERFORM 1
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND property_id = p_property_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or does not belong to this property';
    END IF;

    SELECT version_number + 1,
           COALESCE(p_floor_name, floor_name)
      INTO v_next_number, v_inherited_name
      FROM floor_plans
     WHERE property_id  = p_property_id
       AND floor_number = p_floor_number
     ORDER BY version_number DESC
     LIMIT 1;

    IF v_next_number IS NULL THEN
        v_next_number    := 1;
        v_inherited_name := COALESCE(p_floor_name,
                                     'Floor ' || p_floor_number::TEXT);
    END IF;

    IF p_expected_updated_at IS NOT NULL THEN
        UPDATE floor_plans
           SET is_current = false
         WHERE property_id  = p_property_id
           AND floor_number = p_floor_number
           AND is_current   = true
           AND updated_at   = p_expected_updated_at;
        GET DIAGNOSTICS v_flipped_count = ROW_COUNT;

        IF v_flipped_count = 0 THEN
            PERFORM 1 FROM floor_plans
             WHERE property_id  = p_property_id
               AND floor_number = p_floor_number
               AND is_current   = true;
            IF FOUND THEN
                RAISE EXCEPTION USING ERRCODE = '55006',
                    MESSAGE = 'Current floor plan version updated_at does not match expected — another writer committed between the caller''s read and this RPC';
            END IF;
        END IF;
    ELSE
        UPDATE floor_plans
           SET is_current = false
         WHERE property_id  = p_property_id
           AND floor_number = p_floor_number
           AND is_current   = true;
    END IF;

    INSERT INTO floor_plans (
        property_id, company_id, floor_number, floor_name,
        version_number, canvas_data, created_by_job_id, created_by_user_id,
        change_summary, is_current
    ) VALUES (
        p_property_id, p_company_id, p_floor_number, v_inherited_name,
        v_next_number, p_canvas_data, p_job_id, p_user_id,
        p_change_summary, true
    )
    RETURNING * INTO v_new_row;

    UPDATE jobs
       SET floor_plan_id = v_new_row.id
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    UPDATE job_rooms jr
       SET floor_plan_id = v_new_row.id
      FROM floor_plans fp
     WHERE jr.floor_plan_id = fp.id
       AND jr.job_id = p_job_id
       AND fp.property_id = p_property_id
       AND fp.floor_number = p_floor_number;

    UPDATE moisture_pins mp
       SET floor_plan_id = v_new_row.id
      FROM floor_plans fp
     WHERE mp.floor_plan_id = fp.id
       AND mp.job_id = p_job_id
       AND fp.property_id = p_property_id
       AND fp.floor_number = p_floor_number;

    UPDATE equipment_placements ep
       SET floor_plan_id = v_new_row.id
      FROM floor_plans fp
     WHERE ep.floor_plan_id = fp.id
       AND ep.job_id = p_job_id
       AND fp.property_id = p_property_id
       AND fp.floor_number = p_floor_number;

    RETURN to_jsonb(v_new_row);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

-- ============================================================================
-- Step 2: restore the c8f1a3d5b7e9 RPC body (drop the new 15-arg signature
-- explicitly first to avoid leaving two overloads — lesson #10).
-- ============================================================================

DROP FUNCTION IF EXISTS create_moisture_pin_with_reading(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, UUID, TEXT, NUMERIC, UUID,
    NUMERIC, TIMESTAMPTZ, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION create_moisture_pin_with_reading(
    p_job_id          UUID,
    p_room_id         UUID,
    p_company_id      UUID,
    p_canvas_x        NUMERIC,
    p_canvas_y        NUMERIC,
    p_location_name   TEXT,
    p_material        TEXT,
    p_dry_standard    NUMERIC,
    p_created_by      UUID,
    p_reading_value   NUMERIC,
    p_taken_at        TIMESTAMPTZ,
    p_meter_photo_url TEXT,
    p_notes           TEXT
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_floor_plan_id  UUID;
    v_pin            moisture_pins%ROWTYPE;
    v_reading        moisture_pin_readings%ROWTYPE;
BEGIN
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_company_id IS NULL
       OR p_canvas_x IS NULL OR p_canvas_y IS NULL
       OR p_location_name IS NULL OR p_material IS NULL
       OR p_dry_standard IS NULL
       OR p_reading_value IS NULL OR p_taken_at IS NULL
    THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION 'Company mismatch'
              USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match caller company';
    END IF;

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM job_rooms
     WHERE id = p_room_id
       AND company_id = v_caller_company;

    INSERT INTO moisture_pins (
        job_id, room_id, company_id,
        canvas_x, canvas_y, location_name,
        material, dry_standard, created_by,
        floor_plan_id
    ) VALUES (
        p_job_id, p_room_id, p_company_id,
        p_canvas_x, p_canvas_y, p_location_name,
        p_material, p_dry_standard, p_created_by,
        v_floor_plan_id
    )
    RETURNING * INTO v_pin;

    INSERT INTO moisture_pin_readings (
        pin_id, company_id, reading_value, taken_at,
        recorded_by, meter_photo_url, notes
    ) VALUES (
        v_pin.id, p_company_id, p_reading_value, p_taken_at,
        p_created_by, p_meter_photo_url, p_notes
    )
    RETURNING * INTO v_reading;

    RETURN jsonb_build_object(
        'pin', to_jsonb(v_pin),
        'reading', to_jsonb(v_reading)
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION create_moisture_pin_with_reading(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, UUID,
    NUMERIC, TIMESTAMPTZ, TEXT, TEXT
) TO authenticated, service_role;

-- ============================================================================
-- Step 3: re-add location_name nullable, backfill from new fields + room
-- name, then flip NOT NULL.
-- ============================================================================

ALTER TABLE moisture_pins
    ADD COLUMN location_name TEXT;

UPDATE moisture_pins mp
   SET location_name = (
       CASE mp.surface
           WHEN 'floor'   THEN 'Floor'
           WHEN 'wall'    THEN 'Wall'
           WHEN 'ceiling' THEN 'Ceiling'
       END
       || ', '
       || COALESCE(
              CASE mp.position
                  WHEN 'C'  THEN 'Center'
                  WHEN 'NW' THEN 'Northwest'
                  WHEN 'NE' THEN 'Northeast'
                  WHEN 'SW' THEN 'Southwest'
                  WHEN 'SE' THEN 'Southeast'
              END,
              'Center'  -- fallback for non-floor pins (which had NULL position post-upgrade)
          )
       || ', '
       || COALESCE(jr.name, 'Unknown')
   )
  FROM job_rooms jr
 WHERE jr.id = mp.room_id;

ALTER TABLE moisture_pins
    ALTER COLUMN location_name SET NOT NULL;

-- ============================================================================
-- Step 4: drop new constraints + columns.
-- ============================================================================

ALTER TABLE moisture_pins
    DROP CONSTRAINT IF EXISTS chk_moisture_pin_wall_segment_only_when_wall,
    DROP CONSTRAINT IF EXISTS chk_moisture_pin_position,
    DROP CONSTRAINT IF EXISTS chk_moisture_pin_surface;

ALTER TABLE moisture_pins
    DROP COLUMN wall_segment_id,
    DROP COLUMN position,
    DROP COLUMN surface;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
