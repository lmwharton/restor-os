"""Spec 01H Phase 1A: Reparent floor_plans to property_id + floor_plan_versions + jobs FK

Revision ID: 1113c0e7729d
Revises: 81768e4659c2
Create Date: 2026-04-16

Three changes:
1. floor_plans: drop job_id FK, add property_id FK (floor plans belong to buildings, not jobs)
2. floor_plan_versions: new table for job-driven versioning (each job pins to a version)
3. jobs: add floor_plan_version_id FK (pins a job to a specific version)

No data migration needed — existing dev/staging floor_plans data is wiped (Decision #2: clean cut).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "1113c0e7729d"
down_revision: str | None = "81768e4659c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
-- ============================================================================
-- 1. Reparent floor_plans: job_id → property_id
-- ============================================================================

-- Add property_id column (nullable first, so we can wipe data before enforcing NOT NULL)
ALTER TABLE floor_plans ADD COLUMN property_id UUID REFERENCES properties(id) ON DELETE CASCADE;

-- Wipe existing dev/staging data — no prod data exists (Spec 01H Decision #2)
DELETE FROM floor_plans;

-- Drop old unique index and job_id column
DROP INDEX IF EXISTS idx_floor_plans_job_floor;
ALTER TABLE floor_plans DROP COLUMN job_id;

-- Now enforce NOT NULL on property_id
ALTER TABLE floor_plans ALTER COLUMN property_id SET NOT NULL;

-- New unique index: one floor plan per floor per property
CREATE UNIQUE INDEX idx_floor_plans_property_floor ON floor_plans(property_id, floor_number);
CREATE INDEX idx_floor_plans_property ON floor_plans(property_id);

-- ============================================================================
-- 2. Floor plan versions (job-driven versioning)
--
-- Each version captures a snapshot of canvas state. A job creates a version on
-- first save, updates it on subsequent saves, and freezes it on archive.
-- If a different job edits, it forks a new version.
-- ============================================================================

CREATE TABLE floor_plan_versions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    floor_plan_id      UUID NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
    company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    version_number     INTEGER NOT NULL,
    canvas_data        JSONB NOT NULL,
    created_by_job_id  UUID REFERENCES jobs(id) ON DELETE SET NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    change_summary     TEXT,
    is_current         BOOLEAN NOT NULL DEFAULT true,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(floor_plan_id, version_number)
);

-- Fast lookups: version history for a floor plan, and finding the current version
CREATE INDEX idx_versions_floor_plan ON floor_plan_versions(floor_plan_id, version_number);
CREATE INDEX idx_versions_current ON floor_plan_versions(floor_plan_id) WHERE is_current = true;
CREATE INDEX idx_versions_company ON floor_plan_versions(company_id);

-- Auto-update updated_at on row changes
CREATE TRIGGER set_updated_at_floor_plan_versions
    BEFORE UPDATE ON floor_plan_versions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: standard company_id pattern (consistent with every other table in this codebase)
ALTER TABLE floor_plan_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY versions_select ON floor_plan_versions
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY versions_insert ON floor_plan_versions
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY versions_update ON floor_plan_versions
    FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY versions_delete ON floor_plan_versions
    FOR DELETE USING (company_id = get_my_company_id());

-- ============================================================================
-- 3. Pin jobs to floor plan versions
-- ============================================================================

ALTER TABLE jobs ADD COLUMN floor_plan_version_id UUID REFERENCES floor_plan_versions(id) ON DELETE SET NULL;
CREATE INDEX idx_jobs_floor_plan_version ON jobs(floor_plan_version_id) WHERE floor_plan_version_id IS NOT NULL;
    """)


def downgrade() -> None:
    op.execute("""
-- Remove jobs FK
DROP INDEX IF EXISTS idx_jobs_floor_plan_version;
ALTER TABLE jobs DROP COLUMN IF EXISTS floor_plan_version_id;

-- Drop floor_plan_versions table (CASCADE drops indexes, trigger, policies)
DROP TABLE IF EXISTS floor_plan_versions CASCADE;

-- Restore floor_plans to job-scoped
DROP INDEX IF EXISTS idx_floor_plans_property_floor;
DROP INDEX IF EXISTS idx_floor_plans_property;
ALTER TABLE floor_plans DROP COLUMN IF EXISTS property_id;
ALTER TABLE floor_plans ADD COLUMN job_id UUID REFERENCES jobs(id) ON DELETE CASCADE;
DELETE FROM floor_plans;  -- clean slate
ALTER TABLE floor_plans ALTER COLUMN job_id SET NOT NULL;
CREATE UNIQUE INDEX idx_floor_plans_job_floor ON floor_plans(job_id, floor_number);
    """)
