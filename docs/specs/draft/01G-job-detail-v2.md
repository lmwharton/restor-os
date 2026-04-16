# Spec 01G: Job Detail Page v2 — Summary Card, Status Gates, Tab Restructure, Estimates, Documentation, Timeline, Milestones

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/7 phases) |
| **State** | Draft |
| **Blocker** | None |
| **Branch** | TBD |
| **Issue** | TBD |
| **Depends on** | Spec 01 (Jobs — complete), Spec 01F (Create Job v2 — draft), Spec 01E (Job Type Extensions — draft) |

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
- **Brett's spec:** [`docs/research/job-detail-spec-v1.pdf`](../../research/job-detail-spec-v1.pdf) — "Job Detail Page — Product Specification v1.0" (April 13, 2026)
- **Current implementation:** Spec 01 Phase 3 (complete) — basic job detail with tabs: Overview | Site Log | Photos | Report
- **Current frontend:** `web/src/app/(protected)/jobs/[id]/page.tsx`

## Done When
- [ ] Job Summary Card shows job_number, job type, status dropdown (valid-next-only), address, customer, dates, crew
- [ ] Status transitions enforced with gate rules (signed estimate, after photo, invoice)
- [ ] Tab navigation restructured: Overview | Estimate | Documentation | Timeline + conditional tabs per job type
- [ ] Estimate Tab shows empty state or estimate summary with versioning + signed/locked state
- [ ] Documentation Tab combines photos (with Before/During/After filters) + voice notes + uploaded documents
- [ ] Timeline Tab shows full audit trail grouped by day
- [ ] Milestones Tab (reconstruction only) tracks project progress with 3-state milestones
- [ ] Mobile: camera-first photo upload, simplified summary card, stacked action buttons
- [ ] Brett's success criteria met: view job at a glance, change status with validation, conditional tabs per job type

## What Changes from Current Implementation

Current (Spec 01 Phase 3):
- Tabs: Overview | Site Log | Photos | Report
- Overview: all fields editable inline, activity timeline at bottom
- Status: free-form change, no validation gates
- No estimate system, no documentation hub, no milestones

This spec (v2):
- **Tabs restructured:** Overview | Estimate | Documentation | Timeline + conditional (Equipment, Moisture Readings, Certificate for mitigation; Materials, Allowances, Milestones for reconstruction)
- **Job Summary Card** at top with job_number, status dropdown, quick actions
- **Status transition gates** — can't skip statuses, each transition has prerequisites
- **Estimate Tab** — placeholder for builder + versioning, signed state, change orders
- **Documentation Tab** — unified photos + voice notes + documents
- **Timeline Tab** — dedicated audit trail (moved out of Overview)
- **Milestones Tab** — reconstruction project progress

