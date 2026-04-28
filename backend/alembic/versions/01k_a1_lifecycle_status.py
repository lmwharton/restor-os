"""Spec 01K — Job lifecycle (status flow + closeout settings + RPCs)

Revision ID: 01k_a1_lifecycle_status
Revises: 01i_a8_backfill_onboarding_state
Create Date: 2026-04-28

Single migration covering Phase 1 + Phase 3 of CREW-55:

1. Replace legacy 9-status (per-job-type) model with single 9-status lifecycle.
   - Maps legacy values to new ones for any existing rows.
   - Adds new check constraint.
   - Updates default to 'lead'.
2. Add 17 new lifecycle columns to `jobs` (timestamps + reasons + lead_source).
3. Backfill timestamp columns from existing data (best-effort).
4. Create `closeout_settings` table with RLS matching the existing pattern.
5. Create `rpc_update_job_status` (atomic update + event_history insert).
6. Create `rpc_seed_closeout_settings(company_id)` and seed for every existing company.
7. Update `rpc_create_job` to default new jobs to 'lead' (was 'new').

The user has explicitly authorized aggressive treatment of pre-launch data —
no production data exists yet, so we map cleanly and don't preserve a
backwards-compat path.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "01k_a1_lifecycle_status"
down_revision: str | None = "01i_a8_backfill_onboarding_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
-- =========================================================================
-- 1. Status enum migration
-- =========================================================================
-- Drop the old constraint FIRST so the UPDATE doesn't fail validation.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;

-- Map legacy values to the new lifecycle. Pre-launch — explicit mapping,
-- no rows lost.
UPDATE jobs SET status = 'active'    WHERE status IN ('contracted', 'mitigation', 'drying', 'scoping', 'in_progress');
UPDATE jobs SET status = 'completed' WHERE status = 'complete';
UPDATE jobs SET status = 'invoiced'  WHERE status = 'submitted';
UPDATE jobs SET status = 'paid'      WHERE status = 'collected';
UPDATE jobs SET status = 'lead'      WHERE status = 'new';

-- New 9-status constraint.
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (
    status IN ('lead', 'active', 'on_hold', 'completed', 'invoiced', 'disputed', 'paid', 'cancelled', 'lost')
);

-- New default for fresh rows.
ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'lead';

-- =========================================================================
-- 2. New lifecycle columns on `jobs`
-- =========================================================================
ALTER TABLE jobs ADD COLUMN active_at           TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN completed_at        TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN invoiced_at         TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN disputed_at         TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN dispute_resolved_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN paid_at             TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN cancelled_at        TIMESTAMPTZ;

ALTER TABLE jobs ADD COLUMN on_hold_reason       TEXT;
ALTER TABLE jobs ADD COLUMN on_hold_resume_date  DATE;
ALTER TABLE jobs ADD COLUMN cancel_reason        TEXT;
ALTER TABLE jobs ADD COLUMN cancel_reason_other  TEXT;
ALTER TABLE jobs ADD COLUMN dispute_reason       TEXT;
ALTER TABLE jobs ADD COLUMN dispute_count        INT NOT NULL DEFAULT 0;

ALTER TABLE jobs ADD COLUMN contract_signed_at         TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN estimate_last_finalized_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN lead_source                TEXT;
ALTER TABLE jobs ADD COLUMN lead_source_other          TEXT;

-- Best-effort timestamp backfill. Not guaranteed accurate but better than NULL
-- for existing rows, which would otherwise show "—" cycle time forever.
UPDATE jobs SET active_at    = created_at WHERE status IN ('active', 'on_hold', 'completed', 'invoiced', 'disputed', 'paid') AND active_at IS NULL;
UPDATE jobs SET completed_at = updated_at WHERE status IN ('completed', 'invoiced', 'disputed', 'paid') AND completed_at IS NULL;
UPDATE jobs SET invoiced_at  = updated_at WHERE status IN ('invoiced', 'disputed', 'paid') AND invoiced_at IS NULL;
UPDATE jobs SET paid_at      = updated_at WHERE status = 'paid' AND paid_at IS NULL;

-- Index for status filtering on dashboards. Renamed from `idx_jobs_status`
-- to avoid collision with the index of that name created earlier by
-- a1b2c3d4e5f6_add_jobs_fulltext_search_index.py (which is just on
-- `(status)`; ours is on `(company_id, status)` and is the more useful
-- one for dashboard queries).
CREATE INDEX IF NOT EXISTS idx_jobs_company_status
    ON jobs(company_id, status) WHERE deleted_at IS NULL;

-- =========================================================================
-- 3. closeout_settings table
-- =========================================================================
CREATE TABLE closeout_settings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_type      TEXT NOT NULL CHECK (job_type IN ('mitigation', 'reconstruction', 'fire_smoke', 'remodel')),
    item_key      TEXT NOT NULL,
    gate_level    TEXT NOT NULL CHECK (gate_level IN ('warn', 'acknowledge', 'hard_block')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, job_type, item_key)
);

CREATE INDEX idx_closeout_settings_company ON closeout_settings(company_id);

-- RLS — match the per-operation pattern from 001_bootstrap.py
ALTER TABLE closeout_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "closeout_settings_select" ON closeout_settings
    FOR SELECT USING (company_id = get_my_company_id());

CREATE POLICY "closeout_settings_insert" ON closeout_settings
    FOR INSERT WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "closeout_settings_update" ON closeout_settings
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "closeout_settings_delete" ON closeout_settings
    FOR DELETE USING (false);  -- never directly deleted; reset RPC handles wipes

-- updated_at trigger
CREATE TRIGGER trg_closeout_settings_updated_at
    BEFORE UPDATE ON closeout_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =========================================================================
-- 4. rpc_update_job_status — atomic status update + event_history
-- =========================================================================
-- Wraps the UPDATE jobs + INSERT event_history pair in one transaction.
-- Performs optimistic-locking via expected_current_status: if the cached
-- status is stale, returns NULL so the caller can return 409.
--
-- Validation of the transition matrix lives in Python (api/jobs/lifecycle.py)
-- — keeping it there means the matrix is testable + readable. The RPC just
-- enforces atomicity.

CREATE OR REPLACE FUNCTION rpc_update_job_status(
    p_job_id UUID,
    p_company_id UUID,
    p_user_id UUID,
    p_target_status TEXT,
    p_expected_current_status TEXT,
    p_event_type TEXT,
    p_event_data JSONB,
    p_timestamp_field TEXT,
    p_increment_dispute_count BOOLEAN DEFAULT FALSE,
    p_on_hold_reason TEXT DEFAULT NULL,
    p_on_hold_resume_date DATE DEFAULT NULL,
    p_cancel_reason TEXT DEFAULT NULL,
    p_cancel_reason_other TEXT DEFAULT NULL,
    p_dispute_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_job RECORD;
    v_now TIMESTAMPTZ := now();
    v_set_clauses TEXT;
    v_query TEXT;
BEGIN
    -- Optimistic-lock: only update if the status hasn't drifted since the
    -- caller fetched the job. Build the SET clause dynamically because the
    -- timestamp field varies per target status.
    v_set_clauses := format(
        'status = %L, updated_at = %L, updated_by = %L',
        p_target_status, v_now, p_user_id
    );

    -- Per-status timestamp (active_at / completed_at / etc.).
    -- Set only on first transition into that state — subsequent re-entries
    -- (e.g. re-entering disputed) update disputed_at on every entry, but
    -- active_at / completed_at / paid_at are first-set only.
    IF p_timestamp_field = 'disputed_at' OR p_timestamp_field = 'cancelled_at' THEN
        -- Always overwrite — disputes can re-fire, cancels are terminal so
        -- they only fire once anyway.
        v_set_clauses := v_set_clauses || format(', %I = %L', p_timestamp_field, v_now);
    ELSIF p_timestamp_field IS NOT NULL THEN
        -- First-set semantics — preserves the original transition timestamp
        -- across reopens (completed → active → completed should NOT reset
        -- completed_at to a new value).
        v_set_clauses := v_set_clauses || format(
            ', %I = COALESCE(%I, %L)',
            p_timestamp_field, p_timestamp_field, v_now
        );
    END IF;

    -- Special case: disputed → invoiced sets dispute_resolved_at.
    IF p_target_status = 'invoiced' AND p_expected_current_status = 'disputed' THEN
        v_set_clauses := v_set_clauses || format(', dispute_resolved_at = %L', v_now);
    END IF;

    -- Increment dispute_count when entering disputed.
    IF p_increment_dispute_count THEN
        v_set_clauses := v_set_clauses || ', dispute_count = dispute_count + 1';
    END IF;

    -- Reason fields for transitions that capture reason.
    IF p_on_hold_reason IS NOT NULL THEN
        v_set_clauses := v_set_clauses || format(', on_hold_reason = %L', p_on_hold_reason);
    END IF;
    IF p_on_hold_resume_date IS NOT NULL THEN
        v_set_clauses := v_set_clauses || format(', on_hold_resume_date = %L', p_on_hold_resume_date);
    END IF;
    IF p_cancel_reason IS NOT NULL THEN
        v_set_clauses := v_set_clauses || format(', cancel_reason = %L', p_cancel_reason);
    END IF;
    IF p_cancel_reason_other IS NOT NULL THEN
        v_set_clauses := v_set_clauses || format(', cancel_reason_other = %L', p_cancel_reason_other);
    END IF;
    IF p_dispute_reason IS NOT NULL THEN
        v_set_clauses := v_set_clauses || format(', dispute_reason = %L', p_dispute_reason);
    END IF;

    -- Run the conditional update with optimistic-lock predicate.
    v_query := format(
        'UPDATE jobs SET %s WHERE id = %L AND company_id = %L AND status = %L AND deleted_at IS NULL RETURNING *',
        v_set_clauses, p_job_id, p_company_id, p_expected_current_status
    );

    EXECUTE v_query INTO v_job;

    IF v_job.id IS NULL THEN
        -- Either the job doesn't exist, was deleted, or status drifted.
        -- Caller maps NULL → 409 Conflict.
        RETURN NULL;
    END IF;

    -- Atomic event_history write — same transaction as the UPDATE.
    INSERT INTO event_history (company_id, job_id, event_type, user_id, event_data)
    VALUES (p_company_id, v_job.id, p_event_type, p_user_id, COALESCE(p_event_data, '{}'::jsonb));

    RETURN to_jsonb(v_job);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- 5. rpc_seed_closeout_settings — defaults per Spec 01K D1/D2
-- =========================================================================
-- D1 — 7 closeout items (mitigation gets all 7; reconstruction gets 3;
-- fire_smoke gets 4). Other items render as "(n/a)" in the admin UI.
-- D2 — defaults: all "warn" except contract_signed = "acknowledge".

CREATE OR REPLACE FUNCTION rpc_seed_closeout_settings(p_company_id UUID)
RETURNS VOID AS $$
DECLARE
    v_items JSONB := jsonb_build_array(
        -- (job_type, item_key, gate_level)
        jsonb_build_array('mitigation',     'contract_signed',         'acknowledge'),
        jsonb_build_array('mitigation',     'photos_final_after',      'warn'),
        jsonb_build_array('mitigation',     'moisture_per_room',       'warn'),
        jsonb_build_array('mitigation',     'all_rooms_dry_standard',  'warn'),
        jsonb_build_array('mitigation',     'all_equipment_pulled',    'warn'),
        jsonb_build_array('mitigation',     'scope_finalized',         'warn'),
        jsonb_build_array('mitigation',     'certificate_generated',   'warn'),
        jsonb_build_array('reconstruction', 'contract_signed',         'acknowledge'),
        jsonb_build_array('reconstruction', 'photos_final_after',      'warn'),
        jsonb_build_array('reconstruction', 'scope_finalized',         'warn'),
        jsonb_build_array('fire_smoke',     'contract_signed',         'acknowledge'),
        jsonb_build_array('fire_smoke',     'photos_final_after',      'warn'),
        jsonb_build_array('fire_smoke',     'scope_finalized',         'warn'),
        jsonb_build_array('fire_smoke',     'certificate_generated',   'warn')
    );
    v_row JSONB;
BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        INSERT INTO closeout_settings (company_id, job_type, item_key, gate_level)
        VALUES (
            p_company_id,
            v_row->>0,
            v_row->>1,
            v_row->>2
        )
        ON CONFLICT (company_id, job_type, item_key) DO NOTHING;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- 6. Seed defaults for existing companies
-- =========================================================================
DO $$
DECLARE
    v_company_id UUID;
BEGIN
    FOR v_company_id IN SELECT id FROM companies WHERE deleted_at IS NULL LOOP
        PERFORM rpc_seed_closeout_settings(v_company_id);
    END LOOP;
END $$;

-- =========================================================================
-- 7. Update rpc_create_job to default new jobs to 'lead' (was 'new')
-- =========================================================================
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
    p_home_year_built INTEGER DEFAULT NULL,
    p_claim_number TEXT DEFAULT NULL,
    p_carrier TEXT DEFAULT NULL,
    p_adjuster_name TEXT DEFAULT NULL,
    p_adjuster_phone TEXT DEFAULT NULL,
    p_adjuster_email TEXT DEFAULT NULL,
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_tech_notes TEXT DEFAULT NULL,
    p_job_type TEXT DEFAULT 'mitigation',
    p_linked_job_id UUID DEFAULT NULL,
    p_lead_source TEXT DEFAULT NULL,
    p_lead_source_other TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_job RECORD;
BEGIN
    INSERT INTO jobs (
        company_id, job_number, address_line1, city, state, zip,
        loss_type, status, created_by, property_id,
        customer_name, customer_phone, customer_email,
        loss_category, loss_class, loss_cause, loss_date, home_year_built,
        claim_number, carrier, adjuster_name, adjuster_phone, adjuster_email,
        latitude, longitude, notes, tech_notes,
        job_type, linked_job_id,
        lead_source, lead_source_other
    ) VALUES (
        p_company_id, p_job_number, p_address_line1, p_city, p_state, p_zip,
        p_loss_type, 'lead', p_created_by, p_property_id,
        p_customer_name, p_customer_phone, p_customer_email,
        p_loss_category, p_loss_class, p_loss_cause, p_loss_date, p_home_year_built,
        p_claim_number, p_carrier, p_adjuster_name, p_adjuster_phone, p_adjuster_email,
        p_latitude, p_longitude, p_notes, p_tech_notes,
        p_job_type, p_linked_job_id,
        p_lead_source, p_lead_source_other
    ) RETURNING * INTO v_job;

    INSERT INTO event_history (company_id, job_id, event_type, user_id, event_data)
    VALUES (p_company_id, v_job.id, 'job_created', p_created_by,
            jsonb_build_object('job_number', p_job_number, 'lead_source', p_lead_source));

    RETURN to_jsonb(v_job);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- 8. Hook rpc_create_company / rpc_onboard_user to seed closeout defaults
-- =========================================================================
-- The onboarding RPC creates a company. After this migration, any new
-- company should automatically receive its default closeout settings.
-- We don't modify rpc_onboard_user here (large surface) — instead, the
-- backend service layer calls rpc_seed_closeout_settings explicitly after
-- creating a company. The DO block above handles all CURRENT companies.

""")


