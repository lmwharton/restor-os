"""Spec 01H PR10 round-2 (R10): wall/opening RLS parent-ownership check.

The ``walls_*`` / ``openings_*`` policies in migration 4d3fb0513976 enforce
only the child row's ``company_id``. Under direct Supabase client writes,
a tenant could INSERT a ``wall_segments`` row with ``company_id = MY_CO``
but ``room_id`` pointing at ANOTHER_TENANT's ``job_rooms`` row. The FK
constraint only verifies "row exists" (no company filter), RLS allows the
insert (child company matches), and the write itself becomes a
tenant-data side-channel — a ``23503`` vs success tells the caller
whether that foreign id exists.

Same attack shape for ``wall_openings.wall_id`` → ``wall_segments``.

This migration replaces the INSERT and UPDATE policies on both tables
with EXISTS checks that verify the parent row is in the caller's company.
SELECT and DELETE are unchanged — the current policies already scope those
correctly via child ``company_id``; the side-channel lives on writes
that reference a parent id.

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f0a1b2c3d4e5"
down_revision: str | None = "e9f0a1b2c3d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ---------------------------------------------------------------------------
-- wall_segments: enforce parent room ownership on INSERT and UPDATE.
-- SELECT and DELETE keep the existing child company_id filter.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS walls_insert ON wall_segments;
CREATE POLICY walls_insert ON wall_segments
    FOR INSERT WITH CHECK (
        company_id = get_my_company_id()
        AND EXISTS (
            SELECT 1 FROM job_rooms jr
             WHERE jr.id = wall_segments.room_id
               AND jr.company_id = get_my_company_id()
        )
    );

DROP POLICY IF EXISTS walls_update ON wall_segments;
CREATE POLICY walls_update ON wall_segments
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (
        company_id = get_my_company_id()
        AND EXISTS (
            SELECT 1 FROM job_rooms jr
             WHERE jr.id = wall_segments.room_id
               AND jr.company_id = get_my_company_id()
        )
    );


-- ---------------------------------------------------------------------------
-- wall_openings: parent is wall_segments.wall_id.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS openings_insert ON wall_openings;
CREATE POLICY openings_insert ON wall_openings
    FOR INSERT WITH CHECK (
        company_id = get_my_company_id()
        AND EXISTS (
            SELECT 1 FROM wall_segments ws
             WHERE ws.id = wall_openings.wall_id
               AND ws.company_id = get_my_company_id()
        )
    );

DROP POLICY IF EXISTS openings_update ON wall_openings;
CREATE POLICY openings_update ON wall_openings
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (
        company_id = get_my_company_id()
        AND EXISTS (
            SELECT 1 FROM wall_segments ws
             WHERE ws.id = wall_openings.wall_id
               AND ws.company_id = get_my_company_id()
        )
    );
"""


# Downgrade restores the pre-R10 policies (child company_id only). This is
# strictly weaker, so use only if you're rolling the entire 01H stack back.
DOWNGRADE_SQL = """
DROP POLICY IF EXISTS walls_insert ON wall_segments;
CREATE POLICY walls_insert ON wall_segments
    FOR INSERT WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS walls_update ON wall_segments;
CREATE POLICY walls_update ON wall_segments
    FOR UPDATE USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS openings_insert ON wall_openings;
CREATE POLICY openings_insert ON wall_openings
    FOR INSERT WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS openings_update ON wall_openings;
CREATE POLICY openings_update ON wall_openings
    FOR UPDATE USING (company_id = get_my_company_id());
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
