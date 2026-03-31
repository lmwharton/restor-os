# Spec 01B: Job Types — Mitigation + Reconstruction

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% |
| **State** | Draft — awaiting eng + design review |
| **Blocker** | None |
| **Branch** | — |
| **Issue** | — |
| **Depends on** | Spec 01 (Jobs + Site Log) — complete |

## Done When
- [ ] Jobs have a `job_type` field: `"mitigation"` or `"reconstruction"`
- [ ] Mitigation jobs retain existing 7-stage pipeline (no changes to Spec 01 behavior)
- [ ] Reconstruction jobs have their own status pipeline: `new → scoping → in_progress → complete → submitted → collected`
- [ ] Reconstruction jobs have a flexible phase/task system (not hardcoded stages)
- [ ] Job creation form shows a job type selector (Mitigation / Reconstruction)
- [ ] Reconstruction jobs can optionally link to a mitigation job via `linked_job_id`
- [ ] When linking, claim/carrier/adjuster/customer/address data auto-copies from the mitigation job
- [ ] Reconstruction jobs can be created standalone (no linked mitigation job required)
- [ ] Job list shows job type badge (MIT / REC) and link icon for linked pairs
- [ ] Dashboard pipeline shows separate pipelines or combined view with type distinction
- [ ] Reconstruction job detail has appropriate sections (no moisture readings, no equipment tracking)
- [ ] Backend API supports job type filtering (`GET /v1/jobs?job_type=reconstruction`)
- [ ] Reconstruction report (PDF) has appropriate sections: job info, phases completed, photos, tech notes (no moisture readings, no equipment log, no GPP)
- [ ] All existing mitigation functionality remains unchanged (zero regression)
- [ ] Database migration adds `job_type` + `linked_job_id` columns to jobs table
- [ ] Reconstruction-specific table created (recon_phases)
- [ ] All backend endpoints have pytest coverage
- [ ] Frontend tests pass

## Overview

**Problem:** Crewmatic currently only supports mitigation (water damage restoration) jobs. But 80% of mitigation contractors also handle reconstruction (insurance repair) — rebuilding what was torn out during mitigation. These are separate invoices, separate pipelines, often separate crews, with a 2-3 week gap between phases. Today these contractors track reconstruction in spreadsheets, paper, or completely separate software.

**Solution:** Add `reconstruction` as a first-class job type alongside `mitigation`. Each type has its own status pipeline, its own relevant sections, and its own financial tracking. Jobs can optionally link together when they share a claim, auto-copying header data (claim number, carrier, adjuster, customer, address) to avoid re-entry.

**Why two jobs, not one job with modes:** Validated via 9-question interview with Brett Sodders (see `docs/research/competitive-analysis.md`, Appendix C). Key findings:
- Always separate invoices to the carrier (R1)
- Same company but different crews/subs (R2)
- 2-3 week gap between phases (R3)
- 20% are reconstruction-only (no prior mitigation) (R4)
- Only header data is shared — zero work data crosses over (R5)
- Reconstruction has no fixed pipeline — varies by job (R6)
- Adjusters expect them separated (R7)
- Separate divisions with separate P&L (40% vs 30% margins) (R9)

**Scope:**
- IN: `job_type` field, reconstruction status pipeline, flexible recon phases, job linking, updated create form, updated job list/detail, reconstruction report template (PDF), backend API changes, database migration. This is the complete end-to-end reconstruction job workflow from creation to getting paid.
- OUT: AI Scope Auditor for reconstruction (Spec 02 expansion), supplement management (Spec 02 expansion), ACV/RCV financial tracking (post-V1B), adjuster portal reconstruction view (post-V1B)

**This is the full reconstruction spec.** A contractor should be able to create a reconstruction job, track phases, take photos, write notes, and generate a reconstruction report without needing another spec.

---

## Evidence Base

All decisions in this spec are validated by Brett Sodders' reconstruction interview (March 2026). Full transcript: [`docs/research/competitive-analysis.md`, Appendix C](../research/competitive-analysis.md#appendix-c-reconstruction-interview--brett-sodders-march-2026).

Additionally references Brett's ScopeFlow Product Spec v2 (33-page document covering Restoration, Insurance Repair, Plumbing, Electrical, HVAC verticals) — filed at `/Users/lakshman/Downloads/ScopeFlow_Product_Spec_v2.pdf`. The ScopeFlow spec proposed a single-job-with-modes model; Brett's own interview answers contradicted this, leading to the two-job model in this spec.

---

## Database Schema

### Migration: Add job_type and linked_job_id to jobs table

```sql
-- Add job_type enum
-- 'mitigation' = water damage restoration (existing behavior, default)
-- 'reconstruction' = insurance repair / rebuild
ALTER TABLE jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'mitigation'
    CHECK (job_type IN ('mitigation', 'reconstruction'));

-- Link reconstruction jobs to their originating mitigation job (optional)
-- NULL = standalone job (no link)
-- When set, header data (claim, carrier, adjuster, customer, address) was copied at creation time
ALTER TABLE jobs ADD COLUMN linked_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

-- Index for fast linked-job lookups
CREATE INDEX idx_jobs_linked ON jobs(linked_job_id) WHERE linked_job_id IS NOT NULL;

-- Index for job type filtering
CREATE INDEX idx_jobs_type ON jobs(company_id, job_type);
```

