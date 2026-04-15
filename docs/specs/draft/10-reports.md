# Spec 10: Reports

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 phases) |
| **State** | Draft — under review |
| **Blocker** | Spec 01 complete (has `reports` table + client-side PDF export). 04A Phase 6 needed for timesheets. 04AII needed for drying certificate. |
| **Branch** | TBD |
| **Issue** | TBD |
| **Source** | Brett's "Crewmatic UI Layout & Navigation Summary v2.0" (April 13, 2026) |
| **Depends on** | Spec 01 (complete), 04A (draft — time clock), 04AII (draft — drying cert) |

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

## Done When
- [ ] Reports page at `/reports` with sub-navigation: Documents | Supplements | Analytics | Timesheets
- [ ] Moisture/Drying Report PDF generation (server-side) from existing moisture data
- [ ] Photo Documentation Packet PDF (before/during/after by room)
- [ ] Carrier Submission Packet PDF (bundled moisture + photos + scope + equipment)
- [ ] Certificate of Completion PDF (scope summary, before/after, warranty language)
- [ ] Signed Contracts reference list (read-only, linked from job contracts)
- [ ] Supplement tracking per job with status workflow (pending → submitted → approved/denied/partial)
- [ ] Business analytics: revenue by job type, cycle time, carrier performance, job volume
- [ ] Timesheets: weekly hours by tech (owner sees all, tech sees own), CSV export for payroll
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Crewmatic generates extensive job data — moisture readings, photos, equipment logs, time entries — but there's no centralized place to turn that data into deliverable documents, track supplement submissions, view business analytics, or manage payroll timesheets. Brett currently exports one-off PDFs from the job detail page and tracks supplements in spreadsheets.

**Solution:** A top-level Reports section that serves as the output and record-keeping layer:
1. **Document Reports** — server-side PDF generation for the five document types adjusters and owners need
2. **Supplement Documentation** — per-job supplement tracking with carrier response workflow
3. **Business Analytics** — revenue, cycle time, carrier performance, and job volume charts
4. **Timesheets** — weekly hours view for payroll, pulling from time clock data (04A Phase 6)

**Scope:**
- IN: All 4 phases above, server-side PDF generation (WeasyPrint), supplement CRUD, analytics aggregation endpoints, timesheet read views, CSV exports, role-based visibility
- OUT: Xactimate ESX export (future — when integration matures), push notifications for supplement status changes (future), custom report builder (future), automated supplement submission to carriers (future)

**Relationship to other specs:**
- **Spec 01 (Jobs):** Has `reports` table (report_type: `full_report`, `mitigation_invoice`) and client-side PDF export. This spec extends that table with new report types and adds server-side generation.
- **Spec 01B (Reconstruction):** Added reconstruction report template. Certificate of Completion here supersedes that as a more complete version.
- **Spec 04A Phase 6 (Time Clock):** Creates `time_entries` table. Timesheets phase here is a read-only reporting view over that data.
- **Spec 04AI Phase 3 (Daily Auto-Reports):** Daily progress emails are per-job automated communication. Reports here are on-demand generated documents. Different purpose, no overlap.
- **Spec 04AII (Equipment & Certification):** Drying certificate generation lives there. Certificate of Completion here is broader (all job types, all phases).

---

## Database Schema

### Extend existing `reports` table

The `reports` table from Spec 01 has `report_type CHECK ('full_report', 'mitigation_invoice')`. Extend with new types:

```sql
-- Migration: extend reports table for Spec 10
ALTER TABLE reports
  DROP CONSTRAINT reports_report_type_check,
  ADD CONSTRAINT reports_report_type_check CHECK (
    report_type IN (
      'full_report',           -- Spec 01 (existing)
      'mitigation_invoice',    -- Spec 01 (existing)
      'moisture_drying',       -- Phase 1: moisture/drying report
      'photo_packet',          -- Phase 1: photo documentation packet
      'carrier_submission',    -- Phase 1: carrier submission packet
      'certificate_completion' -- Phase 1: certificate of completion
    )
  );

-- Add generated_by to track who created the report
ALTER TABLE reports ADD COLUMN generated_by UUID REFERENCES users(id);

-- Add file_size for storage management
ALTER TABLE reports ADD COLUMN file_size_bytes BIGINT;

-- Add title for display (e.g., "Moisture Report — 123 Main St")
ALTER TABLE reports ADD COLUMN title TEXT;

-- Index for listing reports by type across company
CREATE INDEX idx_reports_company_type ON reports(company_id, report_type) WHERE status = 'ready';
```

