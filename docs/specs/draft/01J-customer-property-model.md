# Spec 01J: Customer–Property Model — Customer Entity, Property Detail Page, Convert to Reconstruction

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 phases) |
| **State** | Draft |
| **Blocker** | None — all foundational tables live (01-jobs implemented) |
| **Branch** | TBD |
| **Issue** | TBD |
| **Depends on** | 01-jobs (implemented), 01H Floor Plan V2 (draft — sketch-at-property), 01E Job Type Extensions (draft — dual-phase) |
| **Blocks** | 08 Portals (customer portal requires customer_id), full rollout of 01G Job Detail v2 |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-16 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Reference
- **Brett's spec:** [`docs/research/property-data-model-spec-v1.pdf`](../../research/property-data-model-spec-v1.pdf) — "Property-Level Data Model — Product Specification v1.0" (April 15, 2026)
- **Cross-references:**
  - 01H defines sketch-at-property + versioning (no changes needed here — this spec builds on that)
  - 01F currently creates jobs with denormalized customer fields → Phase 1 migrates that
  - 01G references "View all jobs at property" via `GET /v1/jobs?property_id=X` → Phase 2 adds the Property Detail Page that landing hits
  - 01E defines dual-phase jobs (mitigation → reconstruction) → Phase 3 adds the one-click convert action

## Summary

Brett's Property-Level Data Model spec is foundational architecture. Most of it (property table, sketch-at-property, sketch versioning, auto-inherit, multi-floor, additive sketches) is already live or speced. **What's NOT covered anywhere:**

1. **Customer entity** — currently customer is denormalized on `jobs` (`customer_name`, `customer_phone`, `customer_email`). Brett's model requires one customer → many properties (landlords, property management companies, repeat customers).
2. **Property Detail Page** — no screen exists to "open a property" independently. All flows are job-scoped today.
3. **"Convert to Reconstruction"** — one-click button on completed mitigation → creates linked reconstruction job. 01E has the dual-phase concept but no action.

This spec delivers all three in one cohesive flow, since they describe the same mental model: *a property has an owner, and you do work at it over time.*

---

## What Already Exists (Do Not Duplicate)

| Component | Status | Notes |
|-----------|--------|-------|
| `properties` table | ✅ Live (01-jobs) | `usps_standardized`, `year_built`, `property_type`, `total_sqft`, `deleted_at`, `address_line2`. Unique index on `(company_id, usps_standardized)`. |
| Properties CRUD API | ✅ Live | 5 endpoints: POST, GET list (with search), GET by id, PATCH, DELETE (soft). Dedup via `_build_usps_standardized`. |
| `jobs.property_id` FK | ✅ Live | Auto-creates property if none exists for address on job creation. |
| Sketch-at-property + versioning | ✅ Speced (01H) | `floor_plans` reparented, `floor_plan_versions`, auto-upgrade active jobs, multi-floor selector. |
| "View all jobs at property" | ✅ Speced (01G) | `GET /v1/jobs?property_id={id}` — Phase 2 here uses this to populate the Jobs tab. |
| Dual-phase job type | ✅ Speced (01E) | Phase 3 wires the one-click action that creates the 2nd job. |

---

## Done When

