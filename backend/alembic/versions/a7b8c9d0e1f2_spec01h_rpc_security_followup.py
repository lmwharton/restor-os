"""Spec 01H PR10 round-2 follow-on (#2 + #4): RPC security + SQLSTATE hygiene.

Two tight fixes surfaced on a re-review of the round-2 work:

**#2 — `_compute_wall_sf_for_room` accepts caller-supplied p_company_id.**
The helper landed in ``f6a9b0c1d2e3`` with signature ``(p_room_id, p_company_id)``
and was granted to ``authenticated``. Because the function is SECURITY
DEFINER, it bypasses RLS and uses the caller-supplied company_id in its
WHERE / UPDATE filters — exactly the anti-pattern ``c7f8a9b0d1e2`` (R3)
closed on ``save_floor_plan_version``. An authenticated tenant of
company X could call the helper directly with a room_id + company_id=Y
and trigger an UPDATE on a foreign tenant's ``wall_square_footage``.
Impact is bounded (the value written is the deterministic formula
output, not attacker-controlled), but the RULE is non-negotiable:
SECURITY DEFINER RPCs must derive company from JWT, never trust params.

Fix: drop ``p_company_id`` from the signature. Derive inside via
``get_my_company_id()``. Update the two call sites
(``restore_floor_plan_relational_snapshot``, the rollback wrapper's
helper invocations inside restore) to the new one-arg shape.

**#4 — Frozen-row trigger shares SQLSTATE 42501 with tenant-mismatch.**
The trigger installed by ``d8e9f0a1b2c3`` raised 42501 (insufficient_
privilege) when blocking an UPDATE to a frozen row. R3's tenant check
on ``save_floor_plan_version`` also raises 42501. The Python catch
blocks can't tell them apart without inspecting message text — so a
trigger hit (which should surface as 403 VERSION_FROZEN with retry
guidance) ended up mapped to 403 COMPANY_MISMATCH or 500 DB_ERROR
depending on the path.

Fix: switch the trigger to SQLSTATE ``55006`` (object_in_use — class 55
invalid_prerequisite_state, semantic match for "row is frozen, cannot
mutate right now"). Keep the 42501 code reserved for tenant-scope
failures. Python catches get separate branches per SQLSTATE.

Revision ID: a7b8c9d0e1f2
Revises: f6a9b0c1d2e3
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "f6a9b0c1d2e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ---------------------------------------------------------------------------
-- #2: re-create _compute_wall_sf_for_room without caller-supplied p_company_id.
-- Signature changes (1-arg now), so we DROP the old one first.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS _compute_wall_sf_for_room(UUID, UUID);

CREATE OR REPLACE FUNCTION _compute_wall_sf_for_room(
    p_room_id UUID
) RETURNS DECIMAL AS $$
DECLARE
    v_caller_company UUID;
    v_room           RECORD;
    v_multiplier     DECIMAL;
    v_perimeter_lf   DECIMAL := 0;
    v_gross_sf       DECIMAL;
    v_opening_sf     DECIMAL := 0;
    v_net_sf         DECIMAL;
    v_final_sf       DECIMAL;
BEGIN
    -- Derive company from JWT — same pattern as every R3-hardened RPC.
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;

    SELECT id, height_ft, ceiling_type, custom_wall_sf
      INTO v_room
      FROM job_rooms
     WHERE id = p_room_id AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_room.custom_wall_sf IS NOT NULL THEN
        UPDATE job_rooms
           SET wall_square_footage = v_room.custom_wall_sf
         WHERE id = p_room_id AND company_id = v_caller_company;
        RETURN v_room.custom_wall_sf;
    END IF;

    SELECT COALESCE(SUM(
        sqrt(
            power((x2 - x1)::DOUBLE PRECISION, 2) +
            power((y2 - y1)::DOUBLE PRECISION, 2)
        ) / 20.0
    ), 0)
      INTO v_perimeter_lf
      FROM wall_segments
     WHERE room_id = p_room_id
       AND company_id = v_caller_company
       AND shared = false;

    v_gross_sf := v_perimeter_lf * COALESCE(v_room.height_ft, 8.0);

    SELECT COALESCE(SUM(wo.width_ft * wo.height_ft), 0)
      INTO v_opening_sf
      FROM wall_openings wo
      JOIN wall_segments ws ON ws.id = wo.wall_id
     WHERE ws.room_id = p_room_id
       AND ws.company_id = v_caller_company
       AND ws.shared = false;

    v_net_sf := v_gross_sf - v_opening_sf;

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
     WHERE id = p_room_id AND company_id = v_caller_company;

    RETURN v_final_sf;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION _compute_wall_sf_for_room(UUID)
    TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- #2 (cont): restore_floor_plan_relational_snapshot previously called the
-- 2-arg helper. Re-create it calling the 1-arg version.
-- (Full body re-inlined to match f6a9b0c1d2e3 minus the passed-in company.)
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
            'restored', false, 'reason', 'no_snapshot',
            'rooms', 0, 'walls', 0, 'openings', 0,
            'skipped_rooms', '[]'::JSONB
        );
    END IF;
    v_snapshot_version := COALESCE((v_snapshot ->> 'version')::INTEGER, 0);
    IF v_snapshot_version <> 1 THEN
        RAISE EXCEPTION 'Unsupported snapshot version: %', v_snapshot_version
              USING ERRCODE = '22023';
    END IF;

    FOR v_room_jsonb IN SELECT * FROM jsonb_array_elements(v_snapshot -> 'rooms') LOOP
        v_room_id := (v_room_jsonb ->> 'id')::UUID;
        PERFORM 1 FROM job_rooms WHERE id = v_room_id AND company_id = v_caller_company;
        IF NOT FOUND THEN
            v_skipped_rooms := v_skipped_rooms || jsonb_build_array(v_room_id::TEXT);
            CONTINUE;
        END IF;
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

        -- Recompute wall_sf using the (now) 1-arg JWT-derived helper.
        PERFORM _compute_wall_sf_for_room(v_room_id);
    END LOOP;

    RETURN jsonb_build_object(
        'restored', true,
        'rooms', v_room_count, 'walls', v_wall_count, 'openings', v_opening_count,
        'skipped_rooms', v_skipped_rooms
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;


-- ---------------------------------------------------------------------------
-- #4: re-create floor_plans_prevent_frozen_mutation with SQLSTATE 55006
-- (object_in_use, class 55 invalid_prerequisite_state). Keeps 42501
-- reserved for tenant-scope failures so Python catches can disambiguate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION floor_plans_prevent_frozen_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_current IS FALSE THEN
        RAISE EXCEPTION 'floor_plans version is frozen (is_current=false)'
              USING ERRCODE = '55006',
                    MESSAGE = 'Cannot mutate a frozen floor_plans version. Create a new version via save_floor_plan_version instead.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog, public;
"""

