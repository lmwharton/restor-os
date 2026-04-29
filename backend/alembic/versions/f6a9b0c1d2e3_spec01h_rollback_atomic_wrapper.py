"""Spec 01H PR10 round-2 follow-on (F1+F2+F3): atomic rollback wrapper,
wall_sf recompute inside restore, skipped-room surfacing.

Critical reviewer of round 2 flagged three issues on R19's rollback path:

* **F1 — non-atomic composition.** Python's ``rollback_version`` ran
  ``save_floor_plan_version`` (atomic) followed by
  ``restore_floor_plan_relational_snapshot`` (atomic) as TWO separate RPC
  calls. If the restore RPC raised, the new version row + job repin were
  already committed — partial state, the exact shape of the pre-C4 bug
  one layer up.
* **F2 — wall_square_footage drift inside rollback.** The restore RPC
  wipes + re-inserts ``wall_segments`` and ``wall_openings`` but never
  touches ``job_rooms.wall_square_footage``. R16 says the stored SF must
  be recomputed on any wall/opening change; rollback was a new gap.
* **F3 — silent-skip on missing rooms.** Restore's tenant-scope check
  (``PERFORM 1 FROM job_rooms ... CONTINUE``) dropped foreign or
  since-deleted rooms without telling the caller.

This migration fixes all three:

* New plpgsql helper ``_compute_wall_sf_for_room(room_id, company_id)``
  ports the Python ``calculate_wall_sf`` logic into SQL (perimeter LF on
  non-shared walls × ceiling height × ceiling multiplier − opening
  area, honoring custom_wall_sf override). Returns the freshly computed
  value AND UPDATEs ``job_rooms.wall_square_footage`` in one statement.
* CREATE OR REPLACE of ``restore_floor_plan_relational_snapshot``:
  - accumulates ``skipped_rooms`` when tenant-scope check misses a room
  - calls ``_compute_wall_sf_for_room`` after re-inserting each room's
    walls + openings so the stored SF matches the restored state
  - returns the skipped list in the result payload so the service layer
    can warn
* New atomic wrapper ``rollback_floor_plan_version_atomic`` that calls
  ``save_floor_plan_version`` followed by
  ``restore_floor_plan_relational_snapshot`` inside ONE plpgsql
  function. plpgsql's implicit transaction means either both commit or
  both roll back — the exact atomicity the reviewer asked for.

Python's ``rollback_version`` becomes a single RPC call.

Revision ID: f6a9b0c1d2e3
Revises: e5f8a9b0c1d2
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f6a9b0c1d2e3"
down_revision: str | None = "e5f8a9b0c1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ---------------------------------------------------------------------------
-- Helper: compute wall SF for a single room from its current wall_segments
-- + wall_openings rows, and UPDATE job_rooms.wall_square_footage in the same
-- statement. Mirrors api/rooms/service.py::calculate_wall_sf.
--
-- Returns the computed value so callers don't have to re-query.
-- Respects custom_wall_sf override (R16 contract).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _compute_wall_sf_for_room(
    p_room_id    UUID,
    p_company_id UUID
) RETURNS DECIMAL AS $$
DECLARE
    v_room           RECORD;
    v_multiplier     DECIMAL;
    v_perimeter_lf   DECIMAL := 0;
    v_gross_sf       DECIMAL;
    v_opening_sf     DECIMAL := 0;
    v_net_sf         DECIMAL;
    v_final_sf       DECIMAL;
BEGIN
    SELECT id, height_ft, ceiling_type, custom_wall_sf
      INTO v_room
      FROM job_rooms
     WHERE id = p_room_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Tech override wins (R16/R17 contract: custom_wall_sf replaces the calc).
    IF v_room.custom_wall_sf IS NOT NULL THEN
        UPDATE job_rooms
           SET wall_square_footage = v_room.custom_wall_sf
         WHERE id = p_room_id AND company_id = p_company_id;
        RETURN v_room.custom_wall_sf;
    END IF;

    -- Perimeter LF from non-shared walls. 20px = 1ft (grid_size=10, px_per_ft=20).
    SELECT COALESCE(SUM(
        sqrt(
            power((x2 - x1)::DOUBLE PRECISION, 2) +
            power((y2 - y1)::DOUBLE PRECISION, 2)
        ) / 20.0
    ), 0)
      INTO v_perimeter_lf
      FROM wall_segments
     WHERE room_id = p_room_id
       AND company_id = p_company_id
       AND shared = false;

    v_gross_sf := v_perimeter_lf * COALESCE(v_room.height_ft, 8.0);

    -- Opening deductions — only for openings on non-shared walls.
    SELECT COALESCE(SUM(wo.width_ft * wo.height_ft), 0)
      INTO v_opening_sf
      FROM wall_openings wo
      JOIN wall_segments ws ON ws.id = wo.wall_id
     WHERE ws.room_id = p_room_id
       AND ws.company_id = p_company_id
       AND ws.shared = false;

    v_net_sf := v_gross_sf - v_opening_sf;

    -- Ceiling multiplier — matches CEILING_MULTIPLIERS in shared/constants.py.
    -- Keep this table in sync if Python-side values ever change.
    v_multiplier := CASE COALESCE(v_room.ceiling_type, 'flat')
        WHEN 'flat'      THEN 1.0
        WHEN 'vaulted'   THEN 1.3
        WHEN 'cathedral' THEN 1.5
        WHEN 'sloped'    THEN 1.2
        ELSE 1.0
    END;

    v_final_sf := round(v_net_sf * v_multiplier, 1);

    UPDATE job_rooms
       SET wall_square_footage = v_final_sf
     WHERE id = p_room_id AND company_id = p_company_id;

    RETURN v_final_sf;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;


-- ---------------------------------------------------------------------------
-- Rewrite restore_floor_plan_relational_snapshot with:
--  F2: recompute wall_sf per room after re-inserting walls/openings
--  F3: accumulate skipped_rooms array + include in return payload
-- Behavior for rooms that DO match the tenant scope is unchanged from e5f8a9b0c1d2.
-- ---------------------------------------------------------------------------
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
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_new_floor_plan_id is required';
    END IF;
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;
    SELECT canvas_data INTO v_canvas
      FROM floor_plans
     WHERE id = p_new_floor_plan_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Floor plan not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Rollback version not found or belongs to another company';
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

        -- F3: if the room is gone / foreign, record it in skipped_rooms rather
        -- than silently dropping. Caller logs a warning if non-empty.
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

        -- F2: with walls + openings now fully re-inserted, recompute the
        -- stored wall_square_footage so the R16 "backend authoritative"
        -- invariant holds across the rollback path too.
        PERFORM _compute_wall_sf_for_room(v_room_id, v_caller_company);
    END LOOP;

    RETURN jsonb_build_object(
        'restored',      true,
        'rooms',         v_room_count,
        'walls',         v_wall_count,
        'openings',      v_opening_count,
        'skipped_rooms', v_skipped_rooms
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;


-- ---------------------------------------------------------------------------
-- F1: atomic wrapper. Runs save_floor_plan_version + restore inside ONE
-- plpgsql function so their effects share one implicit transaction.
-- If the restore raises, the save's writes (new version + job repin) are
-- rolled back by Postgres — no partial state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rollback_floor_plan_version_atomic(
    p_target_floor_plan_id UUID,
    p_job_id               UUID,
    p_user_id              UUID,
    p_change_summary       TEXT
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_target         RECORD;
    v_job            RECORD;
    v_new_version    JSONB;
    v_new_id         UUID;
    v_restore_result JSONB;
BEGIN
    IF p_target_floor_plan_id IS NULL OR p_job_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_target_floor_plan_id and p_job_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;

    -- Target version (the version being rolled back TO) — must be accessible.
    SELECT id, property_id, floor_number, version_number, canvas_data, company_id
      INTO v_target
      FROM floor_plans
     WHERE id = p_target_floor_plan_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target version not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Rollback target not found or belongs to another company';
    END IF;

    -- Caller job — must be mutable + on the same property as the target.
    -- Mirrors the Python-side R5 + R6 + R8 checks.
    SELECT id, property_id, status, deleted_at
      INTO v_job
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or belongs to another company';
    END IF;
    -- Spec 01K — three archived terminal statuses (paid, cancelled, lost).
    IF v_job.status IN ('paid', 'cancelled', 'lost') THEN
        RAISE EXCEPTION 'Job archived'
              USING ERRCODE = '42501',
                    MESSAGE = 'Cannot rollback floor plan for an archived job';
    END IF;
    IF v_job.property_id IS NULL THEN
        RAISE EXCEPTION 'Job has no property'
              USING ERRCODE = '42501',
                    MESSAGE = 'Job has no property_id linked';
    END IF;
    IF v_job.property_id <> v_target.property_id THEN
        RAISE EXCEPTION 'Property mismatch'
              USING ERRCODE = '42501',
                    MESSAGE = 'Target version does not belong to the job''s property';
    END IF;

    -- Create the new rollback version (flip + insert + pin), seeded with
    -- target's canvas_data. save_floor_plan_version runs its own tenant
    -- checks — it validates v_caller_company matches JWT-derived company,
    -- which it does by construction here.
    v_new_version := save_floor_plan_version(
        v_target.property_id,
        v_target.floor_number,
        NULL,  -- floor_name inherits from latest sibling
        v_caller_company,
        p_job_id,
        p_user_id,
        v_target.canvas_data,
        p_change_summary
    );
    v_new_id := (v_new_version ->> 'id')::UUID;

    -- Apply the relational snapshot from the new row's canvas_data.
    -- If this raises, save_floor_plan_version's writes get rolled back
    -- by Postgres because we're still inside this plpgsql function.
    v_restore_result := restore_floor_plan_relational_snapshot(v_new_id);

    RETURN jsonb_build_object(
        'version', v_new_version,
        'restore', v_restore_result
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;


-- Grants mirror the other 01H RPCs.
GRANT EXECUTE ON FUNCTION _compute_wall_sf_for_room(UUID, UUID)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION rollback_floor_plan_version_atomic(UUID, UUID, UUID, TEXT)
    TO authenticated, service_role;
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS rollback_floor_plan_version_atomic(UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS _compute_wall_sf_for_room(UUID, UUID);

-- Restore the pre-follow-on restore function (without wall_sf recompute + skipped_rooms).
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
    v_room_jsonb       JSONB;
    v_room_id          UUID;
    v_wall_jsonb       JSONB;
    v_new_wall_id      UUID;
    v_opening_jsonb    JSONB;
BEGIN
    IF p_new_floor_plan_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023';
    END IF;
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company' USING ERRCODE = '42501';
    END IF;
    SELECT canvas_data INTO v_canvas
      FROM floor_plans WHERE id = p_new_floor_plan_id AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Floor plan not accessible' USING ERRCODE = 'P0002';
    END IF;
    v_snapshot := v_canvas -> '_relational_snapshot';
    IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'object' THEN
        RETURN jsonb_build_object('restored', false, 'reason', 'no_snapshot',
                                  'rooms', 0, 'walls', 0, 'openings', 0);
    END IF;
    v_snapshot_version := COALESCE((v_snapshot ->> 'version')::INTEGER, 0);
    IF v_snapshot_version <> 1 THEN
        RAISE EXCEPTION 'Unsupported snapshot version: %', v_snapshot_version USING ERRCODE = '22023';
    END IF;
    FOR v_room_jsonb IN SELECT * FROM jsonb_array_elements(v_snapshot -> 'rooms') LOOP
        v_room_id := (v_room_jsonb ->> 'id')::UUID;
        PERFORM 1 FROM job_rooms WHERE id = v_room_id AND company_id = v_caller_company;
        IF NOT FOUND THEN CONTINUE; END IF;
        UPDATE job_rooms
           SET room_polygon   = v_room_jsonb -> 'room_polygon',
               floor_openings = COALESCE(v_room_jsonb -> 'floor_openings', '[]'::jsonb)
         WHERE id = v_room_id AND company_id = v_caller_company;
        DELETE FROM wall_segments WHERE room_id = v_room_id AND company_id = v_caller_company;
        v_room_count := v_room_count + 1;
        FOR v_wall_jsonb IN SELECT * FROM jsonb_array_elements(COALESCE(v_room_jsonb -> 'walls', '[]'::jsonb)) LOOP
            INSERT INTO wall_segments (
                room_id, company_id, x1, y1, x2, y2,
                wall_type, wall_height_ft, affected, shared, shared_with_room_id, sort_order
            ) VALUES (
                v_room_id, v_caller_company,
                (v_wall_jsonb ->> 'x1')::DECIMAL, (v_wall_jsonb ->> 'y1')::DECIMAL,
                (v_wall_jsonb ->> 'x2')::DECIMAL, (v_wall_jsonb ->> 'y2')::DECIMAL,
                COALESCE(v_wall_jsonb ->> 'wall_type', 'interior'),
                NULLIF(v_wall_jsonb ->> 'wall_height_ft', '')::DECIMAL,
                COALESCE((v_wall_jsonb ->> 'affected')::BOOLEAN, false),
                COALESCE((v_wall_jsonb ->> 'shared')::BOOLEAN, false),
                NULLIF(v_wall_jsonb ->> 'shared_with_room_id', '')::UUID,
                COALESCE((v_wall_jsonb ->> 'sort_order')::INTEGER, 0)
            ) RETURNING id INTO v_new_wall_id;
            v_wall_count := v_wall_count + 1;
            FOR v_opening_jsonb IN SELECT * FROM jsonb_array_elements(COALESCE(v_wall_jsonb -> '_openings', '[]'::jsonb)) LOOP
                INSERT INTO wall_openings (
                    wall_id, company_id, opening_type, position,
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
    END LOOP;
    RETURN jsonb_build_object('restored', true, 'rooms', v_room_count,
                              'walls', v_wall_count, 'openings', v_opening_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