**What this spec does NOT implement (deferred to other specs with Brett's UX requirements):**

- **Estimate Builder** (the full line-item editor) — the Estimate Tab here covers the shell, empty/summary states, and version management. The actual estimate creation/editing flow is a separate future spec.

- **Equipment Tab** — covered by Spec 04C. Brett's PDF adds these requirements to forward:
  - "Currently On-Site" section grouped by type (Air Movers, Dehumidifiers, Air Scrubbers) with room + deploy date per unit
  - "Equipment Log" table with columns: Equipment, Location, Deployed, Removed, Days
  - Billable days auto-calculated (per-day rental billing)
  - Add Equipment flow: select type → enter room → system logs deploy date (defaults today)
  - Remove Equipment flow: click Remove → system logs removal date → moves to Equipment Log

- **Moisture Readings Tab** — enhancement to Spec 01's existing moisture UI. Brett's PDF adds:
  - Moisture Map visual: per-room value + status icon (✓ Dry 0-12%, △ Elevated 13-15%, ✗ Wet 16%+) with legend
  - Readings History table: date rows, per-room columns with value + status icon, notes column
  - Optional graph view: line chart showing moisture % over time per room (declining = good)
  - Record New Reading flow: select room → enter % → optional note → timestamp auto-logged

- **Certificate Tab** — covered by Spec 04C Phase 2. Brett's PDF adds:
  - Requirements checklist shown before generate button (✓ Job marked as Completed, ✓ Final moisture readings recorded, ✗ Certificate generated)
  - Generate button only enabled when all requirements met
  - Generated certificate PDF must include: company letterhead, job details (address, dates, work performed), compliance citations (IICRC S500, EPA, OSHA as applicable), final moisture readings, equipment used, contractor signature, certificate number
  - Actions: View PDF, Download, Email to Customer

- **Materials Tab** — covered by Spec 01E. Brett's PDF adds:
  - Material selections with category (Flooring, Cabinets, Countertops, Paint, etc.)
  - Per-selection: product name/description, supplier, status pipeline (Selected → Ordered → Delivered → Installed)
  - Optional: upload photo or spec sheet per material
  - Purpose: documents homeowner choices to prevent disputes

- **Allowances Tab** — covered by Spec 01E. Brett's PDF adds:
  - Per-category cards: category name, Budget amount, Spent amount, Remaining amount
  - Progress bar per category showing % spent
  - Overage warning: yellow △ when spent > budget, shows "$ over budget"
  - Add Allowance flow: category name → budget amount → track actual spend as invoices/receipts come in

---

## Phase 1: Job Summary Card + Status Transition Gates

### Job Summary Card (Always Visible)

Replaces the current basic job header. Always visible at top of job detail page, above tabs.

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ ← Back to Jobs                        [Edit Job] [▼]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  JOB-2026-0413-01              Status: [Lead ▼]        │
│  Water Damage Restoration                               │
│                                                         │
│  📍 123 Main St, Warren MI 48089                        │
│  👤 John Smith • (555) 123-4567 • john@email.com       │
│                                                         │
│  Created: 4/13/26 • Scheduled: Not set • Started: —    │
│  Loss Date: 4/10/26 • Emergency: Yes                   │
│                                                         │
│  Assigned Crew: Brett, Tech 1                           │
├─────────────────────────────────────────────────────────┤
│  [Create Estimate]  [Add Photos]  [Change Status]       │
└─────────────────────────────────────────────────────────┘
```

**Fields displayed:**
- `job_number` (from Spec 01F) — e.g., JOB-2026-0413-01
- Job type label — "Water Damage Restoration" / "Fire Damage Restoration" / "Mold Remediation" / "Reconstruction"
- Status dropdown — shows current status, click to change (valid next statuses only)
- Address — from linked property
- Customer — name, phone, email (clickable: phone → tel:, email → mailto:)
- Dates row — created, scheduled, started (auto-set on status change to in_progress)
- Loss date + emergency flag
- Assigned crew — list of team members assigned to this job

**Action Buttons:**
- **Create Estimate** → opens estimate builder (future spec). If estimate exists, shows "View Estimate" instead.
- **Add Photos** → opens photo upload. On mobile, opens camera directly (not file picker).
- **Change Status** → same as clicking status dropdown

**Edit Job Button (top right):**
- Opens editable form overlay with all job fields (address, customer, job type, dates, notes)
- Save → returns to job detail with updated data
- Cancel → discards changes, stays on job detail
- Uses `<ConfirmModal>` if unsaved changes on cancel

**Kebab Menu (▼ next to Edit Job):**
- Delete Job (with confirmation)
- Print Job Summary
- Share Job (copy link)

### Status Transition Gates

Brett's spec defines a strict status pipeline where you can't skip statuses and certain transitions require prerequisites.

**Status Pipeline:**
```
lead → scheduled → in_progress → completed → invoiced → closed
```

**Valid Next Statuses (dropdown only shows these):**

| Current Status | Valid Next | Can also go to |
|---|---|---|
| `lead` | `scheduled`, `cancelled` | — |
| `scheduled` | `in_progress`, `lead` (back), `cancelled` | — |
| `in_progress` | `completed`, `scheduled` (paused) | — |
| `completed` | `invoiced`, `in_progress` (reopen) | — |
| `invoiced` | `closed`, `completed` (reopen) | — |
| `closed` | — (terminal) | — |
| `cancelled` | `lead` (reopen) | — |

**Gate Rules (prerequisites per transition):**

| Transition | Requirement | Error if not met |
|---|---|---|
| `lead → scheduled` | Signed estimate exists | "Cannot change to Scheduled. This job needs a signed estimate." + [Create Estimate Now] button |
| `in_progress → completed` | At least one "after" photo uploaded | "Cannot mark as Completed. This job needs at least one 'after' photo." + [Add Photos] button |
| `completed → invoiced` | Invoice generated | "Cannot mark as Invoiced. This job needs an invoice." + [Generate Invoice] button |

**When status changes:**
1. Backend validates the transition is allowed (valid next status)
2. Backend checks gate rules (prerequisites)
3. If requirements not met → 422 with error message + suggested action
4. If requirements met → status updates immediately
5. Timeline logs the change with timestamp and who made it
6. (Future) Notification sent to customer, crew, PA if applicable

**Backend — Status Transition Endpoint:**

```
PATCH /v1/jobs/{job_id}/status
```

**Request:**
```json
{
  "status": "scheduled"
}
```

**Success Response (200):**
```json
{
  "job_id": "uuid",
  "status": "scheduled",
  "previous_status": "lead",
  "changed_by": "user_id",
  "changed_at": "2026-04-14T10:00:00Z"
}
```

**Gate Failure Response (422):**
```json
{
  "error": "status_gate_failed",
  "message": "Cannot change to Scheduled. This job needs a signed estimate.",
  "gate": "signed_estimate_required",
  "action": {
    "label": "Create Estimate Now",
    "route": "/jobs/{job_id}?tab=estimate"
  }
}
```

**Backend — Crew Assignment:**

```sql
-- Crew assignment table (many-to-many: jobs ↔ team_members)
CREATE TABLE job_crew (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id),
    company_id uuid NOT NULL REFERENCES companies(id),
    assigned_at timestamptz DEFAULT now(),
    UNIQUE(job_id, user_id)
);
```

```
GET /v1/jobs/{job_id}/crew          — list assigned crew
POST /v1/jobs/{job_id}/crew         — assign team member { "user_id": "uuid" }
DELETE /v1/jobs/{job_id}/crew/{id}  — remove team member
```

**RLS policies:**
```sql
CREATE POLICY job_crew_select ON job_crew FOR SELECT
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_crew_insert ON job_crew FOR INSERT
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_crew_update ON job_crew FOR UPDATE
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_crew_delete ON job_crew FOR DELETE
    USING (company_id = current_setting('app.company_id')::uuid);
