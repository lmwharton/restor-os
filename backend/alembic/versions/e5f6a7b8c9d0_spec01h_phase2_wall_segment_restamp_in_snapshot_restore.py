"""Spec 01H Phase 2 follow-up (Gemini cross-review): move wall_segment_id re-stamp from save_floor_plan_version to restore_floor_plan_relational_snapshot.

Closes the CRITICAL bug surfaced by the Gemini cross-verification of
the location-split branch.

**The bug:** migration ``e2b3c4d5f6a7`` added an ``UPDATE moisture_pins
SET wall_segment_id = new_walls.id ... JOIN ON sort_order ... AND
new_walls.id <> old_walls.id`` block to ``save_floor_plan_version``,
intending to re-stamp pins from old wall UUIDs to new wall UUIDs after
a fork. The block is structurally a no-op:

* The regular ``save_floor_plan_version`` call (forking a new
  ``floor_plans`` row) does NOT touch ``wall_segments`` at all. Walls
  keep their UUIDs across that path. The ``<> old_walls.id`` filter
  finds nothing because no new wall row exists yet. No-op #1.

* The rollback path (``rollback_floor_plan_version_atomic``) calls
  ``save_floor_plan_version`` FIRST, then
  ``restore_floor_plan_relational_snapshot`` SECOND. So at the moment
  the UPDATE runs inside ``save_floor_plan_version``, the snapshot
  restore hasn't yet wiped+reinserted walls — no new walls exist. No-op
  #2. Then the snapshot restore wipes walls room-by-room
  (``DELETE FROM wall_segments WHERE room_id = ...``) and the
  ``ON DELETE SET NULL`` FK on ``moisture_pins.wall_segment_id`` nulls
  every wall pin in that room. Then new walls are INSERTed — but
  nothing re-links the pins. **Net: every rollback nulls every wall
  pin's wall_segment_id**, even when the room polygon is unchanged.

The migration's docstring claimed the UPDATE preserved
``wall_segment_id`` across forks. The text-scan test
(``test_fork_restamp_invariant.py``) green-lit the syntax of the
UPDATE statement; it did NOT exercise an end-to-end rollback against a
real DB and assert that pins keep their stamps. The failure shape was
invisible to text-scan.

**Why it didn't bite yet:** every wall pin in the live DB has
``wall_segment_id = NULL`` today (the picker UX hasn't shipped). The
load-bearing claim in the docstring becomes load-bearing the moment a
non-NULL ``wall_segment_id`` enters the system.

**The fix:** the re-stamp has to live where both old and new wall data
are accessible — that's ``restore_floor_plan_relational_snapshot``,
which iterates the snapshot per-room, wipes the old walls, then
inserts the new ones. We capture the pin → ``(room_id, sort_order)``
map BEFORE the DELETE, then after each room's INSERTs complete, we
re-stamp pins whose original ``sort_order`` matches a new wall in the
same room.

* Pins whose original ``sort_order`` matches a new wall → re-stamped.
* Pins whose ``sort_order`` no longer matches (room polygon edited;
  walls renumbered or removed) → stay NULL via the ``ON DELETE SET
  NULL`` from the wipe. Same honest answer as before — the wall the
  pin pointed at genuinely no longer exists.

Also strips the dead UPDATE block from ``save_floor_plan_version``.
The function no longer pretends to re-stamp wall_segment_ids on
forks; it never did.

Lessons applied:

* Lesson #29 ("every floor_plan_id stamp must be re-stamped on fork")
  generalizes — every cross-table reference that's invalidated by a
  table-level wipe needs an explicit re-stamp at the wipe site, not
  somewhere upstream.
* Lesson #12 ("test-tool mismatch") — text-scan green-lights syntax,
  not semantics. A runtime end-to-end test against a real DB would
  have caught this on the original PR.
* Lesson #13 ("lessons doc ≠ shield") — docstring-as-claim isn't
  protection. Verify the call order before trusting the claim.

Revision ID: e5f6a7b8c9d0
Revises: e4d5f6a7b8c9
Create Date: 2026-04-26
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "e4d5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ============================================================================
# UPGRADE
# ============================================================================
#
# Two function bodies are replaced:
#
# 1. save_floor_plan_version — strip the dead wall_segment_id UPDATE
#    block. Keep every other re-stamp (job_rooms / moisture_pins.
#    floor_plan_id / equipment_placements) intact. Body otherwise
#    matches b7d9f1a3c5e8 + e2b3c4d5f6a7's intended shape minus the
#    misplaced wall_segment block.
#
# 2. restore_floor_plan_relational_snapshot — the body from
#    f6a9b0c1d2e3, augmented with the pin → sort_order capture before
#    DELETE and the post-INSERT UPDATE that re-stamps pins.
# ============================================================================

UPGRADE_SQL = """
-- ============================================================================
-- save_floor_plan_version — drop the dead wall_segment_id UPDATE block.
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

    -- Re-stamp downstream tables that pin floor_plan_id (lesson #29):
    -- job_rooms, moisture_pins, equipment_placements. These are the
    -- correct re-stamps — wall_segment_id deliberately NOT here, that
    -- happens inside restore_floor_plan_relational_snapshot where new
    -- wall ids are visible.

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
-- restore_floor_plan_relational_snapshot — capture pin → sort_order
-- map per room before DELETE, re-stamp after INSERTs.
--
-- Body identical to f6a9b0c1d2e3's version EXCEPT:
--   * v_pin_wall_remap JSONB local added.
--   * Capture block runs BEFORE `DELETE FROM wall_segments`.
--   * Re-stamp UPDATE runs AFTER the inner FOR wall INSERT loop and
--     before the wall_sf recompute.
-- ============================================================================

CREATE OR REPLACE FUNCTION restore_floor_plan_relational_snapshot(
    p_new_floor_plan_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_caller_company   UUID;
    v_canvas           JSONB;
    v_snapshot         JSONB;
    v_snapshot_version INTEGER;
    v_room_count       INTEGER := 0;
    v_wall_count       INTEGER := 0;
    v_opening_count    INTEGER := 0;
    v_skipped_rooms    JSONB := '[]'::JSONB;
    v_room_jsonb       JSONB;
    v_room_id          UUID;
    v_wall_jsonb       JSONB;
    v_new_wall_id      UUID;
    v_opening_jsonb    JSONB;
    v_pin_wall_remap   JSONB;
BEGIN
    IF p_new_floor_plan_id IS NULL THEN
        RAISE EXCEPTION 'p_new_floor_plan_id is required'
              USING ERRCODE = '22023';
    END IF;
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'JWT did not resolve to a company'
              USING ERRCODE = '42501';
    END IF;
    SELECT canvas_data INTO v_canvas
      FROM floor_plans
     WHERE id = p_new_floor_plan_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rollback version not found or belongs to another company'
              USING ERRCODE = 'P0002';
    END IF;
    v_snapshot := v_canvas -> '_relational_snapshot';
    IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'object' THEN
        RETURN jsonb_build_object(
            'restored', false,
            'reason', 'no_snapshot',
            'rooms', 0,
            'walls', 0,
            'openings', 0,
            'skipped_rooms', '[]'::JSONB
        );
    END IF;
    v_snapshot_version := COALESCE((v_snapshot ->> 'version')::INTEGER, 0);
    IF v_snapshot_version <> 1 THEN
        RAISE EXCEPTION 'Unsupported snapshot version: %', v_snapshot_version
              USING ERRCODE = '22023';
    END IF;

    FOR v_room_jsonb IN
        SELECT * FROM jsonb_array_elements(v_snapshot -> 'rooms')
    LOOP
        v_room_id := (v_room_jsonb ->> 'id')::UUID;

        -- F3 skip path preserved — gone/foreign rooms recorded for
        -- caller logging rather than silently dropped.
        PERFORM 1 FROM job_rooms
         WHERE id = v_room_id AND company_id = v_caller_company;
        IF NOT FOUND THEN
            v_skipped_rooms := v_skipped_rooms || jsonb_build_array(v_room_id::TEXT);
            CONTINUE;
        END IF;

        UPDATE job_rooms
           SET room_polygon   = v_room_jsonb -> 'room_polygon',
               floor_openings = COALESCE(v_room_jsonb -> 'floor_openings', '[]'::jsonb)
         WHERE id = v_room_id AND company_id = v_caller_company;

        -- ============================================================
        -- Phase 2 location-split fix (e5f6a7b8c9d0): capture the pin →
        -- sort_order mapping for THIS room BEFORE wiping walls. The
        -- ON DELETE SET NULL FK on moisture_pins.wall_segment_id will
        -- null out every pin in this room when the DELETE fires; we
        -- need the original sort_order to re-link them to the new
        -- wall ids after re-INSERT.
        -- ============================================================
        SELECT COALESCE(
            jsonb_agg(jsonb_build_object(
                'pin_id', mp.id,
                'sort_order', ws.sort_order
            )),
            '[]'::jsonb
        )
          INTO v_pin_wall_remap
          FROM moisture_pins mp
          JOIN wall_segments ws ON ws.id = mp.wall_segment_id
         WHERE mp.room_id = v_room_id
           AND mp.company_id = v_caller_company
           AND mp.wall_segment_id IS NOT NULL;

        DELETE FROM wall_segments
         WHERE room_id = v_room_id
           AND company_id = v_caller_company;

        v_room_count := v_room_count + 1;

        FOR v_wall_jsonb IN
            SELECT * FROM jsonb_array_elements(COALESCE(v_room_jsonb -> 'walls', '[]'::jsonb))
        LOOP
            INSERT INTO wall_segments (
                room_id, company_id,
                x1, y1, x2, y2,
                wall_type, wall_height_ft,
                affected, shared, shared_with_room_id, sort_order
            ) VALUES (
                v_room_id, v_caller_company,
                (v_wall_jsonb ->> 'x1')::DECIMAL,
                (v_wall_jsonb ->> 'y1')::DECIMAL,
                (v_wall_jsonb ->> 'x2')::DECIMAL,
                (v_wall_jsonb ->> 'y2')::DECIMAL,
                COALESCE(v_wall_jsonb ->> 'wall_type', 'interior'),
                NULLIF(v_wall_jsonb ->> 'wall_height_ft', '')::DECIMAL,
                COALESCE((v_wall_jsonb ->> 'affected')::BOOLEAN, false),
                COALESCE((v_wall_jsonb ->> 'shared')::BOOLEAN, false),
                NULLIF(v_wall_jsonb ->> 'shared_with_room_id', '')::UUID,
                COALESCE((v_wall_jsonb ->> 'sort_order')::INTEGER, 0)
            )
            RETURNING id INTO v_new_wall_id;

            v_wall_count := v_wall_count + 1;

            FOR v_opening_jsonb IN
                SELECT * FROM jsonb_array_elements(COALESCE(v_wall_jsonb -> '_openings', '[]'::jsonb))
            LOOP
                INSERT INTO wall_openings (
                    wall_id, company_id,
                    opening_type, position,
                    width_ft, height_ft, sill_height_ft, swing
                ) VALUES (
                    v_new_wall_id, v_caller_company,
                    v_opening_jsonb ->> 'opening_type',
                    (v_opening_jsonb ->> 'position')::DECIMAL,
                    (v_opening_jsonb ->> 'width_ft')::DECIMAL,
                    (v_opening_jsonb ->> 'height_ft')::DECIMAL,
                    NULLIF(v_opening_jsonb ->> 'sill_height_ft', '')::DECIMAL,
                    NULLIF(v_opening_jsonb ->> 'swing', '')::INTEGER
                );
                v_opening_count := v_opening_count + 1;
            END LOOP;
        END LOOP;

        -- ============================================================
        -- Phase 2 location-split fix (e5f6a7b8c9d0): re-stamp pins from
        -- captured (pin_id, old sort_order) → new wall row at same
        -- (room_id, sort_order). Pins whose sort_order no longer maps
        -- (room polygon edited; walls renumbered or removed) keep
        -- wall_segment_id = NULL — that's the honest answer; the
        -- original wall genuinely no longer exists.
        -- ============================================================
        IF v_pin_wall_remap IS NOT NULL AND v_pin_wall_remap <> '[]'::jsonb THEN
            UPDATE moisture_pins mp
               SET wall_segment_id = new_ws.id
              FROM jsonb_to_recordset(v_pin_wall_remap)
                AS pwr(pin_id UUID, sort_order INTEGER)
              JOIN wall_segments new_ws
                ON new_ws.room_id = v_room_id
               AND new_ws.company_id = v_caller_company
               AND new_ws.sort_order = pwr.sort_order
             WHERE mp.id = pwr.pin_id;
        END IF;

        -- F2: with walls + openings + pin re-stamps now settled,
        -- recompute the stored wall_square_footage so the R16 "backend
        -- authoritative" invariant holds across the rollback path.
        PERFORM _compute_wall_sf_for_room(v_room_id, v_caller_company);
    END LOOP;

    RETURN jsonb_build_object(
        'restored', true,
        'rooms', v_room_count,
        'walls', v_wall_count,
        'openings', v_opening_count,
        'skipped_rooms', v_skipped_rooms
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;
"""


# ============================================================================
# DOWNGRADE — restore prior bodies byte-for-byte.
#
# save_floor_plan_version: restore the e2b3c4d5f6a7 body that includes
# the (dead) wall_segment_id UPDATE block. Even though that block was
# a no-op, downgrading must preserve the pre-fix shape so a future
# alembic downgrade -1 against this revision matches the prior
# function definition exactly.
#
# restore_floor_plan_relational_snapshot: restore the f6a9b0c1d2e3
# body without the pin re-stamp logic. Pins re-nulled on rollback —
# that's the pre-fix behavior we're reverting to (lesson #10 spirit).
# ============================================================================

DOWNGRADE_SQL = """
-- Restore save_floor_plan_version including the (dead) wall_segment_id UPDATE.

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

    -- Dead UPDATE block restored byte-for-byte from e2b3c4d5f6a7 for
    -- downgrade symmetry. Functionally a no-op (see e5f6a7b8c9d0
    -- migration docstring for the structural analysis).
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


-- Restore restore_floor_plan_relational_snapshot WITHOUT pin re-stamp.
-- Body matches f6a9b0c1d2e3 byte-for-byte.

CREATE OR REPLACE FUNCTION restore_floor_plan_relational_snapshot(
    p_new_floor_plan_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_caller_company   UUID;
    v_canvas           JSONB;
    v_snapshot         JSONB;
    v_snapshot_version INTEGER;
    v_room_count       INTEGER := 0;
    v_wall_count       INTEGER := 0;
    v_opening_count    INTEGER := 0;
    v_skipped_rooms    JSONB := '[]'::JSONB;
    v_room_jsonb       JSONB;
    v_room_id          UUID;
    v_wall_jsonb       JSONB;
    v_new_wall_id      UUID;
    v_opening_jsonb    JSONB;
BEGIN
    IF p_new_floor_plan_id IS NULL THEN
        RAISE EXCEPTION 'p_new_floor_plan_id is required'
              USING ERRCODE = '22023';
    END IF;
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'JWT did not resolve to a company'
              USING ERRCODE = '42501';
    END IF;
    SELECT canvas_data INTO v_canvas
      FROM floor_plans
     WHERE id = p_new_floor_plan_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Rollback version not found or belongs to another company'
              USING ERRCODE = 'P0002';
    END IF;
    v_snapshot := v_canvas -> '_relational_snapshot';
    IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'object' THEN
        RETURN jsonb_build_object(
            'restored', false,
            'reason', 'no_snapshot',
            'rooms', 0,
            'walls', 0,
            'openings', 0,
            'skipped_rooms', '[]'::JSONB
        );
    END IF;
    v_snapshot_version := COALESCE((v_snapshot ->> 'version')::INTEGER, 0);
    IF v_snapshot_version <> 1 THEN
        RAISE EXCEPTION 'Unsupported snapshot version: %', v_snapshot_version
              USING ERRCODE = '22023';
    END IF;

    FOR v_room_jsonb IN
        SELECT * FROM jsonb_array_elements(v_snapshot -> 'rooms')
    LOOP
        v_room_id := (v_room_jsonb ->> 'id')::UUID;

        PERFORM 1 FROM job_rooms
         WHERE id = v_room_id AND company_id = v_caller_company;
        IF NOT FOUND THEN
            v_skipped_rooms := v_skipped_rooms || jsonb_build_array(v_room_id::TEXT);
            CONTINUE;
        END IF;

        UPDATE job_rooms
           SET room_polygon   = v_room_jsonb -> 'room_polygon',
               floor_openings = COALESCE(v_room_jsonb -> 'floor_openings', '[]'::jsonb)
         WHERE id = v_room_id AND company_id = v_caller_company;

        DELETE FROM wall_segments
         WHERE room_id = v_room_id
           AND company_id = v_caller_company;

        v_room_count := v_room_count + 1;

        FOR v_wall_jsonb IN
            SELECT * FROM jsonb_array_elements(COALESCE(v_room_jsonb -> 'walls', '[]'::jsonb))
        LOOP
            INSERT INTO wall_segments (
                room_id, company_id,
                x1, y1, x2, y2,
                wall_type, wall_height_ft,
                affected, shared, shared_with_room_id, sort_order
            ) VALUES (
                v_room_id, v_caller_company,
                (v_wall_jsonb ->> 'x1')::DECIMAL,
                (v_wall_jsonb ->> 'y1')::DECIMAL,
                (v_wall_jsonb ->> 'x2')::DECIMAL,
                (v_wall_jsonb ->> 'y2')::DECIMAL,
                COALESCE(v_wall_jsonb ->> 'wall_type', 'interior'),
                NULLIF(v_wall_jsonb ->> 'wall_height_ft', '')::DECIMAL,
                COALESCE((v_wall_jsonb ->> 'affected')::BOOLEAN, false),
                COALESCE((v_wall_jsonb ->> 'shared')::BOOLEAN, false),
                NULLIF(v_wall_jsonb ->> 'shared_with_room_id', '')::UUID,
                COALESCE((v_wall_jsonb ->> 'sort_order')::INTEGER, 0)
            )
            RETURNING id INTO v_new_wall_id;

            v_wall_count := v_wall_count + 1;

            FOR v_opening_jsonb IN
                SELECT * FROM jsonb_array_elements(COALESCE(v_wall_jsonb -> '_openings', '[]'::jsonb))
            LOOP
                INSERT INTO wall_openings (
                    wall_id, company_id,
                    opening_type, position,
                    width_ft, height_ft, sill_height_ft, swing
                ) VALUES (
                    v_new_wall_id, v_caller_company,
                    v_opening_jsonb ->> 'opening_type',
                    (v_opening_jsonb ->> 'position')::DECIMAL,
                    (v_opening_jsonb ->> 'width_ft')::DECIMAL,
                    (v_opening_jsonb ->> 'height_ft')::DECIMAL,
                    NULLIF(v_opening_jsonb ->> 'sill_height_ft', '')::DECIMAL,
                    NULLIF(v_opening_jsonb ->> 'swing', '')::INTEGER
                );
                v_opening_count := v_opening_count + 1;
            END LOOP;
        END LOOP;

        PERFORM _compute_wall_sf_for_room(v_room_id, v_caller_company);
    END LOOP;

    RETURN jsonb_build_object(
        'restored', true,
        'rooms', v_room_count,
        'walls', v_wall_count,
        'openings', v_opening_count,
        'skipped_rooms', v_skipped_rooms
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