### New: `supplements` table

```sql
CREATE TABLE supplements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  supplement_number INTEGER NOT NULL,  -- sequential per job (1, 2, 3...)
  description TEXT NOT NULL,
  amount DECIMAL(10,2),                -- requested amount
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('draft', 'pending', 'submitted', 'approved', 'denied', 'partial')
  ),
  submitted_at TIMESTAMPTZ,            -- when sent to carrier
  responded_at TIMESTAMPTZ,            -- when carrier responded
  carrier_response TEXT,               -- adjuster's response notes
  approved_amount DECIMAL(10,2),       -- what carrier approved (NULL if not yet responded)
  line_items JSONB DEFAULT '[]',       -- future: structured line items when Xactimate integration matures
  notes TEXT,                          -- internal notes
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,              -- soft delete

  UNIQUE(job_id, supplement_number)    -- enforce sequential numbering per job
);

-- RLS: company_id isolation
ALTER TABLE supplements ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplements_company_isolation ON supplements
  USING (company_id = current_setting('app.company_id')::uuid);

-- Index for per-job supplement list
CREATE INDEX idx_supplements_job ON supplements(job_id) WHERE deleted_at IS NULL;

-- Index for company-wide supplement analytics
CREATE INDEX idx_supplements_company_status ON supplements(company_id, status) WHERE deleted_at IS NULL;
```

---

## Phases & Checklist

### Phase 1: Report Hub + Document Reports — ❌
The Reports page as a top-level nav section with server-side PDF generation.

**Backend:**

- [ ] Alembic migration: extend `reports` table (new report_type values, generated_by, file_size_bytes, title columns)
- [ ] `POST /v1/reports/generate` — body: `{job_id, report_type}` — generates PDF server-side, uploads to Supabase Storage, returns report metadata
  - Validates job belongs to company
  - Sets status to `generating`, creates report record
  - Generates PDF via WeasyPrint (HTML template → PDF)
  - Uploads to Supabase Storage bucket `reports/{company_id}/{job_id}/{report_id}.pdf`
  - Updates report record: status `ready`, storage_url, file_size_bytes, generated_at
  - On failure: status `failed`, logs error
- [ ] `GET /v1/reports` — list reports for company
  - Query params: `job_id`, `report_type`, `status`, `page`, `per_page`
  - Returns `{items: [...], total: N}` with report metadata (id, title, report_type, status, generated_at, file_size_bytes)
  - Default sort: generated_at DESC (most recent first)
- [ ] `GET /v1/reports/{id}` — single report metadata
- [ ] `GET /v1/reports/{id}/download` — returns presigned download URL (60-min expiry) for the PDF in Supabase Storage
- [ ] `DELETE /v1/reports/{id}` — soft-delete report record + delete file from storage

**PDF Templates (WeasyPrint HTML → PDF):**

- [ ] **Moisture/Drying Report** template:
  - Cover page: company logo, job address, date range, generated date
  - Summary: water category, class, rooms affected count, total drying days
  - Per-room moisture table: date, atmospheric (temp/RH/GPP), each moisture point reading, equipment running
  - GPP trend section: per-room GPP over time (text table — charts in future)
  - Equipment log: equipment type, room, dates active
  - Drying timeline: key events from `event_history` (mitigation started, readings recorded, drying confirmed)
  - Data sources: `moisture_readings`, `moisture_points`, `dehu_outputs`, `event_history`

- [ ] **Photo Documentation Packet** template:
  - Cover page: company logo, job address, loss type, date range
  - Organized by room, then by photo type (before → during → after)
  - Each photo: image, caption, room name, photo type badge, timestamp
  - 2-up layout per page (2 photos per row, 4 per page)
  - Data sources: `photos`, `job_rooms`