DOWNGRADE_SQL = """
-- Restore the 2-arg _compute_wall_sf_for_room (pre-#2 signature).
DROP FUNCTION IF EXISTS _compute_wall_sf_for_room(UUID);

CREATE OR REPLACE FUNCTION _compute_wall_sf_for_room(
    p_room_id    UUID,
    p_company_id UUID
) RETURNS DECIMAL AS $$
DECLARE
    v_room         RECORD;
    v_multiplier   DECIMAL;
    v_perimeter_lf DECIMAL := 0;
    v_gross_sf     DECIMAL;
    v_opening_sf   DECIMAL := 0;
    v_net_sf       DECIMAL;
    v_final_sf     DECIMAL;
BEGIN
    SELECT id, height_ft, ceiling_type, custom_wall_sf INTO v_room
      FROM job_rooms WHERE id = p_room_id AND company_id = p_company_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_room.custom_wall_sf IS NOT NULL THEN
        UPDATE job_rooms SET wall_square_footage = v_room.custom_wall_sf
         WHERE id = p_room_id AND company_id = p_company_id;
        RETURN v_room.custom_wall_sf;
    END IF;
    SELECT COALESCE(SUM(sqrt(power((x2-x1)::DOUBLE PRECISION, 2) + power((y2-y1)::DOUBLE PRECISION, 2)) / 20.0), 0)
      INTO v_perimeter_lf FROM wall_segments
     WHERE room_id = p_room_id AND company_id = p_company_id AND shared = false;
    v_gross_sf := v_perimeter_lf * COALESCE(v_room.height_ft, 8.0);
    SELECT COALESCE(SUM(wo.width_ft * wo.height_ft), 0) INTO v_opening_sf
      FROM wall_openings wo JOIN wall_segments ws ON ws.id = wo.wall_id
     WHERE ws.room_id = p_room_id AND ws.company_id = p_company_id AND ws.shared = false;
    v_net_sf := v_gross_sf - v_opening_sf;
    v_multiplier := CASE COALESCE(v_room.ceiling_type, 'flat')
        WHEN 'flat' THEN 1.0 WHEN 'vaulted' THEN 1.3
        WHEN 'cathedral' THEN 1.5 WHEN 'sloped' THEN 1.2 ELSE 1.0 END;
    v_final_sf := round(v_net_sf * v_multiplier, 1);
    UPDATE job_rooms SET wall_square_footage = v_final_sf
     WHERE id = p_room_id AND company_id = p_company_id;
    RETURN v_final_sf;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
GRANT EXECUTE ON FUNCTION _compute_wall_sf_for_room(UUID, UUID) TO authenticated, service_role;

-- Restore frozen trigger with old SQLSTATE 42501.
CREATE OR REPLACE FUNCTION floor_plans_prevent_frozen_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_current IS FALSE THEN
        RAISE EXCEPTION 'floor_plans version is frozen (is_current=false)'
              USING ERRCODE = '42501',
                    MESSAGE = 'Cannot mutate a frozen floor_plans version. Create a new version via save_floor_plan_version instead.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
