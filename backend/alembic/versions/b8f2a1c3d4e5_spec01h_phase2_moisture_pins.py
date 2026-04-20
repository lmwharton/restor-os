"""Spec 01H Phase 2: Moisture Pins — spatial, persistent moisture tracking.

Replaces the legacy per-room-per-day form model with spatial pins that
persist across the whole job. Each pin has a canvas (x, y), a material
type, and a dry standard; readings form a time series per pin.

This migration:

1. Drops the legacy `moisture_readings`, `moisture_points`, and
   `dehu_outputs` tables. No production data exists — clean cut per the
   Spec 01H decision log.
2. Creates `moisture_pins` — one row per physical measurement location on
   the floor plan, scoped to a job. Canvas coords + material + dry
   standard. The dry_standard is stored on the pin (not looked up at
   read time) so each pin remembers its own override.
3. Creates `moisture_pin_readings` — one row per reading per pin per day.
   UNIQUE(pin_id, reading_date) enforces "one reading per pin per day."

Both tables use the standard company_id + get_my_company_id() RLS pattern.

Revision ID: b8f2a1c3d4e5
Revises: e1a7c9b30201
Create Date: 2026-04-20
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b8f2a1c3d4e5"
down_revision: str | None = "e1a7c9b30201"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
-- ============================================================================
-- 1. Drop legacy moisture tables (reverse-FK order: dehu_outputs and
--    moisture_points depend on moisture_readings).
--
-- No data preservation — this is the "clean cut" per Spec 01H decision log.
-- ============================================================================

DROP TABLE IF EXISTS dehu_outputs CASCADE;
DROP TABLE IF EXISTS moisture_points CASCADE;
DROP TABLE IF EXISTS moisture_readings CASCADE;

-- ============================================================================
-- 2. moisture_pins — persistent spatial measurement locations.
--
-- Each pin represents a specific spot on the floor plan where readings
-- are taken over time. canvas_x / canvas_y are pixel coordinates on the
-- floor plan canvas. dry_standard is copied from the material default at
-- creation time but is editable per pin (e.g., moisture-resistant drywall
-- has a different threshold than standard drywall).
-- ============================================================================

CREATE TABLE moisture_pins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id         UUID REFERENCES job_rooms(id) ON DELETE SET NULL,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    canvas_x        DECIMAL(8,2) NOT NULL,
    canvas_y        DECIMAL(8,2) NOT NULL,
    location_name   TEXT NOT NULL,
    material        TEXT NOT NULL
                    CHECK (material IN (
                        'drywall', 'wood_subfloor', 'carpet_pad',
                        'concrete', 'hardwood', 'osb_plywood', 'block_wall'
                    )),
    dry_standard    DECIMAL(6,2) NOT NULL,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pins_job ON moisture_pins(job_id);
CREATE INDEX idx_pins_room ON moisture_pins(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_pins_company ON moisture_pins(company_id);

CREATE TRIGGER set_updated_at_moisture_pins
    BEFORE UPDATE ON moisture_pins
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE moisture_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY pins_select ON moisture_pins
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY pins_insert ON moisture_pins
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY pins_update ON moisture_pins
    FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY pins_delete ON moisture_pins
    FOR DELETE USING (company_id = get_my_company_id());

-- ============================================================================
-- 3. moisture_pin_readings — time-series readings at each pin.
--
-- UNIQUE(pin_id, reading_date) enforces "one reading per pin per day" at
-- the database level. The frontend detects the collision before submitting
-- and opens an edit-today's-reading flow; the constraint is the safety net.
-- ============================================================================

CREATE TABLE moisture_pin_readings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id          UUID NOT NULL REFERENCES moisture_pins(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    reading_value   DECIMAL(6,2) NOT NULL,
    reading_date    DATE NOT NULL,
    recorded_by     UUID REFERENCES users(id),
    meter_photo_url TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_pin_reading_date ON moisture_pin_readings(pin_id, reading_date);
CREATE INDEX idx_pin_readings_company ON moisture_pin_readings(company_id);

ALTER TABLE moisture_pin_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY pin_readings_select ON moisture_pin_readings
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY pin_readings_insert ON moisture_pin_readings
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY pin_readings_update ON moisture_pin_readings
    FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY pin_readings_delete ON moisture_pin_readings
    FOR DELETE USING (company_id = get_my_company_id());
    """)


def downgrade() -> None:
    op.execute("""
-- Drop new tables (cascade drops indexes, triggers, policies)
DROP TABLE IF EXISTS moisture_pin_readings CASCADE;
DROP TABLE IF EXISTS moisture_pins CASCADE;

-- ============================================================================
-- Restore legacy tables (structure only — no data recovery possible).
-- Mirrors the original creation in ca59c5bf87c9_spec01_jobs_site_log_floor_plan.
-- ============================================================================

CREATE TABLE moisture_readings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id             UUID NOT NULL REFERENCES job_rooms(id) ON DELETE CASCADE,
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    reading_date        DATE NOT NULL,
    day_number          INTEGER,
    atmospheric_temp_f  DECIMAL(5,2),
    atmospheric_rh_pct  DECIMAL(5,2),
    atmospheric_gpp     DECIMAL(6,2),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_readings_room_date ON moisture_readings(room_id, reading_date);
CREATE INDEX idx_readings_job ON moisture_readings(job_id);
CREATE INDEX idx_readings_company ON moisture_readings(company_id);

CREATE TABLE moisture_points (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_id      UUID NOT NULL REFERENCES moisture_readings(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    location_name   TEXT NOT NULL,
    reading_value   DECIMAL(6,2) NOT NULL,
    meter_photo_url TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_points_reading ON moisture_points(reading_id);

CREATE TABLE dehu_outputs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_id      UUID NOT NULL REFERENCES moisture_readings(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    dehu_model      TEXT,
    rh_out_pct      DECIMAL(5,2),
    temp_out_f      DECIMAL(5,2),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dehus_reading ON dehu_outputs(reading_id);

CREATE TRIGGER trg_readings_updated_at BEFORE UPDATE ON moisture_readings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE moisture_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE moisture_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE dehu_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "readings_select" ON moisture_readings
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "readings_insert" ON moisture_readings
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "readings_update" ON moisture_readings
    FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY "readings_delete" ON moisture_readings
    FOR DELETE USING (company_id = get_my_company_id());

CREATE POLICY "points_select" ON moisture_points
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "points_insert" ON moisture_points
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "points_update" ON moisture_points
    FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY "points_delete" ON moisture_points
    FOR DELETE USING (company_id = get_my_company_id());

CREATE POLICY "dehus_select" ON dehu_outputs
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "dehus_insert" ON dehu_outputs
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "dehus_update" ON dehu_outputs
    FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY "dehus_delete" ON dehu_outputs
    FOR DELETE USING (company_id = get_my_company_id());
    """)