```

### Checklist
- [ ] Job Summary Card component with all fields (job_number, type, status, address, customer, dates, crew)
- [ ] Status dropdown shows only valid next statuses
- [ ] Status transition validation endpoint `PATCH /v1/jobs/{id}/status`
- [ ] pytest: valid transitions accepted (lead→scheduled, etc.)
- [ ] pytest: invalid transitions rejected (lead→completed = 422)
- [ ] pytest: gate rules enforced (lead→scheduled without estimate = 422)
- [ ] pytest: gate failure response includes action with route
- [ ] Action buttons: Create Estimate, Add Photos, Change Status
- [ ] Edit Job overlay with save/cancel + unsaved changes confirmation (uses `PATCH /v1/jobs/{id}` from Spec 01)
- [ ] Kebab menu: Delete, Print, Share
- [ ] `job_crew` table with CRUD endpoints
- [ ] pytest: crew assignment CRUD with RLS
- [ ] Customer phone clickable (tel:), email clickable (mailto:)
- [ ] Dates auto-update: `started_at` set when status → `in_progress`
- [ ] Mobile: summary card collapses to essential info, action buttons stack vertically

---

## Phase 2: Tab Restructure + Overview Tab v2

### Tab Navigation

Replace current tabs (Overview | Site Log | Photos | Report) with a new tab structure that adapts based on job type.

**Core tabs (all job types):**
```
[Overview]  [Estimate]  [Documentation]  [Timeline]  [...]
```

**Additional tabs by job type:**

| Job Type | Extra Tabs |
|---|---|
| Water Damage (mitigation) | Equipment, Moisture Readings, Certificate |
| Fire Damage (fire_smoke) | Equipment, Certificate |
| Mold Remediation (mitigation) | Equipment, Certificate |
| Reconstruction | Materials, Allowances, Milestones |

**Tab behavior:**
- Desktop: all tabs visible in horizontal bar
- Mobile: horizontal scrollable tab bar (swipe to see more tabs)
- Active tab has bottom border indicator
- Tab count badge for tabs with content (e.g., "Documentation (12)" = 12 photos)

### Overview Tab v2

The Overview tab becomes a read-friendly summary. Editing moves to the Edit Job overlay.

**Sections:**

**Job Summary Section:**
- Job type with badge
- Status with history (when it changed, who changed it) — last 3 changes shown, "View all" links to Timeline tab
- Key dates: created, scheduled start, actual start, completion, invoice, payment
- Assigned crew members
- Notes (internal, editable inline)

**Customer Information Section:**
- Name, phone (clickable), email (clickable)
- Property address
- "View all jobs at this property" link → navigates to `/jobs?property_id={id}` (filtered job list). Uses existing `GET /v1/jobs` endpoint with new `property_id` query param filter.

**Insurance Information Section (if applicable):**
- Insurance company name
- Claim number
- Adjuster name and contact info
- Only shows if this is an insurance job (has claim_number or carrier set)

**Quick Stats (mitigation jobs only):**
- Days on-site: X days (calculated from started_at to now or completed_at)
- Equipment deployed: X air movers, X dehumidifiers
- Moisture readings: latest reading and trend (increasing/decreasing/stable)

### Checklist
- [ ] Tab navigation component with conditional tabs per job type
- [ ] Horizontal scrollable tabs on mobile
- [ ] Tab count badges (photo count, etc.)
- [ ] Overview tab: Job Summary section with status history (last 3)
- [ ] Overview tab: Customer Information with clickable phone/email
- [ ] Overview tab: "View all jobs at this property" link → `/jobs?property_id={id}`
- [ ] `GET /v1/jobs` extended with optional `property_id` query param filter
- [ ] Overview tab: Insurance section (conditional — only if insurance fields set)
- [ ] Overview tab: Quick Stats for mitigation (days on-site, equipment count, moisture trend)
- [ ] Notes field editable inline on Overview
- [ ] Edit Job overlay accessible from summary card (not from Overview tab)

---

## Phase 3: Estimate Tab

The Estimate Tab provides a hub for managing estimates within the job detail page. The actual estimate builder (line-item editor) is a separate future spec — this phase covers the tab shell, empty state, summary view, versioning, and signed state.

### When No Estimate Exists

```
┌─────────────────────────────────────────────────┐
│                                                 │
│          No estimate created yet                │
│                                                 │
│          [Create Estimate]                      │
│                                                 │
└─────────────────────────────────────────────────┘
```

- Empty state with CTA button
- "Create Estimate" opens the estimate builder (future spec — for now, placeholder page or disabled with "Coming soon")

### When Estimate Exists — Summary View

**Estimate summary card:**
- Estimate number: `EST-{YYYY}-{MMDD}-{NN}` (same format pattern as job_number from Spec 01F)
- Created date
- Estimate mode: Retail / Insurance-Priced / Insurance-Unpriced
- Total amount (formatted as currency)
- Status: Draft / Sent / Signed

**Action buttons:**
- **View Estimate** → opens estimate in read-only view
- **Edit Estimate** → opens estimate builder (if not signed)
- **Send Estimate** → email or download PDF
- **Mark as Signed** → converts to contract, moves job to "Scheduled" status

### When Estimate is Signed (Locked)

- Shows "Contract Signed: [Date]"
- Estimate is locked — view-only, no edits
- Button: "Create Change Order" (if scope changes after signing)

### Multiple Estimate Versions

- List of all versions with which is "Active" vs "Superseded"
- Only the active version counts toward job totals
- Superseded versions kept for audit trail

### Database Schema

```sql
CREATE TABLE estimates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id),
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    estimate_number VARCHAR NOT NULL,
    mode VARCHAR NOT NULL CHECK (mode IN ('retail', 'insurance_priced', 'insurance_unpriced')),
    status VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'superseded')),
    total_amount numeric(12,2) DEFAULT 0,
    version integer NOT NULL DEFAULT 1,
    is_active boolean NOT NULL DEFAULT true,
    signed_at timestamptz,
    signed_by_name VARCHAR,  -- customer name as written on signature (not a user FK)
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(company_id, estimate_number)
);

