"""Spec 01H: Merge floor_plans container into floor_plan_versions, rename to floor_plans.

Per Lakshman's peer-review note: the previous schema had two tables —
`floor_plans` (container with floor_number, floor_name, mirror canvas_data)
and `floor_plan_versions` (the actual versioned snapshots). The container
served only as grouping + metadata; its `canvas_data` was a redundant mirror
of the current version. Every save wrote the same blob twice.

This migration:

1. Adds the container columns (property_id, floor_number, floor_name,
   thumbnail_url) directly onto `floor_plan_versions`.
2. Backfills those columns by joining to the old `floor_plans` table.
3. Re-points `job_rooms.floor_plan_id` from the (now-dying) container row
   to the `is_current` version row for that floor.
4. Drops the old `floor_plans` table.
5. Renames `floor_plan_versions` → `floor_plans`.
6. Renames `jobs.floor_plan_version_id` → `jobs.floor_plan_id`.
7. Recreates indexes with the new names.

Net effect: one unified `floor_plans` table. Each row IS a versioned
snapshot of a floor at a property. Simpler schema, one less join, no
double-write on save.

Revision ID: e1a7c9b30201
Revises: 4d3fb0513976
Create Date: 2026-04-17
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1a7c9b30201"
down_revision: str | None = "4d3fb0513976"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- =========================================================================
-- Step 1: Add container columns to floor_plan_versions (nullable first so
-- we can backfill them from the old floor_plans rows).
-- =========================================================================

ALTER TABLE floor_plan_versions
    ADD COLUMN property_id UUID,
    ADD COLUMN floor_number INTEGER,
    ADD COLUMN floor_name TEXT,
    ADD COLUMN thumbnail_url TEXT;

-- =========================================================================
-- Step 2: Backfill the new columns from the old floor_plans container by
-- joining on floor_plan_versions.floor_plan_id.
-- =========================================================================

UPDATE floor_plan_versions v
   SET property_id   = fp.property_id,
       floor_number  = fp.floor_number,
       floor_name    = fp.floor_name,
       thumbnail_url = fp.thumbnail_url
  FROM floor_plans fp
 WHERE v.floor_plan_id = fp.id;

-- =========================================================================
-- Step 3: Re-point job_rooms.floor_plan_id. It currently references the
-- container. After the rename, it should reference a specific version —
-- pick the is_current=true version for that floor (falling back to any
-- version if none marked current yet).
-- =========================================================================

UPDATE job_rooms jr
   SET floor_plan_id = (
       SELECT v.id FROM floor_plan_versions v
        WHERE v.floor_plan_id = jr.floor_plan_id
          AND v.is_current = true
        ORDER BY v.version_number DESC
        LIMIT 1
   )
 WHERE jr.floor_plan_id IS NOT NULL;

-- Any rows still pointing at a container with no versions yet become NULL.
-- (FK cascade from the old container would have deleted them anyway when
-- we drop the container below; nulling them preserves the job_room.)
UPDATE job_rooms
   SET floor_plan_id = NULL
 WHERE floor_plan_id IN (SELECT id FROM floor_plans);

-- =========================================================================
-- Step 4: Drop FK + column on floor_plan_versions pointing at the old
-- container (no longer needed — container metadata is on the row now).
-- =========================================================================

-- Drop the column. PostgreSQL cascade-drops the FK constraint on floor_plan_id.
ALTER TABLE floor_plan_versions DROP COLUMN floor_plan_id;

-- =========================================================================
-- Step 5: Drop the old floor_plans container table.
-- =========================================================================

-- The job_rooms.floor_plan_id FK constraint still points at the OLD
-- floor_plans table; we drop it before removing the table, then add a
-- fresh FK to the renamed table at the end.
ALTER TABLE job_rooms DROP CONSTRAINT IF EXISTS job_rooms_floor_plan_id_fkey;

DROP TABLE floor_plans;

-- =========================================================================
-- Step 6: Enforce NOT NULL on the backfilled required columns, then rename
-- floor_plan_versions to the new unified floor_plans name.
-- =========================================================================

ALTER TABLE floor_plan_versions
    ALTER COLUMN property_id   SET NOT NULL,
    ALTER COLUMN floor_number  SET NOT NULL,
    ALTER COLUMN floor_name    SET NOT NULL;

ALTER TABLE floor_plan_versions RENAME TO floor_plans;

-- =========================================================================
-- Step 7: Rename the FK column on jobs for clarity.
-- =========================================================================

ALTER TABLE jobs RENAME COLUMN floor_plan_version_id TO floor_plan_id;

-- =========================================================================
-- Step 8: Recreate indexes with the unified naming.
-- =========================================================================

-- Drop old indexes (were created with "versions" naming)
DROP INDEX IF EXISTS idx_versions_floor_plan;
DROP INDEX IF EXISTS idx_versions_current;

-- New indexes named for the unified table
CREATE INDEX idx_floor_plans_property       ON floor_plans(property_id);
CREATE INDEX idx_floor_plans_property_floor ON floor_plans(property_id, floor_number);
CREATE INDEX idx_floor_plans_is_current     ON floor_plans(property_id, floor_number)
    WHERE is_current = true;
CREATE INDEX idx_floor_plans_created_by_job ON floor_plans(created_by_job_id)
    WHERE created_by_job_id IS NOT NULL;

-- FK on property_id to the properties table (cascade on property delete)
ALTER TABLE floor_plans
    ADD CONSTRAINT floor_plans_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

-- Re-add job_rooms FK pointing at the renamed table. ON DELETE SET NULL so
-- a room survives if the floor plan it references is removed.
ALTER TABLE job_rooms
    ADD CONSTRAINT job_rooms_floor_plan_id_fkey
    FOREIGN KEY (floor_plan_id) REFERENCES floor_plans(id) ON DELETE SET NULL;

-- jobs.floor_plan_id FK — PostgreSQL preserves the FK through a column
-- rename, but the constraint name still says "version". Rename it.
ALTER TABLE jobs RENAME CONSTRAINT jobs_floor_plan_version_id_fkey TO jobs_floor_plan_id_fkey;

-- Rename the index on jobs.floor_plan_id too
DROP INDEX IF EXISTS idx_jobs_floor_plan_version;
CREATE INDEX idx_jobs_floor_plan ON jobs(floor_plan_id) WHERE floor_plan_id IS NOT NULL;
"""