def downgrade() -> None:
    op.execute("""
DROP FUNCTION IF EXISTS rpc_seed_closeout_settings(UUID);
DROP FUNCTION IF EXISTS rpc_update_job_status(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, BOOLEAN, TEXT, DATE, TEXT, TEXT, TEXT);

DROP TRIGGER IF EXISTS trg_closeout_settings_updated_at ON closeout_settings;
DROP TABLE IF EXISTS closeout_settings;

DROP INDEX IF EXISTS idx_jobs_company_status;

ALTER TABLE jobs DROP COLUMN IF EXISTS lead_source_other;
ALTER TABLE jobs DROP COLUMN IF EXISTS lead_source;
ALTER TABLE jobs DROP COLUMN IF EXISTS estimate_last_finalized_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS contract_signed_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS dispute_count;
ALTER TABLE jobs DROP COLUMN IF EXISTS dispute_reason;
ALTER TABLE jobs DROP COLUMN IF EXISTS cancel_reason_other;
ALTER TABLE jobs DROP COLUMN IF EXISTS cancel_reason;
ALTER TABLE jobs DROP COLUMN IF EXISTS on_hold_resume_date;
ALTER TABLE jobs DROP COLUMN IF EXISTS on_hold_reason;
ALTER TABLE jobs DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS paid_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS dispute_resolved_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS disputed_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS invoiced_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS completed_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS active_at;

ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'new';
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;

UPDATE jobs SET status = 'new' WHERE status IN ('lead', 'lost');
UPDATE jobs SET status = 'mitigation' WHERE status = 'active';
UPDATE jobs SET status = 'drying' WHERE status = 'on_hold';
UPDATE jobs SET status = 'complete' WHERE status IN ('completed', 'disputed', 'cancelled');
UPDATE jobs SET status = 'submitted' WHERE status = 'invoiced';
UPDATE jobs SET status = 'collected' WHERE status = 'paid';

ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (
    status IN ('new', 'contracted', 'mitigation', 'drying', 'complete', 'submitted', 'collected', 'scoping', 'in_progress')
);
""")
