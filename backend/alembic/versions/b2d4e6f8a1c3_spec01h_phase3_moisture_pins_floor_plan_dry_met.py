"""Spec 01H Phase 3 (PR-A, Step 2): moisture_pins gets floor_plan_id + dry_standard_met_at.

Two load-bearing additions to moisture_pins:

1. ``floor_plan_id UUID REFERENCES floor_plans(id) ON DELETE RESTRICT`` —
   stamps the pin to the floor-plan *version* it was created against.
   Phase 1 merged ``floor_plan_versions`` INTO ``floor_plans`` (each row IS
   a version), so this FK pins a specific snapshot. Without this stamp,
   a later floor-plan edit would ghost-move historical pins on the adjuster
   PDF. ``ON DELETE RESTRICT`` prevents the stamp from being silently
   nulled when a plan is deleted — the caller must explicitly archive pins
   first. Lesson §0.2 #3 + S3/C1 of the Phase 3 proposal.

2. ``dry_standard_met_at TIMESTAMPTZ`` (nullable) — the authoritative
   "is this pin currently dry" signal. NULL = still drying. Written by
   the dry-check trigger (Step 4). Read by equipment-pin-assignment
   auto-close (PR-B) and the C8 "don't re-assign to a dry pin" guard.
   Nullable because new pins start NULL and re-wet clears it.

Also updates ``create_moisture_pin_with_reading`` RPC to stamp
``floor_plan_id`` from the pin's room (``job_rooms.floor_plan_id``) at
create time. Lookup happens inside the RPC so the stamp + INSERT share
one transaction — lesson #4 atomic composition.

Existing-pin backfill: ``floor_plan_id`` is populated from the pin's room
(``job_rooms.floor_plan_id``, which Phase 2's f1e2d3c4b5a6 guaranteed is
non-NULL for rooms created after the backfill landed). Any pin whose
room lacks a floor_plan_id stays NULL — a reviewer will see those as
orphans needing explicit cleanup rather than a silent wrong-floor stamp.

Revision ID: b2d4e6f8a1c3
Revises: 7a1f3b2c9d0e
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d4e6f8a1c3"
down_revision: str | None = "7a1f3b2c9d0e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ============================================================================
-- Step 1: Add the two columns (both nullable — immutable semantics enforced
-- at the service + RPC layer, not the column definition).
-- ============================================================================

ALTER TABLE moisture_pins
    ADD COLUMN floor_plan_id UUID REFERENCES floor_plans(id) ON DELETE RESTRICT,
    ADD COLUMN dry_standard_met_at TIMESTAMPTZ;

COMMENT ON COLUMN moisture_pins.floor_plan_id IS
    'Floor-plan version this pin was drawn against. Stamped at create from '
    'the pin''s room''s floor_plan_id; treated as immutable thereafter. ON '
    'DELETE RESTRICT prevents silent nulling when a plan version is deleted. '
    'Spec 01H Phase 3 §0.2 #3 (S3/C1).';

COMMENT ON COLUMN moisture_pins.dry_standard_met_at IS
    'Set by trg_moisture_pin_dry_check when the latest reading <= dry_standard; '
    'cleared on re-wet (reading > dry_standard). NULL = still drying. Load-bearing '
    'for equipment auto-close and the C8 dry-pin rejection guard. Spec 01H Phase 3 '
    '§0.2 #4 (C2).';

-- ============================================================================
-- Step 2: Backfill floor_plan_id from the pin's room.
--
-- Phase 2's f1e2d3c4b5a6 migration backfilled job_rooms.floor_plan_id from
-- the canvas data, so this second-hop backfill is reliable for any pin whose
-- room landed after that migration. Pins whose room still lacks a floor_plan
-- (ambiguous multi-floor rows intentionally left NULL) stay NULL here too.
-- ============================================================================

UPDATE moisture_pins mp
   SET floor_plan_id = jr.floor_plan_id
  FROM job_rooms jr
 WHERE mp.room_id = jr.id
   AND jr.floor_plan_id IS NOT NULL;

-- ============================================================================
-- Step 3: Partial index to support per-floor pin filters on the list endpoint
-- and the moisture-report view. WHERE clause is free on the planner — nulls
-- aren't indexed so the index stays small.
-- ============================================================================

CREATE INDEX idx_moisture_pins_floor_plan
    ON moisture_pins(floor_plan_id)
    WHERE floor_plan_id IS NOT NULL;

-- ============================================================================
-- Step 4: Amend create_moisture_pin_with_reading RPC to stamp floor_plan_id
-- from the pin's room inside the same transaction.
--
-- Signature unchanged — caller signature stays identical, only the body grows.
-- That avoids the PostgREST schema-cache-drift trap from lesson #23.
-- ============================================================================

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
    p_reading_date    DATE,
    p_meter_photo_url TEXT,
    p_notes           TEXT
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_floor_plan_id  UUID;
    v_pin            moisture_pins%ROWTYPE;
    v_reading        moisture_pin_readings%ROWTYPE;
BEGIN
    -- NULL param guards, preserved from e1f2a3b4c5d6.
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_company_id IS NULL
       OR p_canvas_x IS NULL OR p_canvas_y IS NULL
       OR p_location_name IS NULL OR p_material IS NULL
       OR p_dry_standard IS NULL
       OR p_reading_value IS NULL OR p_reading_date IS NULL
    THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023';
    END IF;

    -- Tenancy: JWT-derived company must match p_company_id. Same shape as
    -- c7f8a9b0d1e2 R3 hardening. Lesson §3.
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

    -- Resolve the room's floor_plan_id INSIDE the transaction. If the room
    -- has NULL floor_plan_id (legacy ambiguous row), the pin stamp is NULL
    -- too — same pre-existing semantic as the backfill in Step 2 above.
    -- The join through room enforces the room belongs to the caller
    -- company via the FK chain (moisture_pins.room_id → job_rooms, and
    -- job_rooms has its own RLS).
    SELECT floor_plan_id INTO v_floor_plan_id
      FROM job_rooms
     WHERE id = p_room_id
       AND company_id = v_caller_company;

    -- INSERT the pin, now stamping floor_plan_id.
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

    -- INSERT the initial reading. Function-level transaction rolls back both
    -- on any failure inside the function. Lesson #4.
    INSERT INTO moisture_pin_readings (
        pin_id, company_id, reading_value, reading_date,
        recorded_by, meter_photo_url, notes
    ) VALUES (
        v_pin.id, p_company_id, p_reading_value, p_reading_date,
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
    NUMERIC, DATE, TEXT, TEXT
) TO authenticated, service_role;
"""