DOWNGRADE_SQL = """
-- Reverses the container/versions merge: splits the unified `floor_plans`
-- table back into `floor_plans` (container) + `floor_plan_versions`
-- (versioned snapshots), and restores the original RLS policies + trigger
-- on the recreated container.
--
-- Step ordering is deliberate: every step that references a column must
-- run BEFORE the step that drops that column. The previous version of
-- this body dropped container columns in step 6 then used them in step 7,
-- which aborted the transaction mid-migration. The reordering below
-- (update job_rooms in D7 BEFORE dropping columns in D8) fixes that.
--
-- Best-effort semantics: if multiple versions exist per floor, the
-- recreated container picks metadata from the is_current=true row for
-- that (property_id, floor_number). Version history rows keep pointing
-- at that one container via their re-added floor_plan_id FK.

-- =========================================================================
-- D1: Drop the unified-table indexes, FKs, and constraint rename added
-- in upgrade step 8. This frees the naming so the container can be
-- recreated below.
-- =========================================================================

DROP INDEX IF EXISTS idx_floor_plans_property;
DROP INDEX IF EXISTS idx_floor_plans_property_floor;
DROP INDEX IF EXISTS idx_floor_plans_is_current;
DROP INDEX IF EXISTS idx_floor_plans_created_by_job;
DROP INDEX IF EXISTS idx_jobs_floor_plan;

ALTER TABLE floor_plans DROP CONSTRAINT IF EXISTS floor_plans_property_id_fkey;
ALTER TABLE job_rooms   DROP CONSTRAINT IF EXISTS job_rooms_floor_plan_id_fkey;
ALTER TABLE jobs        RENAME CONSTRAINT jobs_floor_plan_id_fkey TO jobs_floor_plan_version_id_fkey;

-- =========================================================================
-- D2: Restore jobs.floor_plan_id → floor_plan_version_id.
-- =========================================================================

ALTER TABLE jobs RENAME COLUMN floor_plan_id TO floor_plan_version_id;
CREATE INDEX idx_jobs_floor_plan_version ON jobs(floor_plan_version_id)
    WHERE floor_plan_version_id IS NOT NULL;

-- =========================================================================
-- D3: Rename the unified table back to floor_plan_versions. The versions_*
-- RLS policies created in 1113c0e7729d survive the rename as-is (they were
-- never renamed in upgrade), so the versions table keeps its original
-- security posture.
-- =========================================================================

ALTER TABLE floor_plans RENAME TO floor_plan_versions;

-- Drop the NOT NULL constraints on the container columns we added in
-- upgrade step 6. They'll be dropped outright in D8, but relaxing them
-- here avoids a NOT NULL violation if any row is in a weird state.
ALTER TABLE floor_plan_versions
    ALTER COLUMN property_id   DROP NOT NULL,
    ALTER COLUMN floor_number  DROP NOT NULL,
    ALTER COLUMN floor_name    DROP NOT NULL;

-- =========================================================================
-- D4: Recreate the original floor_plans container table (property-scoped).
-- Same shape as migration 1113c0e7729d's post-state.
-- =========================================================================

CREATE TABLE floor_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    floor_number    INTEGER NOT NULL DEFAULT 1 CHECK (floor_number >= 0 AND floor_number <= 10),
    floor_name      TEXT NOT NULL DEFAULT 'Floor 1',
    canvas_data     JSONB,
    thumbnail_url   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_floor_plans_property_floor ON floor_plans(property_id, floor_number);
CREATE INDEX idx_floor_plans_property ON floor_plans(property_id);

-- RLS policies — original ca59c5bf87c9 naming.
ALTER TABLE floor_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "floor_plans_select" ON floor_plans
    FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "floor_plans_insert" ON floor_plans
    FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "floor_plans_update" ON floor_plans
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "floor_plans_delete" ON floor_plans
    FOR DELETE USING (company_id = get_my_company_id());

-- Trigger — original ca59c5bf87c9 naming.
CREATE TRIGGER trg_floor_plans_updated_at
    BEFORE UPDATE ON floor_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================================
-- D5: Backfill one floor_plans (container) row per (property_id, floor_number)
-- from the is_current=true rows in floor_plan_versions. When multiple versions
-- exist for a floor, the is_current row's metadata wins.
-- =========================================================================

INSERT INTO floor_plans (id, property_id, company_id, floor_number, floor_name,
                          canvas_data, thumbnail_url, created_at, updated_at)
SELECT
    gen_random_uuid(),
    v.property_id,
    v.company_id,
    v.floor_number,
    v.floor_name,
    v.canvas_data,
    v.thumbnail_url,
    MIN(v.created_at),
    MAX(v.updated_at)
  FROM floor_plan_versions v
 WHERE v.is_current = true
 GROUP BY v.property_id, v.company_id, v.floor_number, v.floor_name,
          v.canvas_data, v.thumbnail_url;

-- =========================================================================
-- D6: Restore floor_plan_id column on floor_plan_versions; backfill each
-- version row to the matching container row.
-- =========================================================================

ALTER TABLE floor_plan_versions ADD COLUMN floor_plan_id UUID;

UPDATE floor_plan_versions v
   SET floor_plan_id = fp.id
  FROM floor_plans fp
 WHERE v.property_id  = fp.property_id
   AND v.floor_number = fp.floor_number;

ALTER TABLE floor_plan_versions ALTER COLUMN floor_plan_id SET NOT NULL;

ALTER TABLE floor_plan_versions
    ADD CONSTRAINT floor_plan_versions_floor_plan_id_fkey
    FOREIGN KEY (floor_plan_id) REFERENCES floor_plans(id) ON DELETE CASCADE;

-- =========================================================================
-- D7: Re-point job_rooms.floor_plan_id from a version row to the matching
-- container row. MUST happen BEFORE D8 drops the columns this join uses.
-- (The previous downgrade body did this AFTER D8 and crashed.)
-- =========================================================================

UPDATE job_rooms jr
   SET floor_plan_id = (
       SELECT fp.id
         FROM floor_plan_versions v
         JOIN floor_plans fp ON v.property_id  = fp.property_id
                             AND v.floor_number = fp.floor_number
        WHERE v.id = jr.floor_plan_id
        LIMIT 1
   )
 WHERE jr.floor_plan_id IS NOT NULL;

-- =========================================================================
-- D8: Drop the container columns off floor_plan_versions — they're
-- redundant now that the split container exists again.
-- =========================================================================

ALTER TABLE floor_plan_versions
    DROP COLUMN property_id,
    DROP COLUMN floor_number,
    DROP COLUMN floor_name,
    DROP COLUMN thumbnail_url;

-- =========================================================================
-- D9: Restore the job_rooms.floor_plan_id FK against the new container
-- (container id was set in D7), and the old floor_plan_versions indexes.
-- =========================================================================

ALTER TABLE job_rooms
    ADD CONSTRAINT job_rooms_floor_plan_id_fkey
    FOREIGN KEY (floor_plan_id) REFERENCES floor_plans(id) ON DELETE SET NULL;

CREATE INDEX idx_versions_floor_plan ON floor_plan_versions(floor_plan_id, version_number);
CREATE INDEX idx_versions_current    ON floor_plan_versions(floor_plan_id)
    WHERE is_current = true;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