-- RLS policies
CREATE POLICY estimates_select ON estimates FOR SELECT
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY estimates_insert ON estimates FOR INSERT
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY estimates_update ON estimates FOR UPDATE
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY estimates_delete ON estimates FOR DELETE
    USING (company_id = current_setting('app.company_id')::uuid);

-- Only one active estimate per job
CREATE UNIQUE INDEX idx_estimates_active_job
    ON estimates (job_id)
    WHERE is_active = true AND status != 'superseded';
```

### API Endpoints

```
GET /v1/jobs/{job_id}/estimates              — list all estimates (versions) for job
POST /v1/jobs/{job_id}/estimates             — create new estimate (auto-generates estimate_number)
GET /v1/jobs/{job_id}/estimates/{id}         — get estimate detail
PATCH /v1/jobs/{job_id}/estimates/{id}       — update estimate (mode, total, etc.)
POST /v1/jobs/{job_id}/estimates/{id}/send   — mark as sent (email/PDF — future)
POST /v1/jobs/{job_id}/estimates/{id}/sign   — mark as signed, lock estimate, optionally advance job to scheduled
POST /v1/jobs/{job_id}/estimates/{id}/change-order — create new version, supersede current
```

**Estimate number generation:** Same pattern as job_number — `EST-{YYYY}-{MMDD}-{NN}`, server-side, per-company per-day sequence.

**No DELETE endpoint:** Estimates cannot be deleted for audit trail reasons. Unwanted estimates should be superseded via change order.

**Send endpoint scope:** `POST .../send` ships now as a status-change-only action (marks estimate as `sent` in the database). Actual email delivery is a future enhancement — for now, the frontend offers "Download PDF" as the delivery mechanism.

### Checklist
- [ ] `estimates` table with full schema, RLS policies, active-job unique index
- [ ] `GET /v1/jobs/{id}/estimates` — list estimates
- [ ] `POST /v1/jobs/{id}/estimates` — create with auto-generated estimate_number
- [ ] `PATCH /v1/jobs/{id}/estimates/{id}` — update (mode, total)
- [ ] `POST /v1/jobs/{id}/estimates/{id}/sign` — lock + optionally advance job status
- [ ] `POST /v1/jobs/{id}/estimates/{id}/change-order` — supersede + create new version
- [ ] pytest: estimate CRUD with RLS
- [ ] pytest: estimate_number follows EST-YYYY-MMDD-NN format
- [ ] pytest: sign locks estimate (no further edits)
- [ ] pytest: change-order supersedes old, creates new active version
- [ ] pytest: only one active estimate per job (unique index)
- [ ] Estimate Tab empty state with "Create Estimate" CTA
- [ ] Estimate Tab summary view (number, date, mode, total, status)
- [ ] Action buttons: View, Edit (if not signed), Send, Mark as Signed
- [ ] Signed state: locked view with "Contract Signed: [date]" + Change Order button
- [ ] Version list showing Active vs Superseded

---

## Phase 4: Documentation Tab

Replaces the current standalone Photos tab. Combines photos, voice notes, and uploaded documents into a single Documentation hub.

### Photo Gallery Section

**Filter bar:**
```
[All Photos]  [Before]  [During]  [After]    🔍 Search
```

- Filter by phase: Before / During / After (photo `phase` field)
- Search by room name or voice note transcript
- Photos grouped by room and date
- Click photo → lightbox with full-size image and metadata (timestamp, room/area, voice note if attached)

**Photo metadata shown:**
- Timestamp
- Room/area
- Voice note (if any) — play button inline
- Phase tag (Before/During/After)

**Upload Photos button:**
- Desktop: file picker (multi-select)
- Mobile: opens camera directly (not file picker) → immediately prompts for voice note → "Talk, Snap, Done" workflow
- Photos auto-tagged with job ID, timestamp, GPS

### Voice Notes Section

List of all voice notes for this job:
- Timestamp, duration, transcription preview (first line)
- Click to play audio
- Shows which photo it's attached to (if any) — click to jump to photo
- Standalone voice notes (not attached to photos) also listed

### Documents Section

Uploaded files for this job:
- IH test results (mold jobs)
- Insurance claim documents
- Signed contracts
- Any PDFs uploaded manually

**Upload flow:**
- "Upload Document" button → file picker
- Supported: PDF, DOC, DOCX, JPG, PNG
- Each document shows: filename, upload date, uploaded by, file size
- Click to view/download

### Database Schema

```sql
-- Voice notes table (photos table already exists in Spec 01)
CREATE TABLE voice_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id),
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    photo_id uuid REFERENCES job_photos(id) ON DELETE SET NULL,
    audio_url text NOT NULL,
    duration_seconds integer,
    transcript text,
    created_at timestamptz DEFAULT now()
);

