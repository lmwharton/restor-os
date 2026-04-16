# Spec 01F: Create New Job v2 — Internal Autocomplete, Previous Jobs, Emergency Flow

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 phases) |
| **State** | Draft |
| **Blocker** | None |
| **Branch** | TBD |
| **Issue** | TBD |
| **Depends on** | Spec 01 (Jobs — complete), Spec 01E (Job Type Extensions — draft) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-14 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Reference
- **Brett's spec:** [`docs/research/create-new-job-spec-v2.pdf`](../../research/create-new-job-spec-v2.pdf) — "Create New Job Screen — Product Specification v2.0" (April 13, 2026)
- **Current implementation:** Spec 01 Phase 3 (complete) — basic create form with Google Maps autocomplete, 2 required fields
- **Current frontend:** `web/src/app/(protected)/jobs/new/page.tsx`

## Done When
- [ ] Internal property search replaces Google Maps as primary autocomplete (search company's own properties by address)
- [ ] Selecting a known property auto-fills all customer + address fields
- [ ] "Previous Jobs at This Address" card shows up to 5 recent jobs when a known property is selected
- [ ] Job Type is radio buttons: Water Damage / Fire Damage / Mold Remediation / Reconstruction
- [ ] Emergency Call checkbox auto-sets loss_date to today
- [ ] Jobs created with status `lead` (not `new`)
- [ ] Phone auto-formats to `(555) 123-4567` as user types
- [ ] 7 required fields enforced: street, city, state, zip, customer_name, phone, job_type
- [ ] Non-blocking yellow warning on unverifiable addresses
- [ ] Same-phone-different-address info message (non-blocking)
- [ ] Double-click prevention: button disables with "Creating..." spinner
- [ ] Cancel with unsaved changes shows `<ConfirmModal>`
- [ ] Mobile: correct keyboard types (tel, email, numeric for zip)
- [ ] Customer info updates automatically on return visits (latest info wins)
- [ ] New address + customer saved for future autocomplete
- [ ] Redirect to Job Detail page on success with toast "Job created successfully"
- [ ] Brett's success criteria met: new address < 30s, existing address < 10s

## What Changes from Current Implementation

Current (Spec 01 Phase 3):
- Google Maps autocomplete for address
- 2 required fields: `address_line1` + `loss_type`
- Loss type selector (tap targets): water/fire/mold
- Status on creation: `new`
- No internal property search, no previous jobs card, no emergency flag

This spec (v2):
- **Internal property search first** — searches company's own `properties` table
- **7 required fields** — street, city, state, zip, customer_name, phone, job_type
- **Job Type radio buttons** — Water Damage / Fire Damage / Mold Remediation / Reconstruction (aligns with Spec 01E types)
- **Status on creation: `lead`** — new opportunity, not contracted yet
- **Previous Jobs card** — contextual history for returning properties
- **Emergency Call checkbox** — auto-sets loss_date
- **Phone formatting**, **non-blocking validation**, **double-click prevention**

---

## Phase 1: Property Search API + Autocomplete Component

### Backend — Property Search Endpoint

```
GET /v1/properties/search?q={query}&limit=5
```

Triggers after 3+ characters typed. Searches company's own properties by address (fuzzy match on `address_line1`). Returns property + most recent customer + last job info for each match.

**Response shape:**
```json
[
  {
    "property_id": "uuid",
    "address_line1": "123 Main St",
    "city": "Warren",
    "state": "MI",
    "zip": "48089",
    "customer_name": "John Smith",
    "customer_phone": "(555) 123-4567",
    "customer_email": "john@example.com",
    "last_job": {
      "job_type": "mitigation",
      "loss_date": "2026-03-15",
      "status": "complete"
    }
  }
]
```

**Search logic:**
- `ILIKE '%query%'` on `address_line1` within company scope
- Order by most recent job date (most active properties first)
- Limit 5 results
- RLS: scoped to `company_id` from JWT

### Backend — Recent Jobs at Property

```
GET /v1/properties/{property_id}/recent-jobs?limit=5
```

Returns up to 5 most recent jobs at this property, ordered by `created_at DESC`.

**Response shape:**
```json
[
  {
    "job_id": "uuid",
    "job_type": "mitigation",
    "loss_date": "2026-03-15",
    "status": "complete",
    "created_at": "2026-03-15T10:00:00Z"
  }
]
```

### Backend — Phone Duplicate Check

```
GET /v1/properties/check-phone?phone={digits}
```

Called when phone field loses focus (on blur). Returns the property address if this phone is associated with a **different** property than the one currently selected.

**Request:** `?phone=5551234567` (digits only)
**Response (match found at different property):**
```json
{
  "match": true,
  "address": "123 Other St, Warren MI 48089",
  "property_id": "uuid"
}
```
**Response (no conflict):**
```json
{
  "match": false
}
```

Frontend uses this to show the info banner: "This phone number is associated with another property: [address]. Is this the same customer?" Non-blocking.

### Frontend — Internal Autocomplete Component

Replace `AddressAutocomplete` (Google Maps) with `PropertyAutocomplete`:

- **Trigger:** After 3 characters in Street Address field
- **Dropdown items show:** address, customer name + phone, last job type + date
- **On select:** auto-fill all fields — street, city, state, zip, customer_name, phone, email (if on file)
- **On dismiss/ignore:** user types manually, treated as brand new property
- **Loading state:** spinner in address field while searching
- **Mobile:** dropdown takes most of screen, large tap areas, swipe-down to dismiss

### Checklist
- [ ] `GET /v1/properties/search` endpoint with fuzzy address matching
- [ ] pytest: search returns matching properties within company scope
- [ ] pytest: search returns empty for < 3 char query
- [ ] pytest: search respects RLS (company isolation)
- [ ] pytest: results include customer info and last job
- [ ] `GET /v1/properties/{id}/recent-jobs` endpoint
- [ ] pytest: returns up to 5 most recent jobs ordered by created_at DESC
- [ ] pytest: respects RLS (company isolation)
- [ ] `GET /v1/properties/check-phone` endpoint for duplicate detection
- [ ] pytest: returns match when phone exists at different property
- [ ] pytest: returns no match when phone is new or same property
- [ ] pytest: respects RLS (company isolation)
- [ ] `PropertyAutocomplete` component replaces Google Maps autocomplete
- [ ] Dropdown renders after 3+ chars with debounce (300ms)
- [ ] Selecting suggestion auto-fills all address + customer fields
- [ ] Ignoring dropdown allows manual entry
- [ ] Loading spinner in address field during search
- [ ] Mobile: large dropdown, big tap areas, swipe-dismiss

---

## Phase 2: Previous Jobs Card + Customer Auto-fill Logic

### Previous Jobs Card

Appears below Customer Information section when a known property is selected (from autocomplete or matched after manual entry).

**Design:**
- Light blue background (`bg-blue-50`) with blue left border (`border-l-4 border-blue-400`)
- Header: "Previous Jobs at This Address"
- Each line: `{Job Type} ({date}) - {Status}`
- Up to 5 jobs, ordered most recent first
- Each job links to its detail page (opens in new tab)
- Card hidden when no known property / no previous jobs

### Customer Info Update on Return Visits

When user selects a known property but changes customer fields (name, phone, email):
- On submit, `PATCH /v1/properties/{id}/customer` updates the stored customer info
- Next autocomplete will show the updated info
- No confirmation needed — latest info always wins (people change numbers, houses sell)

### Backend — Update Customer Info

```
PATCH /v1/properties/{property_id}/customer
```

**Request body:**
```json
{
  "customer_name": "John Smith",
  "customer_phone": "(555) 999-8888",
  "customer_email": "john.new@example.com"
}
```

Only updates fields that differ from stored values. Called automatically during job creation if property already exists and customer info changed.

### Checklist
- [ ] Previous Jobs card component with blue styling
- [ ] Card appears after property match, hidden otherwise
- [ ] Shows up to 5 recent jobs with type, date, status
- [ ] Each job row links to job detail page
- [ ] `PATCH /v1/properties/{id}/customer` endpoint
- [ ] pytest: updates customer info on existing property
- [ ] pytest: only updates changed fields
- [ ] pytest: respects RLS (company isolation)
- [ ] Job creation flow auto-calls customer update when info differs
- [ ] Auto-fill works end-to-end: type address → select → all fields populate → Previous Jobs card shows

---

## Phase 3: Job Type Radios, Emergency Flag, Lead Status

### Job Type Radio Buttons

Replace current loss_type tap-target selector with radio button group:

| Radio Label | Maps to `job_type` |
|---|---|
| Water Damage Restoration | `mitigation` |
| Fire Damage Restoration | `fire_smoke` (from Spec 01E) |
| Mold Remediation | `mold` |
| Reconstruction | `reconstruction` |

- Radio buttons with large tap areas (not just the tiny circle) — 48px minimum touch target
- Required field — must pick one before submit
- Default: none selected (forces conscious choice)

### Emergency Call Checkbox

- Checkbox: "Yes, this is an emergency response"
- When checked: `loss_date` auto-sets to today, `is_emergency` flag set on job
- When unchecked: loss_date reverts to empty (user can set manually)
- `is_emergency` column on `jobs` table (`boolean DEFAULT false`)

### Lead Status

- Jobs created via this form start with `status = 'lead'`
- Requires adding `lead` to the job status enum/CHECK constraint
- Pipeline: `lead → scheduled → in_progress → complete → submitted → collected`
- Current pipeline starts at `new` — `lead` comes before `new` as the intake stage

### Job ID Format (User-Facing)

Brett's spec: "Assigns a Job ID (example: JOB-2026-0413-01)"

**Format:** `JOB-{YYYY}-{MMDD}-{NN}` where `NN` is a zero-padded daily sequence per company.

```sql
-- Add display job number to jobs table
ALTER TABLE jobs ADD COLUMN job_number VARCHAR NOT NULL;
ALTER TABLE jobs ADD CONSTRAINT uq_jobs_company_number UNIQUE (company_id, job_number);
```

**Generation:** Server-side on `POST /v1/jobs`. The backend:
1. Counts existing jobs for this company created today
2. Assigns next sequence: `JOB-2026-0414-01`, `JOB-2026-0414-02`, etc.
3. Returns `job_number` in the response

This is a display ID for contractors and adjusters — the UUID `id` remains the primary key.

### Backend Changes

```sql
-- Add emergency flag and job number
ALTER TABLE jobs ADD COLUMN is_emergency boolean DEFAULT false;
ALTER TABLE jobs ADD COLUMN job_number VARCHAR NOT NULL;
ALTER TABLE jobs ADD CONSTRAINT uq_jobs_company_number UNIQUE (company_id, job_number);

-- Add 'lead' to status CHECK constraint
-- (exact ALTER depends on current constraint definition)
```

### Atomic Job Creation — `POST /v1/jobs`

The create-job endpoint handles everything in a **single database transaction**. The frontend makes one API call — no orchestration of multiple endpoints.

**What the backend does on `POST /v1/jobs`:**
1. **Property lookup:** If `property_id` provided (from autocomplete), use it. If not, create a new `properties` row from the address fields.
2. **Customer update:** If existing property and customer info differs from stored values, update the property's customer fields.
3. **Job creation:** Insert job row with `status = 'lead'`, generated `job_number`, link to property.
4. **Return:** Full job object including `job_number`, `property_id`, all fields.

If any step fails, the entire transaction rolls back — no orphaned properties or phantom customer updates.

**Request body (extended):**
```json
{
  "property_id": "uuid | null",
  "address_line1": "123 Main St",
  "city": "Warren",
  "state": "MI",
  "zip": "48089",
  "customer_name": "John Smith",
  "customer_phone": "5551234567",
  "customer_email": "john@example.com",
  "job_type": "mitigation",
  "loss_date": "2026-04-14",
  "is_emergency": false,
  "notes": "Gate code 1234"
}
```

- `property_id` present → existing property, update customer info if changed
- `property_id` null → create new property from address fields
- `job_type` required, validated against enum
- `is_emergency = true` and no `loss_date` → set `loss_date = CURRENT_DATE`
- Returns `status = 'lead'` and generated `job_number`

### Checklist
- [ ] Radio button group for job type: Water / Fire / Mold / Reconstruction
- [ ] Large tap areas on radio buttons (48px minimum)
- [ ] No default selection — requires explicit choice
- [ ] Emergency Call checkbox
- [ ] Checking emergency auto-sets loss_date to today
- [ ] `is_emergency` column added to `jobs` table
- [ ] `job_number` column with `UNIQUE(company_id, job_number)` constraint
- [ ] `job_number` generated server-side as `JOB-{YYYY}-{MMDD}-{NN}`
- [ ] `lead` added to job status enum
- [ ] `POST /v1/jobs` is atomic: property create/update + job create in single transaction
- [ ] `POST /v1/jobs` creates new property when no `property_id` provided
- [ ] `POST /v1/jobs` updates customer info when `property_id` provided and info differs
- [ ] `POST /v1/jobs` defaults status to `lead`
- [ ] `POST /v1/jobs` accepts `job_type` and `is_emergency`
- [ ] pytest: job created with status `lead` and valid `job_number`
- [ ] pytest: `job_number` follows `JOB-YYYY-MMDD-NN` format
- [ ] pytest: sequential jobs on same day get incrementing numbers
- [ ] pytest: emergency flag sets loss_date when not provided
- [ ] pytest: job_type validation rejects invalid types
- [ ] pytest: `lead` status works in status transitions
- [ ] pytest: new property auto-created when `property_id` is null
- [ ] pytest: customer info updated when `property_id` provided with different data
- [ ] pytest: transaction rolls back fully on any error

---

## Phase 4: Validation, UX Polish, Mobile

### Required Fields (7 total)

| Field | Input Type | Keyboard (mobile) |
|---|---|---|
| Street Address | text | default |
| City | text | default |
| State | select (2-letter) | — |
| ZIP Code | text (5 digits) | `inputMode="numeric"` |
| Customer Name | text | default |
| Phone | tel | `inputMode="tel"` |
| Job Type | radio group | — |

Optional: Email (`inputMode="email"`), Loss Date (date picker), Emergency checkbox, Notes (textarea)

### Validation Behavior

**On submit with missing required fields:**
- Highlight empty required fields in red
- Show error banner at top: "Please complete all required fields"
- Focus first empty required field
- Do NOT submit

**Non-blocking address warning:**
- If address can't be verified (no match in properties, unusual format): yellow warning banner
- Text: "Address could not be verified. Please confirm it's correct."
- Warning is `bg-yellow-50 text-yellow-800` — informational, does NOT block submit
- Brett's reasoning: emergency calls can't wait, rural routes / new construction have weird addresses

**Same phone at different address:**
- If phone matches a customer at a different property: info banner
- Text: "This phone number is associated with another property: [address]. Is this the same customer?"
- `bg-blue-50 text-blue-800` — informational, does NOT block submit
- Reasoning: property managers, people who move

### Phone Number Formatting

Auto-format as user types:
- `5551234567` → `(555) 123-4567`
- `555-123-4567` → `(555) 123-4567`
- Strip to digits on submit, display formatted

### Date Picker

- Calendar popup on click
- Cannot select future dates (max date = today)
- If Emergency checkbox is checked, date defaults to today

### Double-Click Prevention

- "Create Job" button disables on first click
- Shows "Creating..." with spinner
- Re-enables only on error

### Cancel Button

- If no fields have data: navigate back to `/jobs`, no confirmation
- If any field has data: show `<ConfirmModal>` — "Discard changes? This job will not be saved." with "Discard" / "Keep Editing" buttons

### All Inputs

- `onFocus={(e) => e.target.select()}` on all text inputs (per CLAUDE.md design conventions)

### Visual Design

- Required field asterisks: red `text-red-500`
- Previous Jobs card: `bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg`
- Error banner: `bg-red-50 text-red-700 border border-red-200`
- Warning banner: `bg-yellow-50 text-yellow-800 border border-yellow-200`
- Info banner: `bg-blue-50 text-blue-800 border border-blue-200`
- Success toast: `bg-green-50 text-green-700`
- Section spacing: clear separation between Property Info → Customer Info → Previous Jobs → Job Details
- Buttons: follow CLAUDE.md conventions (desktop `h-9 rounded-lg`, mobile `h-10 rounded-full`)

### Checklist
- [ ] 7 required fields validated on submit
- [ ] Missing fields highlighted red with error banner + focus-first
- [ ] Non-blocking yellow warning on unverifiable address
- [ ] Same-phone-different-address info message
- [ ] Phone auto-formats to `(555) 123-4567`
- [ ] Date picker: no future dates, emergency auto-sets today
- [ ] Double-click prevention with "Creating..." spinner
- [ ] Cancel: no-data → navigate, has-data → `<ConfirmModal>`
- [ ] `onFocus` select-all on every text input
- [ ] Mobile: correct `inputMode` on phone, email, zip
- [ ] Mobile: 48px touch targets on all interactive elements
- [ ] Mobile: full-width buttons
- [ ] Redirect to `/jobs/{id}` on success with toast
- [ ] Visual design matches color coding spec (red errors, yellow warnings, blue info)

---

## Cross-References

| Spec | Relationship |
|------|-------------|
| Spec 01 (Jobs) | This replaces Phase 3's create form. Existing endpoints still used for job CRUD. |
| Spec 01E (Job Type Extensions) | `fire_smoke` and `reconstruction` job types referenced in radio buttons |
| Spec 04A (Dashboard) | Job list links to create form via "+ New Job" button |

## Decision Log

| # | Decision | Reasoning |
|---|----------|-----------|
| 1 | Internal property search over Google Maps | Brett's spec: "searches addresses we've been to before." Company data is the primary source — saves API costs, faster, privacy-friendly. Google Maps can be a fallback for brand-new addresses in a future phase. |
| 2 | `lead` status instead of `new` | Brett's spec: "Sets status to Lead (new opportunity, not contracted yet)." Adds a pre-qualification stage before `new`. |
| 3 | 7 required fields (up from 2) | Brett's spec lists explicit required fields. More friction but better data quality — contractors are on the phone with the customer when creating. |
| 4 | Non-blocking address validation | Brett's reasoning: "emergency calls can't wait" + rural routes / new construction have non-standard addresses. Yellow warning, not red error. |
| 5 | Latest customer info always wins | Brett's reasoning: people change numbers, houses sell, property managers rotate. No confirmation prompt — just update silently. |

---

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1 (Property Search API + Autocomplete component)
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

---

## Decisions & Notes

Key decisions with rationale. Append-only as implementation progresses. See the Decision Log table above for the initial set captured during spec authoring.