DOWNGRADE_SQL = """
-- ============================================================================
-- Restore pre-Step-2 state. Order matters:
--   1. Replace the RPC with the old body (no floor_plan_id reference).
--      If we dropped the column first, CREATE OR REPLACE FUNCTION would still
--      succeed (plpgsql resolves column refs at execute time), but the next
--      CALL would 42703 — so flipping the function body FIRST is the safer
--      order for any in-flight caller between downgrade and rollback completion.
--   2. Drop the index.
--   3. Drop the columns.
-- ============================================================================

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
    p_reading_date    DATE,
    p_meter_photo_url TEXT,
    p_notes           TEXT
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_pin            moisture_pins%ROWTYPE;
    v_reading        moisture_pin_readings%ROWTYPE;
BEGIN
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_company_id IS NULL
       OR p_canvas_x IS NULL OR p_canvas_y IS NULL
       OR p_location_name IS NULL OR p_material IS NULL
       OR p_dry_standard IS NULL
       OR p_reading_value IS NULL OR p_reading_date IS NULL
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

    INSERT INTO moisture_pins (
        job_id, room_id, company_id,
        canvas_x, canvas_y, location_name,
        material, dry_standard, created_by
    ) VALUES (
        p_job_id, p_room_id, p_company_id,
        p_canvas_x, p_canvas_y, p_location_name,
        p_material, p_dry_standard, p_created_by
    )
    RETURNING * INTO v_pin;

    INSERT INTO moisture_pin_readings (
        pin_id, company_id, reading_value, reading_date,
        recorded_by, meter_photo_url, notes
    ) VALUES (
        v_pin.id, p_company_id, p_reading_value, p_reading_date,
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
    NUMERIC, DATE, TEXT, TEXT
) TO authenticated, service_role;

DROP INDEX IF EXISTS idx_moisture_pins_floor_plan;

ALTER TABLE moisture_pins
    DROP COLUMN dry_standard_met_at,
    DROP COLUMN floor_plan_id;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