- [ ] **Carrier Submission Packet** template:
  - Cover page: company info, job info, carrier/adjuster info, claim number
  - Section 1: Job scope summary (rooms, loss type, category, class)
  - Section 2: Moisture/drying data (condensed version of moisture report)
  - Section 3: Equipment log
  - Section 4: Photo documentation (condensed — before/after pairs per room)
  - Section 5: Tech notes
  - Footer: S500/OSHA justification references
  - Data sources: all job-related tables

- [ ] **Certificate of Completion** template:
  - Single-page formal document with company branding
  - Job info: address, customer, dates (start → completion)
  - Scope summary: rooms affected, work performed
  - For mitigation: drying confirmed statement with final moisture readings
  - For reconstruction: phases completed checklist
  - Before/after photo pairs (1-2 per room, best selections)
  - Warranty language (configurable per company — default 1-year workmanship)
  - Signature lines: company representative, customer
  - Data sources: jobs, job_rooms, photos, moisture_readings (mitigation) or recon_phases (reconstruction)

- [ ] WeasyPrint dependency added to `pyproject.toml`
- [ ] Shared PDF utility: `backend/api/reports/pdf_generator.py` — base class with company branding, header/footer, page numbering
- [ ] pytest: generate each report type, verify PDF created, verify storage upload, verify metadata saved
- [ ] pytest: error cases — job not found, job belongs to different company, generation failure
- [ ] pytest: list/filter/download endpoints

**Frontend:**

- [ ] `/reports` page with tab navigation: Documents | Supplements | Analytics | Timesheets
- [ ] Documents tab (default):
  - Report list with filters: job selector (search by address), report type dropdown, date range picker
  - Each report card: type icon, job address, report title, date generated, status badge, file size, download button
  - Status badges: generating (amber pulse), ready (green), failed (red)
  - "Recently Generated" section at top (last 5 reports)
- [ ] "Generate Report" flow:
  - Button opens modal
  - Step 1: Select job (searchable dropdown)
  - Step 2: Select report type (cards with descriptions)
  - Step 3: Preview info (what data will be included — room count, photo count, reading count)
  - "Generate" button → shows progress → auto-downloads when ready
- [ ] Signed Contracts section (bottom of Documents tab):
  - Read-only list of contracts linked from job records
  - Each entry: job address, contract type, date signed, "View" link (opens contract)
  - Empty state: "No signed contracts yet. Contracts are linked from individual job records."
  - Note: Contract storage system comes from future features (05). This is just the reference list.
- [ ] Report download: opens PDF in new tab (or downloads on mobile)
- [ ] Loading states, error states, empty states ("No reports generated yet. Generate your first report from a job.")
- [ ] Mobile responsive: stacked cards, full-width filters

---

### Phase 2: Supplement Documentation — ❌
Track supplement submissions and their outcomes per job.

**Backend:**

- [ ] Alembic migration: create `supplements` table (see schema above)
- [ ] `POST /v1/supplements` — create supplement
  - Body: `{job_id, description, amount, notes}`
  - Auto-assigns `supplement_number` (MAX of existing per job + 1)
  - Status defaults to `draft`
  - Logs event to `event_history`: "Supplement #N created for [job address]"
- [ ] `GET /v1/supplements` — list supplements
  - Query params: `job_id`, `status`, `page`, `per_page`
  - Returns `{items: [...], total: N}`
- [ ] `GET /v1/supplements/{id}` — single supplement detail
- [ ] `PATCH /v1/supplements/{id}` — update supplement
  - Updatable fields: description, amount, status, carrier_response, approved_amount, notes
  - Status transitions: draft → pending → submitted → (approved | denied | partial)
  - When status changes to `submitted`: set `submitted_at`
  - When status changes to `approved`/`denied`/`partial`: set `responded_at`
  - Logs status changes to `event_history`
- [ ] `DELETE /v1/supplements/{id}` — soft-delete (set `deleted_at`)
- [ ] `GET /v1/supplements/summary?job_id=X` — supplement summary for a job
  - Returns: `{total_requested, total_approved, count_by_status: {pending: N, approved: N, ...}, approval_rate}`
