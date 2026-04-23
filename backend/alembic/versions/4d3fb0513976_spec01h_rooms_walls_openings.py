"""Spec 01H Phase 1B: Extend job_rooms + create wall_segments + wall_openings

Revision ID: 4d3fb0513976
Revises: 1113c0e7729d
Create Date: 2026-04-16

Three changes:
1. job_rooms: add 9 new columns (room_type, ceiling, polygon, affected, materials, wall SF)
2. wall_segments: new table — relational walls with coordinates, type, shared wall detection
3. wall_openings: new table — doors, windows, missing walls tied to wall segments
"""

from collections.abc import Sequence

from alembic import op

revision: str = "4d3fb0513976"
down_revision: str | None = "1113c0e7729d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
-- ============================================================================
-- 1. Extend job_rooms with Phase 1 columns
-- ============================================================================

-- Room type: 13 predefined types that drive material defaults
ALTER TABLE job_rooms ADD COLUMN room_type TEXT
    CHECK (room_type IS NULL OR room_type IN (
        'living_room', 'kitchen', 'bathroom', 'bedroom', 'basement',
        'hallway', 'laundry_room', 'garage', 'dining_room', 'office',
        'closet', 'utility_room', 'other'
    ));

-- Ceiling type: drives the wall SF multiplier (flat=1.0, vaulted=1.3, etc.)
ALTER TABLE job_rooms ADD COLUMN ceiling_type TEXT NOT NULL DEFAULT 'flat'
    CHECK (ceiling_type IN ('flat', 'vaulted', 'cathedral', 'sloped'));

-- Which floor this room is on (for multi-floor properties)
ALTER TABLE job_rooms ADD COLUMN floor_level TEXT
    CHECK (floor_level IS NULL OR floor_level IN ('basement', 'main', 'upper', 'attic'));

-- Is this room in the damage scope?
ALTER TABLE job_rooms ADD COLUMN affected BOOLEAN NOT NULL DEFAULT false;

-- Materials present in the room (auto-populated from room_type, editable by tech)
ALTER TABLE job_rooms ADD COLUMN material_flags JSONB NOT NULL DEFAULT '[]';

-- Calculated wall SF (stored for reports and Xactimate) — updated when walls change
ALTER TABLE job_rooms ADD COLUMN wall_square_footage DECIMAL(10,2);

-- Tech override for unusual ceiling geometry (bypasses the calculated value)
ALTER TABLE job_rooms ADD COLUMN custom_wall_sf DECIMAL(10,2);

-- Polygon vertices [{x,y}, ...] — rectangles are 4-point polygons
ALTER TABLE job_rooms ADD COLUMN room_polygon JSONB;

-- Stairwell/HVAC cutouts that subtract from floor SF [{x,y,width,height}, ...]
ALTER TABLE job_rooms ADD COLUMN floor_openings JSONB NOT NULL DEFAULT '[]';

-- ============================================================================
-- 2. Wall segments (relational, not JSONB)
--
-- Each wall is a record with start/end coordinates, type, and affected status.
-- Xactimate needs queryable wall data: "how many LF of exterior drywall?"
-- ============================================================================

CREATE TABLE wall_segments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id             UUID NOT NULL REFERENCES job_rooms(id) ON DELETE CASCADE,
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    x1                  DECIMAL(8,2) NOT NULL,
    y1                  DECIMAL(8,2) NOT NULL,
    x2                  DECIMAL(8,2) NOT NULL,
    y2                  DECIMAL(8,2) NOT NULL,
    wall_type           TEXT NOT NULL DEFAULT 'interior'
                        CHECK (wall_type IN ('exterior', 'interior')),
    wall_height_ft      DECIMAL(5,2),       -- nullable, inherits from room.height_ft
    affected            BOOLEAN NOT NULL DEFAULT false,
    shared              BOOLEAN NOT NULL DEFAULT false,
    shared_with_room_id UUID REFERENCES job_rooms(id) ON DELETE SET NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_walls_room ON wall_segments(room_id);
CREATE INDEX idx_walls_company ON wall_segments(company_id);

-- Auto-update updated_at
CREATE TRIGGER set_updated_at_wall_segments
    BEFORE UPDATE ON wall_segments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: standard company_id pattern
ALTER TABLE wall_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY walls_select ON wall_segments
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY walls_insert ON wall_segments
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY walls_update ON wall_segments
    FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY walls_delete ON wall_segments
    FOR DELETE USING (company_id = get_my_company_id());

-- ============================================================================
-- 3. Wall openings (doors, windows, missing walls)
--
-- Each opening belongs to a wall segment. Used for SF deduction:
-- door = width_ft * height_ft subtracted from wall SF
-- window = width_ft * height_ft subtracted from wall SF
-- missing_wall = full opening, rendered as dashed line
-- ============================================================================

CREATE TABLE wall_openings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wall_id         UUID NOT NULL REFERENCES wall_segments(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    opening_type    TEXT NOT NULL CHECK (opening_type IN ('door', 'window', 'missing_wall')),
    position        DECIMAL(4,3) NOT NULL CHECK (position >= 0 AND position <= 1),
    width_ft        DECIMAL(5,2) NOT NULL CHECK (width_ft > 0),
    height_ft       DECIMAL(5,2) NOT NULL CHECK (height_ft > 0),
    sill_height_ft  DECIMAL(5,2),       -- windows only, optional
    swing           INTEGER CHECK (swing IS NULL OR swing IN (0, 1, 2, 3)),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_openings_wall ON wall_openings(wall_id);
CREATE INDEX idx_openings_company ON wall_openings(company_id);

-- Auto-update updated_at
CREATE TRIGGER set_updated_at_wall_openings
    BEFORE UPDATE ON wall_openings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: standard company_id pattern
ALTER TABLE wall_openings ENABLE ROW LEVEL SECURITY;

CREATE POLICY openings_select ON wall_openings
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY openings_insert ON wall_openings
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY openings_update ON wall_openings
    FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY openings_delete ON wall_openings
    FOR DELETE USING (company_id = get_my_company_id());
    """)


def downgrade() -> None:
    op.execute("""
-- Drop wall_openings (CASCADE drops indexes, trigger, policies)
DROP TABLE IF EXISTS wall_openings CASCADE;

-- Drop wall_segments
DROP TABLE IF EXISTS wall_segments CASCADE;

-- Remove new columns from job_rooms
ALTER TABLE job_rooms DROP COLUMN IF EXISTS floor_openings;
ALTER TABLE job_rooms DROP COLUMN IF EXISTS room_polygon;
ALTER TABLE job_rooms DROP COLUMN IF EXISTS custom_wall_sf;
ALTER TABLE job_rooms DROP COLUMN IF EXISTS wall_square_footage;
ALTER TABLE job_rooms DROP COLUMN IF EXISTS material_flags;
ALTER TABLE job_rooms DROP COLUMN IF EXISTS affected;
ALTER TABLE job_rooms DROP COLUMN IF EXISTS floor_level;
ALTER TABLE job_rooms DROP COLUMN IF EXISTS ceiling_type;
ALTER TABLE job_rooms DROP COLUMN IF EXISTS room_type;
    """)
