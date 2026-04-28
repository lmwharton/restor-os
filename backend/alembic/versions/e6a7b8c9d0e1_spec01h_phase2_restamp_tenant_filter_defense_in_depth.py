"""Spec 01H Phase 2 follow-up (R1 critical-review MEDIUM 3): add tenant filter to the wall_segment_id re-stamp UPDATE inside ``restore_floor_plan_relational_snapshot``.

The e5f6a7b8c9d0 body captured the ``(pin_id, sort_order)`` map with
``mp.company_id = v_caller_company`` correctly tenant-scoping the
SELECT. The post-INSERT re-stamp UPDATE keys only on
``mp.id = pwr.pin_id`` and ``new_ws.company_id = v_caller_company``.
Inside a SECURITY DEFINER body, RLS does not gate the target row of an
UPDATE — only the join filters do. The current shape is safe today
because the captured pin set is caller-scoped (so ``mp.id`` will only
ever match caller-owned pins), but lesson #15 ("etag-style defense-
in-depth: every layer enforces the contract") asks for both layers.
A future maintainer extending the capture (e.g., to merge sibling-job
pins, to include legacy NULL-floor pins, to reuse the helper from a
different SECURITY DEFINER caller) could silently widen the blast
radius without realizing the UPDATE doesn't cap at tenant scope.

Fix: add ``AND mp.company_id = v_caller_company`` to the WHERE clause
of the re-stamp UPDATE. Two-line change inside a function body
replacement; no other shape changes. Symmetric downgrade restores the
e5f6a7b8c9d0 shape byte-for-byte (lesson #10 spirit — downgrades
preserve the prior contract exactly).

Lessons applied:

* Lesson #15 (etag-style defense-in-depth) — every write path /
  every write predicate enforces tenant isolation, even when an
  upstream filter currently makes the redundant filter unreachable.
  Defense-in-depth pays off precisely when the upstream filter
  changes.
* Lesson #3 (SECURITY DEFINER without tenant-from-JWT) — this is the
  same anti-pattern shape, one writer-side step removed.

Revision ID: e6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-04-27
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6a7b8c9d0e1"
down_revision: str | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ============================================================================
# UPGRADE — re-issue restore_floor_plan_relational_snapshot with the
# extra ``AND mp.company_id = v_caller_company`` predicate on the
# re-stamp UPDATE. Body otherwise byte-for-byte identical to e5f6a7b8c9d0.
# ============================================================================

UPGRADE_SQL = """
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

        -- Defense-in-depth (e6a7b8c9d0e1): mp.company_id = v_caller_company
        -- added so the writer-side filter matches the capture-side filter.
        -- Today reachable only with caller-owned pins (capture is
        -- v_caller_company-scoped), but the redundant predicate protects
        -- against future widening of the capture without re-deriving
        -- the tenant invariant.
        IF v_pin_wall_remap IS NOT NULL AND v_pin_wall_remap <> '[]'::jsonb THEN
            UPDATE moisture_pins mp
               SET wall_segment_id = new_ws.id
              FROM jsonb_to_recordset(v_pin_wall_remap)
                AS pwr(pin_id UUID, sort_order INTEGER)
              JOIN wall_segments new_ws
                ON new_ws.room_id = v_room_id
               AND new_ws.company_id = v_caller_company
               AND new_ws.sort_order = pwr.sort_order
             WHERE mp.id = pwr.pin_id
               AND mp.company_id = v_caller_company;
        END IF;

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
# DOWNGRADE — restore the e5f6a7b8c9d0 body byte-for-byte (without the
# tenant filter on the re-stamp UPDATE). Lesson #10 spirit: the prior
# function contract is what a downgrade returns to.
# ============================================================================

DOWNGRADE_SQL = """
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