### Migration: Normalize status names + add reconstruction statuses

```sql
-- NORMALIZE: rename 'job_complete' → 'complete' for consistency across both pipelines
-- This is a data migration — update existing rows first, then the constraint
UPDATE jobs SET status = 'complete' WHERE status = 'job_complete';

-- Drop old constraint, add new one with all valid statuses
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (
    status IN (
        -- Shared statuses (both pipelines)
        'new', 'submitted', 'collected', 'complete',
        -- Mitigation-only
        'contracted', 'mitigation', 'drying',
        -- Reconstruction-only
        'scoping', 'in_progress'
    )
);
```

**NOTE:** This renames `job_complete` → `complete`. All frontend references to `job_complete` and `completed` must be updated to `complete`. Backend `VALID_STATUSES` set must be updated. This normalizes status naming across the entire app.

### Status Pipelines

**Mitigation** (normalized — `job_complete` → `complete`):
```
new → contracted → mitigation → drying → complete → submitted → collected
```

**Reconstruction:**
```
new → scoping → in_progress → complete → submitted → collected
```

- `new` — job created, not yet started
- `contracted` — (mitigation only) contract signed
- `mitigation` — (mitigation only) active mitigation work
- `drying` — (mitigation only) equipment running, monitoring moisture
- `scoping` — (reconstruction only) building the reconstruction scope
- `in_progress` — (reconstruction only) physical reconstruction work underway
- `complete` — all work finished, ready for final documentation (SHARED)
- `submitted` — scope/invoice submitted to carrier (SHARED)
- `collected` — payment received (SHARED)

Note: `new`, `complete`, `submitted`, and `collected` are shared status values. The reconstruction pipeline is intentionally simpler because the actual work phases are tracked via the flexible `recon_phases` system (see below), not via the job status field.

### New Table: recon_phases (flexible per-job phase tracking)

```sql
-- Reconstruction phases are NOT hardcoded. Each job gets its own set based on scope.
-- Common phases: Demo, Drywall, Paint, Flooring, Trim, etc.
-- Contractor can add/remove/reorder phases per job.
CREATE TABLE recon_phases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    phase_name      TEXT NOT NULL,           -- "Demo", "Drywall", "Paint", "Flooring", "Trim", etc.
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'on_hold', 'complete')),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    notes           TEXT,                    -- per-phase notes
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for listing phases by job
CREATE INDEX idx_recon_phases_job ON recon_phases(job_id, sort_order);
```

**Common phase templates** (pre-populated when creating a reconstruction job, contractor can customize):

| Phase | When Used |
|-------|-----------|
| Demo Verification | Almost always — verify what needs to come out beyond mitigation tear-out |
| Drywall | Very common — most water jobs affect drywall |
| Paint | Very common — follows drywall |
| Flooring | Common — carpet, tile, hardwood replacement |
| Trim / Moldings | Common — baseboards, crown, casings |
| Cabinetry | When kitchen/bathroom affected |
| Insulation | When wall cavities were opened |
| Electrical | When wiring was exposed/damaged |
| Plumbing | When fixtures need replacement |
| Final Walkthrough | Always — customer sign-off |

### New Event Types

```sql
-- Add to event_type enum:
ALTER TYPE event_type ADD VALUE 'recon_phase_created';
ALTER TYPE event_type ADD VALUE 'recon_phase_updated';
ALTER TYPE event_type ADD VALUE 'recon_phase_completed';
ALTER TYPE event_type ADD VALUE 'job_linked';
```

### Data Relationships (updated)

```
property (physical address — shared across jobs)
├── job (mitigation, job_type='mitigation')
│   ├── floor_plans, job_rooms, photos, moisture_readings, ...  (Spec 01)
│   ├── line_items (Spec 02 — AI scope)
│   └── linked_job_id: NULL
│
├── job (reconstruction, job_type='reconstruction')
│   ├── photos (before/after, progress photos — reuses existing photos system)
│   ├── recon_phases (flexible phase list per job)
│   ├── line_items (future spec — reconstruction scope builder)
│   └── linked_job_id: → mitigation job above (optional)
│       └── auto-copied at creation: claim_number, carrier, adjuster_*, customer_*, address_*, property_id
│
└── (future: more jobs at same property — different claims, different years)
```

**What reconstruction jobs do NOT have** (mitigation-only features):
- Moisture readings (moisture_readings, moisture_points, dehu_outputs)
- Equipment tracking (air movers, dehus per room)
- Water category/class (loss_category, loss_class)
- GPP calculations
- Drying certificate (Spec 04)
- Mitigation-specific statuses (contracted, mitigation, drying, job_complete)

**What reconstruction jobs share with mitigation:**
- Photos (same upload/organize/tag system)
- Rooms (same job_rooms table — but for recon, rooms describe where work is needed, not where moisture was found)
- Floor plans (reused if linked to a mitigation job that had them)
- Tech notes
- Reports / share links
- Event history