-- Job documents table
CREATE TABLE job_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id),
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    filename VARCHAR NOT NULL,
    file_url text NOT NULL,
    file_size integer,
    mime_type VARCHAR,
    uploaded_by uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now()
);

-- RLS for both tables
CREATE POLICY voice_notes_select ON voice_notes FOR SELECT
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY voice_notes_insert ON voice_notes FOR INSERT
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY voice_notes_update ON voice_notes FOR UPDATE
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY voice_notes_delete ON voice_notes FOR DELETE
    USING (company_id = current_setting('app.company_id')::uuid);

CREATE POLICY job_documents_select ON job_documents FOR SELECT
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_documents_insert ON job_documents FOR INSERT
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_documents_update ON job_documents FOR UPDATE
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_documents_delete ON job_documents FOR DELETE
    USING (company_id = current_setting('app.company_id')::uuid);
```

### API Endpoints

**Photos (extend existing Spec 01 endpoints):**
- Add `phase` filter: `GET /v1/jobs/{id}/photos?phase=before`
- Add `phase` field to photo upload: `POST /v1/jobs/{id}/photos` body includes `{ "phase": "before" }`

**Voice Notes:**
```
GET /v1/jobs/{job_id}/voice-notes             — list all voice notes
POST /v1/jobs/{job_id}/voice-notes            — upload voice note (audio file + optional photo_id)
GET /v1/jobs/{job_id}/voice-notes/{id}        — get voice note detail + transcript
DELETE /v1/jobs/{job_id}/voice-notes/{id}     — delete voice note
```

**Documents:**
```
GET /v1/jobs/{job_id}/documents               — list all documents
POST /v1/jobs/{job_id}/documents              — upload document (file)
GET /v1/jobs/{job_id}/documents/{id}/download — download document
DELETE /v1/jobs/{job_id}/documents/{id}       — delete document
```

### Checklist
- [ ] Photo gallery with Before/During/After filter tabs
- [ ] Photo search by room name or voice note transcript
- [ ] Photos grouped by room and date
- [ ] Photo lightbox with full metadata (timestamp, room, voice note, phase)
- [ ] `phase` field added to photo upload + filter endpoint
- [ ] Voice notes section: list with timestamp, duration, transcript preview
- [ ] Click voice note → play audio
- [ ] Voice note linked to photo (if attached) — click to jump
- [ ] `voice_notes` table with full schema + RLS
- [ ] `GET/POST/DELETE /v1/jobs/{id}/voice-notes` endpoints
- [ ] pytest: voice note CRUD with RLS
- [ ] Documents section: list with filename, date, uploader, size
- [ ] Upload document flow (PDF, DOC, images)
- [ ] `job_documents` table with full schema + RLS
- [ ] `GET/POST/DELETE /v1/jobs/{id}/documents` endpoints
- [ ] pytest: document CRUD with RLS
- [ ] Mobile: "Add Photos" opens camera directly (not file picker)
- [ ] Mobile: camera → voice note prompt → "Talk, Snap, Done" flow
- [ ] Tab badge: total count of photos + voice notes + documents

---

## Phase 5: Timeline Tab

Dedicated audit trail for the job. Replaces the activity timeline currently embedded in the Overview tab.

### Layout

Events grouped by day, ordered most recent first within each day.

```
┌─────────────────────────────────────────────────┐
│  Apr 16, 2026                                   │
├─────────────────────────────────────────────────┤
│  10:45 AM • Invoice sent to customer            │
│   8:30 AM • Status changed: Completed → Invoiced│
│            (by Brett)                           │
├─────────────────────────────────────────────────┤
│  Apr 15, 2026                                   │
├─────────────────────────────────────────────────┤
│   3:15 PM • Final moisture reading: 12% (kitchen)│
│  12:00 PM • Certificate of completion generated │
│  11:45 AM • Status changed: In Progress →       │
│             Completed (by Brett)                │
├─────────────────────────────────────────────────┤
│  Apr 14, 2026                                   │
├─────────────────────────────────────────────────┤
│   9:00 AM • Daily moisture reading logged       │
│   8:45 AM • 12 photos uploaded                  │
└─────────────────────────────────────────────────┘
```

### What Gets Logged

Every significant action creates a timeline entry in the existing `event_history` table (Spec 01):

| Event | Format |
|---|---|
| Job created | "Job created (by {user})" |
| Status change | "Status changed: {old} → {new} (by {user})" |
| Estimate created | "Estimate {EST-number} created" |
| Estimate sent | "Estimate sent to {recipient}" |
| Estimate signed | "Estimate signed by customer" |
| Photos uploaded | "{count} photos uploaded" |
| Voice note recorded | "Voice note recorded ({duration}s)" |
| Equipment deployed | "Equipment deployed: {count} air movers, {count} dehumidifiers" |
| Equipment removed | "{equipment_type} removed from {room}" |
| Moisture reading | "Moisture reading: {value}% ({room})" — with trend icon |
| Document uploaded | "Document uploaded: {filename}" |
| Certificate generated | "Certificate of completion generated" |
| Invoice sent | "Invoice sent to customer" |
| Payment received | "Payment received: ${amount}" |
| Crew assigned | "{user} assigned to job" |
| Crew removed | "{user} removed from job" |

**Purpose:** Full audit trail for compliance and dispute resolution. Insurance adjusters and lawyers want to see exactly what happened and when.

### Checklist
- [ ] Timeline Tab component with day-grouped event list
- [ ] Most recent events first within each day
- [ ] All event types rendered with appropriate icons and formatting
- [ ] Status changes show old → new with who made the change
- [ ] Photo events show count
- [ ] Equipment events show type and room
- [ ] Moisture events show value and trend
- [ ] Lazy loading / pagination for jobs with 100+ events
- [ ] Uses existing `event_history` table from Spec 01
- [ ] Backend: ensure all Phase 1-4 actions create event_history entries

---

## Phase 6: Milestones Tab (Reconstruction Only)

Project progress tracking for reconstruction jobs. Helps homeowners, contractors, and insurance adjusters see where things stand at a glance.

### Layout

```
┌─────────────────────────────────────────────────┐
│  Project Progress                               │
├─────────────────────────────────────────────────┤
│                                                 │
│  ✓ Demolition Complete           4/13/26        │
│  ✓ Framing Complete              4/15/26        │
│  ✓ Drywall Hung                  4/18/26        │
│  △ Drywall Finished              In Progress    │
│  ○ Paint                         Not Started    │
│  ○ Flooring                      Not Started    │
│  ○ Cabinets Installed            Not Started    │
│  ○ Final Walkthrough             Not Started    │
│                                                 │
│  Overall Progress: 50%                          │
│  ████████████░░░░░░░░░░░░                       │
├─────────────────────────────────────────────────┤
│           [Add Milestone]                       │
└─────────────────────────────────────────────────┘
```

### Milestone Statuses

| Icon | Status | Color | Shows |
|---|---|---|---|
| ○ | Not Started | gray | — |
| △ | In Progress | yellow | "In Progress" |
| ✓ | Complete | green | completion date |

### Database Schema

```sql
CREATE TABLE job_milestones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id),
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    title VARCHAR NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'complete')),
    sort_order integer NOT NULL DEFAULT 0,
    completed_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- RLS policies
