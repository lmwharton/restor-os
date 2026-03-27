"""Spec 01: Jobs + Site Log + Floor Plan — all tables

Revision ID: ca59c5bf87c9
Revises: 001_bootstrap
Create Date: 2026-03-26

Creates: properties, floor_plans, job_rooms, photos, moisture_readings,
         moisture_points, dehu_outputs, reports, share_links, event_history.
Alters: jobs (add property_id, tech_notes, estimated_total).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "ca59c5bf87c9"
down_revision: str | None = "001_bootstrap"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
-- ============================================================================
-- 1. Properties table (one per physical address, shared across jobs)
-- ============================================================================
CREATE TABLE properties (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    address_line1   TEXT NOT NULL,
    address_line2   TEXT,
    city            TEXT NOT NULL,
    state           TEXT NOT NULL,
    zip             TEXT NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    usps_standardized TEXT,
    year_built      INTEGER CHECK (year_built IS NULL OR (year_built >= 1600 AND year_built <= 2030)),
    property_type   TEXT CHECK (property_type IS NULL OR property_type IN ('residential', 'commercial', 'multi-family')),
    total_sqft      INTEGER CHECK (total_sqft IS NULL OR total_sqft >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_properties_usps_active
    ON properties(company_id, usps_standardized) WHERE deleted_at IS NULL AND usps_standardized IS NOT NULL;
CREATE INDEX idx_properties_company ON properties(company_id) WHERE deleted_at IS NULL;

-- ============================================================================
-- 2. Alter jobs table (add new columns from Spec 01)
-- ============================================================================
ALTER TABLE jobs ADD COLUMN property_id UUID REFERENCES properties(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN tech_notes TEXT;
ALTER TABLE jobs ADD COLUMN estimated_total DECIMAL(10,2) DEFAULT 0;

CREATE INDEX idx_jobs_property ON jobs(property_id) WHERE deleted_at IS NULL AND property_id IS NOT NULL;

-- ============================================================================
-- 3. Floor plans table (one per floor per job)
-- ============================================================================
CREATE TABLE floor_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    floor_number    INTEGER NOT NULL DEFAULT 1 CHECK (floor_number >= 0 AND floor_number <= 10),
    floor_name      TEXT NOT NULL DEFAULT 'Floor 1',
    canvas_data     JSONB,
    thumbnail_url   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_floor_plans_job_floor ON floor_plans(job_id, floor_number);
CREATE INDEX idx_floor_plans_company ON floor_plans(company_id);

-- ============================================================================
-- 4. Job rooms table (each room belongs to a floor plan, optionally)
-- ============================================================================
CREATE TABLE job_rooms (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    floor_plan_id         UUID REFERENCES floor_plans(id) ON DELETE SET NULL,
    room_name             TEXT NOT NULL,
    length_ft             DECIMAL(6,2) CHECK (length_ft IS NULL OR length_ft >= 0),
    width_ft              DECIMAL(6,2) CHECK (width_ft IS NULL OR width_ft >= 0),
    height_ft             DECIMAL(6,2) DEFAULT 8 CHECK (height_ft IS NULL OR height_ft >= 0),
    square_footage        DECIMAL(8,2),
    water_category        TEXT CHECK (water_category IS NULL OR water_category IN ('1', '2', '3')),
    water_class           TEXT CHECK (water_class IS NULL OR water_class IN ('1', '2', '3', '4')),
    dry_standard          DECIMAL(6,2) CHECK (dry_standard IS NULL OR dry_standard >= 0),
    equipment_air_movers  INTEGER NOT NULL DEFAULT 0 CHECK (equipment_air_movers >= 0),
    equipment_dehus       INTEGER NOT NULL DEFAULT 0 CHECK (equipment_dehus >= 0),
    room_sketch_data      JSONB,
    notes                 TEXT,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rooms_job ON job_rooms(job_id);
CREATE INDEX idx_rooms_company ON job_rooms(company_id);
CREATE INDEX idx_rooms_floor_plan ON job_rooms(floor_plan_id) WHERE floor_plan_id IS NOT NULL;

-- ============================================================================
-- 5. Photos table
-- ============================================================================
CREATE TABLE photos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    room_id         UUID REFERENCES job_rooms(id) ON DELETE SET NULL,
    room_name       TEXT,
    storage_url     TEXT NOT NULL,
    filename        TEXT,
    caption         TEXT,
    photo_type      TEXT NOT NULL DEFAULT 'damage'
                    CHECK (photo_type IN ('damage', 'equipment', 'protection', 'containment', 'moisture_reading', 'before', 'after')),
    selected_for_ai BOOLEAN NOT NULL DEFAULT false,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_photos_job ON photos(job_id);
CREATE INDEX idx_photos_company ON photos(company_id);
CREATE INDEX idx_photos_room ON photos(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_photos_ai_selected ON photos(job_id, selected_for_ai) WHERE selected_for_ai = true;

-- ============================================================================
-- 6. Moisture readings (daily, per room)
-- ============================================================================
CREATE TABLE moisture_readings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id               UUID NOT NULL REFERENCES job_rooms(id) ON DELETE CASCADE,
    company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    reading_date          DATE NOT NULL,
    day_number            INTEGER,
    atmospheric_temp_f    DECIMAL(5,1) CHECK (atmospheric_temp_f IS NULL OR (atmospheric_temp_f >= -50 AND atmospheric_temp_f <= 200)),
    atmospheric_rh_pct    DECIMAL(5,1) CHECK (atmospheric_rh_pct IS NULL OR (atmospheric_rh_pct >= 0 AND atmospheric_rh_pct <= 100)),
    atmospheric_gpp       DECIMAL(6,1),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_readings_room_date ON moisture_readings(room_id, reading_date);
CREATE INDEX idx_readings_job ON moisture_readings(job_id);
CREATE INDEX idx_readings_company ON moisture_readings(company_id);

-- ============================================================================
-- 7. Moisture points (individual measurements within a reading)
-- ============================================================================
CREATE TABLE moisture_points (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_id      UUID NOT NULL REFERENCES moisture_readings(id) ON DELETE CASCADE,
    location_name   TEXT NOT NULL,
    reading_value   DECIMAL(6,1) NOT NULL,
    meter_photo_url TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_points_reading ON moisture_points(reading_id);

-- ============================================================================
-- 8. Dehu outputs (dehumidifier readings within a moisture reading)
-- ============================================================================
CREATE TABLE dehu_outputs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_id      UUID NOT NULL REFERENCES moisture_readings(id) ON DELETE CASCADE,
    dehu_model      TEXT,
    rh_out_pct      DECIMAL(5,1) CHECK (rh_out_pct IS NULL OR (rh_out_pct >= 0 AND rh_out_pct <= 100)),
    temp_out_f      DECIMAL(5,1) CHECK (temp_out_f IS NULL OR (temp_out_f >= -50 AND temp_out_f <= 200)),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dehus_reading ON dehu_outputs(reading_id);

-- ============================================================================
-- 9. Reports (tracks generated PDFs)
-- ============================================================================
CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    report_type     TEXT NOT NULL CHECK (report_type IN ('full_report', 'restoration_invoice')),
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'ready', 'failed')),
    storage_url     TEXT,
    generated_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_job ON reports(job_id);

-- ============================================================================
-- 10. Share links (job-level, hashed tokens, scoped, revokable)
-- ============================================================================
CREATE TABLE share_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    scope           TEXT NOT NULL DEFAULT 'full' CHECK (scope IN ('full', 'restoration_only', 'photos_only')),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_share_links_token ON share_links(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_share_links_job ON share_links(job_id);

-- ============================================================================
-- 11. Event history (full audit trail)
-- ============================================================================
CREATE TABLE event_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_id          UUID REFERENCES jobs(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    user_id         UUID,
    is_ai           BOOLEAN NOT NULL DEFAULT false,
    event_data      JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_job ON event_history(job_id, created_at DESC) WHERE job_id IS NOT NULL;
CREATE INDEX idx_events_company ON event_history(company_id, created_at DESC);
CREATE INDEX idx_events_type ON event_history(event_type);

-- ============================================================================
-- 12. Triggers: updated_at on new tables
-- ============================================================================
CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_floor_plans_updated_at BEFORE UPDATE ON floor_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_job_rooms_updated_at BEFORE UPDATE ON job_rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_readings_updated_at BEFORE UPDATE ON moisture_readings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 13. RLS policies on new tables
-- ============================================================================
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE moisture_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE moisture_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE dehu_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_history ENABLE ROW LEVEL SECURITY;

-- Properties
CREATE POLICY "properties_select" ON properties
    FOR SELECT USING (deleted_at IS NULL AND company_id = get_my_company_id());
CREATE POLICY "properties_insert" ON properties
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "properties_update" ON properties
    FOR UPDATE USING (deleted_at IS NULL AND company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());

-- Floor plans
CREATE POLICY "floor_plans_select" ON floor_plans
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "floor_plans_insert" ON floor_plans
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "floor_plans_update" ON floor_plans
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "floor_plans_delete" ON floor_plans
    FOR DELETE USING (company_id = get_my_company_id());

-- Rooms
CREATE POLICY "rooms_select" ON job_rooms
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "rooms_insert" ON job_rooms
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "rooms_update" ON job_rooms
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "rooms_delete" ON job_rooms
    FOR DELETE USING (company_id = get_my_company_id());

-- Photos
CREATE POLICY "photos_select" ON photos
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "photos_insert" ON photos
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "photos_update" ON photos
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "photos_delete" ON photos
    FOR DELETE USING (company_id = get_my_company_id());

-- Moisture readings
CREATE POLICY "readings_select" ON moisture_readings
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "readings_insert" ON moisture_readings
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "readings_update" ON moisture_readings
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "readings_delete" ON moisture_readings
    FOR DELETE USING (company_id = get_my_company_id());

-- Moisture points (inherit from reading via subquery)
CREATE POLICY "points_select" ON moisture_points FOR SELECT USING (
    EXISTS (SELECT 1 FROM moisture_readings mr WHERE mr.id = reading_id AND mr.company_id = get_my_company_id()));
CREATE POLICY "points_insert" ON moisture_points FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM moisture_readings mr WHERE mr.id = reading_id AND mr.company_id = get_my_company_id()));
CREATE POLICY "points_update" ON moisture_points FOR UPDATE USING (
    EXISTS (SELECT 1 FROM moisture_readings mr WHERE mr.id = reading_id AND mr.company_id = get_my_company_id()));
CREATE POLICY "points_delete" ON moisture_points FOR DELETE USING (
    EXISTS (SELECT 1 FROM moisture_readings mr WHERE mr.id = reading_id AND mr.company_id = get_my_company_id()));

-- Dehu outputs (inherit from reading via subquery)
CREATE POLICY "dehus_select" ON dehu_outputs FOR SELECT USING (
    EXISTS (SELECT 1 FROM moisture_readings mr WHERE mr.id = reading_id AND mr.company_id = get_my_company_id()));
CREATE POLICY "dehus_insert" ON dehu_outputs FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM moisture_readings mr WHERE mr.id = reading_id AND mr.company_id = get_my_company_id()));
CREATE POLICY "dehus_update" ON dehu_outputs FOR UPDATE USING (
    EXISTS (SELECT 1 FROM moisture_readings mr WHERE mr.id = reading_id AND mr.company_id = get_my_company_id()));
CREATE POLICY "dehus_delete" ON dehu_outputs FOR DELETE USING (
    EXISTS (SELECT 1 FROM moisture_readings mr WHERE mr.id = reading_id AND mr.company_id = get_my_company_id()));

-- Reports
CREATE POLICY "reports_select" ON reports
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "reports_insert" ON reports
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "reports_update" ON reports
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());

-- Share links
CREATE POLICY "share_links_select" ON share_links
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "share_links_insert" ON share_links
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "share_links_update" ON share_links
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());

-- Event history
CREATE POLICY "events_select" ON event_history
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "events_insert" ON event_history
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
    """)