---

## API Changes

### Updated Endpoints

**`POST /v1/jobs`** — add `job_type` and `linked_job_id` to create payload
```python
class JobCreate(BaseModel):
    # NEW fields
    job_type: str = "mitigation"           # "mitigation" | "reconstruction"
    linked_job_id: UUID | None = None      # optional: link to existing mitigation job

    # Existing fields (unchanged)
    address_line1: str
    loss_type: str = "water"
    city: str = ""
    state: str = ""
    zip: str = ""
    # ... (all other existing fields)
```

**Behavior when `linked_job_id` is provided:**
1. Validate the linked job exists and belongs to the same company
2. Auto-copy: `claim_number`, `carrier`, `adjuster_name`, `adjuster_phone`, `adjuster_email`, `customer_name`, `customer_phone`, `customer_email`, `address_line1`, `city`, `state`, `zip`, `latitude`, `longitude`, `property_id`, `loss_type`, `loss_date`
3. These copied values can be overridden in the create payload
4. Log `job_linked` event on both the new job and the linked job

**`GET /v1/jobs`** — add `job_type` filter
```
GET /v1/jobs?job_type=mitigation          # only mitigation jobs
GET /v1/jobs?job_type=reconstruction      # only reconstruction jobs
GET /v1/jobs                              # all jobs (default)
```

**`GET /v1/jobs/{job_id}`** — response includes `job_type`, `linked_job_id`, and linked job summary
```python
class JobResponse(BaseModel):
    # NEW fields
    job_type: str                          # "mitigation" | "reconstruction"
    linked_job_id: UUID | None
    linked_job_summary: LinkedJobSummary | None  # {id, job_number, job_type, status} — if linked

    # Existing fields (unchanged)
    # ...
```

**Bidirectional link resolution:**
- Reconstruction job: `linked_job_id` directly references the mitigation job → populate `linked_job_summary` from that
- Mitigation job: `linked_job_id` is NULL → run reverse query: `SELECT id, job_number, job_type, status FROM jobs WHERE linked_job_id = :this_job_id LIMIT 1` → populate `linked_job_summary` from result
- This reverse query uses the `idx_jobs_linked` index. Only runs on job detail fetch, cached client-side by TanStack Query.

**`GET /v1/dashboard`** — add reconstruction pipeline counts
```python
class DashboardResponse(BaseModel):
    mitigation_pipeline: dict    # existing: {new: N, contracted: N, mitigation: N, ...}
    reconstruction_pipeline: dict  # NEW: {new: N, scoping: N, in_progress: N, ...}
    # ... (other existing fields)
```

### New Endpoints

**Reconstruction Phases:**
```
POST   /v1/jobs/{job_id}/recon-phases              # Create phase (name, sort_order)
GET    /v1/jobs/{job_id}/recon-phases              # List phases for job (ordered)
PATCH  /v1/jobs/{job_id}/recon-phases/{phase_id}   # Update phase (status, notes, sort_order)
DELETE /v1/jobs/{job_id}/recon-phases/{phase_id}   # Delete phase
POST   /v1/jobs/{job_id}/recon-phases/reorder      # Bulk reorder phases
```

**Phase schemas:**
```python
class ReconPhaseCreate(BaseModel):
    phase_name: str                    # "Demo", "Drywall", "Paint", etc.
    sort_order: int = 0
    notes: str | None = None

class ReconPhaseUpdate(BaseModel):
    phase_name: str | None = None
    status: str | None = None          # "pending" | "in_progress" | "on_hold" | "complete"
    notes: str | None = None
    sort_order: int | None = None

class ReconPhaseResponse(BaseModel):
    id: UUID
    job_id: UUID
    phase_name: str
    status: str
    sort_order: int
    started_at: datetime | None
    completed_at: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
```

**Validation rules:**
- Recon phase endpoints only work on `job_type='reconstruction'` jobs (return 400 for mitigation jobs)
- Phase status transitions: `pending → in_progress → complete` (or `pending → in_progress → on_hold → in_progress → complete`)
- When status changes to `in_progress`, auto-set `started_at` if null
- When status changes to `complete`, auto-set `completed_at`

**Job linking shortcut:**
```
POST /v1/jobs/{job_id}/create-linked-recon    # Create a reconstruction job linked to this mitigation job
```
Returns the newly created reconstruction job. Auto-copies header data. Convenience endpoint for the "Also create a reconstruction job" flow.

---

## Frontend Changes — Screen-by-Screen Visual Spec

### Color System for Job Types

Mitigation and reconstruction need distinct but cohesive visual identities within the DESIGN.md palette:

| Job Type | Accent Color | Background Tint | Badge Style |
|----------|-------------|-----------------|-------------|
| Mitigation | #3b82f6 (blue) | #eff6ff | `MIT` — blue text on light blue bg, rounded-md, text-[11px] font-semibold px-2 py-0.5 |
| Reconstruction | #e85d26 (orange, brand accent) | #fff3ed | `REC` — orange text on light orange bg, rounded-md, text-[11px] font-semibold px-2 py-0.5 |