CREATE POLICY job_milestones_select ON job_milestones FOR SELECT
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_milestones_insert ON job_milestones FOR INSERT
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_milestones_update ON job_milestones FOR UPDATE
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_milestones_delete ON job_milestones FOR DELETE
    USING (company_id = current_setting('app.company_id')::uuid);
```

### API Endpoints

```
GET /v1/jobs/{job_id}/milestones             — list milestones (ordered by sort_order)
POST /v1/jobs/{job_id}/milestones            — add milestone { "title": "...", "sort_order": N }
PATCH /v1/jobs/{job_id}/milestones/{id}      — update (title, status, sort_order)
DELETE /v1/jobs/{job_id}/milestones/{id}     — remove milestone
```

**Status change behavior:**
- Setting status to `complete` auto-sets `completed_at = now()`
- Setting status back to `in_progress` or `not_started` clears `completed_at`

**Overall progress:** Calculated client-side — `(completed count / total count) * 100`

**Default milestones for new reconstruction jobs:**
When a reconstruction job is created, auto-create these milestones:
1. Demolition Complete
2. Framing Complete
3. Drywall Hung
4. Drywall Finished
5. Paint
6. Flooring
7. Cabinets Installed
8. Final Walkthrough

User can add/remove/reorder as needed.

### Checklist
- [ ] `job_milestones` table with full schema + RLS
- [ ] `GET/POST/PATCH/DELETE /v1/jobs/{id}/milestones` endpoints
- [ ] pytest: milestone CRUD with RLS
- [ ] pytest: completing a milestone sets `completed_at`
- [ ] pytest: reopening a milestone clears `completed_at`
- [ ] Default milestones auto-created on reconstruction job creation
- [ ] Milestones Tab with 3-state icons (○ △ ✓) and color coding
- [ ] Overall progress bar with percentage
- [ ] "Add Milestone" button
- [ ] Drag-to-reorder milestones (or up/down arrows on mobile)
- [ ] Click milestone to toggle status: not_started → in_progress → complete
- [ ] Tab only visible for reconstruction jobs

---

## Phase 7: Mobile Optimizations

### Photo Upload (Mobile)

Brett's spec: "On mobile, 'Add Photos' button opens camera directly (not file picker) → Immediately prompts for voice note → 'Talk, Snap, Done' workflow"

**Flow:**
1. Tap "Add Photos" → opens device camera (via `capture="environment"` on input)
2. Take photo → photo saved with job ID, timestamp, GPS
3. Immediately shows voice note prompt: "Add a voice note?" with record button
4. Record voice note (or skip) → voice note linked to photo, transcription runs async
5. Return to Documentation tab — new photo + voice note appear

**Auto-tagging:**
- Photos get `job_id`, `created_at` (timestamp), GPS coordinates (if device allows)
- Room/area can be tagged after capture or inferred from previous photos

### Simplified View

On small screens (< 640px):
- Job Summary Card collapses to essential info only (job_number, status, address, customer name + phone)
- Tap to expand full card
- Tabs become horizontally scrollable (swipe)
- Action buttons stack vertically
- All touch targets 48px minimum

### Checklist
- [ ] Mobile photo upload opens camera directly (not file picker)
- [ ] Voice note prompt after photo capture
- [ ] "Talk, Snap, Done" flow end-to-end
- [ ] Auto-tagging: job_id, timestamp, GPS
- [ ] Summary card collapsed state on mobile (tap to expand)
- [ ] Tabs horizontally scrollable on mobile (swipe to reveal more)
- [ ] Action buttons stack vertically on mobile
- [ ] 48px minimum touch targets throughout

---

## Cross-References

| Spec | Relationship |
|------|-------------|
| Spec 01 (Jobs) | This replaces Phase 3's job detail page. Existing photo/moisture/equipment endpoints extended. |
| Spec 01E (Job Type Extensions) | Materials + Allowances tabs use 01E's `job_selections` schema. Supplier/status pipeline should be added to 01E. |
| Spec 01F (Create Job v2) | Job number format (JOB-YYYY-MMDD-NN) defined in 01F, displayed in summary card. |
| Spec 03 (Voice) | Voice note recording + transcription pipeline. Documentation Tab integrates voice notes. |
| Spec 04C (Equipment & Certification) | Equipment Tab uses 04C's equipment library. Certificate Tab uses 04C's drying certificate. Brett's billable-days + requirements checklist UX should be added to 04C. |
| Spec 10 (Reports) | Reports generated from job data feed into Documentation Tab as downloadable documents. |

## Decision Log

| # | Decision | Reasoning |
|---|----------|-----------|
| 1 | Estimate builder is a placeholder in Phase 3 | Brett calls it "future spec" in his action buttons. The tab shell + summary/versioning/signed state can be built without the line-item editor. |
| 2 | Status gates are backend-enforced, not frontend-only | Frontend shows only valid next statuses, but backend also validates. Prevents API callers from bypassing rules. |
| 3 | Documentation Tab replaces Photos tab | Brett groups photos + voice notes + documents together. Single tab is easier to find than 3 separate ones. |
| 4 | Timeline is its own tab, not part of Overview | Brett's spec explicitly shows 4 core tabs. Dedicated tab gives timeline room to show full audit history without cluttering Overview. |
| 5 | Default milestones auto-created for reconstruction | Common reconstruction phases are predictable. Auto-creating saves time. User can customize. |
| 6 | Equipment/Moisture/Certificate tabs NOT in this spec | Already covered by Spec 01 and 04C. This spec handles the tab shell that includes them, not their internal implementation. |

---

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1 (Job Summary Card + status transition gates)
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

---

## Decisions & Notes

Key decisions with rationale. Append-only as implementation progresses. See the Decision Log table above for the initial set captured during spec authoring.
