# Changelog

All notable changes to Crewmatic.

## [26.4.0] - 2026-04-28

### Added — Spec 01K: Job Lifecycle Management

Single 9-status job lifecycle replaces the legacy per-job-type 9-status enum:
**lead → active → completed → invoiced → paid**, with **on_hold / disputed / cancelled / lost** as off-ramps.

- **Atomic status transitions.** New `PATCH /v1/jobs/{id}/status` endpoint.
  Server-side transition matrix (matches the frontend's `STATUS_TRANSITIONS`)
  rejects illegal moves with 400 `ILLEGAL_TRANSITION`. Optimistic locking via
  `expected_current_status` body param surfaces 409 `STATUS_CONFLICT` when
  another tab moved the job mid-edit. Reason field required for
  on_hold / cancelled / lost / disputed; resume_date capture for on_hold.
- **Status Change Modal.** Click the status pill in the job header to open
  a bottom-sheet (mobile) / centered dialog (desktop) showing only the legal
  next statuses for the job's current state. 409 conflicts render an inline
  amber refresh prompt with a "Refresh now" button.
- **Closeout Checklist Modal.** When the user moves an active job to
  Completed, a 7-gate evaluator runs server-side and surfaces in the modal
  with a color-segmented progress bar. Acknowledge-level fails require a
  reason from the "Close Anyway" dropdown; hard-block fails deep-link to
  the next concrete step (cert generation, room readings, photos).
- **Closeout Requirements settings.** New `/settings/closeout` admin page
  (owner-only) with a 7-item × 3-job-type matrix. Each cell is a dropdown
  (warn / acknowledge / hard_block). Per-cell save confirmation, per-column
  reset, defensive fallback to spec defaults if a company has zero settings
  rows.
- **Refreshed job detail header.** 4-block metric grid (Cycle Time,
  Days to Payment, Rooms Drying, Equipment on Site) replaces the legacy
  phase stepper. Threshold-aware coloring: cycle > 21d / pay > 60d turns
  red, 14-21d / 30-60d turns amber. Contract badge appears when
  `contract_signed_at` is set.
- **Disputed map pin variant.** Disputed jobs render on the dashboard map
  with a darker amber fill (`#c8501a`), brand-orange ring (`#e85d26`), and
  `!` glyph — distinct from the on_hold amber + standard active pin so
  jobs that need carrier follow-up read instantly.
- **Activity timeline events.** Status changes write `event_type='status_changed'`
  rows to `event_history` with `event_data = {from_status, to_status}`,
  plus `override_gates` + `override_reason` when the closeout-anyway flow
  fires. Special event types for `dispute_opened`, `dispute_resolved`,
  `job_lost`, `job_cancelled`, `job_reopened`.

### Changed

- **Pipeline palette overhaul (Option A 4-bucket lifecycle).** Status colors
  reorganized around what the bar means operationally — motion (orange,
  lead is muted tan), waiting (amber, disputed is the only act-now
  red-orange), won (green deepens light → mid → deep as money lands),
  closed (gray, lost lighter than cancelled). The dashboard pipeline now
  reads as a health summary instead of a rainbow.
- **Bottom-sheet primitive — mobile-first polish.** Drag-to-dismiss with
  scroll-aware lock-in (only activates when scroll body is at top), safe-
  area-inset for landscape notches, unified `--sheet-duration` /
  `--sheet-ease` tokens (was 200ms vs 240ms drift), `touch-action: pan-y`
  + `overscroll-behavior: contain` (kills Chrome pull-to-refresh during
  drag), explicit desktop close button.
- **Dashboard pipeline.** Backend rewritten around the unified 9-status
  pipeline (was MIT/RECON dual track). Active KPI excludes disputed
  ("stuck at carrier", not capacity). Priority jobs surface lead /
  on_hold / disputed.
- **Closeout gate detail copy.** Unified to "contractor's-eye" voice
  across all 7 evaluators — short, present-tense, count-prefixed
  ("3 of 5 rooms missing readings"), never apologetic.
- **Closeout requirements label.** "Build-Back" → "Reconstruction" so the
  settings page matches the rest of the codebase's terminology.
- **Cert-of-Completion gate copy.** Softened from "required to proceed"
  to "recommended before closeout" to match the warn-level seed default.

### Fixed

- **Search-path lock on lifecycle RPCs.** `rpc_update_job_status` and
  `rpc_seed_closeout_settings` were created without `SET search_path` —
  vulnerable to search_path injection. Migration `01k_a2_lock_rpc_search_path`
  pins both to `pg_catalog, public`, matching the codebase convention.
- **Closeout modal first-open skeleton flash.** Prefetches gate data the
  moment the user picks "Completed" in the change-status modal, so the
  checklist modal mounts with cache hot instead of showing 1-3s of empty
  skeleton bars.
- **Frontend timeline rendered blank text on every status change.** The
  renderer was reading `evt.event_data.new_status` (legacy key) but the
  backend writes `to_status` / `from_status`. Updated to read the new
  contract.
- **`closeout_settings` not seeded on new companies.** `rpc_onboard_user`
  now best-effort calls `rpc_seed_closeout_settings` so brand-new
  companies start with the canonical 7 × 3 defaults instead of an empty
  closeout modal.
- **Index name collision in lifecycle migration.** Renamed
  `idx_jobs_status` → `idx_jobs_company_status` to avoid colliding with
  the index of the same name from
  `a1b2c3d4e5f6_add_jobs_fulltext_search_index`.
- **Test infra: ~169 failures unblocked.** Auth middleware was migrated
  from `.single()` to `.maybe_single()` in March; test mocks across 7+
  files still wired the old chain. Sweep updated.

### Removed

- **Legacy 7-stage MIT/RECON dual pipeline.** Per-job-type status
  validation, dual-track dashboard, separate reconstruction phase enum.
  All collapsed into the unified 9-status flow. Pre-launch — no
  backwards-compat shim.
- **`status` field on `PATCH /v1/jobs/{id}`.** Status changes now go
  through the dedicated `/status` endpoint so transition validation +
  optimistic locking + gate checks + event_history audit are guaranteed
  atomic.
