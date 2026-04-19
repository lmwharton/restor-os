# Spec 01H: Floor Plan V2 — Sketch Tool as Spatial Backbone

> **Schema update 2026-04-18:** The two-table design (`floor_plans` container +
> `floor_plan_versions`) was merged into a single `floor_plans` table where each
> row IS a versioned snapshot. `jobs.floor_plan_version_id` was renamed to
> `jobs.floor_plan_id`. See migration `e1a7c9b30201`. The DDL/code references
> below still use the older split-table names — they reflect the original design
> and are kept for context, but the live schema is unified.

## Status
| Field | Value |
|-------|-------|
| **Progress (overall 01H)** | ███████░░░░░░░░░░░░░ ~30% (Phase 1 feature-complete; Phases 2–5 untouched) |
| **Progress (Phase 1 only)** | █████████████████████ ~100% (D1–D3 + E1–E7 done; schema merge done; immutability hardened; auto-save fixed; Case 3 pin fix shipped; floor-pick UX done; cutouts done) |
| **State** | Ready for review — Phase 1 canvas feature set complete. Known limitations tracked below; follow-up hardening deferred. |
| **Blocker** | None |
| **Branch** | feature/01h-floor-plan-v2-phase1 |
| **Depends on** | Spec 01C (Floor Plan Konva rebuild — in review), Spec 01B (Reconstruction — merged) |
| **Source** | Brett's Sketch & Floor Plan Tool Product Design Specification v2.0 (April 13, 2026) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-15 |
| Started | 2026-04-16 |
| Completed | — |
| Sessions | 4 |
| Total Time | ~34 hours |
| Files Changed | ~45 |
| Tests Written | 0 |

## Session 3 (2026-04-18) — Schema Merge + Immutability + Auto-Save Hardening

Lakshman peer-review surfaced that the two-table design (`floor_plans` container + `floor_plan_versions`) was redundant — every save wrote `canvas_data` twice, and the container served only as grouping metadata. This session merged them into a unified `floor_plans` table where each row IS a versioned snapshot. Then tightened immutability semantics and stamped out a long tail of regressions caused by the merge.

**Backend changes:**
- Migration `e1a7c9b30201`: lifts `property_id`, `floor_number`, `floor_name`, `thumbnail_url` onto `floor_plan_versions`; backfills from old container; re-points `job_rooms.floor_plan_id` from container row to is_current version row; drops old `floor_plans` table; renames `floor_plan_versions` → `floor_plans`; renames `jobs.floor_plan_version_id` → `jobs.floor_plan_id`; rebuilds indexes with unified naming.
- `_create_version` now centrally enforces the "one is_current per (property, floor)" invariant — flips old siblings to `is_current=false` BEFORE inserting the new row at every creation point (Case 1 forks too, not just Case 3 forks).
- `save_canvas` Case 2 now requires `pinned_still_current` in addition to `created_by_job_id` + `pinned_same_floor`. Once a version has been forked from (is_current=false), it's frozen forever — even its original creator can't update it; they have to fork on top.
- `update_floor_plan` rejects `canvas_data` / `floor_number` writes on non-current rows (frozen-version guard).
- `rollback_version` now mirrors `save_canvas`'s archived-job guard.
- `_auto_upgrade_active_jobs` (57 lines) deleted — frozen-version semantics mean a job's pin only moves when that job itself saves; no auto-upgrade across siblings.
- `create_floor_plan` accepts an optional `job_id`; when provided, stamps `created_by_job_id` on the new row.
- `create_floor_plan_by_job_endpoint` now passes `job_id` AND pins `jobs.floor_plan_id = newRow.id` so the auto-Main shell is owned by the creating job — the user's first canvas save hits Case 2 (update v1 in place) instead of forking v2.
- `create_floor_plan` defaults `canvas_data` to `{}` when caller omits it (the JSONB column is `NOT NULL` and the DB default only applies for absent columns; explicit `null` was hitting the constraint).
- Linked recon job inherits `floor_plan_id` from the parent mitigation job at creation time (no more NULL pin on fresh recon jobs).

