"""Spec 01H PR10 round-2 (R9): ensure_job_property RPC + address unique index.

``create_floor_plan_by_job_endpoint`` auto-links a property to a legacy job
whose ``property_id`` is NULL. Round-1 implementation did this in three
separate writes:

1. SELECT job.property_id (observed NULL)
2. INSERT a new properties row (address copied from the job)
3. UPDATE jobs SET property_id = new_property_id

Two concurrent first-saves on the same job (mobile double-tap, two tabs,
retry-happy client) both enter step 1 with NULL, both INSERT a fresh
properties row at step 2, both UPDATE the job at step 3. Last writer wins;
the losing property row is orphaned and the losing floor-plan create runs
against a property the job no longer points at.

This migration replaces that sequence with a single SECURITY DEFINER plpgsql
function that:

* derives the caller's company from the JWT (``get_my_company_id()``) — same
  pattern as the R3 RPC hardening;
* ``SELECT ... FOR UPDATE`` on the jobs row so the second concurrent caller
  blocks until the first commits;
* if ``jobs.property_id`` is already set when the lock is acquired, returns
  it (idempotent on retry);
* otherwise searches for an existing same-company property at the same
  address (``lower(btrim(...))`` on address_line1/city, state, zip) and
  reuses it if present — deduplicates address collisions across the whole
  ``properties`` table, not just this race;
* only if no match exists does it INSERT a new properties row;
* UPDATEs ``jobs.property_id`` and RETURNs the resolved id.

Paired with a partial unique index on the normalized address fields as
defense-in-depth: if any future code path bypasses this RPC, the DB refuses
to create a duplicate.

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-04-22
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e9f0a1b2c3d4"
down_revision: str | None = "d8e9f0a1b2c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ---------------------------------------------------------------------------
-- Partial unique address index (defense in depth). Matches the RPC's search
-- predicate so ON CONFLICT / FOR UPDATE retries are consistent. Lowered +
-- trimmed to dedup "123 Main St" vs "123 main st" vs "123 Main St  ".
-- Skipped when deleted_at is set so soft-deleted rows don't block recreation.
-- Spec 01H decision #2 (pre-launch, no prod data) means no dedup backfill
-- is required — this statement would fail on a table that already has
-- duplicates, which is the intended behavior (surface the data issue).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_address_active
    ON properties (
        company_id,
        lower(btrim(address_line1)),
        lower(btrim(city)),
        state,
        btrim(zip)
    )
    WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------------
-- ensure_job_property(p_job_id) RETURNS UUID
-- Atomic auto-link RPC. See module docstring for rationale.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_job_property(
    p_job_id UUID
) RETURNS UUID AS $$
DECLARE
    v_caller_company UUID;
    v_job            RECORD;
    v_property_id    UUID;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id is required';
    END IF;

    -- R3 pattern: derive the caller's company from the JWT, never trust a
    -- caller-supplied tenant id. SECURITY DEFINER bypasses RLS so this is
    -- the only tenant guard.
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;

    -- Lock the jobs row so concurrent callers serialize behind us. The
    -- second caller blocks on this statement until we COMMIT, then sees
    -- jobs.property_id already set and returns it idempotently.
    -- jobs only has address_line1 (no address_line2); properties carries both,
    -- so the INSERT below leaves address_line2 NULL for auto-linked rows.
    SELECT id, property_id, address_line1,
           city, state, zip, latitude, longitude, company_id, deleted_at
      INTO v_job
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or does not belong to the caller company';
    END IF;

    -- Idempotent fast path: if the row already has a property_id (either
    -- set pre-call, or set by a concurrent caller we blocked behind),
    -- return it without touching anything else.
    IF v_job.property_id IS NOT NULL THEN
        RETURN v_job.property_id;
    END IF;

    -- Reuse an existing same-address property when one exists. This is both
    -- the coordination mechanism for races that raced past the lock (e.g.
    -- two different job rows at the same address) AND a product-correctness
    -- win: one property per (company, address). Floor-plan versions are
    -- keyed by property, so collapsing duplicates means reopen-the-address
    -- jobs share the floor-plan history.
    SELECT id INTO v_property_id
      FROM properties
     WHERE company_id = v_caller_company
       AND lower(btrim(address_line1)) = lower(btrim(v_job.address_line1))
       AND lower(btrim(city))          = lower(btrim(v_job.city))
       AND state                        = v_job.state
       AND btrim(zip)                  = btrim(v_job.zip)
       AND deleted_at IS NULL
     LIMIT 1;

    IF v_property_id IS NULL THEN
        -- No existing match — insert. The partial unique index above
        -- enforces the dedup invariant even if a concurrent caller snuck
        -- a row in between our SELECT and INSERT (which the FOR UPDATE
        -- lock on jobs prevents for this specific job, but not for
        -- same-address inserts from unrelated jobs). On a 23505 the
        -- transaction retries naturally via the caller.
        INSERT INTO properties (
            company_id, address_line1, city, state, zip,
            latitude, longitude
        ) VALUES (
            v_caller_company, v_job.address_line1,
            v_job.city, v_job.state, v_job.zip,
            v_job.latitude, v_job.longitude
        )
        RETURNING id INTO v_property_id;
    END IF;

    -- Link the job to the resolved property. Scoped by company_id belt-and-
    -- suspenders (the FOR UPDATE already guarantees row identity).
    UPDATE jobs
       SET property_id = v_property_id
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    RETURN v_property_id;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION ensure_job_property(UUID) TO authenticated, service_role;
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS ensure_job_property(UUID);
DROP INDEX IF EXISTS idx_properties_address_active;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