- [ ] RLS policy: company_id isolation via service_role (backend enforces)
- [ ] pytest: supplement CRUD, auto-numbering, status transitions, summary aggregation
- [ ] pytest: validation — cannot skip status steps, cannot set responded_at without status change
- [ ] pytest: tenant isolation — company A cannot see company B supplements

**Frontend:**

- [ ] Supplements tab in Reports page
- [ ] Supplement list per job:
  - Job selector at top (same searchable dropdown as Documents tab)
  - Table: supplement #, description, amount requested, status badge, amount approved, date submitted, date responded
  - Status badges: draft (gray), pending (amber), submitted (blue), approved (green), denied (red), partial (purple)
- [ ] "Add Supplement" button → form: description (text), amount (currency input), notes (optional textarea)
- [ ] Supplement detail panel (click row to expand):
  - Full description, amount requested vs approved
  - Status workflow buttons: "Mark as Submitted" → "Record Response" (approve/deny/partial with amount)
  - Carrier response notes textarea
  - Timeline of status changes (from event_history)
- [ ] Summary cards at top of Supplements tab:
  - Total Supplemented (sum of all amounts requested)
  - Total Approved (sum of approved_amount)
  - Approval Rate (approved / (approved + denied + partial) as percentage)
  - Pending Count
- [ ] Empty state: "No supplements tracked yet. Add a supplement to start tracking carrier responses."
- [ ] Mobile: cards instead of table, swipe to expand detail

---

### Phase 3: Business Analytics — ❌
Aggregate reporting for business intelligence. Owner and admin roles only.

**Backend:**

- [ ] `GET /v1/analytics/revenue` — revenue by job type per period
  - Query params: `period` (month | quarter | year), `start` (YYYY-MM), `end` (YYYY-MM)
  - Returns: `{periods: [{period: "2026-01", mitigation: 45000, reconstruction: 32000, fire_smoke: 12000}, ...]}`
  - Revenue source: `jobs.total_amount` (or sum of line items if available)
  - Role check: owner or admin only
- [ ] `GET /v1/analytics/cycle-time` — average days from open to close by category
  - Query params: `job_type` (optional filter), `start`, `end`
  - Returns: `{overall_avg_days: 14.2, by_type: {mitigation: 8.5, reconstruction: 28.3, fire_smoke: 12.1}}`
  - Calculated from: `jobs.created_at` to `jobs.status = 'collected'` (or `job_complete`)
  - Role check: owner or admin only
- [ ] `GET /v1/analytics/carrier-performance` — per carrier stats
  - Returns: `{carriers: [{name: "State Farm", job_count: 12, avg_payment_days: 34, approval_rate: 0.82, total_billed: 156000, total_collected: 128000}, ...]}`
  - Payment days: `jobs.created_at` to status `collected`
  - Approval rate: from supplements table (approved / total per carrier)
  - Role check: owner or admin only
- [ ] `GET /v1/analytics/volume` — job counts by period
  - Query params: `group_by` (month | quarter | year), `start`, `end`
  - Returns: `{periods: [{period: "2026-01", total: 8, mitigation: 5, reconstruction: 2, fire_smoke: 1}, ...]}`
  - Role check: owner or admin only
- [ ] pytest: each analytics endpoint with sample data, verify aggregation math
- [ ] pytest: role enforcement — tech cannot access analytics endpoints
- [ ] pytest: date range filtering, empty periods return zero values

**Frontend:**

- [ ] Analytics tab in Reports page (visible to owner/admin only; hidden for tech role)
- [ ] Date range picker at top (default: last 12 months)
- [ ] Revenue chart:
  - Stacked bar chart by period, colored by job type
  - Legend: Mitigation (blue), Reconstruction (green), Fire/Smoke (amber)
  - Hover: shows exact amounts per type
- [ ] Cycle Time chart:
  - Horizontal bar chart by job type category
  - Shows average days with value labels
  - Color-coded: green (<14 days), amber (14-30), red (>30)
- [ ] Carrier Performance table:
  - Columns: carrier name, job count, avg payment days, approval rate (%), total billed, total collected
  - Sortable columns
  - Approval rate cell: green (>80%), amber (60-80%), red (<60%)
- [ ] Job Volume chart:
  - Line chart by month, with total line + per-type lines
  - Hover: shows counts per type