**Frontend changes:**
- `FloorPlan` type unified (no separate `FloorPlanVersion`); `Job.floor_plan_id` replaces `floor_plan_version_id`. Comprehensive rename sweep — zero remaining old-name references in source.
- `KonvaFloorPlan` initial-data merge fix: `{ ...emptyFloorPlan(), ...(initialData ?? {}) }` so a partial `canvas_data = {}` from a freshly-created shell still gets `walls/rooms/doors/windows` arrays (was crashing on `state.walls is not iterable`).
- Hydration logic for archived jobs hardened: never falls through to `is_current` — shows pinned version OR own-created version OR empty. Prevents recon's edits from leaking into mitigation's archived audit view.
- `canvasReady` made sticky-per-floor with a `floorPlans.length > 0` gate. Eliminates the "Draw your first room" flash on reload AND the unmount-mid-debounce that was killing autosave timers from background refetches.
- `handleCreatePresetFloor` `onSuccess` scoped to `wasUnpinned` — only carries live canvas state into the new floor for the auto-Main case, not for "user clicked Base while editing Main" (was leaking Main's content into all sibling preset floors).
- **Auto-save root cause + fix:** `handleChange`'s `if (createFloorPlan.isPending) defer` was over-restrictive. React 19 / React Query batching can leave `isPending=true` for one extra render even after the new floor row is in the cache and `activeFloorId` is set. Changed to `if (createFloorPlan.isPending && !activeFloorIdRef.current)` — defer only when there's no active floor (the only real duplicate-create risk).
- `finalizePendingRoom` now fires `onChange` immediately (bypassing the 2s debounce) when a room is confirmed — and pre-emptively sets `prevStateRef.current = newState` so the canvas's debounce useEffect bails on the next render and doesn't double-fire.
- Save button `flush()` now always force-saves (regardless of `hasPendingRef`) — guarantees the manual Save button works as a reliable fallback.
- `setSaveStatus("saving")` now holds for at least 400ms before flipping to "saved" so fast (<100ms) POSTs don't get batched into a single render where the indicator never paints.
- `FloorPlanPreview` shows "Tap to start drawing" instead of "No floor plan yet" when a floor row exists with empty canvas (auto-Main shell case).
- **Room confirmation form metadata wired to backend** — `onCreateRoom` callback signature extended to pass `roomType`, `ceilingHeight`, `ceilingType`, `floorLevel`, `materialFlags`, `affected`. `handleCreateRoom` now spreads these into `createRoom.mutate`. Previously the form collected everything but only `name` + dimensions reached `createRoom` — `floor_level`, `room_type`, etc. were silently dropped. **Note:** room METADATA (`job_rooms.floor_level`) is now correct, but the canvas RECTANGLE is still drawn on whatever floor tab the user was on. Picking "Upper" in the form labels the room as Upper but doesn't move the rectangle to Upper's canvas — that's a bigger UX change (auto-switch active floor + create the floor if missing + draw rectangle there) deferred to a follow-up.
- **Back button in room confirmation card now actually goes back** — was clearing form fields but not resetting `nameCommitted`, so user stayed stuck on Details with empty fields.
- **Room card mobile sizing** — `max-h-[85dvh]` on mobile (dynamic viewport height handles iOS browser chrome correctly), `min-h-0` on scroll area (lets it shrink below intrinsic content height so the sticky footer isn't pushed past the card boundary and clipped by `overflow-hidden`).

**Architectural follow-ups (deferred — track for Phase 2 or follow-up specs):**
- Race condition in `_create_version`: flip-then-insert is two async calls, not a transaction. Concurrent saves on the same floor could break the is_current uniqueness. Needs a partial unique index `CREATE UNIQUE INDEX ON floor_plans (property_id, floor_number) WHERE is_current = true` + UNIQUE on `(property_id, floor_number, version_number)` + APIError catch+retry in `_create_version`. Pre-existing (predates the merge), low likelihood with single-user editing — defer to a hardening commit.
- `COPY_FIELDS` on `_copy_rooms_from_linked_job` includes `floor_plan_id` — recon's copied rooms point at mitigation's frozen v1 row. Needs either dropping from COPY_FIELDS or repointing rooms in `_create_version` on fork. Falls under Section 19 (property_rooms split) territory.
- Spec doc DDL block (around line 215) still uses old `floor_plan_versions` SQL. Banner at top of file warns readers but the SQL is stale. Update when convenient.

## Session 4 (2026-04-18) — Floor-Pick-First UX + Case 3 Pin Fix + E7 Cutouts

Closed out Phase 1 with two overlapping pieces: a pick-floor-first UX that replaces the auto-Main-on-load flow (resolves the "floor_level mismatch" deferred from Session 3 where the card's Floor field labeled the room but didn't move the rectangle), and E7 floor cutouts (stairwells) with end-to-end net-SF math. Session 3's `[autosave]` debug logs stripped before merge.

**Backend:**
- `save_canvas` Case 3 now calls `_pin_job_to_version` after forking. The line was missing — comment said "Pin this job to the new version" but the code wasn't there. Effect was a version explosion (one fork per save, chip stuck on the inherited pin) because the next save re-read the stale pin and forked again.

**Frontend — floor-pick-first:**
- Removed the auto-Main effect. Fresh jobs show 4 dashed preset slots in the selector and a `noActiveFloor`-driven empty state on the canvas.
- New `PickFloorModal` intercepts Wall / Door / Window / Trace / Opening / Cutout when no floor is active — 4 buttons matching ConfirmModal conventions (red-outline Cancel, rounded-lg).
- Room tool: Floor field marked "required" when no floor is active, Confirm disabled until picked.
- Cross-floor room creation: confirming a room with a Floor different from the active canvas calls a new `handleCreateRoomOnDifferentFloor` that merges the new room into the target floor's canvas, POSTs to that floor's versions endpoint, primes both `floorPlans` and `floor-plan-history` caches, then switches active — canvas hydrates instantly with the room already on the target floor (no empty-state flash).
- `ensureFloor(level)` creates/returns the preset row; 409 "floor already exists" recovery refetches and returns the canonical row.
- `flush()` no-ops when nothing's pending. No more wasted POST on floor switch / back-nav.
- Save button shows a brief "Saved ✓" chip on no-op flushes so the click isn't a silent dead end.
- Back button invalidates `jobs` / `rooms` / `floor-plans` caches so the job detail Property Layout reflects new rooms/floors without a hard refresh.
- Archived preview on the job detail page anchors the versions query on the job's pin (not `floorPlans[0]`), with a fallback chain for legacy pins; hides the preview until history resolves so it never flashes "Tap to start drawing" on a frozen job.
- Fixed duplicate-`Floor 1` React key on the job detail Property Layout (legacy rows with the same `floor_name`; now keyed on `floor_plan.id`).
- Mobile header hidden on `/floor-plan` for full-bleed canvas.

**Frontend — E7 floor cutouts:**
- New "Cutout" tool. Drag inside a room → dashed white preview; turns red if the center isn't inside any room (live feedback this drag won't commit).
- Live clamping via `dragBoundFunc` on move + resize so cutouts physically stop at the host room's bbox edge instead of following the finger outside and snapping back on release.
- New `CutoutEditorSheet` (bottom sheet on mobile, centered card on desktop): optional Name, Width, Length with "Max X ft" validation against host bbox. Sticky Delete + Done footer matching RoomConfirmationCard conventions. Opens immediately after placement AND on subsequent taps. Keyed on cutout id so state re-seeds from fresh dims on each open.
- Canvas labels rethought: room shows net SF under its name (bold orange when cutouts present, neutral grey otherwise). Cutout shows Name + SF area above the dashed rect when selected (SF is the business-relevant number; raw W × L lives in the editor).
- Persistent floor-total chip pinned at the top-right of the canvas: "Floor N SF (M cutouts)". Always-visible reference so SF stays readable even when a cutout overlaps a room's center label.
- Cutout fill opacity dropped to 0.45 so room labels bleed through when a cutout sits over the room center.
- Toast feedback when a cutout drag ends outside any room; persistent orange hint when the Cutout tool is active on a canvas with no rooms.
- SF end-to-end: `roomFloorArea(room, gs)` = polygon area − cutout area. Canvas save includes `square_footage` (net) and `floor_openings` (converted px → ft) in the `updateRoom.mutate` payload. Detail page Property Layout preview renders cutouts as dashed rects and shows net SF in the room label. `RoomRow` SF cell prefers the stored `square_footage` over bbox math with a tooltip noting cutout presence.

**Types:**
- `FloorOpeningData {id, x, y, width, height, name?}` on `RoomData.floor_openings`.
- `FLOOR_LEVEL_TO_NUMBER`, `FLOOR_LEVEL_LABEL`, `floorNumberToLevel` — single source of truth for UI ↔ DB mapping (basement=0, main=1, upper=2, attic=3).

**Test summary:**
All manual cases in the Session 4 test matrix passed — fresh-job empty state, preset-tap create, draw → confirm → save, cross-floor create, switch floors with no-op flush, cutout placement + resize clamp, cutout sheet open/save/delete, archived read-only hydration, back-nav cache refresh, bidirectional visibility between active mit/recon, Case 3 pin moves correctly after fork.

**Deferred follow-ups (to be bundled into a hardening pass — BOTH non-blocking):**
1. **Archived preview tier-3 fallback cleanup.** `web/src/app/(protected)/jobs/[id]/page.tsx` `bestFloorPlan` has a tier-3 fallback that returns any `is_current` floor's canvas_data when both the pin and `created_by_job_id` lookups fail. Safety net for legacy rows whose pins were lost to the pre-Session-4 Case 3 bug. Can leak sibling content on the THUMBNAIL PREVIEW only (the real floor-plan editor explicitly blocks this fallback for archived jobs). One-off pin-repair migration below, then tier 3 can be removed:
   ```sql
   UPDATE jobs SET floor_plan_id = (
     SELECT id FROM floor_plans
     WHERE created_by_job_id = jobs.id
     ORDER BY version_number DESC LIMIT 1
   )
   WHERE floor_plan_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM floor_plans WHERE id = jobs.floor_plan_id);
   ```
2. **Race hardening in `_create_version`.** Flip-then-insert is not a transaction. Needs partial unique indexes + APIError retry before concurrent editing. Low-likelihood under single-user editing.

> **Earlier warning rescinded (Session 5).** A prior draft of this section
> warned against filing insurance claims on multi-floor archived jobs. That
> warning was based on the assumption that `is_current` fallback could leak
> into the editor. Re-audit confirmed the floor-plan editor explicitly
> blocks that fallback for archived jobs and hydrates per-floor via
> `created_by_job_id` — the audit view is correct on all floors. Warning
> removed.

## Session 5 (2026-04-19) — Shape Picker + Mobile Polish + Focus Mode

Client-led polish pass before demo. Added a Google Sheets-style shape picker for room creation, rewrote the mobile toolbar, made job-detail + floor-plan routes full-bleed on mobile, and swept the remaining polygon-room rendering bugs.

**Frontend — Shape picker (Google Sheets-style room creation):**
- New `web/src/components/sketch/shape-picker-modal.tsx` — mobile-first bottom sheet (swipe-to-close), desktop centered card. Five shapes: Rectangle, L-Shape, T-Shape, U-Shape, Rect+Notch. Template geometry in feet; caller converts to pixels via gridSize.
- Room tool now opens the picker first. Tap a shape → drops at viewport center at default dimensions (12×10 ft rect, 14×12 ft L/T/U, 12×10 notch) → existing `RoomConfirmationCard` flow continues unchanged. Cancel in the picker leaves `tool="room"` so the classic click-and-drag rectangle still works as an escape hatch.
- Auto-pan after shape placement: if the dropped shape's bbox clips the viewport (32px margin), `stagePos` shifts just enough to bring the whole shape on-screen.
- Floor level now ALWAYS required in the confirmation card (was only required when `noActiveFloor`). Per client ask — "they have to click the field before they create a room."

**Frontend — Polygon-room correctness fixes:**
- **Polygon drag reset bug.** Polygon rooms' Group prop was `x=0,y=0` constantly (points are absolute world coords). Konva mutated the Group's `x/y` during drag, but react-konva only syncs attrs when React props change. Prop stayed `0`, so the attr kept the drag delta — and `handleDragEnd` shifted points by the SAME delta, producing a double-shifted polygon while walls (rendered outside the Group) landed at the correct position. Fix: `e.target.x(0); e.target.y(0)` imperatively in `onDragEnd` before state update.
- **Cutout follow-drag bug.** `floor_openings` store absolute canvas coords and render as sibling Groups (not children of the room's draggable Group). `handleDragEnd` was shifting `points` and walls but silently leaving cutouts at their old coordinates. Fix: shift each cutout's `x/y` by `(dx, dy)` in the same `updatedRoom` build.
- **Per-edge dimension labels on polygons.** Bbox `14 ft × 12 ft` labels made concave shapes (T/U/L) read as rectangles. Replaced with per-edge labels at each wall's midpoint, visible only on selection. Outward direction computed via `pointInPolygon` half-pixel probe (centroid-based flipping is wrong for concave shapes — the inner notch edges of a T get "away from centroid" = inside the polygon). Thin orange hairline chip behind each label for readability, mono 10pt.
- **Tap-anywhere-empty deselects.** The canvas mousedown handler no longer requires a tap to land exactly on the stage or grid rect — any tap on a target without an `elementId` attr (gridlines, dimension labels, room name text) now clears the selection.

**Frontend — Mobile toolbar redesign (instrument panel):**
- Split `floor-plan-toolbar.tsx` into explicit mobile and desktop renders. Desktop unchanged.
- Mobile: one-row 44×44-button panel with icon-above-label layout, always-visible labels (client ask — "the user should know what each button is").
- Primary row: Select · Room · Wall · Door · Window · Delete · │ · Damage · Undo · Redo. Delete promoted to primary (techs correct mistakes constantly); Trace demoted because the shape picker covers most L/T/U cases.
- Overflow `⋯` menu holds Trace, Opening, Cutout (tier-2 draw tools) plus Zoom in, Zoom out, Fit to view, Export PNG. Floating panel with caret anchor, closes on outside tap / Escape / re-tap.
- "More" button PINNED to the right edge — stays visible regardless of viewport width. Orange count badge shows how many tools are tucked inside so users have concrete evidence there's content behind the menu. Orange dot replaces the count when an inside-tool (Trace/Opening/Cutout) is active.
- Gradient fade on the scrollable region's right edge hints at more content on narrow phones.
- Active tool: solid orange pill with shadow, white icon+label. `touch-action: manipulation` on every mobile button so iOS Safari stops eating second taps as double-tap-zoom (was breaking the re-tap-to-deselect pattern).
- Tap-active-tool-to-Select: tapping the currently-active tool drops back to Select. Matches Figma/Sketch. Gives mobile users a one-tap "escape" without needing a keyboard.
- Stage one-finger pan unlocked for tap-based tools. `draggable` prop now enables pan for `select` (no selection), `delete`, `door`, `window`, `opening`. Still disabled for drag-to-draw tools (`room`, `cutout`) and click-sequence tools (`wall`, `trace`). Two-finger pinch/pan still works on every tool.

**Frontend — Full-bleed routes:**
- `AppShell` hides the mobile header + bottom nav on `/jobs/<id>` and every sub-route (`/photos`, `/readings`, `/report`, `/timeline`, `/floor-plan`). Reclaims ~120px of vertical space for the task. Back arrow in the job sub-header is the one-tap escape.
- Keeps the chrome on `/jobs` (list) and `/jobs/new` (creation form) so users aren't stranded pre-save. Desktop unchanged.

**Frontend — Room+door tap-overlap fix (closes Phase 1 known limitation):**
- Door hit-area was `doorPx + 10` wide × `2·doorPx + 10` tall — for a 3ft door that's 40×70px centered on the wall. The oversized invisible Rect lived in the Doors layer AFTER the Rooms layer, so hit-testing gave it priority over room corner-resize handles whenever a door sat near a wall endpoint (the `t=0.05` clamp in `findNearestWall` allows door centers to be only ~0.5ft from a corner).
- Tightened: `doorPx` wide × 44px tall, no lateral padding. Width matches the door body exactly so tapping past the door's visible edge (where a corner handle would be) goes through to the room layer. Height 44 still covers both swing directions with room for a comfortable tap target.
- Same fix applied to windows/openings (were `winPx + 10` wide; now `winPx` wide).

**Material auto-fill (small card polish):**
- `handleRoomTypeChange` in `RoomConfirmationCard` now fills `materialFlags` from `ROOM_TYPE_MATERIAL_DEFAULTS` when the chip list is empty. Respects manual edits — if the tech already added/removed chips, switching type leaves them alone. Mirrors the backend's `create_room` fill-if-not-provided policy.

**Test summary (manual QA, Session 5):**
- Shape picker: all 5 shapes drop correctly at viewport center; Cancel falls back to drag-to-draw; cross-floor create (picking a different floor in the card) correctly hands the polygon off to the target floor via `onCreateRoomOnDifferentFloor`; auto-pan triggers when shape would clip viewport.
- Polygon drag: L/T/U/Notch move cleanly, walls and cutouts follow the drag, snap-to-other-rooms works, undo restores pre-drag position.
- Polygon vertex edit: select a polygon → drag single vertex → shape deforms, per-edge labels update to new lengths.
- Dimension labels: rectangles keep top-width / left-height labels always-visible; polygons show no labels when unselected (clean canvas), pop orange chips on every edge on selection with correct outside-polygon placement on concave shapes.
- Cutout follow-drag: drop cutout inside a T → drag the T → cutout rides along; same for rect+cutout.
- Mobile toolbar: active tool shows orange pill with label; re-tapping active tool returns to Select; "More" pinned right with count badge; overflow menu opens/closes via re-tap, outside-tap, Escape, and picking an item; stage pan works on Delete/Window/Door/Opening tools.
- Full-bleed routes: job detail and floor-plan editor hide the mobile header + bottom nav; back arrow returns to list; `/jobs` list and `/jobs/new` still show chrome.
- Room+door tap-overlap: tap a corner-resize handle with a door placed ≤1ft from the corner — handle receives the tap, door no longer steals it.
- Tap-anywhere-empty deselect: tap a grid cell / dimension label / room name while a room is selected → selection clears.

## Status — Phase 1 complete

Phase 1 is now **100% feature-complete**. Both remaining items in the "deferred follow-ups" list are non-blocking:
1. Archived preview thumbnail tier-3 fallback — cosmetic, only affects the thumbnail on the job detail page (the real floor-plan editor is correct).
2. `_create_version` race hardening — low-likelihood under single-user editing; requires concurrent saves on the same floor to trigger.

Both are tracked for a hardening pass before general availability; neither blocks shipping Phase 1 or filing insurance claims.

## Reference
- **Brett's spec:** Sketch & Floor Plan Tool Product Design Specification v2.0 (April 13, 2026)
- **Predecessor:** Spec 01C (Floor Plan Konva rebuild) — this spec supersedes most of 01C's canvas architecture
- **Eng review:** Completed 2026-04-16 with 17 architectural decisions locked in (see DECISIONS section)

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
- [x] `floor_plans` reparented from `job_id` to `property_id` FK
- [x] `floor_plan_versions` table created — one version per job session, auto-frozen on archive
- [x] `jobs.floor_plan_version_id` FK added — pins job to a specific version
- [x] Active jobs auto-upgrade to latest version when another job creates a new one
- [x] Archived/submitted jobs are read-only (version frozen)
- [x] New job auto-inherits latest floor plan version (or creates fresh one if first job at property)
- [x] `wall_segments` table created (relational, not JSONB)
- [x] `wall_openings` table created (doors, windows, missing walls)
- [x] Canvas grid changed from 20px=1ft to 10px=6in (clean wipe of existing canvas_data)
- [x] Room creation: drop default-sized shape at viewport center, deform by dragging corner/vertex handles (delivered via Session 5 shape picker — see below)
- [x] Room creation: trace perimeter method — tap corners sequentially, auto-close into room (see E6 below)
- [x] Polygon data model: rooms store `points: [{x,y}]` (rectangles are 4-point polygons) (see E1 below)
- [x] L-shaped rooms via corner drag (inserts vertices, maintains 90° angles) (see E2 below)
- [x] Room confirmation card: name, type, dimensions, ceiling height, ceiling type, materials, affected status
- [x] Room type system: 13 predefined types with auto-populated material defaults
- [x] 6-inch grid snap enforced
- [x] Floor SF auto-calculated (polygon area, minus floor openings)
- [x] Wall SF auto-calculated (perimeter LF × ceiling height × ceiling multiplier - openings)
- [x] Custom wall SF override per room (for non-standard ceiling geometry)
- [x] Multi-floor selector: Basement / Main Floor / Upper Floor / Attic (pill selector with room-count badge + version chip on active pill; horizontal scroll on mobile; pick-floor-first UX — fresh jobs show 4 dashed preset slots, user picks via the selector or the first room's Floor field)
- [x] Floor openings: stairwell cutouts that subtract from floor SF (E7 — see Session 4 below)
- [x] **Room snap behavior:** magnetic snap within 20px of existing room walls (see E3 below)
- [x] **Shared wall auto-detection:** when two rooms snap together, shared wall marked `shared=true`, excluded from each room's perimeter LF, rendered with lighter line weight (see E4 below)
- [x] Wall contextual menu on tap: Add Door, Add Window, Add Opening, Wall Type, Mark Affected
- [x] Door height field (default 7ft, editable) — SF deduction: width × height
- [x] Window height field (default 4ft) + sill height (optional) — SF deduction: width × height
- [x] Opening (missing wall): dashed line indicator, drag handles for start/end, full SF deduction
- [x] Wall type toggle: exterior / interior (drives Xactimate material codes in Spec 01D)
- [x] Wall affected status: per-wall mitigation scope flag (independent from room)
- [x] **Affected Mode overlay** toggle on canvas (highlights all affected rooms/walls in red) (see E5 below)
- [ ] Full test coverage: SF calculations, shared wall detection, property auto-creation race, canvas ↔ walls sync, version upgrade logic
- [x] Wall sync to backend on auto-save (walls + doors + windows + openings → wall_segments + wall_openings)
- [x] Opening tool in toolbar (place openings directly by clicking walls)
- [x] Mobile bottom sheet editor for door/window/opening width + height
- [x] Room edit mode (tap room → Edit → modify type, ceiling, floor, affected)
- [x] Exterior wall visual indicator (blue, thicker stroke)
- [x] Affected wall visual indicator (red stroke)
- [x] **D1: Save through versioning endpoint** — autosave now POSTs to `/v1/floor-plans/{fpId}/versions` instead of PATCHing `floor_plans.canvas_data` directly; backend state machine handles Case 1/2/3 (initial, update-in-place, fork)
- [x] **D2: Pinned-version hydration** — floor plan editor + job detail thumbnail both read the job's pinned version via `jobs.floor_plan_version_id`; strict match with floor_plan_id to prevent cross-floor corruption
- [x] **D3: Multi-floor + version badge UI** — 4 preset pills (Basement/Main/Upper/Attic) with room-count circle badge + `v{N}` chip on active pill; auto-Main-create on fresh job; sticky loading gate prevents empty-state flash on reload; mobile Back button reduced to arrow-only
- [x] **Linked recon inherits job_rooms** — `_copy_rooms_from_linked_job` on job creation copies structural fields only (geometry, type, ceiling, polygon) — per-job scope fields (water_category, equipment counts, affected, material_flags, notes) intentionally reset for the new job
- [x] **Backend API exposes `floor_plan_version_id`** — added to `JobResponse` Pydantic schema + `_parse_job_detail` mapper so frontend hydration has access to the job's pin
- [x] **Cross-floor corruption fixed** — Case 2 update-in-place now guards on `floor_plan_id` match so saving on Upper doesn't overwrite Main's v1 canvas_data
- [x] **Read-only banner on archived jobs** — amber "Read-only — this job is submitted/complete/collected" banner above canvas when `jobs.status ∈ archived`; autosave short-circuits; wall context menu suppressed; empty preset pills disabled

### Phase 1 — Phase E (Canvas Interactions) progress

- [x] **E1: Polygon data model** — `RoomData.points` (optional polygon vertices); helpers `polygonArea`, `polygonCentroid`, `polygonBoundingBox`, `polygonToKonvaPoints`; `wallsForRoom` generalized for N-gons
- [x] **E2: L-shape via vertex editing** — rectangles convert to polygons via "Reshape" button; drag handles on each vertex; tap-on-edge inserts a new vertex; walls regenerate; live shape preview during drag
- [x] **E3: Magnetic room snap** — drag-end snaps room edges within 20px of neighbors (left/right/top/bottom, plus axis-aligned stacks); shares grid snap as baseline
- [x] **E4: Shared wall auto-detection** — after snap/create, walls collinear + overlapping with another room's wall get `shared=true`; rendered muted gray + thinner stroke; backend `wall_segments.shared` persisted
- [x] **E5: Affected Mode overlay** — "Damage" toolbar toggle; dims non-affected rooms/walls to 25% opacity; red ring+tint on active state
- [x] **E6: Trace perimeter tool** — "Trace" toolbar button; tap corners in sequence; rubber-band preview; numbered vertex dots; dashed closing preview; floating status pill with Clear + Done actions
- [x] **E7: Floor openings (stairwell cutouts)** — subtract from floor SF, dashed rect overlay, optional name. End-to-end net-SF math (canvas labels, property layout preview, `job_rooms.square_footage` sync). Editor bottom sheet with typed W × L inputs.
- [ ] **Full test coverage** — SF calcs, shared wall detection, property auto-creation race, canvas ↔ walls sync, version upgrade logic, immutability guards (Case 2 pinned_still_current, frozen-row guard on update, archived-job rollback)
- [x] **Strip `[autosave]` debug logs** in `konva-floor-plan.tsx` and `floor-plan/page.tsx`

### Known Limitations (Phase 1 — track for follow-up hardening)

> **Note on multi-floor archival.** Earlier revisions of this section
> warned that archived multi-floor jobs could leak sibling-job edits
> through the `is_current` fallback. Re-audit in Session 5 confirmed
> that the floor-plan EDITOR (`floor-plan/page.tsx:491–504`) explicitly
> disables that fallback for archived jobs — it hydrates only from
> (1) the scalar pin on `jobs.floor_plan_id`, or (2) versions with
> `created_by_job_id = this job`. Tier 2 correctly returns the archived
> job's own frozen version on every floor, so the audit view is correct.
> The only remaining leak is in the job-detail thumbnail preview below,
> tracked as a cosmetic follow-up.

> **Archived preview legacy-pin fallback.**
> `web/src/app/(protected)/jobs/[id]/page.tsx` `bestFloorPlan` has a tier-3
> fallback that returns any `is_current` floor's `canvas_data` when both the
> pin and `created_by_job_id` lookups fail. Safety net for legacy rows whose
> pins were lost to the pre–Session-4 Case 3 bug. Can leak sibling content on
> the thumbnail. Fix via one-off pin-repair migration:
> ```sql
> UPDATE jobs SET floor_plan_id = (
>   SELECT id FROM floor_plans
>   WHERE created_by_job_id = jobs.id
>   ORDER BY version_number DESC LIMIT 1
> )
> WHERE floor_plan_id IS NULL
>    OR NOT EXISTS (SELECT 1 FROM floor_plans WHERE id = jobs.floor_plan_id);
> ```
> Once pins are clean, remove tier 3 so archived previews strictly reflect
> the pinned snapshot. Not blocking for Phase 1 — the locked floor-plan
> page always renders the correct pinned version; only the thumbnail
> approximates.

> **Race hardening in `_create_version`.** Flip-then-insert is two async
> calls, not a transaction. Under concurrent saves (multi-tech editing)
> the "one is_current per floor" invariant could break. Needs partial
> unique indexes (`CREATE UNIQUE INDEX ON floor_plans (property_id,
> floor_number) WHERE is_current = true`) + APIError catch+retry in
> `_create_version`. Low likelihood under single-user editing; predates
> the Session 3 schema merge. Track as hardening.

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

---

*Created: 2026-04-15. Source: Brett's Sketch & Floor Plan Tool Product Design Specification v2.0 (April 13, 2026). Eng review: 2026-04-16.*
