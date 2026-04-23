"""Spec 01H PR10 round-2 (R19): restore_floor_plan_relational_snapshot RPC.

Round-2 R19 identified that ``rollback_version`` restored ``canvas_data``
on the new version row but did not touch ``wall_segments``,
``wall_openings``, or the JSONB columns on ``job_rooms`` (``room_polygon``,
``floor_openings``). The spec promised "full fidelity" rollback; the
implementation delivered canvas-only.

Fix (per spec's chosen option 1 — snapshot + restore):

* At save time (``save_canvas`` in the service layer), a Python helper
  ``_enrich_canvas_with_relational_snapshot`` captures the current
  server-side state of those relational rows into a ``_relational_snapshot``
  key inside ``canvas_data``. Additive, no schema change.
* At rollback time, this RPC reads the snapshot from the new rollback
  version's ``canvas_data`` and restores the relational rows inside a
  single plpgsql transaction — DELETE existing walls (CASCADE drops the
  openings) and re-INSERT from the snapshot, plus UPDATE the JSONB fields
  on each room. Any failure rolls the whole thing back.

Legacy versions saved before the snapshot helper landed carry no
``_relational_snapshot`` key; the RPC returns ``restored=false`` so the
service layer can warn the caller that the rollback was canvas-only.
Full fidelity only applies forward from today.

Revision ID: e5f8a9b0c1d2
Revises: d4e5f8a9b0c1
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e5f8a9b0c1d2"
down_revision: str | None = "d4e5f8a9b0c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


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

    -- JWT-derived tenant guard — same pattern as the other 01H RPCs.
    -- SECURITY DEFINER bypasses RLS, so the caller company is derived
    -- via get_my_company_id() (auth.uid() → users.company_id) rather
    -- than trusting any caller-supplied parameter.
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;

    -- Fetch the new version's canvas_data, tenant-scoped.
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
        -- Legacy version saved before R19 landed. Canvas was restored but
        -- relational state cannot be — caller decides how to surface this.
        RETURN jsonb_build_object(
            'restored',   false,
            'reason',     'no_snapshot',
            'rooms',      0,
            'walls',      0,
            'openings',   0
        );
    END IF;

    v_snapshot_version := COALESCE((v_snapshot ->> 'version')::INTEGER, 0);
    IF v_snapshot_version <> 1 THEN
        RAISE EXCEPTION 'Unsupported snapshot version: %', v_snapshot_version
              USING ERRCODE = '22023';
    END IF;

    -- Iterate rooms in the snapshot.
    FOR v_room_jsonb IN
        SELECT * FROM jsonb_array_elements(v_snapshot -> 'rooms')
    LOOP
        v_room_id := (v_room_jsonb ->> 'id')::UUID;

        -- Tenant-scoped sanity: room must belong to the caller's company.
        -- Skip silently if it doesn't (defensive — the snapshot shouldn't
        -- contain foreign rooms, but we never write cross-tenant data).
        PERFORM 1 FROM job_rooms
         WHERE id = v_room_id AND company_id = v_caller_company;
        IF NOT FOUND THEN
            CONTINUE;
        END IF;

        -- Restore the JSONB columns on the room.
        UPDATE job_rooms
           SET room_polygon   = v_room_jsonb -> 'room_polygon',
               floor_openings = COALESCE(v_room_jsonb -> 'floor_openings', '[]'::jsonb)
         WHERE id = v_room_id
           AND company_id = v_caller_company;

        -- Wipe current walls for this room (CASCADE on wall_segments.id
        -- drops wall_openings automatically).
        DELETE FROM wall_segments
         WHERE room_id = v_room_id
           AND company_id = v_caller_company;

        v_room_count := v_room_count + 1;

        -- Re-insert walls from snapshot, capturing each new id so we can
        -- nest the openings under the right parent.
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

            -- Re-insert openings under the new wall id.
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
    END LOOP;

    RETURN jsonb_build_object(
        'restored',  true,
        'rooms',     v_room_count,
        'walls',     v_wall_count,
        'openings',  v_opening_count
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION restore_floor_plan_relational_snapshot(UUID)
    TO authenticated, service_role;
"""

DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS restore_floor_plan_relational_snapshot(UUID);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
