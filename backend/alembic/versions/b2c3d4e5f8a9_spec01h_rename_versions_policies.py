"""Spec 01H PR10 round-2 (R14): rename versions_* policies to floor_plans_*.

After e1a7c9b30201 renamed ``floor_plan_versions`` to ``floor_plans``, the
policies created as ``versions_{select,insert,update,delete}`` kept their
old names. Renaming so grep-by-policy-name matches the live table.

Revision ID: b2c3d4e5f8a9
Revises: a1b2c3d4e5f7
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b2c3d4e5f8a9"
down_revision: str | None = "a1b2c3d4e5f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'versions_select') THEN
        EXECUTE 'ALTER POLICY versions_select ON floor_plans RENAME TO floor_plans_select';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'versions_insert') THEN
        EXECUTE 'ALTER POLICY versions_insert ON floor_plans RENAME TO floor_plans_insert';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'versions_update') THEN
        EXECUTE 'ALTER POLICY versions_update ON floor_plans RENAME TO floor_plans_update';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'versions_delete') THEN
        EXECUTE 'ALTER POLICY versions_delete ON floor_plans RENAME TO floor_plans_delete';
    END IF;
END $$;
"""

DOWNGRADE_SQL = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'floor_plans_select') THEN
        EXECUTE 'ALTER POLICY floor_plans_select ON floor_plans RENAME TO versions_select';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'floor_plans_insert') THEN
        EXECUTE 'ALTER POLICY floor_plans_insert ON floor_plans RENAME TO versions_insert';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'floor_plans_update') THEN
        EXECUTE 'ALTER POLICY floor_plans_update ON floor_plans RENAME TO versions_update';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'floor_plans_delete') THEN
        EXECUTE 'ALTER POLICY floor_plans_delete ON floor_plans RENAME TO versions_delete';
    END IF;
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