- [ ] "Export CSV" button per chart/table → downloads data as CSV
- [ ] Charts via `recharts` library (lightweight, React-native, already common in Next.js projects)
- [ ] Loading skeletons for each chart card
- [ ] Empty state: "Not enough data yet. Analytics populate as you complete jobs."
- [ ] Mobile: charts stack vertically, full-width, horizontal scroll on table

---

### Phase 4: Timesheets — ❌
Reporting view over time clock data collected in 04A Phase 6. Read-only — no time entry editing here.

**Backend:**

- [ ] `GET /v1/timesheets` — weekly hours aggregation
  - Query params: `week_of` (ISO date, snaps to Monday), `user_id` (optional — omit for all techs)
  - Returns:
    ```json
    {
      "week_start": "2026-04-13",
      "week_end": "2026-04-19",
      "techs": [
        {
          "user_id": "...",
          "name": "Mike Johnson",
          "days": {
            "mon": 8.5,
            "tue": 9.0,
            "wed": 8.0,
            "thu": 8.5,
            "fri": 7.5,
            "sat": 4.0,
            "sun": 0
          },
          "total_hours": 45.5,
          "overtime_hours": 5.5,
          "sessions": [
            {
              "date": "2026-04-13",
              "clock_in": "07:00",
              "clock_out": "15:30",
              "job_id": "...",
              "job_address": "123 Main St"
            }
          ]
        }
      ]
    }
    ```
  - Role check: owner/admin sees all techs. Tech sees only `user_id=me`.
  - Reads from `time_entries` table (created in 04A Phase 6)
  - Overtime flag: any tech with >40 hours in the week
- [ ] `GET /v1/timesheets/export` — CSV export for payroll
  - Query params: `start` (ISO date), `end` (ISO date), `format=csv`
  - Returns CSV with columns: Tech Name, Week Of, Mon, Tue, Wed, Thu, Fri, Sat, Sun, Total, Overtime
  - One row per tech per week in the date range
  - Role check: owner/admin only
- [ ] pytest: weekly aggregation math (sum daily hours, calculate overtime)
- [ ] pytest: role enforcement — tech sees only own hours
- [ ] pytest: CSV export format validation
- [ ] pytest: edge cases — no time entries for a week returns zeros, partial week (mid-week hire)

**Frontend:**

- [ ] Timesheets tab in Reports page
- [ ] Week picker: left/right arrows to navigate weeks (Mon-Sun), "This Week" shortcut button
- [ ] Owner/admin view:
  - Table: tech name, Mon-Sun daily hours, Weekly Total, Overtime column
  - Overtime flag: red badge if >40 hours
  - Click tech name → expand to show individual clock in/out sessions with job assignments
  - Summary row at bottom: total hours across all techs
- [ ] Tech view:
  - Same table layout, single row (their own hours only)
  - Session detail always expanded
- [ ] "Export for Payroll" button (owner/admin only):
  - Date range picker modal (default: current month)
  - Downloads CSV file
- [ ] Empty state: "No time entries this week. Time clock data appears here when techs clock in via the Dashboard."
- [ ] Note: Depends on 04A Phase 6 (time clock). If time_entries table doesn't exist yet, show: "Timesheets require the Time Clock feature (coming soon)."
- [ ] Mobile: horizontal scroll on table, or pivot to card layout per tech

---

## Technical Approach

**PDF Generation (Phase 1):** Server-side via WeasyPrint (Python HTML/CSS → PDF). Each report type has an HTML/Jinja2 template with Tailwind-like utility classes for layout. Company branding (logo, colors, contact info) injected from `companies` table. Generated PDFs stored in Supabase Storage bucket `reports/`. Presigned download URLs (60-min expiry) for secure access. Generation is synchronous for V1 (reports are small — under 50 pages). If generation exceeds 30s, future optimization: background task queue.

**Report Templates (Phase 1):** Shared base template with company header, page numbers, and footer. Each report type extends the base with its own content sections. Template files live in `backend/api/reports/templates/`. Data fetching is one query per section (rooms, photos, readings, etc.) — no N+1.

