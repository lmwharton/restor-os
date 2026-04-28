"""Spec 01I (Onboarding): rpc_create_jobs_batch — atomic multi-job create.

Quick Add Active Jobs (Screen 3A) lets a new owner load up to 10 existing
jobs in one shot. The spec mandates "all-or-nothing — if one fails, rollback
all." supabase-py has no transaction API, so a Python loop calling
``rpc_create_job`` 10 times is 10 separate transactions; partial failure
leaves the company half-loaded.

This RPC accepts a JSONB array of job specs and inserts everything inside
one plpgsql transaction. Each spec is also responsible for resolving (or
creating) a property row at the same address — mirrors the dedup logic in
``ensure_job_property`` (lower(btrim(address_line1)) etc.) so the partial
unique address index ``idx_properties_address_active`` keeps holding.

Job number generation is centralized: the function reads the per-day max
JOB-YYYYMMDD-NNN sequence ONCE under a transaction-scoped advisory lock,
then increments locally for each row. This avoids the per-row collision
retry loop the Python create path uses (which doesn't compose under a
shared transaction).

Input:
    p_company_id UUID
    p_user_id    UUID  (created_by)
    p_jobs       JSONB array, each element shaped:
        {
            address_line1 (required),
            city, state, zip,             -- defaults: ''
            customer_name, customer_phone,
            loss_type,                    -- default: 'water'
            status,                       -- default: 'new'
            job_type                      -- default: 'mitigation'
        }

Output:
    JSONB { "created": <int>, "jobs": [ { id, job_number }, ... ] }

Errors:
    - p_jobs NULL/empty                -> 22023 'p_jobs is required and non-empty'
    - p_jobs length > 10               -> 22023 'Batch size exceeds 10'
    - any per-row CHECK / FK violation -> the underlying postgres errcode
      bubbles up; the entire transaction rolls back.

Revision ID: 01i_a6_jobs_batch
Revises: 01i_a5_extend_onboard
Create Date: 2026-04-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "01i_a6_jobs_batch"
down_revision: str | None = "01i_a5_extend_onboard"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION rpc_create_jobs_batch(
    p_company_id UUID,
    p_user_id UUID,
    p_jobs JSONB
) RETURNS JSONB AS $$
DECLARE
    v_count INT;
    v_today TEXT;
    v_prefix TEXT;
    v_max_seq INT;
    v_seq INT;
    v_job_spec JSONB;
    v_address_line1 TEXT;
    v_city TEXT;
    v_state TEXT;
    v_zip TEXT;
    v_loss_type TEXT;
    v_status TEXT;
    v_job_type TEXT;
    v_property_id UUID;
    v_new_job_id UUID;
    v_new_job_number TEXT;
    v_results JSONB := '[]'::JSONB;
BEGIN
    IF p_jobs IS NULL OR jsonb_typeof(p_jobs) <> 'array' THEN
        RAISE EXCEPTION 'p_jobs is required and must be a JSON array'
              USING ERRCODE = '22023';
    END IF;

    v_count := jsonb_array_length(p_jobs);
    IF v_count = 0 THEN
        RAISE EXCEPTION 'p_jobs is required and non-empty'
              USING ERRCODE = '22023';
    END IF;

    IF v_count > 10 THEN
        RAISE EXCEPTION 'Batch size exceeds 10'
              USING ERRCODE = '22023';
    END IF;

    -- Lock the per-(company, day) namespace for job_number generation so
    -- two concurrent batches against the same company today can't both
    -- read the same v_max_seq and collide. Transaction-scoped — released
    -- at COMMIT/ROLLBACK.
    PERFORM pg_advisory_xact_lock(
        hashtext(p_company_id::TEXT || ':' ||
                 to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD'))
    );

    v_today := to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD');
    v_prefix := 'JOB-' || v_today || '-';

    -- Find the current max sequence for today within this company.
    -- regexp_substr captures the trailing NNN; NULL -> 0.
    SELECT COALESCE(MAX((regexp_match(job_number, '-(\\d+)$'))[1]::INT), 0)
      INTO v_max_seq
      FROM jobs
     WHERE company_id = p_company_id
       AND job_number LIKE v_prefix || '%';

    v_seq := v_max_seq;

    FOR i IN 0 .. v_count - 1 LOOP
        v_job_spec := p_jobs -> i;

        v_address_line1 := v_job_spec ->> 'address_line1';
        IF v_address_line1 IS NULL OR length(btrim(v_address_line1)) = 0 THEN
            RAISE EXCEPTION 'jobs[%].address_line1 is required', i
                  USING ERRCODE = '22023';
        END IF;

        v_city      := COALESCE(v_job_spec ->> 'city', '');
        v_state     := COALESCE(v_job_spec ->> 'state', '');
        v_zip       := COALESCE(v_job_spec ->> 'zip', '');
        v_loss_type := COALESCE(v_job_spec ->> 'loss_type', 'water');
        v_status    := COALESCE(v_job_spec ->> 'status', 'new');
        v_job_type  := COALESCE(v_job_spec ->> 'job_type', 'mitigation');

        -- Resolve or create property for this address (mirrors
        -- ensure_job_property's dedup logic). Skip if address+city+state+zip
        -- doesn't match an existing row — insert a new property row.
        SELECT id INTO v_property_id
          FROM properties
         WHERE company_id = p_company_id
           AND lower(btrim(address_line1)) = lower(btrim(v_address_line1))
           AND lower(btrim(city))          = lower(btrim(v_city))
           AND state                        = v_state
           AND btrim(zip)                  = btrim(v_zip)
           AND deleted_at IS NULL
         LIMIT 1;

        IF v_property_id IS NULL THEN
            INSERT INTO properties (
                company_id, address_line1, city, state, zip
            ) VALUES (
                p_company_id, v_address_line1, v_city, v_state, v_zip
            )
            RETURNING id INTO v_property_id;
        END IF;

        v_seq := v_seq + 1;
        v_new_job_number := v_prefix || lpad(v_seq::TEXT, 3, '0');

        INSERT INTO jobs (
            company_id, job_number, address_line1, city, state, zip,
            loss_type, status, job_type, created_by, property_id,
            customer_name, customer_phone
        ) VALUES (
            p_company_id, v_new_job_number, v_address_line1, v_city, v_state, v_zip,
            v_loss_type, v_status, v_job_type, p_user_id, v_property_id,
            v_job_spec ->> 'customer_name',
            v_job_spec ->> 'customer_phone'
        )
        RETURNING id INTO v_new_job_id;

        INSERT INTO event_history (company_id, job_id, event_type, user_id, event_data)
        VALUES (p_company_id, v_new_job_id, 'job_created', p_user_id,
                jsonb_build_object('job_number', v_new_job_number, 'batch', true));

        v_results := v_results || jsonb_build_object(
            'job_id', v_new_job_id,
            'job_number', v_new_job_number
        );
    END LOOP;

    RETURN jsonb_build_object(
        'created', v_count,
        'jobs', v_results
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION rpc_create_jobs_batch(UUID, UUID, JSONB)
    TO authenticated, service_role;
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS rpc_create_jobs_batch(UUID, UUID, JSONB);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