Blue for mitigation (water/drying associations), orange for reconstruction (build/action, matches brand accent). These are used consistently across every screen.

### Reconstruction Status Badge Colors

| Status | Text Color | Background | Meaning |
|--------|-----------|-----------|---------|
| New | #6b6560 | #f5f5f4 | Same as mitigation "new" |
| Scoping | #7c5cbf (purple) | #f8f5ff | Building the reconstruction scope |
| In Progress | #d97706 (amber) | #fffbeb | Physical work underway |
| Complete | #2a9d5c (green) | #edf7f0 | All work done |
| Submitted | #5b6abf (indigo) | #eef0fc | Same as mitigation |
| Collected | #059669 (emerald) | #ecfdf5 | Same as mitigation |

---

### 1. Dashboard (`/dashboard`)

**Pipeline Section — Two Rows:**
```
┌─────────────────────────────────────────────────────────────┐
│  MITIGATION                                                  │
│  ┌─────┐ ┌──────────┐ ┌──────────┐ ┌──────┐ ┌────────┐ ... │
│  │ New │ │Contracted│ │Mitigation│ │Drying│ │Complete │     │
│  │  3  │ │    2     │ │    5     │ │  4   │ │   1    │     │
│  └─────┘ └──────────┘ └──────────┘ └──────┘ └────────┘     │
│                                                              │
│  RECONSTRUCTION                                              │
│  ┌─────┐ ┌───────┐ ┌───────────┐ ┌────────┐ ┌──────────┐   │
│  │ New │ │Scoping│ │In Progress│ │Complete│ │Submitted │   │
│  │  1  │ │   2   │ │     3     │ │   0    │ │    1     │   │
│  └─────┘ └───────┘ └───────────┘ └────────┘ └──────────┘   │
└─────────────────────────────────────────────────────────────┘
```