### Phase 1: Customer Entity Split
- [ ] `customers` table created (id, company_id, name, phone, email, customer_type, notes). `id` is a stable UUID suitable for customer portal auth lookup (unblocks 08 Portals).
- [ ] `properties.customer_id` FK added (nullable, ON DELETE SET NULL)
- [ ] `jobs.customer_name`, `jobs.customer_phone`, `jobs.customer_email` **dropped** (pre-launch, clean cut per 01H decision #2)
- [ ] Existing dev/staging data wiped (no production data exists)
- [ ] Share-link redaction (01-jobs.md:688) updated — redacts `job.property.customer.phone`/`email` instead of dropped columns. Adjuster-view share tests re-run.
- [ ] Customer CRUD API: POST, GET list (with search), GET by id, PATCH, DELETE (soft)
- [ ] Customer search endpoint with fuzzy match on name + phone (pg_trgm similarity ≥ 0.6 on name, exact match on normalized phone)
- [ ] RLS policies: use live `get_my_company_id()` helper from Spec 00 bootstrap (per-operation SELECT/INSERT/UPDATE/DELETE, `deleted_at IS NULL` filter on SELECT/UPDATE, `DELETE USING (false)` to force soft-delete via service_role)
- [ ] 01F job creation flow updated: pick-or-create customer → pick-or-create property → create job
- [ ] 01G job detail header reads customer via `job.property.customer` (transitive)
- [ ] Unique index on `(company_id, normalized_phone)` for phone dedup (partial, where phone IS NOT NULL AND deleted_at IS NULL)
- [ ] `customer_type` enum: `individual`, `commercial` (drives UI copy — "Homeowner" vs "Property Manager")
- [ ] "Change Owner" admin-only action on Property Detail header (PATCH `/v1/properties/{id}` with new `customer_id`; audit log entry on both properties)
- [ ] Full test coverage: customer CRUD, dedup, RLS, cascade behavior on property deletion, share-link redaction

### Phase 2: Property Detail Page + Nav Tab
- [ ] `properties.gate_code`, `properties.key_location`, `properties.access_notes` columns added
- [ ] Route `/properties/[id]` created
- [ ] Page header: address, owner name (→ links to customer), phone, "+ Create New Job" CTA, "Change Owner" (admin-only)
- [ ] 4 tabs: **Sketch** (embeds 01H viewer, read-only; multi-floor selector from 01H Basement/Main/Upper/Attic), **Jobs** (chronological list via 01G endpoint), **Photos** (aggregated across jobs, grouped by job, paginated), **Notes** (gate code, key location, access notes — editable)
- [ ] Property soft-delete confirmation dialog. Property delete does NOT affect the customer record (FK is on `properties.customer_id`, not reverse). Deleting a property hides it from lists; customer remains intact and their other properties are unaffected.
- [ ] Editing a property's address re-computes `usps_standardized` and validates against unique index — conflicts return 409 with a "merge with existing?" prompt
- [ ] Dashboard sidebar adds **Properties** nav item (between Jobs and Team)
- [ ] `/properties` route — list view of all properties, searchable by address or customer name
- [ ] "View Property" link added to 01G Job Detail page header (next to address)
- [ ] Edit-in-place for property notes fields (inline editing, optimistic UI)
- [ ] Mobile: tabs become horizontal scrollable, header stacks vertically
- [ ] RBAC: all company members can view; admin/owner can edit notes + change owner
- [ ] Full test coverage: route params, tab switching, notes persistence, nav tab visibility, address edit conflict (`test_property_address_edit_conflicts_with_existing`), photos pagination

### Phase 3: Convert to Reconstruction
- [ ] "Convert to Reconstruction" button on 01G Job Detail page — visible only when `job.job_type = 'mitigation'` AND `job.status = 'completed'`
- [ ] `POST /v1/jobs/{id}/convert-to-reconstruction` endpoint — creates new job linked to same property
- [ ] New job inherits: `property_id`, `company_id`, customer relationship (via property), `loss_date`, insurance info (`carrier`, `claim_number`, `adjuster_*`)
- [ ] New job defaults: `job_type = 'reconstruction'`, `status = 'lead'`, `parent_job_id = {original}` (audit link)
- [ ] `jobs.parent_job_id` FK added with `ON DELETE RESTRICT` (prevent hard-delete of mitigation that has a dependent reconstruction; soft-delete is permitted and preserves the link)
- [ ] Sketch behavior follows 01H property-scoped floor plans: new reconstruction job auto-pins to latest `floor_plan_versions` per floor. "Start Fresh" (create a sibling sketch record on the property) is a power-user option exposed in the sketch tool, not the convert dialog.
- [ ] Confirmation dialog: "Create reconstruction job at {address}? This will link to the completed water mitigation from {date}."
- [ ] Audit log entry on original job: "Converted to reconstruction — Job #{new_number} created"
- [ ] Redirect to new job's detail page after creation
- [ ] **Idempotency (race-safe):** partial unique index on `jobs(parent_job_id) WHERE job_type = 'reconstruction' AND deleted_at IS NULL` — prevents double-click from creating two reconstruction jobs. Endpoint catches unique-violation, returns existing linked job instead of error.
- [ ] Button shows "View Reconstruction" if reconstruction already exists (pre-check via `GET /v1/jobs/{id}/reconstruction`)
- [ ] Full test coverage: conversion flow, concurrent-click idempotency (simulate two parallel POSTs), inheritance of fields, permissions, RESTRICT behavior on hard-delete attempt

### Phase 4: Polish — Fuzzy Match, Merge, Customer Detail
- [ ] 01F fuzzy address match dialog formalized — exact/close/no-match tiers (from Brett's PDF):
  - **Exact** (after normalization: same street number, street name, city, ZIP — compared against `properties.usps_standardized`) → auto-suggest "Use existing property at 123 Main St?"
  - **Close** (same street number, same ZIP, street name similarity via `pg_trgm` ≥ 0.7) → "Is this the same property as 123 Main St? [Yes] [No, create new]"
  - **No match** (similarity < 0.7 or different ZIP) → create new silently
  - Normalization rules: lowercase, strip punctuation, expand common abbreviations (`St→Street`, `Ave→Avenue`, `Rd→Road`, `Blvd→Boulevard`, `Apt→Apartment`) before comparison
- [ ] `POST /v1/properties/merge` endpoint — combines two property records (moves all jobs from source → target, preserves sketch history, soft-deletes source)
- [ ] `POST /v1/customers/merge` endpoint — combines two customer records (moves all properties from source → target, soft-deletes source). Admin-only.
- [ ] Settings → Properties → "Merge Duplicates" admin-only UI (owner + admin roles)
- [ ] Merge preview: shows which jobs would move, warns about sketch version divergence
- [ ] Customer Detail view at `/customers/[id]` — shows customer info + all properties owned. Response shape: `{customer: {...}, properties: [{id, address, latest_job: {id, type, status, completed_at}, job_count}]}`. Matches Brett's PDF p. 3 example (property list with latest activity per property).
- [ ] Similar customer-level "Merge Duplicates" tool (Settings → Customers)
- [ ] Full test coverage: merge conflict resolution, fuzzy match tier routing, customer detail aggregations, admin-only policy on merge endpoints

---

## DECISIONS (To Be Locked in Eng Review)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Clean cut migration, no backward compat | Pre-launch, no production data. Drop `jobs.customer_*` columns outright. Matches 01H decision #2. |
| 2 | Customer is nullable on property | Edge case: property discovered before customer identified (e.g., lead from address only). Allow empty customer, prompt to fill during job creation. |
| 3 | Property can change customer (sale) | Simple `UPDATE properties SET customer_id = new_id`. No audit table V1 — log to `customer_history` table deferred to V2. |
| 4 | Property notes as columns, not table | Brett's spec has 3 discrete fields (gate code, key location, access notes). Columns are simpler than a notes table. No versioning needed. |
| 5 | `parent_job_id` on jobs (reconstruction → mitigation link) with `ON DELETE RESTRICT` | Simple FK. Enables "View Mitigation History" link on reconstruction job. Nullable — not all jobs have parents. RESTRICT prevents hard-deleting a mitigation that has a reconstruction depending on it; soft-delete preserves the link. |
| 6 | Convert-to-Reconstruction idempotency via partial unique index | Previous approach (SELECT-before-INSERT) has a race window on double-click. A partial unique index on `jobs(parent_job_id) WHERE job_type='reconstruction' AND deleted_at IS NULL` makes duplicate-create impossible at the DB layer. Endpoint catches the 23505 violation and returns the existing job. |
| 7 | Properties nav tab ships with Phase 2 | Don't split into separate spec. User sees the property feature as one cohesive addition. |
| 8 | Customer soft-delete nullifies `properties.customer_id` (SET NULL) | Keep property records intact even if customer deleted. Property orphans are fine — prompt user to reassign at next job creation. Property soft-delete does NOT affect the customer (FK direction). |
| 9 | Commercial customers: single name/phone/email V1 (V2 will add `customer_contacts` sub-table for primary/secondary contacts at property management companies) | Brett's PDF p. 3 shows "ABC Property Management" with "Contact: Sarah Johnson" as sub-field. V1 stores that contact in `name` field; V2 normalizes into sub-table when we ship adjuster portal (same pattern). |
| 10 | Fuzzy match similarity: `pg_trgm` ≥ 0.7 on street name (close tier) | pg_trgm is built into Supabase Postgres. Threshold empirically chosen — tight enough to catch "Main St" vs "Main Street" after abbreviation expansion, loose enough to allow confirmation dialog for "Main St" vs "Maine St". Calibrate with test fixtures during implementation. |

---

## Database Schema

### Phase 1: Customer Entity

```sql
-- New table
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    phone           TEXT,              -- normalized E.164 format
    email           TEXT,
    customer_type   TEXT NOT NULL DEFAULT 'individual'
                    CHECK (customer_type IN ('individual', 'commercial')),
    notes           TEXT,              -- free-text notes about the customer
    deleted_at      TIMESTAMPTZ,       -- soft delete
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phone dedup (partial index, excludes null + soft-deleted)
CREATE UNIQUE INDEX idx_customers_company_phone
    ON customers(company_id, phone)
    WHERE phone IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_customers_company_name ON customers(company_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_company_email ON customers(company_id, email) WHERE email IS NOT NULL AND deleted_at IS NULL;

-- RLS (matches live pattern from 00-bootstrap.md: get_my_company_id() helper, per-operation policies)
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
        company_id = get_my_company_id()  -- prevent cross-tenant mutation
    );

-- DELETE: only via service_role (soft delete in practice)
CREATE POLICY "customers_delete" ON customers
    FOR DELETE USING (false);

-- updated_at trigger
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Link property to customer
ALTER TABLE properties ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX idx_properties_customer ON properties(customer_id) WHERE customer_id IS NOT NULL;

-- Pre-launch clean cut: drop denormalized customer fields from jobs
-- Wipe dev/staging data first
TRUNCATE jobs CASCADE;
ALTER TABLE jobs DROP COLUMN customer_name;
ALTER TABLE jobs DROP COLUMN customer_phone;
ALTER TABLE jobs DROP COLUMN customer_email;
```

### Phase 2: Property Notes + Detail Page

```sql
ALTER TABLE properties ADD COLUMN gate_code TEXT;
ALTER TABLE properties ADD COLUMN key_location TEXT;
ALTER TABLE properties ADD COLUMN access_notes TEXT;
```

No new tables. Property Detail Page reads from existing `properties`, `customers`, `jobs`, `floor_plans`, `photos` tables.

### Phase 3: Reconstruction Linkage

```sql
-- RESTRICT: prevent hard-delete of a mitigation that has a reconstruction depending on it.
-- Soft-delete (setting deleted_at) is permitted and preserves the audit link.
ALTER TABLE jobs ADD COLUMN parent_job_id UUID REFERENCES jobs(id) ON DELETE RESTRICT;
CREATE INDEX idx_jobs_parent ON jobs(parent_job_id) WHERE parent_job_id IS NOT NULL;

-- Idempotency: at most one active reconstruction per mitigation.
-- Catches the double-click race — second POST hits 23505 and endpoint returns the existing linked job.
CREATE UNIQUE INDEX idx_jobs_one_reconstruction_per_parent
    ON jobs(parent_job_id)
    WHERE job_type = 'reconstruction' AND deleted_at IS NULL AND parent_job_id IS NOT NULL;

-- Constraint: only reconstruction jobs can have a parent (enforced in application layer, not DB,
-- because we want to allow future use cases like "follow-up job" or "warranty job")
```

### Phase 4: Polish

No new schema. Merge endpoints operate on existing tables (move FKs, soft-delete source).

---

## API Endpoints

### Customers (Phase 1)

| Method | Endpoint | Role | Purpose |
|--------|----------|------|---------|
| `POST` | `/v1/customers` | Member | Create customer |
| `GET` | `/v1/customers` | Member | List customers (search by name/phone, paginated) |
| `GET` | `/v1/customers/{id}` | Member | Get customer detail + owned properties (response includes `properties[]` with latest-job summary per property — see Phase 4 response shape) |
| `GET` | `/v1/customers/{id}/properties` | Member | List properties owned by customer (paginated, ordered by last-activity DESC) |
| `PATCH` | `/v1/customers/{id}` | Member | Update customer (name, phone, email, notes) |
| `DELETE` | `/v1/customers/{id}` | Admin | Soft delete — sets `deleted_at`, nullifies `properties.customer_id` |

### Properties (extended — Phase 2)

Existing endpoints remain. Add:

| Method | Endpoint | Role | Purpose |
|--------|----------|------|---------|
| `GET` | `/v1/properties/{id}/jobs` | Member | All jobs at property (chronological — Jobs tab) |
| `GET` | `/v1/properties/{id}/photos` | Member | All photos across all jobs at property, paginated (`?page=1&page_size=50`). Single query joining photos → jobs WHERE property_id to avoid N+1. |
| `PATCH` | `/v1/properties/{id}/notes` | Member | Update gate_code, key_location, access_notes |
| `PATCH` | `/v1/properties/{id}` | Admin | Update property (including `customer_id` — "Change Owner" action). Audit-logs the change. |

### Jobs (extended — Phase 3)

| Method | Endpoint | Role | Purpose |
|--------|----------|------|---------|
| `POST` | `/v1/jobs/{id}/convert-to-reconstruction` | Member | Create linked reconstruction job |
| `GET` | `/v1/jobs/{id}/reconstruction` | Member | Get linked reconstruction job if exists (for idempotent button) |

### Fuzzy Match + Merge (Phase 4)

| Method | Endpoint | Role | Purpose |
|--------|----------|------|---------|
| `GET` | `/v1/properties/match?address={}&zip={}` | Member | Returns `{tier: "exact"\|"close"\|"none", matches: [...]}` for UI dialog routing. Uses pg_trgm similarity ≥ 0.7 on street name after abbreviation normalization. |
| `POST` | `/v1/properties/merge` | Admin | Body: `{source_id, target_id}`. Moves all jobs from source → target, preserves sketch version history on target, soft-deletes source. Returns merge summary. |
| `POST` | `/v1/customers/merge` | Admin | Body: `{source_id, target_id}`. Moves all properties from source → target, soft-deletes source. Returns merge summary. |

---

## Frontend Architecture

### Phase 1: Customer Picker in Create Job Flow

01F's existing job creation form gets a new Step 0:

```
┌──────────────────────────────────────────┐
│ New Job — Step 1 of 3: Customer          │
├──────────────────────────────────────────┤
│                                          │
│ Who is the customer?                     │
│                                          │
│ [🔍 Search existing customers...      ]  │
│  ↳ ABC Property Management               │
│    (586) 555-1234 · 3 properties         │
│  ↳ John Smith                            │
│    (586) 555-4321 · 1 property           │
│                                          │
│ — or —                                   │
│                                          │
│ ○ Homeowner  ● Property Management      │
│ Name:    [__________________________]    │
│ Phone:   [__________________________]    │
│ Email:   [__________________________]    │
│                                          │
│ [Cancel]              [Next: Property →] │
└──────────────────────────────────────────┘
```

After customer: property picker (existing 01F flow, but now scoped by customer if one was selected — shows "Existing Properties for John Smith: ...").

### Phase 2: Property Detail Page Layout

```
┌────────────────────────────────────────────────────────────┐
│  ← Back to Properties                                       │
│                                                             │
│  123 Main St, Warren MI 48089                               │
│  👤 John Smith · 📞 (586) 555-1234      [+ Create New Job] │
├────────────────────────────────────────────────────────────┤
│  [ Sketch ] [ Jobs (2) ] [ Photos (42) ] [ Notes ]         │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  (tab content)                                              │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

**Sketch tab:** embeds 01H viewer in read-only mode with floor selector. "Open Sketch Editor" button opens full 01H tool scoped to this property.

**Jobs tab:**
```
Water Mitigation · JOB-2026-0410-01 · ✓ Completed (4/15/2026)
Reconstruction    · JOB-2026-0420-02 · ⏳ In Progress (Phase 3/8)
[+ Create New Job at This Property]
```

**Photos tab:** grid grouped by job → clickable to job's full photo view (01G).

**Notes tab:**
```
Gate code:        [1234                              ] ✎
Key location:     [Under mat                         ] ✎
Access notes:     [Dog in yard — call before arriving] ✎
```
Inline editing with optimistic save; debounced PATCH to `/v1/properties/{id}/notes`.

### Phase 3: Convert Button Placement

On 01G Job Detail page, when mitigation is completed:

```
┌─────────────────────────────────────────────┐
│ Status: ✓ Completed                         │
│                                             │
│ [Convert to Reconstruction →]               │
│ Start a reconstruction job at this property │
└─────────────────────────────────────────────┘
```

Dialog on click:
```
Create reconstruction job at 123 Main St?

This will:
• Create a new job linked to this property
• Inherit loss info from this mitigation (claim #, carrier, adjuster)
• Make the sketch available immediately
• Start as a "Lead" — you can schedule later

[Cancel]  [Create Reconstruction Job]
```

Redirect to new job's detail on success. Button changes to "View Reconstruction →" if already converted (idempotent).

---

## Data Migration Plan

Pre-launch, clean cut. No backward compat required.

1. **Backend engineer:** creates migration with all schema changes in one Alembic revision
2. **Dev + staging:** `TRUNCATE` all job-related tables before applying migration (order: `jobs` → `properties` — customers is new, nothing to truncate)
3. **Production:** no production data yet. Migration runs with empty tables.
4. **Post-migration verification:** test fixtures updated to include customer entity; existing integration tests updated; E2E tests re-run full create-job flow

---

## Testing Requirements

### Backend (pytest)

**Phase 1:**
- `test_customer_crud_happy_path` — create, read, update, soft-delete
- `test_customer_phone_dedup` — second insert with same normalized phone raises 409
- `test_customer_dedup_excludes_soft_deleted` — deleted customer's phone is reusable
- `test_customer_rls_cross_company_isolation` — user A cannot see user B's customers
- `test_property_customer_link_on_delete` — customer soft-delete nullifies `properties.customer_id`
- `test_job_creation_requires_customer` — POST /v1/jobs with missing customer returns 422
- `test_job_creation_picks_existing_customer` — search by phone returns existing → no new row
- `test_share_link_redacts_customer_via_property` — adjuster-scope share link hides `property.customer.phone` and `property.customer.email` (regression test for 01-jobs.md:688 redaction path change)

**Phase 2:**
- `test_property_detail_includes_customer` — GET /v1/properties/{id} returns `customer` nested object
- `test_property_jobs_chronological` — GET /v1/properties/{id}/jobs orders by created_at DESC
- `test_property_photos_aggregated_across_jobs` — photos from 2 jobs return in single response
- `test_property_photos_pagination` — 120 photos across 3 jobs paginate correctly (page=1 size=50 → 50; page=3 → 20)
- `test_property_notes_update` — PATCH updates gate_code only, leaves other fields
- `test_property_notes_rls_member_can_edit` — tech role can update notes
- `test_property_address_edit_conflicts_with_existing` — editing address to match an existing property's `usps_standardized` returns 409 with merge suggestion
- `test_change_owner_admin_only` — tech role PATCH with new customer_id returns 403; admin succeeds and audit-logs

**Phase 3:**
- `test_convert_to_reconstruction_creates_linked_job` — new job has parent_job_id, same property_id
- `test_convert_to_reconstruction_inherits_insurance_fields` — carrier, claim, adjuster carry over
- `test_convert_to_reconstruction_idempotent_serial` — second call returns existing linked job, not new
- `test_convert_to_reconstruction_idempotent_concurrent` — two parallel POSTs (asyncio.gather) → exactly one new job created, both responses return the same job id
- `test_convert_to_reconstruction_requires_completed_mitigation` — 422 if status != completed or job_type != mitigation
- `test_parent_job_hard_delete_restricted` — attempting to hard-delete a mitigation with a dependent reconstruction raises IntegrityError (RESTRICT)

**Phase 4:**
- `test_fuzzy_match_exact_tier` — same ZIP + street → tier="exact"
- `test_fuzzy_match_close_tier` — similar street name → tier="close"
- `test_property_merge_moves_jobs` — all source jobs repoint to target
- `test_customer_merge_moves_properties` — all source properties repoint to target

### Frontend (Vitest)

- Customer search autocomplete renders and debounces
- Property Detail Page renders all 4 tabs
- Notes edit is optimistic (UI updates before API responds)
- Convert button hidden for non-mitigation jobs
- Convert button shows "View Reconstruction" when already converted

### E2E (Playwright)

- End-to-end flow: create customer → create property → create mitigation job → complete → convert to reconstruction → verify sketch inherited
- Property Detail Page navigation: from Properties list → detail → tab switching → back
- Merge duplicates: create two customers with same name → merge → verify properties consolidated

---

## Spec Interactions

| Spec | Interaction | Action Required |
|------|-------------|-----------------|
| 01-jobs (implemented) | Denormalized customer fields dropped. **Share-link redaction (01-jobs.md:688) must be updated** — currently redacts `customer_phone`/`customer_email` columns that will no longer exist. New redaction path: `job.property.customer.phone/email`. | Update share-link endpoint + fixtures + tests |
| 01F Create Job v2 | Replace customer fields with customer picker step; add fuzzy match tier dialog | Update 01F Phase 1 to include customer picker + Phase 4 fuzzy match UI |
| 01G Job Detail v2 | Header reads customer transitively; adds "View Property" link; adds "Convert to Reconstruction" button | Update 01G header section + add Phase 8 |
| 01H Floor Plan V2 | No schema changes (already property-scoped). Phase 2 Sketch tab reuses 01H's multi-floor selector. Phase 3 convert-to-reconstruction defers to 01H's version-pinning behavior (new job auto-pins latest; "Start Fresh" creates sibling sketch). | Cross-reference only |
| 01E Job Type Extensions | Convert action implemented here; 01E defines dual-phase types | Cross-reference only |
| 08 Portals | Customer portal uses `customers.id` (stable UUID) for login. Phase 1 unblocks 08. | Unblocks 08 development |
| 04A Dashboard | Properties nav tab added | Update 04A nav list |

---

## Quick Resume (for next session)

**If resuming cold:**
1. Check PR #6 for latest state of `01J-customer-property-model.md`
2. Phase 1 is the big one — schema migration + customer CRUD + 01F integration. Starts with Alembic revision.
3. Brett's source PDF is at `docs/research/property-data-model-spec-v1.pdf`
4. Key dependency: 01H's `floor_plans.property_id` must land before Phase 2 tabs work

**Hot path questions:**
- **"Do jobs still have address fields?"** Yes — for display denormalization. `properties` is source of truth. Same pattern as 01H's decision.
- **"What if a customer has no phone?"** Allowed. Partial unique index excludes NULL phones from dedup.
- **"What about insurance adjuster as a 'customer'?"** Not in V1. Adjuster stays denormalized on `jobs` (carrier, adjuster_name, adjuster_phone). Deferred to V2 (same pattern as customer — extract to `adjusters` table when we build adjuster portal).

---

## Session Log

_Populated as work progresses._

---

## Decisions Log

_Populated as decisions are made during eng review and implementation._
