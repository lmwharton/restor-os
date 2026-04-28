# Spec 01H: Floor Plan V2 — Sketch Tool as Spatial Backbone

## Status

| Field | Value |
|-------|-------|
| **Phase 1 progress** | █████████████████████ 100% — merged to `main` 2026-04-23 (PR #10, 5 review rounds) |
| **Phase 2 progress** | █████████████████████ 100% — moisture pins + readings + delete + edit + local-date TZ fix + clinical sparkline + Moisture Report View (Tasks 6 + 7) + sharing-payload extension + per-floor isolation + orphan-pin handling. **3 critical-review rounds CLOSED** (round 1: 4 HIGH / 5 MEDIUM / 2 LOW; round 2: 1 MEDIUM / 1 LOW + 2 test-gap closures; round 3 pre-landing: 4 P1 blockers + 6 non-blocking + 3 polish). Ready for PR. |
| **Overall 01H progress** | ████████████░░░░░░░░░ ~55% (Phases 1 + 2 done; Phase 3 proposal drafted but out-of-scope for this PR; Phases 4–5 untouched) |
| **State** | Phase 2 ready for PR |
| **Blocker** | None |
| **Branch** | `feature/01h-floor-plan-v2-phase2` (stacked on merged `main`) |
| **Depends on** | Spec 01C (Floor Plan Konva rebuild — in review), Spec 01B (Reconstruction — merged) |
| **Source** | Brett's Sketch & Floor Plan Tool Product Design Specification v2.0 (April 13, 2026) |

## What Phase 1 Delivers

- **Property-scoped floor plans with job-driven versioning.** `floor_plans` rows
  are per-property, per-floor, per-version snapshots. Each job pins to the
  version it created; archived jobs freeze that pin. Sibling jobs fork new
  versions on save instead of mutating history.
- **Unified schema.** `floor_plans` container + `floor_plan_versions` merged
  into a single `floor_plans` table in migration `e1a7c9b30201` — each row
  IS a versioned snapshot. `jobs.floor_plan_version_id` renamed to
  `jobs.floor_plan_id`.
- **Canvas built on Konva.** Room creation via shape picker (Rectangle /
  L-Shape / T-Shape / U-Shape / Rect+Notch) with default dimensions at
  viewport center; fallback click-and-drag rectangle; trace-perimeter for
  ad-hoc polygons; magnetic room-to-room snap; shared-wall auto-detection;
  vertex editing for polygons; live SF + wall-LF calculation.
- **Multi-floor support.** Basement / Main / Upper / Attic selector with
  per-floor canvases and pick-floor-first UX. Cross-floor room creation
  merges into the target floor and switches active without an empty-state
  flash.
- **Floor openings (cutouts).** Stairwells and HVAC shafts subtract from
  floor SF; dashed-rect overlay; editable via a dedicated bottom sheet.
- **Immutability + archival guards.** `update_floor_plan`, `save_canvas`,
  `rollback_version`, and `cleanup_floor_plan` all block edits on frozen
  (non-current) rows and on archived-job rooms. The floor-plan editor
  hydrates archived jobs strictly from their pin + their own-created
  versions — never falls through to `is_current`, so sibling edits can't
  leak into an archived audit view.
- **Mobile polish.** Full-bleed `/jobs/<id>` sub-routes; icon+label
  instrument-panel toolbar with an overflow menu pinned to the right;
  Google-Sheets-style shape picker as the room-tool entry; inline
  direct-edit of room dimensions in both the bottom sheet and the
  desktop sidebar; tap-toggle-to-Select; canvas pan unlocked for
  tap-based tools.
- **Wall relational model.** `wall_segments` + `wall_openings` tables
  persist walls with per-wall type (exterior/interior), affected status,
  shared-wall flags, and door/window openings with width + height for
  Xactimate-ready SF calculations.

## Reference

- **Product source:** Brett's *Sketch & Floor Plan Tool Product Design Specification v2.0* (April 13, 2026)
- **Predecessor:** Spec 01C (Floor Plan Konva rebuild) — this spec supersedes most of 01C's canvas architecture
- **Eng review:** Completed 2026-04-16 with 17 architectural decisions locked in (see DECISIONS section below)
- **Key migration:** `e1a7c9b30201_spec01h_merge_floor_plans_versions.py` — merges the two-table design into one unified `floor_plans` table

## Phase 1 Changelog (feature-level)

Consolidated from multiple implementation passes. Commit history on the
branch carries the blow-by-blow detail; this list is what actually shipped.

**Schema + backend**
- Unified `floor_plans` table (merged container + versions — one row is a
  versioned snapshot), `jobs.floor_plan_id` scalar pin.
- Versioning state machine in `save_canvas`: Case 1 (create v1, pin), Case 2
  (update in place — requires `created_by_job_id == job_id` + `pinned_same_floor` + `pinned_still_current`), Case 3 (fork new version, pin).
- Frozen-version immutability: `update_floor_plan` / `save_canvas` / `rollback_version` / `cleanup_floor_plan` all reject writes against non-current rows and against archived jobs.
- `_create_version` centrally enforces "one `is_current` per (property, floor)" — flips siblings to `is_current=false` before the insert.
- `_auto_upgrade_active_jobs` removed — frozen-version semantics mean a job's pin only moves when that job itself saves; no auto-upgrade across siblings.
- Job creation pins the new row via `created_by_job_id` so the first canvas save hits Case 2, not Case 3.
- Linked recon inherits `floor_plan_id` + `COPY_FIELDS` structural room fields from the parent mitigation job.

**Canvas + frontend**
- Unified polygon data model: `RoomData.points` optional; rectangles and N-gons share the same code paths (`wallsForRoom`, `polygonCentroid`, `polygonBoundingBox`).
- Room creation: shape picker (Rectangle / L / T / U / Rect+Notch) as Sheets-style entry with auto-pan if the drop clips the viewport; classic click-and-drag rectangle kept as the Cancel fallback; trace-perimeter for bespoke shapes.
- Magnetic room-to-room snap within 20px; shared-wall auto-detection with muted render + perimeter-LF exclusion.
- Vertex-level editing of polygons with live shape preview; tap-on-edge inserts a new vertex.
- Direct W × H editing for rectangles (and rect-shaped polygons) in both the mobile bottom sheet and the desktop sidebar — 400ms debounced commit + blur/Enter commit, Escape reverts.
- Polygon drag correctness fix: Group's `x/y` reset imperatively on drag end so the polygon, its fill, labels, walls, and cutouts all land together instead of double-shifted.
- Cutout follow-drag fix: `floor_openings` now shifted alongside the parent room in `handleDragEnd`.
- Per-edge dimension labels on selected polygons using a `pointInPolygon` probe for outward direction (centroid-based flipping is wrong for concave T/U/L shapes).
- Floor openings (cutouts): dashed-rect overlay, live bbox clamping during drag/resize, bottom-sheet editor with max-bound validation, net-SF math end-to-end.
- Multi-floor selector (Basement / Main / Upper / Attic) with version badge, pick-floor-first UX, cross-floor room creation, archive read-only banner.
- Autosave debounced 2s with immediate flush on room confirm, version creation, and manual Save button.
- Wall sync to backend after each canvas save (walls → `wall_segments`, doors/windows/openings → `wall_openings`).
- Wall-edge drag to resize (Brett V2 spec): rect-room walls are draggable; perpendicular-axis constraint + grid snap + live wall-to-wall magnetic snap (40px) so the dragged wall visually aligns with a neighbor's matching edge while still in motion. Shared-wall auto-resize propagates the same delta to the neighbor room's opposite edge. Wall ids stay stable across resizes so doors/windows/cutouts keep their linkage. Context menu suppressed when a tap becomes a drag.
- No-overlap room placement: `handleShapePicked` auto-offsets new rooms that would collide with existing ones — flush-stick to the right edge (no gap) so adjacency is immediate and `detectSharedWalls` flags the contact edge automatically. No more "did the room actually get created?" pile-up at viewport center.
- No-overlap room drag: rect rooms use `dragBoundFunc` + bbox collision check every frame; rooms physically refuse to be dropped on top of each other. Magnetic snap removed align-edge candidates + added post-snap safety net to prevent snap-induced overlap.

**Mobile UX**
- Full-bleed routes: `/jobs/<id>` and all sub-routes hide the mobile header + bottom nav for ~120px of reclaimed vertical space.
- Instrument-panel toolbar: icon+label primary row (Select · Room · Wall · Door · Window · Delete · Damage · Undo · Redo), overflow `⋯` menu pinned at the right edge with an item-count badge (Trace · Opening · Cutout · Zoom in · Zoom out · Fit · Export PNG).
- Active-tool pill expansion, tap-toggle-to-Select, `touch-action: manipulation` to prevent iOS Safari from eating re-taps as double-tap-zoom.
- Stage one-finger pan unlocked for tap-based tools (select, delete, door, window, opening); drag-to-draw tools (room, cutout) and click-sequence tools (wall, trace) still use pinch for pan.
- Tap-anywhere-empty deselection (any non-`elementId` tap clears selection).
- Tightened door/window hit-area so nearby room corner-resize handles stay tappable.

**Small card polish**
- `RoomConfirmationCard`: Floor field always required, material defaults auto-fill from room type when the chip list is empty (respects manual edits), mobile swipe-to-close on the drag handle, sticky action footer, back button resets `nameCommitted`.

**PR10 Round 2 — review hardening (R1–R19, 2026-04-22)**

9 new Alembic migrations (`c7f8a9b0d1e2 → d8e9f0a1b2c3 → e9f0a1b2c3d4 → f0a1b2c3d4e5 → a1b2c3d4e5f7 → b2c3d4e5f8a9 → c3d4e5f8a9b0 → d4e5f8a9b0c1 → e5f8a9b0c1d2`). 105 new pytest cases. Zero regressions.

Schema + backend hardening:
- **R1** — downgrade trigger typo in `e1a7c9b30201` fixed (`set_updated_at` → `update_updated_at`); guardrail pytest scans every migration for orphaned trigger-function references.
- **R3** — `save_floor_plan_version` RPC hardened: JWT-derived tenant check via `get_my_company_id()` (never trust caller-supplied `p_company_id`), property + job-on-property ownership checks, pinned `search_path`. Error-code mapping: `42501` → 403 `COMPANY_MISMATCH`, `P0002` → 400 `PROPERTY_MISMATCH`.
- **R4** — atomic `is_current` filter on `update_floor_plan` + `cleanup_floor_plan` UPDATEs (zero-row ⇒ `VERSION_FROZEN`). Belt-and-suspenders `floor_plans_prevent_frozen_mutation` BEFORE-UPDATE trigger rejects any write to a frozen row.
- **R5** — shared `assert_job_on_floor_plan_property` helper in `shared/guards.py`; wired to `save_canvas`, `rollback_version`, `cleanup_floor_plan` (one source of truth for "a job's floor plan lives on its property").
- **R6** — `raise_if_archived(job)` at the top of all 3 by-job floor-plan endpoints (`POST/PATCH/DELETE /jobs/{id}/floor-plans`). `get_valid_job` only blocked soft-deleted rows; collected jobs slipped through.
- **R7** — `create_floor_plan` INSERT now catches Postgres 23505 → 409 `CONCURRENT_EDIT`, matching `_create_version`. Racy two-tab create no longer surfaces as a bare 500.
- **R8** — `assert_job_on_floor_plan_property` raises 400 `JOB_NO_PROPERTY` on null `job.property_id` (prior legacy-skip branch recreated W1's bypass in 3 sites once the helper was shared).
- **R9** — `ensure_job_property(p_job_id)` SECURITY DEFINER RPC replaces `create_floor_plan_by_job_endpoint`'s read-insert-update dance. `SELECT ... FOR UPDATE` on the jobs row serializes concurrent first-saves; same-address property reuse eliminates orphan rows. Partial unique index `idx_properties_address_active` on `(company_id, lower(btrim(address_line1)), lower(btrim(city)), state, btrim(zip)) WHERE deleted_at IS NULL` adds defense-in-depth.
- **R10** — `walls_insert` / `walls_update` / `openings_insert` / `openings_update` RLS policies rewritten with `EXISTS` parent-ownership checks. Closes tenant-id side-channel on direct Supabase writes.
- **R11** — shared `validate_json_size` + `validate_string_list` in `api/shared/validators.py`. Rooms schemas: `room_polygon` ≤ 10 KB, `floor_openings` ≤ 50 KB, `room_sketch_data` ≤ 50 KB (bonus), `material_flags` ≤ 20 items × 64 chars, `notes` ≤ 5000 chars — on both `RoomCreate` and `RoomUpdate`.
- **R13** — drop redundant non-unique `idx_floor_plans_is_current` (shadowed by `idx_floor_plans_current_unique`).
- **R14** — rename `versions_{select,insert,update,delete}` policies to `floor_plans_{…}` on the post-merge table, re-runnable via `EXISTS` guard.
- **R16** — `update_room` now wires `_recalculate_room_wall_sf` when any wall-SF formula input changes (`height_ft`, `ceiling_type`, `custom_wall_sf`). Closes the last drift surface; the 6 existing wall/opening CRUD call sites already cover the reviewer's named scenario. Helper returns the fresh value for response stamping.
- **R17** — `CHECK (col IS NULL OR col >= 0)` on `job_rooms.custom_wall_sf` and `job_rooms.wall_square_footage` (exact constraint names per reviewer's snippet).
- **R18** — `COMMENT ON COLUMN wall_openings.swing` documents the hinge + swing quadrant mapping (`0=hinge-left-swing-up`, `1=hinge-left-swing-down`, `2=hinge-right-swing-down`, `3=hinge-right-swing-up`), sourced from `FloorOpeningData` in `floor-plan-tools.ts`.
- **R19** — full-fidelity rollback via snapshot + restore. `save_canvas` enriches `canvas_data` with `_relational_snapshot` (server-side capture of `wall_segments`, `wall_openings`, `job_rooms.room_polygon` / `floor_openings`). New SECURITY DEFINER `restore_floor_plan_relational_snapshot(p_new_floor_plan_id)` RPC atomically DELETEs + re-INSERTs inside a plpgsql transaction. Legacy versions (saved before R19) return `restored=false` and log a warning — canvas-only rollback for pre-R19 data.

Frontend:
- **R12** — `handleCreateRoomOnDifferentFloor` reconciles `["floor-plans", jobId]` cache using `savedVersion.id` as truth (not `targetFloor.id`). On Case 3 fork, `setActiveFloorId(savedVersion.id)` instead of the now-frozen row; stale `["floor-plan-history", targetFloor.id]` key is explicitly invalidated.
- **R15** — `useUpdateFloorPlan` drops the misleading `canvas_data` arg (backend stopped accepting it in C1). `useSaveCanvas(floorPlanId, jobId)` now takes `jobId` and invalidates `["floor-plans", jobId]` + `["jobs", jobId]` internally so the W11 cache invariant can't drift.
- **R17 UX** — inline `"Must be greater than 0"` / `"Must be at least 1"` error messaging on 4 numeric-input components (`cutout-editor-sheet`, `floor-plan-sidebar` `NumericInput`, `konva-floor-plan` mobile sheet, `page.tsx` `RoomDimensionInputs`). Replaces the prior silent-reject UX where a typed `-10` disappeared without feedback.
- **Room-tap fix** — `MobileRoomPanel` opens reliably on mobile even when `useRooms(jobId)` hasn't resolved at tap time. `handleSelectionChange` buffers the pending selection and flushes when `jobRooms` arrives.

Round-2 product-intent decision (not a code change): **R2 deferred**. Reviewer asked to drop the `parent_pin` block in `create_job`; under Crewmatic's linked-job model (mitigation and recon share property-anchored data — floor plan, rooms, walls — until recon edits and forks) the `parent_pin` is the mechanism that makes sharing work. Reviewer's fix would leave recon techs with a blank canvas on every linked recon, defeating the feature. `job_rooms.floor_plan_id` is vestigial (no backend join uses it) so the "split join" concern the reviewer flagged is theoretical. Acknowledged on PR with product rationale.

**PR10 Round 3 — re-review + concurrent-editing hardening (2026-04-22)**

Two categories of work: Lakshman's round-3 re-review items (#1 cache regression on 409, #2 downgrade drift, #3 stale apply script), and a larger fix for the **same-job concurrent-editing silent-lost-update** scenario that's a real field-tool problem (two techs on one property both editing the floor plan). Instead of patching the specific 409 path Lakshman flagged, we eliminated it entirely with an idempotent RPC, and layered an etag/If-Match optimistic-concurrency guard on top to prevent silent overwrites.

3 new Alembic migrations. 26 new tests. Zero regressions.

Concurrent-editing protection:
- **`ensure_job_floor_plan` RPC** (migration `b8c9d0e1f2a3`) replaces the old optimistic-create + catch-409 + pick-plans[0] fallback in `create_floor_plan_by_job_endpoint`. SECURITY DEFINER, JWT-derived company, `SELECT … FOR UPDATE` on jobs row. Idempotent: if the job already has a pinned current row for the target floor, return it; if a sibling job beat us with the same-floor INSERT, reuse their row and pin ours; only INSERT if neither exists. 23505 race retry at the router (same pattern as `ensure_job_property`). The 409 recovery branch in the frontend is unreachable now and was deleted.
- **Etag / If-Match / 412 `VERSION_STALE`** — new optimistic-concurrency guard on `POST /v1/floor-plans/{id}/versions`. No schema change — etag is derived from `floor_plans.updated_at` (already auto-bumped by the `update_updated_at` trigger). Frontend captures etag on read, sends as `If-Match` on save. Server compares; mismatch → 412 with `current_etag` in the error body. Backward-compat during rollout: missing `If-Match` header skips the check. Frontend catches 412 and renders a "Floor plan was updated by another editor — Reload" banner; on reload, caches are invalidated and the canvas re-hydrates from server truth, user re-applies their edits on top.
- **Shared `saveCanvasVersion` helper** in `floor-plan/page.tsx` centralizes the etag-send + response-capture pattern across all 4 save sites (autosave, first-create, cross-floor, error-recovery) — future edits to the save-response contract touch one place, not four.
- **`AppException.extra`** field added to `api/shared/exceptions.py` so structured context (like `current_etag`) can ride along with the JSON error body. Merged into the response verbatim; `None` values dropped.

Backend hardening (Lakshman round-3 findings):
- **#1** — 409 cache regression closed by the RPC replacement above (the bug was on the error branch; eliminating the error branch is the cleanest fix).
- **#2** — downgrade drift in `a7b8c9d0e1f2` fixed: DOWNGRADE now re-installs `restore_floor_plan_relational_snapshot` with the pre-follow-on `_compute_wall_sf_for_room(v_room_id, v_caller_company)` 2-arg call shape to match the restored 2-arg helper signature. A future `alembic downgrade -1` past this revision leaves the schema internally consistent.
- **#3** — `backend/scripts/pr10_round2_apply.sql` deleted. Alembic is the single source of truth; the secondary artifact had drifted twice (F1/F2/F3 migrations + follow-on-2 migrations weren't mirrored into the script). Regression guard: `TestApplyScriptDeleted::test_apply_script_does_not_exist`.
- **#4** — `backend/tests/integration/test_floor_plans_trigger_integration.py` added with 4 live-DB behavior tests: frozen UPDATE raises `55006`, legitimate flip inside `save_floor_plan_version` passes through, `save_floor_plan_version` raises `42501` on JWT/company mismatch, `_compute_wall_sf_for_room` (1-arg) computes correctly for authenticated callers. Tests skip cleanly when local Supabase isn't running (`supabase start`).

**PR10 Round 5 — ETag contract closure (2026-04-22)**

Lakshman's round-4 review flagged 6 items on the round-3 etag/If-Match surface — 2×P1, 2×P2, 2×P3. All closed in one batch. The theme is the one the lessons doc now calls out explicitly (pattern #19): **fix at invariant scope, not code-location scope**. Round-3 shipped the etag contract across 3 layers but enforcement was only end-to-end for the Case-2 save path — every other write path had a TOCTOU hole of some shape. Round 5 closes them uniformly by declaring the 4 invariants up front and pinning each with tests:

- **INV-1.** Every mutating request carries an `If-Match` header or the explicit creation marker `If-Match: *`.
- **INV-2.** Every write path enforces the etag atomically at the SQL layer (`.eq("updated_at", …)` on direct UPDATEs OR `p_expected_updated_at` threaded into RPCs).
- **INV-3.** Every error path that leads to `window.location.reload()` persists in-flight work to a conflict-draft localStorage key keyed on the post-time source floor id, and offers a restore banner on next load.
- **INV-4.** At most one in-flight save per target at any moment (overlap guard + deferred replay).

1 new alembic migration. 21 new pytest cases on top of round-4's 3. Zero regressions. The 4 invariants are now grep-pinnable so the next write path added to `floor_plans` cannot silently reintroduce any of the four holes.

Fixes landed (each closes a Lakshman finding):

- **P1 #1 — ETag now threaded into version-creating RPCs** (migration `c9d0e1f2a3b4`). `save_floor_plan_version` + `rollback_floor_plan_version_atomic` both accept `p_expected_updated_at TIMESTAMPTZ DEFAULT NULL`. When non-NULL, the flip UPDATE inside `save_floor_plan_version` carries `AND updated_at = p_expected_updated_at` — zero rows flipped with a current row still present ⇒ raise `55006 VERSION_STALE`, Python catch maps to 412. Discriminates stale-etag from first-save-on-this-floor via a follow-up `PERFORM … IF FOUND` so the creation path keeps working. Downgrade DROPs the new 9-arg / 5-arg overloads first (Postgres treats different arities as distinct objects), then recreates the pre-change 8-arg / 4-arg forms — symmetric per lesson #10. Closes INV-2 end-to-end for Case 3 fork + rollback.
- **P1 #2 — Conflict-draft persistence on VERSION_STALE**. Before `window.location.reload()`, the shared `handleStaleConflictIfPresent` helper writes `{ canvasData, rejectedAt, sourceFloorId }` to `canvas-conflict-draft:${jobId}:${sourceFloorId}`. The source floor id is captured BEFORE the await (via `postTimeSourceFloorId` in autosave, `targetFloorIdForConflict` in cross-floor create) so the draft routes to the floor the save was AGAINST, not whatever `activeFloorRef.current` happens to be when the error lands. A mount effect scans `canvas-conflict-draft:${jobId}:*` on next load, picks the most recent draft, surfaces a restore banner with `Restore my edits` / `Discard` CTAs. No auto-apply — user reviews before overwriting. Closes INV-3.
- **P2 #1 — Autosave in-flight guard + deferred replay**. Module-scoped `_canvasSaveInFlight` + `_canvasDeferredDuringSave`. If `handleChange` fires while a save is in-flight, it updates `lastCanvasRef` + sets the deferred flag + returns without POSTing. In the save's `finally` block, if the deferred flag is set, `queueMicrotask(() => handleChangeRef.current(deferred.data))` replays — the microtask scheduling ensures React's state updates (`reconcileSavedVersion` → fresh etag in cache) commit before the replay reads the etag. Closes INV-4 / self-412 race on slow networks.
- **P2 #2 — `If-Match` now REQUIRED on every mutation endpoint**. New `require_if_match(request)` helper in `api/shared/dependencies.py`: missing header → 428 `ETAG_REQUIRED`; `If-Match: *` → returns `None` (creation opt-out, standard HTTP); otherwise returns the etag. Wired into all 5 mutation routes (save_canvas, update_floor_plan property+by-job, rollback, cleanup). Frontend `saveCanvasVersion` sends `If-Match: *` when no cached etag so first-saves don't 428. The stale `useSaveCanvas` hook (zero consumers, would have bypassed the precondition if re-wired) is deleted. Closes INV-1.
- **P3 #5 — Rollback etag now transactional** (same migration as P1 #1). `rollback_floor_plan_version_atomic` forwards `p_expected_updated_at` to its inner `save_floor_plan_version` call. Closes the Opus/Codex split by picking option 2 (thread) rather than option 1 (document-the-asymmetry). Rollback docstring rewritten to reflect the new symmetry.
- **P3 #6 — `FloorPlan.etag` narrowed from `string | null | undefined` to `string | undefined`** + new exported `hasEtag()` type guard in `lib/types.ts`. Tri-state at contract boundaries was a smell; the type guard forces explicit handling for any future consumer that wants safe narrowing.

Non-code hygiene:

- **`docs/pr-review-lessons.md`** rebuilt as a committed first-class doc (was "local working notes" — got wiped in a parallel-session cleanup). Now includes 21 meta-patterns across rounds 1-4, the INV-1/2/3/4 discipline, pre-PR grep checklist with round-4 additions, per-round honesty ledger.

**PR10 Round-5 follow-up — Lakshman's M1/M2/M3 closure (2026-04-22)**

Lakshman's round-5 review of the round-5 batch itself surfaced one HIGH (M1) + two MEDIUMs (M2, M3) + two LOWs (L1, L2). All 6 closed in this pass — the HIGH was a narrower variant of the original P2 #2 (wildcard opt-out on endpoints with no creation flow), the MEDIUMs closed correctness-adjacent cleanups and filled the integration-test gap.

- **M1 (HIGH) — `If-Match: *` wildcard now rejected on endpoints with no creation flow.** Split `require_if_match` into two helpers in `api/shared/dependencies.py`:
  - `require_if_match(request) -> str | None` — permissive. Missing → 428. `*` → returns `None` (opt-out for first-version creation). Used ONLY on `save_canvas_endpoint`.
  - `require_if_match_strict(request) -> str` — strict. Missing OR `*` → 428. Used on `update_floor_plan_endpoint` (property + by-job), `rollback_version_endpoint`, `cleanup_endpoint`. These all target existing rows; `*` on them was a default-allow loophole disguised as the round-5 closure.

  Frontend `saveCanvasVersion` helper's type tightened from `etag?: string | null` to `etag: string` (required). Dropped the silent `opts.etag ?? "*"` fallback. Each save-site caller now narrows via `hasEtag(fp)` — pass the concrete etag when present, or defer + invalidate query cache when absent (autosave + 409-recovery paths). First-save / cross-floor-create paths fall back to `"*"` explicitly with a code comment naming the scenario. Cache-miss windows no longer silently bypass the precondition.

- **M2 (MEDIUM) — Migration now DROPs prior overloads before CREATE OR REPLACE.** Postgres treats functions with different arities as distinct objects. The round-5 migration originally `CREATE OR REPLACE`d the 9-arg save + 5-arg rollback without dropping the 8-arg / 4-arg predecessors; both overloads coexisted. Runtime dispatch happened to be correct (Postgres picks the exact-match arity) but a future migration editing `save_floor_plan_version` would see one function and patch it, silently drifting the other — lesson #10 shape. Migration `c9d0e1f2a3b4` now opens with `DROP FUNCTION IF EXISTS save_floor_plan_version(UUID, INTEGER, TEXT, UUID, UUID, UUID, JSONB, TEXT)` + same for the 4-arg rollback, so only the new signatures exist after upgrade. The now-incorrect inline comment that claimed `CREATE OR REPLACE` replaced the old form (L1) is rewritten to describe the DROP-then-CREATE pattern.

- **M3 (MEDIUM) — Integration test for the atomic race.** `TestRound5AtomicEtagRace` added to `backend/tests/integration/test_floor_plans_trigger_integration.py` with 3 live-DB contracts:
  - `test_stale_expected_updated_at_raises_55006` — seeds v1 at T0, admin-client commits v2 at T1, authenticated client calls `save_floor_plan_version` with `p_expected_updated_at=T0`, asserts `APIError.code == "55006"`. End-to-end validation that the atomic flip filter actually fires through PostgREST's TIMESTAMPTZ round-trip.
  - `test_matching_expected_updated_at_succeeds` — happy path; caller's view matches current, v2 created successfully.
  - `test_first_save_with_expected_updated_at_succeeds` — discriminator contract: bogus `p_expected_updated_at` against a floor with NO current row inserts cleanly (the `PERFORM 1 … WHERE is_current=true; IF FOUND THEN raise` follow-up distinguishes stale-etag from first-save).

  Skips cleanly when local Supabase isn't reachable, matching the round-3 file's convention. Lakshman noted separately that CI doesn't exist at all — orthogonal to this PR; tracked as a follow-up.

- **L2 — Enumerate 55006 sources in `rollback_version` catch.** Explicit comment in `service.py` naming the three 55006 raise paths (round-5 atomic etag check, R4 frozen trigger, future plpgsql raises) so the next reader can cross-check the disambiguator without chasing source across migrations.

**Round-5 follow-up totals:** 0 new migrations (edited the existing `c9d0e1f2a3b4`), 3 new integration tests + 6 new unit tests for the split helper + DROP guards — all green locally. Zero regressions on the 27-test round-5 suite or the 188-test non-TestClient sweep.

---

## Phase 2 Changelog (feature-level, in progress)

Consolidated across implementation passes. Branch: `feature/01h-floor-plan-v2-phase2`. Commit history carries per-pass detail.

**Schema + backend**
- Migration `b8f2a1c3d4e5` drops legacy `moisture_readings` / `moisture_points` / `dehu_outputs`; creates `moisture_pins` + `moisture_pin_readings` with RLS and `UNIQUE(pin_id, reading_date)`.
- `backend/api/moisture_pins/` module — Pydantic schemas, service (color compute, regression compute, polygon validation, CRUD), router (8 endpoints at `/v1/jobs/{id}/moisture-pins`).
- Legacy `backend/api/moisture/` deleted; `rooms/service.py` + `sharing/` stopped querying the dropped tables (had been 500-ing `/rooms`).
- 16 pure-function pytest cases in `test_moisture_pins.py` covering pin color boundaries, regression detection, and material default lookup (`TestComputePinColor` × 8, `TestComputeIsRegressing` × 6, `TestDryStandards` × 2).

**Canvas + frontend**
- Canvas Mode abstraction (`moisture-mode.ts`, `canvas-mode-switcher.tsx`); toolbar mode-aware filtering; sketch layers dim to 0.30 in Moisture Mode.
- Moisture pin Konva layer: colored circle (red/amber/green) with reading text inside, regression badge, draggable within room polygon with fail-closed snap-back.
- Placement sheet (`moisture-placement-sheet.tsx`): Surface + Position chips, Material dropdown with room-material suggestions, `dry_standard` pre-filled from material dict and editable, initial reading input.
- Reading sheet (`moisture-reading-sheet.tsx`): tap-to-log today's reading (silent upsert on same-date overwrite); chronological history list (newest first) with per-row `↑ up` chevron on day-over-day increases and a trailing trash affordance that opens a `ConfirmModal` before the `DELETE /readings/{id}` mutation; mid-delete rows dim to 40% + stop listening to prevent double-fire; clinical sparkline (320×104) with D1…DN day labels under each dot, inline `X%` label on the dashed dry-standard line, color-matched latest-value callout above the latest (enlarged) dot; amber banner when latest reading exceeds previous.
- Pin edit sheet (`moisture-edit-sheet.tsx`): correct `material` + `dry_standard` on an existing pin without losing reading history. Header chip on the reading sheet opens it; successful Update closes both sheets (the job is done — no redundant return to the reading sheet); Cancel closes only the edit sheet.
- Shared date helpers (`web/src/lib/dates.ts`): `todayLocalIso()` + `formatShortDateLocal()` consolidate the previous per-file date logic. `reading_date` is a `DATE` column — writes must use the tech's wall clock, not UTC. Prior code used `new Date().toISOString().slice(0, 10)` on both write paths (reading-sheet save + pin creation at canvas tap), which rolled the calendar day forward after ~5 PM Pacific and caused `UNIQUE(pin_id, reading_date)` upsert collisions with the next morning's reading. Pairs with lesson #15 in `docs/pr-review-lessons.md`.
- Last-reading delete guard: the trash affordance in the history list is disabled when `history.asc.length === 1`. Deleting the only reading would leave the pin alive on canvas in the "no reading yet" neutral-gray state (`konva-floor-plan.tsx:3810`), which the tech read as a stuck / broken pin. If they want the pin gone, the canvas Delete tool is the correct path — cascading readings along with it.
- Reading-sheet history derivation extracted to `web/src/lib/moisture-reading-history.ts` (`deriveReadingHistory`, `findTodayReading`, `validateReadingInput`, `isChangedFromToday`). Component useMemo blocks now wrap the pure helpers instead of carrying the algorithm inline. Unlocks reuse by the adjuster portal view (Task 7) + PDF export (Task 6) without re-deriving.
- Full frontend test coverage for the moisture reading sheet: 22 pure unit tests in `moisture-reading-history.test.ts` (empty series, single reading, regression flagging, strict `>` vs `≥` boundary, mixed up/down series, out-of-order input, today-row lookup, input validation across empty/non-numeric/out-of-range/decimal/boundary, isChanged semantics) and 10 RTL integration tests in `moisture-reading-sheet.test.tsx` (loading skeleton → real history transition, last-reading trash disabled with hint, ≥ 2 readings enabled + correct aria-labels, ConfirmModal open/close on trash/cancel, delete mutation fires with correct reading id on confirm, today's reading prefilled via `todayLocalIso` — pinned at 8 PM US Pacific to guard the TZ regression — edit chip visibility + onEditRequest wiring).
- Sparkline sizing + label tier work detailed above is visually exercised by the component tests' presence assertions (history count, skeleton vs loaded, etc.); pixel-exact SVG geometry is deliberately NOT asserted — would ossify the visual tuning without adding safety.
- Pin Tool added to sidebar instruction map (`floor-plan-sidebar.tsx`).
- Delete-tool UX: pins mid-`DELETE` render at 35% opacity and stop listening; per-pin `pendingDeleteIds` set prevents double-tap from stacking a second 404-ing DELETE.
- Client-side coercion of `reading_value` to `Number` in the reading-sheet memos — the backend serializes DB `NUMERIC` as a string, so naked `>`/`<` on reading values would silently lexicographic-compare (`"7.00" > "19.00" === true`) and fire false regressions.
- Wall-sync hardening carried over from bonus Phase 1 work: `_wallSyncInFlight` mutex + idempotent short-circuit.

**Room dry-status rollup + Drying Progress card (Task 2)**
- Worst-pin-wins derivation in `web/src/lib/moisture-room-status.ts` — a room is `dry` only when every pin reads green, `wet` as soon as any pin is red, `drying` otherwise (including pins placed with no reading yet). Keeps the rollup independent of the canvas + sheet components so the adjuster portal (Task 7) and PDF export (Task 6) inherit the same semantics without duplicating the truth table.
- Canvas room-name tint in Moisture Mode: label color mirrors the room's status (green/amber/red/default) so the tech can scan an entire floor for wet-spot clustering without opening any sheet. Tint is keyed on backend `property_room_id`; empty rooms stay neutral.
- `DryingProgressCard` on the job-detail page (mitigation jobs only; silent on recon jobs and on mitigation jobs with zero pins). Per-room status badge + pin count, `"N of M rooms dry"` header, deep-link button `View Floor Plan →` that routes to `/jobs/{id}/floor-plan?mode=moisture`.

**Canvas room backend-id resolver (shared)**
- `web/src/lib/canvas-room-resolver.ts` centralizes the "which backend `job_room` does this canvas room map to?" question. Two provenances coexist in the wild — the `propertyRoomId` backfilled after first save, and a fallback name match against `propertyRooms` for the narrow window between room creation and backfill. The helpers prefer `propertyRoomId` when present and only accept a name match when it's unambiguous; ambiguous names contribute nothing rather than attributing data to the wrong sibling room. Three call sites now share this helper: the Moisture Mode tap-to-place resolver, the pin-follow-room translation effect, and the Affected Mode dim lookup. Prevents the duplicate-name sibling attribution bug (Bedroom 1 / Bedroom 2 in duplexes) that would otherwise land pins on the wrong room or propagate wrong `affected` flags.

**Test coverage (Phase 2, pre-PR)**

Backend — 37 pytest cases across two files:

| File | Count | Covers |
|---|---|---|
| `backend/tests/test_moisture_pins.py` | 16 | Pin color red/amber/green boundaries (8), regression-detection latest-vs-previous semantics (6), material → default dry-standard lookup (2). |
| `backend/tests/test_moisture_pins_archive_guard.py` | 21 | Archive guard on every mutating endpoint (6 — one per endpoint), cross-job pin rejection on every reading endpoint (6 — including list for the read-only case), `update_pin` placement re-validation on coord / room / material patches (5), `create_pin` polygon rejection (1), 409 on duplicate `(pin_id, reading_date)` (1), atomic-RPC failure propagation (1), partial-coord merge against existing y (1). |

Frontend — 61 vitest + RTL cases across five files:

| File | Count | Covers |
|---|---|---|
| `web/src/lib/__tests__/moisture-reading-history.test.ts` | 22 | `deriveReadingHistory` truth table (empty, single, strict `>` regression, plateau, decreasing series, mixed up/down, out-of-order sort stability, no-mutation invariant), `findTodayReading` (hit / miss / empty), `validateReadingInput` (empty rejection, non-numeric, negative, >100, decimals, boundary 0/100), `isChangedFromToday` (no-today row, null input, equal value, changed value, transient-clear). |
| `web/src/components/sketch/__tests__/moisture-reading-sheet.test.tsx` | 10 | Loading skeleton → real history transition, last-reading trash disabled with aria-label hint, ≥ 2 readings enabled with correct aria-labels, ConfirmModal open + delete-mutation fire + cancel-without-fire, today's reading prefill via `todayLocalIso` pinned at 8 PM US Pacific (guards the TZ regression), edit chip visibility gated on `onEditRequest`, edit chip click passes the pin id through. |
| `web/src/lib/__tests__/moisture-room-status.test.ts` | 7 | `deriveRoomStatus` truth table — empty (both no pins + pins in a different room), dry (all green), drying (amber present), drying (null color = unmeasured pin), wet (any red trumps green/amber), ignore pins in other rooms, + `ROOM_STATUS_COPY` label + hex coverage. |
| `web/src/lib/__tests__/dates.test.ts` | 7 | `todayLocalIso` at 8 PM US Pacific (guards the UTC-rollover bug), zero-pad months + days, year boundary, `YYYY-MM-DD` shape; `formatShortDateLocal` local-component parse, malformed fallback, round-trip agreement with `todayLocalIso`. |
| `web/src/lib/__tests__/canvas-room-resolver.test.ts` | 15 | `resolveCanvasRoomBackendId` (propertyRoomId wins, unique-name fallback, name-collision → null, no match → null, empty/undefined `propertyRooms`, propertyRoomId wins even without `propertyRooms`), `resolveCanvasRoomBackendRow` (returns full row, preserves caller-extended fields via generic, ambiguous-name → undefined, unique-name fallback, empty/undefined), `resolveCanvasRoomCandidateIds` (propertyRoomId included, unique-name included, ambiguous-name skipped, dual-provenance combined, empty set on no-match). |

Grand total: **98 cases** pinning the Phase 2 invariants. PDF-export snapshot tests (Task 6) and adjuster-portal integration tests (Task 7) deferred to their own commits.

**Internal review (pre-PR, 2026-04-23)**

Three self-review passes against the pre-PR tree using `/critical-review`. "Internal" to distinguish from the **external** review rounds (Phase 1's PR #10 was 5 rounds with Lakshman + Codex) that will follow PR submission. The planned Gemini Pro cross-check after Tasks 6 + 7 is also internal — all of this happens before Lakshman sees the branch.

Pass-1 was the first discovery pass; passes 2 + 3 were verification passes against the prior numbered findings. Structure mirrors the Phase 1 "PR10 Round N" convention so the review cadence is legible when this work ships.

- **Internal pass 1 (discovery) — 2 CRITICAL, 3 HIGH, 6 MEDIUM, 3 LOW:**
  - **C1 (CRITICAL)** — `raise_if_archived` / `ensure_job_mutable` missing on every moisture_pins mutating endpoint. Direct sibling-miss of Phase 1 Round 2 R6. Stale tabs on archived jobs could mutate frozen data. **Closed** by threading `ensure_job_mutable` through `create_pin` + `_assert_pin_on_job_and_mutable` through the five remaining mutating service methods.
  - **C2 (CRITICAL)** — Reading CRUD endpoints took `pin_id` without cross-checking against the URL's `job_id`. A same-company tech (or cached URL) could write to a different job's pin; when combined with C1, could land writes on an archived Job B via an unarchived Job A URL. **Closed** by `_assert_pin_on_job` (read-only variant, 404s on mismatch without leaking parent-job existence) and `_assert_pin_on_job_and_mutable` (mutate variant, layers archive guard on the *pin's real parent*, not the URL job).
  - **H1 (HIGH)** — `update_pin` silently skipped `create_pin`'s point-in-polygon validation on canvas_x/canvas_y/room_id patches. Drag-to-move would orphan pins outside any room polygon. **Closed** by `_validate_pin_placement` helper shared between create + update paths; merges partial patches against existing values so `{canvas_x}` still validates against existing y + room. Material → dry_standard default sync added for API callers that PATCH material alone.
  - **H2 (HIGH)** — `backend/tests/test_sharing.py` asserted `data["moisture_readings"]` after the key was removed from the shared payload + schema. Would `KeyError` on next `pytest`. **Closed** by updating the two scope-filter tests + dropping the dead kwarg from the helper router.
  - **H3 (HIGH)** — `propertyRooms.find((pr) => pr.room_name === room.name)` first-match-wins in the pin-follow-room effect + pin visibility filter. Duplicate names like "Bedroom 1 / Bedroom 2" would translate the wrong pins + hide legitimate ones. **Closed** by extracting `resolveCanvasRoomBackendId` / `resolveCanvasRoomBackendRow` / `resolveCanvasRoomCandidateIds` into the shared `canvas-room-resolver` module and rewiring three canvas sites (tap resolver, pin-follow-room effect, pin visibility filter, Affected Mode dim lookup — **four** sites closed total after Round 3 caught two sibling sites Round 2 missed).
  - **M1** — Rapid pin drags fired back-to-back PATCHes without mutation queuing; out-of-order network replies could leave a pin at a stale position. **Closed** by `queuePinCoordUpdate` with per-pin in-flight + pending-collapse, mirroring the Phase 1 Round 5 autosave pattern (P2 #1).
  - **M2** — Spec target "Full test coverage per phase" wasn't met — only pure-function tests existed. **Closed** by adding `test_moisture_pins_archive_guard.py` (21 cases covering the archive-guard invariants + cross-job rejection + polygon validation + 409 + RPC failure propagation). Uses scripted fake-client pattern so CI-free runs still exercise the contracts.
  - **M3** — `create_pin` Python-side two-step INSERT had a silent-failure window (compensating DELETE itself un-guarded; orphan pin if both INSERT-reading and DELETE-pin failed). **Closed** by migration `e1f2a3b4c5d6`: new `create_moisture_pin_with_reading` SECURITY DEFINER RPC does both INSERTs inside a single pgsql transaction with JWT-derived tenant check; `create_pin` swapped to `.rpc(...)`. New merge migration `d0e1f2a3b4c5` keeps the Phase 1 Round 5 migration chain contiguous.
  - **M4** — `MoistureEditSheet` initialized state from `pin` prop once; a future refactor that kept the sheet mounted across pin switches would show stale values. **Closed** by `key={pin.id}` on the render call site with explanatory comment.
  - **M5** — `list_pins_by_job` sorted embedded readings in Python after the query; fragile if `reading_date` ever changes type. **Closed** by pushing the sort into the PostgREST embed: `readings:moisture_pin_readings(*, order(reading_date.desc))`.
  - **M6** — Seed script `backend/scripts/seed_moisture_history.py` used bare `sys.argv` without UUID validation. **Not addressed** — pure dev tool, acceptable as-is; can switch to `argparse` if the script grows.
  - **L1–L3** — dead defensive branch in `create_pin` (closed, uses subscript), `delete_reading` missing `log_event` (closed, audit parity restored), reading-sheet `prefillKey` re-seed could overwrite in-progress input (closed, now keys on `pin.id` only).

- **Internal pass 2 (verification):** 13/14 findings CLOSED, 1 PARTIAL. H3 was closed at the two sites named in pass 1 but the same bug shape was still live at `konva-floor-plan.tsx:1059` (tap resolver) and `:2479` (Affected Mode dim). Lesson #19 in action — fix at code-location scope vs invariant scope. All other findings confirmed closed with grep + test evidence.

- **Internal pass 3 (verification):** PARTIAL from pass 2 → **CLOSED**. Added `resolveCanvasRoomBackendRow<T>` for call sites that need the full row (not just the id), rewired both remaining sites. `grep -nE "propertyRooms\??\.find" konva-floor-plan.tsx` → only id-based lookups remain. Invariant now enforced at every name-match site. STOP signal on internal Claude rounds: further fresh-context passes would surface only narrower siblings. Next step is the planned internal Gemini Pro cross-check after Tasks 6 + 7 land, then external review on PR.

---

**Moisture Report View — Tasks 6 + 7 (2026-04-23)**

> **Internal review round 1 (2026-04-23) — CONDITIONAL → closed.** 4 HIGH / 5 MEDIUM / 2 LOW findings addressed in one pass:
> - **H1** — alembic migration `f1e2d3c4b5a6` backfills `job_rooms.floor_plan_id` from `jobs.floor_plan_id` (pinned) or the property's sole `is_current` floor (unambiguous). Ran against dev: 122 rooms resolved, 23 remaining NULL (properties with no floor plans — correct to leave). Closes the silent-pin-drop bomb for every pre-fix environment.
> - **H2** — narrowed the two new `except Exception: pass` blocks in `sharing/service.py` to `except APIError`; tolerated codes `PGRST205 / PGRST204 / 42P01` with a `logger.warning`, all others `logger.exception(...)` + re-raise. Ops now has an attributable log line instead of silence.
> - **H3** — added `moisture_access: "denied" | "empty" | "present"` discriminant + `primary_floor_id: UUID | None` to `SharedJobResponse`. Portal branches empty-state copy on the discriminant: `denied` → "out of scope", `empty` → "No readings logged yet", `present` → render. Old payloads without the discriminant fall back to legacy derive-from-arrays so portal-ahead-of-backend deploys don't crash.
> - **H4** — `firstDryDayNumber` switched from calendar-day delta to sequence-position within the pin's own `asc` array (correct for the per-pin "Dry on Day N" chip). Summary-table cell computes its day label from the job-wide `allDates.indexOf(firstDryDate) + 1` instead of reading `firstDryDayNumber`, so the Dry-Date cell's `(Dn)` always matches the column header it sits under — even when readings skip days. Added vitest case `Apr 18 / Apr 22 / Apr 24` to pin the semantics.
> - **M1–M5 + L1–L2** — stray files deleted, `computePinColor` moved into `lib/moisture-reading-history.ts` (re-exported from `hooks/use-moisture-pins` for back-compat), `buildMoistureReportProps` extracted as shared derivation between tech + portal wrappers, width/height/propertyRooms props dropped from `MoistureReportCanvas` (YAGNI), drying-progress card actions wrapped in `role="group" aria-label`, single-floor picker renders as a plain `<span>` not a disabled-grey select.
> - **Post-review visual tweak** — Dry-Date cell reads `22 Apr · D2` in one emerald phrase (tick dropped; `(D2)` → `· D2` middle-dot); empty dashes center-aligned in day columns so the placeholder stops drifting to the numeric right edge.
>
> Pre-PR gates (post-fix): `npx vitest run` → 114 green / 10 files; `npx tsc --noEmit` clean; `ruff check` clean on all touched backend files; moisture + sharing pytest paths pass (pre-existing failures in `TestCreateShareLink`/`ListShareLinks`/`RevokeShareLink` are unrelated — auth middleware mock drift, out-of-scope for this branch).

> **Internal review round 2 (2026-04-23) — CONDITIONAL → closed.** All round-1 findings verified CLOSED via Gemini Pro + Flash cross-verification. Round-2 surfaced 1 MEDIUM + 1 LOW + 2 test gaps + 1 doc nit, all addressed:
> - **MEDIUM — `buildMoistureReportProps` mixed-pin branch.** The previous `anyPinHasFloorId` all-or-nothing fallback silently dropped pins on multi-floor jobs where some pins had `floor_plan_id` and some didn't (post-backfill ambiguous rows). Replaced with strict per-floor bucketing + a new `orphanPins[]` output. View renders an "Uncategorized pins (N)" amber callout above the canvas and includes them in the reading log with a `+ N uncategorized` annotation in the section header — the data is preserved end-to-end and the gap is surfaced honestly instead of crammed onto the primary floor (which falsely concentrated the damage picture). Pins lesson #27 ("helpers with `.some()` / `.every()` need an explicit mixed-case branch").
> - **LOW — Portal fallback default.** Client-side fallback for missing `moisture_access` was `denied`, which wrongly told a restoration_only adjuster on day 1 of mitigation to ask for a different link they didn't need. Flipped to `empty` ("No readings logged yet, check back").
> - **Bonus close — `moisture_access: "unavailable"` (4th state).** When `moisture_pins` or `floor_plans` queries hit a tolerated PGRST table-missing code, the discriminant now surfaces `unavailable` (distinct from `empty`). Portal renders "Moisture data temporarily unavailable" instead of misleading "no readings yet" copy. Pins lesson #28 ("discriminants should enumerate failure modes BEFORE picking enum values").
> - **Bonus close — `floor_plans` defense-in-depth.** Admin-client query now also filters `.eq("company_id", company_id)` (admin client bypasses RLS, so adding the filter guards a future data-ops bug where a property gets re-parented).
> - **Doc nit — `_POSTGREST_MISSING_TABLE_CODES` rationale.** Inline comment explains all three codes (`PGRST205` undefined table / `PGRST204` undefined column / `42P01` Postgres-level undefined relation) so a future contributor doesn't drop one thinking it's redundant.
> - **Test gaps closed (2 backend cases).** `test_public_shared_view_moisture_pins_apierror_unavailable` pins the discriminant precedence on PGRST205. `test_public_shared_view_photos_only_omits_primary_floor_id` regression-pins the `primary_floor_id` scope gate.
> - **CSS / UX tail.** Dragging on a freshly-tapped pin used to require a "warm-up" tap because Konva's default `dragDistance=0` swallowed the first tap into drag arbitration; set `dragDistance={5}` on the Stage so static taps fire as taps immediately. `handlePinTap` now defaults to opening the reading sheet for any tool state other than `delete` (closes the silent no-op when toolbar landed in a transient state).
>
> Pre-PR gates (post-round-2 fix): `npx vitest run` → **114 green / 10 files**; `npx tsc --noEmit` clean; `ruff check` clean; **61 backend pytest cases** across `test_moisture_pins.py` (16) + `test_moisture_pins_archive_guard.py` (21) + `TestPublicSharedView` (24, +2 from round-2 test gaps).

> **Pre-landing review round 3 (2026-04-25) — CONDITIONAL → closed.** 13 findings (4 P1 blockers / 6 non-blocking / 3 polish):
> - **#1** Broken `Log Reading` CTA → retarget to `/floor-plan?mode=moisture`.
> - **#2** Adjuster portal moisture report undiscoverable → "View moisture report" card on `/shared/[token]` when `moisture_access === "present"`.
> - **#3** PII leak via `SELECT *` + pop-blacklist → explicit `_PUBLIC_*_COLUMNS` allowlist on `jobs / job_rooms / photos / line_items`.
> - **#4** No `log_event` on `create_reading` / `update_reading` (highest-freq mutation) → symmetric `moisture_reading_created` + `..._updated` events.
> - **#5** `notes` + `recorded_by` on public readings embed → narrowed embed to `id, pin_id, reading_value, taken_at, meter_photo_url, created_at`.
> - **#6** Token leak via Referer → `referrer: "no-referrer"` on new `shared/[token]/layout.tsx`.
> - **#7** `primaryFloorId` was `void`'d → returned as `defaultFloorId` and threaded as URL fallback in both wrappers.
> - **#8** Orphan-pin `UUID(str(None))` 500 → `update_pin` raises 409 `PIN_ORPHANED` when patch touches coords/room without supplying a `room_id`. **Stop-gap only**: the proper fix is the PR-E room-delete-cascade item (`docs/specs/draft/01H-phase3-pin-attribution-proposal.md` §10 carry-forward) — `moisture_pins.room_id` FK switches to `ON DELETE RESTRICT` + a "Delete room? Will also remove N pins and M readings" confirmation modal does the cleanup before the room delete is allowed. Once that lands, this 409 guard becomes unreachable and can be removed.
> - **#9** Unbounded readings embed → `.limit(500, foreign_table="readings")` on both list + share endpoints.
> - **#10** Silent localhost fallback → centralized `web/src/lib/api-url.ts` (throws in prod when env missing); 10 sites consolidated.
> - **#11** `Decimal→float` at RPC boundary → pass `str(...)` so NUMERIC parses losslessly.
> - **#12** Dead pagination branch in `useMoisturePins` / `usePinReadings` → removed.
> - **#13** Fallback share-link audit gap → loud `logger.warning` + docstring documenting the non-atomic trade-off.
>
> Gates: `tsc --noEmit` clean; backend `py_compile` clean. Vitest + pytest re-run pending before push.

Carrier-grade snapshot document per Brett §8.6: *"the moisture floor plan exports as a single-page PDF for carrier documentation… available in the adjuster portal without requiring a PDF export."* One shared `MoistureReportView` component, two mount points.

Frontend-only route pattern (same as Phase 1's `/jobs/[id]/report` — HTML page + `window.print()`, no PDF library, no server-side rendering). Reuses every derivation helper built during Blocks 3A/3B: `deriveReadingHistory`, `deriveRoomStatus`, `canvas-room-resolver`, `dates`.

- New route `/jobs/[id]/moisture-report?date=YYYY-MM-DD&floor=<id>` — protected, tech-facing. Back-arrow (icon-only on mobile) + Print / Save PDF button. Global print CSS already hides chrome via `.no-print` + `header:not(.print-section *)`; route wraps the view in `.print-section`.
- New route `/shared/[token]/moisture?date=YYYY-MM-DD&floor=<id>` — public adjuster portal. Same view, no print chrome. Scope-gated via the existing share-link flow (empty state when `photos_only`).
- Shared view component in `web/src/components/moisture-report/`:
  - `moisture-report-view.tsx` — header (logo + job metadata + floor picker + snapshot picker + rollup), single canvas section, reading log section. Empty states: "no floor plans yet" (view-level, short-circuits canvas + table both), "no pins on this floor" (below canvas), "no pins existed as of this date" (hides reading log + rollup inflation).
  - `moisture-report-canvas.tsx` — read-only Konva stage. Fit-to-box scale against ResizeObserver-measured container (responsive mobile vs desktop). Pins rendered at `canvas_x/y` with colors from `computePinColorAsOf(readings, snapshotDate, dry_standard)` — date-scoped rather than latest-reading-only. Pin radius 9px mobile (<500px viewport) / 13px desktop.
  - `moisture-report-summary-table.tsx` — Location · Material · Dry std · D1..DN · Dry date. Columns = distinct reading_dates across the active floor's visible pins. Dry date column reads `history.dryMilestone.firstDryDate` (computed — never persisted); pins that never dried show "—". Inline color-coded cell dots per Brett §8.4.
- New entry point in the Drying Progress card (job detail page): two inline links — "View Floor Plan →" (existing) + "Open Moisture Report →" (new). Wraps on mobile; same visual weight so neither is buried.

**Per-floor isolation (the hardest part):**

Brett: *"no floors should collide."* Implementing this revealed a pre-existing data bug — `handleCreateRoom` on the floor-plan page never passed `floor_plan_id` on `POST /v1/jobs/:id/rooms`, so every `job_rooms` row in the database had `floor_plan_id = NULL`. The editor worked (hydrates from `canvas_data` JSONB), but every relational consumer was broken from day one. Fix:

- `handleCreateRoom` now passes `floor_plan_id: activeFloorIdRef.current` at creation time. Forward-declared ref at the top of the component so the useCallback doesn't fall out of scope order. All new rooms carry their floor link going forward.
- Backfilled existing rooms in the dev DB via SQL UPDATE.
- `list_pins_by_job` now embeds `room:job_rooms!room_id(floor_plan_id)` server-side and flattens the result onto each pin as `pin.floor_plan_id`. Frontend filters `pin.floor_plan_id === selectedFloor.id` — no fragile client-side join.
- **`MoisturePinResponse` Pydantic schema declares `readings: list[...] | None` and `floor_plan_id: UUID | None`** so FastAPI's serialization layer doesn't silently strip them on `response_model` validation (this was the single most expensive bug in the sprint; pairs with lesson #24).
- Shared-view service also updated: `/v1/shared/resolve` now returns `moisture_pins[]` (each carrying full readings + floor_plan_id) and `floor_plans[]` (all current floors for the property, ordered by floor_number) — scope-gated.

**Snapshot-date semantics:**

- Floor picker scopes EVERY surface (canvas, reading log, rollup, date picker options).
- Snapshot picker drives pin colors via `computePinColorAsOf` (latest reading ≤ selected date). Canvas + rollup + reading log ALL filter to pins whose `earliestReading.reading_date <= selectedDate`. Pins created after the selected date are hidden entirely — not rendered as stale grey dots.
- `dryMilestone.firstDryDate` logic: first reading where `value ≤ dry_standard`. Regressions after dry do NOT reset the milestone (compliance-relevant "drying was achieved" fact). See `moisture-reading-history.ts`.

**Canonical floor names:**

- Dropdown always shows "Basement / Main / Upper / Attic" for floor_numbers 0–3, regardless of any stored `floor_name`. Custom names respected only for floor_numbers 4+ (future roof / crawl).
- Disabled on single-floor jobs so the tech sees which floor they're viewing (informational, not interactive).

**Sharing payload changes (backend):**

- `SharedJobResponse` schema: added `moisture_pins: list[dict]` + `floor_plans: list[dict]`.
- `get_shared_job` service fetches both with scope gating: `photos_only` → empty, `restoration_only` + `full` → populated.
- Moisture pins embed includes readings + room.floor_plan_id (same shape as list_pins_by_job).
- Floor plans query: `.eq("property_id", ...).eq("is_current", true).order("floor_number")` — every current floor on the property, ordered basement → attic.

**Test coverage additions (this sprint):**

Frontend — 18 new vitest cases:
- `moisture-reading-history.test.ts` — 6 new cases for `computePinColorAsOf`: empty series → null, date before first reading → null, exact-date match, between-readings (latest ≤ date wins), after-last-reading, dry-standard boundary sensitivity.
- `moisture-report-view.test.tsx` — 5 new cases: header + date picker + summary for multi-reading pin, date picker fires onChange with new date, dry rollup scopes to selected date (0 of 1 dry on Apr 22, 1 of 1 on Apr 24 for a pin that dries Apr 24), ONE empty state only (no-floors), Dry Date column shows D-N + date for dried pins.
- `moisture-reading-sheet.test.tsx` — 2 new cases on cold-open / user-typed lock: reading sheet re-seeds when today's reading arrives after mount, does NOT re-seed once the tech has typed.

Backend — 3 new pytest cases:
- `test_sharing.py::TestPublicSharedView` — scope gating matrix: `photos_only` excludes moisture_pins + floor_plans (both empty), `restoration_only` includes both with multi-floor ordering, `full` includes both.

**Pre-PR critical-review gates this sprint closed:**

- Every mutating endpoint on the new routes is READ-ONLY (no writes), so archive guard doesn't apply — intentional; carriers must view archived jobs. Reads verified against archived jobs (status=collected).
- Cross-floor isolation verified by `pin.floor_plan_id` filter in both wrappers + `selectedFloor.pins` scope through the view.
- Pin ID + reading ID cross-checks flow through unchanged (no new reading surfaces introduced — the report is read-only; the existing reading-sheet flow still owns all the writes).
- `formatShortDateLocal` used on every date display — no UTC drift.
- Every `propertyRooms.find` now goes through the `canvas-room-resolver` — no new name-match-first-wins regressions (pin-attribution in the moisture-report canvas uses the server-provided floor_plan_id instead, which is even safer).

**Lessons that fell out of this sprint (added to `docs/pr-review-lessons.md`):**

- **#22 Calendar-day vs instant** — `DATE` columns use local wall clock; `TIMESTAMPTZ` uses UTC.
- **#23 Scripted fake clients don't validate wire format** — unit tests over Python don't catch PostgREST embed-syntax errors or RPC schema-cache drift.
- **#24 FastAPI `response_model` silently drops undeclared fields** — service log shape ≠ HTTP response shape; add the field to the schema or the browser never sees it.
- **#25 Denormalized truth masks missing FK** — the floor-plan editor read rooms from `canvas_data` JSONB and worked fine, while every relational consumer saw orphans. When a denormalized store works independently of the normalized store, they will drift silently until the next relational consumer surfaces it.

---

**Phase 2 location-split — `moisture_pins.location_name` → `surface` + `position` + `wall_segment_id` (2026-04-26)**

Application of lesson #25 to moisture pins. Pre-fix, `moisture_pins.location_name` stored a frontend-composed string (`"Floor, Center, Kitchen"`) while the structured pieces (`surface`, `position`) lived in placement-sheet React state and were thrown away at submit. The composed string couldn't be filtered or aggregated, drifted whenever a room was renamed, and gave wall pins no way to identify *which wall* of a room they sat against — even though `wall_segments` already exists as a real relational table with stable UUIDs and full RLS / fork-restamp behavior.

**Migration `e2b3c4d5f6a7`** (alembic head after upgrade):

- Adds three columns on `moisture_pins`: `surface TEXT NOT NULL` (CHECK in `floor`/`wall`/`ceiling`), `position TEXT` nullable (CHECK in `C`/`NW`/`NE`/`SW`/`SE`), `wall_segment_id UUID REFERENCES wall_segments(id) ON DELETE SET NULL`.
- One-directional bidirectional binding: `chk_moisture_pin_wall_segment_only_when_wall` rejects floor/ceiling pins with a stray `wall_segment_id` (lesson #7), but **allows wall pins without a picked segment** (draft state — picker UX hasn't shipped yet).
- Backfills from the existing `location_name` strings via SQL parser (`"Floor, Center, Kitchen"` → `surface='floor'`, `position='C'`). Wall + ceiling backfills get `position=NULL` (deferred semantics). `surface SET NOT NULL` runs after backfill — fails loud on any unparseable row.
- Drops `location_name`. Single source of truth — no more two-truths drift.
- Swaps `create_moisture_pin_with_reading` RPC: 13 args → 15 args (drops `p_location_name`, adds `p_surface` + `p_position` + `p_wall_segment_id`). DROP-before-CREATE on signature change (lesson #10). New body adds the cross-room wall binding check (lesson #30): `PERFORM 1 FROM wall_segments WHERE id = p_wall_segment_id AND room_id = p_room_id AND company_id = v_caller_company` — FK alone only validates wall existence, not parent-room binding.
- Extends `save_floor_plan_version` with a 4th `UPDATE` block (alongside the existing job_rooms / moisture_pins.floor_plan_id / equipment_placements re-stamps) that re-targets `moisture_pins.wall_segment_id` after the snapshot-restore RPCs wipe-and-re-insert wall_segments. Match by `(room_id, sort_order)` — stable across forks that don't edit the room's polygon. When sort_order doesn't match (room geometry actually changed), `ON DELETE SET NULL` has already nulled the stamp and the UPDATE no-ops. **Lesson #29 extension** — `EXPECTED_RESTAMP_TABLES` in `tests/integration/test_fork_restamp_invariant.py` extended with `moisture_pins.wall_segment_id`.
- Symmetric downgrade: restores prior `save_floor_plan_version` body + the 13-arg RPC byte-for-byte; re-adds `location_name` nullable + backfills from `surface + position + room.name + position` + flips NOT NULL; drops new columns + CHECKs.
- Live-DB notes: `NOTIFY pgrst, 'reload schema';` issued post-upgrade for the RPC param-count change (lesson #23).

**Backend service + schemas:**

- `MoistureMaterial` joined by `MoistureSurface` + `MoisturePosition` `Literal` types in `backend/api/moisture_pins/schemas.py`.
- `MoisturePinCreate` / `MoisturePinUpdate` / `MoisturePinResponse` all swap `location_name` for the structured triple. Response model declares all three explicitly so FastAPI doesn't strip them on the wire (lesson #24).
- Pydantic `model_validator` mirrors the DB CHECK at the API edge: `wall_segment_id` only valid when `surface == 'wall'`. On Update, surface flip away from wall **must** be paired with `wall_segment_id: null` in the same patch — lesson #7 (no silent coerce). Caller gets a 422 with a readable message instead of round-tripping a CHECK violation back as a 500.
- `create_pin` RPC payload swaps `p_location_name` for the new triple.
- `update_pin` cross-room wall validation in service layer (lesson #30): when the patch sets a non-NULL `wall_segment_id`, verify the wall belongs to the pin's post-patch room AND the caller's tenant. PATCH goes through `.table().update()` not the RPC, so the check has to live here.
- `update_pin` patch filter now passes `position: null` and `wall_segment_id: null` through (clearing required for surface flips); other nullable fields keep the historical "drop None on patch" behavior.
- `sharing/service.py`: public moisture payload's `*` wildcard automatically passes the new fields through; comment updated to reflect the new field set (location_name no longer named as adjuster-visible).

**Frontend (non-CSS):**

- `MoisturePin` shape on `web/src/lib/types.ts` drops `location_name`, adds `surface`/`position`/`wall_segment_id` + new `MoistureSurface` / `MoisturePosition` types.
- `useCreateMoisturePin` / `useUpdateMoisturePin` payload interfaces in `web/src/lib/hooks/use-moisture-pins.ts` match the new shape. Drag/coord-only PATCH path + multi-pin race fix + cache rollback on PATCH error all preserved verbatim — no behavior change to placement, drag, or invalidation.
- `web/src/lib/moisture-pin-location.ts` (new) — `formatPinLocation(pin, { roomName, walls?, roomPolygon? })` is the single source of truth for the display label. Returns `"Floor, Center, Kitchen"` / `"North wall, Kitchen"` / `"Wall, Kitchen"` (draft state) / `"Ceiling, Kitchen"`. Wall direction derived from geometry — wall midpoint vs. room centroid via arctan2, bucketed into 8 compass directions; works for any polygon shape (rectangle, L-shape, pentagon, octagon). Structural `WallLike` type so backend `WallSegment` and canvas `WallData` both plug in.
- `MoisturePlacementSheet` keeps its UI state in capitalized labels ("Floor"/"Wall"/"Ceiling") for chip rendering and emits the lowercase backend triple at submit. `wall_segment_id` always emitted as `null` from this sheet today (picker UX deferred). Drag-to-dismiss + validation logic untouched.
- `MoistureEditSheet` + `MoistureReadingSheet` accept an optional `roomName` prop and render the header label via `formatPinLocation`. Konva consumer threads the host room name in by resolving canvas room from `pin.room_id` via `propertyRoomId`.
- `MoistureReportSummaryTable` accepts `pinLocationLabels?: ReadonlyMap<string, string>` (precomputed labels per pin id). `MoistureReportView` builds the map from the active floor's `canvas.rooms` + `canvas.walls` + `room.points` polygon — table stays dumb, parent owns the geometry lookup.

**Tests added (Phase 2 location-split, all green):**

| File | Count | Covers |
|---|---|---|
| `backend/tests/test_migration_moisture_pins_surface_position_wall.py` | 21 | Text-scan: column adds, CHECK constraints (surface enum, position enum, one-directional wall binding), `location_name` drop, RPC DROP-before-CREATE, RPC inserts new triple not legacy column, cross-room wall binding `PERFORM 1` + `room_id` + `company_id` filter present, `save_floor_plan_version` keeps existing 3 restamps + new wall_segment_id restamp, downgrade restores location_name + drops new columns + restores old RPC byte-for-byte. |
| `backend/tests/test_moisture_pin_schemas_location_split.py` | 13 | Pydantic: floor pin with stray `wall_segment_id` → 422 (lesson #7); ceiling pin with `wall_segment_id` → 422; wall pin with segment accepted; wall pin without segment accepted (draft state); floor pin without position accepted (CHECK doesn't tie surface↔position); invalid surface/position values rejected; surface flip wall→floor with stale `wall_segment_id` → 422 (lesson #7); explicit-null clear path accepted; wall_segment_id change without surface change accepted; position-only PATCH accepted; response model declares all three new fields (lesson #24); `location_name` field absent from response model. |
| `web/src/lib/__tests__/moisture-pin-location.test.ts` | 10 | `formatPinLocation` per surface (floor with each position word, floor with null position, ceiling, wall draft state, wall with stale segment id falling back, directional derivation on a 4-wall room verified for all 4 cardinal directions, non-rectangular L-shape with 6 walls produces compass labels for every wall), room name fallbacks ("Unknown room" when missing or whitespace-only). |
| `backend/tests/integration/test_fork_restamp_invariant.py` | +1 row in `EXPECTED_RESTAMP_TABLES` | `moisture_pins.wall_segment_id` re-stamp by `(room_id, sort_order)` — extension of lesson #29's invariant test. |

Existing test fixtures updated to the new pin shape: `test_moisture_pins_archive_guard.py` (3 fixture sites), `web/src/components/moisture-report/__tests__/moisture-report-view.test.tsx`, `web/src/components/sketch/__tests__/moisture-reading-sheet.test.tsx`. Frontend report assertion now expects `"Floor, Northwest, Living Room"` (formatted via `formatPinLocation`) rather than the legacy `"Floor, NW Corner, Living Room"` composed string.

**No new pr-review lessons** — this work is application of existing lessons #7, #10, #23, #24, #25, #29, #30 (cited inline above). Lesson #29's extension rule fired as designed: adding a new fork-restamped column required appending to `EXPECTED_RESTAMP_TABLES` in the invariant test.

**Pre-PR gates:** alembic upgrade head clean against dev DB; PostgREST schema cache reloaded; full backend suite went from 192 failed → 182 failed (net +10 pass — all remaining failures pre-existing AsyncMock pattern issues in unrelated `test_sharing.py` / `test_rooms.py` files); frontend `npx vitest run` 127/127 green; `npx tsc --noEmit` clean; `npm run lint` 76 problems before / 76 after (net zero — pre-existing react-compiler nags in unrelated files; my new code lint-clean). 34 new tests across the 3 new files. Backfill applied successfully against dev DB (every existing row's `location_name` parsed cleanly).

**Post-landing bug fix (2026-04-26):** `MoisturePlacementSheet`'s `handleSave` was force-nulling `position` for non-floor surfaces — a hangover from the early "position semantics deferred for wall/ceiling" reasoning. A tech who picked NE on a ceiling pin saw the row land with `position = NULL`. Fixed: position is now sent for every surface (floor/wall/ceiling) since the DB CHECK is decoupled from surface (`position IS NULL OR position IN ('C','NW','NE','SW','SE')`) and the tech explicitly picked it. `formatPinLocation` updated in the same pass to render `"Ceiling, Northeast, Kitchen"` for ceiling pins with position.

**Position required for every surface (migration `e3c4d5f6a7b8`, 2026-04-26):** confirming the bug-fix reasoning in the schema. `moisture_pins.position` flipped from nullable → `NOT NULL`. Legacy wall/ceiling rows still carrying NULL (from `e2b3c4d5f6a7`'s deliberately conservative backfill) auto-default to `'C'` (Center) — neutral baseline, audit trail captures any tech edit. The `create_moisture_pin_with_reading` RPC's required-params NULL guard now also rejects `p_position IS NULL` with `22023`. Pydantic schemas tightened: `MoisturePinCreate.position: MoisturePosition` (no `| None`); `MoisturePinResponse.position` same. Frontend `MoisturePin.position: MoisturePosition` (no `| null`); `CreateMoisturePinBody` matches. `MoisturePinUpdate.position: MoisturePosition | None` stays nullable for PATCH semantics ("omit means don't change") with a new `_position_not_explicit_null` model_validator that rejects `position: null` in the body — clearing isn't a valid PATCH on a NOT NULL column. `formatPinLocation` simplified — the floor + ceiling branches now always render `"{Surface}, {PositionWord}, {Room}"` since position is guaranteed at the type level (no fallback path). Wall surface unchanged (compass-derived from `wall_segment_id`). Symmetric downgrade restores nullable column + prior RPC body; backfilled `'C'` values are intentionally preserved (lesson #10 spirit — downgrade succeeds against any lawful forward state). 9 helper tests + 11 Pydantic tests (added `test_create_pin_without_position_rejected` covering all three surfaces + `test_update_explicit_null_position_rejected` + `test_update_position_omitted_accepted`). Migration applied to dev DB; PostgREST schema cache reloaded.

**Critical-review round 1 fixes (2026-04-26):**

Self-review pass against the uncommitted location-split branch surfaced 1 CRITICAL, 1 HIGH, and 4 MEDIUM findings. All addressed in one batch:

- **CRITICAL — `test_dry_check_trigger_integration.py` raw INSERTs hit dropped column.** Three `INSERT INTO moisture_pins (... location_name ...) VALUES (..., 'trigger-test', ...)` statements still referenced the dropped column. Local pytest skipped the file (gated `pytestmark = [pytest.mark.integration]`, requires live DB) so the breakage didn't surface until the next CI run against a real database. Lesson #1 (claim-vs-fix gap — every site that writes the table must mirror the schema; PR updated `service.py` / `schemas.py` / `router.py` but missed the integration test). **Closed** by swapping `location_name` → `surface, position, wall_segment_id` in all three fixture INSERTs (`'floor', 'C', NULL` — trigger logic doesn't read those fields).
- **HIGH — `test_sharing.py` mock fixtures + assertions still on `location_name`.** Three fixture sites passed `"location_name": "Floor, NW Corner"` (etc.) to `_shared_view_table_router_with_data`; the assertion `data["moisture_pins"][0]["location_name"] == "Floor, Center, Kitchen"` round-tripped the mock-router shape and stayed green even though production no longer returns the field. Lesson #12 (mock-tool / failure-mode mismatch — mock-only round-trips don't validate the real wire format). **Closed** by swapping the three fixtures to the structured triple and rewriting the assertion to check `pin["surface"] == "floor"` / `pin["position"] == "C"` / `pin["wall_segment_id"] is None`.
- **MEDIUM — `update_pin` cross-room wall binding enforced in Python only (lesson #32 paired-write asymmetry).** Create path runs the lesson-#30 `PERFORM 1 FROM wall_segments WHERE id = ... AND room_id = ... AND company_id = ...` atomically inside the `create_moisture_pin_with_reading` plpgsql RPC. Update path did the equivalent at the Python layer (`.select(...).eq(...)` followed by a separate `.update({...})`) — TOCTOU window between the two statements, and any caller bypassing the FastAPI service (admin tooling, direct PostgREST writes, future RPCs) inherited zero enforcement. Doesn't bite today because no caller is sending `wall_segment_id` on UPDATE yet (picker UX hasn't shipped), but the gap becomes load-bearing the moment the picker rolls in. **Closed** by migration `e4d5f6a7b8c9` — adds a BEFORE INSERT OR UPDATE OF `wall_segment_id, room_id` row trigger `trg_moisture_pin_wall_segment_binding` on `moisture_pins` that enforces the same `(id, room_id, company_id)` predicate at the table level. Protects every write path including direct `.table().update()` calls. Smoke-tested live: a `UPDATE moisture_pins SET wall_segment_id = <other-room-wall>` against the dev DB raises `P0002` (same SQLSTATE the create RPC raises, so existing API-edge catches handle it). The create RPC's PERFORM block is intentionally kept — gives a clearer error message at the API edge before the trigger fires; etag-style defense-in-depth (lesson #15).
- **MEDIUM — `formatPinLocation` / canvas-wall id-space mismatch in moisture-report-view.** Helper does `walls.find((w) => w.id === pin.wall_segment_id)` but `moisture-report-view.tsx` passes `selectedFloor.canvas.walls` whose `id` is a client-side UUID generated at canvas draw time, not the relational `wall_segments.id`. The two ID spaces are unrelated; `find()` will always miss. Hidden today by the `if (!pin.wall_segment_id) return "Wall, ${room}"` early-return because every wall pin has `wall_segment_id=null`. Unit tests pass because they fabricate matching ids in the fixture (`web/src/lib/__tests__/moisture-pin-location.test.ts:104`). **Deferred** to the wall-picker UX session per the reviewer's recommendation — the right fix (`propertyWallId?: string` on canvas `WallData` + hydrate from the floor-plan sync) is structural and belongs with the picker work. Tracked as a picker-UX prerequisite below.
- **MEDIUM — Backfill destroys legacy wall/ceiling position info (lesson #2 silent-coerce).** The `e2b3c4d5f6a7` step-2 backfill explicitly NULLed position for non-floor surfaces (`ELSE NULL — wall + ceiling: position is NULL by design`); `e3c4d5f6a7b8` then defaulted those rows to `'C'`. Lossy if any legacy `location_name` carried directional info ("Wall, North, Kitchen" → "Wall, Center, Kitchen"). Audit query against dev DB post-fix: `SELECT surface, COUNT(*) FROM moisture_pins WHERE surface IN ('wall','ceiling') AND position = 'C' GROUP BY surface` → `wall: 1, ceiling: 1`. Both rows could be either real picks or e3 defaults; the original `location_name` is gone either way. **No code change** (column is dropped, source data unrecoverable); decision: accept the 2-row blast radius on dev. Pre-flight check captured here so prod migration runs the same probe before applying.
- **MEDIUM — Dead `position` in `nullable_passthrough` + comment lying about NOT NULL invariant.** `update_pin`'s patch filter included `"position"` in `nullable_passthrough` from before the `_position_not_explicit_null` Pydantic validator tightened. After `e3c4d5f6a7b8` made `moisture_pins.position` NOT NULL, the validator catches `position: null` at the schema boundary so `position` can never reach the patch dict as None — the set-membership is dead code. Comment said "explicit-null-valid (clearing them on a surface flip is required behavior)" — true for `wall_segment_id`, false for `position`. Future-author landmine: a maintainer relaxing the validator could ship NULL into a NOT NULL column. **Closed** by dropping `"position"` from `nullable_passthrough` and rewriting the comment to call out that `wall_segment_id` is the only explicit-null-valid PATCH field, with explicit history of why "position" was removed.

**New tests added in this round:**
- `backend/tests/test_migration_moisture_pin_wall_segment_trigger.py` — 7 text-scan cases pinning the trigger SQL: function exists, body queries `wall_segments` with the three-predicate WHERE clause, NULL skip path, raises P0002 on mismatch, BEFORE INSERT OR UPDATE OF (`wall_segment_id, room_id`) scope, downgrade drops trigger + function.
- Live smoke probe (documented in migration docstring + spec note): `UPDATE moisture_pins SET wall_segment_id = <other-room-wall>` raises P0002 against the dev DB.

**Final test count:** 86 backend pin-related pytest cases green (79 from prior round + 7 new trigger-text-scan); 126/126 frontend vitest; trigger smoke-test pass against live DB. Sharing test suite still has 14 pre-existing AsyncMock failures in `TestCreateShareLink` / `TestListShareLinks` / `TestRevokeShareLink` — not in the location-split scope, baseline unchanged.

**Gemini cross-review (2026-04-26) — round 2 verdict.** Cross-verified the round-1 self-review against an independent reasoning pass. One CRITICAL surfaced that the Claude-side review missed; two MEDIUMs (update-path enforcement + canvas/relational id-space mismatch) escalated to HIGH. Net actions:

- **CRITICAL — fork-restamp `UPDATE` in `save_floor_plan_version` was structurally a no-op.** I'd added an `UPDATE moisture_pins SET wall_segment_id = new_walls.id ... AND new_walls.id <> old_walls.id` block to `save_floor_plan_version` in `e2b3c4d5f6a7` and the test_fork_restamp_invariant text-scan green-lit it. Gemini caught that the call order in `rollback_floor_plan_version_atomic` is (1) `save_floor_plan_version` → (2) `restore_floor_plan_relational_snapshot`, and that the wipe-and-re-insert of `wall_segments` happens in step 2, not step 1. So at the moment the `UPDATE` ran inside step 1, no new walls existed yet — the `<> old_walls.id` filter eliminated everything → no-op #1. Step 2 then `DELETE FROM wall_segments` per room → `ON DELETE SET NULL` nulled every wall pin. Step 2 then `INSERT`ed new walls — but nothing re-linked the pins. **Net pre-fix:** every rollback nulled every wall pin's `wall_segment_id` even when the room polygon was unchanged, exactly the invariant the docstring claimed it preserved. Hidden today because every wall pin has `wall_segment_id IS NULL` (picker UX hasn't shipped); load-bearing the moment it does. Why text-scan missed it: the test introspected the installed RPC body and confirmed the UPDATE statement was syntactically present — it didn't exercise an end-to-end rollback against a real DB and assert pins keep their stamp. Pure lesson #12 ("text-scan green-lights syntax, not semantics") + lesson #13 ("docstring-as-claim isn't protection — verify the call order"). **Closed by migration `e5f6a7b8c9d0`** — the dead UPDATE block is removed from `save_floor_plan_version`; the re-stamp logic is moved inside `restore_floor_plan_relational_snapshot` where both old and new wall data are visible. Per-room: capture `(pin_id, sort_order)` map BEFORE `DELETE FROM wall_segments`, then after the inner FOR-loop re-INSERTs new walls, run `UPDATE moisture_pins ... FROM jsonb_to_recordset(captured_map) JOIN wall_segments new_ws ON new_ws.sort_order = pwr.sort_order`. Pins whose original sort_order matches a new wall in the same room get re-stamped; pins whose sort_order no longer maps (geometry actually changed) stay NULL via `ON DELETE SET NULL` — same honest answer as before. Symmetric downgrade restores both prior bodies (including the dead UPDATE block in `save_floor_plan_version`) byte-for-byte.
- **Test rewrite that pins this for real.** New file `backend/tests/integration/test_wall_segment_restamp_on_snapshot_restore.py` with 2 cases that exercise the exact SQL fragments the new function runs (capture → DELETE → INSERT → re-stamp) against a real Postgres connection. **PASS** confirmed against the dev DB: pin starts at original wall UUID → wipe nulls it → re-INSERT → re-stamp UPDATE flips it to the new wall UUID with the same sort_order. The geometry-changed sibling case verifies the pin stays NULL (no fake re-link). The original `test_fork_restamp_invariant.py` had `moisture_pins.wall_segment_id` in `EXPECTED_RESTAMP_TABLES` from the prior pass — removed and replaced with a NB block pointing at the new integration test (since the invariant no longer lives in `save_floor_plan_version`).
- **MEDIUM-1 (update-path Python-only check) escalated to HIGH by Gemini.** Already closed in round 1 by `trg_moisture_pin_wall_segment_binding` trigger. Severity reading reconciled — Gemini's HIGH was fair given the picker-UX rollout will activate the gap; my MEDIUM downgrade trusted the calendar.
- **MEDIUM-2 (`formatPinLocation` / canvas-wall id-space mismatch) escalated to HIGH by Gemini.** Still deferred to picker-UX session, but flagged as a **must-fix concurrent with the picker** (not "ship-acceptable as same-day follow-up"). Picker-UX prerequisite block in carry-forward already lists the structural fix shape (`propertyWallId` round-trip on canvas `WallData`).
- **What Gemini got wrong (so the rating's calibrated for the next round):** false flag on a missing Pydantic validator on `MoisturePinCreate` — `_wall_segment_only_on_wall` IS at `schemas.py:103-112` with regression tests at `test_moisture_pin_schemas_location_split.py:43-79`. Discarded. Gemini also missed the original CRITICAL + HIGH I'd caught in round 1 (`test_dry_check_trigger_integration.py` raw INSERTs + `test_sharing.py` fixtures/assertion) — its grep didn't reach into `backend/tests/integration/` or `test_sharing.py`.

**Final test counts** post-Gemini round: 86 backend pin-related pytest cases green (was 86 before; 0 net since the EXPECTED_RESTAMP_TABLES entry was removed and re-pinned via the new integration test) + 2 new integration tests green (run against live DB) + 126/126 frontend vitest. Migration `e5f6a7b8c9d0` applied to dev DB; PostgREST schema cache reload not required (no RPC param-count change in this migration). Sharing test suite still has 14 pre-existing AsyncMock failures in `TestCreateShareLink`/`TestListShareLinks`/`TestRevokeShareLink` — unchanged baseline.

**What's still open** (carry-forward, not blocking):
- Wall picker UX in placement sheet — surface=Wall pins currently save with `wall_segment_id=null`. Follow-up PR will add the auto-snap-to-nearest-wall flow (drop point → nearest wall by perpendicular distance → confirmation chip) so techs link the pin to a specific wall during placement. Schema is ready; only the frontend interaction is missing.
  - **Picker-UX prerequisite (canvas-wall id space alignment):** `formatPinLocation` reads `walls.find((w) => w.id === pin.wall_segment_id)` but `web/src/components/sketch/floor-plan-tools.ts:WallData` carries a client-generated `id` (canvas draw time), not the relational `wall_segments.id`. `RoomData` already solves the equivalent problem via `propertyRoomId`; mirror that — add `propertyWallId?: string` to `WallData`, hydrate it during the floor-plan version load (canvas data → state), round-trip on save, and update `moisture-report-view.tsx` to map `wallsInRoom` to `WallLike` using the relational id. Hidden today by the "no segment → bare 'Wall, Room'" early-return; bites the moment the picker writes a real id. Add a regression test that uses real backend UUIDs for both pin.wall_segment_id and the wall fixture.
  - **Picker-UX prerequisite (atomic wall-replace RPC):** `_syncWallsToBackendImpl` in `web/src/app/(protected)/jobs/[id]/floor-plan/page.tsx` currently does the wipe-and-recreate as N HTTP round-trips (DELETE all walls → POST replacements → PATCH each captured pin's `wall_segment_id`) with capture-then-restamp mirroring `restore_floor_plan_relational_snapshot`. Closes the latent silent-null bug (round-1 HIGH 1) for picker-UX day-1 readiness. **Not atomic** — a crash mid-sequence leaves pins NULL (no worse than today's silent-wipe). Before non-NULL `wall_segment_id` values enter prod via the picker rollout, escalate to a `replace_room_walls(p_room_id, p_walls JSONB)` SECURITY DEFINER RPC that captures, deletes, inserts, and restamps inside one tx (mirrors Phase 1 R19 snapshot-restore shape) so atomicity holds end-to-end. Same lesson #29 family — every code path that wipes-and-re-inserts wall_segments must capture + re-stamp; today only the rollback path (e5f6a7b8c9d0) does this server-side.
- Position semantics for wall + ceiling pins — schema accepts NULL; UX hasn't decided what "position" means for those surfaces yet (height bucket? wall-relative quadrant? omit entirely?). Defer until the picker lands.
- CSS / visual polish on the placement sheet's surface chip layout when Wall is selected (no changes today — only structural data flow).
- **412 VERSION_STALE → reload UX hole — every pin on a duplicate-named room becomes undraggable until the duplicate is deleted.** Surfaced during dev-test of the location-split branch (Samhith, 2026-04-26). Pre-existing — not introduced by Phase 2 work, not in any code I touched. Root cause confirmed end-to-end: (1) tech saves a room → race produces 412 → "refresh" banner; (2) `window.location.reload()` in the floor-plan editor wipes Konva's unsaved state; (3) tech re-creates the room with the same name; (4) `canvas-room-resolver.ts` correctly refuses to guess between duplicate names without `propertyRoomId` (lines 100-105 — the documented HIGH #5 guard from Phase 2 round 1); (5) pin-follow-room at `konva-floor-plan.tsx:692-693` gets `candidateIds.size === 0` and `continue`s — so dragging the duplicate-named room moves NONE of its pins. Reproduces in dev (delete the duplicate-named room → drag works again). Combines two prior lessons that haven't been closed end-to-end: lesson #17 ("New error paths need end-to-end UX — banner promised reload would re-apply edits; reload nukes Konva state instead") + lesson #5/HIGH-#5 ("name-match resolver returns null on ambiguity, by design"). The resolver behavior is correct; the upstream UX flow creates the ambiguous state in the first place. Three stackable fixes possible — none in this branch:
  - **Quick (cosmetic):** banner copy stops promising "reload to re-apply your edits" — truth-in-advertising.
  - **Real (architectural):** on 412, refetch the latest version + reapply the user's pending edit on top instead of wiping state. Bigger change, needs design.
  - **Adjacent (preventive):** frontend validator blocks duplicate-named rooms at the create step before save, so the post-refresh duplicate-name state is unreachable.
  - **Severity:** HIGH for real users — every tech who hits a 412 once during room creation can land in a state where pin drag silently fails on every pin in that room. Reachable via normal workflow (no admin tooling needed). Not blocking the location-split merge but blocking on its own merits — open as a separate PR.

---


## Summary

Brett's V2 spec redefines the sketch tool from a drawing canvas into the **spatial backbone** of the Crewmatic platform. Every feature — moisture readings, equipment tracking, photo documentation, billing, and carrier reports — anchors to the floor plan.

**Key architectural shifts:**
- Floor plans belong to **properties** (not jobs), with **job-driven versioning**
- Rooms become **structured records** with type, ceiling, materials, affected status
- Walls become **first-class relational entities** (needed for Xactimate line items)
- Moisture readings become **spatial pins** with persistent locations tracked over time
- Equipment tracking records **individual units** (not quantity counts) for billing accuracy
- Photos gain **categories**, **before/after pairing**, and **backend-summarized clustering**

## What Already Exists (Do Not Duplicate)

Before this spec was finalized, several components were verified to already exist in the codebase:

| Component | Status | Notes |
|-----------|--------|-------|
| `properties` table | ✅ Live in DB | Full schema with `usps_standardized`, `year_built`, `property_type`, `total_sqft`, `deleted_at`, `address_line2`. Has unique index on `(company_id, usps_standardized)` with soft-delete awareness. |
| Properties CRUD API | ✅ Live | 5 endpoints: POST, GET list with search, GET by id, PATCH, DELETE (soft). Has dedup logic via `_build_usps_standardized`. |
| `jobs.property_id` FK | ✅ Live | Already references properties table. Job creation flow auto-creates property if none exists for address. |
| Konva canvas editor | ✅ Live (01C) | Keep the Konva framework. Replace interaction model + rendering logic. |
| Moisture readings (atmospheric) | ✅ Live | Keep — still needed for room-level temp/RH/GPP data. |
| Photos CRUD | ✅ Live | Extend with new fields, don't replace. |

## Done When

### Phase 1: Property-Scoped Floor Plans + Versioning + Canvas + Walls

**Data model & backend**
- [x] Unified `floor_plans` table (migration `e1a7c9b30201`) — one row IS a versioned snapshot, scoped by `(property_id, floor_number, version_number)`
- [x] `jobs.floor_plan_id` scalar pin (renamed from `floor_plan_version_id`)
- [x] `wall_segments` + `wall_openings` relational tables (not JSONB)
- [x] Archived jobs (`complete` / `submitted` / `collected`) reject all writes
- [x] Frozen-version immutability: `update_floor_plan` / `save_canvas` / `rollback_version` / `cleanup_floor_plan` reject writes against non-current rows
- [x] Versioning state machine in `save_canvas` — Case 1 (create v1, pin), Case 2 (update in place), Case 3 (fork + pin)
- [x] `_create_version` enforces "one is_current per (property, floor)" — flips siblings before insert
- [x] Job creation pins new floor rows via `created_by_job_id` so first save hits Case 2, not Case 3
- [x] Linked recon inherits structural room fields from parent mitigation via `_copy_rooms_from_linked_job`
- [x] **D1:** Autosave POSTs to `/v1/floor-plans/{fpId}/versions` with `job_id` in body
- [x] **D2:** Pinned-version hydration in floor-plan editor + job-detail thumbnail (strict floor_plan_id match prevents cross-floor corruption)
- [x] **D3:** Multi-floor selector UI — preset pills with room-count badge + `v{N}` chip
- [x] Wall sync to backend on each autosave (walls + doors + windows + openings → `wall_segments` + `wall_openings`)
- [x] Backend `JobResponse` exposes `floor_plan_id` for frontend hydration
- [x] Canvas grid changed from 20px=1ft to 10px=6in (clean wipe of existing `canvas_data`)

**Canvas core**
- [x] Polygon data model (`RoomData.points`) — rectangles + N-gons share code paths (`wallsForRoom`, `polygonCentroid`, `polygonBoundingBox`, `polygonToKonvaPoints`)
- [x] Room creation via shape picker — Rectangle / L / T / U / Rect+Notch drops at viewport center at default dimensions, with auto-pan if bbox clips viewport
- [x] Room creation fallback: classic click-and-drag rectangle (via shape-picker Cancel)
- [x] **E6:** Trace-perimeter tool — tap corners sequentially, rubber-band preview, numbered vertex dots, floating status pill
- [x] Room confirmation card: name, type, ceiling, floor (always required), materials, affected
- [x] Room type system — 13 predefined types with material defaults auto-filled when chip list is empty (respects manual edits)
- [x] 6-inch grid snap enforced
- [x] **E1:** Polygon data model unified
- [x] **E2:** L-shape via vertex editing — Reshape converts rectangle to 4-point polygon; drag handles on each vertex; tap-on-edge inserts a new vertex; walls regenerate
- [x] **E3:** Magnetic room-to-room snap within 20px (all 4 axes plus axis-aligned stacks)
- [x] **E4:** Shared-wall auto-detection — collinear + overlapping walls marked `shared=true`, muted render, excluded from perimeter LF
- [x] **E5:** Affected Mode overlay — "Damage" toolbar toggle dims non-affected rooms/walls to 25%
- [x] **E7:** Floor openings (cutouts) — dashed-rect overlay, live bbox-clamp during drag/resize, bottom-sheet editor with max-bound validation, end-to-end net-SF math
- [x] Inline direct-edit of room dimensions — Width / Length inputs in the mobile bottom sheet + desktop sidebar, debounced 400ms commit + blur/Enter, Escape reverts; updates bbox + regenerates walls + clamps cutouts + re-runs shared-wall detection
- [x] Rect-shaped polygons (4 vertices still at bbox corners) accept direct W×H edits — `isRectangularPolygon(room)` helper regenerates points alongside the bbox update
- [x] Polygon drag correctness — Group's `x/y` reset imperatively on drag end so polygon/fill/labels/walls/cutouts all land together
- [x] Cutout follow-drag — `floor_openings` shift with parent room in `handleDragEnd`
- [x] Per-edge polygon dimension labels on selection — `pointInPolygon` probe for correct outside-placement on concave T/U/L
- [x] Tap-anywhere-empty deselects (any non-`elementId` target clears selection)
- [x] Tap-active-tool returns to Select (mobile-friendly escape matching Figma/Sketch)

**Walls + openings**
- [x] Wall contextual menu on tap — Add Door / Window / Opening, Wall Type, Mark Affected
- [x] Door: width + height (default 7ft, editable), SF deduction, 4 swing directions
- [x] Window: width + height (default 4ft), optional sill height, SF deduction
- [x] Opening (missing wall): dashed indicator, drag handles, full SF deduction
- [x] Wall type toggle (exterior / interior) — drives Xactimate codes in Spec 01D
- [x] Wall affected status — per-wall flag, independent from room
- [x] Opening tool in toolbar (click wall to place)
- [x] Exterior wall visual indicator (blue, thicker stroke)
- [x] Affected wall visual indicator (red stroke)
- [x] Tightened door/window hit-area so room corner-resize handles stay tappable near wall endpoints

**SF calculations**
- [x] Floor SF auto-calculated (polygon area − cutout area)
- [x] Wall SF auto-calculated (perimeter LF × ceiling height × ceiling multiplier − openings)
- [x] Custom wall SF override per room (non-standard ceiling geometry)
- [x] Net SF in `job_rooms.square_footage` syncs via autosave diff

**Multi-floor + hydration**
- [x] Multi-floor selector (Basement / Main / Upper / Attic) — pill selector with room-count badge + version chip
- [x] Pick-floor-first UX for fresh jobs — 4 dashed preset slots, no auto-Main
- [x] `PickFloorModal` intercepts Wall / Door / Window / Trace / Opening / Cutout when no floor is active
- [x] Cross-floor room creation — picking a different Floor in the confirmation card merges into target canvas and switches active with no empty-state flash
- [x] Archived preview on job-detail anchors versions query on the job's pin (not `floorPlans[0]`)
- [x] Strict per-floor archived-job hydration — pin → own-created → empty (never falls through to `is_current`)
- [x] Read-only banner on archived jobs + wall context menu suppressed + empty preset pills disabled
- [x] Cross-floor corruption fixed — Case 2 update-in-place guards on `floor_plan_id` match

**Mobile UX**
- [x] Mobile bottom-sheet editors for door / window / opening / cutout / room (with swipe-to-close on the drag handle)
- [x] Full-bleed routes: `/jobs/<id>` + sub-routes (`/photos`, `/readings`, `/report`, `/timeline`, `/floor-plan`) hide mobile header + bottom nav
- [x] Instrument-panel toolbar: icon+label primary row (Select · Room · Wall · Door · Window · Delete · Damage · Undo · Redo)
- [x] Overflow `⋯` menu pinned at the right edge with an item-count badge (Trace · Opening · Cutout · Zoom in · Zoom out · Fit · Export PNG)
- [x] Shape picker bottom sheet (swipe-to-close)
- [x] Active-tool solid-orange pill with shadow
- [x] Stage one-finger pan unlocked for tap-based tools (select, delete, door, window, opening)
- [x] `touch-action: manipulation` on all mobile toolbar buttons (prevents iOS Safari double-tap-zoom eating re-taps)

**Testing**
- [x] Manual QA coverage — full matrix in "Cumulative Test Coverage" section at the end of this doc. Covers SF calculations (rectangle + polygon shapes, with and without cutouts, live-edit via direct W×H inputs), shared-wall detection, canvas ↔ walls sync, version upgrade / fork logic, archived-job hydration on multi-floor jobs, door/window/cutout placement and resize, mobile toolbar interactions, tap-to-deselect, full-bleed routes
- [ ] Automated test coverage (pytest + Vitest + Playwright) — deferred to a hardening pass

### Known Limitations (Phase 1 — non-blocking follow-ups)

Both items below were identified during manual QA and deferred. Neither blocks Phase 1 shipping or filing insurance claims — the real floor-plan editor and backend guards correctly isolate archived jobs per-floor.

1. **Archived preview thumbnail fallback.** `bestFloorPlan` in `web/src/app/(protected)/jobs/[id]/page.tsx` has a tier-3 fallback that returns any `is_current` floor's `canvas_data` when both the pin and `created_by_job_id` lookups miss — a safety net for legacy rows whose pins were lost to the pre-fix Case 3 bug. The real floor-plan editor explicitly blocks this fallback for archived jobs (`floor-plan/page.tsx:491–504`), so only the job-detail thumbnail preview can show stale content. Fix: run the pin-repair migration below, then remove tier 3 from `bestFloorPlan`.
   ```sql
   UPDATE jobs SET floor_plan_id = (
     SELECT id FROM floor_plans
     WHERE created_by_job_id = jobs.id
     ORDER BY version_number DESC LIMIT 1
   )
   WHERE floor_plan_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM floor_plans WHERE id = jobs.floor_plan_id);
   ```

2. **~~Race hardening in `_create_version`~~ — resolved.** C2 (migration `a1f2b9c4e5d6`) added the partial unique index. C4 (migration `b2c3d4e5f6a7`) moved flip+insert+pin into a single plpgsql RPC. R3 (round 2, migration `c7f8a9b0d1e2`) hardened that RPC with JWT-derived tenant checks + search_path. R4 (round 2, migration `d8e9f0a1b2c3`) added a BEFORE UPDATE trigger on `floor_plans` for DB-level frozen-row immutability.

4. **R19 legacy-version rollback — canvas-only.** Versions saved before round 2's `_relational_snapshot` helper landed don't carry the snapshot key in `canvas_data`. Rolling back to one of those versions restores the canvas blob but returns `restored=false` from the restore RPC — the relational `wall_segments` / `wall_openings` / `job_rooms.room_polygon` / `floor_openings` stay at their post-rollback state. The service layer logs a warning at WARNING level when this happens. Forward rollbacks (versions saved after R19) are full-fidelity. This is non-blocking — legacy data is still readable/renderable; the spec's "full fidelity" promise applies from R19 onward.

3. **Save-path HTTP call volume (nice-to-have optimization).** A single canvas edit currently fires 10–15 backend requests, dominated by the wall sync cycle (GET walls × N rooms + DELETE walls × M + POST walls × M for the edited room). The duplicate-PATCH and duplicate-refetch bugs that made it worse have been fixed (see phase2 commits `3efeba2`, `d2a640e`, `d670023`, `66eb243`, `051a096`, `1bab5d4`, `36ce8ad`, and the `["jobs"]` invalidation collapse), but the residual volume is structural — not a bug, just unoptimized.

   **Full breakdown per save (after current fixes):**
   - `POST /v1/floor-plans/:fpid/versions` — persist canvas (unavoidable)
   - `GET /v1/floor-plans/:fpid/versions` — refetch version history for UI
   - `GET /v1/jobs/:id` — refresh `floor_plan_id` after possible fork
   - `PATCH /v1/jobs/:id/rooms/:id × K` — room dims/cutouts/SF for affected rooms
   - `GET /v1/rooms/:roomId/walls × N` — idempotency check per room
   - `DELETE /v1/rooms/:roomId/walls/:wallId × M` — clean-slate for the edited room
   - `POST /v1/rooms/:roomId/walls × M` — recreate with new geometry
   - `GET /v1/jobs/:id/rooms` — final invalidation refetch

   **Optimization plan (in order of ROI):**

   a. **Bulk wall replace endpoint (biggest win).** New endpoint `PUT /v1/rooms/:id/walls` that accepts the full wall array, does the diff server-side in one transaction, returns the final state. Replaces `1 GET + M DELETE + M POST` (up to ~15 calls per edit) with **1 PUT**. Backend work: new service method + router, idempotent diff-and-patch logic, transaction boundary. Estimated effort: 1–2 days. Target: wall sync cycle drops from O(N) requests to O(1).

   b. **Use mutation responses instead of invalidation refetches.** Swap `queryClient.invalidateQueries` for `queryClient.setQueryData` after POST/PATCH mutations. Pre-requirement: backend responses must include enough data to populate the cache entry (e.g., POST `/versions` returns the new version AND the updated job snapshot if `floor_plan_id` changed). Eliminates the `GET /versions` and `GET /jobs/:id` refetches. Frontend is ~50 lines; backend is a response-schema enrichment. Estimated effort: 0.5 days per endpoint.

   c. **Bulk room PATCH endpoint.** `PATCH /v1/jobs/:id/rooms` with an array of `{id, ...changes}`. Replaces K separate PATCHes with one. Lower ROI than (a) because K is typically 1–3 per save; only worth bundling if (a) is already done and this is low-hanging. Estimated effort: 0.5 days.

   d. **Frontend wall cache (avoid the idempotency GET).** Subscribe to `["walls", roomId]` when a room mounts; after POST /versions, use `setQueryData` to update. The idempotency check then runs against the cache, not against the network. Pre-requirement: wall queries exist as first-class React Query entries (they don't today — wall sync uses `apiGet` directly). Lower priority.

   **Target after (a) + (b):** a full room-edit save drops from ~14 calls to ~4 (`POST /versions`, `PUT /walls`, single PATCH per room, no refetches). Worth doing before user load scales.

### Phase 2: Moisture Pins
- [x] `moisture_pins` table created — persistent spatial locations (canvas x/y, material, dry standard)
- [x] `moisture_pin_readings` table created — time-series reading values per pin
- [x] Pin drop on canvas tap with placement card: location descriptor, material type, reading value
- [x] Pin color: red (>10 percentage points above dry standard), amber (within 10 points), green (at/below)
- [x] Tap existing pin → enter new daily reading (pin shows latest color)
- [x] Pin history panel: chronological readings with sparkline trend chart
- [x] Regression detection: amber warning icon if reading increases day-over-day at the same pin
- [x] Room dry status: not dry until every pin in room is green
- [x] Dry standard lookup by material type (hardcoded constants, editable per-pin)
- [x] Per-reading delete affordance in the history panel with confirmation (single-tap trash → `ConfirmModal` → `DELETE /readings/{id}`; mid-delete row dims + disables to prevent double-fire)
- [x] Dry-standard-met milestone per Brett §8.5 — green checkmark + "Dry on Day N · date" chip in the reading sheet; same `dryMilestone` datum from `deriveReadingHistory` feeds the Dry Date column in the moisture-report summary table. Computed at read time via "first reading where value ≤ dry_standard"; never persisted as a column (so edits/deletes to readings automatically re-derive without sync work).
- [x] Structured location descriptor per Brett §8.3 — placement card's Surface + Position chips produce "Floor, Center, Kitchen" style descriptors. Auto date/time via `moisture_pin_readings.reading_date` (local-wall-clock per `todayLocalIso`); auto tech name via `moisture_pins.created_by` = session user.
- [x] **Location descriptor normalized into structured columns** (migration `e2b3c4d5f6a7`, 2026-04-26) — `moisture_pins.location_name` denormalized string replaced by `surface TEXT NOT NULL`, `position TEXT NULL`, `wall_segment_id UUID NULL REFERENCES wall_segments(id) ON DELETE SET NULL`. One-directional CHECK enforces wall-only segment binding (`wall_segment_id IS NULL OR surface = 'wall'`). RPC swap `create_moisture_pin_with_reading` (13 → 15 args, drops `p_location_name`, adds `p_surface`/`p_position`/`p_wall_segment_id`) carries cross-room binding check (lesson #30); `save_floor_plan_version` carries new wall_segment_id re-stamp on fork (lesson #29 extension). Backfilled from existing `location_name` strings; column dropped. Display string derived on the frontend via `formatPinLocation` helper in `web/src/lib/moisture-pin-location.ts` — single source of truth for canvas pin label, edit/reading sheet headers, and moisture-report summary table. Wall direction derived from geometry (wall midpoint vs. room centroid via arctan2 → 8 compass directions); works for any polygon shape (rectangle, L-shape, pentagon, octagon). 34 new tests (21 migration text-scan, 13 Pydantic invariant, 10 helper unit, +1 fork-restamp invariant row).
- [ ] Wall-segment picker UX in placement sheet — schema ready; surface=Wall pins currently save with `wall_segment_id=null` (CHECK explicitly allows the draft state). Follow-up PR adds auto-snap-to-nearest-wall (perpendicular-distance pick from the room's wall_segments) + confirmation chip so techs link the pin during placement.
- [x] Moisture Report View — shared component (§ Moisture Report View section) mounted at two routes:
  - Protected tech-facing print route `/jobs/[id]/moisture-report?date=YYYY-MM-DD&floor=<id>` with Print / Save PDF button and back-arrow (icon-only on mobile)
  - Public adjuster-portal route `/shared/[token]/moisture?date=YYYY-MM-DD&floor=<id>` with no print chrome
  - Floor picker in the header — canonical names (Basement / Main / Upper / Attic); shown disabled on single-floor jobs so the tech sees which floor they're viewing
  - User-selected snapshot date (Brett §8.6) via the Snapshot picker; picker options are the reading dates on the active floor
  - Canvas renders pins that existed at close of the selected snapshot date (pins whose first reading is after that date are hidden); pin colors computed via `computePinColorAsOf(readings, selectedDate, dry_standard)`
  - Summary table: Location · Material · Dry std · D1..DN columns · Dry Date (first-hit per pin); scoped to pins visible on the active floor and snapshot date
  - Entry points: "Open Moisture Report →" button on the Drying Progress card (job detail page)
  - Responsive canvas on mobile (fit-to-container with 9px pin radius below 500px viewport vs 13px desktop)
- [x] Sharing payload includes `moisture_pins` (with full readings array + floor_plan_id via PostgREST embed) + `floor_plans` (all floors on the property) (scope-gated: excluded on `photos_only`, included on `restoration_only` + `full`). Required for the adjuster-portal route above to render without requiring a PDF export (Brett §8.6).
- [x] `list_pins_by_job` endpoint now embeds readings and `job_rooms.floor_plan_id` on every pin via PostgREST foreign-table selects — eliminates the fragile client-side room→floor join that previously leaked pins across floors. `MoisturePinResponse` schema declares both fields so FastAPI doesn't strip them on serialization.
- [x] Room creation now passes `floor_plan_id` (the active canvas floor) on `POST /v1/jobs/:id/rooms`. Prior behavior silently stored rooms with `floor_plan_id = NULL`, which broke every per-floor consumer while the editor itself worked (the editor reads from `canvas_data`, not the relational column). Closes lesson #25.
- [x] Full test coverage: pin color boundaries (backend ✓), regression detection (backend ✓ + frontend ✓), dry standard lookup (backend ✓), reading-sheet derivation logic + integration flows (frontend ✓ — 33 pure unit tests + 12 RTL tests covering loading skeleton, last-reading guard, delete confirm flow, local-date prefill, edit wiring, read-only mode, dry-milestone, computePinColorAsOf), moisture-report view (frontend ✓ — 5 RTL tests covering multi-reading render, date picker change, per-date rollup, empty state, Dry Date column), sharing payload scope gating (backend ✓ — 3 tests: photos_only excludes moisture, restoration_only + full include pins + floor_plans, multi-floor listing order). **Total as of this sprint (post-review-round-2 fixes): 114 frontend vitest passes across 10 files, 61 backend pytest passes across the moisture + sharing suites (round-2 added the unavailable-discriminant + photos_only-primary_floor_id regression pins).**

### Phase 3: Equipment Pins
- [ ] `equipment_placements` table — one record per individual unit
- [ ] Equipment pin drop with placement card: type, quantity selector (auto-creates N records), auto-timestamp
- [ ] Equipment types: Air Mover, Dehumidifier, Air Scrubber, Hydroxyl Generator, Heater
- [ ] Pull Equipment workflow: tap pin → select N units to pull → auto-timestamp → N records marked pulled
- [ ] Canvas shows active equipment (colored icon) vs pulled (grayed out with checkmark)
- [ ] Duration calculation: placed_at to pulled_at (per unit)
- [ ] Duration feeds billing line items (quantity × days × rate)
- [ ] Full test coverage: individual unit creation, partial pulls, duration calc, billing integration

### Phase 4: Photo Pins & Gallery
- [ ] Photo category selection on upload (8 categories ENUM: damage, equipment_placement, drying_progress, before_demo, after_demo, pre_repair, post_repair, final_completion)
- [ ] Before/After pairing: "Updated condition photo?" prompt when room has existing photos
- [ ] `paired_photo_id` self-referential FK on photos
- [ ] Unplaced photos tray: batch shoot, assign rooms later, flagged until assigned
- [ ] Photo count badge per room on canvas (one "📷 14" badge, not individual pins)
- [ ] Backend photo summary endpoint: `GET /v1/jobs/{id}/photos/summary` returns per-room counts + latest thumbnail
- [ ] Category filtering in room gallery
- [ ] GPS auto-capture on upload (browser Geolocation API)
- [ ] Tech name attribution on upload (from login session)
- [ ] Full test coverage: category enum constraint, before/after pairing symmetry, summary counts

### Phase 5: Annotations + Version History UI
- [ ] `annotations` table — free-text notes anchored to canvas locations, job-scoped
- [ ] Annotation metadata: timestamp, tech name, include/exclude from reports toggle
- [ ] "Past annotations at this property (N)" badge on canvas — expandable to show historical annotations from prior jobs
- [ ] Version history panel accessible from toolbar
- [ ] Version list shows: version number, created_by_job, change_summary, created_at
- [ ] Version rollback (admin-only) with confirmation step
- [ ] Full test coverage: version creation on first save, version freeze on archive, rollback logic

---

## DECISIONS (Locked During Eng Review 2026-04-16)

These 17 decisions are the contract for implementation. Any deviation requires re-review.

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Use existing properties table + API | Already has more fields than Brett's spec version. Don't duplicate. |
| 2 | Clean cut, no backward compat | No production data exists. Transition code is dead weight. |
| 3 | Job-driven versioning (not auto-save versioning) | Business-meaningful versions. Each job = one version. Archive freezes it. |
| 4 | Active jobs auto-upgrade to latest version | Simpler UX. Two active jobs at same property is rare. |
| 5 | New `moisture_pins` + `moisture_pin_readings` tables | Matches Brett's mental model: persistent pin tracked over days. Current reading-per-day model doesn't fit. |
| 6 | Relational `wall_segments` + `wall_openings` tables | Xactimate needs queryable wall data. Walls drive material codes. |
| 7 | Hardcoded ceiling multipliers + per-room custom override | Default values work for most cases. Override for unusual geometry until LiDAR. |
| 8 | Individual unit records for equipment | Clean billing. 6 air movers = 6 records. UI handles friction via quantity picker. |
| 9 | Clean canvas wipe, gridSize=10 | 10px = 6 inches matches Brett's snap grid. No migration needed (no prod data). |
| 10 | Photo categories as ENUM (8 values) | Type safety wins. Migration to extend is 5 minutes. |
| 11 | Backend photo summary endpoint | Scales to 500+ photos per job. Canvas renders badges from summary. |
| 12 | Full room snap + shared wall auto-detection in Phase 1 | Wrong SF = wrong Xactimate quantities = denied claims. Must work correctly from start. |
| 13 | Merge rectangle + polygon into single data model | `points: [{x,y}]` handles both. Rectangles are 4-point polygons. 30-40% of rooms are non-rectangular. |
| 14 | One version per job session | First save creates version. Subsequent saves update it. Archive freezes. Clean. |
| 15 | Annotations job-scoped with historical badge | Fresh slate per job, historical context available on demand. |
| 16 | LiDAR moves to future spec | Not V1 or V2 scope. V1 data model accommodates it (polygon dimensions + materials). |
| 17 | Full test coverage per phase | Spec 01 set the bar at 489+ tests. No regression. |

---

## Database Schema

### Phase 1A: Floor Plan Reparenting + Versioning

> **Live schema — unified.** Lakshman's peer-review (Session 3) collapsed the
> two-table design (`floor_plans` container + `floor_plan_versions`) into a
> single unified `floor_plans` table where each row IS a versioned snapshot.
> Migration `e1a7c9b30201_spec01h_merge_floor_plans_versions.py`. The SQL
> below reflects the CURRENT live schema.

```sql
-- Unified floor_plans table: each row is a versioned snapshot of a floor
-- at a property. The container/versions split that was originally specced
-- was removed in Session 3 — it wrote canvas_data twice on every save and
-- served only as grouping metadata.
CREATE TABLE floor_plans (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id        UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    floor_number       INTEGER NOT NULL,
    floor_name         TEXT NOT NULL,
    thumbnail_url      TEXT,
    version_number     INTEGER NOT NULL,
    canvas_data        JSONB NOT NULL,
    created_by_job_id  UUID REFERENCES jobs(id) ON DELETE SET NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    change_summary     TEXT,   -- e.g., "Job 2026-04-JOB-0042 modified floor plan"
    is_current         BOOLEAN NOT NULL DEFAULT true,  -- flipped false on fork
    company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(property_id, floor_number, version_number)
);

CREATE INDEX idx_floor_plans_property       ON floor_plans(property_id);
CREATE INDEX idx_floor_plans_property_floor ON floor_plans(property_id, floor_number);
CREATE INDEX idx_floor_plans_is_current     ON floor_plans(property_id, floor_number)
    WHERE is_current = true;
CREATE INDEX idx_floor_plans_created_by_job ON floor_plans(created_by_job_id)
    WHERE created_by_job_id IS NOT NULL;

-- RLS: tenant-scoped via property's company
ALTER TABLE floor_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY floor_plans_tenant ON floor_plans USING (
    company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid
);

-- Pin a job to a specific version (scalar — one pin per job, the job's
-- last-saved floor). Per-floor hydration for multi-floor jobs relies on
-- the `created_by_job_id` column on floor_plans as a secondary tier.
ALTER TABLE jobs ADD COLUMN floor_plan_id UUID REFERENCES floor_plans(id) ON DELETE SET NULL;
CREATE INDEX idx_jobs_floor_plan ON jobs(floor_plan_id) WHERE floor_plan_id IS NOT NULL;
```

**Versioning state machine:**

```
Job A opens floor plan for Property X
  ├── No versions exist yet → create version 1, pin Job A to v1
  └── Version exists → pin Job A to latest

Job A edits floor plan
  ├── Job A's pinned version was created by Job A → update in place
  └── Job A's pinned version was created by another job → create new version, pin Job A to it

Job A is archived/submitted
  └── Job A stays pinned to its version forever (read-only)

Job B opens floor plan (Job A still active on same property)
  └── Job B pins to latest version (could be Job A's current version)

Job A creates new version v2 (while Job B active)
  └── Job B auto-upgrades to v2 on next canvas load (active job behavior)
```

### Phase 1B: Room + Wall Enhancements

```sql
-- Rooms — note actual table name is job_rooms (not "rooms")
ALTER TABLE job_rooms ADD COLUMN room_type TEXT
    CHECK (room_type IS NULL OR room_type IN (
        'living_room', 'kitchen', 'bathroom', 'bedroom', 'basement',
        'hallway', 'laundry_room', 'garage', 'dining_room', 'office',
        'closet', 'utility_room', 'other'
    ));

ALTER TABLE job_rooms ADD COLUMN ceiling_type TEXT NOT NULL DEFAULT 'flat'
    CHECK (ceiling_type IN ('flat', 'vaulted', 'cathedral', 'sloped'));

ALTER TABLE job_rooms ADD COLUMN floor_level TEXT
    CHECK (floor_level IS NULL OR floor_level IN ('basement', 'main', 'upper', 'attic'));

ALTER TABLE job_rooms ADD COLUMN affected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_rooms ADD COLUMN material_flags JSONB NOT NULL DEFAULT '[]';
ALTER TABLE job_rooms ADD COLUMN wall_square_footage DECIMAL(10,2);  -- calculated, stored for reporting
ALTER TABLE job_rooms ADD COLUMN custom_wall_sf DECIMAL(10,2);       -- tech override for unusual geometry
ALTER TABLE job_rooms ADD COLUMN room_polygon JSONB;                  -- [{x,y}, ...] for non-rectangular rooms
ALTER TABLE job_rooms ADD COLUMN floor_openings JSONB NOT NULL DEFAULT '[]';  -- [{x,y,width,height}, ...]

-- Walls (relational, not JSONB)
CREATE TABLE wall_segments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id           UUID NOT NULL REFERENCES job_rooms(id) ON DELETE CASCADE,
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    x1                DECIMAL(8,2) NOT NULL,
    y1                DECIMAL(8,2) NOT NULL,
    x2                DECIMAL(8,2) NOT NULL,
    y2                DECIMAL(8,2) NOT NULL,
    wall_type         TEXT NOT NULL DEFAULT 'interior'
                      CHECK (wall_type IN ('exterior', 'interior')),
    wall_height_ft    DECIMAL(5,2),  -- nullable, inherits from room.height_ft
    affected          BOOLEAN NOT NULL DEFAULT false,
    shared            BOOLEAN NOT NULL DEFAULT false,  -- auto-detected, excluded from perimeter LF
    shared_with_room_id UUID REFERENCES job_rooms(id) ON DELETE SET NULL,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_walls_room ON wall_segments(room_id);
CREATE INDEX idx_walls_company ON wall_segments(company_id);

ALTER TABLE wall_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY walls_tenant ON wall_segments USING (
    company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid
);

-- Wall openings (doors, windows, missing walls)
CREATE TABLE wall_openings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wall_id         UUID NOT NULL REFERENCES wall_segments(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    opening_type    TEXT NOT NULL CHECK (opening_type IN ('door', 'window', 'missing_wall')),
    position        DECIMAL(4,3) NOT NULL CHECK (position >= 0 AND position <= 1),  -- 0-1 parametric along wall
    width_ft        DECIMAL(5,2) NOT NULL CHECK (width_ft > 0),
    height_ft       DECIMAL(5,2) NOT NULL CHECK (height_ft > 0),  -- default 7 for door, 4 for window, wall height for missing_wall
    sill_height_ft  DECIMAL(5,2),  -- windows only, optional
    swing           INTEGER CHECK (swing IS NULL OR swing IN (0, 1, 2, 3)),  -- doors only, 4-quadrant
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_openings_wall ON wall_openings(wall_id);
CREATE INDEX idx_openings_company ON wall_openings(company_id);

ALTER TABLE wall_openings ENABLE ROW LEVEL SECURITY;
CREATE POLICY openings_tenant ON wall_openings USING (
    company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid
);
```

**Ceiling type multipliers (backend constants, not in DB):**

| Ceiling Type | Multiplier | Use |
|-------------|------------|-----|
| flat | 1.0 | Standard — wall SF unchanged |
| vaulted | 1.3 | Extra wall area from vault curve |
| cathedral | 1.5 | Peaked ceiling, maximum extra area |
| sloped | 1.2 | Slight pitch, minor extra area |

If tech sets `custom_wall_sf` on a room, it overrides the calculated value.

### Phase 2: Moisture Pins

```sql
-- Persistent spatial pins (job-scoped, tracked across days)
CREATE TABLE moisture_pins (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id           UUID REFERENCES job_rooms(id) ON DELETE SET NULL,
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    canvas_x          DECIMAL(8,2) NOT NULL,
    canvas_y          DECIMAL(8,2) NOT NULL,
    location_name     TEXT NOT NULL,  -- e.g., "Floor, NW Corner, Living Room"
    material          TEXT NOT NULL,  -- drives dry_standard lookup
    dry_standard      DECIMAL(6,2) NOT NULL,  -- can be overridden per-pin
    created_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pins_job ON moisture_pins(job_id);
CREATE INDEX idx_pins_room ON moisture_pins(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX idx_pins_company ON moisture_pins(company_id);

ALTER TABLE moisture_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY pins_tenant ON moisture_pins USING (
    company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid
);

-- Time-series readings at each pin
CREATE TABLE moisture_pin_readings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id            UUID NOT NULL REFERENCES moisture_pins(id) ON DELETE CASCADE,
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    reading_value     DECIMAL(6,2) NOT NULL,
    reading_date      DATE NOT NULL,
    recorded_by       UUID REFERENCES users(id),
    meter_photo_url   TEXT,
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_pin_reading_date ON moisture_pin_readings(pin_id, reading_date);
CREATE INDEX idx_pin_readings_company ON moisture_pin_readings(company_id);

ALTER TABLE moisture_pin_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY pin_readings_tenant ON moisture_pin_readings USING (
    company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid
);
```

**Dry standard defaults by material (hardcoded backend constants):**

| Material | Dry Standard | Notes |
|----------|-------------|-------|
| drywall | 16% | Moisture content |
| wood_subfloor | 15% | |
| carpet_pad | 16% | |
| concrete | 5% | |
| hardwood | 12% | |
| osb_plywood | 18% | |
| block_wall | 10% | |
| tile | N/A | Not absorbent, no moisture reading |

**Pin color logic (10 percentage points above standard):**

```python
def pin_color(reading: float, dry_standard: float) -> str:
    if reading <= dry_standard:
        return "green"
    if reading <= dry_standard + 10:
        return "amber"
    return "red"
```

**Regression detection (frontend-only, visual flag):**

```python
# At pin render time, compare latest two readings
if latest.reading_value > previous.reading_value:
    show_regression_warning = True
```

**Moisture PDF export:** Server-side endpoint generates single-page PDF with:
- Floor plan snapshot with all pin locations
- Color-coded pins for user-selected date
- Summary table: every pin, material type, all daily readings, dry standard met date
- Generated via existing PDF library (html → pdf pipeline already in place for job reports)

### Phase 3: Equipment Placements

```sql
-- One record per individual unit (not quantity-based)
CREATE TABLE equipment_placements (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id           UUID REFERENCES job_rooms(id) ON DELETE SET NULL,
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    floor_plan_id     UUID REFERENCES floor_plans(id) ON DELETE SET NULL,
    equipment_type    TEXT NOT NULL CHECK (equipment_type IN (
        'air_mover', 'dehumidifier', 'air_scrubber', 'hydroxyl_generator', 'heater'
    )),
    canvas_x          DECIMAL(8,2),
    canvas_y          DECIMAL(8,2),
    placed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    pulled_at         TIMESTAMPTZ,     -- null = still active
    placed_by         UUID REFERENCES users(id),
    pulled_by         UUID REFERENCES users(id),
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_equip_job ON equipment_placements(job_id);
CREATE INDEX idx_equip_active ON equipment_placements(job_id) WHERE pulled_at IS NULL;
CREATE INDEX idx_equip_company ON equipment_placements(company_id);

ALTER TABLE equipment_placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY equip_tenant ON equipment_placements USING (
    company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid
);
```

**Placement UX:** Tech taps "Place 6 air movers in Living Room" → backend creates 6 records at the same canvas coordinate. Pull workflow: tech taps pin cluster → selects N units to pull → auto-timestamps N records.

**Duration calculation (application-level):**
```python
duration_days = ceil((pulled_at - placed_at) / timedelta(days=1))
billing_amount = duration_days * equipment_rate_per_day
```

### Phase 4: Photo Enhancements

```sql
-- Update photo_type ENUM — clean cut, no backward compat
ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_photo_type_check;
ALTER TABLE photos ADD CONSTRAINT photos_photo_type_check CHECK (
    photo_type IN (
        'damage', 'equipment_placement', 'drying_progress',
        'before_demo', 'after_demo', 'pre_repair', 'post_repair', 'final_completion'
    )
);

-- Before/After pairing (self-referential)
ALTER TABLE photos ADD COLUMN paired_photo_id UUID REFERENCES photos(id) ON DELETE SET NULL;

-- GPS auto-capture
ALTER TABLE photos ADD COLUMN latitude DOUBLE PRECISION;
ALTER TABLE photos ADD COLUMN longitude DOUBLE PRECISION;

-- Tech attribution
ALTER TABLE photos ADD COLUMN uploaded_by UUID REFERENCES users(id);

-- Index for photo summary queries
CREATE INDEX idx_photos_job_room ON photos(job_id, room_id) WHERE room_id IS NOT NULL;
```

### Phase 5: Annotations

```sql
CREATE TABLE annotations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    floor_plan_id     UUID NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    canvas_x          DECIMAL(8,2) NOT NULL,
    canvas_y          DECIMAL(8,2) NOT NULL,
    text              TEXT NOT NULL CHECK (length(text) > 0 AND length(text) <= 2000),
    created_by        UUID NOT NULL REFERENCES users(id),
    include_in_report BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_annotations_floor_plan ON annotations(floor_plan_id);
CREATE INDEX idx_annotations_job ON annotations(job_id);
CREATE INDEX idx_annotations_company ON annotations(company_id);

ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY annotations_tenant ON annotations USING (
    company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid
);
```

**Historical badge:** Canvas queries annotations from prior jobs at the same property (via floor_plan_id → property_id → all jobs at that property). Shows badge "Past annotations (N)" — expandable to read-only view.

---

## API Endpoints

### Floor Plans (Property-Scoped)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/properties/{propertyId}/floor-plans` | Member | List floor plans (one per floor) |
| POST | `/v1/properties/{propertyId}/floor-plans` | Member | Create floor plan (one per floor_number) |
| PATCH | `/v1/properties/{propertyId}/floor-plans/{id}` | Member | Update floor plan metadata |
| DELETE | `/v1/properties/{propertyId}/floor-plans/{id}` | Admin | Hard delete (cascades versions) |
| GET | `/v1/jobs/{jobId}/floor-plans` | Member | Resolves via `job.property_id`, returns property-level floor plans + job's pinned version |

### Floor Plan Versions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/floor-plans/{id}/versions` | Member | List version history |
| GET | `/v1/floor-plans/{id}/versions/{versionNumber}` | Member | Get specific version (read-only) |
| POST | `/v1/floor-plans/{id}/versions` | Member | Save canvas changes — auto-creates new version if job's pinned version was created by another job, otherwise updates job's existing version |
| POST | `/v1/floor-plans/{id}/versions/{versionNumber}/rollback` | Admin | Rollback: marks this version as current, creates new version from rollback target for current job |

**Save logic in service layer:**

```python
async def save_canvas(job_id, floor_plan_id, canvas_data):
    job = await get_job(job_id)
    pinned_version = await get_version(job.floor_plan_version_id)
    
    if pinned_version.created_by_job_id == job_id:
        # Job is updating its own version
        await update_version(pinned_version.id, canvas_data)
    else:
        # Job is editing someone else's version → fork
        new_version = await create_version(
            floor_plan_id=floor_plan_id,
            canvas_data=canvas_data,
            created_by_job_id=job_id,
            version_number=pinned_version.version_number + 1,
        )
        await mark_supersedes_current(floor_plan_id, new_version.id)
        await pin_job_to_version(job_id, new_version.id)
        # Auto-upgrade all active (non-archived) jobs at this property
        await upgrade_active_jobs(floor_plan_id, new_version.id)
```

### Rooms (Modified)

Pydantic schema additions:

```python
class RoomCreate(BaseModel):
    room_name: str
    floor_plan_id: UUID | None = None
    length_ft: Decimal | None = None
    width_ft: Decimal | None = None
    height_ft: Decimal = Decimal("8.0")
    room_type: Literal[
        "living_room", "kitchen", "bathroom", "bedroom", "basement",
        "hallway", "laundry_room", "garage", "dining_room", "office",
        "closet", "utility_room", "other"
    ] | None = None
    ceiling_type: Literal["flat", "vaulted", "cathedral", "sloped"] = "flat"
    floor_level: Literal["basement", "main", "upper", "attic"] | None = None
    material_flags: list[str] = []
    affected: bool = False
    room_polygon: list[dict] | None = None  # [{x,y}, ...] for non-rectangular
    floor_openings: list[dict] = []          # [{x,y,width,height}, ...]
    custom_wall_sf: Decimal | None = None
    # Existing fields unchanged
    water_category: str | None = None
    water_class: str | None = None
    dry_standard: Decimal | None = None
```

### Wall Segments (New)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/rooms/{roomId}/walls` | Member | List walls for a room |
| POST | `/v1/rooms/{roomId}/walls` | Member | Create wall segment |
| PATCH | `/v1/rooms/{roomId}/walls/{id}` | Member | Update wall (coords, type, affected, shared) |
| DELETE | `/v1/rooms/{roomId}/walls/{id}` | Member | Delete wall |
| POST | `/v1/rooms/{roomId}/walls/{id}/openings` | Member | Add door/window/missing_wall |
| PATCH | `/v1/rooms/{roomId}/walls/{wallId}/openings/{id}` | Member | Update opening |
| DELETE | `/v1/rooms/{roomId}/walls/{wallId}/openings/{id}` | Member | Delete opening |

All list endpoints return `{items: [...], total: N}` (matching existing convention — see prior learning on `paginated-response-shape-mismatch`).

### Moisture Pins (New)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/jobs/{jobId}/moisture-pins` | Member | List pins with latest reading + color |
| POST | `/v1/jobs/{jobId}/moisture-pins` | Member | Create pin + initial reading |
| PATCH | `/v1/jobs/{jobId}/moisture-pins/{id}` | Member | Update pin metadata (material, dry_standard, location_name) |
| DELETE | `/v1/jobs/{jobId}/moisture-pins/{id}` | Member | Delete pin (cascades readings) |
| GET | `/v1/jobs/{jobId}/moisture-pins/{id}/readings` | Member | List all readings for trend chart |
| POST | `/v1/jobs/{jobId}/moisture-pins/{id}/readings` | Member | Add new reading (one per day per pin enforced) |
| PATCH | `/v1/jobs/{jobId}/moisture-pins/{id}/readings/{readingId}` | Member | Edit reading value |
| DELETE | `/v1/jobs/{jobId}/moisture-pins/{id}/readings/{readingId}` | Member | Delete reading |
| GET | `/v1/jobs/{jobId}/moisture-pdf` | Member | Export moisture floor plan PDF |

### Equipment Placements (New)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/jobs/{jobId}/equipment-placements` | Member | List placements (active + pulled) |
| POST | `/v1/jobs/{jobId}/equipment-placements` | Member | Place equipment (accepts `quantity`, creates N records) |
| PATCH | `/v1/jobs/{jobId}/equipment-placements/{id}` | Member | Update placement |
| POST | `/v1/jobs/{jobId}/equipment-placements/pull` | Member | Pull N units from a pin cluster (body: `{placement_ids: [...]}` or `{pin_cluster_key, count}`) |

**Place N units:**
```python
# POST /v1/jobs/{jobId}/equipment-placements
# Body: {equipment_type: "air_mover", quantity: 6, room_id: ..., canvas_x: 120, canvas_y: 80}
# Creates 6 records at the same canvas coordinate.
```

**Pull N units:**
```python
# POST /v1/jobs/{jobId}/equipment-placements/pull
# Body: {placement_ids: ["uuid1", "uuid2"]}  # explicit unit selection
# OR: {room_id: ..., equipment_type: "air_mover", count: 2}  # pull 2 of this type from room
# Auto-timestamps pulled_at on selected records.
```

### Photo Summary (New)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/jobs/{jobId}/photos/summary` | Member | Per-room photo counts for canvas badges |

```python
class PhotoSummaryResponse(BaseModel):
    rooms: list[RoomPhotoSummary]  # one per room with photos
    unplaced_count: int

class RoomPhotoSummary(BaseModel):
    room_id: UUID
    count: int
    latest_photo_url: str
    latest_photo_thumbnail_url: str | None
    categories_present: list[str]  # for filter chips in gallery
```

### Annotations (New)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/floor-plans/{id}/annotations` | Member | List annotations for current job |
| GET | `/v1/floor-plans/{id}/annotations/historical` | Member | List annotations from prior jobs at this property |
| POST | `/v1/floor-plans/{id}/annotations` | Member | Create annotation |
| PATCH | `/v1/floor-plans/{id}/annotations/{id}` | Member | Update text or include_in_report |
| DELETE | `/v1/floor-plans/{id}/annotations/{id}` | Member | Delete annotation |

---

## Canvas Data Model

### V2 FloorPlanData (in `floor_plan_versions.canvas_data`)

```typescript
interface FloorPlanData {
  gridSize: 10;                     // 10px = 6 inches
  rooms: RoomCanvasData[];          // rendering hints, structural data in DB
  walls: WallCanvasData[];          // rendering hints, structural data in DB
  // Note: doors, windows, openings stored relationally in wall_openings table.
  // Canvas fetches on load and renders from that data.
}

interface RoomCanvasData {
  id: string;              // matches job_rooms.id
  points: Array<{x: number, y: number}>;  // polygon vertices (rectangles are 4 points)
  name: string;
  fill: string;
  // Room metadata (type, ceiling, materials, affected) lives in job_rooms table.
  // Canvas does NOT duplicate — renders by joining with DB room data.
}

interface WallCanvasData {
  id: string;              // matches wall_segments.id
  // Coords, type, affected, shared all live in wall_segments table.
  // Canvas renders from DB, not from this JSONB.
}
```

**Why canvas_data is now minimal:** Rendering logic reads authoritative data from relational tables (rooms, walls, openings, pins, equipment, annotations). Canvas JSONB is just IDs + cached rendering hints. This means:
- Data is queryable from backend (Xactimate, reports, portal)
- Canvas is a renderer, not the source of truth
- Versioning captures the snapshot of relational state at that point in time

**Version snapshot strategy:** When creating a new floor plan version, the backend snapshots room + wall + opening data into the `canvas_data` JSONB alongside IDs. This gives the version full fidelity (so rolling back works) while live editing uses relational tables.

---

## SF Calculation Logic

### Floor SF

```typescript
function calculateFloorSF(room: Room): number {
  // Polygon area via shoelace formula
  const points = room.room_polygon || rectangleToPoints(room);
  const grossSF = Math.abs(shoelaceArea(points)) / (gridSize * gridSize);
  const openingSF = room.floor_openings.reduce(
    (sum, o) => sum + (o.width / gridSize) * (o.height / gridSize),
    0
  );
  return grossSF - openingSF;
}

function shoelaceArea(points: Array<{x: number, y: number}>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}
```

### Wall SF

```typescript
const CEILING_MULTIPLIERS = {
  flat: 1.0,
  vaulted: 1.3,
  cathedral: 1.5,
  sloped: 1.2,
};

function calculateWallSF(room: Room, walls: Wall[], openings: Opening[]): number {
  // If tech provided a custom override, use it
  if (room.custom_wall_sf != null) return room.custom_wall_sf;
  
  // Perimeter LF — EXCLUDE shared walls (counted in the other room)
  const roomWalls = walls.filter(w => w.room_id === room.id && !w.shared);
  const perimeterLF = roomWalls.reduce((sum, w) => {
    const lengthPx = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    return sum + lengthPx / gridSize;
  }, 0);

  // Gross wall area
  const grossSF = perimeterLF * room.height_ft;

  // Opening deductions — match by wall_id, not room_id
  const wallIds = new Set(roomWalls.map(w => w.id));
  const openingSF = openings
    .filter(o => wallIds.has(o.wall_id))
    .reduce((sum, o) => sum + o.width_ft * o.height_ft, 0);

  const netSF = grossSF - openingSF;
  const multiplier = CEILING_MULTIPLIERS[room.ceiling_type];
  return Math.round(netSF * multiplier * 10) / 10;
}
```

**Worked example — Kitchen 12×10, 8ft flat ceiling, shares one wall with adjacent Hallway, has 3ft door and 4ft window:**

```
Walls: 4 total, 1 marked shared (excluded)
Perimeter LF (excluding shared): 12 + 12 + 10 = 34 LF
Gross wall SF: 34 × 8 = 272 SF
Door deduction: 3 × 7 = 21 SF
Window deduction: 4 × 4 = 16 SF
Net SF: 272 - 21 - 16 = 235 SF
Multiplier (flat): 1.0
Final wall SF: 235 SF
```

---

## Room Type → Material Defaults

When a room type is selected, these material flags auto-populate in the confirmation card:

| Room Type | Default Material Flags |
|-----------|----------------------|
| living_room | `["carpet", "drywall", "paint"]` |
| kitchen | `["tile", "drywall", "paint", "backsplash"]` |
| bathroom | `["tile", "drywall", "paint"]` |
| bedroom | `["carpet", "drywall", "paint"]` |
| basement | `["concrete", "drywall"]` |
| hallway | `["carpet", "drywall", "paint"]` |
| laundry_room | `["tile", "drywall", "paint"]` |
| garage | `["concrete"]` |
| dining_room | `["hardwood", "drywall", "paint"]` |
| office | `["carpet", "drywall", "paint"]` |
| closet | `["carpet", "drywall"]` |
| utility_room | `["concrete", "drywall"]` |
| other | `[]` |

Defaults are editable — tech can add/remove flags on the confirmation card. For rooms with multiple common floor types (kitchen = tile OR vinyl), present the first option by default; tech can swap.

---

## Canvas Toolbar

Primary actions (always visible):

| Tool | Icon | Behavior |
|------|------|----------|
| Add Room | Rectangle + plus | Drops 10×10 default OR enters Trace Mode |
| Moisture Mode | Droplet | Toggles moisture pin layer |
| Equipment Mode | Fan | Toggles equipment pin layer |
| Photo Mode | Camera | Toggles photo badges + upload |
| Affected Mode | Alert | Overlay: highlights affected rooms/walls in red |
| Floor Selector | Stack | Dropdown: Basement / Main / Upper / Attic |

Secondary actions (menu):

| Action | Behavior |
|--------|----------|
| Zoom In / Out | Pinch or buttons |
| Reset View | Fit all to screen |
| Version History | Opens version history panel |
| Export Floor Plan PDF | Full floor plan with scale |
| Export Moisture PDF | Single-page carrier doc with pin colors |
| Toggle Grid | Show/hide 6-inch grid |

---

## Affected Mode

Toggle in toolbar. When active:
- All rooms with `affected=true` render with red tint fill
- All walls with `affected=true` render with red stroke
- Unaffected rooms/walls render with reduced opacity (40%)
- Moisture pins and equipment stay at full opacity (they're by definition in affected areas)

Purpose: quick visual confirmation of scope boundaries. Tech can tap an affected toggle on any room or wall to flip it.

---

## Floor Openings

Floor cutouts that reduce floor SF (stairwells, HVAC chases, laundry chutes).

Stored per-room in `job_rooms.floor_openings` JSONB array:
```json
[
  {"id": "op-1", "x": 50, "y": 40, "width": 30, "height": 30}
]
```

UX: Tech taps inside a room → "Add Floor Opening" → drags out rectangle → opening subtracts from floor SF. Common in two-story water losses where the stairwell is the moisture migration path.

Rendered on canvas as dashed rectangle with "Opening" label.

---

## Moisture Report View (PDF + Adjuster Portal)

Per Brett §8.6, *"the moisture floor plan exports as a single-page PDF for carrier documentation… This document is available in the adjuster portal without requiring a PDF export."* One rendered view, two mount points:

- **Tech-facing print route** — `/jobs/[id]/moisture-report?date=YYYY-MM-DD` — protected route with a **Print / Save PDF** button that calls `window.print()`. Matches Phase 1's existing `jobs/[id]/report` pattern — no server-side PDF library, no backend endpoint. The date query param drives the color snapshot; default is today.
- **Adjuster-facing portal route** — `/shared/[token]/moisture?date=YYYY-MM-DD` — public route mounted via the existing share-link flow (read-only, no auth). Same view, no print chrome.

### Output contents (identical across both mount points)

1. **Header** — Company logo, job number, property address, date-of-snapshot selector (dropdown of all reading dates in the job, defaulting to latest).
2. **Floor plan** — rasterized Konva stage with all moisture pins at their saved coordinates. Pin colors reflect the selected snapshot date (not "current latest") so historical snapshots are reproducible.
3. **Pin overlay** — each pin shows its reading value for the selected date + color-coded dot (red/amber/green).
4. **Dry-standard-met milestone** — per Brett §8.5, *"green checkmark appears when dry standard is met — with the date it was achieved."* Shown inline in the summary table's `Dry Date` column and as a summary strip at the top ("3 of 7 pins dry as of Apr 22").
5. **Summary table:**

| Pin Location | Material | Dry Standard | Day 1 | Day 2 | Day 3 | ... | Dry Date |
|-------------|----------|-------------|-------|-------|-------|-----|----------|
| Floor, NW Corner, Living Room | drywall | 16% | 38% | 32% | 24% | ... | Apr 22 (Day 5) |

Dry-date semantics: the **first** date the pin reached the dry standard — not the most recent. Regressions after initial dry-date do not reset the milestone (carrier documentation needs to prove "drying was achieved," and a regression is captured separately via the amber flag per §8.5).

### Shared-view architecture

```
web/src/components/moisture-report/
  moisture-report-view.tsx       ← the actual view (Konva + overlay + summary table)
  moisture-report-date-picker.tsx ← user-selected snapshot date (Brett 8.6)

web/src/app/(protected)/jobs/[id]/moisture-report/page.tsx
  ← protected wrapper + Print button + print CSS                (Task 6)

web/src/app/(marketing)/shared/[token]/moisture/page.tsx
  ← public adjuster-portal wrapper, no print chrome             (Task 7)
```

Reuses: `moisture-reading-history.ts` (derivation), `moisture-room-status.ts` (room rollup), `canvas-room-resolver.ts` (name-match safety), `@/lib/dates` (local-wall-clock date display).

---

## Sparkline Trend Chart

Frontend-only feature. When a tech taps a moisture pin, side panel opens with:

1. **Pin metadata:** location, material, dry standard
2. **Reading history table:** date, value, tech name, status color
3. **Sparkline chart:** line chart of reading value over time, with horizontal dashed line at dry standard
4. **Regression warning:** if latest > previous, amber triangle icon with tooltip "Reading increased day-over-day"

Implementation: lightweight SVG sparkline (no chart library needed — the data is always <30 points). Uses existing pin reading data from `GET /v1/jobs/{jobId}/moisture-pins/{id}/readings`.

---

## LiDAR — Future Spec

LiDAR-assisted input (Apple RoomPlan / Locometric) is explicitly **out of scope** for this spec. It will be speced separately as a future enhancement.

**Why V1 data model accommodates it:** Room dimensions, ceiling height, wall segments, openings — all stored as structured data. LiDAR is just an alternative input method that fills these same fields.

**Verisk ESX integration** (direct Xactimate export) requires formal Verisk Strategic Alliance partnership — not V1, V2, or V3.

---

## Frontend-Only Changes (No Backend Impact)

These items are UI-only and don't require schema or API changes beyond what's already listed:

- Canvas grid visual (6-inch dotted lines)
- Room confirmation card modal
- Room type dropdown with material default population
- Wall contextual menu (appears on wall tap)
- Moisture mode toggle + pin overlay
- Equipment mode toggle + icon overlay
- Affected mode overlay (highlights from existing `affected` field)
- Sparkline trend chart (reads from existing pin readings endpoint)
- Version history panel (reads from existing versions endpoint)
- Floor selector dropdown

---

## Data Storage Split

| Data | Where | Why |
|------|-------|-----|
| Room polygon points | `job_rooms.room_polygon` JSONB | Variable length, not individually queried |
| Room metadata (type, ceiling, materials, affected) | `job_rooms` table columns | Queried by estimating engine, reports, portal |
| Wall geometry + metadata | `wall_segments` table | Xactimate needs queryable wall data |
| Wall openings (doors/windows/missing) | `wall_openings` table | Queried for SF calculations, materials |
| Floor openings | `job_rooms.floor_openings` JSONB | Simple cutouts, not independently queried |
| Moisture pins + readings | `moisture_pins` + `moisture_pin_readings` | Trend charts, PDF export, portal |
| Equipment placements | `equipment_placements` table | Billing, duration tracking, reports |
| Photo metadata | `photos` table (extended) | Gallery, portal, category filtering |
| Annotations | `annotations` table | Reports, portal, historical view |
| Canvas rendering hints | `floor_plan_versions.canvas_data` JSONB | Visual-only, cached from relational state |

**Rule:** If queried independently or has its own history → backend table. If purely visual rendering → canvas_data JSON.

---

## Testing Requirements

Spec 01 set the bar: 489 backend tests + 29 frontend tests. This spec targets similar coverage per phase.

### Backend (pytest)

**Phase 1:**
- `test_property_auto_creation_on_job_create` — race condition when two jobs created simultaneously at same address
- `test_floor_plan_reparent_migration` — existing job-scoped floor plans migrate to property scope
- `test_version_create_on_first_save` — job's first save creates version
- `test_version_update_on_same_job_save` — subsequent saves update existing version, not create new
- `test_version_fork_on_other_job_edit` — editing another job's version forks into new version
- `test_active_jobs_auto_upgrade` — active jobs see new version after another job's edit
- `test_archived_jobs_frozen` — archived job stays on its pinned version
- `test_sf_calculation_floor_polygon` — shoelace area formula correct for irregular rooms
- `test_sf_calculation_wall_with_shared` — shared walls excluded from perimeter LF
- `test_sf_calculation_with_ceiling_multiplier` — each ceiling type applied correctly
- `test_sf_calculation_with_custom_override` — custom_wall_sf overrides calculated value
- `test_shared_wall_auto_detection` — walls within 20px of each other marked shared
- `test_rls_tenant_isolation_walls` — cross-company wall access blocked
- `test_rls_tenant_isolation_versions` — cross-company version access blocked

**Phase 1 — PR10 review hardening (C1, C2):**

C1 — archive-job guard covers every write path (walls, rooms, floor plan PATCH, cleanup):
- `test_collected_job_blocks_wall_create` — POST /rooms/{id}/walls on collected job → 403 JOB_ARCHIVED
- `test_collected_job_blocks_wall_update_delete` — PATCH + DELETE wall on collected job → 403
- `test_collected_job_blocks_opening_crud` — opening POST/PATCH/DELETE on collected job → 403
- `test_collected_job_blocks_room_crud` — room POST/PATCH/DELETE on collected job → 403
- `test_submitted_and_complete_stay_mutable` — walls + rooms still editable on `submitted` / `complete` (archive gate narrowed to `collected` only)
- `test_floor_plan_update_drops_canvas_data` — PATCH /properties/{id}/floor-plans/{id} with `canvas_data` in body is silently dropped (schema no longer accepts it; all content writes route through POST /versions)
- `test_cleanup_floor_plan_with_collected_job_id_rejects` — cleanup with `job_id` of a collected job → 403

C2 — concurrent-edit 409 path + partial unique indexes (migration `a1f2b9c4e5d6`):
- `test_create_version_concurrent_edit_returns_409` — INSERT raising APIError code=23505 → 409 CONCURRENT_EDIT (implemented)
- `test_create_version_non_unique_apierror_returns_500` — other APIError codes (connection errors etc.) still surface as 500 DB_ERROR, proving we didn't over-catch (implemented)
- `test_unique_index_rejects_duplicate_is_current` — integration: two rows with same (property_id, floor_number) and is_current=true fail at DB layer
- `test_unique_index_rejects_duplicate_version_number` — integration: two rows with same (property_id, floor_number, version_number) fail at DB layer

C3 — Case 2 is_current TOCTOU guard:
- `test_case2_update_matches_zero_rows_falls_through_to_case3` — when the Case 2 UPDATE filters `.eq("is_current", True)` and matches zero rows (row was frozen mid-flight by a sibling fork), save_canvas falls through to Case 3 and `_create_version` is invoked instead of silently mutating the frozen row (implemented)
- `test_case2_update_matches_row_returns_in_place` — happy path: when is_current is still true at write time, Case 2 still updates in place (no regression on the common autosave path)

C4 — atomic `save_floor_plan_version` RPC (flip + insert + pin in one transaction):
- `test_rpc_success_returns_new_row` — _create_version calls the RPC with all 8 params and returns the JSONB row unchanged (implemented)
- `test_rpc_list_wrapped_response_unwrapped` — supabase-py list-wrapping of scalar JSONB is normalized to a plain dict (implemented)
- `test_rpc_empty_response_raises_500` — RPC returning null/empty surfaces as 500 DB_ERROR instead of silently returning None (implemented)
- `test_rpc_unique_violation_raises_409_concurrent_edit` — RPC raising APIError code=23505 (partial unique index violation from a concurrent save) surfaces as 409 CONCURRENT_EDIT (implemented, carries the C2 behavior through the new RPC path)
- `test_rpc_non_unique_apierror_raises_500_db_error` — other RPC failures (connection, permission) still surface as 500 DB_ERROR — we only special-case 23505 (implemented)
- `test_rpc_rolls_back_on_pin_failure` — integration: simulate a pin-step failure inside the RPC; assert the insert also rolled back (no orphan version row)

C6 — linked recon does NOT inherit mitigation's floor_plan_id:
- `test_linked_recon_rooms_start_with_null_floor_plan_id` — after creating a recon linked to a mitigation, the recon's copied rooms have `floor_plan_id IS NULL`. Recon's first save creates a new version and links via the normal flow; no dangling references to mitigation's v1.
- `test_copy_fields_excludes_floor_plan_id` — static check that `floor_plan_id` is not in the `_copy_rooms_from_linked_job::COPY_FIELDS` list (guardrail against future accidental re-inclusion).

P2.1 — cleanup_floor_plan archive guard is unconditional:
- `test_schema_requires_job_id` — `SketchCleanupRequest` Pydantic-validates that `job_id` is present (422 if omitted) (implemented)
- `test_schema_accepts_valid_request` — happy path: schema accepts a request with both `job_id` and `canvas_data` (implemented)

P2.2 — `save_floor_plan_version` RPC rejects NULL params:
- `test_rpc_rejects_null_job_id` — integration: calling the RPC with `p_job_id=NULL` raises Postgres error `22023` (null_value_not_allowed) with a clear message
- `test_rpc_rejects_null_company_id` — integration: same for `p_company_id=NULL`
- `test_rpc_rejects_null_property_id` — integration: same for `p_property_id=NULL`

**Phase 1 — PR10 warning hardening (W1–W11):**

W1 — save_canvas verifies floor_plan_id belongs to job's property:
- `test_rejects_floor_plan_from_foreign_property` — foreign `floor_plan_id` → 400 `PROPERTY_MISMATCH` (implemented)
- `test_allows_save_when_property_ids_match` — happy path still works (implemented)
- `test_allows_save_when_job_property_id_is_null` — legacy jobs without property_id bypass the check (implemented)

W2 — wall `shared_with_room_id` must be same-company:
- `test_validator_rejects_foreign_company_room` — cross-tenant shared room → 400 `INVALID_SHARED_ROOM` (implemented)
- `test_validator_accepts_same_company_room` — happy path (implemented)
- `test_validator_noops_on_none` — null case skips the query entirely (implemented)

W3 — PATCH/DELETE via job require `property_id`:
- `test_patch_rejects_job_with_null_property_id` — 400 `JOB_NO_PROPERTY` (implemented)
- `test_delete_rejects_job_with_null_property_id` — same (implemented)

W4 — `delete_floor_plan` is single-row:
- `test_refuses_when_other_versions_exist` — delete one of many → 409 `VERSIONS_EXIST` (implemented)
- `test_deletes_when_no_siblings_exist` — single-version floor can be deleted (implemented)

W5 — `update_floor_plan` rejects any edit on frozen rows:
- `test_rejects_floor_name_rename_on_frozen_row` — 403 `VERSION_FROZEN` (implemented)
- `test_rejects_thumbnail_update_on_frozen_row` — same (implemented)

W6 — canvas_data 500 KB cap:
- `test_save_rejects_oversized_canvas` — 600 KB payload → Pydantic 422 (implemented)
- `test_save_accepts_reasonable_canvas` — realistic 100-wall sketch accepted (implemented)
- `test_cleanup_rejects_oversized_canvas` — same cap on cleanup (implemented)
- `test_cleanup_accepts_none_canvas` — None still OK (implemented)

W7 — `_copy_rooms_from_linked_job` distinguishes empty source from crash:
- `test_fetch_failure_raises_500` — APIError on fetch → 500 `LINKED_ROOMS_FETCH_FAILED` (implemented)
- `test_copy_failure_raises_500` — APIError on insert → 500 `LINKED_ROOMS_COPY_FAILED` (implemented)
- `test_empty_source_returns_zero` — legit "no rooms to copy" → returns 0 (implemented)

W8 — RoomDimensionInputs no longer loses drafts (frontend, manual verify):
- Swipe-dismiss mid-typing → edit survives via unmount flush
- Server refetch → no remount; drafts preserved when input is focused

W9 — cutouts refuse L/T/U concavity (frontend, manual verify):
- Body drag rejects positions where any corner fails `pointInPolygon(hostPoints)`
- Corner-handle drag predicts the resulting rect and rejects if any corner escapes

W10 — rect room drag doesn't float off on zero-delta snap (frontend, manual verify):
- Unconditional `e.target.x(room.x); e.target.y(room.y)` reset keeps Konva attr in sync with committed state
- Bonus: magnetic snap now edge-to-edge only + post-snap overlap check; rect rooms cannot be dropped on top of each other (dragBoundFunc guard)

W11 — `["floor-plans", jobId]` invalidated on save:
- Manual verify: add/remove a room on a fork path; FloorSelector roomCount chip updates within a second (not after staleTime expires)

**Phase 1 — PR10 round 2 hardening (R1–R19):**

R1 — migration trigger-function names:
- `test_every_trigger_calls_update_updated_at` — static scan of every Alembic migration; every `EXECUTE FUNCTION <name>()` must resolve to an installed function. Catches round 2's one-char typo class in CI (implemented)
- `test_no_stale_set_updated_at_function_call` — explicit regression guard against the exact `set_updated_at()` typo the reviewer flagged (implemented)

R2 — deferred per product model (see round-2 changelog). No test — keeping `parent_pin` is the desired behavior.

R3 — `save_floor_plan_version` RPC tenant hardening:
- `test_rpc_42501_maps_to_403_company_mismatch` — RPC raises `42501` on JWT/caller company mismatch → service returns 403 `COMPANY_MISMATCH` (implemented)
- `test_rpc_p0002_maps_to_400_property_mismatch` — property/job ownership failure `P0002` → service returns 400 `PROPERTY_MISMATCH` (implemented)
- `test_migration_hardens_tenant_checks` — static migration-text scan asserts `get_my_company_id()`, property ownership SELECT, `job.property_id = p_property_id` check, and `SET search_path` all present (implemented)

R4 — atomic `is_current` filter on update/cleanup + DB trigger:
- `test_update_zero_rows_matched_raises_version_frozen` — `update_floor_plan`: `.eq("is_current", True)` filter matches zero rows → raise `VERSION_FROZEN` (implemented)
- `test_update_writes_when_row_still_current` — happy path: update lands when is_current still true (implemented)
- `test_cleanup_zero_rows_matched_raises_version_frozen` — `cleanup_floor_plan`: same TOCTOU fix (implemented)
- `test_cleanup_writes_when_row_still_current` — happy path (implemented)
- `test_migration_installs_prevent_frozen_mutation_trigger` — static: BEFORE UPDATE trigger body checks `OLD.is_current IS FALSE`, raises SQLSTATE 42501 (implemented)

R5 — shared `assert_job_on_floor_plan_property` helper:
- `test_rejects_cross_property_job` — rollback_version: job on property A rolling back a floor plan on property B → 400 `PROPERTY_MISMATCH` (implemented)
- `test_allows_same_property_job` — rollback happy path (implemented)
- `test_cleanup_rejects_cross_property_job` — same check on cleanup (implemented)

R6 — archive-job guard on 3 by-job floor-plan endpoints:
- `test_collected_status_raises_job_archived` — helper behavior: `raise_if_archived({"status": "collected"})` → 403 (implemented)
- `test_active_status_returns_none` — helper returns cleanly for live jobs (implemented)
- `test_deleted_at_raises_job_not_found` — soft-deleted row short-circuits to 404 (implemented)
- `test_create_floor_plan_by_job_calls_raise_if_archived` — static guard: create-by-job endpoint invokes the helper (implemented)
- `test_update_floor_plan_by_job_calls_raise_if_archived` — PATCH endpoint (implemented)
- `test_delete_floor_plan_by_job_calls_raise_if_archived` — DELETE endpoint (implemented)

R7 — 23505 race on `create_floor_plan`:
- `test_insert_23505_raises_409_concurrent_edit` — INSERT raising APIError code=23505 → 409 `CONCURRENT_EDIT` (implemented)
- `test_insert_non_23505_still_raises_500_db_error` — other APIErrors still surface as 500 DB_ERROR (implemented)

R8 — JOB_NO_PROPERTY rejection replaces the legacy skip:
- `test_rejects_save_when_job_property_id_is_null` — `save_canvas` with `job.property_id IS NULL` → 400 `JOB_NO_PROPERTY` (previously `test_allows_save_when_job_property_id_is_null`; flipped to match R8) (implemented)
- `test_rejects_job_with_null_property` (rollback_version) — same (implemented)
- `test_rejects_job_with_null_property` (cleanup_floor_plan) — same (implemented)

R9 — `ensure_job_property` RPC + address unique index:
- `test_migration_defines_rpc_with_required_hardening` — SECURITY DEFINER + JWT company + FOR UPDATE on jobs + same-address property reuse + search_path + grants (implemented)
- `test_migration_installs_partial_unique_address_index` — `idx_properties_address_active` with normalized address expression (implemented)
- `test_migration_downgrade_drops_rpc_and_index` — rollback symmetry (implemented)
- `test_calls_ensure_job_property_rpc` — router refactor: `create_floor_plan_by_job_endpoint` calls the RPC (implemented)
- `test_old_non_atomic_block_is_gone` — regression guard that the pre-R9 read-insert-update sequence does not reappear (implemented)

R10 — wall/opening parent-ownership RLS:
- `test_migration_rewrites_walls_insert_with_parent_exists` — walls_insert policy joins `job_rooms` with matching company (implemented)
- `test_migration_rewrites_walls_update_with_parent_exists` — walls_update has both `USING` + `WITH CHECK` with EXISTS (implemented)
- `test_migration_rewrites_openings_insert_with_parent_exists` — openings_insert joins `wall_segments` (implemented)
- `test_migration_rewrites_openings_update_with_parent_exists` — openings_update (implemented)
- `test_migration_downgrade_restores_pre_r10_policies` — rollback recreates the old child-only policies so downgrade never leaves the table with no INSERT policy (implemented)

R11 — rooms schema per-field size caps:
- `test_room_polygon_rejected_over_10kb_on_create` — Pydantic 422 (implemented)
- `test_room_polygon_accepted_at_realistic_size` — 16-vertex L-shape passes (implemented)
- `test_floor_openings_rejected_over_50kb_on_update` — PATCH path too (implemented)
- `test_material_flags_rejected_over_20_items` — list cap (implemented)
- `test_material_flags_rejected_per_item_too_long` — per-item string cap (implemented)
- `test_material_flags_accepted_at_realistic_values` — real tag list passes (implemented)
- `test_notes_rejected_over_5000_chars` — `Field(max_length=5000)` (implemented)
- `test_notes_accepted_at_reasonable_length` — realistic note passes (implemented)
- `test_room_sketch_data_rejected_over_50kb` — bonus cap on the legacy per-room blob (implemented)

R12 — cross-floor save fork handling (frontend, manual verify):
- Tab A + Tab B on linked jobs at same property. Tab B edits a target floor; Tab A does cross-floor save to that floor. Expected: Tab A's selector moves to the saved fork id, next edit persists, no frozen-row errors. Pre-fix: next edit either fails or forks again.

R13 — redundant partial index dropped:
- `test_upgrade_drops_redundant_index` — `DROP INDEX IF EXISTS idx_floor_plans_is_current` present in migration (implemented)
- `test_downgrade_recreates_the_index` — rollback symmetry — same columns + predicate (implemented)
- `test_revision_chains_after_r10` — alembic chain hygiene (implemented)

R14 — renamed versions_* policies to floor_plans_*:
- `test_upgrade_renames_all_four_policies` — select + insert + update + delete all renamed (implemented)
- `test_upgrade_guards_with_exists_check` — `IF EXISTS` guards for idempotency (implemented)
- `test_downgrade_reverses_all_four_renames` — rollback symmetry (implemented)

R15 — `use-jobs.ts` hook signatures:
- `test_use_update_floor_plan_no_longer_accepts_canvas_data` — stripped stale field from generic type (implemented, comments filtered)
- `test_use_update_floor_plan_still_accepts_metadata_fields` — floor_name + thumbnail_url retained (implemented)
- `test_use_save_canvas_takes_job_id` — signature `(floorPlanId, jobId)` (implemented)
- `test_use_save_canvas_invalidates_floor_plans_list` — onSuccess invalidates per-job cache (implemented)
- `test_use_save_canvas_invalidates_jobs` — job row also invalidated (implemented)
- `test_use_save_canvas_still_invalidates_history` — regression: existing history invalidation preserved (implemented)

R16 — wall_square_footage recalc on room-level mutations:
- `test_update_room_calls_recalc_on_wall_sf_input_change` — static: update_room names `{height_ft, ceiling_type, custom_wall_sf}` and invokes `_recalculate_room_wall_sf` (implemented)
- `test_update_room_stamps_fresh_sf_on_response` — response dict gets the fresh value without an extra fetch (implemented)
- `test_function_signature_returns_float_or_none` — helper refactor: return type allows caller-side stamping (implemented)
- Manual verify: edit a room's ceiling height via the edit modal → mobile modal's "Wall XXX SF" subtitle updates on reload.

R17 — non-negative CHECK + UX inline errors:
- `test_upgrade_adds_custom_wall_sf_constraint` — exact name + predicate from reviewer's snippet (implemented)
- `test_upgrade_adds_wall_square_footage_constraint` — same (implemented)
- `test_downgrade_drops_both_constraints` — rollback (implemented)
- `test_revision_chains_after_r14` — alembic chain hygiene (implemented)
- `test_cutout_editor_shows_error_when_invalid` — cutout editor sheet inline error (implemented)
- `test_cutout_editor_error_gated_on_not_valid` — message only when invalid + non-empty + not over-max (implemented)
- `test_numeric_input_derives_draft_invalid_state` — shared NumericInput tracks invalidity live (implemented)
- `test_numeric_input_shows_error_message` — renders red error text (implemented)
- `test_numeric_input_applies_red_border_when_invalid` — visual + text feedback synced (implemented)
- `test_konva_mobile_sheet_shows_error_for_width` — mobile Width input (implemented)
- `test_konva_mobile_sheet_shows_error_for_height` — mobile Height input (implemented)
- `test_konva_mobile_sheet_has_error_messages` — both error texts present (implemented)
- `test_room_dimension_inputs_tracks_invalid_state` — RoomDimensionInputs in MobileRoomPanel (implemented)
- `test_room_dimension_inputs_applies_red_border` — same (implemented)
- `test_room_dimension_inputs_shows_error_text` — "Must be at least 1" messaging (implemented)
- Manual verify: type `-10` into any of Width / Length / Height inputs — red border + inline error appears, room doesn't resize; typing a valid value clears both.

R18 — swing column documentation:
- `test_upgrade_attaches_comment_to_swing_column` — `COMMENT ON COLUMN wall_openings.swing` present (implemented)
- `test_comment_enumerates_all_four_values` — all 4 mapping entries match `FloorOpeningData.swing` (implemented)
- `test_comment_points_at_frontend_source` — doc pointer to `floor-plan-tools.ts` preserved (implemented)
- `test_downgrade_clears_the_comment` — rollback resets comment to NULL (implemented)

R19 — full-fidelity rollback via snapshot + restore:
- `test_upgrade_defines_rpc` — `restore_floor_plan_relational_snapshot` function body present (implemented)
- `test_rpc_is_security_definer_with_locked_search_path` — standard hygiene (implemented)
- `test_rpc_derives_company_from_jwt` — R3 pattern: `get_my_company_id()` + `42501` on no-auth (implemented)
- `test_rpc_restores_all_four_relational_sources` — DELETE + INSERT wall_segments, INSERT wall_openings, UPDATE `room_polygon` + `floor_openings` (implemented)
- `test_rpc_handles_legacy_versions_without_snapshot` — pre-R19 data returns `restored=false`, not a 500 (implemented)
- `test_rpc_rejects_unsupported_snapshot_version` — future-proofing: refuse unknown version (implemented)
- `test_downgrade_drops_function` — rollback symmetry (implemented)
- `test_save_canvas_enriches_before_create_version` — static: save_canvas calls the snapshot helper (implemented)
- `test_enricher_adds_snapshot_key` — behavioral: helper sets `_relational_snapshot` on the returned canvas_data (implemented)
- `test_enricher_does_not_mutate_input` — defensive copy of caller's canvas_data (implemented)
- `test_rollback_invokes_restore_rpc` — static: rollback_version calls the restore RPC (implemented)
- `test_rollback_maps_restore_failure_to_500` — RPC APIError surfaces as `ROLLBACK_RESTORE_FAILED` so caller knows state is inconsistent (implemented)
- Manual verify: edit a room (add a door), save, edit again (change door width), save → roll back to first version → door width reverts. Pre-R19: canvas showed v1 but `wall_openings` still held v2 width.

**Phase 1 — PR10 round 3 hardening (concurrent-editing + re-review fixes):**

RPC replacement for optimistic-create race (migration `b8c9d0e1f2a3`):
- `test_upgrade_defines_rpc` — `CREATE OR REPLACE FUNCTION ensure_job_floor_plan` present (implemented)
- `test_rpc_is_security_definer_with_pinned_search_path` — same R3 hygiene as every other 01H RPC (implemented)
- `test_rpc_derives_company_from_jwt` — `get_my_company_id()` + `42501` on no-auth (implemented)
- `test_rpc_locks_jobs_row` — `SELECT ... FOR UPDATE FROM jobs` serializes concurrent callers on same job (implemented)
- `test_rpc_rejects_archived_jobs` — 42501 if job.status = 'collected' (implemented)
- `test_rpc_rejects_null_property` — 42501 if job.property_id IS NULL (ensure_job_property should run first) (implemented)
- `test_rpc_idempotent_fast_path_via_existing_pin` — retry after a successful call returns the same row, no duplicate version (implemented)
- `test_rpc_reuses_existing_floor_row_on_second_caller` — race-closing branch: caller B finds A's INSERT, pins its own job to it (implemented)
- `test_rpc_creates_row_with_correct_stamps` — created_by_user_id + created_by_job_id (implemented)
- `test_downgrade_drops_the_rpc` — rollback symmetry (implemented)

Router refactor:
- `test_calls_ensure_job_floor_plan_rpc` — static: `create_floor_plan_by_job_endpoint` invokes the new RPC with all 4 params (implemented)
- `test_retries_once_on_23505` — same pattern as `ensure_job_property`; two different jobs racing past their per-job FOR UPDATE locks hit the partial unique index (implemented)
- `test_old_409_catch_fallback_is_removed` — regression guard against the dead optimistic-create + catch-409 + pick-plans[0] block that caused the round-3 critical regression (implemented)

Etag + If-Match + 412 VERSION_STALE:
- `test_service_signature_accepts_if_match` — `save_canvas` has an `if_match: str | None = None` parameter, default None for backward-compat (implemented)
- `test_service_raises_412_on_etag_mismatch` — `status_code=412` + `VERSION_STALE` error code present in save_canvas (implemented)
- `test_service_includes_current_etag_in_412_response` — response body carries `current_etag` so clients can reload to the right version (implemented)
- `test_backward_compat_when_if_match_absent` — the `if if_match is not None` guard skips the check entirely for pre-rollout clients (implemented)
- `test_router_reads_if_match_header` — `save_canvas_endpoint` extracts `request.headers.get("If-Match")` and forwards (implemented)

FloorPlanResponse etag field:
- `test_schema_has_computed_etag_field` — Pydantic v2 `@computed_field` exposes etag on the response model (implemented)
- `test_etag_matches_updated_at_iso_string` — etag round-trips as the ISO string of `updated_at` (implemented)
- `test_compute_etag_handles_string_input` — helper pass-through when updated_at arrives pre-serialized (implemented)
- `test_compute_etag_returns_none_on_none` — defensive: NULL updated_at → None (implemented)

AppException extra field:
- `test_app_exception_accepts_extra` — new optional `extra` dict for structured error context like `current_etag` (implemented)
- `test_app_exception_extra_defaults_to_empty_dict` — backward-compat for every existing raise site (implemented)

Apply-script deletion (Lakshman #3):
- `test_apply_script_does_not_exist` — regression guard against reintroducing `backend/scripts/pr10_round2_apply.sql` without a sync-enforcement mechanism (implemented)

Downgrade symmetry fix (Lakshman #2):
- `test_downgrade_reinstalls_restore_rpc_with_2arg_call` — `a7b8c9d0e1f2` DOWNGRADE re-installs `restore_floor_plan_relational_snapshot` with the 2-arg helper call shape that matches the downgraded `_compute_wall_sf_for_room` signature; the 1-arg form does not leak into the downgrade body (implemented)

Frontend etag + 412 banner (manual verify on mobile in multi-user setup):
- Open the same job on two devices. Tech A edits a room, saves. Tech B edits a different room (without reloading). Tech B's save returns 412; a red "Floor plan was updated by another editor" banner appears with Reload + Dismiss buttons. Reload shows A's room; B redraws theirs on top; saves successfully.
- Pre-rollout compatibility: an older frontend (no `If-Match` header) still saves successfully — backend skips the check when the header is absent.

**Phase 1 — Round-3 follow-through (concurrent-editing surface closure):**

Shared etag module + parse-based comparison:
- `test_etag_from_updated_at_returns_none_on_none` — None passes through as None, not "" (fixes the silent falsy-check skip) (implemented)
- `test_etag_from_updated_at_passes_through_strings` — ISO string input is returned unchanged (implemented)
- `test_etag_from_updated_at_serializes_datetime` — datetime → `.isoformat()` matches what `to_jsonb()` produces (implemented)
- `test_etags_match_identical_strings` — fast-path string equality (implemented)
- `test_etags_match_normalizes_microsecond_precision` — `"+00:00"` vs `".000000+00:00"` for the same instant compare equal (implemented; closes the docstring-lies-about-code bug)
- `test_etags_match_rejects_different_timestamps` — different instants compare unequal (implemented)
- `test_etags_match_none_never_matches` — None on either side returns False so callers choose skip vs reject explicitly (implemented)
- `test_etags_match_falls_back_to_string_equality_on_garbage` — non-ISO inputs don't crash (implemented)
- `test_floor_plan_response_etag_is_nullable_not_empty` — response etag serializes None → null, not "" (implemented)

Etag extended to all mutation endpoints:
- `test_update_floor_plan_service_accepts_if_match` — `update_floor_plan` service takes `if_match` param (implemented)
- `test_cleanup_floor_plan_service_accepts_if_match` — same for cleanup (implemented)
- `test_rollback_version_service_accepts_if_match` — same for rollback (implemented)
- `test_all_mutation_endpoints_forward_if_match_header` — router guard: every save_canvas / update / update-by-job / rollback / cleanup endpoint extracts `If-Match` (implemented; sibling-miss regression guard)
- `test_service_uses_shared_etags_match_not_raw_equality` — every `if_match`-aware service method uses `etags_match`, not `!=` (implemented)

Shared reconcileSavedVersion helper + 409 branch fix:
- `test_shared_helper_is_defined` — `function reconcileSavedVersion(` exists in page.tsx (implemented)
- `test_all_four_save_sites_call_helper` — autosave + first-create + 409 recovery + cross-floor all delegate; sibling-miss regression guard (implemented)
- `test_409_recovery_branch_captures_savedVersion` — the branch that previously threw away the return now captures it (implemented)
- `test_409_recovery_branch_no_longer_throws_away_return` — explicit regression guard against reverting to fire-and-forget (implemented)

Integration tests (live-DB, skip without Supabase):
- `test_update_on_frozen_row_raises_55006` — R4 trigger behavior, not text (implemented, skip-without-DB)
- `test_save_canvas_flow_does_not_trip_trigger` — legitimate flip passes through (implemented)
- `test_passing_foreign_company_id_raises_42501` — cross-tenant RPC rejection (implemented)
- `test_authenticated_call_computes_wall_sf` — 1-arg `_compute_wall_sf_for_room` correctness (implemented)

**Phase 1 — PR10 Round 5 (ETag contract closure, 2026-04-22):**

All 21 tests live in `TestRound5EtagContractInvariants` in `backend/tests/test_floor_plans.py`. Grouped by the invariant they pin.

INV-2 (SQL-level atomic enforcement — migration `c9d0e1f2a3b4`):
- `test_save_rpc_takes_p_expected_updated_at` — new param present on `save_floor_plan_version` with `DEFAULT NULL` for backward compat (implemented)
- `test_rollback_rpc_takes_p_expected_updated_at` — same param on `rollback_floor_plan_version_atomic`, forwarded through to save's inner call (implemented)
- `test_save_rpc_enforces_etag_atomically_on_flip` — flip UPDATE carries `AND updated_at = p_expected_updated_at` — NOT a separate check-then-write (implemented)
- `test_save_rpc_raises_55006_on_etag_mismatch` — stale-etag rejection uses SQLSTATE 55006 so Python catches disambiguate from 42501/23505/23502/P0002 (implemented)
- `test_save_rpc_disambiguates_stale_vs_first_save` — zero-rows-flipped follow-up `PERFORM … IF FOUND` distinguishes "stale etag on existing current row" from "no current row yet, first save" (implemented)
- `test_migration_has_symmetric_downgrade` — DOWNGRADE drops the new 9-arg/5-arg overloads BEFORE recreating pre-change 8-arg/4-arg forms (lesson #10 regression guard) (implemented)
- `test_create_version_accepts_expected_updated_at` — Python `_create_version` signature takes the param, `DEFAULT None` for creation paths (implemented)
- `test_create_version_forwards_to_rpc` — `_create_version` builds `p_expected_updated_at` into the RPC payload (implemented)
- `test_create_version_maps_55006_to_412_when_etag_present` — 55006 handler branches on `expected_updated_at is not None` → 412 VERSION_STALE (etag path) vs 403 VERSION_FROZEN (legacy trigger path) (implemented)
- `test_save_canvas_passes_expected_for_rpc` — save_canvas Case 1 + Case 3 both forward `expected_for_rpc` (sibling-miss regression guard) (implemented)
- `test_rollback_version_passes_expected_updated_at_to_rpc` — closes Lakshman P3 #5 via option 2 (thread) not option 1 (document) (implemented)

INV-1 (`If-Match` required — helper + route wiring):
- `test_require_if_match_helper_exists` — `api.shared.dependencies.require_if_match` callable (implemented)
- `test_require_if_match_raises_428_on_missing` — missing header → `AppException(status_code=428, error_code="ETAG_REQUIRED")` (implemented, functional)
- `test_require_if_match_wildcard_returns_none` — `If-Match: *` returns None (opt-out for creation, standard HTTP) (implemented)
- `test_require_if_match_returns_header_value` — real etag pass-through (implemented)
- `test_all_mutation_routes_use_require_if_match` — all 5 mutation endpoints (save/update×2/rollback/cleanup) use the helper; the old `request.headers.get("If-Match")` silent-skip pattern must NOT appear anywhere (sibling-miss regression guard) (implemented)
- `test_dead_use_save_canvas_hook_removed` — `useSaveCanvas` hook stays deleted (had zero consumers, was the surface that would re-open the precondition bypass) (implemented)

INV-3 + INV-4 (frontend grep-shape pins):
- `test_in_flight_guard_present_on_handle_change` — module-scoped `_canvasSaveInFlight` + `_canvasDeferredDuringSave` flags, `queueMicrotask(…)` replay in `finally` block (implemented)
- `test_conflict_draft_persisted_on_version_stale` — `canvas-conflict-draft:` localStorage key written on 412 BEFORE reload; helper accepts `rejectedCanvas` + `jobId` (implemented)
- `test_conflict_draft_restore_banner_present` — `setConflictDraft` state + Restore / Discard CTAs exist; no auto-apply (implemented)
- `test_source_floor_captured_at_post_time` — `postTimeSourceFloorId` variable captured BEFORE the await; conflict drafts keyed on the floor the save was AGAINST, not `activeFloorRef.current` which can move during the POST (implemented)

Two round-3/4 tests updated to assert the new `require_if_match` pattern instead of the old silent-skip:
- `TestSaveCanvasEtagIfMatchCheck::test_router_reads_if_match_header` — now asserts `require_if_match(request)` in `save_canvas_endpoint` body
- `TestEtagExtendedToAllMutationEndpoints::test_all_mutation_endpoints_forward_if_match_header` — same pattern across all 5 routes

Four round-2 `TestUseJobsHookSignatures::test_use_save_canvas_*` tests collapsed into a single regression guard `test_use_save_canvas_hook_stays_deleted` since the hook no longer exists.

Manual verify on mobile (multi-user race):
- Open the same job on two devices. Tech A draws + saves. Tech B draws against stale view + saves → 412 banner fires, draft persists. Tech B clicks Reload. Post-reload banner asks "Restore my edits?" — clicking Restore re-applies B's room on top of A's latest, save succeeds (fresh etag in cache). Clicking Discard drops the draft cleanly.
- Missing-header probe: `curl -X POST /v1/floor-plans/{id}/versions -d '{…}'` without If-Match → 428 `ETAG_REQUIRED`.
- Wildcard probe: same curl with `-H 'If-Match: *'` → save succeeds (creation-path opt-out, save_canvas only).
- Round-5 follow-up (M1) wildcard probe on strict routes: `curl -X PATCH /v1/properties/{pid}/floor-plans/{fpid} -H 'If-Match: *' …` → 428 `ETAG_REQUIRED`. Same for DELETE-adjacent / cleanup / rollback — no endpoint with an existing-row target accepts the wildcard.
- Slow-network simulation: Chrome DevTools → Network → Slow 3G. Draw and hold for rapid edits. Autosave overlap → second save defers via in-flight flag, replays after first response commits — no self-412.

Round-5 follow-up tests (all in `TestRound5EtagContractInvariants`):
- `test_require_if_match_strict_helper_exists` — `api.shared.dependencies.require_if_match_strict` callable (implemented)
- `test_require_if_match_strict_raises_428_on_missing` — missing header → 428 `ETAG_REQUIRED` (implemented)
- `test_require_if_match_strict_rejects_wildcard` — `If-Match: *` → 428 `ETAG_REQUIRED` (the M1 core guard) (implemented)
- `test_require_if_match_strict_returns_concrete_etag` — real etag pass-through (implemented)
- `test_strict_helper_used_on_non_creation_routes` — update/cleanup/rollback/update-by-job use the strict variant; save_canvas uses the permissive variant (per-route pin) (implemented)
- `test_migration_drops_old_overloads_before_replacing` — M2 regression guard: UPGRADE_SQL must DROP both 8-arg save + 4-arg rollback forms BEFORE the new signatures so only the new overloads exist after upgrade (implemented)

Round-5 follow-up integration tests (live-DB, skip without Supabase):
- `test_stale_expected_updated_at_raises_55006` — end-to-end race: seed v1 at T0, admin-commit v2 at T1, authenticated RPC with `p_expected_updated_at=T0` raises 55006 (implemented)
- `test_matching_expected_updated_at_succeeds` — happy path, v2 created when etag matches current (implemented)
- `test_first_save_with_expected_updated_at_succeeds` — discriminator: bogus etag + no current row → insert (implemented)

**Phase 2:**
- `test_pin_color_boundaries` — green/amber/red at dry_standard boundaries
- `test_pin_color_at_exact_threshold` — reading = dry_standard returns green
- `test_pin_color_at_10_point_boundary` — reading = dry_standard + 10 returns amber, + 11 returns red
- `test_regression_detection` — reading increase day-over-day flagged
- `test_dry_standard_material_lookup` — each material returns correct default
- `test_pin_reading_uniqueness_per_day` — unique constraint on (pin_id, reading_date)
- `test_moisture_pdf_generation` — PDF has pin markers + summary table

**Phase 3:**
- `test_equipment_place_n_units_creates_n_records` — quantity=6 creates 6 records
- `test_equipment_partial_pull` — pull 2 of 6 marks 2 records pulled_at
- `test_equipment_duration_calculation` — ceil((pulled - placed) / 1 day)
- `test_equipment_billing_integration` — duration × rate = billing amount

**Phase 4:**
- `test_photo_category_enum_constraint` — invalid category rejected
- `test_before_after_pairing_symmetric` — paired_photo_id creates symmetric link
- `test_photo_summary_counts_per_room` — summary endpoint returns correct counts
- `test_photo_summary_unplaced_tray` — photos with null room_id counted as unplaced
- `test_gps_capture_on_upload` — latitude/longitude persisted

**Phase 5:**
- `test_annotation_create_job_scoped` — annotation belongs to creator's job
- `test_annotation_historical_query` — prior jobs' annotations returned via historical endpoint
- `test_annotation_include_in_report_toggle` — flag respected in PDF export

### Backend Integration Tests (real Supabase)

- RLS policy verification for all new tables (walls, openings, pins, readings, equipment, annotations, versions)
- Multi-tenant isolation tests for each new endpoint
- Transaction tests for place-N-units (all N created atomically or none)

### Frontend (Vitest + Testing Library)

**Shipped in Phase 2** (8 test files, 78 passing tests as of 2026-04-23):
- `src/lib/__tests__/moisture-reading-history.test.ts` — 22 unit tests on the extracted derivation module: empty series / single / strict-`>` regression boundary / mixed up-down / out-of-order sort / no-mutation contract / `findTodayReading` / `validateReadingInput` across empty/non-numeric/negative/>100/decimal/boundary / `isChangedFromToday` across null-today + clearing-input cases.
- `src/lib/__tests__/moisture-room-status.test.ts` — 7 unit tests on `deriveRoomStatus` (worst-pin-wins truth table, null-color handling, cross-room scope).
- `src/lib/__tests__/dates.test.ts` — 7 unit tests on `todayLocalIso()` + `formatShortDateLocal()` — pinned at 8 PM US Pacific (regression anchor), year boundary, malformed input, symmetric write/read round-trip.
- `src/components/sketch/__tests__/moisture-reading-sheet.test.tsx` — 10 RTL integration tests on the reading sheet: loading skeleton ↔ real history transition, last-reading trash disabled with hint, ≥ 2 readings enabled with correct aria-labels, ConfirmModal open/close on trash/cancel, delete mutation fires with correct reading id on confirm, today's reading prefilled via `todayLocalIso` (pinned at 8 PM US Pacific to guard the TZ regression), edit chip visibility + `onEditRequest` wiring.
- Plus pre-existing lib tests (`api`, `api-server`, `types`) unchanged by Phase 2 — all 78 tests green on every run.

**Still pending** (Phase 2 Tasks 6 + 7):
- Moisture PDF export snapshot test.
- Adjuster portal moisture view — read-only render parity with the reading sheet's derivation module (reuses `moisture-reading-history.ts` so no algorithm re-test needed; coverage there will be presence + correct scoping).

**Explicitly out-of-scope** (would ossify without adding safety):
- Pixel-exact sparkline SVG geometry. Presence and data flow are asserted; coordinate math is not.
- Konva-layer interactions (drag/drop). Stage + Layer are Konva-controlled; covered by the Phase 2 manual QA in §"Cumulative Test Coverage (Phase 2)".

### Frontend E2E (Playwright)

- `sketch-create-room.spec.ts` — draw rectangle, confirm, appears on canvas
- `sketch-trace-perimeter.spec.ts` — tap corners, auto-close, L-shaped room created
- `sketch-room-snap.spec.ts` — drag room near another, snaps flush, shared wall marked
- `sketch-wall-interactions.spec.ts` — tap wall, add door, SF updates
- `sketch-moisture-flow.spec.ts` — enter moisture mode, drop pin, enter reading, see color
- `sketch-version-history.spec.ts` — edit floor plan, see new version, rollback

---

## Performance Considerations

| Phase | Concern | Mitigation |
|-------|---------|-----------|
| 1 | Canvas re-render at 400+ nodes | `Konva.Layer` batching, `React.memo` on pin/icon components |
| 1 | Auto-save frequency (~80KB JSON × many writes) | 2-second debounce (from 01C), `If-Unchanged-Since` headers |
| 1 | Room snap check (O(n²) wall distance) | Spatial index (grid hash) for walls, only check walls within viewport |
| 2 | Moisture pin trend queries | Index on `(pin_id, reading_date)` already in schema |
| 4 | Photo summary query | Index on `(job_id, room_id)` already in schema |
| 5 | Version storage (~80KB × versions) | Monitor usage. If versions × properties > 10GB, compress canvas_data JSONB. |

---

## NOT in Scope

- LiDAR integration — future spec (V3+)
- Equipment library CRUD — stays in Spec 04C (this spec uses placement model only)
- 3D view — overkill for water jobs
- AI cleanup/straightening — Spec 02 territory
- Multi-user real-time collaboration — one tech per job assumption
- Verisk ESX export — requires Strategic Alliance partnership
- Adjuster portal floor plan view — separate spec (08)
- Multi-device backup conflict resolution — flagged as M5 in 01C review, V1 acceptable with one tech per job
- Custom per-company ceiling multipliers — hardcoded constants work for V1
- Google Places address geocoding in property dedup — existing `usps_standardized` (lowercase/trim) is sufficient for V1

---

## Build Sequence

Phase 1 is the largest (property reparenting + versioning + canvas rebuild + walls + snap). Phase 2-5 layer on top.

| Phase | Est. Sessions | Depends on | Milestone |
|-------|--------------|-----------|-----------|
| 1 | 4-5 | — | Canvas draws real houses with accurate SF |
| 2 | 2 | 1 | Moisture pins tracked over time with trend + PDF |
| 3 | 2 | 1 | Equipment tracked for billing |
| 4 | 2 | 1 | Photos categorized, clustered, paired |
| 5 | 1-2 | 1 | Annotations + version history UI |

Each phase ships independently and is usable. Phase 1 unblocks everything else.

## Cumulative Test Coverage (Phase 1 — Manual QA)

This is what was actually exercised end-to-end against a running dev
environment before declaring Phase 1 feature-complete. Automated tests
(pytest / Vitest / Playwright) are deferred and listed above in
"Testing Requirements" as a follow-up.

**Versioning + archival hydration**
- Fresh job with no floor plan → first save creates v1 and pins the job (Case 1).
- Same job's next save on the same floor → updates v1 in place (Case 2) — no fork, no version bump.
- Sibling job editing the same floor → forks v2, pins the new job (Case 3). Original job's pin still points at v1 (frozen).
- Archived job's pin stays valid after a sibling forks the floor.
- Archived job on a single floor: editor shows the pinned version; never falls through to `is_current` even when a sibling edits the same floor.
- Archived job on multiple floors: each floor hydrates correctly — scalar pin covers one floor, `created_by_job_id` tier covers the others.
- Cross-floor room creation: confirming a room with a Floor different from the active canvas merges the polygon into the target floor, primes both caches, and switches active with no empty-state flash.

**Canvas geometry**
- Shape picker: all 5 shapes (Rectangle, L, T, U, Rect+Notch) drop at viewport center with correct dimensions.
- Auto-pan triggers when dropped shape would clip the viewport.
- Cancel in shape picker falls back to classic click-and-drag rectangle.
- Polygon drag: outline, fill, dimension labels, walls, and any contained cutouts all land together at the dropped position (no split).
- Polygon vertex edit: dragging one vertex deforms the shape; walls regenerate; per-edge dimension labels update to new lengths.
- Magnetic room-to-room snap engages within 20px; shared walls automatically marked (muted render, excluded from LF).
- Trace-perimeter tool: closes on tap-first-vertex; works for irregular shapes.
- Tap-anywhere-empty deselects a selected room.
- Tap an active tool → returns to Select (no keyboard needed on mobile).

**Direct dimension editing**
- Rectangle room: typing Width / Length in the mobile bottom sheet or desktop sidebar resizes live, walls regenerate, SF updates. Values commit on 400ms debounce + blur + Enter.
- Rect-shaped polygon (4 vertices at bbox corners): same inputs work — points regenerate at the new bbox corners alongside the bbox update.
- True polygon (L/T/U with deformed vertices): inputs are hidden; "Drag vertices on the canvas" hint shown. Vertex drag is the shape-editing mechanism.
- Typing freely works: clear the input, type a new number, the room resizes correctly on blur (no snap-back to old value).
- Escape reverts the draft without committing.

**SF calculations**
- Floor SF = polygon area − cutout area, computed live in `roomFloorArea(room, gs)`.
- Resize a room via direct W × H input: SF label updates on canvas, `job_rooms.square_footage` syncs via autosave diff.
- Resize below a cutout's position: cutout clamps into new bbox, SF recomputes with new cutout size.
- Add/remove a cutout: SF label shifts to "N SF net" in orange when cutouts exist, neutral when none.
- Wall SF = perimeter LF × ceiling height × ceiling multiplier − openings; updates on door/window width/height change.
- Persistent floor-total chip top-right always reflects the sum across rooms on the active floor.

**Wall openings**
- Door placement via wall tap menu: swing direction cycles on re-tap when selected.
- Door/window width + height edits via bottom sheet (mobile) and sidebar (desktop). Debounced commit, no rejection of mid-keystroke clears.
- Door/window placement near a wall endpoint: room corner-resize handle stays tappable (hit-area tightened so the door no longer blankets the corner).
- Opening (missing wall) renders dashed red + drags along the wall.

**Mobile UX**
- Full-bleed routes: `/jobs/<id>` and every sub-route hide the top header + bottom nav; back arrow returns to the jobs list.
- `/jobs` (list) and `/jobs/new` keep the chrome.
- Toolbar layout: primary row icon+label, "More" pinned right with count badge, overflow menu opens/closes via tap / Escape / outside-tap / re-tap.
- Stage pan works with one finger on Select / Delete / Door / Window / Opening tools; drag-to-draw tools (Room, Cutout) disable pan but still accept pinch.
- Active-tool pill shows the label for strong state feedback; re-tap returns to Select.
- Double-tap on a toolbar button fires twice (iOS Safari no longer eats the second tap as double-tap-zoom).

**Saving + autosave**
- 2s debounced autosave after any canvas change.
- Immediate flush on room Confirm (bypasses debounce), version creation, and manual Save button.
- "Saving" indicator holds at least 400ms so fast (<100ms) POSTs don't flash.
- Manual Save button shows "Saved ✓" on no-op flushes — no silent dead-end.
- Back button invalidates jobs / rooms / floor-plans caches so the job detail Property Layout reflects new rooms without a hard refresh.

**Known-limitation verification**
- Archived preview thumbnail can show an `is_current` fallback for legacy rows without `created_by_job_id` — confirmed cosmetic, floor-plan editor itself always shows the correct pin.
- ~~`_create_version` race untested under concurrency~~ — addressed in C2: partial unique indexes on (property_id, floor_number) WHERE is_current=true and on (property_id, floor_number, version_number), plus APIError code=23505 → 409 CONCURRENT_EDIT retry path. Unit-tested in `TestCreateVersionConcurrentEdit`.

**PR10 critical fixes (post-review hardening)**

C1 — archive-job guard:
- Narrowed archive set from `{complete, submitted, collected}` → `{collected}` only. Mitigation techs keep editing after status = `complete`; adjuster resubmits after `submitted` still allowed. Verified in browser: flipping a mitigation job to `submitted` kept the floor plan editable; flipping to `collected` switched to read-only and the backend rejected wall + room edits with 403 JOB_ARCHIVED.
- Wall + opening CRUD routes (`POST/PATCH/DELETE /rooms/{id}/walls[...]`) now call `ensure_job_mutable_for_room` before mutating — previously skipped the archive check entirely.
- Room CRUD (`POST/PATCH/DELETE /jobs/{id}/rooms[...]`) calls `ensure_job_mutable`.
- `FloorPlanUpdate` schema no longer accepts `canvas_data` — the PATCH bypass path is closed; all canvas writes go through `POST /floor-plans/{id}/versions` (save_canvas).
- `cleanup_floor_plan` accepts optional `job_id` and runs `ensure_job_mutable` when present.
- Frontend `isJobArchived` helper (`web/src/lib/job-status.ts`) mirrors the backend constant so UI read-only state tracks the same status set.

C2 — `_create_version` race (partial unique indexes + 409 retry):
- Migration `a1f2b9c4e5d6_spec01h_floor_plans_unique_indexes.py` adds `idx_floor_plans_current_unique` (partial on `is_current=true`) and `idx_floor_plans_version_unique`. DB now rejects the losing writer of a concurrent save with Postgres error 23505.
- `_create_version` catches `APIError.code == "23505"` and raises `AppException(409, "CONCURRENT_EDIT")` so the client retries. Retry re-enters save_canvas, sees its pinned row is no longer `is_current`, and takes Case 3 (fork) cleanly.
- Not end-to-end race-tested against live Postgres (would require parallel client harness). Unit-tested at service layer: `TestCreateVersionConcurrentEdit::test_unique_violation_raises_409_concurrent_edit` and `::test_non_unique_apierror_still_raises_500_db_error` both pass.

C3 — Case 2 `is_current` TOCTOU (atomic UPDATE filter + fallthrough):
- Case 2's in-memory `pinned_still_current` check was racy: between that read and the UPDATE, a sibling job's Case 3 fork could flip `is_current=false` on the target row, silently writing into frozen history. The Case 2 UPDATE now includes `.eq("is_current", True)` so Postgres enforces the check atomically.
- When the UPDATE matches zero rows (another writer won the race), the function falls through to Case 3 and forks a new version on top of whoever just became current. No data written to the frozen row.
- Unit-tested at service layer: `TestCase2IsCurrentTOCTOU::test_case2_update_matches_zero_rows_falls_through_to_case3` uses a scripted fake client to simulate the TOCTOU race and asserts `_create_version` is invoked on fallthrough.

C4 — atomic `save_floor_plan_version` RPC:
- Migration `b2c3d4e5f6a7_spec01h_save_floor_plan_version_rpc.py` creates a SECURITY DEFINER plpgsql function that runs flip + insert + pin as one transaction. Tenant isolation enforced explicitly inside the function (`company_id` check on the jobs row) since SECURITY DEFINER bypasses RLS.
- `_create_version` rewritten to call `client.rpc("save_floor_plan_version", ...)`; the three old separate writes (flip + insert + jobs update) are gone at the application layer. Any failure inside the RPC rolls back all three atomically — no more orphan versions on transient network errors.
- All three redundant `_pin_job_to_version` call sites removed from `save_canvas` (Case 1, Case 3) and `rollback_version`. The helper function itself is also removed — RPC owns the pin now.
- C2's 23505 → 409 CONCURRENT_EDIT handling preserved: partial unique indexes on floor_plans still fire inside the RPC if a concurrent writer wins the race; caller converts to 409 and the retry takes Case 3 cleanly.
- Unit-tested at service layer: `TestCreateVersionRPCAtomicity` (3 tests) + `TestCreateVersionConcurrentEdit` rewritten against the RPC path (2 tests). All passing.

C5 — `e1a7c9b30201` downgrade now runnable (SQL reordered + RLS/trigger restored):
- Original downgrade body dropped `floor_plan_versions.property_id` and `.floor_number` in its step 6, then referenced those same columns in an UPDATE on step 7 — `alembic downgrade -1` crashed with `column does not exist` halfway through, leaving the DB half-migrated.
- Rewritten downgrade (9 steps, D1–D9) runs the `UPDATE job_rooms` repointing (D7) BEFORE the container-column drops (D8). All column references resolve correctly.
- Recreated container table now re-enables `ALTER TABLE floor_plans ENABLE ROW LEVEL SECURITY`, recreates the four `floor_plans_{select,insert,update,delete}` policies (original `ca59c5bf87c9` naming), and re-installs the `trg_floor_plans_updated_at` trigger. Rollback no longer regresses tenant isolation or timestamp maintenance.
- Verified structurally: `UPDATE job_rooms` appears at position ~6719 in the SQL, `DROP COLUMN property_id` at ~7362 → drops run after all reads. All 4 policies + trigger + RLS enable directive present. Parse check passes.
- Not executed end-to-end against a dev DB (dev is sitting on phase2's moisture migration, which doesn't exist on this branch — structural correctness verified via SQL inspection + Python AST check). The migration runs at real deploy or snapshot-restore time.

C6 — recon rooms no longer inherit mitigation's floor_plan_id:
- `_copy_rooms_from_linked_job::COPY_FIELDS` (in `backend/api/jobs/service.py`) previously included `"floor_plan_id"`, so every recon room started pinned to mitigation's v1. When recon's first save_canvas forked v2, the JOB pin moved but the ROOM pins didn't — recon's rooms referenced a frozen version their own job didn't own.
- Fix: remove `"floor_plan_id"` from `COPY_FIELDS`. Recon rooms start with `floor_plan_id IS NULL`. Recon's first save triggers the normal versioning flow (now atomic via C4's RPC) which links the rooms to the correct version.
- Secondary benefit: eliminates the `ON DELETE SET NULL` footgun where deleting mitigation's v1 would silently null out recon's rooms.
- Guardrail: the comment inside `COPY_FIELDS` explicitly names the exclusion and the reason, so future edits don't accidentally re-include it.

P2.1 — cleanup archive guard is unconditional (closes partial C1 bypass):
- `SketchCleanupRequest.job_id` changed from `UUID | None` → `UUID` (required). Pydantic now 422s any call without a job_id. Router's empty default `SketchCleanupRequest()` was removed — the body is now a required param.
- `cleanup_floor_plan` service dropped the `if job_id is not None:` conditional — always calls `ensure_job_mutable` before mutating canvas_data.
- Frontend `useCleanupSketch` hook updated to take `{ jobId, canvasData }` so future callers get the correct signature (no consumers today).
- Unit-tested: `TestSketchCleanupRequiresJobId` (2 tests) both passing.

P2.2 — RPC explicit NULL param guards:
- `save_floor_plan_version` now raises `RAISE EXCEPTION USING ERRCODE = '22023'` (null_value_not_allowed) when `p_job_id`, `p_company_id`, or `p_property_id` are NULL. Previously a NULL param would silently hit the tenant check's `NOT FOUND` path and surface as a generic "Job not found" — confusing for debugging malformed callers.
- Migration file edited in place (still unapplied: dev is on phase2's revision). No new migration needed.

**PR10 warnings (W1–W11)**

- **W1** — `save_canvas` selects `property_id` on the job row; rejects 400 `PROPERTY_MISMATCH` if the passed `floor_plan_id` lives on a foreign property. 3 unit tests.
- **W2** — `walls/service.py::_validate_shared_with_room` enforces same-company on `shared_with_room_id` before INSERT. 3 unit tests.
- **W3** — PATCH and DELETE `/jobs/{id}/floor-plans/{fp_id}` reject with 400 `JOB_NO_PROPERTY` when `job.property_id IS NULL`. No more self-referential "read property_id from the row being validated" fallback. 2 unit tests.
- **W4** — `delete_floor_plan` is now single-row. Refuses with 409 `VERSIONS_EXIST` when other versions remain on the floor; whole-floor deletes go through property-level cascade. 2 unit tests.
- **W5** — `update_floor_plan` rejects every field (not just `canvas_data`/`floor_number`) on a non-current row. Keeps version audit trail intact. 2 unit tests.
- **W6** — canvas_data payloads capped at 500 KB via Pydantic validator on `FloorPlanCreate`, `FloorPlanSaveRequest`, `SketchCleanupRequest`. 4 unit tests.
- **W7** — `_copy_rooms_from_linked_job` re-raises `APIError` as 500 `LINKED_ROOMS_FETCH_FAILED` / `LINKED_ROOMS_COPY_FAILED` instead of silently returning 0. Callers can tell empty source from broken copy. 3 unit tests.
- **W8** — `RoomDimensionInputs` flushes pending valid drafts on unmount; remount key reduced to `room.id` only; server refetch re-syncs via focus-gated `useEffect`. Frontend iOS race, verified manually.
- **W9** — cutout drag + corner-resize rejects proposed positions where any cutout corner fails `pointInPolygon(hostPoints)`. L/T/U rooms no longer let cutouts drift into the concavity. Frontend, verified manually.
- **W10** — rect room drag unconditionally resets Konva attr to `room.x/room.y` after drag so zero-delta snaps don't leave the Group floating off state. Plus: `magneticRoomSnap` edge-to-edge only + post-snap overlap check + room dragBoundFunc — rect rooms physically cannot be dropped on top of each other. Frontend, verified manually.
- **W11** — save paths now invalidate `["floor-plans", jobId]` alongside `floor-plan-history` + `jobs`. FloorSelector roomCount chip updates immediately on fork instead of waiting for staleTime. Frontend, verified manually.

**PR10 round 2 (R1–R19)**

Migrations + backend:
- **R1** — `e1a7c9b30201` downgrade typo fixed (`set_updated_at` → `update_updated_at`). 2 static guardrail tests.
- **R3** — `save_floor_plan_version` RPC hardened: JWT-derived tenant check, property + job-on-property ownership, pinned `search_path`. Error-code mapping to 403/400 on the service layer. 3 tests.
- **R4** — atomic `is_current` filter on `update_floor_plan` + `cleanup_floor_plan` UPDATEs; DB trigger for frozen-row immutability. 5 tests.
- **R5** — shared `assert_job_on_floor_plan_property` in `shared/guards.py` applied to save_canvas, rollback, cleanup. 3 tests.
- **R6** — `raise_if_archived(job)` on all 3 by-job floor-plan endpoints. 6 tests.
- **R7** — `create_floor_plan` INSERT catches 23505 → 409 `CONCURRENT_EDIT`. 2 tests.
- **R8** — helper rejects `job.property_id IS NULL` with `JOB_NO_PROPERTY`. 3 tests (one flipped from W1's old skip behavior).
- **R9** — `ensure_job_property` RPC with `SELECT … FOR UPDATE` + partial unique address index. Router refactored to single RPC call. 5 tests.
- **R10** — `walls_*` / `openings_*` RLS policies rewritten with `EXISTS` parent-ownership checks on INSERT + UPDATE. 5 tests.
- **R11** — shared `validators.py` caps `room_polygon` (10 KB), `floor_openings` (50 KB), `room_sketch_data` (50 KB), `material_flags` (20 items × 64 chars), `notes` (5000 chars). 9 tests on `RoomCreate` + `RoomUpdate`.
- **R13** — `idx_floor_plans_is_current` dropped (redundant with `idx_floor_plans_current_unique`). 3 tests.
- **R14** — `versions_*` policies renamed to `floor_plans_*`. 4 tests.
- **R16** — `update_room` wires `_recalculate_room_wall_sf` on SF-formula input changes (`height_ft` / `ceiling_type` / `custom_wall_sf`). Helper now returns the fresh value for response stamping. 3 tests.
- **R17** — `CHECK (>= 0)` on `custom_wall_sf` and `wall_square_footage` (exact names from reviewer). 4 tests.
- **R18** — `COMMENT ON COLUMN wall_openings.swing` with hinge + swing quadrant mapping + pointer to frontend source. 4 tests.
- **R19** — full-fidelity rollback: Python snapshot helper in `save_canvas` + SECURITY DEFINER `restore_floor_plan_relational_snapshot` RPC does DELETE + INSERT walls/openings + UPDATE JSONB columns atomically. 12 tests (7 migration + 3 snapshot helper + 2 rollback wiring).

Frontend:
- **R12** — `handleCreateRoomOnDifferentFloor` reconciles on `savedVersion.id` for Case 3 forks. TypeScript only; manual verification requires concurrent two-tab setup (documented).
- **R15** — `useUpdateFloorPlan` drops `canvas_data`; `useSaveCanvas(floorPlanId, jobId)` invalidates per-job cache. 6 static tests.
- **R17 UX** — inline `"Must be greater than 0"` / `"Must be at least 1"` error messaging on 4 numeric-input components (cutout editor sheet, desktop sidebar NumericInput, mobile drawing sheet, mobile tap-room sheet). 10 static tests.
- **Room-tap fix** — `MobileRoomPanel` opens reliably on mobile when `useRooms` hasn't resolved at tap time (buffer + flush on query arrival).

Product-intent decision:
- **R2** — deferred. Reviewer asked to drop `parent_pin`; under Crewmatic's linked-job model (property-anchored data shared mitigation↔recon until recon edits and forks), that code is the mechanism making sharing work. No code change; PR reply drafted.

**Round-2 totals:** 9 new Alembic migrations, 105 new pytest cases — all green. No regressions against the existing round-1 suite (C1–C6, W1–W11, P2.1, P2.2). Pre-existing `TestClient`-based tests (`TestCreateFloorPlan`, `TestUpdateFloorPlan`, `TestSketchCleanup`, etc.) continue to fail due to an auth-middleware async-mock bug on main — unrelated to round-2 changes.

**PR10 round 3 (concurrent-editing + re-review fixes)**

Migration + backend:
- **Idempotent-create** — new `ensure_job_floor_plan` RPC (migration `b8c9d0e1f2a3`) replaces the racy optimistic-create + 409 fallback. SECURITY DEFINER + JWT-derived company + `SELECT … FOR UPDATE` on jobs row + partial-unique-index retry at the router. Same security posture as every other 01H RPC. 13 tests (10 migration content, 3 router refactor).
- **Etag + If-Match + 412 VERSION_STALE** — no schema change. Etag derived from `floor_plans.updated_at` (already auto-bumped by trigger). Service layer adds optional `if_match` parameter; router forwards `request.headers.get("If-Match")`. Frontend captures etag via `FloorPlanResponse.etag` computed field, sends as header on save. Backward-compat: missing header skips the check. 9 tests (5 service + router, 4 schema + helper).
- **AppException.extra** — new optional dict field merged into the JSON error body so VERSION_STALE can ship `current_etag` without a second round-trip. 2 tests.
- **Downgrade drift fix** (Lakshman #2) — `a7b8c9d0e1f2` DOWNGRADE re-installs `restore_floor_plan_relational_snapshot` with the pre-follow-on 2-arg helper call shape so rollback leaves the schema internally consistent. 1 test.
- **Apply script deleted** (Lakshman #3) — `backend/scripts/pr10_round2_apply.sql` removed. Alembic is the single source of truth; the secondary artifact had drifted twice. Regression guard test.

Frontend:
- **`saveCanvasVersion` helper** — centralizes etag send + 412 handling across all 4 save sites (autosave, first-floor-create, cross-floor, error-recovery). Future save-contract edits touch one place.
- **Stale-conflict banner** — red banner with Reload + Dismiss buttons appears on 412; Reload invalidates all floor-plan caches and refetches. Clears `lastSavedSigRef` so dedup doesn't short-circuit the next save.
- **FloorPlan type** — optional `etag?: string` field on the TypeScript interface.

**Round-3 totals:** 3 new Alembic migrations, 26 new pytest cases — all green. No regressions. 193 tests total in the round-2+3 suite.

**Round-3 follow-through — concurrent-editing surface fully closed (2026-04-22):**

- **409 recovery branch reconciliation.** Factored the fork-reconciliation
  block from 3 inline save sites into a shared
  `reconcileSavedVersion(queryClient, jobId, sourceFloorId, savedVersion, setActiveFloorId)`
  helper in `floor-plan/page.tsx`. All 4 save sites (autosave,
  first-create, 409 recovery, cross-floor) now delegate. The 409
  recovery branch previously threw away `saveCanvasVersion`'s return —
  regressing the cache fix on the error path. Now captured + routed
  through the helper.
- **Etag extended to every mutation endpoint.** Added `if_match` param
  to `update_floor_plan`, `cleanup_floor_plan`, `rollback_version` at
  the service layer; routers forward `request.headers.get("If-Match")`.
  Every write path to `floor_plans` now has the same 412 VERSION_STALE
  contract. A stale cleanup, rollback, or PATCH can no longer silently
  overwrite an in-flight save.
- **Shared etag module.** Consolidated `compute_etag` (schemas.py) and
  `_coerce_etag` (service.py) into a single `api/shared/etag.py` module
  exporting `etag_from_updated_at` + `etags_match`. The two helpers had
  diverged on the None case (returning `None` vs `""`), causing a
  silent falsy-check on the frontend to skip If-Match headers. Unified;
  the backend now returns `etag: null` (not `""`) when `updated_at` is
  absent so the frontend's check is correct.
- **Parse-based etag comparison.** Replaced raw string equality with
  `etags_match` which `datetime.fromisoformat`-parses both sides. Fixes
  microsecond-precision formatting drift (`"+00:00"` vs
  `".000000+00:00"`) producing spurious 412s. Falls back to string
  equality on non-ISO inputs so hand-crafted etags still work.

Field-tool concurrent-editing scenario now fully covered (all 4 mutation paths):
- **Same-second concurrent create** (two techs both first-create on the same job) — serialized by `ensure_job_floor_plan` RPC; both callers converge on the same row, no 409 to handle.
- **Sequential-edit lost-update on save_canvas** — caught by etag mismatch → 412 → reload banner.
- **Stale cleanup overwrites in-flight save** — now caught by etag check in `cleanup_floor_plan`.
- **Rollback races with concurrent save** — now caught by etag check in `rollback_version`.
- **PATCH on stale metadata** — now caught by etag check in `update_floor_plan`.

**PR10 Round 5 (ETag contract closure, 2026-04-22):**

Closes all 6 findings from Lakshman's round-4 review (2×P1, 2×P2, 2×P3). The theme from the lessons doc: *fix at invariant scope, not code-location scope*. Round-3 shipped the contract across 3 layers but only the Case-2 write path was end-to-end; every other write path had a TOCTOU hole of some shape. Round 5 closes them by declaring 4 invariants up front and pinning each with tests.

Migration + backend:
- **Etag atomicity via RPC param** — new migration `c9d0e1f2a3b4` adds `p_expected_updated_at TIMESTAMPTZ DEFAULT NULL` to both `save_floor_plan_version` (Case 3 fork path) and `rollback_floor_plan_version_atomic`. The flip UPDATE inside `save_floor_plan_version` carries `AND updated_at = p_expected_updated_at` — zero rows flipped with a current row present ⇒ raise `55006 VERSION_STALE`, mapped in Python to 412. Discriminates stale-etag from first-save via follow-up `PERFORM … IF FOUND`. Downgrade DROPs the new 9-arg/5-arg overloads first (different arity = different Postgres object), then recreates pre-change forms — symmetric per lesson #10. Closes Lakshman P1 #1 + P3 #5 in one change (option 2 in the Opus/Codex split). 11 tests.
- **`If-Match` now required** — new `api/shared/dependencies.py::require_if_match()` helper raises 428 `ETAG_REQUIRED` on missing header; returns `None` on the explicit `If-Match: *` opt-out marker (standard HTTP for "any representation"); returns the header value otherwise. Wired into all 5 mutation endpoints (`save_canvas_endpoint`, `update_floor_plan_endpoint`, `update_floor_plan_by_job_endpoint`, `rollback_version_endpoint`, `cleanup_endpoint`). The silent-skip `request.headers.get("If-Match")` pattern is gone from every route. 6 tests + sibling-miss grep pin.

Frontend:
- **Conflict-draft persistence on 412** — `handleStaleConflictIfPresent` helper writes the rejected canvas to `canvas-conflict-draft:${jobId}:${sourceFloorId}` localStorage key BEFORE the reload nukes Konva state. `sourceFloorId` is captured BEFORE the await (`postTimeSourceFloorId` for autosave, `targetFloorIdForConflict` for cross-floor) so the draft routes to the floor the save was AGAINST, not whatever `activeFloorRef` moved to. A mount effect scans the `canvas-conflict-draft:${jobId}:*` prefix on next load, picks the most recent, surfaces a Restore / Discard banner — no auto-apply. Restore re-routes through `handleChange` (full save pipeline with fresh etag). 4 tests.
- **Autosave in-flight guard** — module-scoped `_canvasSaveInFlight` + `_canvasDeferredDuringSave` flags. If `handleChange` fires while a save is in-flight, it updates `lastCanvasRef` + sets the deferred flag + returns without POSTing. In the save's `finally`, `queueMicrotask(() => handleChangeRef.current(deferred.data))` replays — microtask scheduling ensures `reconcileSavedVersion`'s fresh etag is in cache before the replay reads it. Prevents self-412 on slow networks where POST RTT > 2s debounce. Part of the 4 INV-3/4 tests above.
- **`If-Match: *` fallback for first-saves** — `saveCanvasVersion` sends the wildcard when no cached etag is available, so the backend's `require_if_match` doesn't 428 a legitimate creation flow.
- **`FloorPlan.etag` narrowed** from `string | null | undefined` to `string | undefined`; new exported `hasEtag(fp)` type guard forces explicit narrowing at consumer call sites. Closes P3 #6.
- **Dead `useSaveCanvas` hook deleted** — zero consumers, would have bypassed require-If-Match if re-wired. Test `test_use_save_canvas_hook_stays_deleted` guards against it coming back.

Lessons doc:
- **`docs/pr-review-lessons.md`** rebuilt as first-class committed doc (previous "local working notes" version was lost to a parallel-session cleanup). 21 meta-patterns across rounds 1-4 + INV-1/2/3/4 discipline + pre-PR grep checklist with round-4 additions. Any future cross-cutting contract must be preceded by a written invariant list.

**Round-5 totals:** 1 new Alembic migration, 21 new pytest cases (plus 2 round-3/4 tests updated + 4 round-2 tests collapsed into 1 regression guard) — all green. Zero regressions. 214 tests total in the round-2+3+4+5 suite.

Field-tool concurrent-editing matrix (what round 5 adds over round 3):
- **Writer-A lands Case-3 fork during Writer-B's Python etag check** — round 3's Python check passed (B's view was "fresh" when B read). Round 5 catches it: `save_floor_plan_version` rejects B's RPC because the current row's `updated_at` no longer matches B's expected. 412 VERSION_STALE instead of silent demotion of A's work to frozen history.
- **Single-user rapid-edit on slow network** — round 3 could 412 the user against their own in-flight save. Round 5 serializes via in-flight guard; the deferred second save replays with the fresh etag after the first commits.
- **User hits 412 and reloads** — round 3 banner said "re-apply your edits" but `window.location.reload()` had nuked Konva state — the banner was lying. Round 5 persists the rejected canvas to localStorage before the reload and surfaces a restore banner on next load.
- **Missing-header integrations (Postman, external scripts, legacy clients)** — round 3 default-allowed them (last-write-wins). Round 5 rejects with 428 `ETAG_REQUIRED`. Standard HTTP opt-out via `If-Match: *` for creation flows.

Product-intent decision (carried over, still valid):
- **R2** — linked recon shares mitigation's property-anchored data. Reviewer accepted this in round 3 with a follow-up ask for a PR-body tweak on the C6 bullet and a cross-reference comment in COPY_FIELDS.

---

## Cumulative Test Coverage (Phase 2 — Automated + Manual QA)

Phase 2 ships with frontend test infrastructure that Phase 1 deferred: extracted pure logic + RTL integration over the moisture-reading flow + the Moisture Report View (Tasks 6+7). Automated totals as of 2026-04-23 (sprint close, post-review-round-2 fixes): **114 frontend vitest cases across 10 files**, **37 backend pytest cases across `test_moisture_pins.py` + `test_moisture_pins_archive_guard.py`** plus **24 cases in `TestPublicSharedView`** (round 2 added 2: `moisture_pins_apierror_unavailable` pinning the new "unavailable" discriminant state, `photos_only_omits_primary_floor_id` pinning the scope-gate). Typecheck + lint clean. Full suite runs in ~1.6s frontend.

> **Note on pin + dropdown positions.** Pin coordinates are stored in `moisture_pins.canvas_x` / `canvas_y` columns (Decimal, normalized floor-plan space). Any drag writes to those columns via `PATCH /moisture-pins/{id}`, and the Moisture Report View reads the *current* values at render time. There is no per-date position snapshot — the pin's spatial location is a property of the pin, not the reading. So if you move a pin or reposition a room, the report reflects the new layout immediately on next fetch; historical *readings* stay attached to the pin regardless of where it sits. Dropdowns (floor + snapshot-date) are URL-param driven on the portal route and local state on the tech route; they re-render the canvas without invalidating any cache.

### Automated — Backend (pytest)

- **Color compute** — boundaries at `dry_standard`, `dry_standard + 10`, and above. Covers the red / amber / green truth table and the regression edge case where latest == previous (not flagged).
- **Regression compute** — strict `>` semantics (equal consecutive values do NOT flag).
- **CRUD** (`test_moisture_pins.py`, 16 cases) — pin create / update / delete, reading create / update / delete, RLS cross-tenant isolation, atomic `create_moisture_pin_with_reading` RPC rollback on failure, whitespace-drop rejection (room_id required), polygon validation (pin placement rejected when canvas coordinates fall outside the target room's polygon).
- **Archive guard** (`test_moisture_pins_archive_guard.py`, 21 cases) — every mutation endpoint (pin create / patch / delete, reading create / patch / delete) returns 409 when the parent job is `archived`; read endpoints (list pins, list readings) return 200 so the tech can still open Moisture Mode in read-only view.
- **Sharing payload — moisture scope gate** (`test_sharing.py`, 3 new cases in `TestPublicSharedView`) — `restoration_only` and `full` scopes emit `moisture_pins[]` + `floor_plans[]`; `recon_only` omits both arrays; expired/revoked tokens 404 without leaking pin data.

### Automated — Frontend (Vitest + React Testing Library)

Organized by risk surface:

**Pure derivation logic (`src/lib/__tests__/`):**
- `moisture-reading-history.test.ts` — 33 cases. Anchors `deriveReadingHistory` (empty, single, ascending-regression, descending-dry, equal-plateau boundary, mixed up/down, out-of-order input sort, no-mutation contract), `findTodayReading` (today-hit, today-miss, empty), `validateReadingInput` (empty / non-numeric / negative / >100 / decimal / 0 + 100 boundaries), `isChangedFromToday` (5 state combinations including the subtle "user cleared the prefilled input" case), plus **11 new cases for `computePinColorAsOf`** (snapshot date before first reading → null; snapshot on exact reading date returns that reading's color; snapshot between readings returns the most-recent-on-or-before; future snapshot returns latest; dry_standard boundary / +10 boundary colors; out-of-order input still sorts; empty array → null; single-reading happy path; stale snapshot beyond all readings).
- `moisture-room-status.test.ts` — 7 cases. Worst-pin-wins truth table for Drying Progress / canvas room-label tint.
- `dates.test.ts` — 7 cases. `todayLocalIso()` pinned at **8 PM US Pacific** (the exact regression anchor), year boundary, YYYY-MM-DD shape invariant; `formatShortDateLocal()` on valid / malformed / empty; symmetric write/read round-trip guard.
- `canvas-room-resolver.test.ts` — 15 cases. Three resolvers covering: prefer `propertyRoomId` when present; fall back to unambiguous name match; return null on duplicate-name ambiguity (never arbitrary pick); trim + case-insensitive comparison; empty / whitespace-only inputs rejected; no-mutation contract on the input arrays. Guards the drag-to-new-room flow from wiring a pin to the wrong `job_rooms.id` when two rooms share a name.

**Integration (`src/components/sketch/__tests__/`):**
- `moisture-reading-sheet.test.tsx` — 14 cases. Loading skeleton renders with `aria-busy` while the readings query is pending and swaps cleanly to real history on arrival. Last-reading trash is disabled with the correct hint aria-label; ≥ 2 readings all enable with row-specific labels. ConfirmModal opens with row value + formatted date, Cancel closes without mutating, Confirm calls the delete mutation with the exact reading id. Today's-reading prefill is verified at **8 PM US Pacific frozen-clock** so a future regression back to UTC-based `today` fails this test. Edit chip visibility is conditional on `onEditRequest` prop; clicking fires the prop with the pin id. **Two new cases**: (a) cold-open prefill — sheet opens before readings query resolves, data lands post-mount, input re-seeds from today's row via the `(pin.id, todayReading.id)` two-key effect; (b) user-typed lock — once `userTypedRef` flips, subsequent query settles do NOT overwrite the in-progress value even when today's reading id changes mid-flight.

**Integration (`src/components/moisture-report/__tests__/`):**
- `moisture-report-view.test.tsx` — 5 cases. (1) Multi-reading render: pins draw at their canvas coords with the color computed for the selected snapshot date, value label is the reading on/before that date. (2) Date-picker change re-derives color + value without remount (same pin nodes, different fills). (3) Per-date rollup in the summary table matches the canvas colors and the "Dry Date" column populates from `dryMilestone.firstDryDate`. (4) Empty state consolidation — when no pins are visible for the selected floor+date, a single "No moisture pins" message renders at the view level (not duplicated by the summary table). (5) Snapshot-before-birth — pins whose earliest reading postdates the selected snapshot are filtered out of canvas + table + rollup, consistent across all three surfaces.

### Manual QA (verified in the browser by the user during this session)

**Pin placement + moisture mode**
- Toggle Moisture Mode → sketch layers dim to 30%, toolbar filters to mode-relevant tools, Pin tool becomes active.
- Tap inside a room → placement sheet opens with surface + position chips, material dropdown (defaults to room material when set), `dry_standard` pre-fills from the material dict and is editable, initial reading input.
- Tap outside any room → inline nudge ("Tap inside a room to drop a pin") appears and auto-fades.
- Save creates the pin on canvas at the tapped coordinates, color-coded (red / amber / green) by the backend compute, with the reading value rendered inside the circle.

**Reading logging**
- Tap existing pin with Pin tool in Moisture Mode → reading sheet opens. If today's row exists, the input prefills to that value.
- Save creates or silently upserts today's reading — no ConfirmModal (the history list makes the existing value self-evident).
- Pin color on canvas and reading value inside re-derive from the new latest value without a refresh.
- Day-over-day regression banner fires when latest strictly exceeds previous; per-row `↑ up` chevron marks individual rows that increased vs the row before them.

**History panel**
- Sparkline renders with `D1…DN` day labels beneath each dot, dashed dry-standard line with inline `16%` label at its right end, color-matched latest-value callout above the (enlarged) latest dot.
- History list newest-first, reading count in the header, per-row color dot matches the on-canvas pin color.
- First-open loading skeleton pulses the sparkline slot + two ghost list rows with `aria-busy="true"`; swaps cleanly to real history once the query settles (no layout jump).

**Delete reading flow**
- Trash button muted by default on desktop, turns red on hover (`bg-red-100` circle + red icon); on touch devices it renders in muted red by default (via `[@media(hover:none)]`) so clickability is discoverable without a hover signal.
- Last-reading row: trash disabled at `opacity-30` with the hint `"Last reading — delete the pin instead"` in both `title` and `aria-label`.
- Click active trash → ConfirmModal with `"Delete reading? The X% reading from <date> will be removed. This can't be undone."` Danger variant (red Confirm button).
- Confirm → row fades to opacity-40 during in-flight DELETE (`pendingDeleteIds` set), disappears on success; pin color recomputes on canvas from the new latest (or goes neutral gray only if we bypassed the last-reading guard — which is impossible via UI).
- Cancel / backdrop tap / Escape → modal closes, no network, no mutation.
- Rapid double-tap on the same trash → second tap is absorbed by `pointer-events-none` during the pending window; no duplicate DELETE lands.

**Edit pin flow**
- Edit chip (rounded-lg brand-accent/10 tint) in the reading-sheet header opens the edit sheet layered on top.
- Material dropdown lists all options with their `X% std` defaults; selecting a new material auto-fills the dry_standard with its default and surfaces a "Reset to default" affordance when the value diverges.
- Update → mutation fires; on success **both sheets close** (no redundant return to the reading sheet); pin color and sparkline recompute from the new dry_standard on canvas.
- Cancel → only the edit sheet closes; reading sheet stays open (user can still log a reading).

**Room rollup + drying progress**
- Room polygon label tints red / amber / green in Moisture Mode by worst-pin-wins across pins inside that room's polygon.
- Drying Progress card on `/jobs/<id>` lists only rooms with ≥ 1 pin, mitigation-only (never shown on recon-linked jobs).
- Deeplink from the card (`?mode=moisture`) lands on the floor-plan page pre-switched to Moisture Mode with the target room visible.

**Timezone regression guard (the bug that nearly shipped)**
- Simulated 8 PM local Pacific (system clock at `2026-04-22 20:00:00` with UTC already reading `2026-04-23 03:00Z`) → `todayLocalIso()` returns `2026-04-22`, reading writes with `reading_date=2026-04-22`, display reads "Apr 22" in the history row. Next-morning Wednesday log has its own `reading_date=2026-04-23` — no upsert collision.
- Pinned at unit-test level in `dates.test.ts` and at integration-test level in `moisture-reading-sheet.test.tsx`. A regression would fail both.

**Canvas + mode integration carried forward from Task 2/3 work**
- Pin drag within the room polygon snaps back to the last valid position on fail-closed polygon check.
- Pins translate with their host room when the room is moved / resized (optimistic TanStack cache update — no visual lag waiting for refetch).
- Wall-sync circuit breaker (per-session bad-id set) prevents an invalid room polygon from stampeding save attempts.

**Manual QA — Moisture Report View (Tasks 6+7)**
- Tech route (`/jobs/<id>/moisture-report`) renders with floor dropdown + snapshot-date picker + canvas + summary table + print button. Canonical floor names (Basement / Main / Upper / Attic) appear in the dropdown for floor_numbers 0–3 regardless of stored `floor_name`.
- Per-floor isolation — pins placed on Upper never leak into the Main floor view; backed by `moisture_pins.floor_plan_id` joined through `job_rooms`. Verified by placing pins on two floors and switching the dropdown.
- Snapshot-date picker — moving the date earlier than a pin's first reading hides that pin from canvas + summary + rollup; moving forward restores it. No grey "no-data" pins in the historical view — hidden means hidden.
- Mobile (<500px viewport) — pin radius scales down to 9px / 8px font; floor dropdown stays visible; canvas shrinks proportionally via ResizeObserver without overflowing parent.
- Portal route (`/shared/<token>/moisture?floor=<id>&date=<iso>`) — same view rendered from `/v1/shared/resolve` payload; `restoration_only` and `full` scopes populate moisture_pins + floor_plans, `recon_only` returns empty arrays.
- Print button (`window.print()`) — CSS `@media print` + `.print-section` class strips chrome; floor-plan canvas + summary table print on a single page for carrier documentation.
- Archived job — tech can still open Moisture Report and view historical readings; every mutation attempt surfaces as a 409 disabled state (no write affordances rendered).

### Explicitly out-of-scope for Phase 2 automated coverage

- Pixel-exact sparkline SVG geometry. Covered by presence + data-flow assertions, not coordinate math.
- Drag-to-dismiss touch gestures on modal sheets. jsdom's touch event support is shallow; the mechanic is shared with `moisture-placement-sheet.tsx` + `cutout-editor-sheet.tsx`, exercised in Phase 1 manual QA.
- Konva canvas interaction (drag, pan, tap resolver). The canvas stack is Konva-controlled; covered by the manual QA sweep above. The Moisture Report canvas is render-only (no drag / tap) so Konva is mocked via `vi.mock("react-konva")` in the view tests.
- Actual PDF rasterization. We use `window.print()` + print CSS rather than a headless-chromium PDF pipeline; the "PDF" is whatever the OS print dialog produces. No byte-level output comparison — the single-page-fits assertion is manual.

---

## Phase 2 — Known limitations / follow-ups

Non-blocking. Captured here so they surface in the first critical-review sweep instead of being forgotten.

- ~~**PDF export (Task 6)**~~ — ✅ Shipped 2026-04-23 as `window.print()` + `@media print` CSS against the shared `MoistureReportView` component (see "Moisture Report View — Tasks 6 + 7" changelog entry above). No headless-chromium PDF service; OS print dialog produces the file.
- ~~**Adjuster portal moisture view (Task 7)**~~ — ✅ Shipped 2026-04-23. Route: `/shared/<token>/moisture?floor=<id>&date=<iso>`. Reuses `moisture-reading-history.ts` + `MoistureReportView` / `MoistureReportCanvas` components — zero algorithm duplication between tech and portal.
- **Reading-sheet atmospheric integration** — atmospheric fields (room temp / RH / GPP) are NOT yet wired into the reading sheet flow; they live on the legacy atmospheric-readings page noted in `feedback_readings_ux.md`. Phase 2 scope is spatial pins only; atmospheric integration is a Phase 3 or post-V1 decision.
- **Undo after delete** — no soft-delete path. Backend endpoint is a hard delete; the last-reading guard prevents the most obvious "oh no" case. Acceptable for V1.
- **Reading edit (value)** — no UI for editing a past reading's value (only deletion). Backend `PATCH /readings/{id}` exists but is not exercised by any frontend surface. Techs who mis-type typically delete + re-log; if this turns out to be high-friction in field testing, a pencil affordance per row is a small follow-up.

---

*Created: 2026-04-15. Source: Brett's Sketch & Floor Plan Tool Product Design Specification v2.0 (April 13, 2026). Eng review: 2026-04-16. Round 2 hardening: 2026-04-22. Round 3 hardening: 2026-04-22. Phase 2 in progress 2026-04-23.*