- Section label "MITIGATION" in text-[11px] font-semibold uppercase tracking-wider text-[#8a847e], with small blue dot indicator
- Section label "RECONSTRUCTION" same style, with small orange dot indicator
- Pipeline boxes use the same existing component, just different stage names + colors
- Each box is clickable — filters the active jobs list below
- On mobile: horizontal scroll within each row (same as current behavior)

**Active Jobs List:**
- Each job card now shows the type badge (MIT/REC) to the left of the status badge
- Type badge uses the colors defined above
- Linked jobs show a subtle link icon (chain link, 14px, #b5b0aa) after the job number

**KPI Cards:**
- No change to existing KPI cards for now
- Future: add "Mitigation Revenue" / "Reconstruction Revenue" split

---

### 2. Job Creation (`/jobs/new`)

**Job Type Selector** — FIRST element on the page, above loss type:

```
┌─────────────────────────────────────────────────────┐
│  What type of job?                                   │
│                                                      │
│  ┌──────────────────┐  ┌──────────────────┐         │
│  │   💧              │  │   🔨              │         │
│  │  Mitigation       │  │  Reconstruction   │         │
│  │  Water damage     │  │  Insurance repair  │         │
│  │  restoration,     │  │  rebuild,          │         │
│  │  drying,          │  │  restoration       │         │
│  │  equipment        │  │                    │         │
│  └──────────────────┘  └──────────────────┘         │
│  (blue border           (orange border               │
│   when selected)         when selected)              │
└─────────────────────────────────────────────────────┘
```

**Visual spec:**
- Label: "What type of job?" — text-[15px] font-semibold text-[#1a1a1a] mb-3
- Two cards side by side (same grid as current loss type selector but LARGER — these are more important)
- Card: border border-[#eae6e1] rounded-xl px-4 py-4, min-height 100px
- Selected mitigation: border-2 border-[#3b82f6] bg-[#eff6ff]
- Selected reconstruction: border-2 border-[#e85d26] bg-[#fff3ed]
- Icon: 28px, centered above text
- Title: text-[15px] font-semibold text-[#1a1a1a]
- Subtitle: text-[12px] text-[#8a847e] leading-snug
- Default selection: Mitigation (pre-selected with blue border)
- Touch target: entire card is tappable, 48px minimum height (will exceed this at ~100px)

**Conditional fields when Reconstruction is selected:**
- Water Category and Water Class sections: hidden (CSS display:none, not removed from DOM)
- New section appears below Insurance accordion: "Link to Mitigation Job"
  - Dropdown/combobox: searchable by address or job number
  - Shows company's mitigation jobs: "JOB-20260401-001 — 123 Main St, Warren MI"
  - Optional — can leave empty for standalone reconstruction
  - When selected: auto-fills claim_number, carrier, adjuster_*, customer_*, address fields
  - Auto-filled fields show a subtle "Copied from JOB-xxx" caption in text-[11px] text-[#b5b0aa]
  - User can override any auto-filled value

**On mobile (375px):**
- Type selector cards stack vertically (1 column) instead of side by side
- Each card: full width, same 100px height
- Everything else stacks as current form does

---

### 3. Job List (`/jobs`)

**Desktop Table View:**
```
┌────────────────────────────────────────────────────────────┐
│ All  Mitigation  Reconstruction          🔍 Search...      │
│ ───  ──────────  ──────────────                            │
│                                                            │
│ Address          Type  Status     Days  Rooms  Photos Date │
│ ──────────────── ───── ────────── ───── ────── ────── ───  │
│ 123 Main St      MIT   Drying       4     3      12   3/28 │
│ 456 Oak Ave      REC   In Progress  2     4       8   3/29 │
│ 123 Main St  🔗  REC   Scoping      1     3       0   3/30 │
│ 789 Elm Dr       MIT   New          0     0       0   3/30 │
└────────────────────────────────────────────────────────────┘
```

- **Filter tabs** at top: "All" / "Mitigation" / "Reconstruction" — underline style, matching current search bar alignment
  - Active tab: text-[#1a1a1a] font-semibold, bottom border 2px #e85d26
  - Inactive: text-[#8a847e] hover:text-[#1a1a1a]
- **Type column**: shows MIT/REC badge (colors from table above)
- **Link icon** (🔗): small chain link icon (14px, #b5b0aa) shown after address when job has a linked_job_id. Clicking navigates to linked job. Tooltip: "Linked to JOB-xxx"
- **Side panel preview**: when clicking a reconstruction job, side panel shows same layout but with recon-specific info (phases progress instead of moisture summary)

**Mobile Card View:**
```
┌─────────────────────────────────┐
│ 123 Main St, Warren MI          │
│ MIT  Drying    4 days           │
│ 3 rooms · 12 photos    Mar 28  │
├─────────────────────────────────┤
│ 456 Oak Ave, Detroit MI         │
│ REC  In Progress    2 days      │
│ 4 rooms · 8 photos     Mar 29  │
├─────────────────────────────────┤
│ 123 Main St, Warren MI  🔗      │
│ REC  Scoping    1 day           │
│ 3 rooms · 0 photos     Mar 30  │
└─────────────────────────────────┘
```

- Type badge (MIT/REC) appears BEFORE the status badge, both on the same line
- Link icon appears after the address on the first line
- Filter tabs shown above the card list (same tab bar, horizontally scrollable if needed)
- FAB "+" button: opens a bottom sheet with two large tappable options:
  - Title: "New Job" — text-[17px] font-semibold text-[#1a1a1a]
  - Two cards (same style as create form type selector): Mitigation (💧, blue border) / Reconstruction (🔨, orange border)
  - Tapping either navigates to `/jobs/new?type=mitigation` or `/jobs/new?type=reconstruction` with type pre-selected
  - Bottom sheet: bg-white, rounded-t-2xl, shadow-lg, backdrop blur, swipe-down to dismiss
  - Touch targets: 48px minimum, full-width cards

---

### 4. Job Detail (`/jobs/[id]`)

**Linked Job Banner** (shown at top when linked_job_id exists):
```
┌─────────────────────────────────────────────────┐
│ 🔗 Linked mitigation job: JOB-20260401-001  →  │
└─────────────────────────────────────────────────┘
```
- Full-width, bg-[#faf9f7] border border-[#eae6e1] rounded-lg px-4 py-2.5
- Link icon + text in text-[13px] text-[#6b6560]
- Job number in font-semibold text-[#1a1a1a]
- Arrow icon at right edge — entire banner is clickable, navigates to linked job
- Shown on BOTH jobs (mitigation shows "Linked reconstruction job: ...", reconstruction shows "Linked mitigation job: ...")

**Mitigation Job Detail:** No changes whatsoever.

**Reconstruction Job Detail — Section Visibility:**

| Section | Mitigation | Reconstruction | Notes |
|---------|-----------|---------------|-------|
| Job Info | Show | Show | Recon hides Water Category/Class, shows job_type badge |
| Property Layout (Floor Plans + Rooms) | Show | Show | Rooms describe where work is needed, not moisture |
| Photos | Show | Show | Same system, different photo types (progress, before/after) |
| Moisture Readings | Show | **Hide** | Not relevant to reconstruction |
| Tech Notes | Show | Show | Same |
| **Recon Phases** | **Hide** | **Show** | NEW section — see below |
| AI Scope (Spec 02) | Show | Show (future) | Different AI prompts per type |
| Final Report | Show | Show | Different report template per type |

**Recon Phases Section** (NEW accordion, open by default on reconstruction jobs):

```
┌─────────────────────────────────────────────────────┐
│ ▼ Reconstruction Phases          3 of 7 complete    │
│   ━━━━━━━━━━━━━━━━━░░░░░░░░░░░  43%               │
│                                                      │
│   ✅ Demo Verification          Completed Mar 15    │
│   ✅ Drywall                    Completed Mar 20    │
│   ✅ Paint                      Completed Mar 25    │
│   🔵 Flooring                   In Progress         │
│   ⏸️  Trim / Moldings           On Hold             │
│   ⚪ Cabinetry                  Pending              │
│   ⚪ Final Walkthrough          Pending              │
│                                                      │
│   + Add Phase                                        │
└─────────────────────────────────────────────────────┘
```

**Visual spec for each phase row:**
- Height: 48px minimum (touch-friendly)
- Left: status icon (16px)
  - Pending: hollow circle (#b5b0aa)
  - In Progress: filled blue circle (#3b82f6) with pulse animation
  - On Hold: pause icon (#d97706)
  - Complete: green checkmark (#2a9d5c)
- Center: phase name in text-[14px] font-medium text-[#1a1a1a]
- Right: status text in text-[12px] text-[#8a847e]
  - Complete: "Completed Mar 15" in text-[#2a9d5c]
  - In Progress: "In Progress" in text-[#3b82f6]
  - On Hold: "On Hold" in text-[#d97706]
  - Pending: "Pending" in text-[#b5b0aa]
- Tap on a phase row: expands to show notes field + date pickers + status toggle buttons
- Status toggle: 4 small pill buttons (Pending / In Progress / On Hold / Complete) — active one is filled
- Progress bar: 4px height, bg-[#eae6e1], fill uses gradient from #3b82f6 to #2a9d5c as completion grows
- "Add Phase" button: ghost style, text-[#6b6560], + icon, 48px touch target

**Reorder on desktop:** grab handle (⋮⋮) on left edge, drag to reorder. On keyboard focus: up/down arrow buttons appear at right edge (standard a11y pattern for sortable lists). Arrow buttons: 32px, ghost style, visible only on :focus-within.
**Reorder on mobile:** long-press (500ms) triggers haptic + lifts card, drag to reposition. Same pattern as iOS reminder reorder.
**Accessibility:** Phase list uses `role="list"`, each phase `role="listitem"`. Status toggle buttons have `aria-label="Set phase status to [status]"`. Progress bar has `aria-valuenow` and `aria-valuemax`. Drag handle has `aria-roledescription="sortable"` with arrow key support.

---

### 5. Action Sidebar / Quick Actions

**On mitigation job detail** — existing action sidebar gains one new item:
- "Create Reconstruction Job" button (appears after job status reaches `job_complete` or later)
- Style: secondary button with hammer icon
- Behavior: calls `POST /v1/jobs/{job_id}/create-linked-recon`, then navigates to the new recon job

**On reconstruction job detail** — action sidebar adapts:
- Remove: "Log Reading" (not relevant)
- Keep: Take Photo, Voice Note, Edit Job, Share/Export/Delete
- Add: nothing new beyond what's in the accordion

---

### 6. Reconstruction Report (PDF)

The existing PDF report system (client-side browser print) generates a mitigation-focused report. Reconstruction jobs need a different template.

**Reconstruction Report sections:**
1. Company header (same as mitigation — logo, company name, contact)
2. Job info (address, customer, carrier, claim number, adjuster, loss type, loss date)
3. Job type badge: "RECONSTRUCTION" in orange
4. Linked mitigation job reference (if exists): "Mitigation: JOB-xxx"
5. Reconstruction phases summary table: phase name, status, started date, completed date
6. Room-by-room breakdown: room name, dimensions, notes (no moisture data, no equipment)
7. Photo grid (4-up, same as mitigation report layout)
8. Tech notes

**NOT included in reconstruction report** (mitigation-only):
- Moisture readings table
- Equipment log (air movers, dehus)
- GPP calculations
- Drying certificate reference
- Atmospheric readings

**Implementation:** The existing `/jobs/[id]/report/page.tsx` checks `job.job_type` and renders the appropriate template. Same print CSS, same branded header, different content sections.

### 7. Dashboard KPIs

- No change to existing KPI cards for V1B
- Future: add type-level filtering for division reporting

### TypeScript Types

```typescript
// Updated types in lib/types.ts

export type JobType = "mitigation" | "reconstruction";

// Reconstruction-specific statuses
export type ReconStatus = "new" | "scoping" | "in_progress" | "complete" | "submitted" | "collected";

// All possible statuses (union of mitigation + reconstruction)
export type JobStatus =
  | "new" | "contracted" | "mitigation" | "drying" | "job_complete" | "submitted" | "collected"  // mitigation
  | "scoping" | "in_progress" | "complete";  // reconstruction-only

export type ReconPhaseStatus = "pending" | "in_progress" | "on_hold" | "complete";

export interface Job {
  // NEW fields
  job_type: JobType;
  linked_job_id: string | null;
  linked_job_summary: LinkedJobSummary | null;

  // Existing fields (unchanged)
  id: string;
  company_id: string;
  job_number: string;
  status: JobStatus;
  loss_type: LossType;
  // ... (all other existing fields)
}

export interface LinkedJobSummary {
  id: string;
  job_number: string;
  job_type: JobType;
  status: JobStatus;
}

export interface ReconPhase {
  id: string;
  job_id: string;
  phase_name: string;
  status: ReconPhaseStatus;
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## Interaction States

Every new UI element specifies loading, empty, error, and success states:

| Feature | Loading | Empty | Error | Success |
|---------|---------|-------|-------|---------|
| Job type selector | N/A | N/A | N/A | Selected card: colored border + bg tint |
| Link to existing job | Spinner in dropdown | "No mitigation jobs found" | "Failed to load" + retry | Auto-fills fields, "Copied from JOB-xxx" caption |
| Recon phases list | 3 skeleton rows | "No phases yet. Add your first phase to start tracking." + Add Phase button + brief description of common phases | "Failed to load phases" + retry | Smooth insert animation |
| Phase status change | Optimistic update + spinner on badge | N/A | Toast "Update failed" + revert | Badge color change + completion date auto-set |
| Phase reorder | Ghost placeholder while dragging | N/A | Toast "Reorder failed" + snap back | Silent, new order persists |
| Dashboard recon pipeline | Skeleton boxes | All "0", muted text | "Failed to load" + retry | Counts populate |
| Create linked recon button | Spinner + "Creating..." | N/A | Toast "Failed to create" + retry | Navigate to new recon job |
| Filter tabs (All/Mit/Recon) | Current skeleton | "No reconstruction jobs yet. Create your first reconstruction job →" | Same as current | Instant filter (client-side) |
| Linked job banner | Skeleton bar | Not shown (no linked job) | N/A | Clickable banner with job number |

**Empty state for first reconstruction job ever:**
When a company has zero reconstruction jobs and navigates to the Reconstruction filter tab:
- Large hammer icon (48px, #b5b0aa)
- "No reconstruction jobs yet" — text-[16px] font-semibold text-[#1a1a1a]
- "Track insurance repair and rebuild work alongside your mitigation jobs." — text-[14px] text-[#8a847e]
- Primary button: "Create Reconstruction Job" → opens /jobs/new?type=reconstruction

**Empty state for recon phases (new reconstruction job):**
- Subtle dashed border container
- "Add phases to track your reconstruction progress" — text-[14px] text-[#8a847e]
- "Common phases: Demo, Drywall, Paint, Flooring, Trim, Final Walkthrough" — text-[12px] text-[#b5b0aa]
- "Add Phase" button (primary) + "Use Template" ghost button (pre-populates common phases)

---

## Phases & Checklist

### Phase 1: Database + Backend Core
- [ ] Alembic migration: add `job_type` column to jobs (default 'mitigation')
- [ ] Alembic migration: add `linked_job_id` column to jobs (nullable FK to jobs)
- [ ] Alembic migration: rename 'job_complete' → 'complete' (data migration + constraint update)
- [ ] Update backend VALID_STATUSES: remove 'job_complete', add 'complete', 'scoping', 'in_progress'
- [ ] Update frontend types.ts: JobStatus uses 'complete' not 'job_complete' or 'completed'
- [ ] Update all frontend status badge colors/labels for 'complete' (replace job_complete/completed references)
- [ ] Update dashboard pipeline logic for normalized status name
- [ ] Alembic migration: create `recon_phases` table
- [ ] Alembic migration: add new event_type enum values
- [ ] Update `api/jobs/schemas.py` — add `job_type`, `linked_job_id` to create/update/response
- [ ] Update `api/jobs/service.py` — handle job_type validation, linked job auto-copy, status pipeline validation per job_type
- [ ] Update `api/jobs/router.py` — add `job_type` query filter to `GET /v1/jobs`
- [ ] Add `POST /v1/jobs/{job_id}/create-linked-recon` convenience endpoint
- [ ] Create `api/recon_phases/schemas.py` — Pydantic models
- [ ] Create `api/recon_phases/service.py` — CRUD + status transition logic
- [ ] Create `api/recon_phases/router.py` — route handlers
- [ ] Update dashboard endpoint — add `reconstruction_pipeline` counts
- [ ] Status validation: mitigation jobs can only use mitigation statuses, reconstruction only reconstruction statuses
- [ ] Event logging: `job_linked` event on both jobs when linked
- [ ] pytest: create mitigation job (existing behavior, no regression)
- [ ] pytest: create reconstruction job (standalone)
- [ ] pytest: create reconstruction job linked to mitigation job (auto-copy verified)
- [ ] pytest: linked job validation (must be same company, must exist)
- [ ] pytest: status transitions for reconstruction pipeline
- [ ] pytest: recon phases CRUD
- [ ] pytest: recon phase status transitions (auto-set started_at, completed_at)
- [ ] pytest: recon phases rejected on mitigation jobs
- [ ] pytest: job type filter on GET /v1/jobs
- [ ] pytest: dashboard reconstruction pipeline counts
- [ ] pytest: create-linked-recon convenience endpoint
- [ ] pytest: reject status change to mitigation-only status on recon job (e.g., 'drying')
- [ ] pytest: reject status change to recon-only status on mitigation job (e.g., 'scoping')
- [ ] pytest: reject job_type change after creation (immutable field)
- [ ] pytest: reverse link lookup — mitigation job shows linked recon in response
- [ ] pytest: create-linked-recon from a reconstruction job (should fail — only from mitigation)
- [ ] pytest: recon phase template pre-population (6 default phases created)

### Phase 2: Frontend — Job Creation + List
- [ ] Update `lib/types.ts` — add JobType, ReconPhaseStatus, ReconPhase, LinkedJobSummary
- [ ] Update `lib/hooks/use-jobs.ts` — add job_type to create mutation, add recon phase hooks
- [ ] Job creation form: add job type selector (two cards: Mitigation / Reconstruction)
- [ ] Job creation form: conditional field visibility based on job type
- [ ] Job creation form: "Link to existing job" dropdown for reconstruction jobs
- [ ] Job creation form: auto-populate fields when linking
- [ ] Job list: add job type badge (MIT / REC)
- [ ] Job list: add link icon for linked jobs
- [ ] Job list: add type filter (All / Mitigation / Reconstruction)
- [ ] Desktop table: add Type column
- [ ] Mobile cards: show type badge inline

### Phase 3: Frontend — Job Detail + Dashboard
- [ ] Job detail: conditional section visibility based on job_type
- [ ] Job detail: Recon Phases accordion section (for reconstruction jobs)
- [ ] Job detail: phase list with status badges, notes, add/remove/reorder
- [ ] Job detail: linked job banner
- [ ] Dashboard: dual pipeline display (mitigation + reconstruction)
- [ ] Dashboard: pipeline box colors for reconstruction statuses
- [ ] Status badge colors for reconstruction statuses

### Phase 3B: Frontend — Reconstruction Report
- [ ] Report page: check job_type and render appropriate template
- [ ] Reconstruction report: phases summary table
- [ ] Reconstruction report: room breakdown without moisture/equipment data
- [ ] Reconstruction report: photo grid (same as mitigation)
- [ ] Reconstruction report: linked mitigation job reference
- [ ] Print CSS: verify reconstruction report prints cleanly

### Phase 4: Testing + Polish
- [ ] Frontend tests: job creation with type selection
- [ ] Frontend tests: recon phase interactions
- [ ] Cross-browser testing on phase reorder (drag on desktop, long-press on mobile)
- [ ] Verify zero regression on all existing mitigation flows
- [ ] Update API reference docs

---

## Design Decisions

### Why `job_type` on the jobs table instead of a separate `reconstruction_jobs` table?
Both mitigation and reconstruction jobs share 90% of their schema (address, customer, carrier, adjuster, photos, rooms, reports, share links, events). A separate table would duplicate all of this. The `job_type` field plus conditional logic is much simpler.

### Why flexible `recon_phases` instead of hardcoded reconstruction statuses?
Brett confirmed (R6): "There's no method to the madness." A water-damaged kitchen might need Demo + Drywall + Paint + Flooring + Cabinetry. A ceiling leak might just need Drywall + Paint. Hardcoded phases would either be too restrictive or bloated with unused stages.

### Why copy header data instead of sharing it via reference?
When a mitigation job's adjuster changes (corrections happen), it should NOT retroactively change the reconstruction job's adjuster — they may have submitted to different people. Copying at creation + allowing overrides is the safe approach. The `linked_job_id` remains as a navigational pointer, not a data dependency.

### What about the ScopeFlow single-job model?
Brett's ScopeFlow prototype proposed `job.mode` = restoration | insurance_repair | combined. His own 9 interview answers contradicted this model. Real-world workflow demands separation: separate invoices, separate P&L, separate crews, 2-3 week gap, adjusters expect it. See Appendix C of competitive analysis for full reasoning.

---

## Future Enhancements (post-V1B, not separate specs)

These are enhancements to reconstruction jobs that build on this spec's foundation. They do NOT need separate specs — they expand on Spec 02 (AI Pipeline) or are post-V1B improvements:

| Enhancement | Where it lives | Notes |
|-------------|---------------|-------|
| AI Scope Auditor for reconstruction | Spec 02 expansion | Same auditor UI, new prompt + reconstruction code library |
| Supplement management | Spec 02 expansion | AI-generated supplements, dispute responses |
| ACV/RCV financial tracking | Post-V1B | Payment tracker, holdback calculator, depreciation |
| Adjuster portal reconstruction view | Post-V1B | Phase progress, recon scope, supplement log |
| Rich phase tracking (photos per phase, inspection holds) | Post-V1B | Extends recon_phases with photo requirements + permit tracking |

---

## Design Review — NOT in Scope

| Decision | Rationale |
|----------|-----------|
| AI-powered scope auditor for reconstruction | Spec 02 expansion — different prompts, same UI |
| Supplement management (AI-generated supplements + disputes) | Spec 02 expansion |
| ACV/RCV financial tracking | Post-V1B enhancement |
| Adjuster portal reconstruction view | Post-V1B enhancement |

## Design Review — What Already Exists

| Pattern | Where | Reuse How |
|---------|-------|-----------|
| Loss type selector (visual card buttons) | `/jobs/new` | Same component pattern for job type selector (larger cards) |
| Status badges (color-coded pills) | Job list, job detail | Add new colors for REC badge + reconstruction statuses |
| Accordion sections on job detail | `/jobs/[id]` | Add Recon Phases as new accordion item |
| Pipeline boxes on dashboard | `/dashboard` | Duplicate row with recon stage names |
| Card list + FAB on mobile | `/jobs` | Add type badge to cards, bottom sheet to FAB |
| Empty states with CTA | Various | Same warm pattern for "No reconstruction jobs" |
| Bottom sheet pattern | Not yet built | New component, but standard mobile pattern |
