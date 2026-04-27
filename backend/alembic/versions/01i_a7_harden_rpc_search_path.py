"""Spec 01I — harden ``rpc_onboard_user`` SECURITY DEFINER with SET search_path.

Pinning ``search_path = pg_catalog, public`` on a SECURITY DEFINER function is
the standard hardening for the search-path-injection footgun: a low-privilege
role with CREATE on a schema earlier in the search path can otherwise shadow
``users``/``companies``/``to_jsonb`` etc. and execute under the function
owner's privileges.

The sibling RPC ``rpc_create_jobs_batch`` (migration ``01i_a6``) already pins
``search_path``; this migration brings ``rpc_onboard_user`` to parity.

We use ``CREATE OR REPLACE FUNCTION`` to re-emit the body with the search-path
clause appended. The signature, body, and grants are otherwise identical to
``01i_a5_extend_rpc_onboard_user``.

Found via post-implementation code review.

Revision ID: 01i_a7_harden_rpc_search_path
Revises: 01i_a6_jobs_batch
Create Date: 2026-04-27
"""

from alembic import op

revision = "01i_a7_harden_rpc_search_path"
down_revision = "01i_a6_jobs_batch"
branch_labels = None
depends_on = None


_RPC_DEFINITION_HARDENED = """
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
    p_company_address TEXT,
    p_company_city TEXT,
    p_company_state TEXT,
    p_company_zip TEXT,
    p_service_area TEXT[]
) RETURNS JSONB AS $$
DECLARE
    v_company RECORD;
    v_user RECORD;
    v_existing_user RECORD;
    v_user_found BOOLEAN := FALSE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_auth_user_id::TEXT));

    SELECT * INTO v_existing_user
    FROM users
    WHERE auth_user_id = p_auth_user_id AND deleted_at IS NULL
    FOR UPDATE;
    v_user_found := FOUND;

    IF v_user_found AND v_existing_user.company_id IS NOT NULL THEN
        SELECT * INTO v_company FROM companies WHERE id = v_existing_user.company_id;
        RETURN jsonb_build_object(
            'already_exists', true,
            'user', to_jsonb(v_existing_user),
            'company', to_jsonb(v_company)
        );
    END IF;

    INSERT INTO companies (
        name, slug, phone, email, address, city, state, zip, service_area
    )
    VALUES (
        p_company_name,
        p_company_slug,
        p_company_phone,
        p_email,
        p_company_address,
        p_company_city,
        p_company_state,
        p_company_zip,
        p_service_area
    )
    RETURNING * INTO v_company;

    IF v_user_found THEN
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
        INSERT INTO users (
            auth_user_id, company_id, email, name,
            first_name, last_name, avatar_url, role
        )
        VALUES (
            p_auth_user_id,
            v_company.id,
            p_email,
            p_name,
            p_first_name,
            p_last_name,
            p_avatar_url,
            'owner'
        )
        RETURNING * INTO v_user;
    END IF;

    RETURN jsonb_build_object(
        'already_exists', false,
        'user', to_jsonb(v_user),
        'company', to_jsonb(v_company)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION rpc_onboard_user(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
    TEXT, TEXT, TEXT, TEXT, TEXT[]
) TO authenticated, service_role;
"""


# Restores the unhardened (no SET search_path) form from 01i_a5 if rolled back.
_RPC_DEFINITION_UNHARDENED = """
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
    p_company_address TEXT,
    p_company_city TEXT,
    p_company_state TEXT,
    p_company_zip TEXT,
    p_service_area TEXT[]
) RETURNS JSONB AS $$
DECLARE
    v_company RECORD;
    v_user RECORD;
    v_existing_user RECORD;
    v_user_found BOOLEAN := FALSE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_auth_user_id::TEXT));

    SELECT * INTO v_existing_user
    FROM users
    WHERE auth_user_id = p_auth_user_id AND deleted_at IS NULL
    FOR UPDATE;
    v_user_found := FOUND;

    IF v_user_found AND v_existing_user.company_id IS NOT NULL THEN
        SELECT * INTO v_company FROM companies WHERE id = v_existing_user.company_id;
        RETURN jsonb_build_object(
            'already_exists', true,
            'user', to_jsonb(v_existing_user),
            'company', to_jsonb(v_company)
        );
    END IF;

    INSERT INTO companies (
        name, slug, phone, email, address, city, state, zip, service_area
    )
    VALUES (
        p_company_name,
        p_company_slug,
        p_company_phone,
        p_email,
        p_company_address,
        p_company_city,
        p_company_state,
        p_company_zip,
        p_service_area
    )
    RETURNING * INTO v_company;

    IF v_user_found THEN
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
        INSERT INTO users (
            auth_user_id, company_id, email, name,
            first_name, last_name, avatar_url, role
        )
        VALUES (
            p_auth_user_id,
            v_company.id,
            p_email,
            p_name,
            p_first_name,
            p_last_name,
            p_avatar_url,
            'owner'
        )
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


def upgrade() -> None:
    # Postgres rejects ``CREATE OR REPLACE FUNCTION`` when the new definition
    # adds a ``SET`` clause to an existing function — the options aren't
    # mutable in-place. Drop and recreate atomically inside this migration's
    # transaction.
    op.execute(
        "DROP FUNCTION IF EXISTS rpc_onboard_user("
        "UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, "
        "TEXT, TEXT, TEXT, TEXT, TEXT[]"
        ")"
    )
    op.execute(_RPC_DEFINITION_HARDENED)


def downgrade() -> None:
    op.execute(
        "DROP FUNCTION IF EXISTS rpc_onboard_user("
        "UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, "
        "TEXT, TEXT, TEXT, TEXT, TEXT[]"
        ")"
    )
    op.execute(_RPC_DEFINITION_UNHARDENED)
