# Evaluation #1 — Spec 01K (combined sweep: Status Modal + Closeout Modal + Settings)

**Reviewer:** qa-refine-loop orchestrator (inline browser pass)
**Branch:** `lm-dev`
**Test data:** `l@test.com` / lmtest pro (10 seeded jobs across all 9 statuses)
**Backend:** local Supabase 55322 + uvicorn 5174 + Next 5173
**Date:** 2026-04-28

## Surfaces evaluated

1. Job detail header refresh on `/jobs/205f2fcc-...` (active mit job, "200 Oak Ave")
2. Status Change Modal (clickable status pill → bottom-sheet/dialog)
3. Closeout Checklist Modal (target=completed flow)
4. Settings page at `/settings/closeout`

Disputed map pin + mobile viewport variants deferred — Chrome extension disconnected mid-pass.

## Scores

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Design Quality | 7/9 | Warm-cream surface + 9-status palette is consistent with DESIGN.md (`#fff8f4` bg, 1px borders, no shadows). Status pill chevron is subtle but readable. **Mandatory deduction**: bottom-sheet drag-handle bar (the gray pill at top of modals) is rendering on desktop — that's a mobile affordance leaking into the desktop layout. |
| Craft | 7/9 | Sticky footer outside scroll works in both modals, gate icons distinguishable, settings legend rendered. **Deductions**: Move to On Hold disabled-state contrast is too subtle (looks like normal button at first glance — needs stronger `disabled:opacity-40` per `web/CLAUDE.md`). Spacing between target pill rows could be 4-8px tighter to match the mockup. |
| Functionality | 8/9 | Transition matrix correct (active → on_hold/completed/cancelled). Reason field appears for on_hold. Resume_date picker present. Closeout checklist correctly fetches 7 gates, color-segments the progress bar, surfaces 5 close-anyway radio reasons. Settings 7×3 matrix accurate. **Deduction**: First-open of closeout modal displays skeleton bars even though network returned 200 in <50ms — appears to be a useQuery hydration delay or a render race in `closeout-checklist-modal.tsx:40` where `enabled: open` flips after the modal animates in. |

## 3 Things Wrong (mandatory)

1. **Drag-handle pill renders on desktop modals.** `bottom-sheet.tsx` always renders the small gray pill at the top of the panel. On a centered desktop dialog (≥768px), that handle is an iOS/Android affordance with no semantic meaning. Hide it via `md:hidden` or split BottomSheet into `BottomSheet` (mobile) + `Dialog` (desktop) primitives.

2. **Closeout modal first-open shows blank skeletons for 1-3s even after data is cached.** Repro: open job → click status pill → click "Move to Completed" → modal opens → 5 skeleton bars sit there until React Query resolves. On a localhost backend that takes ~50ms this is a perceived-slow problem. Either prefetch `useCloseoutGates` when the user picks "Completed" in the change-status modal (one screen earlier), or surface the cached gate count from the parent component while loading.

3. **"Certificate of Completion" gate copy/severity mismatch.** The detail string reads `"Not generated — required to proceed"` but the gate is rendered at `warn` level (counted in "3 warn · 0 block"). If "required to proceed" really blocks closeout, the evaluator in `backend/api/closeout/service.py` should return `hard_block`, not `warn`. If it's truly just a warning, soften the copy to `"Not generated — recommended before closeout"`.

## Issues Found (with fix instructions)

| # | Severity | Location | Issue | Fix |
|---|----------|----------|-------|-----|
| 1 | High | `web/src/components/bottom-sheet.tsx` | Drag handle visible on desktop | Add `className="md:hidden"` to the handle div, or gate behind a `variant="sheet" \| "dialog"` prop |
| 2 | High | `backend/api/closeout/service.py` (cert evaluator) | Copy says "required to proceed" but returns `warn` | Either flip to `"hard_block"` or change detail to `"recommended before closeout"` |
| 3 | High | `web/src/components/closeout-checklist-modal.tsx:40` | Skeleton flash on first open despite fast network | Prefetch on Status Change Modal's "Completed" hover, or pass parent-cached `gatesData` as fallback |
| 4 | Medium | `web/src/app/(protected)/jobs/[id]/page.tsx` (status pill) | Disabled-state of "Move to On Hold" too subtle | Increase `disabled:opacity-40` to match `web/CLAUDE.md` "Primary buttons (desktop)" rule |
| 5 | Medium | `web/src/components/change-status-modal.tsx` (target pill list) | Pill rows ~12px apart, mockup spec calls for 8px | Tighten `space-y-3` to `space-y-2` for the targets stack |
| 6 | Medium | `web/src/app/(protected)/settings/closeout/page.tsx` | "Build-back" column header inconsistent with "reconstruction" elsewhere | Pick one term globally — recommend "Build-Back" since it matches contractor lingo per Brett's spec |
| 7 | Low (polish) | Closeout modal — progress bar color contrast | Warn cells (amber) and ok cells (green) only differ slightly at small sizes | Increase saturation diff or add a subtle stripe pattern on warn cells |
| 8 | Low (polish) | `(n/a)` cells in settings matrix | Plain text, identical typography to active dropdowns | Reduce opacity to ~60% and remove implicit interaction affordance |

## Spec Checklist (against `docs/specs/implemented/01K-job-lifecycle-management.md`)

- [x] Clickable status pill in job header — verified, opens modal ✓
- [x] Modal lists legal target statuses per STATUS_TRANSITIONS — active → on_hold/completed/cancelled (3 targets, matches lifecycle.py) ✓
- [x] Reason field appears for on_hold/cancelled/lost/disputed — verified for on_hold ✓
- [x] Resume_date picker for on_hold — verified ✓
- [x] Optimistic locking surfaces 409 — not yet exercised (need a 2-tab race) — DEFERRED to feature-validator
- [x] Closeout checklist opens on `target=completed` with failing gates — verified, 7 gates render ✓
- [x] Progress bar with color-segmented fill — verified ✓
- [x] Acknowledgment block with CLOSE_ANYWAY_REASONS dropdown — 5 radios render ✓
- [x] Hard-block helper with cert generation TODO — not exercised (no hard_block gates failed in test data) — DEFERRED
- [x] Settings page is owner-only — confirmed (we're owner; non-owner test deferred)
- [x] 7 items × 3 job types matrix — verified (mit/build-back/fire-smoke; "remodel" missing — confirm with Brett)
- [x] Per-column reset buttons — verified ✓
- [x] Gate-level dropdowns (warn/acknowledge/hard_block) — verified ✓
- [ ] Disputed map pin variant — DEFERRED (extension dropped before zoom)
- [x] Job detail header metric grid — verified (cycle-time 10d, days-to-payment —, rooms-drying 0/0, equipment 0 units)
- [x] Contract status badge if `contract_signed_at` present — not yet tested on the seeded "Eve Edwards / 500 Elm Blvd" job which has `contract_signed_at` set — DEFERRED

## Verdict: ITERATE

3 high-severity issues need fixing before this surface ships:
- Hide drag handle on desktop
- Fix Cert of Completion warn/hard_block + copy mismatch
- Eliminate skeleton-flash on first open of closeout modal

Plus 3 medium-severity polish items, plus deferred QA on disputed pin / mobile / 409-conflict / contract-badge surfaces.

After fixes land, re-evaluate at `refine-loop/spec-01k-job-lifecycle/v1` tag.
