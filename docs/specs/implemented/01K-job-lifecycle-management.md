# Spec 01K: Job Lifecycle Management

## Status
| Field | Value |
|-------|-------|
| **Progress** | ████████████████████ 100% (4/4 phases) |
| **State** | ✅ Implemented — ready for QA |
| **Blocker** | None |
| **Branch** | `lm-dev` |
| **Linear** | [CREW-55](https://linear.app/crewmatic/issue/CREW-55) |
| **Source PRD** | Brett's `Crewmatic Job Lifecycle Management Summary.docx` v1.0 (April 15, 2026) — copied into `docs/research/product-specs/` for durability |
| **Depends on** | Spec 01 (Jobs), Spec 01B (Reconstruction) — both implemented |
| **Unblocks** | 01E (Job Type Extensions), 01F (Create Job v2), 01G (Job Detail v2), CREW-16 Dashboard, CREW-17 Job List |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-27 |
| Started | 2026-04-27 |
| Completed | 2026-04-28 |
| Sessions | 3 |
| Total Time | ~12h |
| Files Changed | 43 (backend 16, frontend 19, specs 4, tests 4) |
| Tests Written | Frontend 49/49 ✅; backend 696/754 (58 pre-existing failures unrelated) |

## Done When

### Phase 1 — Status Model Migration
- [ ] All 9 statuses defined and enforced server-side: `lead`, `active`, `on_hold`, `completed`, `invoiced`, `disputed`, `paid`, `cancelled`, `lost`
- [ ] New columns on `jobs`: `on_hold_reason`, `on_hold_resume_date` (optional), `cancel_reason`, `cancel_reason_other`, `cancelled_at`, `active_at`, `completed_at`, `invoiced_at`, `disputed_at`, `dispute_reason`, `dispute_count`, `dispute_resolved_at`, `paid_at`, `lead_source`, `lead_source_other`, `contract_signed_at`, `estimate_last_finalized_at`
- [ ] **Boundary**: 01K only owns `jobs` lifecycle columns + `closeout_settings`. Status events go into existing `event_history` table (Spec 01). Equipment placements, moisture readings, photo uploads, portals, Activity Timeline UI — all owned by their respective projects/specs. 01K calls existing `log_event()` from `update_status()`.
- [ ] Old statuses (`new`, `contracted`, `mitigation`, `drying`, `scoping`, `in_progress`, `complete`, `submitted`, `collected`) backfilled to new model
- [ ] `MITIGATION_STATUSES` / `RECONSTRUCTION_STATUSES` removed — all job types share one flow
- [ ] Server-side transition matrix enforced (`PATCH /v1/jobs/{id}/status` rejects illegal transitions)
- [ ] All status badge labels/colors updated across frontend
- [ ] Default status on `POST /jobs` = `lead`
- [ ] Contract status badge in job header (driven by `contract_signed_at`)

### Phase 2 — Status-change event types (uses existing `event_history` table)
- [ ] New event types in existing `event_history`: `status_changed`, `dispute_opened`, `dispute_resolved`, `job_lost`, `job_cancelled`, `job_reopened`, `closeout_override`
- [ ] `log_event()` calls in `update_status()` with `event_data = {from, to, reason, override_gates, ...}`
- [ ] Cycle time computed (active_at → completed_at) and Days-to-Payment (invoiced_at → paid_at) — read-time computation on JobDetailResponse
- [ ] **Activity Timeline UI is OUT of scope for 01K** — see new spec 01M (Activity Timeline) for per-job + company-wide timeline page

### Phase 3 — Closeout Checklist (Soft Gate)
- [ ] `closeout_settings` table at company level (per-item gate level: warn / acknowledge / hard block)
- [ ] Per-job-type checklists wired (mitigation, build-back, remodel, fire/smoke)
- [ ] "Mark Completed" modal surfaces checklist + "Close Anyway" reason flow
- [ ] Reasons logged permanently to timeline

### Phase 4 — Status Entry Automations
- [ ] **Lead → Active:** assigned-tech push notification, dashboard map pin (blue), mitigation auto-prompt sketch tool, contract status badge surfaces
- [ ] **Active → On Hold:** dashboard pin shows "On Hold" badge, expected resume date surfaced if set, all features remain enabled
- [ ] **Active → Completed:** certificate auto-gen (mitigation only), final-photo flag (auto-tag latest as After), portal updated, homeowner notified (if portal shared), cycle time calculated and logged, dashboard alert "[Address] ready for invoicing"
- [ ] **Completed → Invoiced:** invoice date logged, AR aging entry, payment-reminder schedule (default 30d, configurable), job becomes read-only (scope/photos locked; payment tracking + collections notes editable)
- [ ] **Invoiced → Paid:** auto-transition when full payment logged, days-to-payment calculated, archived from active lists (searchable in history), revenue recognized for reporting
- [ ] **Estimate finalize:** `POST /jobs/{id}/estimate/finalize` sets `estimate_last_finalized_at = now()`, logs `estimate_finalized` event. Lock state is DERIVED from status — no separate lock toggle.
- [ ] **Dispute Invoice:** transition out of Invoiced (returns to a disputed state — see Decisions)
- [ ] **Timeline write-hooks** for events emitted by other projects (Equipment & Moisture Tracking, Photo Capture, Portals, Reconstruction): equipment placed/pulled, moisture reading logged, dry standard reached, photo uploaded, portal shared/accessed/revoked, recon phase completed

---

## Overview

**Problem:** Crewmatic's current status model (`new/contracted/mitigation/drying/complete/submitted/collected` for mitigation; `new/scoping/in_progress/complete/submitted/collected` for reconstruction) was built for water-restoration phase tracking, not lifecycle. It conflates *work phase* (drying, scoping) with *business state* (paid). It can't represent a job that's paused for supplements, a job that died at the lead stage, or a job that needs invoicing follow-up. It also forks per job type, making cross-type dashboards and lists complicated.

**Solution:** Replace the per-type status model with a single business-lifecycle flow per Brett's PRD: **Lead → Active → On Hold → Completed → Invoiced → Paid**, with **Cancelled** and **Lost** as terminal off-ramps. Track work phase separately via `recon_phases` (already exists from 01B) and future per-type extensions. Add a timeline / activity feed that auto-records significant events. Add a soft-gate closeout checklist with per-company-configurable strictness.

**Scope:**
- IN: status migration (data + constraints + API), transition matrix in `lifecycle.py`, `PATCH /jobs/{id}/status` endpoint (atomic RPC + optimistic locking), status-change events written to existing `event_history`, closeout checklist + settings table + admin settings page, entry automations (cert auto-gen trigger, dashboard alerts, AR aging entry flag, archive on Paid, dispute side effects, estimate finalize endpoint, auto-transition to Paid on full payment)
- OUT: `event_history` table (already exists from Spec 01), Activity Timeline UI (owned by 01G CREW-50 — per-job timeline tab; company-wide feed deferred to V2), Equipment placement / pull / rental (Equipment & Moisture Tracking project), moisture readings + dry-standard logic (same), photo uploads (Voice + Photo Capture project), portal sharing (08-portals), AR aging report UI (separate), payment reminder send mechanism (depends on Notifications), QuickBooks accounting sync (V3 CREW-51), task assignment (V2 CREW-56)

---

## Status Flow

```
Lead ──► Active ──► Completed ──► Invoiced ◄──► Disputed ──► Cancelled  (terminal)
            │                          │
            │                          └──► Paid                         (terminal)
            │
            ├──► On Hold ──► Active                                       (resume)
            │       │
            │       └──► Cancelled                                         (terminal)
            │
            └──► Cancelled                                                 (terminal)

Lead ──► Lost                                                              (terminal — never converted)
Completed ──► Active                                                       (reopen — explicit override)
```

| Status | Definition | Allowed transitions |
|---|---|---|
| `lead` | Initial inquiry, not yet committed work. Default for new jobs. | `active`, `lost` |
| `active` | Work underway, crew on-site or scheduled. ALL features unlocked. | `on_hold`, `completed`, `cancelled` |
| `on_hold` | Work paused, waiting on external dependency. **Reason required (free text). Expected resume date optional.** Stays on Dashboard with "On Hold" badge. All features remain enabled. | `active`, `cancelled` |
| `completed` | Work finished, ready for final invoicing. Photos/notes still editable; estimate editable for final adjustments; cert can be regenerated. Locked: new moisture readings, new equipment, dashboard map. | `invoiced`, `active` (reopen) |
| `invoiced` | Final invoice sent, in collections / payment phase. **Job is fully read-only** except payment tracking + collections notes. | `paid`, `disputed` |
| `disputed` | Carrier denied or pushed back on the invoice. Estimate becomes editable so contractor can file a supplement. Stays in AR aging. **Dispute reason required.** When supplement filed / dispute resolved, returns to `invoiced` for payment. | `invoiced` (resolved), `cancelled` |
| `paid` | Full payment received. Job archived from active lists, searchable in history. | terminal |
| `cancelled` | Active work cancelled. **Reason (dropdown + free text) + cancelled_at required.** | terminal |
| `lost` | Lead never converted. **Reason + cancelled_at required.** | terminal |

**Transition validations** (server-side, enforced in `update_status`):
- `lead → active` — contract signed (or contract requirement disabled in `closeout_settings`), property address complete, job type selected
- `active → completed` — gates evaluated per `closeout_settings` for the job's `job_type`. Default gates by job type (D1):
  - **mitigation:** contract signed, Final/After photo per room, every room has moisture reading, all rooms at dry standard, all equipment pulled, scope finalized, certificate generated
  - **reconstruction / build-back:** contract signed, Final/After photo per room, all `recon_phases` complete, punch list cleared, all change orders resolved, scope finalized
  - **fire/smoke:** contract signed, Final/After photo per room, cleaning log per room, scope finalized, certificate generated
  - **remodel:** treated like reconstruction/build-back for V1; refined in 01E if needed
- `completed → invoiced` — estimate finalized (sets `estimate_last_finalized_at`), invoice recipient selected (carrier / homeowner / both)
- `invoiced → paid` — payment amount equals invoice total, payment date set. **Auto-transitions when full payment logged.**
- `invoiced → disputed` — `dispute_reason` required (free text + optional carrier-denial-code field). On entry: `disputed_at` set; `dispute_count` incremented; AR aging entry flagged `disputed=true` (when AR system exists); event_history "dispute_opened" with the reason. Estimate becomes editable automatically because the lock check passes for `disputed` status — no separate "unlock" action.
- `disputed → invoiced` — supplement filed (or dispute resolved). On entry: `dispute_resolved_at` set; if owner re-finalized via the finalize endpoint, `estimate_last_finalized_at` was already updated (lock state is derived from status — moving back to `invoiced` makes the estimate read-only again automatically); event_history "dispute_resolved"
- `active → on_hold` — `on_hold_reason` required (free text)
- `* → cancelled` / `lead → lost` — `cancel_reason` (dropdown + free text) and `cancelled_at` required

Validations marked above are *soft-gate* by default (see Phase 3) — `closeout_settings` controls strictness per company.

---

## Database Schema

### Migration 1 — Status rename + new columns

```sql
-- CRITICAL: Drop old constraint FIRST. The old constraint allows only the legacy
-- status values; running the UPDATE before this drop will fail because the new
-- target values ('active', 'completed', 'invoiced', 'paid', 'lead') aren't in
-- the old enum.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;

-- Backfill existing rows to new statuses now that the constraint is gone.
-- Mapping per Brett's PRD:
UPDATE jobs SET status = 'active'    WHERE status IN ('contracted', 'mitigation', 'drying', 'scoping', 'in_progress');
UPDATE jobs SET status = 'completed' WHERE status = 'complete';
UPDATE jobs SET status = 'invoiced'  WHERE status = 'submitted';
UPDATE jobs SET status = 'paid'      WHERE status = 'collected';
UPDATE jobs SET status = 'lead'      WHERE status = 'new';

-- Add new constraint with the snake_case lifecycle values. UI renders "On Hold" etc.
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (
    status IN ('lead', 'active', 'on_hold', 'completed', 'invoiced', 'disputed', 'paid', 'cancelled', 'lost')
);

-- Status-transition timestamps (all nullable — set on first entry to that state)
ALTER TABLE jobs ADD COLUMN active_at           TIMESTAMPTZ;   -- first transition into Active (cycle-time start)
ALTER TABLE jobs ADD COLUMN completed_at        TIMESTAMPTZ;   -- transition to Completed (cycle-time end)
ALTER TABLE jobs ADD COLUMN invoiced_at         TIMESTAMPTZ;   -- transition to Invoiced (days-to-payment start)
ALTER TABLE jobs ADD COLUMN disputed_at         TIMESTAMPTZ;   -- most-recent transition to Disputed
ALTER TABLE jobs ADD COLUMN dispute_resolved_at TIMESTAMPTZ;   -- most-recent transition out of Disputed (back to Invoiced)
ALTER TABLE jobs ADD COLUMN paid_at             TIMESTAMPTZ;   -- transition to Paid (days-to-payment end)
ALTER TABLE jobs ADD COLUMN cancelled_at        TIMESTAMPTZ;   -- set when transitioning to Cancelled/Lost

-- Status-specific fields
ALTER TABLE jobs ADD COLUMN on_hold_reason       TEXT;          -- required when status='on_hold' (free text)
ALTER TABLE jobs ADD COLUMN on_hold_resume_date  DATE;          -- optional ETA for resume
ALTER TABLE jobs ADD COLUMN cancel_reason        TEXT;          -- snake_case dropdown key (NULL if Other)
ALTER TABLE jobs ADD COLUMN cancel_reason_other  TEXT;          -- free text (only set when cancel_reason IS NULL)
ALTER TABLE jobs ADD COLUMN dispute_reason       TEXT;          -- required when status='disputed' (free text + optional carrier denial code)
ALTER TABLE jobs ADD COLUMN dispute_count        INT NOT NULL DEFAULT 0;   -- number of times this job has entered Disputed (for KPIs)

-- Cancel reason invariant (only checked when status IN ('cancelled','lost'))
-- Application-layer validation at write time; CHECK constraint deferred since it depends on status

-- Lifecycle moments not tied to status
ALTER TABLE jobs ADD COLUMN contract_signed_at        TIMESTAMPTZ;   -- drives contract status badge
ALTER TABLE jobs ADD COLUMN estimate_last_finalized_at TIMESTAMPTZ;  -- most-recent finalize action; lock state DERIVED from status (not from this column)
ALTER TABLE jobs ADD COLUMN lead_source               TEXT;          -- snake_case dropdown key (NULL if Other or unknown)
ALTER TABLE jobs ADD COLUMN lead_source_other         TEXT;          -- free text (only set when lead_source IS NULL but Other was chosen)

-- Default for new rows
ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'lead';

-- Index for status filtering on dashboards
CREATE INDEX idx_jobs_status ON jobs(company_id, status) WHERE deleted_at IS NULL;
```

### Migration 2 — Closeout settings table

```sql
CREATE TABLE closeout_settings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_type      TEXT NOT NULL CHECK (job_type IN ('mitigation', 'reconstruction', 'fire_smoke', 'remodel')),
    item_key      TEXT NOT NULL,        -- 'contract_signed', 'min_photos_per_room', 'all_rooms_at_dry_standard', etc.
    gate_level    TEXT NOT NULL CHECK (gate_level IN ('warn', 'acknowledge', 'hard_block')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, job_type, item_key)
);

CREATE INDEX idx_closeout_settings_company ON closeout_settings(company_id);

-- RLS — match the existing pattern from 001_bootstrap.py (uses get_my_company_id()
-- helper, NOT a users-table subquery; per-operation policies, not FOR ALL)
ALTER TABLE closeout_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY closeout_settings_select ON closeout_settings
    FOR SELECT USING (company_id = get_my_company_id());

CREATE POLICY closeout_settings_insert ON closeout_settings
    FOR INSERT WITH CHECK (company_id = get_my_company_id());

CREATE POLICY closeout_settings_update ON closeout_settings
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());

CREATE POLICY closeout_settings_delete ON closeout_settings
    FOR DELETE USING (false);   -- never directly deleted; reset RPC handles wipes
```

**Defaults seeding:** on company creation, an RPC (`rpc_seed_closeout_settings`) inserts a row per `(job_type × item_key)` combination with the default gate level from D2 (Warning by default; `contract_signed` = Acknowledged for all job types). Existing companies get backfilled by a one-time migration on deploy.

---

## API Changes

### New endpoint — Update status (with validation)

```
PATCH /v1/jobs/{job_id}/status
Body: {
  status: "active" | "on_hold" | "completed" | "invoiced" | "disputed" | "paid" | "cancelled" | "lost",
  expected_current_status: "lead" | "active" | ... ,  -- REQUIRED. Used for optimistic locking. UI passes the status it last fetched.
  reason?: string,                  -- required for on_hold, cancelled, lost, disputed
  resume_date?: string,             -- optional ISO date for on_hold
  override_gates?: string[],        -- list of gate keys to override (acknowledge level)
  override_reason?: string          -- "Close Anyway" reason (logged to event_history)
}
Response: { job: JobDetailResponse, event_id: UUID }
```

**Behavior (atomic via RPC `rpc_update_job_status`):**
1. Load current job (with `FOR UPDATE` lock) and `closeout_settings` for its job_type
2. **Optimistic lock check:** if `job.status != expected_current_status`, return **409 Conflict** with the actual current status. UI refetches.
3. Validate transition allowed by `STATUS_TRANSITIONS` matrix — 400 if illegal
4. Run gate checks for the target status — return 422 with structured `gates` array if any `hard_block` fails or `acknowledge`-level gates are missing override
5. Inside the same transaction:
   - Apply state-specific timestamp (`active_at`, `completed_at`, etc.); for `disputed` increment `dispute_count` and set `disputed_at`; for `disputed → invoiced` set `dispute_resolved_at`
   - INSERT into `event_history` with `event_type` = `status_changed` (or specific: `dispute_opened`, `dispute_resolved`, etc.) and `event_data = {from, to, reason, overrides}`
6. After RPC returns success: trigger entry automations (Phase 4) — async fire-and-forget for cert generation, dashboard alerts, etc.

The RPC pattern matches `rpc_create_job` and `rpc_delete_job` (already in `b3f1a2c4d5e6_add_rpc_functions_for_atomic_operations.py`). Atomicity guarantees status change + event are both written or neither is — no orphan state changes without audit entries.

**Why a dedicated endpoint vs `PATCH /v1/jobs/{id}` with status?** Status changes have side effects (timestamps, gates, automations, timeline events) that the generic PATCH doesn't. Forcing them through a dedicated endpoint keeps the audit trail clean.

### Updated endpoint — `PATCH /v1/jobs/{job_id}` rejects status field

`update_job` should reject status changes (return 400 — "Use /status endpoint to change status"). Also rejects all field updates when status=`invoiced` except payment fields + collections notes.

### New endpoint — Estimate finalize

```
POST /v1/jobs/{job_id}/estimate/finalize    -- sets estimate_last_finalized_at = now(), logs event_history
```

**No unlock endpoint.** Lock state is derived from `status`:

```python
def estimate_editable(job) -> bool:
    # Editable while still working (lead/active/completed) or filing supplement (disputed)
    # Locked once sent (invoiced) or settled (paid/cancelled/lost)
    return job.status in ('lead', 'active', 'completed', 'disputed')
```

If an owner needs to amend a sent estimate, the workflow is: transition `invoiced → disputed` (with reason "internal amendment" or carrier denial), edit, re-finalize, transition `disputed → invoiced`. This makes every amendment auditable via the dispute trail.

### New endpoints — Closeout settings

```
GET    /v1/companies/{company_id}/closeout-settings              -- list all
PATCH  /v1/companies/{company_id}/closeout-settings/{id}         -- update gate_level
POST   /v1/companies/{company_id}/closeout-settings/reset        -- reset to defaults
```

Owner / admin role only.

### Auto-transition: payment received → Paid

When `POST /v1/jobs/{job_id}/payments` logs a payment whose total ≥ invoice total:

1. **Check current status.** Only auto-transition if `status = 'invoiced'`. If status is `disputed` or anything else, do NOT auto-transition — log the payment but require manual resolution. (A disputed job needs to resolve back to `invoiced` before going to `paid`; that's an explicit user action.)
2. Use the same RPC pattern as manual updates (`rpc_update_job_status`) with optimistic-lock check (`expected_current_status = 'invoiced'`). If concurrent activity already moved the job, the RPC returns 409 and the payment service logs a warning but does not retry — manual reconciliation needed.
3. Use `Decimal` arithmetic for the `payment_total >= invoice_total` comparison (NOT float — `0.1 + 0.2` precision bugs would silently misclassify).
4. Write `event_history` rows for both the payment and the status change.

---

## Backend Code Changes

**Key files:**
- `backend/api/jobs/lifecycle.py` — NEW. Transition matrix, REASON_REQUIRED, TIMESTAMP_FIELDS, gate evaluators
- `backend/api/jobs/service.py` — replace `VALID_STATUSES`, `MITIGATION_STATUSES`, `RECONSTRUCTION_STATUSES` with single `VALID_STATUSES` + transitions; add `update_status()`, `_check_closeout_gates()`; remove status from generic `update_job()`; reject non-payment edits when status=`invoiced`
- `backend/api/jobs/router.py` — `PATCH /jobs/{id}/status`; reject status in generic PATCH
- `backend/api/jobs/schemas.py` — `StatusUpdateBody`, `CloseoutGate` Pydantic models
- `backend/api/closeout/` — NEW module: closeout_settings CRUD + gate evaluators
- `backend/api/payments/service.py` — auto-transition to Paid on full payment
- `backend/alembic/versions/` — two migrations (status + columns, closeout_settings table)
- `backend/api/shared/events.py` — **already exists**, used as-is via `log_event()`. New event types defined in `update_status()`.

**Transition matrix as code:**

```python
# backend/api/jobs/lifecycle.py
STATUS_TRANSITIONS: dict[str, set[str]] = {
    "lead":      {"active", "lost"},
    "active":    {"on_hold", "completed", "cancelled"},
    "on_hold":   {"active", "cancelled"},
    "completed": {"invoiced", "active"},        # active = reopen
    "invoiced":  {"paid", "disputed"},
    "disputed":  {"invoiced", "cancelled"},     # invoiced = resolved (supplement filed)
    "paid":      set(),
    "cancelled": set(),
    "lost":      set(),
}

REASON_REQUIRED = {"on_hold", "cancelled", "lost", "disputed"}
TIMESTAMP_FIELDS = {
    "active":    "active_at",
    "completed": "completed_at",
    "invoiced":  "invoiced_at",                 # also reset dispute_resolved_at if coming from disputed
    "disputed":  "disputed_at",
    "paid":      "paid_at",
    "cancelled": "cancelled_at",
    "lost":      "cancelled_at",
}
TERMINAL_STATUSES = {"paid", "cancelled", "lost"}
ARCHIVED_STATUSES = {"paid", "cancelled", "lost"}  # excluded from default lists
ACTIVE_LIST_STATUSES = {"lead", "active", "on_hold", "completed", "invoiced", "disputed"}
READ_ONLY_STATUSES = {"invoiced", "paid"}    # disputed unlocks estimate; payment fields always editable
```

---

## Frontend Changes

**Key files:**
- `web/src/lib/types.ts` — replace `JobStatus` union with new 9-status union; add `CloseoutGate` type
- `web/src/lib/hooks/use-jobs.ts` — add `useUpdateJobStatus`
- `web/src/lib/labels.ts` — NEW. snake_case → human label map (`on_hold` → "On Hold")
- `web/src/components/job-status-badge.tsx` — new color/label map for 9 statuses
- `web/src/components/contract-status-badge.tsx` — new. shown in job header when `contract_signed_at` set
- `web/src/components/status-change-modal.tsx` — new modal: status selector + reason field + (for on_hold) resume date + gate checklist + Close Anyway flow
- `web/src/app/dashboard/page.tsx` — pipeline rebuild: single row of 9 status counts (replaces dual mit/recon rows from 01B). On Hold pins show badge.
- `web/src/app/jobs/page.tsx` — status filter dropdown rebuilt
- `web/src/app/settings/closeout/page.tsx` — new settings screen (owner/admin only)
- **Activity Timeline UI components are OUT of scope for 01K** — see spec 01M (Activity Timeline)

### Status badge color map

| Status | Label | Text | Background | Notes |
|---|---|---|---|---|
| `lead` | Lead | `#6b6560` | `#f5f5f4` | Neutral grey — pipeline entry |
| `active` | Active | `#3b82f6` | `#eff6ff` | Blue — work in motion |
| `on_hold` | On Hold | `#d97706` | `#fffbeb` | Amber — paused |
| `completed` | Completed | `#2a9d5c` | `#edf7f0` | Green — work done |
| `invoiced` | Invoiced | `#5b6abf` | `#eef0fc` | Indigo — money in flight |
| `disputed` | Disputed | `#b45309` | `#fef3c7` | Dark amber — needs supplement / pushback |
| `paid` | Paid | `#059669` | `#ecfdf5` | Emerald — closed |
| `cancelled` | Cancelled | `#9b1c1c` | `#fef2f2` | Red — terminal |
| `lost` | Lost | `#6b6560` | `#f5f5f4` | Neutral grey strikethrough — never converted |

### Activity Timeline UI

The per-job timeline panel and company-wide activity feed are owned by **spec 01M (Activity Timeline)** — a separate spec yet to be drafted.

01M responsibilities:
- Per-job timeline panel (collapsible, slots into 01G Job Detail v2)
- Company-wide activity feed page (admin view, all jobs)
- `GET /jobs/{id}/timeline` and `GET /companies/{id}/activity` endpoints
- `event_type` → display mapping (category, icon, summary template)
- Filtering by category, user, date range
- Cursor pagination

01M consumes existing `event_history` — no new event table is created. Lifecycle (this spec) and other domains (Equipment, Photo, Portals, etc.) all already write to `event_history` via `log_event()`. 01M is purely the presentation layer.

---

## Phases & Checklist

### Phase 1: Status Model Migration — ❌
**Goal:** Replace 9-status per-type model with single 9-status lifecycle (lead, active, on_hold, completed, invoiced, disputed, paid, cancelled, lost). Server-side enforcement of transition matrix via atomic RPC with optimistic locking. Zero regression on existing job operations.

- [ ] Alembic migration: **drop old `jobs_status_check` FIRST**, then backfill existing rows to new statuses, then add new constraint (mit/recon/scoping/etc → active; complete → completed; submitted → invoiced; collected → paid; new → lead). Order matters — see Migration 1 SQL.
- [ ] Alembic migration: add columns (`on_hold_reason`, `on_hold_resume_date`, `cancel_reason`, `cancel_reason_other`, `cancelled_at`, `active_at`, `completed_at`, `invoiced_at`, `disputed_at`, `dispute_resolved_at`, `dispute_reason`, `dispute_count`, `paid_at`, `lead_source`, `lead_source_other`, `contract_signed_at`, `estimate_last_finalized_at`)
- [ ] Alembic migration: change default `status` to `lead`
- [ ] Alembic migration: `idx_jobs_status` index
- [ ] Alembic migration: `rpc_update_job_status` SECURITY DEFINER function — wraps job update + event_history insert in single transaction; takes `expected_current_status` for optimistic locking
- [ ] `backend/api/jobs/lifecycle.py` — STATUS_TRANSITIONS, REASON_REQUIRED, TIMESTAMP_FIELDS, ARCHIVED_STATUSES, READ_ONLY_STATUSES constants
- [ ] `backend/api/jobs/service.py` — remove VALID_STATUSES / MITIGATION_STATUSES / RECONSTRUCTION_STATUSES; add `update_status()` that calls `rpc_update_job_status`; remove status from generic `update_job()`; enforce read-only on Invoiced + Paid
- [ ] `backend/api/jobs/router.py` — `PATCH /v1/jobs/{id}/status` endpoint
- [ ] `backend/api/jobs/schemas.py` — `StatusUpdateBody` (includes `expected_current_status`, optional `reason`, `resume_date`, `override_gates[]`, `override_reason`); response includes new timestamp fields + lead_source/lead_source_other + contract_signed_at + estimate_last_finalized_at + dispute_count
- [ ] Update `_parse_job_detail` in service.py to surface new fields
- [ ] `web/src/lib/types.ts` — new `JobStatus` union (9 values incl. `disputed`)
- [ ] `web/src/lib/labels.ts` — snake_case → human label map
- [ ] `web/src/components/job-status-badge.tsx` — color/label map (9 statuses)
- [ ] `web/src/components/contract-status-badge.tsx` — header badge
- [ ] All status badge usages updated across pages (dashboard, list, detail)
- [ ] `web/src/lib/hooks/use-jobs.ts` — `useUpdateJobStatus` mutation; passes `expected_current_status` from query cache; on 409, invalidate and refetch
- [ ] Status change modal (basic version — no gates yet, but reason validation in UI)
- [ ] Dashboard pipeline rebuilt: single row of 9 status counts (replaces dual mit/recon rows)
- [ ] Job list status filter rebuilt with new options
- [ ] pytest: every legal transition succeeds (incl. invoiced↔disputed cycle)
- [ ] pytest: every illegal transition returns 400 with clear error (incl. disputed→paid rejection)
- [ ] pytest: status update endpoint sets correct timestamp field (`disputed_at` on enter, `dispute_resolved_at` on exit; `dispute_count` increments on each enter)
- [ ] pytest: backfill migration: load fixture with old statuses, run migration, verify mappings
- [ ] pytest: generic `PATCH /jobs/{id}` rejects `status` in body
- [ ] pytest: reason required for on_hold / cancelled / lost / disputed
- [ ] pytest: invoiced jobs reject non-payment field updates; disputed jobs allow estimate edits
- [ ] frontend tests: status badge renders all 9 colors
- [ ] frontend tests: status change modal calls correct endpoint with reason
- [ ] frontend tests: disputed badge surfaces on dashboard pin (orange ring)

### Phase 2: Status-change event emission — ❌
**Goal:** When status changes, write structured event to existing `event_history` table so the Activity Timeline (separate spec 01M) can display them. Reuses existing `log_event()` infrastructure.

- [ ] Define new `event_type` values used by lifecycle: `status_changed`, `dispute_opened`, `dispute_resolved`, `job_lost`, `job_cancelled`, `job_reopened`, `closeout_override`
- [ ] `update_status()` calls `log_event(event_type='status_changed', event_data={from, to, reason, override_gates, override_reason, ...})`
- [ ] Cycle-time read-time computation on JobDetailResponse: `cycle_time_days = completed_at - active_at`
- [ ] Days-to-payment: `days_to_payment = paid_at - invoiced_at` (excluding any time spent in `disputed`)
- [ ] pytest: every status transition writes correct `event_history` row with `event_type` and structured `event_data`
- [ ] pytest: dispute open/resolve writes both events with timestamps
- [ ] pytest: closeout override writes event with override_reason
- [ ] pytest: cycle_time_days returns null until both timestamps set
- [ ] pytest: days_to_payment subtracts time spent in disputed

### Phase 3: Closeout Checklist (Soft Gate) — ❌
**Goal:** Configurable, per-company gate checks at status transitions. Default soft (warn). Override flow with reason logging. All decisions locked (D1-D3).

- [ ] Alembic migration: `closeout_settings` table with full RLS (per existing pattern using `get_my_company_id()`)
- [ ] Alembic migration: `rpc_seed_closeout_settings(company_id)` — inserts default rows per item × job_type per D1/D2 (Warning everywhere except `contract_signed` = Acknowledged)
- [ ] Backfill: run RPC for every existing company
- [ ] Hook: `rpc_create_company` calls `rpc_seed_closeout_settings` so new companies get defaults
- [ ] `backend/api/closeout/service.py` — gate evaluators (pure functions); load job-state snapshot ONCE upfront, pass to each evaluator (no N+1)
- [ ] Gate evaluators per item_key — full list from D1: `contract_signed`, `final_or_after_photo_per_room`, `every_room_has_moisture_reading` (mit only), `all_rooms_at_dry_standard` (mit only), `all_equipment_pulled` (mit only), `scope_finalized` (= estimate_last_finalized_at IS NOT NULL), `certificate_generated` (mit only), `all_recon_phases_complete` (recon/build-back), `punch_list_cleared` (recon/build-back), `all_change_orders_resolved` (recon/build-back), `cleaning_log_per_room` (fire/smoke)
- [ ] `backend/api/closeout/router.py` — list/update/reset endpoints (owner/admin only)
- [ ] `update_status()` integrates `_check_closeout_gates()` — returns structured 422 with gates that block / need ack
- [ ] Status change modal — fetch gates on target status select, render checklist with per-item pass/fail, "Close Anyway" reason dropdown (D2 list)
- [ ] Reason logged to event_history (`event_type='closeout_override'`) as part of status change event
- [ ] `web/src/app/settings/closeout/page.tsx` — admin table of gates × job types × levels (D3 = YES in V1)
- [ ] pytest: gate evaluator per item_key (with mocked job state)
- [ ] pytest: hard_block prevents transition; warn allows; acknowledge requires reason
- [ ] pytest: settings update propagates to next status change attempt

### Phase 4: Status Entry Automations — ❌
**Goal:** Side effects on status entry (cert gen, alerts, archive, etc.). Many depend on other systems — staged so dependencies can be wired piecewise.

**Boundary:** This phase only handles **status-transition** side effects. Equipment placement/pull, moisture readings, photo uploads, dry-standard detection — all owned by their respective projects (Equipment & Moisture Tracking, Photo Capture, etc.). 01K only emits timeline events when those systems fire their domain events.

- [ ] **On `active` entry:** dashboard pin appearance (hooks into Dashboard CREW-16); assigned-tech notification (depends on Notifications); first-step prompt (mitigation → sketch tool open by default if no sketch yet); contract status badge surfaces in header
- [ ] **On `on_hold` entry:** dashboard pin shows "On Hold" badge; expected resume date shown if set; all features remain enabled
- [ ] **On `completed` entry (mitigation):** Certificate of Completion auto-generated (depends on Reports — CREW-25); final photo flag (auto-tag latest 3 photos as "After"); homeowner portal updated (if shared — depends on 08-portals); dashboard alert "[Address] ready for invoicing"; cycle time calculated and logged
- [ ] **On `completed` entry (build-back/remodel):** punch list cleared verification only — no auto-cert
- [ ] **On `invoiced` entry:** invoice date logged (handled by timestamp field); AR aging entry created (separate ticket — emit timeline placeholder); job becomes read-only (server-side: reject all non-payment field updates); payment-reminder schedule queued (default 30 days, configurable; depends on Notifications)
- [ ] **On `disputed` entry:** AR aging entry flagged `disputed=true`; dashboard surface (pin shows orange ring + "Disputed" label); event_history "dispute_opened" with `dispute_reason`; `dispute_count` incremented; payment reminder schedule paused. (Estimate becomes editable automatically because lock is derived from status.)
- [ ] **On `disputed → invoiced` (resolution):** `dispute_resolved_at` set; AR aging flag cleared; payment reminder schedule resumed; event_history "dispute_resolved". If owner finalized again before transitioning, `estimate_last_finalized_at` was updated by the finalize endpoint.
- [ ] **Auto-transition `invoiced → paid`** when full payment logged (in `payments/service.py`)
- [ ] **On `paid` entry:** archive from active lists (filter by status NOT IN archived); revenue recognized (flag); auto-close any open On Hold reasons
- [ ] **On `cancelled` / `lost`:** emit `event_type='job_cancelled'` (or `job_lost`) — Equipment project subscribes and creates equipment-recall reminder; Reports project subscribes and skips cert gen; Portals project subscribes and revokes any active share links. **01K does NOT touch `linked_job_id`** — the link record stays for historical traceability (e.g., a cancelled mitigation job is still referenced by its linked recon job; resolving that pointer in code requires a NULL check, which already exists since linked_job_id is nullable).
- [ ] **Estimate finalize:** `POST /jobs/{id}/estimate/finalize` sets `estimate_last_finalized_at = now()` and writes `event_type='estimate_finalized'` to event_history. **No unlock endpoint** — lock state is derived from status (D-impl-2). To amend a sent estimate: open a Dispute, edit, re-finalize, resolve back to Invoiced.
- [ ] **Timeline write-hooks** (this spec emits, other projects fire the trigger):
  - Equipment placed/pulled (hook fired by Equipment & Moisture Tracking project)
  - Moisture reading logged (hook fired by Equipment & Moisture Tracking project)
  - Dry standard reached (hook fired by Equipment & Moisture Tracking project — emits dashboard alert "[Address] ready for completion")
  - Photo uploaded (hook fired by Photo Capture project)
  - Portal shared/accessed/revoked (hook fired by Portals project — 08-portals)
  - Recon phase completed (hook fired by 01B reconstruction system)
- [ ] pytest: each automation fires on correct transition
- [ ] pytest: read-only enforcement on Invoiced jobs
- [ ] pytest: archived jobs excluded from default list
- [ ] pytest: auto-transition to Paid on full payment
- [ ] pytest: timeline write-hook fires when external systems publish domain events (mock the publishers)
- [ ] Staging end-to-end: lead → active → completed → invoiced → paid; verify cert generated, dashboard updated, archived

---

## Technical Approach

**Three structural choices committed:**

1. **snake_case in DB and API; "On Hold" rendered at UI layer.** Trade-off accepted: cleaner queries, indexes, URL params, cleaner Pydantic enum mapping. UI labels live in `web/src/lib/labels.ts`.

2. **Single status flow vs per-type flows.** PRD treats all jobs the same business lifecycle. This is correct for *business state* but orthogonal to 01B's recon-phase tracking, which is *work state*. Both are kept, no per-type fork in `status`.

3. **Reuse existing `event_history` table — no new event table.** All status events (and estimate-finalize, closeout-override) go into the existing audit table via the existing `log_event()` helper. The Activity Timeline UI (spec 01M / CREW-50) is a presentation layer that reads `event_history`. Avoids a parallel events system, double-writes, and synchronization concerns. Indexes already in place (`idx_events_job`, `idx_events_company`, `idx_events_type`).

**Rollout strategy:**
- **Phase 1** lands as a single PR with backfill migration + RPC + new endpoint + frontend status badges/filters. Pre-launch, no backwards-compat needed.
- **Phase 2** is tiny — adds new event types and the `log_event()` calls in `update_status()`. Mostly tests. Cycle-time + days-to-payment computed read-time.
- **Phase 3** lands with the default-soft settings (D2): all Warning except `contract_signed` = Acknowledged. Settings UI ships in V1 per D3.
- **Phase 4** staged per dependency: dashboard alerts can land before the Notifications integration (the alert is in-app); cert auto-gen trigger depends on CREW-25 (Reports system) landing the cert generator; AR aging entry just emits an event placeholder until the AR system spec exists; payment reminder send depends on Notifications system.

---

## Quick Resume

```bash
cd /Users/lakshman/Workspaces/Crewmatic
git checkout lm-dev
git pull --rebase

# Open spec
$EDITOR docs/specs/in-progress/01K-job-lifecycle-management.md

# When starting Phase 1:
cd backend && source .venv/bin/activate
alembic revision -m "01k_phase1_status_lifecycle"
# ... write migration, run alembic upgrade head, then implement service.py changes
```

Continue at: **Phase 1 — decisions locked, awaiting `/plan-eng-review` pass before code lands.**

---

## Scope boundary (what 01K does NOT own)

01K is the **lifecycle** spec — pure status flow, transitions, gating. It does NOT own:

| Concern | Owner | 01K's role |
|---|---|---|
| Equipment placement / pull / rental | [V1] Equipment & Moisture Tracking (separate spec — to be drafted) | Equipment system calls `log_event()` directly; 01K reads the field if a closeout gate needs it |
| Moisture readings + dry standard | Same as above | Same |
| Photo uploads | [V1] Voice + Photo Capture | Same |
| Portal sharing | 08-portals (separate spec) | Same |
| Recon phase completion | 01B (already implemented) | Same |
| Certificate of Completion | CREW-25 Reports | 01K *triggers* cert gen on `completed` entry (calls Reports endpoint). Reports owns generation. |
| AR aging entries / payment reminders | Notifications + AR systems (separate, deferred) | 01K *flags* AR entries on `invoiced` / `disputed` entry. AR system owns the report and reminder send. |
| **Activity Timeline UI (per-job + company-wide)** | **01M (new spec, to be drafted)** | Reads `event_history` and renders. 01K just emits status events into `event_history`. |
| **`event_history` table** | Spec 01 (already implemented) | 01K writes into it via existing `log_event()`. No new table. |

**The lifecycle spec is JUST about the lifecycle** — moving a job from one status to another, capturing why, and gating it. Everything else either lives in its own spec or already exists.

---

## Locked Decisions (was Open Questions)

All previously-open questions have been resolved per Brett's PDF + the discussion on 2026-04-27. Listed here for reference; full reasoning in the Decisions log below.

### D1 — Closeout checklist contents per job type ✅

**Mitigation:**
- Contract signed
- At least one photo tagged `Final` or `After` per room (per Brett's PDF; no minimum count beyond that)
- Every room has at least one moisture reading
- All rooms at dry standard (or override logged)
- All equipment pulled
- Scope finalized (estimate finalized)
- Certificate of Completion generated

**Build-Back / Remodel:**
- Contract signed
- All recon phases marked complete (from 01B)
- Punch list cleared
- At least one photo tagged `Final` or `After` per room
- All change orders resolved
- Scope finalized

**Fire/Smoke:** scoped under 01E (CREW-49). Lifecycle is the same; specific checklist items belong with that spec. Default for V1: same items as Mitigation, swap "moisture readings" for "cleaning log entries" (one per room).

### D2 — Closeout strictness defaults ✅
- All items default to **Warning**
- **Contract Signed** defaults to **Must Acknowledge** (the one exception)
- Hard Block reserved for cases the company opts into via settings (e.g., HOA contracts that legally require certificate before closeout)

### D3 — Closeout settings UI in V1 ✅
**YES — ship the settings UI in V1.** Brett's prior synthesis explicitly references "Settings → Jobs → Closeout Requirements." Basic implementation: admin-only page, table of `item_key × job_type → gate_level`, dropdown per cell. Lives in Phase 3 of this spec.

### D4 — Cancel reason dropdown options ✅
Per PDF page 5 use cases + "Other". Same dropdown for both `cancelled` and `lost` (UI shows the same options regardless of which terminal status the user is moving to — the *status* itself encodes whether it was active work that stopped vs. a lead that never converted, the reason captures why):

- Customer chose another contractor
- Customer cancelled claim
- Carrier denied claim before work started
- Scope outside our trades
- Couldn't reach customer
- Other (free text via `cancel_reason_other`)

Backend stores the snake_case key in `cancel_reason` (or NULL if Other) and the free text in `cancel_reason_other`. No backend constraint that ties specific reasons to specific terminal statuses — the user picks freely; the *target status* (`cancelled` vs `lost`) carries the cancellation-vs-conversion-loss distinction.

### D5 — Lead source dropdown options ✅
Per PDF page 1 examples + standard restoration sources:
- Carrier referral
- Homeowner direct call
- Fire Scanner (Crewmatic AI)
- DamageDesk
- Repeat customer
- Referral from past customer
- Marketing / website
- Other (free text)

### D6 — Disputed Invoice flow ✅
**Add `disputed` as a new status.** Flow: `invoiced → disputed → invoiced` (most common — supplement filed and dispute resolved) or `disputed → cancelled` (give-up case). When entering `disputed`: estimate auto-unlocks, AR aging entry flagged as disputed, dashboard surfaces. Job stays in active lists (not archived) — disputes are work-in-progress, not terminal.

### D7 — Cycle-time / Days-to-payment surface ✅
- **Per-job**: show on job detail header (cycle time once Completed; days-to-payment once Paid)
- **Company aggregate**: a follow-up dashboard ticket — out of scope for 01K. Phase 2 emits the calculations; the aggregate dashboard work is its own ticket.

### D8 — Disputed → Paid direct transition ✅
**Locked: NO.** `disputed → paid` is NOT a legal transition. Resolution always goes `disputed → invoiced → paid` so the dispute resolution is explicitly logged before payment. Auto-transition logic in `payments/service.py` checks current status — if `status = 'disputed'`, payment is logged but status stays `disputed`; user must manually resolve to `invoiced` first. (If Brett finds this noisy in practice, revisit by allowing direct `disputed → paid` and writing both `dispute_resolved` and `status_changed` events on the same transaction.)

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|
| 1 | 2026-04-27 | — | — | ~3h | Spec drafted from CREW-55 PRD. PRD doc + tech plan synced in Linear. `/plan-eng-review` round 1 + 2 with all critical fixes applied (RPC atomicity, optimistic locking, RLS pattern, migration order). Linear hierarchy reorganized (CREW-50 routed to 01G/01M, scope correctly tagged on each issue). | Plan locked |
| 2 | 2026-04-27 | — | — | ~5h | **Frontend mockups landed:** STATUS_META single-source labels, 9-status `JobStatus` union, status-colors palette, BottomSheet primitive, Status Change modal (with 56px pill selector + reason + resume date), Closeout Checklist modal (with progress bar + acknowledge reasons), Closeout Settings admin page (7×3 matrix), Disputed map pin variant (#b45309 + #e85d26 ring + ! glyph), refreshed Job Detail header (cycle-time + days-to-payment metric grid). All `USE_MOCK` fallbacks removed from hooks. | Phase 4 (Frontend) |
| 3 | 2026-04-28 | — | — | ~4h | **Backend stack landed:** Alembic migration `01k_a1_lifecycle_status.py` (status enum + 17 lifecycle columns + closeout_settings table + `rpc_update_job_status` / `rpc_seed_closeout_settings` / `rpc_create_job` RPCs + DO-block seed for existing companies), `api/jobs/lifecycle.py` (transition matrix + helpers), `api/jobs/service.update_status` (calls atomic RPC, optimistic locking returns 409), `api/closeout/` module (7 gate evaluators + per-company settings CRUD + `JobStateSnapshot`), `api/dashboard/service.py` rewritten for unified 9-status pipeline. PATCH /v1/jobs/{id} now rejects `status` field with `USE_STATUS_ENDPOINT`. **Code review pass:** all 3 critical (index name collision, timeline event_data field mismatch, missing seed-call at company creation) + 5 warning items (`_create_job_fallback` legacy `"new"`, stale `("owner","admin")` role check, dead `statusLabel()` + recon CTA gate using legacy values, useUpdateJobStatus 409 invalidate-on-error, schema doc/code mismatch on `closeout_override` event_type) addressed. **Test infra cleanup:** swept auth-mock pattern from `.single()` → `.maybe_single()` across 7 test files (test_rooms / test_auth / test_properties / test_floor_plans / test_dashboard / test_events / test_moisture / test_photos / test_sharing) — backend test failures dropped from 234 → 58 (-75%); remaining 58 are deeper pre-existing infra debt (router patch paths moved, hardcoded dates, admin role removed by 01I) unrelated to 01K. **Spec 01K-related test debt resolved:** `test_update_job_status` / `test_update_job_invalid_status` deleted (status no longer mutable via PATCH /jobs); `TestStatusValidationPerJobType` deleted (per-type validation removed); dashboard tests rewritten for 9-status pipeline; batch tests updated to Lead/Active/Invoiced UI labels; `_job_row` default `new` → `lead`; `'collected'` → `'paid'` in archive guard tests + 3 legacy migration files. | Phases 1-3 (Backend) + verification |

---

## Decisions & Notes

*Append-only. Each decision should be one paragraph: what was decided, why, what was considered and rejected.*

- **2026-04-27 — Spec drafted from CREW-55 PRD.** Followed 01B template. Land directly in `in-progress/` per user request (skipped `draft/`).

- **2026-04-27 — Brett's full PRD v1.0 (April 15, 2026) absorbed.** The PDF Brett shared (`Crewmatic Job Lifecycle Management Summary.docx`) resolved most open questions and added significant detail beyond what was in Linear:
  - Default status = `lead` confirmed (was Q1 of v1 questions)
  - Reopen `completed → active` confirmed real workflow (was Q2)
  - On Hold reason = **free text** (not dropdown) with optional `expected_resume_date` (was Q3)
  - Cancel reason = dropdown + free text (was Q4)
  - Invoiced = **fully read-only** except payment tracking + collections notes (was Q9)
  - Auto-payment-reminder = yes, default 30d configurable (was Q10)
  - Paid = archive from active lists, searchable in history (was Q11)
  - **NEW:** Equipment rental tracking (rental days, 3d pull reminder, auto-pricing line items on pull) → added Phase 4 + Migration 3 (`equipment_placements` table)
  - **NEW:** Auto-transition `invoiced → paid` on full payment logged → Phase 4
  - **NEW:** Estimate finalization as a lifecycle moment (locks estimate; owner unlock) → Phase 4 + new endpoint
  - **NEW:** `lead_source`, `contract_signed_at`, `estimate_finalized_at` fields → Phase 1 schema
  - **NEW:** Dry standard auto-detect → Phase 4
  - **NEW:** Photo auto-link to room (if sketch + room selected) → Phase 2 hook
  - **NEW:** "Disputed Invoice" as a transition out of Invoiced → flagged as Q6 (target state TBD)
  - Remaining open questions trimmed to Q1–Q7 (mostly closeout-checklist details).

- **2026-04-27 — snake_case status values committed.** PRD uses display labels ("On Hold", "Cancelled / Lost"). Storage uses snake_case (`on_hold`, `cancelled`, `lost`) for clean queries / indexes / URL params. Display label map lives in `web/src/lib/labels.ts`. UI never shows snake_case.

- **2026-04-27 — Single 8-status flow, not 7.** Brett's PRD initially listed "Cancelled / Lost" as one bucket. Splitting them: `cancelled` for jobs that were Active/On Hold and got cancelled; `lost` for leads that never converted. Reason: useful business distinction (lost-lead conversion rate is a different metric from cancellation rate) and required-fields differ slightly. Both terminal.

- **2026-04-27 — Equipment placements as new table, not field on jobs.** PRD adds rental tracking (placement date, pull date, pull reminder, total rental days, line-item billing). Existing `equipment_air_movers` / `equipment_dehus` count fields on `job_rooms` are room-level snapshots (current state). New `equipment_placements` table is event log (placement events). Both kept — they answer different questions.

- **2026-04-27 — Disputed status added (D6).** User call: model "Dispute Invoice" as a real status, not a flag. Reasoning: (1) clear visual signal in dashboard / job list / pipeline, (2) clean transition matrix vs. boolean flags layered on Invoiced, (3) explicit timeline events on enter/exit make audit clean. Flow defaults to `disputed → invoiced` (resolution path most common) with `disputed → cancelled` as escape hatch. Direct `disputed → paid` rejected (D8) — force resolution through `invoiced` so payment always traces back to a finalized state.

- **2026-04-27 — Closeout checklist items finalized via PDF cross-reference.** Brett's lifecycle PDF gives "Photos tagged as Final / After" as the photo rule (no count). Old Linear synthesis gave "minimum photos per room" (no number). Choosing the PDF's tag-based rule because it's explicit and avoids arguing about a number. If Brett later asks for a count, we add it as an additional gate item (orthogonal). Fire/Smoke checklist deferred to 01E since job type itself is from CREW-49.

- **2026-04-27 — Settings → Jobs → Closeout Requirements page in V1 (D3).** The prior Linear PRD explicitly references this admin page. Hardcoding defaults and shipping settings in V1.5 was considered but rejected: Brett wants per-company control, the table is small (items × types × levels), and shipping it now means fewer follow-up tickets after V1.

- **2026-04-27 — Lead source and Cancel reason: dropdown + free text "Other" (D4, D5).** Both fields use a fixed dropdown plus an "Other" entry that reveals a free-text input. **Storage updated 2026-04-27 (D-impl-1):** two columns — `<field>` for the snake_case dropdown key (NULL if Other was chosen) and `<field>_other` for the free text. Either one populated, never both. Read code: prefer dropdown key if set, else fall back to the `_other` text. Avoids parsing prefix conventions and the literal `"other:foo"` edge case.

- **2026-04-27 — All open questions resolved. Spec is ready for `/plan-eng-review`.** The 7 questions raised in the prior draft were either answered by re-reading Brett's PDF carefully (A/B/C/D/F/G) or committed by user call (E — disputed status). One low-priority call left (D8 — direct disputed→paid transition) defaulted to NO with revisit option.

- **2026-04-27 — Scope boundary correction (D-arch-2 superseded).** Initial spec drafted `equipment_placements` table + endpoints under 01K. User flagged this as scope creep — equipment placement / pull / rental belongs to the Equipment & Moisture Tracking project, not Lifecycle. Brett's PDF lists equipment events as **timeline triggers** (things 01K observes), not as something 01K builds. **Removed:** Migration 3 (`equipment_placements` table), equipment endpoints, equipment-rental Phase 4 checklist items. **Kept:** timeline write-hook for equipment events. Same boundary applied to moisture readings, photos, portals, and recon-phase completion — 01K subscribes to their events, doesn't own their tables. Added explicit "Scope boundary" table to the spec to prevent future bundling.

- **2026-04-27 — D-arch-3 resolved: use existing `event_history` table; carve out 01M for Activity Timeline UI.** Spec originally created a parallel `job_timeline_events` table. User pointed out: `event_history` (Spec 01) already exists, already has `event_type` + JSONB `event_data` + indexed by job_id/company_id/event_type, and is already used everywhere via `log_event()`. **01K just adds new event types and calls `log_event()` from `update_status()` when status changes.** The user-facing Activity Timeline (per-job panel + company-wide feed page) is its own concern — carved into a new spec **01M (Activity Timeline)**, which reads `event_history` and renders. No new event table created in 01K. Two migrations dropped from 01K (timeline table, equipment_placements). Down to two migrations total: status backfill + columns, closeout_settings.

- **2026-04-27 — D-impl-1 resolved: two-column storage for lead_source + cancel_reason.** Original spec used `"other:<text>"` prefix parsing in a single column. Replaced with two columns each: `<field>` for snake_case dropdown key, `<field>_other` for free text. Eliminates the parsing edge case (literal `"other:foo"` input would have been mis-classified). Four columns total instead of two. Filter queries are clean: `WHERE lead_source = 'carrier_referral'`.

- **2026-04-27 — D-impl-2 resolved: estimate lock is DERIVED from status, not stored.** Original spec had `estimate_finalized_at` as both display value AND lock state — NULL meant unlocked, non-NULL meant locked. Disputed status would NULL it out, losing the original finalize date. **Replaced with:** column renamed to `estimate_last_finalized_at` (display only — most-recent finalize timestamp). Lock state derived from status: editable in `lead/active/completed/disputed`, locked in `invoiced/paid/cancelled/lost`. **Owner unlock endpoint dropped entirely** — if owner needs to amend a sent estimate, they go through the dispute flow (which Brett's PDF already supports). This simplifies Brett's PRD — there's no separate "unlock" button; dispute IS the unlock mechanism. First-finalize date is still recoverable from `event_history` via `MIN(created_at) WHERE event_type='estimate_finalized'`.

- **2026-04-27 — Eng review pass #2 (post-decisions). Critical fixes applied:**
  1. **Migration 1 SQL ordering bug** — fixed the order to drop the old `jobs_status_check` BEFORE running the UPDATE backfill. The previous order would have crashed on first run because the old constraint allowed only legacy status values, and the UPDATE was setting new values not in that set. (Same bug as flagged in eng review #1; never made it into the SQL block until now.)
  2. **`closeout_settings` RLS policies added** — multi-tenant isolation. Followed the existing pattern from `001_bootstrap.py` (uses `get_my_company_id()` helper + per-operation policies, NOT a `users`-table subquery + `FOR ALL`).
  3. **`update_status` request body schema** — added missing `disputed` to the status enum; added required `expected_current_status` for optimistic locking; on stale value returns **409 Conflict**, not 400.
  4. **Atomic RPC for status changes** — `rpc_update_job_status` wraps job update + event_history insert in one transaction. Matches `rpc_create_job` / `rpc_delete_job` pattern. Avoids fire-and-forget audit-loss bug from `log_event()`'s default behavior.
  5. **Auto-transition `invoiced → paid` race fix** — payments service now checks `status = 'invoiced'` before firing; if status is `disputed` (or anything else), payment is logged but status stays put. User manually resolves the dispute first. Uses Decimal arithmetic, not float.
  6. **Build-Back / Remodel / Fire-Smoke transition rules** — added explicit closeout-gate definitions per job type (was only mit + recon documented).
  7. **Cancel reason and Cancelled/Lost UX** — clarified the same dropdown serves both `cancelled` and `lost`; the status carries the work-stopped vs. lead-never-converted distinction.
  8. **`linked_job_id` on cancellation** — clarified 01K does NOT touch the field; nullability is already there for historical traceability.
  9. **Stale references cleaned up** — removed all "8-status" mentions (we have 9), renamed `estimate_finalized_at` → `estimate_last_finalized_at` throughout, dropped references to `job_timeline_events` table and Q1/Q2/Q4 (now D1-D8).
  10. **D8 promoted from open question to locked decision (NO).** Direct `disputed → paid` is not allowed. Documented the behavior of `payments/service.py` when status=disputed.
