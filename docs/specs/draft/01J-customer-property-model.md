# Spec 01J: Customer–Property Data Model — Foundation

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% |
| **State** | Draft |
| **Blocker** | None — all dependent tables (companies, users, jobs, properties) live |
| **Branch** | TBD |
| **Issue** | [CREW-11](https://linear.app/crewmatic/issue/CREW-11) |
| **Depends on** | 01-jobs (implemented), 00-bootstrap (implemented) |
| **Blocks** | CREW-13 (autocomplete consumes customer search), 08 Portals (customer-portal auth uses `customers.id`), follow-up specs 01K (Property Detail Page), 01L (Convert to Reconstruction), 01M (Merge tooling) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-16 |
| Re-scoped | 2026-04-28 (narrowed from 4 phases to CREW-11 foundation only; entity_name added) |
| Reviewed | 2026-04-28 (parallel expert review: backend-architect, security-auditor, code-reviewer; 6 critical fixes applied to schema + API + RLS + share-link projection) |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Reference
- **Brett's product spec:** [`docs/research/property-data-model-spec-v1.pdf`](../../research/property-data-model-spec-v1.pdf) — "Property-Level Data Model — Product Specification v1.0" (April 15, 2026)
- **Linear:**
  - [CREW-11](https://linear.app/crewmatic/issue/CREW-11) — this spec
  - [CREW-13](https://linear.app/crewmatic/issue/CREW-13) — fuzzy autocomplete (consumes the customer + property tables this spec lands)
- **Cross-references:**
  - 01-jobs (implemented) — `jobs` and `properties` tables live; this spec drops the denormalized `jobs.customer_*` columns
  - 01H Floor Plan v2 (draft) — already property-anchored; no changes here
  - 08 Portals (draft) — customer-portal login keys off `customers.id`

---

## Summary

Promote `customer` from three denormalized columns on `jobs` to a first-class, multi-tenant entity. Wire properties and jobs to the new entity through nullable/required FKs. This is the foundational data-model change that unblocks repeat-customer detection, customer portal logins, and the Property Detail Page (in a follow-up spec).

Three concrete moves:

1. **New `customers` table** — company-scoped, with optional `entity_name` for LLC / property-management overlay. Phone is the dedup key.
2. **`properties.customer_id`** — nullable FK marking the property's default owner. Powers pre-fill on new-job creation and onboarding flows that capture a property without an active job.
3. **`jobs.customer_id` (required) + drop the denormalized `jobs.customer_*` columns** — clean cut, pre-launch, no production data. Each job records explicitly *who paid for this work*, which scales cleanly to multi-trade (plumbing tenant pays, HVAC landlord pays).

The customer↔property M:N relationship is **derived through jobs + the property's default-owner pointer**. No explicit join table.

---

## What Already Exists (Do Not Duplicate)

| Component | Status | Notes |
|-----------|--------|-------|
| `properties` table | ✅ Live (migration `ca59c5bf87c9`) | `usps_standardized`, `year_built`, `property_type`, `total_sqft`, `deleted_at`. Unique partial index on `(company_id, usps_standardized)`. |
| Properties CRUD API | ✅ Live (`backend/api/properties/`) | 5 endpoints with address-based dedup. |
| `jobs.property_id` FK | ✅ Live | Currently nullable; will stay nullable in this spec. Address-driven auto-create on job POST is **removed** here (frontend orchestrates pick-or-create). |
| `get_my_company_id()` RLS helper | ✅ Live (00-bootstrap) | Reused for `customers` policies. |
| `pg_trgm` extension | ⚠️ Not installed | This spec installs it for fuzzy autocomplete. |
| `update_updated_at()` trigger fn | ✅ Live | Reused on `customers`. |

---

## Done When

### Schema
- [ ] `customers` table created with: `id`, `company_id`, `name`, `entity_name` (optional), `phone`, `email`, `customer_type`, `notes`, `deleted_at`, `created_at`, `updated_at`
- [ ] Phone CHECK constraint enforces shape (`^\+[0-9]{10,15}$`) when non-null. Note: this is a coarse shape guard; `phonenumbers.parse()` at the API layer is the real validity check (E.164 country-code semantics).
- [ ] `customer_type` CHECK enum: `individual`, `commercial`
- [ ] `notes` CHECK constraint: `length(notes) <= 10000`
- [ ] `name` CHECK constraint: `length(trim(name)) > 0` (no whitespace-only names)
- [ ] `jobs.customer_id` FK uses `ON DELETE RESTRICT` (the column is `NOT NULL`; SET NULL would silently downgrade to RESTRICT)
- [ ] `properties.customer_id` FK uses `ON DELETE SET NULL` (the column is nullable)
- [ ] Unique partial index on `(company_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL`
- [ ] B-tree indexes on `(company_id, name)`, `(company_id, entity_name)`, `(company_id, email)` (partial where applicable)
- [ ] `pg_trgm` extension installed; GIN trigram indexes on `name` and `entity_name` for fuzzy autocomplete
- [ ] RLS enabled with per-operation policies (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) using `get_my_company_id()`
- [ ] `DELETE` policy is `USING (false)` — service role only
- [ ] `updated_at` trigger
- [ ] `properties.customer_id` FK added (nullable, `ON DELETE SET NULL`)
- [ ] Index on `properties(customer_id) WHERE customer_id IS NOT NULL`
- [ ] `jobs.customer_id` FK added (nullable initially; `NOT NULL` after wipe)
- [ ] Index on `jobs(customer_id) WHERE deleted_at IS NULL AND customer_id IS NOT NULL`
- [ ] **Pre-deploy cleanup is manual** (no `TRUNCATE` in migration SQL). Operator runs `DELETE FROM jobs;` via Supabase SQL Editor before the migration deploys; FK cascades clean up `job_rooms`, `floor_plans`, `photos`, `moisture_readings`, `event_history`, etc. The migration's Python `upgrade()` starts with a row-count guard that raises `RuntimeError` if jobs has rows.
- [ ] `jobs.customer_name`, `jobs.customer_phone`, `jobs.customer_email` columns dropped
- [ ] `jobs.customer_id` set `NOT NULL`
- [ ] `jobs.property_id` set `NOT NULL` (was nullable from 01-jobs migration; safe now because we're removing the auto-create-property behavior + post-TRUNCATE there are no rows)
- [ ] `phonenumbers` library added to `backend/pyproject.toml` (not currently installed)

### Backend
- [ ] New module `backend/api/customers/` with `router.py`, `service.py`, `schemas.py` (mirrors `backend/api/properties/` shape)
- [ ] All Pydantic schemas use `model_config = ConfigDict(extra="forbid")`; body fields exclude `id`, `company_id`, `created_at`, `updated_at`, `deleted_at`
- [ ] Pydantic field constraints applied per the constraints table (max_lengths on `name`/`entity_name`/`phone`/`email`/`notes`)
- [ ] `POST /v1/customers` — create. Dedup uses **authenticated client** (RLS-scoped). On phone collision returns `409 CUSTOMER_DUPLICATE_PHONE` with whitelisted body `CustomerDuplicateResponse { id, name, entity_name, customer_type, phone }`
- [ ] `GET /v1/customers` — list with pagination + multi-field search via input-shape dispatch (Decision #18). Response items exclude `phone`, `email`, `notes` (Decision #20)
- [ ] `GET /v1/customers/{id}` — returns full customer payload plus aggregate counts (`property_count`, `job_count`) via two `count="exact"` queries on authenticated client
- [ ] `PATCH /v1/customers/{id}` — update. Phone normalization runs first; uniqueness re-checked only when normalized phone differs from current
- [ ] `DELETE /v1/customers/{id}` — soft delete via `get_supabase_admin_client()` with explicit `{"deleted_at": now}` payload only. **Pre-flight**: returns `409 CUSTOMER_HAS_DEPENDENTS` if any non-soft-deleted property OR job references this customer
- [ ] Phone normalization helper added at `api/shared/phone.py` using `phonenumbers>=8.13.0,<9` (added to `pyproject.toml`)
- [ ] `POST /v1/properties` accepts optional `customer_id`; service pre-fetches the customer via authenticated client → 0 rows = `404 CUSTOMER_NOT_FOUND`
- [ ] `PATCH /v1/properties/{id}` accepts `customer_id`; admin role required for ALL `customer_id` changes (Decision #13). Cross-company validation as above. Logs `property_owner_changed` event with `{old_customer_id, new_customer_id}`
- [ ] `GET /v1/properties` and `GET /v1/properties/{id}` response shape includes nested `customer` object (null when unset)
- [ ] `POST /v1/jobs` body **requires** `customer_id` AND `property_id`; pre-fetches both via authenticated client; 0 rows on either = 404 with the appropriate error code
- [ ] `POST /v1/jobs` no longer auto-creates property from inline address fields (those body fields removed via `extra="forbid"`)
- [ ] `GET /v1/jobs` and `GET /v1/jobs/{id}` response shapes drop the three `customer_*` fields and add nested `customer` + `property` objects
- [ ] Adjuster share-link endpoint updated: customer SELECT projects ONLY `id, name, entity_name, customer_type` (Decision #19) — `phone`, `email`, `notes` never enter process memory for adjuster scope
- [ ] `log_event` calls added for: `customer_created`, `customer_updated`, `customer_deleted`, `customer_dedup_collision` (phone-enumeration probe detection), `property_owner_changed` (with old + new customer ids)

### Frontend (minimal scope here; full UI lands with CREW-13)
- [ ] TypeScript types: `Customer`, `CustomerCreate`, `CustomerUpdate`, `CustomerListResponse` in `web/src/lib/types.ts`
- [ ] React Query hooks: `useCustomer`, `useCustomers`, `useCreateCustomer`, `useUpdateCustomer`, `useDeleteCustomer` in `web/src/lib/hooks/use-customers.ts`
- [ ] Updated `Job` type drops `customer_name/phone/email`, adds nested `customer` + `property`
- [ ] Updated `Property` type adds optional nested `customer`
- [ ] Existing job-list and job-detail screens read customer via `job.customer.name` instead of `job.customer_name`
- [ ] **No new pages or pickers** — the pick-or-create UX ships in CREW-13

### Tests
- [ ] Backend tests listed in [Testing Requirements](#testing-requirements) below — all passing
- [ ] Frontend type tests updated (existing `web/src/lib/__tests__/types.test.ts`) — passing
- [ ] Existing job/property/share-link tests updated for new shape — passing

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Customer is a standalone first-class entity (own table) | Required to scale: repeat-customer autocomplete, customer-portal login (Spec 08), one-customer-many-properties for landlords/property managers, multi-trade attribution. |
| 2 | Customer↔property relationship is M:N **derived through jobs** + a `properties.customer_id` default-owner pointer. No explicit `customer_properties` join table | Two scaling layers (each job records *who paid*, properties have a *default owner*) cover the use cases without join-table complexity. Adding M:N later is non-breaking. |
| 3 | Each job records its own `customer_id` (required FK) | ServiceTitan / Salesforce-style attribution. Multi-trade scenarios — plumbing tenant pays, HVAC landlord pays — are correctly attributed without rewriting property ownership. Property-sold-mid-job preserves historical truth. |
| 4 | `properties.customer_id` is **nullable** | Allows lead-capture / portfolio-import flows to create a property before any job exists, and tolerates "address known, owner unknown" data. |
| 5 | `customers.entity_name` is an **optional column** rather than a separate `customer_contacts` sub-table | Pragmatic V1 compromise: covers the common "Sarah Johnson @ ABC Property Management" pattern without the complexity of a contacts table. Migration to a proper contacts model in V2 (when commercial scale demands it) is clean: each existing customer becomes the primary contact of a newly-created entity. |
| 6 | Phone is the unique key (DB constraint), partial index excludes NULL + soft-deleted | Phone is the most stable identifier in restoration. Email is too often blank to be a useful unique key. Allows "John Smith without phone yet" + "John Smith with phone +15555551234" to coexist as different rows until phone is filled in. |
| 7 | Phones stored E.164-normalized at write time | Without normalization, dedup breaks across UI variants (`(555) 555-1234` vs `555.555.1234`). UI displays formatted; DB stores `+15555551234`. CHECK constraint enforces format defensively. |
| 8 | Multi-field fuzzy autocomplete via `pg_trgm` (similarity ≥ 0.4) on name + entity_name; prefix on phone digits; ilike on email | Built into Supabase Postgres. Threshold tuned during implementation. Lets a tech start typing any field and find the customer. |
| 9 | API contract for new-job creation is **clean / FK-only**: frontend orchestrates pick-or-create across `POST /v1/customers` + `POST /v1/properties` + `POST /v1/jobs` | Each endpoint has one responsibility; errors are localized; transactional resolve-or-create complexity stays out of the backend. Trade-off: up to 3 round-trips for a brand-new customer + property + job. Acceptable for V1. If offline mode demands batch create later, ship a `POST /v1/jobs/quick-create` endpoint without rewriting this one. |
| 10 | Removal of inline customer/address fields on `POST /v1/jobs` (including the existing auto-create-property-from-address behavior) | Pre-launch, no production data, no migration cost. Frontend takes responsibility for resolving FKs explicitly — which it must do anyway to power the autocomplete UX. |
| 11 | Pre-deploy cleanup of `jobs` is **manual operator action**, NOT in the migration SQL. Migration starts with a Python `upgrade()` row-count guard that raises if `jobs` has any non-soft-deleted rows. Operator runs `DELETE FROM jobs;` in Supabase SQL Editor before deploy; FK cascades handle dependents. | Putting `TRUNCATE` in committed SQL is a footgun — fresh-DB deployments, downgrade-and-reapply, and DR scenarios would re-execute it. Manual cleanup + safety guard is operator-controlled, idempotent on empty DBs, and fails loud (not silent) if you forget. |
| 12 | Soft-delete only (sets `deleted_at`). FK actions: `properties.customer_id` is `ON DELETE SET NULL` (it's nullable). `jobs.customer_id` is `ON DELETE RESTRICT` (it's `NOT NULL` — `SET NULL` would be silently downgraded to RESTRICT anyway). `properties.customer_id` and `jobs.customer_id` reference customers' `id`. | Hard-delete a referenced customer should fail loudly, not corrupt jobs. Soft-delete is the only operationally legal delete path. |
| 13 | "Change Owner" / changing `properties.customer_id` post-creation requires **admin role for any value change** — initial null→value, value→null, value→value. No TOCTOU race window because the role gate is uniform. | Simpler than etag-based optimistic concurrency. Property ownership is rare enough that "admin only" matches mental model. |
| 14 | Customer search endpoint is **bundled into this spec** (Phase 1) | Without search, the customer entity is unusable from any UI. Required for both CREW-11 (CRUD callable from API) and CREW-13 (autocomplete). |
| 15 | **Soft-deleting a customer is blocked if any non-soft-deleted property OR job references it.** Returns 409 with `{ blocked_by: { property_count, job_count } }`. Forces explicit re-assignment first. | Avoids the "RLS hides the customer; nested payload silently nulls" foot-gun. Keeps history queryable: jobs/properties never reference an invisible customer. UX pushes the user to "reassign owner" before deleting, which is the right mental model. |
| 16 | **Cross-company FK validation is enforced at the application layer**, not relied on through RLS. Postgres FK constraints execute as the constraint owner and bypass RLS, so an authenticated user could otherwise insert/patch a property or job pointing at another company's `customer_id` (silent corruption). Service layer fetches the referenced customer via the user-scoped client; 0 rows → `404 CUSTOMER_NOT_FOUND` (not 422). Same for `property_id` on jobs. | Defense in depth. RLS alone is insufficient for FK validation. |
| 17 | Pydantic schemas use `model_config = ConfigDict(extra="forbid")`. Body fields exclude `id`, `company_id`, `created_at`, `updated_at`, `deleted_at`. `company_id` is always derived from the auth context. | Prevents mass-assignment + accidental undelete via PATCH with `deleted_at: null`. |
| 18 | Multi-field search disambiguation: input shape decides the matcher. Starts with `+` or contains 7+ digits → phone prefix match (digits-only normalize). Contains `@` → email `ilike`. Else → `pg_trgm similarity ≥ 0.4` on `name OR entity_name`. Single endpoint, deterministic dispatch. | Clear contract. Two engineers can't implement it differently. |
| 19 | Adjuster share-link projects an explicit column whitelist on customers: `id, name, entity_name, customer_type` only. `phone`, `email`, `notes` are **never SELECTed** for adjuster-scope share endpoints. Pre-fetch redaction, not post-fetch masking. | Closes the "PII in process memory + risk of new field leaking later" failure mode. |
| 20 | `customers.notes`, `customers.email`, `customers.phone`, `customers.entity_name` excluded from `GET /v1/customers` list endpoint response. Returned only by `GET /v1/customers/{id}`. List endpoint returns `{ id, name, entity_name, customer_type, property_count_summary }`. | Reduces enumeration surface. Notes can contain operator-sensitive content. |
| 21 | Add denormalized `properties.last_activity_at TIMESTAMPTZ` column with trigger updating from job mutations. Used by 01L's properties + customers list views to sort by recent activity without N+1 aggregation queries. | Pre-launch + cheap to add now. Retrofitting later means computing `MAX(jobs.created_at)` per property at list time → N+1 hell at scale. Trigger updates on insert/update/soft-delete of jobs. |

---

## Database Schema

Single Alembic revision. Order matters within `upgrade()`.

```sql
-- ============================================================================
-- 1. Extension for fuzzy autocomplete
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 2. customers table (NEW)
-- ============================================================================
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
    entity_name     TEXT,
    phone           TEXT CHECK (phone IS NULL OR phone ~ '^\+[0-9]{10,15}$'),
    email           TEXT,
    customer_type   TEXT NOT NULL DEFAULT 'individual'
                    CHECK (customer_type IN ('individual', 'commercial')),
    notes           TEXT CHECK (notes IS NULL OR length(notes) <= 10000),
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phone dedup (partial: NULL phones don't conflict, soft-deleted rows free their phone)
CREATE UNIQUE INDEX idx_customers_company_phone_active
    ON customers(company_id, phone)
    WHERE phone IS NOT NULL AND deleted_at IS NULL;

-- B-tree indexes for direct lookups
CREATE INDEX idx_customers_company_name_active
    ON customers(company_id, name)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_customers_company_entity_active
    ON customers(company_id, entity_name)
    WHERE entity_name IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_customers_company_email_active
    ON customers(company_id, email)
    WHERE email IS NOT NULL AND deleted_at IS NULL;

-- Trigram indexes for fuzzy autocomplete
CREATE INDEX idx_customers_name_trgm
    ON customers USING gin (name gin_trgm_ops)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_customers_entity_trgm
    ON customers USING gin (entity_name gin_trgm_ops)
    WHERE entity_name IS NOT NULL AND deleted_at IS NULL;

-- updated_at trigger (reuses existing fn)
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS (per-operation; matches 00-bootstrap pattern)
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select" ON customers
    FOR SELECT USING (
        deleted_at IS NULL
        AND company_id = get_my_company_id()
    );

CREATE POLICY "customers_insert" ON customers
    FOR INSERT WITH CHECK (
        company_id = get_my_company_id()
    );

CREATE POLICY "customers_update" ON customers
    FOR UPDATE USING (
        deleted_at IS NULL
        AND company_id = get_my_company_id()
    ) WITH CHECK (
        company_id = get_my_company_id()
    );

CREATE POLICY "customers_delete" ON customers
    FOR DELETE USING (false);  -- service-role only (used for soft-delete writes)

-- ============================================================================
-- 3. properties.customer_id (default owner pointer)
-- ============================================================================
ALTER TABLE properties
    ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX idx_properties_customer
    ON properties(customer_id)
    WHERE customer_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================================================
-- 4. (No TRUNCATE in this migration SQL. Operator clears jobs manually before
--    `alembic upgrade head` runs — via Supabase SQL Editor: DELETE FROM jobs;
--    A Python row-count guard at the top of upgrade() refuses to run if jobs
--    has any non-soft-deleted rows. See Decision #11 + the impl plan's
--    "Pre-deploy procedure" section.)
-- ============================================================================

-- ============================================================================
-- 5. Drop denormalized columns from jobs
-- ============================================================================
ALTER TABLE jobs DROP COLUMN customer_name;
ALTER TABLE jobs DROP COLUMN customer_phone;
ALTER TABLE jobs DROP COLUMN customer_email;

-- ============================================================================
-- 6. jobs.customer_id (required FK; ON DELETE RESTRICT)
-- ============================================================================
-- RESTRICT (not SET NULL): the column is NOT NULL, so SET NULL would
-- silently downgrade to RESTRICT anyway. Explicit RESTRICT is honest about
-- intent: hard-delete of a referenced customer must fail loudly.
ALTER TABLE jobs
    ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;

-- After manual cleanup the table is empty; safe to require immediately.
-- (If the safety guard didn't catch a populated table, this ALTER fails clearly.)
ALTER TABLE jobs ALTER COLUMN customer_id SET NOT NULL;

CREATE INDEX idx_jobs_customer
    ON jobs(customer_id)
    WHERE deleted_at IS NULL;

-- ============================================================================
-- 7. Tighten jobs.property_id to NOT NULL
-- ============================================================================
-- Was added nullable in 01-jobs migration to support the auto-create-property
-- behavior. That behavior is removed in this spec (frontend orchestrates
-- pick-or-create explicitly). Post-cleanup the table is empty so the
-- constraint applies cleanly; if rows somehow exist, this ALTER fails loud.
ALTER TABLE jobs ALTER COLUMN property_id SET NOT NULL;

-- ============================================================================
-- 8. properties.last_activity_at + trigger (Decision #21)
-- ============================================================================
ALTER TABLE properties
    ADD COLUMN last_activity_at TIMESTAMPTZ;

CREATE INDEX idx_properties_company_last_activity
    ON properties(company_id, last_activity_at DESC NULLS LAST)
    WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION update_property_last_activity()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.property_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
        UPDATE properties
        SET last_activity_at = GREATEST(
            COALESCE(last_activity_at, NEW.updated_at),
            NEW.updated_at
        )
        WHERE id = NEW.property_id;
    END IF;

    -- Property reassigned: recompute old property's last_activity from remaining jobs
    IF TG_OP = 'UPDATE'
       AND OLD.property_id IS DISTINCT FROM NEW.property_id
       AND OLD.property_id IS NOT NULL THEN
        UPDATE properties p
        SET last_activity_at = (
            SELECT MAX(j.updated_at) FROM jobs j
            WHERE j.property_id = p.id AND j.deleted_at IS NULL
        )
        WHERE p.id = OLD.property_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jobs_update_property_activity
    AFTER INSERT OR UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_property_last_activity();
```

`downgrade()` is the inverse: drop indexes, drop FK columns, recreate the three `customers_*` columns on `jobs` (no data restoration — pre-launch), drop the `customers` table, drop the trigram extension if no other table uses it (skip if uncertain).

---

## API Endpoints

### Customers (new — `backend/api/customers/`)

| Method | Endpoint | Role | Behavior |
|--------|----------|------|----------|
| `POST` | `/v1/customers` | Member | Create. Pydantic schema uses `extra="forbid"` and excludes `id`, `company_id`, `created_at`, `updated_at`, `deleted_at` (Decision #17). Dedup query uses the **authenticated client** (RLS-scoped — never admin client). Phone collision returns `409 CUSTOMER_DUPLICATE_PHONE` with body `CustomerDuplicateResponse { id, name, entity_name, customer_type, phone }` — explicit whitelist (no `notes`, no `email`, no timestamps). |
| `GET` | `/v1/customers` | Member | List + search. Query params: `search` (string), `customer_type`, `limit`, `offset`. Multi-field dispatch per Decision #18. Response items shape: `{ id, name, entity_name, customer_type }` only — `phone`, `email`, `notes` excluded from list per Decision #20. Response: `{ items, total }`. Search input passes through `sanitize_postgrest_search` (existing helper). |
| `GET` | `/v1/customers/{id}` | Member | Returns customer + `property_count` + `job_count`. Counts run as two separate `count="exact"` queries via the authenticated client (mirrors `list_properties` pattern). Full PII in this endpoint (the caller is authenticated and tenant-scoped). |
| `PATCH` | `/v1/customers/{id}` | Member | Update. Body schema mirrors create (`extra="forbid"`, no `deleted_at`). Phone is **normalized first** (E.164), then compared against current value — only re-runs uniqueness check when normalized phone actually differs from current. |
| `DELETE` | `/v1/customers/{id}` | Owner / Admin | Soft delete (sets `deleted_at`). Implemented via `get_supabase_admin_client()` with explicit `{"deleted_at": now}` payload only (mirrors `delete_property` at `backend/api/properties/service.py:245-281`). **Pre-flight check**: 0-count query for non-soft-deleted properties + non-soft-deleted jobs referencing this customer; if either > 0, returns `409 CUSTOMER_HAS_DEPENDENTS` with body `{ blocked_by: { property_count, job_count } }` per Decision #15. |

### Properties (extended — existing module)

| Endpoint | Change |
|----------|--------|
| `POST /v1/properties` | Body adds optional `customer_id`. **Cross-company validation** per Decision #16: service fetches customer via authenticated client first; 0 rows → `404 CUSTOMER_NOT_FOUND`. Do not rely on RLS to block FK assignment (Postgres FKs bypass RLS). |
| `PATCH /v1/properties/{id}` | Body accepts `customer_id`. Per Decision #13, **any change to `customer_id` post-creation requires admin role** (no member-can-set-when-null carve-out — eliminates TOCTOU). Cross-company validation as above. Logs `property_owner_changed` event with `{ old_customer_id, new_customer_id }`. |
| `GET /v1/properties` | Response items now include nested `customer` object (null when unset). |
| `GET /v1/properties/{id}` | Same — nested `customer` object. |

### Jobs (refactored — existing module)

| Endpoint | Change |
|----------|--------|
| `POST /v1/jobs` | Body **requires** `customer_id` and `property_id`. Removes inline `customer_name/phone/email` AND inline address fields (`address_line1/city/state/zip`) — those become read-only response fields populated via the joined property. **Cross-company FK validation** per Decision #16: pre-fetch both customer and property via authenticated client; 0 rows → `404 CUSTOMER_NOT_FOUND` / `404 PROPERTY_NOT_FOUND`. 422 only for missing or malformed FK fields. Pydantic uses `extra="forbid"`. |
| `PATCH /v1/jobs/{id}` | Body accepts `customer_id` and `property_id` (re-assignment). Same cross-company validation as POST. Drops the old `customer_*` body fields. |
| `GET /v1/jobs` / `GET /v1/jobs/{id}` | Response drops `customer_name/phone/email`. Adds nested `customer` (full PII for authenticated tenant member) and `property` objects. |
| Adjuster share-link endpoint | Redaction is **column-level projection**, not post-fetch masking. The share-link query SELECTs from customers ONLY: `id, name, entity_name, customer_type` (per Decision #19). `phone`, `email`, `notes` never enter the process — there's nothing to mask. Located in `backend/api/sharing/` (the existing share-link module — confirm path during implementation). Test asserts the raw service response object has no `phone`/`email`/`notes` keys, not just that the HTTP body masks them. |

### Phone normalization (shared helper)

Add `api/shared/phone.py`:
- `normalize_phone(raw: str) -> str` — accepts US/Canada freeform input, returns E.164 (`+15555551234`). Raises `AppException(422, INVALID_PHONE)` for unparseable input. Used in `customers.service` create/update.
- Library: `phonenumbers` (industry-standard). **Not currently installed** — add to `backend/pyproject.toml` pinned: `phonenumbers>=8.13.0,<9`.
- **Input length guard**: Pydantic `phone` field constrained to `max_length=64` BEFORE handing to `phonenumbers.parse()` — bounds parse-time worst case.

### Pydantic field constraints (defense in depth)

| Field | Type | Constraint |
|-------|------|------------|
| `name` | str | `min_length=1, max_length=200` |
| `entity_name` | `str \| None` | `max_length=200` |
| `phone` | `str \| None` | `max_length=64` (raw input); normalized before persistence |
| `email` | `str \| None` | `max_length=320` (RFC 5321), Pydantic `EmailStr` for shape |
| `customer_type` | `Literal["individual", "commercial"]` | enum-typed |
| `notes` | `str \| None` | `max_length=10000` (matches DB CHECK) |

---

## Frontend Impact (this spec)

**Out of scope here** (lands in CREW-13 + later specs):
- Customer picker / autocomplete component
- Property picker / autocomplete component
- New job creation flow rewire
- Property Detail Page
- Customer Detail Page

**In scope here** — type and hook plumbing only:
- `web/src/lib/types.ts` — `Customer`, `CustomerCreate`, `CustomerUpdate`, `CustomerListResponse`. Update `Job` to drop `customer_name/phone/email` and add nested `customer` + `property`. Update `Property` to add optional nested `customer`.
- `web/src/lib/hooks/use-customers.ts` — React Query hooks (mirror `use-properties.ts` shape).
- Existing screens that read `job.customer_name` etc. update to `job.customer.name` etc. (likely: dashboard, jobs list, job detail header). Compile errors will surface them all.

---

## Migration Plan

1. **Author the Alembic revision** with the SQL in [Database Schema](#database-schema). Single file under `backend/alembic/versions/`. The Python `upgrade()` opens with a row-count guard that raises `RuntimeError` if `jobs` has non-soft-deleted rows.
2. **Local dev**:
   - Run `DELETE FROM jobs;` in Supabase SQL Editor (or psql against local DB)
   - `alembic upgrade head` — guard passes, migration applies cleanly
   - Verify: tables created, indexes present, RLS policies enabled, triggers attached
   - Run `pytest backend/tests/`
3. **Staging**: same procedure — manual `DELETE FROM jobs;` first, then `alembic upgrade head`.
4. **Production**:
   - Operator opens Supabase Dashboard → SQL Editor → `DELETE FROM jobs;` (FK cascades clean dependents)
   - Push the Railway deploy (commit to `main`)
   - Railway pre-deploy hook runs `alembic upgrade head` — guard passes (0 rows), migration applies
   - **If operator forgot Step 4.1**: migration fails loud with `RuntimeError: jobs has N active rows...`. Production stays at old schema, no corruption. Operator runs cleanup, redeploys.
5. **Post-deploy verification**: smoke test the create-customer + create-property + create-job flow against staging via Postman/curl. Verify share-link redaction with a freshly-created adjuster share.

No automatic data wipe → no foot-gun on re-run / fresh-DB scenarios → no backfill, no dual-write window, no deprecation shim.

---

## Testing Requirements

### Backend (`pytest`)

**`tests/test_customers.py` (new)**
- `test_customer_create_happy_path`
- `test_customer_create_with_entity_name`
- `test_customer_create_minimal_no_phone_no_email`
- `test_customer_create_duplicate_email_succeeds` — email is informational, not a unique key
- `test_customer_create_rejects_extra_fields` — `extra="forbid"` blocks unknown fields
- `test_customer_create_rejects_company_id_from_body` — must come from auth context
- `test_customer_create_rejects_id_from_body` — id must be DB-generated
- `test_customer_create_notes_max_length` — 10001-char notes → 422
- `test_customer_create_name_blank_rejected` — whitespace-only name → 422 (DB CHECK + Pydantic min_length)
- `test_customer_phone_dedup_returns_409_with_existing` — second POST same phone same company; 409 body whitelist (id, name, entity_name, customer_type, phone — NO notes/email/timestamps)
- `test_customer_phone_dedup_excludes_soft_deleted` — deleted customer's phone is reusable
- `test_customer_phone_dedup_authenticated_client_only` — dedup query never uses admin client (verifies no cross-tenant phone-enumeration leak)
- `test_customer_phone_normalization` — `(555) 555-1234` → `+15555551234` stored
- `test_customer_phone_invalid_returns_422`
- `test_customer_phone_input_max_length_64` — 65-char raw phone rejected at Pydantic before phonenumbers parse
- `test_same_phone_across_two_companies_both_succeed` — partial unique scope is per company
- `test_customer_list_search_by_name_fuzzy` — pg_trgm match on `name`
- `test_customer_list_search_by_name_at_threshold_0_4` — boundary
- `test_customer_list_search_by_entity_name_fuzzy`
- `test_customer_list_search_by_phone_prefix` — input shape detection
- `test_customer_list_search_by_email_dispatched_on_at_sign` — input shape detection
- `test_customer_list_response_excludes_pii_fields` — list response has no `phone`, `email`, `notes`
- `test_customer_list_pagination`
- `test_customer_get_includes_property_and_job_counts`
- `test_customer_get_full_pii_for_authenticated_tenant_member`
- `test_customer_update_happy_path`
- `test_customer_update_rejects_deleted_at_from_body` — undelete bypass blocked
- `test_customer_update_phone_normalize_then_compare` — same number in different format does NOT trigger redundant uniqueness check
- `test_customer_update_phone_revalidates_uniqueness_on_actual_change`
- `test_customer_soft_delete_admin_only` — tech role 403, admin succeeds
- `test_customer_soft_delete_blocked_when_referenced_by_property` — 409 CUSTOMER_HAS_DEPENDENTS
- `test_customer_soft_delete_blocked_when_referenced_by_job` — 409 CUSTOMER_HAS_DEPENDENTS
- `test_customer_soft_delete_succeeds_when_no_active_dependents` — soft-deleted property/job don't block
- `test_customer_soft_delete_hides_from_list_and_get`
- `test_customer_hard_delete_blocked_via_authenticated_client` — RLS DELETE policy `USING (false)` enforced
- `test_customer_rls_cross_company_isolation`

**`tests/test_properties.py` (extended)**
- `test_property_create_with_customer_id`
- `test_property_create_with_customer_id_from_other_company_returns_404` — service pre-fetches via authenticated client; 0 rows → 404 (NOT silent FK assignment)
- `test_property_get_returns_nested_customer`
- `test_property_get_returns_null_customer_when_unset`
- `test_property_change_owner_admin_only_for_all_transitions` — tech 403 for null→value, value→null, value→value
- `test_property_change_owner_admin_succeeds`
- `test_property_change_owner_logs_event_with_old_and_new_ids`
- `test_property_patch_customer_id_from_other_company_returns_404` — cross-company silent corruption prevented

**`tests/test_jobs.py` (refactored)**
- `test_job_create_requires_customer_id` — missing → 422
- `test_job_create_requires_property_id` — missing → 422
- `test_job_create_rejects_inline_customer_fields` — old `customer_name` payload → 422 (extra forbidden)
- `test_job_create_rejects_inline_address_fields` — old `address_line1/city/state/zip` payload → 422
- `test_job_create_with_customer_id_from_other_company_returns_404`
- `test_job_create_with_property_id_from_other_company_returns_404`
- `test_job_create_response_includes_nested_customer_property`
- `test_job_list_response_drops_old_customer_columns`
- `test_job_update_can_reassign_customer_id`
- All existing job-create / job-list / job-detail tests updated for new payload + response shapes

**`tests/test_sharing.py` (extended)**
- `test_share_link_adjuster_response_omits_customer_pii_columns` — regression for `01-jobs.md:688`; raw service response object has no `phone`/`email`/`notes` keys (column-projection level enforcement, not post-fetch masking)
- `test_share_link_adjuster_includes_customer_name_and_entity_name` — adjuster sees who they're working for, just not contact details
- `test_share_link_adjuster_omits_customer_notes` — explicit guard against notes leaking

**`tests/test_phone_normalization.py` (new)**
- `test_normalize_phone_us_formats` — multiple input formats → same E.164
- `test_normalize_phone_invalid_raises`

### Frontend (`vitest`)

- `web/src/lib/__tests__/types.test.ts` — updated `Job` and `Property` and new `Customer` types compile + match expected shape
- `web/src/lib/hooks/__tests__/use-customers.test.tsx` (new) — query / mutation success cases

### E2E

Out of scope for this spec — no UI to drive. End-to-end customer-pick-or-create flow validated as part of CREW-13.

---

## Spec Interactions

| Spec | Interaction | Action Required |
|------|-------------|-----------------|
| 01-jobs (implemented) | `jobs.customer_*` columns dropped; share-link redaction path updated | Update share-link endpoint + fixtures + tests in this spec |
| 01H Floor Plan v2 (draft) | None — already property-anchored | None |
| CREW-13 (next) | Consumes `GET /v1/customers?search=` and existing `GET /v1/properties?search=` for autocomplete; may add a fuzzy-match property endpoint of its own | None — CREW-13 builds on this spec |
| 01K Property Detail Page (future) | Reads nested `customer` from property; "Change Owner" button calls `PATCH /v1/properties/{id}` with new `customer_id` | None — that spec extends UI on top of this one |
| 01L Convert to Reconstruction (future) | Inherits `customer_id` from source job + property | None — that spec adds `parent_job_id` and conversion endpoint |
| 08 Portals (future) | `customers.id` is the stable login key for customer portal | None — `customers.id` is a UUID, contract preserved |

---

## Out of Scope (Deferred to Follow-up Linear Issues)

The original 01J PRD covered four phases; this spec is **Phase 1 only**. Other phases are listed below for traceability — each is to become its own Linear issue + spec.

| Theme | New Linear Issue | New Spec File | One-liner |
|-------|------------------|---------------|-----------|
| **01K** — Property Detail + Customer Detail pages (symmetric pair) | TBD (`[V1] Property Data Model`) | `01K-detail-pages.md` (draft) | `/properties/[id]` with Sketch / Jobs / Photos / Notes tabs (+ `gate_code`, `key_location`, `access_notes` columns); `/customers/[id]` with the customer + their owned properties + latest-job summary per property; Properties + Customers nav tabs; "View Property" / "View Customer" links from job detail. |
| **01L** — Generalized job-clone pattern (covers Convert to Reconstruction) | TBD (`[V1] Jobs`) | `01L-job-clone.md` (draft) | Add `jobs.parent_job_id` (FK to source job, `ON DELETE RESTRICT`) + accept optional `clone_from_job_id` on `POST /v1/jobs`. When provided, backend copies `loss_date`, `claim_number`, `carrier`, `adjuster_*`, `loss_type/category/class/cause` from source unless body overrides. "Convert to Reconstruction" button is just a UI preset — no special endpoint. Partial unique index `(parent_job_id) WHERE job_type='reconstruction' AND deleted_at IS NULL` enforces idempotency for the reconstruction case specifically. |
| Address autocomplete + fuzzy match + write-time USPS canonicalization | **CREW-13** | extend in CREW-13's spec | Existing-property suggestion on new job address entry; phone/name autocomplete on new customer; tier-based fuzzy match (`pg_trgm` + abbreviation expansion, OR Smarty/USPS API for proper canonicalization). **Absorbs the "auto-correct address on save" concern** that originally motivated merge tooling. |
| `customer_contacts` sub-table for commercial | V2 | TBD | Multi-contact pattern (Sarah primary, Mike maintenance, Tom billing). Migration path: each existing customer becomes its entity's primary contact. |

When CREW-11 ships, file the **two** new Linear issues above (01K and 01L) so 01J's draft work isn't lost.

### Explicitly out — no Linear issue planned

- **Merge tooling for properties / customers**. Deduped at write-time instead: phone is unique per company (DB constraint, blocks customer dupes), and CREW-13's address autocomplete + write-time USPS canonicalization prevents property dupes from being created in the first place. The lifecycle gap merge would solve doesn't materialize if the prevention is good.

---

## Quick Resume (for next session)

**If resuming cold:**
1. Schema is the heart of the change — review the Database Schema section first.
2. Work in this order: schema migration → customers module backend → properties + jobs API extensions → frontend types → existing tests refactor → new tests.
3. **No TRUNCATE in migration SQL.** Operator clears jobs manually (`DELETE FROM jobs;` in Supabase SQL Editor) before `alembic upgrade head` runs. The Python guard at the top of upgrade() refuses if jobs has non-soft-deleted rows.
4. Phone normalization library: confirm `phonenumbers` is available in `pyproject.toml`; if not, `pip install phonenumbers`.

**Hot path questions:**
- **"Is CREW-13 (autocomplete UI) part of this spec?"** No. This spec lands the data model + CRUD APIs. CREW-13 builds the UI on top.
- **"Does this break the existing job-creation form?"** Yes — temporarily. The frontend forms will fail to compile when `Job.customer_name` is removed. Updates to those forms are part of this spec's frontend scope (mechanical type fixes), but the *new* customer / property pickers are CREW-13.
- **"What about reconstruction job linkage?"** Out of scope. `jobs.parent_job_id` and the conversion endpoint land in 01L (separate spec).
- **"Do customers have addresses?"** No. Address is a property concern. A customer is a person/entity; the property is the location.
- **"What if an entity (LLC) has multiple owners over time?"** V1 stores current owner only. History is implicit in jobs (each job carried `customer_id` at the time). V2 may add a `customer_history` audit trail.

---

## Session Log

_Populated as work progresses._

---

## Decisions Log

### 2026-04-28 — Eng review fixes (Decisions #15–#20 added; #12, #13 revised)

Parallel review by backend-architect, security-auditor, and code-reviewer surfaced these issues — all resolved with explicit decision rows:

1. **`jobs.customer_id` FK action contradiction** (backend-architect C1) — `ON DELETE SET NULL` + `NOT NULL` is a silent RESTRICT. Changed to explicit `ON DELETE RESTRICT`. Decision #12 revised.
2. **Soft-delete-then-hidden-customer footgun** (backend-architect W1, code-reviewer W6) — soft-deleting a customer would silently null nested customer payloads in jobs/properties via RLS. Decision #15 added: soft-delete is **blocked** when the customer is referenced by any non-deleted property or job (returns 409 with dependents counts).
3. **Cross-company FK assignment** (security-auditor C2, backend-architect W4) — Postgres FK constraints bypass RLS, allowing silent cross-tenant `customer_id` / `property_id` assignment. Decision #16 added: app layer fetches the referenced row via the authenticated client before insert/update; 0 rows → 404.
4. **Mass-assignment / undelete-via-PATCH** (security-auditor H4, H6) — Pydantic `extra="forbid"` mandated. Decision #17 added with explicit excluded fields.
5. **"Change Owner" TOCTOU race** (security-auditor H3, backend-architect W2) — earlier rule was "any member can set null→value, admin only for value→value." Race window. Decision #13 simplified: **admin role required for ALL `customer_id` mutations on PATCH** (initial and subsequent).
6. **Multi-field search ambiguity** (code-reviewer W3) — Decision #18 added: input-shape dispatch (digits → phone, `@` → email, else fuzzy on name + entity_name).
7. **Share-link PII leak surface** (security-auditor C3) — moved from post-fetch redaction to column-projection whitelist. Decision #19 added: adjuster-scope SELECT projects only `id, name, entity_name, customer_type` from customers.
8. **Notes / contact PII enumeration via list endpoint** (security-auditor M3, M6) — Decision #20 added: list endpoint excludes `phone`, `email`, `notes`. `notes` capped at 10000 chars by DB CHECK.
9. **`TRUNCATE jobs CASCADE` removed from migration entirely** (replaces backend-architect W3 / code-reviewer C3 concerns about cascade behavior). Decision #11 revised: cleanup is now manual operator action via Supabase SQL Editor before deploy; the migration's Python `upgrade()` starts with a row-count guard that raises if jobs has rows. Eliminates re-run / DR / fresh-DB footgun risk; preserves "fail loud, not silent" property.
10. **`phonenumbers` library version unpinned** (security-auditor M1) — pinned to `>=8.13.0,<9` + 64-char raw input cap.

15+ new tests added covering each of the above.

_Further decisions populated as work progresses during implementation._
