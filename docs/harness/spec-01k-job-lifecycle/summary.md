# Refinement Summary — Spec 01K Job Lifecycle Management

**Spec:** [`docs/specs/implemented/01K-job-lifecycle-management.md`](../../specs/implemented/01K-job-lifecycle-management.md)
**Loop branch:** `lm-dev`
**Test data:** `l@test.com` / lmtest pro company / 10 seeded jobs across all 9 lifecycle statuses
**Local DB:** `01k_a1_lifecycle_status` migration applied; 1988 closeout_settings rows seeded.

## Iterations

| Ver | Design | Craft | Func | Key Changes |
|-----|--------|-------|------|-------------|
| v0  | -      | -     | -    | Baseline (post-implementation, pre-QA-loop). Backend RPC + closeout module shipped, frontend modals + settings page + disputed pin landed, code review applied, simplifier pass complete. Backend tests 696/754 passing (58 pre-existing failures unrelated). Frontend tsc clean, 49/49 vitest passing. |
| v1-eval | 7 | 7 | 8 | Inline browser sweep of Status Modal + Closeout Modal + Settings page on real seeded data. 3 high-severity issues found: (1) drag-handle pill leaking onto desktop, (2) Cert-of-Completion warn/hard_block + copy mismatch, (3) closeout modal skeleton-flash even when API <50ms. Plus 5 medium/polish items. Disputed map pin + mobile viewport + 409 conflict deferred (extension dropped). |
| v1-fix  | 8 | 8 | 8 | Fixed 3 highs + 1 user-flagged term: (1) `bottom-sheet.tsx` drag handle gated behind `sm:hidden`; (2) `closeout/service.py` cert evaluator copy softened to "recommended before closeout" (matches warn-level seed default); (3) `change-status-modal.tsx` prefetches closeout-gates when user picks Completed, so checklist modal mounts with cache hot; (4) "Build-Back" → "Reconstruction" in settings (per user feedback "whats build back in setting = not clear"). 4 of 5 medium findings turned out to be false-alarms (spacing already 8px, gate-bar contrast saturated, n/a cells already deemphasized). Tag: `refine-loop/spec-01k-job-lifecycle/v1`. |

## Final scores

**Design 8/9 · Craft 8/9 · Functionality 8/9** — Capped at 9 per anti-inflation rules. The remaining 1-point gap on each axis: bottom-sheet primitive could split into proper Sheet + Dialog variants with different chrome, copy on closeout gates could be tightened further, and the 2-tab 409 conflict UX shows a generic error rather than an actionable "another user just changed this — refresh and try again" prompt with a refresh button.

## Key improvements

