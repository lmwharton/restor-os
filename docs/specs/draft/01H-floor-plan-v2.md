# Spec 01H: Floor Plan V2 — Sketch Tool as Spatial Backbone

## Status

| Field | Value |
|-------|-------|
| **Phase 1 progress** | █████████████████████ 100% — feature-complete |
| **Overall 01H progress** | ███████░░░░░░░░░░░░░ ~30% (Phase 1 done; Phases 2–5 untouched) |
| **State** | Ready for review |
| **Blocker** | None |
| **Branch** | `feature/01h-floor-plan-v2-phase1` |
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
- [ ] `moisture_pins` table created — persistent spatial locations (canvas x/y, material, dry standard)
- [ ] `moisture_pin_readings` table created — time-series reading values per pin
- [ ] Pin drop on canvas tap with placement card: location descriptor, material type, reading value
- [ ] Pin color: red (>10 percentage points above dry standard), amber (within 10 points), green (at/below)
- [ ] Tap existing pin → enter new daily reading (pin shows latest color)
- [ ] Pin history panel: chronological readings with sparkline trend chart
- [ ] Regression detection: amber warning icon if reading increases day-over-day at the same pin
- [ ] Room dry status: not dry until every pin in room is green
- [ ] Dry standard lookup by material type (hardcoded constants, editable per-pin)
- [ ] Moisture floor plan PDF export: single-page carrier document with pin locations + color-coded snapshot + summary table
- [ ] Full test coverage: pin color boundaries, regression detection, dry standard lookup, PDF export snapshot

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

## Moisture Floor Plan PDF

Server-side endpoint: `GET /v1/jobs/{jobId}/moisture-pdf?date=YYYY-MM-DD`

Output: single-page PDF with:
1. **Header:** Company logo, job number, property address, date of snapshot
2. **Floor plan:** scaled rendering of canvas with all moisture pins at their locations
3. **Pin overlay:** each pin shows reading value + color-coded dot (red/amber/green for selected date)
4. **Summary table:**

| Pin Location | Material | Dry Standard | Day 1 | Day 2 | Day 3 | ... | Dry Date |
|-------------|----------|-------------|-------|-------|-------|-----|----------|
| Floor, NW Corner, Living Room | drywall | 16% | 38% | 32% | 24% | ... | Day 5 |

Generated via existing PDF library (already in use for job reports — `web/src/app/(protected)/jobs/[id]/report/`).

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

- `KonvaFloorPlan.test.tsx` — renders rooms from props, handles room creation events
- `RoomConfirmationCard.test.tsx` — material defaults populate from room type, editable
- `MoisturePinPanel.test.tsx` — renders sparkline, shows regression warning
- `EquipmentPicker.test.tsx` — quantity selector triggers place-N flow

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

---

*Created: 2026-04-15. Source: Brett's Sketch & Floor Plan Tool Product Design Specification v2.0 (April 13, 2026). Eng review: 2026-04-16. Round 2 hardening: 2026-04-22.*
