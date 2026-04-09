"""spec01b_add_job_type_linked_job_recon_phases

Revision ID: 785e9f316e2b
Revises: 93a19ccbfe45
Create Date: 2026-04-08 12:27:48.917172

Adds reconstruction job support:
- job_type column on jobs (mitigation or reconstruction)
- linked_job_id column on jobs (links recon job to its mitigation job)
- recon_phases table (flexible phase tracking for reconstruction jobs)
- Expands job status CHECK constraint with reconstruction-specific statuses
"""
from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "785e9f316e2b"
down_revision: str | None = "93a19ccbfe45"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add job_type, linked_job_id to jobs; create recon_phases table."""

    # =============================================================
    # 1. Normalize job_complete → complete + add reconstruction statuses
    #    Data migration first, then constraint update
    # =============================================================
    op.execute("UPDATE jobs SET status = 'complete' WHERE status = 'job_complete';")
    op.execute("""
    ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
    ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (
        status IN (
            'new', 'contracted', 'mitigation', 'drying',
            'scoping', 'in_progress',
            'complete', 'submitted', 'collected'
        )
    );
    """)

    # =============================================================
    # 2. Add job_type column to jobs table
    #    Default 'mitigation' so all existing jobs keep working
    # =============================================================
    op.execute("""
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'mitigation'
        CHECK (job_type IN ('mitigation', 'reconstruction'));
    """)

    # =============================================================
    # 3. Add linked_job_id column to jobs table
    #    A reconstruction job can optionally link to its mitigation job
    #    Self-referencing FK: jobs.linked_job_id -> jobs.id
    # =============================================================
    op.execute("""
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS linked_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_jobs_linked_job_id ON jobs(linked_job_id)
    WHERE linked_job_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);
    """)

    # =============================================================
    # 4. Create recon_phases table
    #    Flexible phase tracking -- no hardcoded stages.
    #    A kitchen rebuild might have: Demo, Drywall, Paint, Flooring, Cabinetry
    #    A ceiling leak might just have: Drywall, Paint
    # =============================================================
    op.execute("""
    CREATE TABLE IF NOT EXISTS recon_phases (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        company_id  UUID NOT NULL REFERENCES companies(id),
        phase_name  TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'on_hold', 'complete')),
        sort_order  INTEGER NOT NULL DEFAULT 0,
        started_at  TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        notes       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_recon_phases_job_id ON recon_phases(job_id, sort_order);

    ALTER TABLE recon_phases ENABLE ROW LEVEL SECURITY;

    CREATE POLICY recon_phases_select ON recon_phases
        FOR SELECT USING (company_id = get_my_company_id());
    CREATE POLICY recon_phases_insert ON recon_phases
        FOR INSERT WITH CHECK (company_id = get_my_company_id());
    CREATE POLICY recon_phases_update ON recon_phases
        FOR UPDATE USING (company_id = get_my_company_id());
    CREATE POLICY recon_phases_delete ON recon_phases
        FOR DELETE USING (company_id = get_my_company_id());

    CREATE TRIGGER update_recon_phases_updated_at
        BEFORE UPDATE ON recon_phases
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    """)


def downgrade() -> None:
    """Remove reconstruction support."""
    op.execute("DROP TABLE IF EXISTS recon_phases CASCADE;")
    op.execute("ALTER TABLE jobs DROP COLUMN IF EXISTS linked_job_id;")
    op.execute("ALTER TABLE jobs DROP COLUMN IF EXISTS job_type;")
    # Revert reconstruction-only statuses and complete → job_complete
    op.execute("UPDATE jobs SET status = 'new' WHERE status IN ('scoping', 'in_progress');")
    op.execute("UPDATE jobs SET status = 'job_complete' WHERE status = 'complete';")
    op.execute("""
    ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
    ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (
        status IN ('new', 'contracted', 'mitigation', 'drying',
                   'job_complete', 'submitted', 'collected')
    );
    """)