def downgrade() -> None:
    for table, policies in [
        ("event_history", ["events_select", "events_insert"]),
        ("share_links", ["share_links_select", "share_links_insert", "share_links_update"]),
        ("reports", ["reports_select", "reports_insert", "reports_update"]),
        ("dehu_outputs", ["dehus_select", "dehus_insert", "dehus_update", "dehus_delete"]),
        ("moisture_points", ["points_select", "points_insert", "points_update", "points_delete"]),
        ("moisture_readings", ["readings_select", "readings_insert", "readings_update", "readings_delete"]),
        ("photos", ["photos_select", "photos_insert", "photos_update", "photos_delete"]),
        ("job_rooms", ["rooms_select", "rooms_insert", "rooms_update", "rooms_delete"]),
        ("floor_plans", ["floor_plans_select", "floor_plans_insert", "floor_plans_update", "floor_plans_delete"]),
        ("properties", ["properties_select", "properties_insert", "properties_update"]),
    ]:
        for policy in policies:
            op.execute(f'DROP POLICY IF EXISTS "{policy}" ON {table}')
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    for table in ["reports", "moisture_readings", "job_rooms", "floor_plans", "properties"]:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_updated_at ON {table}")

    op.execute("DROP TABLE IF EXISTS event_history")
    op.execute("DROP TABLE IF EXISTS share_links")
    op.execute("DROP TABLE IF EXISTS reports")
    op.execute("DROP TABLE IF EXISTS dehu_outputs")
    op.execute("DROP TABLE IF EXISTS moisture_points")
    op.execute("DROP TABLE IF EXISTS moisture_readings")
    op.execute("DROP TABLE IF EXISTS photos")
    op.execute("DROP TABLE IF EXISTS job_rooms")
    op.execute("DROP TABLE IF EXISTS floor_plans")

    op.execute("DROP INDEX IF EXISTS idx_jobs_property")
    op.execute("ALTER TABLE jobs DROP COLUMN IF EXISTS estimated_total")
    op.execute("ALTER TABLE jobs DROP COLUMN IF EXISTS tech_notes")
    op.execute("ALTER TABLE jobs DROP COLUMN IF EXISTS property_id")

    op.execute("DROP TABLE IF EXISTS properties")
