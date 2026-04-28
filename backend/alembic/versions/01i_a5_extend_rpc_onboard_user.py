"""Spec 01I (Onboarding): extend rpc_onboard_user to accept full company profile.

Decision Log #2: Screen 2 (Company Profile) is the CREATE step, not UPDATE.
Extending the existing atomic onboarding RPC preserves the advisory-lock +
idempotent semantics that fixed the prior race in b3f1a2c4d5e6, while widening
the company INSERT to capture address + service area in one call.

New parameters (appended to keep existing call sites working when omitted —
default to NULL):
- p_company_address  TEXT
- p_company_city     TEXT
- p_company_state    TEXT
- p_company_zip      TEXT
- p_service_area     TEXT[]

Idempotent semantics, advisory lock, SECURITY DEFINER all preserved verbatim.

Downgrade restores the 9-arg signature from b3f1a2c4d5e6 verbatim.

Revision ID: 01i_a5_extend_onboard
Revises: 01i_a4_scope_codes
Create Date: 2026-04-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "01i_a5_extend_onboard"
down_revision: str | None = "01i_a4_scope_codes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- Drop the prior 9-arg signature so the new 14-arg version is unambiguous.
-- Postgres treats functions with the same name and different arg lists as
-- distinct overloads; if we don't drop the old one, both exist and the
-- caller's keyword binding can pick either at random.
DROP FUNCTION IF EXISTS rpc_onboard_user(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION rpc_onboard_user(
    p_auth_user_id UUID,
    p_email TEXT,
    p_name TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_avatar_url TEXT,
    p_company_name TEXT,
    p_company_phone TEXT,
    p_company_slug TEXT,
    p_company_address TEXT DEFAULT NULL,
    p_company_city TEXT DEFAULT NULL,
    p_company_state TEXT DEFAULT NULL,
    p_company_zip TEXT DEFAULT NULL,
    p_service_area TEXT[] DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_company RECORD;
    v_user RECORD;
    v_existing_user RECORD;
    v_existing_found BOOLEAN;
BEGIN
    -- Advisory lock on auth_user_id to prevent concurrent onboarding races.
    -- Same hashtext() seed as the prior signature.
    PERFORM pg_advisory_xact_lock(hashtext(p_auth_user_id::TEXT));

    SELECT * INTO v_existing_user
    FROM users
    WHERE auth_user_id = p_auth_user_id AND deleted_at IS NULL
    FOR UPDATE;

    -- Capture FOUND immediately — every subsequent statement (RAISE, IF,
    -- assignment) overwrites the implicit FOUND variable. The original
    -- b3f1a2c4d5e6 RPC used ``v_existing_user IS NOT NULL`` for this check,
    -- which is a known plpgsql footgun: a RECORD evaluates IS NOT NULL only
    -- when ALL fields are non-null. Most users rows have nullable columns
    -- (avatar_url, deleted_at, etc.), so the check returned FALSE even when
    -- a row was found, falling through to INSERT and hitting a 23505 on
    -- the unique auth_user_id index. Using FOUND avoids the gotcha.
    v_existing_found := FOUND;

    IF v_existing_found AND v_existing_user.company_id IS NOT NULL THEN
        SELECT * INTO v_company FROM companies WHERE id = v_existing_user.company_id;
        RETURN jsonb_build_object(
            'already_exists', true,
            'user', to_jsonb(v_existing_user),
            'company', to_jsonb(v_company)
        );
    END IF;

    -- Create company with full profile.
    INSERT INTO companies (
        name, slug, phone, email,
        address, city, state, zip, service_area
    )
    VALUES (
        p_company_name, p_company_slug, p_company_phone, p_email,
        p_company_address, p_company_city, p_company_state, p_company_zip, p_service_area
    )
    RETURNING * INTO v_company;

    IF v_existing_found THEN
        UPDATE users
        SET company_id = v_company.id,
            name = p_name,
            first_name = p_first_name,
            last_name = p_last_name,
            avatar_url = p_avatar_url,
            role = 'owner'
        WHERE id = v_existing_user.id
        RETURNING * INTO v_user;
    ELSE
        INSERT INTO users (auth_user_id, company_id, email, name, first_name, last_name, avatar_url, role)
        VALUES (p_auth_user_id, v_company.id, p_email, p_name, p_first_name, p_last_name, p_avatar_url, 'owner')
        RETURNING * INTO v_user;
    END IF;

    RETURN jsonb_build_object(
        'already_exists', false,
        'user', to_jsonb(v_user),
        'company', to_jsonb(v_company)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION rpc_onboard_user(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
    TEXT, TEXT, TEXT, TEXT, TEXT[]
) TO authenticated, service_role;
"""


# Recreates the 9-arg signature verbatim from b3f1a2c4d5e6.
DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS rpc_onboard_user(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
    TEXT, TEXT, TEXT, TEXT, TEXT[]
);

CREATE OR REPLACE FUNCTION rpc_onboard_user(
    p_auth_user_id UUID,
    p_email TEXT,
    p_name TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_avatar_url TEXT,
    p_company_name TEXT,
    p_company_phone TEXT,
    p_company_slug TEXT
) RETURNS JSONB AS $$
DECLARE
    v_company RECORD;
    v_user RECORD;
    v_existing_user RECORD;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_auth_user_id::TEXT));

    SELECT * INTO v_existing_user
    FROM users
    WHERE auth_user_id = p_auth_user_id AND deleted_at IS NULL
    FOR UPDATE;

    IF v_existing_user IS NOT NULL AND v_existing_user.company_id IS NOT NULL THEN
        SELECT * INTO v_company FROM companies WHERE id = v_existing_user.company_id;
        RETURN jsonb_build_object(
            'already_exists', true,
            'user', to_jsonb(v_existing_user),
            'company', to_jsonb(v_company)
        );
    END IF;

    INSERT INTO companies (name, slug, phone, email)
    VALUES (p_company_name, p_company_slug, p_company_phone, p_email)
    RETURNING * INTO v_company;

    IF v_existing_user IS NOT NULL THEN
        UPDATE users
        SET company_id = v_company.id,
            name = p_name,
            first_name = p_first_name,
            last_name = p_last_name,
            avatar_url = p_avatar_url,
            role = 'owner'
        WHERE id = v_existing_user.id
        RETURNING * INTO v_user;
    ELSE
        INSERT INTO users (auth_user_id, company_id, email, name, first_name, last_name, avatar_url, role)
        VALUES (p_auth_user_id, v_company.id, p_email, p_name, p_first_name, p_last_name, p_avatar_url, 'owner')
        RETURNING * INTO v_user;
    END IF;

    RETURN jsonb_build_object(
        'already_exists', false,
        'user', to_jsonb(v_user),
        'company', to_jsonb(v_company)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
