"""Add RPC functions for atomic operations

Revision ID: b3f1a2c4d5e6
Revises: 8fb2083bb9c9
Create Date: 2026-03-30

Creates PostgreSQL functions for atomic multi-step operations:
- rpc_create_job: atomic job insert + event log
- rpc_delete_job: atomic soft delete + event log
- rpc_create_share_link: atomic insert + event log
- rpc_onboard_user: atomic company + user creation with advisory lock
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b3f1a2c4d5e6"
down_revision: str | None = "8fb2083bb9c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
-- ============================================================================
-- 1. rpc_create_job: atomic job insert + event log
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_create_job(
    p_company_id UUID,
    p_job_number TEXT,
    p_address_line1 TEXT,
    p_city TEXT,
    p_state TEXT,
    p_zip TEXT,
    p_loss_type TEXT,
    p_created_by UUID,
    p_property_id UUID DEFAULT NULL,
    p_customer_name TEXT DEFAULT NULL,
    p_customer_phone TEXT DEFAULT NULL,
    p_customer_email TEXT DEFAULT NULL,
    p_loss_category TEXT DEFAULT NULL,
    p_loss_class TEXT DEFAULT NULL,
    p_loss_cause TEXT DEFAULT NULL,
    p_loss_date DATE DEFAULT NULL,
    p_claim_number TEXT DEFAULT NULL,
    p_carrier TEXT DEFAULT NULL,
    p_adjuster_name TEXT DEFAULT NULL,
    p_adjuster_phone TEXT DEFAULT NULL,
    p_adjuster_email TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_tech_notes TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_job RECORD;
BEGIN
    INSERT INTO jobs (
        company_id, job_number, address_line1, city, state, zip,
        loss_type, status, created_by, property_id,
        customer_name, customer_phone, customer_email,
        loss_category, loss_class, loss_cause, loss_date,
        claim_number, carrier, adjuster_name, adjuster_phone, adjuster_email,
        notes, tech_notes
    ) VALUES (
        p_company_id, p_job_number, p_address_line1, p_city, p_state, p_zip,
        p_loss_type, 'new', p_created_by, p_property_id,
        p_customer_name, p_customer_phone, p_customer_email,
        p_loss_category, p_loss_class, p_loss_cause, p_loss_date,
        p_claim_number, p_carrier, p_adjuster_name, p_adjuster_phone, p_adjuster_email,
        p_notes, p_tech_notes
    ) RETURNING * INTO v_job;

    INSERT INTO event_history (company_id, job_id, event_type, user_id, event_data)
    VALUES (p_company_id, v_job.id, 'job_created', p_created_by,
            jsonb_build_object('job_number', p_job_number));

    RETURN to_jsonb(v_job);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. rpc_delete_job: atomic soft delete + event log
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_delete_job(
    p_job_id UUID,
    p_company_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_found BOOLEAN;
BEGIN
    UPDATE jobs
    SET deleted_at = now(), updated_by = p_user_id
    WHERE id = p_job_id
      AND company_id = p_company_id
      AND deleted_at IS NULL;

    GET DIAGNOSTICS v_found = ROW_COUNT;

    IF NOT v_found THEN
        RETURN false;
    END IF;

    INSERT INTO event_history (company_id, job_id, event_type, user_id)
    VALUES (p_company_id, p_job_id, 'job_deleted', p_user_id);

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. rpc_create_share_link: atomic insert + event log
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_create_share_link(
    p_job_id UUID,
    p_company_id UUID,
    p_created_by UUID,
    p_token_hash TEXT,
    p_scope TEXT,
    p_expires_at TIMESTAMPTZ
) RETURNS JSONB AS $$
DECLARE
    v_link RECORD;
BEGIN
    INSERT INTO share_links (job_id, company_id, created_by, token_hash, scope, expires_at)
    VALUES (p_job_id, p_company_id, p_created_by, p_token_hash, p_scope, p_expires_at)
    RETURNING * INTO v_link;

    INSERT INTO event_history (company_id, job_id, event_type, user_id, event_data)
    VALUES (p_company_id, p_job_id, 'share_link_created', p_created_by,
            jsonb_build_object('link_id', v_link.id::TEXT, 'scope', p_scope));

    RETURN to_jsonb(v_link);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. rpc_onboard_user: atomic company + user creation with race protection
-- ============================================================================
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
    v_existing_company_id UUID;
    v_company RECORD;
    v_user RECORD;
    v_existing_user RECORD;
BEGIN
    -- Advisory lock on auth_user_id to prevent concurrent onboarding
    PERFORM pg_advisory_xact_lock(hashtext(p_auth_user_id::TEXT));

    -- Check if user already exists with a company
    SELECT * INTO v_existing_user
    FROM users
    WHERE auth_user_id = p_auth_user_id AND deleted_at IS NULL
    FOR UPDATE;

    IF v_existing_user IS NOT NULL AND v_existing_user.company_id IS NOT NULL THEN
        -- Already onboarded, return existing data
        SELECT * INTO v_company FROM companies WHERE id = v_existing_user.company_id;
        RETURN jsonb_build_object(
            'already_exists', true,
            'user', to_jsonb(v_existing_user),
            'company', to_jsonb(v_company)
        );
    END IF;

    -- Create company
    INSERT INTO companies (name, slug, phone, email)
    VALUES (p_company_name, p_company_slug, p_company_phone, p_email)
    RETURNING * INTO v_company;

    IF v_existing_user IS NOT NULL THEN
        -- User exists but no company (edge case) -- update them
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
        -- Create new user
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
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS rpc_onboard_user(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)")
    op.execute("DROP FUNCTION IF EXISTS rpc_create_share_link(UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ)")
    op.execute("DROP FUNCTION IF EXISTS rpc_delete_job(UUID, UUID, UUID)")
    op.execute("DROP FUNCTION IF EXISTS rpc_create_job(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)")
