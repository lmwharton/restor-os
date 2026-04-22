"""Spec 01H PR10 round-2 (R17): non-negative CHECK on wall SF columns.

Both ``job_rooms.wall_square_footage`` (backend-calculated) and
``job_rooms.custom_wall_sf`` (tech override) are DECIMAL columns with no
DB-level sanity constraint. Reviewer flagged that a tech entering ``-100``
as an override silently corrupts downstream SF calculations — and there's
no UI validation catching it either.

Add two CHECK constraints matching the reviewer's exact snippet so
negative values are rejected at the DB regardless of which code path
tries to write them. NULL stays allowed (it's the "not set" case).

Revision ID: c3d4e5f8a9b0
Revises: b2c3d4e5f8a9
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c3d4e5f8a9b0"
down_revision: str | None = "b2c3d4e5f8a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- Backfill guard — defensive. If any pre-existing row has a negative
-- wall_sf (e.g., from legacy data or a calculation bug), the ADD
-- CONSTRAINT below would crash the migration. NULL out the offenders
-- before the constraint lands and emit a NOTICE with the count so the
-- drift shows up in deploy logs. Pre-launch staging is expected to have
-- zero such rows; this is belt-and-suspenders for unexpected data.
DO $$
DECLARE
    v_custom_fixed INTEGER;
    v_calc_fixed   INTEGER;
BEGIN
    UPDATE job_rooms SET custom_wall_sf = NULL
     WHERE custom_wall_sf < 0;
    GET DIAGNOSTICS v_custom_fixed = ROW_COUNT;

    UPDATE job_rooms SET wall_square_footage = NULL
     WHERE wall_square_footage < 0;
    GET DIAGNOSTICS v_calc_fixed = ROW_COUNT;

    IF v_custom_fixed > 0 OR v_calc_fixed > 0 THEN
        RAISE NOTICE
            'R17 backfill guard nulled % custom_wall_sf and % wall_square_footage negative row(s) before applying CHECK constraints',
            v_custom_fixed, v_calc_fixed;
    END IF;
END $$;

ALTER TABLE job_rooms
    ADD CONSTRAINT custom_wall_sf_nonneg
        CHECK (custom_wall_sf IS NULL OR custom_wall_sf >= 0);

ALTER TABLE job_rooms
    ADD CONSTRAINT wall_square_footage_nonneg
        CHECK (wall_square_footage IS NULL OR wall_square_footage >= 0);
"""

DOWNGRADE_SQL = """
ALTER TABLE job_rooms DROP CONSTRAINT IF EXISTS wall_square_footage_nonneg;
ALTER TABLE job_rooms DROP CONSTRAINT IF EXISTS custom_wall_sf_nonneg;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
