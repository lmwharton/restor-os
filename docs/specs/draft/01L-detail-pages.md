# Spec 01L: Property + Customer Detail Pages

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% |
| **State** | Draft |
| **Blocker** | Depends on CREW-11 (01J) for `customer_id` FKs and CRUD; depends on CREW-13 (01K) for `<PropertyPicker>` reuse on "Change Address" |
| **Branch** | TBD |
| **Issue** | [CREW-59](https://linear.app/crewmatic/issue/CREW-59) |
| **Depends on** | 01J, 01K |
| **Blocks** | None directly. Unblocks 08 Portals (customer-portal landing reuses Customer Detail aggregations). |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-28 |

## Reference
- [CREW-59](https://linear.app/crewmatic/issue/CREW-59)
- [01J spec](./01J-customer-property-model.md) — Phase 2 of original 01J PRD lives here
- 01H (Floor Plan v2) — Sketch tab embeds the existing read-only viewer

---

## Summary

Two **symmetric** entity-detail pages built on the customer/property data model from 01J:

1. **`/properties/[id]`** — clicking a property anywhere lands here. Header (address, owner, "+ Create Job" CTA, "Change Owner" admin) + 4 tabs (Sketch, Jobs, Photos, Notes).
2. **`/customers/[id]`** — clicking a customer lands here. Header (name, entity_name, phone, email, totals) + **property-centric** body (a list of owned properties, each with a latest-job summary).

Plus the supporting nav surface: **Properties** and **Customers** sidebar tabs, list views at `/properties` and `/customers`, and "View Property" / "View Customer" links on the existing job detail page.

Same component pattern, different root entity. One issue, ships together.

---

## What Already Exists (Do Not Duplicate)

| Component | Status | Notes |
|-----------|--------|-------|
| `customers` + `properties` tables | ✅ Live (after CREW-11) | All schema changes here are additive. |
| 01H floor-plan viewer (Konva) | ✅ Live | Embedded read-only on Sketch tab. |
| Job list / detail pages (existing) | ✅ Live | Adding "View Property" / "View Customer" header links only. |
| Customer + Property CRUD APIs | ✅ Live (after CREW-11) | Extended here with `/jobs`, `/photos`, `/notes` sub-resources on properties. |

---

## Done When

### Schema
- [ ] `properties.gate_code TEXT NULL` — **encrypted at rest via app-layer Fernet** (Decision #15). Stored value is the Fernet token, not plaintext.
- [ ] `properties.key_location TEXT NULL CHECK (length(key_location) <= 500)`
- [ ] `properties.access_notes TEXT NULL CHECK (length(access_notes) <= 5000)`
- [ ] No new tables.

(`last_activity_at` column + trigger lands in 01J's migration per 01J Decision #21.)

### Backend
- [ ] `GET /v1/properties/{id}/jobs` — chronological list (ORDER BY `created_at DESC, id DESC` — deterministic tiebreak); pagination via `limit`/`offset`. Each item: `id, job_number, status, job_type, loss_date, created_at, completed_at`.
- [ ] `GET /v1/properties/{id}/photos` — paginated single-query JOIN. **Deterministic ordering: `ORDER BY photos.created_at DESC, photos.id DESC`** (multiple photos can share a created_at second). Query: `WHERE jobs.property_id = $id AND jobs.company_id = get_my_company_id() AND photos.company_id = get_my_company_id() AND jobs.deleted_at IS NULL AND photos.deleted_at IS NULL`. Default `page_size=50`, max 200 (`Field(default=50, ge=1, le=200)`). Response item shape includes nested `job: { id, job_number }` for client-side grouping.
- [ ] `PATCH /v1/properties/{id}/notes` — **the ONLY endpoint that accepts notes**. Body accepts subset of `{ gate_code, key_location, access_notes }` with `extra="forbid"`. Member role allowed (operational notes — gate code, key under mat — must be tech-editable). `access_notes` passed through `bleach.clean(strip=True)` server-side before insert (strip all HTML; plaintext only). Per Decision #15: `gate_code` encrypted via Fernet at rest.
- [ ] **`PATCH /v1/properties/{id}` (the main route from 01J) explicitly REJECTS `gate_code`, `key_location`, `access_notes` via `extra="forbid"`.** Single endpoint per concern — main PATCH is for `customer_id` (admin-only) + address changes (per 01K).
- [ ] `GET /v1/customers/{id}/properties` — owned properties with latest-job summary. **Single-query implementation via `LATERAL JOIN` or `DISTINCT ON (property_id) ... ORDER BY property_id, created_at DESC`** — no per-property subquery (N+1 prevention). Response item: `{ id, address_line1, city, state, zip, last_activity_at, latest_job: LatestJobSummary | null, job_count }`. `LatestJobSummary` Pydantic model projects ONLY `{ id, job_number, job_type, status, completed_at }` — never `claim_number`, `adjuster_*`, `loss_cause`, `notes`. Test asserts insurance fields absent from response.
- [ ] `GET /v1/properties` and `GET /v1/customers` list endpoints sort by `last_activity_at DESC NULLS LAST` (using denormalized column from 01J Decision #21).
- [ ] All endpoints use authenticated client (RLS-scoped). Tests assert RLS isolation across companies.
- [ ] Tests cover all four new endpoints + N+1 prevention (query count assertions) + soft-delete exclusion + RLS isolation.

### Frontend
- [ ] Route `web/src/app/(protected)/properties/[id]/page.tsx` — Property Detail Page
- [ ] Route `web/src/app/(protected)/properties/page.tsx` — Properties list view
- [ ] Route `web/src/app/(protected)/customers/[id]/page.tsx` — Customer Detail Page
- [ ] Route `web/src/app/(protected)/customers/page.tsx` — Customers list view
- [ ] `<PropertyDetailHeader>`: address line + owner card (links to `/customers/{customer_id}`) + "+ Create Job" CTA + "Change Owner" (admin-only, opens `<CustomerPicker>` from 01K)
- [ ] `<PropertyDetailTabs>`: Sketch / Jobs / Photos / Notes — URL-synced via `?tab=sketch` for deep-linking
- [ ] **Sketch tab**: embeds 01H read-only viewer with floor selector
- [ ] **Jobs tab**: chronological list using `GET /v1/properties/{id}/jobs`
- [ ] **Photos tab**: grid grouped by job; click → existing job photo viewer
- [ ] **Notes tab**: 3 fields (gate_code, key_location, access_notes), inline editing with optimistic save, debounced 500ms PATCH
- [ ] `<CustomerDetailHeader>`: name + entity_name + phone + email + property_count + job_count
- [ ] `<CustomerDetailBody>`: property-centric list per Decision #2 — each property card shows address + latest_job summary with status/date
- [ ] `<PropertiesNavTab>` and `<CustomersNavTab>` added to dashboard sidebar between Jobs and Team
- [ ] "View Property" link on job detail header (next to address)
- [ ] "View Customer" link on job detail header (next to customer name)
- [ ] Mobile: tabs become horizontally scrollable; header stacks vertically; "Change Owner" moves to overflow menu
- [ ] Tests: route renders, tab switching, notes edit persistence, admin-only Change Owner, mobile responsive

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | 4 tabs on Property Detail: Sketch / Jobs / Photos / Notes | Brett's PDF spec. Each tab is a distinct concern; tabs scale better than a single scroll. |
| 2 | Customer Detail = **property-centric** body (list of properties with latest-job summary), NOT job-centric | Restoration mental model: "Sarah owns 5 rentals — what's the state of each?" — not "Sarah's job history in chronological order." Aligns with property-management portfolio thinking. |
| 3 | Property notes = 3 separate columns (`gate_code`, `key_location`, `access_notes`) — not a single freeform field | Each is a discrete operational field. Separate columns enable structured queries later (e.g., "list properties without gate codes"). 5000-char cap on `access_notes` prevents abuse. |
| 4 | Notes editable by ANY member (not admin-only) | These are operational notes (gate code, key under mat) — techs need to update them in the field. Admin-only would block the field-first UX. |
| 5 | `customer_id` PATCH on properties is admin-only (from 01J Decision #13) | Unchanged. "Change Owner" is a different action from "edit notes." Separate UI controls. |
| 6 | Page header has "+ Create Job at this Property" CTA → opens new-job form pre-filled with `property_id` (and `customer_id` if known) | Reduces clicks for repeat-customer workflows. The picker on the new-job form is still there but pre-selected. |
| 7 | Sketch tab is **read-only** in this view | Editing happens in the dedicated 01H sketch tool. Click-through "Open Sketch Editor" CTA opens the full 01H tool scoped to this property. |
| 8 | Photos pagination at `page_size=50` | Restoration jobs typically have 50–200 photos. 50 fits a reasonable mobile scroll. Larger pages risk slow render on older phones. |
| 9 | Properties + Customers as **separate** sidebar tabs (not bundled) | They're separate root entities. Bundling them into a single "Contacts" tab would muddle the mental model. |
| 10 | Properties list view defaults to sorting by **last activity DESC**; Customers list view defaults to **last activity DESC** (latest-job timestamp across owned properties) | Recency-first matches contractor workflow. |
| 11 | "View Property" / "View Customer" links on job detail header use **subtle text links**, not buttons | Discoverable but not visually competing with the primary "Edit Job" CTA. |
| 12 | Mobile: tabs become scrollable horizontally, header stacks vertically, "Change Owner" moves to overflow menu | Field-first — most techs use this on mobile. |
| 13 | URL deep-linking via `?tab=sketch` (etc.) on Property Detail | Lets users bookmark "Sarah's house, photos tab" or share that link with a teammate. |
| 14 | Address-edit conflict (changing a property's address to one that already exists in the company) returns 409 | Existing 01K canonicalization will catch this. UI shows "This address already belongs to <other property>. Use that property instead?" with a deep-link. |
| 15 | **`gate_code` encrypted at rest** via app-layer Fernet (`cryptography.fernet.MultiFernet` for key rotation). Key in `GATE_CODE_FERNET_KEY` env var (Railway secret). Plaintext NEVER logged. Decrypt-on-read in service layer; encrypt-on-write. | Gate code is a physical-access credential (entry to a customer's home). Plaintext storage is unacceptable for any future leak/breach scenario. Same pattern works for V2 lockbox codes / alarm PINs. |
| 16 | `access_notes` server-side sanitized via `bleach.clean(value, strip=True, tags=[], attributes={})` before insert/update — plaintext only, no HTML | Notes flow into UI, audit logs, and potentially future report exports. XSS / log-injection prevention. Pre-empts a tech writing scriptable content. |
| 17 | `gate_code`, `key_location`, `access_notes` are **explicitly excluded** from any share-link projection (continues 01J Decision #19). Adjuster scope never sees these. | Adjusters don't need internal operational notes; "owner is hostile" type content must never leak externally. |
| 18 | `?tab=` query param is `Literal["sketch", "jobs", "photos", "notes"]`; unknown values fall back to `"sketch"` | Type-safe routing. Defends against URL-injection in case anything templates the value. |
| 19 | Notes inline-edit uses single-field PATCH (one field per request) with 500ms debounce. **Field-level lock client-side: while a PATCH is in flight for `gate_code`, additional `gate_code` edits queue; cross-field edits don't block.** | Avoids the race where rapid switching between fields fires concurrent multi-field PATCHes that arrive out of order. |

---

## Database Schema

```sql
-- Three notes columns added to properties.
-- gate_code stores Fernet ciphertext (Decision #15) — DB sees opaque bytes-as-text.
ALTER TABLE properties ADD COLUMN gate_code TEXT;
ALTER TABLE properties
    ADD COLUMN key_location TEXT
    CHECK (key_location IS NULL OR length(key_location) <= 500);
ALTER TABLE properties
    ADD COLUMN access_notes TEXT
    CHECK (access_notes IS NULL OR length(access_notes) <= 5000);

-- No new tables, no new indexes (notes are queried per-property only).
```

Encryption helper lives in `backend/api/shared/encryption.py`:

```python
"""Fernet encryption for sensitive operational fields (gate_code).

Uses MultiFernet so key rotation is non-blocking. Old keys decrypt; new keys encrypt.
"""
import os
from cryptography.fernet import Fernet, MultiFernet

def _build_fernet() -> MultiFernet:
    keys_csv = os.environ["GATE_CODE_FERNET_KEYS"]  # comma-separated, newest first
    return MultiFernet([Fernet(k.strip()) for k in keys_csv.split(",") if k.strip()])

_fernet: MultiFernet | None = None

def encrypt_gate_code(plaintext: str | None) -> str | None:
    if not plaintext:
        return None
    global _fernet
    if _fernet is None:
        _fernet = _build_fernet()
    return _fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")

def decrypt_gate_code(ciphertext: str | None) -> str | None:
    if not ciphertext:
        return None
    global _fernet
    if _fernet is None:
        _fernet = _build_fernet()
    return _fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
```

`downgrade()` drops the three columns.

---

## API Endpoints

### Properties (extended)

| Method | Endpoint | Role | Behavior |
|---|---|---|---|
| `GET` | `/v1/properties/{id}/jobs` | Member | Chronological (DESC by `created_at`) jobs at this property. Paginated. |
| `GET` | `/v1/properties/{id}/photos` | Member | Photos across all jobs at this property. Single-query JOIN to avoid N+1. Paginated. |
| `PATCH` | `/v1/properties/{id}/notes` | Member | Update any subset of `gate_code, key_location, access_notes`. `extra="forbid"`. |

### Customers (extended)

| Method | Endpoint | Role | Behavior |
|---|---|---|---|
| `GET` | `/v1/customers/{id}/properties` | Member | Customer's owned properties with latest-job summary. Paginated. |

### Job detail header (frontend only)

No new backend endpoints. The "View Property" / "View Customer" links are routes-only.

---

## Frontend Architecture

### Property Detail Page Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Properties                                                       │
│                                                                     │
│  123 Main St · Warren MI 48089                                      │
│  👤 Sarah Johnson · ABC Property Mgmt · (586) 555-1234              │
│  [+ Create Job at This Property]    [Change Owner]   ⋯              │
├────────────────────────────────────────────────────────────────────┤
│  [ Sketch ] [ Jobs (4) ] [ Photos (87) ] [ Notes ]                  │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ...active tab content...                                           │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Customer Detail Page Layout (property-centric)

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Customers                                                        │
│                                                                     │
│  Sarah Johnson                                                      │
│  ABC Property Management · Commercial                               │
│  📞 (586) 555-1234 · ✉ sarah@abc.com                                │
│  3 properties · 12 jobs                                             │
│                                                                     │
│  [+ Create Job for This Customer]                                   │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Properties                                                         │
│                                                                     │
│  🏠 123 Main St · Warren MI 48089                                   │
│     5 jobs · last: Reconstruction in progress (Apr 20)              │
│                                                                     │
│  🏠 456 Oak Ave · Detroit MI 48201                                  │
│     4 jobs · last: Mitigation completed (Mar 14)                    │
│                                                                     │
│  🏠 789 Pine Rd · Sterling Heights MI 48310                         │
│     3 jobs · last: Mitigation in progress (Apr 22)                  │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### List Views

`/properties` — table or card grid (toggleable). Columns: address, owner, last-activity date, job count. Search by address (uses `<PropertyPicker>`-style match endpoint or simple `?search=`). Sort by `last_activity DESC` default.

`/customers` — same pattern. Columns: name, entity_name, phone, last-activity, property count, job count. Search by name/phone/email per 01J Decision #18 dispatch.

### Sidebar Nav

Existing sidebar (between Jobs and Team):
- Dashboard
- Jobs
- **Properties** ← NEW
- **Customers** ← NEW
- Team
- (etc.)

### Mobile

- Tabs → horizontally scrollable bar
- Header → stacks vertically (address → owner card → CTAs become full-width buttons in a column)
- "Change Owner" → overflow menu (⋯)
- Sketch tab → maintains pinch-zoom; readonly

---

## Testing Requirements

### Backend
- `test_property_jobs_chronological` — DESC by created_at
- `test_property_jobs_pagination`
- `test_property_jobs_excludes_soft_deleted`
- `test_property_photos_aggregated_across_jobs` — 2 jobs, 30 + 40 photos → 70 total returned
- `test_property_photos_pagination` — page 2 of 50/page returns next set
- `test_property_photos_single_query_no_n_plus_1` — assert query count
- `test_property_notes_patch_partial` — PATCH only `gate_code` doesn't clear `key_location`
- `test_property_notes_member_can_edit` — tech role succeeds
- `test_property_notes_max_length_enforced` — 5001 chars → 422
- `test_customer_properties_endpoint` — returns owned properties with latest-job summary
- `test_customer_properties_pagination`
- `test_customer_properties_latest_job_null_when_no_jobs`
- `test_customer_properties_orders_by_last_activity_desc`

### Frontend (Vitest + Playwright)
- Property Detail page renders all 4 tabs
- Tab switching updates URL (`?tab=...`)
- Notes tab inline edit triggers PATCH after 500ms debounce
- Notes tab "saved" indicator after successful PATCH
- "Change Owner" hidden for tech role
- "Change Owner" opens `<CustomerPicker>` and on save updates header
- Customer Detail renders property-centric body
- Customer Detail "+ Create Job for This Customer" pre-fills new-job form
- "View Property" / "View Customer" links work from job detail
- Mobile: tabs scroll horizontally, header stacks
- E2E: from Properties list → click property → Sketch tab → click "Open Sketch Editor" → 01H tool opens scoped to that property

---

## Spec Interactions

| Spec | Interaction |
|------|-------------|
| 01J (CREW-11) | Foundation; `customer_id` FKs + customer/property CRUD already exist |
| 01K (CREW-13) | "Change Owner" reuses `<CustomerPicker>`. Address edits on a property re-canonicalize via 01K's flow. |
| 01M (CREW-60) | "+ Create Job" CTA opens new-job form. If converting a completed mitigation, the "Convert to Reconstruction" button (01M) lives on the existing job detail page — not on the property detail page (different mental model: action on the job, not the property). |
| 01H (Floor Plan v2) | Sketch tab embeds 01H viewer read-only |

---

## Out of Scope

- **Property merge tooling** — write-time canonicalization (01K) prevents the dupes; merging deferred to V2 if a real need emerges.
- **Customer merge tooling** — same reasoning. Phone-as-unique-key (01J Decision #6) blocks customer dupes at insert.
- **Property timeline / activity feed** — chronological view of all events at a property. Nice to have; not required for V1. Defer.
- **Customer messaging hub** — texting/calling the customer from the detail page. Belongs in CREW-44 (V2 portal/comms work).
- **Insights / analytics on properties** — "average days from mitigation start to completion at this property type." V2.

---

## Quick Resume

**If resuming cold:**
1. Notes columns are the only schema change — small migration alongside the bigger 01J/01K migration in the unified plan.
2. Tab routing pattern: lift from existing 01H tabs if they exist, else use `useSearchParams()` from `next/navigation`.
3. Photos query — be careful about N+1. Single JOIN, single round-trip. Test with a query-counter fixture.

---

## Session Log

_Populated as work progresses._

---

## Decisions Log

_Populated during eng review and implementation._
