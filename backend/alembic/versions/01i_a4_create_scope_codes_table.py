"""Spec 01I (Onboarding): minimal scope_codes table for pricing upload.

Per Decision Log #8: keep pricing upload inline in onboarding via a minimal
scope_codes schema. Spec 01D (Xactimate Codes) will extend this table later
with selectors, dependencies, etc.

Schema:
- id           UUID PK
- company_id   UUID FK -> companies(id) ON DELETE CASCADE
- code         TEXT (Xactimate code, e.g., WTR DRYOUT)
- description  TEXT
- unit         TEXT (SF, LF, EA, etc.)
- price        NUMERIC(10, 2)
- tier         TEXT NOT NULL DEFAULT 'A' (A / B / C ...)
- created_at, updated_at

Why tier NOT NULL? Postgres treats NULLs as distinct in unique indexes, so
``UNIQUE (company_id, code, tier)`` with nullable tier would let infinite
duplicates through. The xlsx flow always sets tier; defaulting to 'A' keeps
the unique constraint meaningful.

RLS pattern matches Spec 00 bootstrap (companies/jobs/users):
- SELECT: own-company rows (deleted_at filter not used since no soft-delete here)
- INSERT/UPDATE/DELETE: own-company rows
Auth resolves via get_my_company_id() (defined in 001_bootstrap).

Revision ID: 01i_a4_scope_codes
Revises: 01i_a3_onboarding_state
Create Date: 2026-04-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "01i_a4_scope_codes"
down_revision: str | None = "01i_a3_onboarding_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE TABLE IF NOT EXISTS scope_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    description TEXT,
    unit        TEXT,
    price       NUMERIC(10, 2),
    tier        TEXT NOT NULL DEFAULT 'A',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT scope_codes_company_code_tier_unique
        UNIQUE (company_id, code, tier)
);

CREATE INDEX IF NOT EXISTS idx_scope_codes_company
    ON scope_codes (company_id);

ALTER TABLE scope_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scope_codes_select ON scope_codes;
CREATE POLICY scope_codes_select ON scope_codes
    FOR SELECT
    USING (company_id = get_my_company_id());

DROP POLICY IF EXISTS scope_codes_insert ON scope_codes;
CREATE POLICY scope_codes_insert ON scope_codes
    FOR INSERT
    WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS scope_codes_update ON scope_codes;
CREATE POLICY scope_codes_update ON scope_codes
    FOR UPDATE
    USING (company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());

DROP POLICY IF EXISTS scope_codes_delete ON scope_codes;
CREATE POLICY scope_codes_delete ON scope_codes
    FOR DELETE
    USING (company_id = get_my_company_id());

DROP TRIGGER IF EXISTS trg_scope_codes_updated_at ON scope_codes;
CREATE TRIGGER trg_scope_codes_updated_at BEFORE UPDATE ON scope_codes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
"""

DOWNGRADE_SQL = """
DROP TRIGGER IF EXISTS trg_scope_codes_updated_at ON scope_codes;
DROP POLICY IF EXISTS scope_codes_delete ON scope_codes;
DROP POLICY IF EXISTS scope_codes_update ON scope_codes;
DROP POLICY IF EXISTS scope_codes_insert ON scope_codes;
DROP POLICY IF EXISTS scope_codes_select ON scope_codes;
DROP INDEX IF EXISTS idx_scope_codes_company;
DROP TABLE IF EXISTS scope_codes;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