**Supplements (Phase 2):** Simple CRUD with status workflow. Status transitions are validated server-side (no skipping steps). `supplement_number` auto-assigned via `SELECT COALESCE(MAX(supplement_number), 0) + 1`. Event history integration for audit trail. Future: when Xactimate integration matures, `line_items` JSONB column populates with structured data.

**Analytics (Phase 3):** All aggregation done in PostgreSQL (GROUP BY, DATE_TRUNC, AVG, COUNT). No materialized views for V1 — queries run against live data. Acceptable for <1000 jobs. If performance degrades, add materialized views with periodic refresh. Revenue source depends on what's available: `jobs.total_amount` if populated, otherwise count-based metrics only.

**Timesheets (Phase 4):** Pure read layer over `time_entries` table from 04A. Aggregation via PostgreSQL `DATE_TRUNC('day')` + `SUM(EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600)`. Overtime is a display concern (>40 weekly hours), not stored. CSV export via Python `csv` module — no external dependency.

**Key Files:**
- `backend/api/reports/` — report generation, templates, CRUD
- `backend/api/reports/templates/` — Jinja2 HTML templates for each report type
- `backend/api/reports/pdf_generator.py` — WeasyPrint wrapper, base template, company branding
- `backend/api/supplements/` — supplement CRUD, status workflow
- `backend/api/analytics/` — aggregation endpoints
- `backend/api/timesheets/` — timesheet aggregation, CSV export
- `web/src/app/(protected)/reports/` — Reports page with tab layout
- `web/src/app/(protected)/reports/documents/` — Documents tab
- `web/src/app/(protected)/reports/supplements/` — Supplements tab
- `web/src/app/(protected)/reports/analytics/` — Analytics tab
- `web/src/app/(protected)/reports/timesheets/` — Timesheets tab
- `web/src/lib/hooks/use-reports.ts` — TanStack Query hooks for reports API
- `web/src/lib/hooks/use-supplements.ts` — TanStack Query hooks for supplements API
- `web/src/lib/hooks/use-analytics.ts` — TanStack Query hooks for analytics API
- `web/src/lib/hooks/use-timesheets.ts` — TanStack Query hooks for timesheets API

## Quick Resume

```bash
cd /Users/lakshman/Workspaces/Crewmatic
git checkout lm-dev
# Continue at: Phase 1, step 1 (extend reports table migration)
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Source document:** Brett's "Crewmatic UI Layout & Navigation Summary v2.0" (April 13, 2026), filed at `docs/research/layout-summary-v2.pdf`
- **Extends existing `reports` table** from Spec 01 rather than creating a new table. Adds new report_type values to the CHECK constraint and new columns (generated_by, file_size_bytes, title).
- **Server-side PDF generation (WeasyPrint)** replaces Spec 01's client-side browser print. WeasyPrint is Python-native, produces consistent PDFs regardless of browser, and supports proper pagination, headers/footers, and page numbers. Client-side export remains as fallback on the job detail page.
- **Supplements are separate from daily_reports (04AI).** Daily auto-reports are automated progress emails. Supplements are financial documents tracking additional scope requests. Different lifecycle, different audience.
- **Analytics queries run against live data for V1.** With <1000 jobs, PostgreSQL aggregation is fast enough. Materialized views are the upgrade path if query times exceed 2s.
- **Timesheets are read-only over 04A data.** No time entry editing in Reports. If a clock entry is wrong, it's corrected in the Dashboard time clock (04A). Timesheets just aggregate and display.
- **Phase ordering rationale:** Document reports first (immediate value — adjusters need these), then supplements (financial tracking), then analytics (business intelligence after enough data), then timesheets (depends on 04A time clock being built).
- **Signed Contracts are a reference list, not a generator.** Contract storage comes from future features (05). The Documents tab just shows a read-only list of contracts linked from job records.
- **CSV export over Excel for V1.** CSV is universal, zero dependencies, and importable by any payroll system. Excel export can be added later if requested.
- **Carrier Submission Packet is the flagship report.** This is the "everything the adjuster needs in one PDF" deliverable — Brett's most requested feature. It bundles moisture data, photos, scope, and equipment into one organized document.
- **Charts via recharts.** Lightweight, React-native, SSR-compatible, widely used in Next.js projects. No heavy charting library needed for 4 chart types.
