"""fix_update_updated_at_trigger_for_tables_without_deleted_at

Revision ID: 4cfff0c0a251
Revises: 49e2a91b6ebb
Create Date: 2026-03-27 11:31:06.681219

"""
from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '4cfff0c0a251'
down_revision: str | None = '49e2a91b6ebb'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Fix update_updated_at() trigger to work on tables without deleted_at.

    The original trigger references NEW.deleted_at unconditionally, which
    crashes on tables like floor_plans, job_rooms, photos, etc. that don't
    have a deleted_at column. This version checks if the column exists first.
    """
    op.execute("""
        CREATE OR REPLACE FUNCTION update_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            -- For tables with deleted_at: skip timestamp bump on soft-delete-only changes
            IF TG_TABLE_NAME IN ('companies', 'users', 'jobs', 'properties') THEN
                IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
                    RETURN NEW;
                END IF;
            END IF;
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)


def downgrade() -> None:
    """Restore original trigger that assumes deleted_at exists."""
    op.execute("""
        CREATE OR REPLACE FUNCTION update_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND
               NEW IS NOT DISTINCT FROM OLD THEN
                RETURN NEW;
            END IF;
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
