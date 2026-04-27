-- ============================================================================
-- Migration:   001_bootstrap
-- Date:        2026-03-25
-- Description: Bootstrap schema for Crewmatic V1 — creates core tables
--              (companies, users, jobs), indexes, helper functions, triggers,
--              RLS policies, and the photos storage bucket.
--
-- Run this file in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- It is safe to run once on a fresh project. Do NOT re-run on an existing
-- database without reviewing for conflicts.
-- ============================================================================

-- ============================================================================
-- 1. Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. Table: companies
-- ============================================================================
CREATE TABLE companies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    slug              TEXT NOT NULL,
    phone             TEXT,
    email             TEXT,
    logo_url          TEXT,
    address           TEXT,
    city              TEXT,
    state             TEXT,
    zip               TEXT,
    settings          JSONB NOT NULL DEFAULT '{}',
    subscription_tier TEXT NOT NULL DEFAULT 'free'
                      CHECK (subscription_tier IN ('free', 'solo', 'team', 'pro')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

-- ============================================================================
-- 3. Table: users (references companies and auth.users)
-- ============================================================================
CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    email             TEXT NOT NULL,
    name              TEXT NOT NULL,
    first_name        TEXT,
    last_name         TEXT,
    phone             TEXT,
    avatar_url        TEXT,
    title             TEXT,
    -- Role values: owner (creator/admin) or tech (field staff).
    -- Originally shipped as ('owner', 'employee'); renamed to 'tech' in
    -- alembic migration 01i_a2_rename_role (Spec 01I) to match contractor
    -- terminology. The rename migration is retained for already-deployed
    -- DBs; this bootstrap line carries the post-rename values directly so
    -- a fresh DB starts at the right schema.
    role              TEXT NOT NULL DEFAULT 'owner'
                      CHECK (role IN ('owner', 'tech')),
    is_platform_admin BOOLEAN NOT NULL DEFAULT false,
    last_login_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

-- ============================================================================
-- 4. Table: jobs (references companies and users)
-- ============================================================================
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    job_number      TEXT NOT NULL,
    address_line1   TEXT NOT NULL,
    city            TEXT NOT NULL,
    state           TEXT NOT NULL,
    zip             TEXT NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    customer_name   TEXT,
    customer_phone  TEXT,
    customer_email  TEXT,
    claim_number    TEXT,
    carrier         TEXT,
    adjuster_name   TEXT,
    adjuster_phone  TEXT,
    adjuster_email  TEXT,
    loss_type       TEXT NOT NULL DEFAULT 'water'
                    CHECK (loss_type IN ('water', 'fire', 'mold', 'storm', 'other')),
    loss_category   TEXT CHECK (loss_category IN ('1', '2', '3')),
    loss_class      TEXT CHECK (loss_class IN ('1', '2', '3', '4')),
    loss_cause      TEXT,
    loss_date       DATE,
    status          TEXT NOT NULL DEFAULT 'needs_scope'
                    CHECK (status IN ('needs_scope', 'scoped', 'submitted')),
    assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
    notes           TEXT,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- ============================================================================
-- 5. Partial unique indexes (soft-deleted records don't block re-creation)
-- ============================================================================
CREATE UNIQUE INDEX idx_companies_slug_active ON companies(slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_users_auth_active ON users(auth_user_id) WHERE deleted_at IS NULL AND auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_users_email_active ON users(email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_jobs_company_job_number_active ON jobs(company_id, job_number) WHERE deleted_at IS NULL;

-- ============================================================================
-- 6. Query indexes
-- ============================================================================
CREATE INDEX idx_companies_created_at ON companies(created_at);
CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_company_role ON users(company_id, role) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_company_status ON jobs(company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_company_created_by ON jobs(company_id, created_by) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_company_assigned ON jobs(company_id, assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_company_created_at ON jobs(company_id, created_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- 7. Helper function: get_my_company_id() (SECURITY DEFINER, avoids RLS recursion)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT company_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL LIMIT 1;
$$;

-- ============================================================================
-- 8. Trigger function: update_updated_at() (skips soft-delete-only changes)
-- ============================================================================
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

-- ============================================================================
-- 9. Trigger function: prevent_admin_self_escalation()
-- ============================================================================
CREATE OR REPLACE FUNCTION prevent_admin_self_escalation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_platform_admin = true AND OLD.is_platform_admin = false THEN
        IF current_setting('request.jwt.claims', true)::jsonb->>'role' != 'service_role' THEN
            RAISE EXCEPTION 'Cannot self-escalate to platform admin';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. Triggers on all 3 tables
-- ============================================================================
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_prevent_admin_escalation BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION prevent_admin_self_escalation();

-- ============================================================================
-- 11. Enable RLS on all 3 tables
-- ============================================================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 12. RLS Policies
-- ============================================================================

-- ----- COMPANIES -----

CREATE POLICY "companies_select" ON companies
    FOR SELECT USING (deleted_at IS NULL AND id = get_my_company_id());

CREATE POLICY "companies_insert" ON companies
    FOR INSERT WITH CHECK (false);

CREATE POLICY "companies_update" ON companies
    FOR UPDATE USING (deleted_at IS NULL AND id = get_my_company_id())
    WITH CHECK (id = get_my_company_id());

CREATE POLICY "companies_delete" ON companies
    FOR DELETE USING (false);

-- ----- USERS -----

CREATE POLICY "users_select_own" ON users
    FOR SELECT USING (auth_user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "users_select_company" ON users
    FOR SELECT USING (deleted_at IS NULL AND company_id = get_my_company_id());

CREATE POLICY "users_insert" ON users
    FOR INSERT WITH CHECK (false);

CREATE POLICY "users_update" ON users
    FOR UPDATE USING (auth_user_id = auth.uid() AND deleted_at IS NULL)
    WITH CHECK (
        company_id = get_my_company_id()
        AND is_platform_admin = (SELECT is_platform_admin FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
        AND role = (SELECT role FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)
    );

CREATE POLICY "users_delete" ON users
    FOR DELETE USING (false);

-- ----- JOBS -----

CREATE POLICY "jobs_select" ON jobs
    FOR SELECT USING (deleted_at IS NULL AND company_id = get_my_company_id());

CREATE POLICY "jobs_insert" ON jobs
    FOR INSERT WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "jobs_update" ON jobs
    FOR UPDATE USING (deleted_at IS NULL AND company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "jobs_delete" ON jobs
    FOR DELETE USING (false);

-- ============================================================================
-- 13. Storage bucket: photos
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('photos', 'photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']);