1. **Mobile/desktop separation** — drag handle no longer leaks onto centered desktop dialog (mobile-only iOS affordance removed via `sm:hidden`).
2. **Copy/severity alignment** — Cert-of-Completion gate text now matches its actual block behavior. Default is `warn` (recommended), not `hard_block` (required).
3. **Performance** — closeout-gates prefetch eliminates the 1-3s skeleton flash that happened on first-open of the checklist modal. Cache is hot the moment the user picks Completed in the prior modal.
4. **Terminology** — settings page now reads `Mitigation / Reconstruction / Fire / Smoke` (was `Build-Back` — restoration-industry jargon that didn't read clearly per user feedback). Aligned with the rest of the codebase which already uses `reconstruction` everywhere (job_type enum, recon_phases table, "Create Reconstruction Job" CTA).

## Verified surfaces

- **Status Change Modal** — opens on header pill click, shows 3 legal targets for `active` (on_hold/completed/cancelled per STATUS_TRANSITIONS), reason field appears for required statuses, resume_date picker for on_hold, sticky footer with disabled-state. ✓
- **Closeout Checklist Modal** — fetches 7 gates via `GET /v1/jobs/:id/closeout-gates?target=completed`, color-segmented progress bar (4/7 · 3 warn · 0 block in test data), 5-radio acknowledge reasons. ✓ (Skeleton-flash fixed in v1.)
- **Settings page** — owner-only redirect (verified for owner role; non-owner deferred to feature-validator), 7×3 matrix `Mitigation / Reconstruction / Fire-Smoke`, dropdowns colored per gate level, per-column reset, legend at bottom. ✓
- **Job Detail Header** — clickable status pill with chevron, 4-block metric grid (cycle-time 10d, days-to-payment, rooms-drying 0/0, equipment 0 units), contract badge gated on `contract_signed_at`. ✓
- **Disputed Map Pin** — verified by code: `#b45309` fill + `#e85d26` 3px ring + `!` glyph (vs standard `STATUS_COLORS[stage]` + 2px white ring). Visible on dashboard map screenshot near Pontiac coords (matches seeded "700 Maple Way / Grace Garcia" disputed job). ✓

## Deferred to feature-validator (cross-layer cross-checks)

- Non-owner redirect on `/settings/closeout` (only owner role tested in QA pass)
- 2-tab race producing real 409 conflict response from `rpc_update_job_status` and frontend's invalidate-and-surface-error UX
- Mobile viewport (375x667 / 390x844) for both modals — code-path verified via `sm:` breakpoint, but no real device screenshot captured
- Activity timeline event_data shape (`from_status` / `to_status`) on a real status change — backend writes correct keys per code review, but no live timeline render captured
- Closeout-checklist hard-block branch (no failing hard_block gate in seed data) — needs a setting flipped to `hard_block` then a job that fails it

## Spec checklist coverage (against `docs/specs/implemented/01K-job-lifecycle-management.md`)

- [x] 9-status lifecycle defined and enforced server-side (`api/jobs/lifecycle.py`)
- [x] 17 lifecycle columns added (`active_at`, `completed_at`, `invoiced_at`, `paid_at`, `disputed_at`, `cancelled_at`, `on_hold_reason`, `on_hold_resume_date`, `cancel_reason`, `cancel_reason_other`, `dispute_reason`, `dispute_count`, `dispute_resolved_at`, `lead_source`, `lead_source_other`, `contract_signed_at`, `estimate_last_finalized_at`)
- [x] Boundary respected — 01K only owns jobs lifecycle + closeout_settings; status events go into existing event_history
- [x] Pre-launch migration overwrites legacy values to new model (no dual-status window per user direction)
- [x] Single transition matrix (mitigation + reconstruction collapsed onto one flow)
- [x] Server-side transition matrix enforced via `rpc_update_job_status`
- [x] All status badge labels/colors updated via `STATUS_META` single source
- [x] Default status on `POST /jobs` = `lead`
- [x] Contract status badge in job header, gated on `contract_signed_at`
- [x] `closeout_settings` table at company level (per-item × job_type × gate level)
- [x] Per-job-type checklists wired (mitigation, reconstruction, fire_smoke)
- [x] "Mark Completed" modal surfaces checklist + "Close Anyway" reason flow
- [x] Reasons logged permanently to event_history (`override_gates` + `override_reason` keys)
- [x] Lead → Active timestamp recorded
- [x] Active → Completed timestamp recorded; cycle time computed
- [x] Completed → Invoiced timestamp recorded; days-to-payment computed
- [x] Invoiced → Paid auto-archive from active list
- [x] Estimate finalize endpoint sets `estimate_last_finalized_at`; lock state derived from status
- [x] Dispute Invoice transition (`invoiced` → `disputed`); resolution path back to `invoiced`
- [ ] Activity Timeline UI — explicitly OUT of scope per spec (owned by 01M)
- [ ] Timeline write-hooks for events emitted by other projects — out of scope (those projects own their own emit calls)

## Atomic commits in v1

```
b16ec9d ux(01k): rename 'Build-Back' to 'Reconstruction' in closeout settings
6e4bbc1 perf(01k): prefetch closeout gates when user picks 'completed'
dcd60d1 ux(01k): soften Cert-of-Completion closeout gate copy
d70a592 ux(01k): hide bottom-sheet drag handle on desktop
```

## Verdict

**ITERATE → PASS at v1.** All 3 high-severity issues fixed, 1 user-flagged term resolved, 4 medium nits reverified as false alarms or polish-grade. Frontend tsc + 49/49 vitest still green; backend test failures are all pre-existing (admin role removed by 01I, recon mock async issue) and unrelated to 01K.

**Ready to ship + run `/feature-validator`** for cross-layer (API + DB + UI + logs) consistency checks before merge.

## Files
- [progress.md](progress.md) — iteration table
- [eval-1.md](eval-1.md) — full v1-eval findings
- screenshots/ — captured during inline browser pass
