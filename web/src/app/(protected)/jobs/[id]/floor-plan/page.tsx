"use client";

import { use, useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  useJob,
  useFloorPlans,
  useCreateFloorPlan,
  useDeleteFloorPlan,
  useFloorPlanHistory,
  useRooms,
  useCreateRoom,
  useUpdateRoom,
  usePhotos,
} from "@/lib/hooks/use-jobs";
import { RoomPhotoSection } from "@/components/room-photo-section";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import type { FloorPlan, FloorLevel } from "@/lib/types";
import { FLOOR_LEVEL_TO_NUMBER, FLOOR_LEVEL_LABEL, floorNumberToLevel, hasEtag } from "@/lib/types";
import type { FloorPlanData, RoomData } from "@/components/sketch/floor-plan-tools";
import { wallsForRoom, detectSharedWalls, uid, newRoomUuid } from "@/components/sketch/floor-plan-tools";
import type { KonvaFloorPlanHandle } from "@/components/sketch/konva-floor-plan";
import { RoomConfirmationCard, type RoomConfirmationData } from "@/components/sketch/room-confirmation-card";
import { FloorSelector } from "@/components/sketch/floor-selector";
import { PickFloorModal } from "@/components/sketch/pick-floor-modal";
import { CanvasModeSwitcher } from "@/components/sketch/canvas-mode-switcher";
import { type CanvasMode } from "@/components/sketch/moisture-mode";
import type { MoisturePin, WallSegment } from "@/lib/types";
import { isJobArchived as isJobArchivedStatus } from "@/lib/job-status";

const KonvaFloorPlan = dynamic(() => import("@/components/sketch/konva-floor-plan"), { ssr: false });


/**
 * Round 3: save a canvas version with optimistic-concurrency protection.
 *
 * Looks up the latest known `etag` for the target floor plan from React
 * Query cache and sends it as `If-Match` on the POST. On 412 VERSION_STALE
 * (another editor wrote since we read), throws the ApiError unchanged so
 * the caller can surface the conflict banner. On any other error, also
 * throws unchanged.
 *
 * Rationale for centralizing: the floor-plan page has four save sites
 * (normal autosave, first-floor-create, 409 recovery, cross-floor). All
 * four need the same etag send + 412 handling. A helper keeps them in
 * lockstep so the next edit to the save-response contract touches one
 * place.
 */
async function saveCanvasVersion(opts: {
  floorPlanId: string;
  jobId: string;
  // Kept loose on purpose — the canvas data model (FloorPlanData) is
  // declared in floor-plan-tools.ts and carries domain-specific shapes;
  // the API wire contract is just "a JSON object." Casting once here
  // keeps the save-site code terse.
  canvasData: unknown;
  changeSummary?: string;
  /**
   * Etag for the If-Match header. Required — every caller must supply
   * either a concrete etag string (from a FloorPlan row read) OR the
   * literal "*" as a loud-failure signal when the expected etag is
   * missing (rare; indicates a backend stamping bug or cache race).
   *
   * The backend uniformly rejects "*" on save_canvas with 412
   * WILDCARD_ON_EXISTING (see dependencies.py + service.py round-6
   * follow-up). Sending "*" is therefore NOT a way to succeed — it's
   * a way to fail loudly and trigger the STALE_CONFLICT_ERROR_CODES
   * banner + reload flow instead of a silent last-write-wins. The
   * actual legitimate-save path is always via `hasEtag(fp) ? fp.etag
   * : <defer-and-invalidate>` — two save sites use an explicit "*"
   * fallback purely as a belt-and-suspenders loud-error path.
   *
   * Round-5 history: the previous `etag?: string | null` shape let
   * callers silently fall through to a "*" which the backend then
   * coerced to "skip etag check" — that was the round-4 P2 #2
   * default-allow loophole Lakshman caught. Required type + uniform
   * backend reject closed both the silent-fallback and the
   * silent-skip.
   */
  etag: string;
}): Promise<import("@/lib/types").FloorPlan> {
  // INV-1 enforcement: every mutating request carries a concrete
  // If-Match header. Empty string / null / undefined are all
  // operator errors — the caller must either pass a real etag, or
  // explicitly pass "*" to trigger the stale-conflict banner as a
  // loud failure. Silently falling through to no-header reopens the
  // round-4 P2 #2 default-allow loophole.
  if (!opts.etag || opts.etag.length === 0) {
    throw new Error(
      "saveCanvasVersion: etag is required. Pass a concrete etag "
      + "from the FloorPlan row, or \"*\" to trigger a loud 412 "
      + "(the backend rejects \"*\" uniformly — it's a loud-error "
      + "signal, not a success path). Never fall through to "
      + "no-etag — that reopens the round-4 P2 #2 default-allow "
      + "loophole.",
    );
  }
  const headers = { "If-Match": opts.etag };
  return apiPost<import("@/lib/types").FloorPlan>(
    `/v1/floor-plans/${opts.floorPlanId}/versions`,
    {
      job_id: opts.jobId,
      canvas_data: opts.canvasData,
      ...(opts.changeSummary ? { change_summary: opts.changeSummary } : {}),
    },
    headers,
  );
}


/**
 * Round 3 (second critical review): factor the fork-reconciliation block
 * out of each save site so the pattern lives in ONE place. Before, the
 * block was copy-pasted at 3 save sites and FORGOTTEN at the 4th (the
 * 409 recovery branch) — the exact sibling-miss pattern flagged.
 *
 * When a save returns a version whose id differs from the row we saved
 * against (Case 3 fork), this:
 *   1. Replaces the source row with savedVersion in the per-job list cache,
 *      keeping the list sorted by floor_number.
 *   2. Switches activeFloorId to savedVersion.id so subsequent writes
 *      land on the live current row, not the now-frozen source.
 *   3. Invalidates the source row's floor-plan-history cache key (stale).
 *   4. Invalidates the savedVersion's floor-plan-history + the per-job
 *      floor-plans list + the jobs cache as a final sync.
 *
 * When the save didn't fork (savedVersion.id === sourceFloorId), only
 * the final-sync invalidations run.
 */
/**
 * Round-3 second critical review (HIGH #1): 412 VERSION_STALE handling
 * was inline at one save site and missing from the cross-floor save site.
 * Centralize so any new save site inherits conflict handling.
 *
 * Returns true if the error was a VERSION_STALE and was handled (caller
 * should stop its own error flow — no retry, no generic "error" badge).
 * Returns false if the error was something else; caller continues its
 * usual error handling.
 */
// Round 6 follow-up (Lakshman HIGH, lessons-doc pattern #17): this
// handler catches both VERSION_STALE (round 3: concurrent editor wrote
// between our read and our save) AND WILDCARD_ON_EXISTING (round 6:
// service rejected an `If-Match: *` against a row with updated_at set).
// Both 412s carry current_etag in the error body and both mean "your
// save can't land against the current server state; reload to recover."
// Treating them identically keeps the recovery UX single-path: banner
// + conflict-draft persistence + reload offer. Previously we only
// gated on VERSION_STALE; WILDCARD_ON_EXISTING fell through to the
// autosave retry loop, which retried the same `*` request until
// MAX_RETRIES elapsed and died with a generic error badge — the exact
// "new error path introduced without end-to-end UX" shape pattern #17
// warns about.
const STALE_CONFLICT_ERROR_CODES = new Set(["VERSION_STALE", "WILDCARD_ON_EXISTING"]);

function handleStaleConflictIfPresent(
  err: unknown,
  opts: {
    floorPlanId: string;
    /** Round 5 (P1 #2): rejected canvas data to persist before reload so
     *  the user's work survives the navigation. Keyed on floorPlanId so
     *  the restore banner on next load can route the draft to the right
     *  floor. */
    rejectedCanvas?: unknown;
    /** Job id — part of the localStorage key so drafts from different jobs
     *  don't collide. Required whenever rejectedCanvas is supplied. */
    jobId?: string;
    setStaleConflict: (v: { floorPlanId: string; currentEtag: string | null } | null) => void;
    setSaveStatus: (v: "idle" | "saving" | "saved" | "error" | "offline") => void;
    clearRetryTimer?: () => void;
  },
): boolean {
  const apiErr = err as { status?: number; error_code?: string; body?: Record<string, unknown> };
  if (
    apiErr.status !== 412
    || !apiErr.error_code
    || !STALE_CONFLICT_ERROR_CODES.has(apiErr.error_code)
  ) {
    return false;
  }

  // Round 5 (Lakshman P1 #2): snapshot the rejected canvas BEFORE the
  // reload flow kicks in. Keyed on the floor the save was AGAINST
  // (captured at POST time by the caller, NOT activeFloorRef.current
  // which may have changed since the request fired). On next load, a
  // restore banner offers the user the choice to re-apply their work
  // on top of the fresh server state. Without this, window.location.
  // reload() nukes Konva state and the user loses every edit they
  // made since their last successful save — the stale-conflict banner
  // was previously lying when it said "reload to re-apply."
  if (
    typeof window !== "undefined"
    && opts.rejectedCanvas !== undefined
    && opts.jobId
    && opts.floorPlanId
  ) {
    try {
      const key = `canvas-conflict-draft:${opts.jobId}:${opts.floorPlanId}`;
      window.localStorage.setItem(
        key,
        JSON.stringify({
          canvasData: opts.rejectedCanvas,
          rejectedAt: Date.now(),
          sourceFloorId: opts.floorPlanId,
        }),
      );
    } catch {
      // localStorage unavailable (private mode, quota exceeded) — the
      // restore flow just won't fire. The banner still surfaces and the
      // user can at least not-silently-overwrite; the restore CTA is
      // additive.
    }
  }

  opts.setStaleConflict({
    floorPlanId: opts.floorPlanId,
    currentEtag: (apiErr.body?.current_etag as string | undefined) ?? null,
  });
  opts.setSaveStatus("error");
  opts.clearRetryTimer?.();
  return true;
}


function reconcileSavedVersion(
  qc: import("@tanstack/react-query").QueryClient,
  jobId: string,
  sourceFloorId: string,
  savedVersion: import("@/lib/types").FloorPlan,
  setActiveFloorId: (id: string) => void,
): void {
  if (savedVersion.id !== sourceFloorId) {
    qc.setQueryData<import("@/lib/types").FloorPlan[]>(
      ["floor-plans", jobId],
      (old) => {
        if (!old) return [savedVersion];
        const withoutOld = old.filter(
          (fp) => fp.id !== sourceFloorId && fp.id !== savedVersion.id,
        );
        return [...withoutOld, savedVersion].sort(
          (a, b) => (a.floor_number ?? 0) - (b.floor_number ?? 0),
        );
      },
    );
    setActiveFloorId(savedVersion.id);
    qc.invalidateQueries({ queryKey: ["floor-plan-history", sourceFloorId] });
  } else {
    // Round 3 bug found in testing: non-fork in-place save (same id, fresh
    // updated_at) returns a savedVersion with a fresh etag, but the list
    // cache entry keeps the pre-save etag. The next autosave reads the
    // stale etag from cache, sends it as If-Match, and the backend 412s —
    // stale-conflict banner fires against the user's own just-saved row,
    // no actual concurrent editor involved. Spread savedVersion OVER the
    // cached row so response fields (etag, updated_at, canvas_data) become
    // authoritative while any client-only fields survive the merge.
    qc.setQueryData<import("@/lib/types").FloorPlan[]>(
      ["floor-plans", jobId],
      (old) => {
        if (!old) return old;
        return old.map((fp) =>
          fp.id === sourceFloorId ? { ...fp, ...savedVersion } : fp,
        );
      },
    );
  }
  // Round 3 (post-review): deliberately NOT invalidating ["floor-plans", jobId]
  // here. The setQueryData above wrote the authoritative post-save row; a
  // same-key invalidate would trigger a background refetch that could
  // briefly overwrite the optimistic update with a slightly stale read
  // (race between the save response committing and the refetch firing).
  // ["floor-plan-history", savedVersion.id] and ["jobs"] target different
  // keys, so they stay.
  qc.invalidateQueries({ queryKey: ["floor-plan-history", savedVersion.id] });
  qc.invalidateQueries({ queryKey: ["jobs"] });
}

/* ------------------------------------------------------------------ */
/*  Wall sync: canvas walls → backend wall_segments                    */
/* ------------------------------------------------------------------ */

// Module-level mutex: prevents concurrent syncs from interleaving
// their delete-all + recreate cycles, which used to create duplicate
// wall rows in the backend. Only one wall-sync runs at a time;
// queued ones short-circuit and trust the in-flight one to converge.
let _wallSyncInFlight = false;

// Round 5 (Lakshman P2 #1 / INV-4): canvas-save in-flight guard.
// Autosave debounce is 2s (konva-floor-plan.tsx). When POST latency
// exceeds 2s — slow cellular, Railway cold start, backend GC pause —
// two autosaves can overlap:
//   T0:    save1 starts, reads currentFloor.etag = E1, POSTs If-Match: E1
//   T2.1s: save2 fires with cache still at E1 (save1 hasn't reconciled),
//          POSTs If-Match: E1
//   T2.5s: save1 returns, reconcileSavedVersion updates cache to E2
//   T3s:   save2 reaches server. Server sees If-Match: E1 vs current E2
//          → 412 VERSION_STALE against the user's own work
// The guard serializes autosaves: while one is in flight, later changes
// update lastCanvasRef but DON'T POST; when the in-flight one finishes
// and reconciles the cache, the deferred change replays with the fresh
// etag. Single-writer invariant restored.
let _canvasSaveInFlight = false;
let _canvasDeferredDuringSave = false;

// Rooms whose wall-sync GET has already failed at least once in this
// session. Stale canvas_data can reference backend rooms that were later
// deleted — retrying their sync on every autosave just spams the console.
// Circuit-break per-id so the first failure silences subsequent attempts
// without blocking other rooms' sync. Cleared naturally on full refresh.
const _wallSyncBadRoomIds = new Set<string>();

async function syncWallsToBackend(
  canvasData: FloorPlanData,
  jobRooms: Array<{ id: string; room_name: string }> | undefined,
  jobId: string,
): Promise<{ restampedAny: boolean }> {
  if (!canvasData.walls || !jobRooms || jobRooms.length === 0) {
    return { restampedAny: false };
  }
  if (_wallSyncInFlight) return { restampedAny: false };
  _wallSyncInFlight = true;
  try {
    return await _syncWallsToBackendImpl(canvasData, jobRooms, jobId);
  } finally {
    _wallSyncInFlight = false;
  }
}

async function _syncWallsToBackendImpl(
  canvasData: FloorPlanData,
  jobRooms: Array<{ id: string; room_name: string }> | undefined,
  jobId: string,
): Promise<{ restampedAny: boolean }> {
  if (!canvasData.walls || !jobRooms || jobRooms.length === 0) {
    return { restampedAny: false };
  }
  let restampedAny = false;

  // Phase 2 location-split follow-up (R1 HIGH 1): when a room's
  // canvas-vs-backend wall signature diverges, the autosave path
  // wipe-and-recreates that room's wall_segments. moisture_pins.
  // wall_segment_id has ON DELETE SET NULL, so every pin on that room's
  // walls would otherwise have its wall reference silently nulled on
  // every geometry-touching autosave. Mirrors the capture-then-restamp
  // logic restore_floor_plan_relational_snapshot runs server-side
  // (migration e5f6a7b8c9d0).
  //
  // Today every wall pin in the live DB has wall_segment_id = NULL
  // (picker UX deferred per Spec 01H Phase 2 line 472), so the capture
  // is empty in practice and the restamp is a no-op — this is forward
  // protection for the picker rollout, not a current bug repair.
  //
  // Atomicity ceiling: this is N HTTP calls (GET pins, DELETE walls,
  // POST walls, PATCH pins). A crash mid-sequence leaves pins NULL
  // — same end state as today's silent-wipe. The picker UX rollout is
  // the natural moment to escalate to a SECURITY DEFINER replace_room_
  // walls RPC for atomic capture+wipe+insert+restamp inside one tx
  // (mirrors Phase 1 R19's snapshot-restore path). Tracked in the
  // spec's picker-UX prerequisite block.
  const pinsByOldWallId = new Map<string, string>(); // wall_segment_id → pin_id
  try {
    const pinsResp = await apiGet<{ items: MoisturePin[] } | MoisturePin[]>(
      `/v1/jobs/${jobId}/moisture-pins`,
    );
    const allPins = Array.isArray(pinsResp) ? pinsResp : pinsResp.items ?? [];
    for (const p of allPins) {
      if (p.wall_segment_id) pinsByOldWallId.set(p.wall_segment_id, p.id);
    }
  } catch (err) {
    // Pin fetch failure is non-fatal — wall sync still proceeds, but
    // any wipe path will lose wall_segment_id refs (no worse than the
    // pre-fix behavior). Log so the silent loss isn't truly silent.
    console.warn("Pin fetch for wall-sync restamp failed", err);
  }

  // Group canvas walls by roomId (canvas-local ID, not backend ID)
  const wallsByRoom = new Map<string, typeof canvasData.walls>();
  for (const wall of canvasData.walls) {
    if (!wall.roomId) continue;
    const existing = wallsByRoom.get(wall.roomId) ?? [];
    existing.push(wall);
    wallsByRoom.set(wall.roomId, existing);
  }

  // Map canvas wall IDs → backend wall IDs (needed for door/window sync)
  const canvasToBackendWallId = new Map<string, string>();
  // Track which backend rooms we've already synced in this pass. Two canvas
  // rooms resolving to the same backend row (e.g., legacy canvas data where
  // propertyRoomId was never backfilled) would otherwise each run a full
  // delete-all + recreate cycle against the same backend walls, producing
  // two sequential storms and momentarily wiping walls between them.
  const syncedBackendRoomIds = new Set<string>();

  for (const room of canvasData.rooms) {
    const backendRoomId = room.propertyRoomId
      ?? jobRooms.find((r) => r.room_name === room.name)?.id;

    if (!backendRoomId) continue;
    if (syncedBackendRoomIds.has(backendRoomId)) continue;
    syncedBackendRoomIds.add(backendRoomId);
    // Circuit-break against rooms that already failed this session (stale
    // canvas_data → backend room was deleted). Re-trying just spams the
    // console on every autosave and burns a request per save.
    if (_wallSyncBadRoomIds.has(backendRoomId)) continue;

    const roomWalls = wallsByRoom.get(room.id) ?? [];
    if (roomWalls.length === 0) continue;

    try {
      // Get existing backend walls
      const existing = await apiGet<{ items: WallSegment[] } | WallSegment[]>(
        `/v1/rooms/${backendRoomId}/walls`
      );
      const existingWalls = Array.isArray(existing) ? existing : existing.items ?? [];

      // Round to 2 decimal places to match backend DECIMAL(8,2). Without
      // this, canvas floats like 120.3333 drift from backend's 120.33 and
      // every save re-triggers a full delete+recreate.
      const r = (v: number | string) => Math.round(Number(v) * 100) / 100;
      const normalize = (walls: Array<{
        x1: number | string; y1: number | string; x2: number | string; y2: number | string;
        wall_type?: string; wallType?: string;
        affected?: boolean; shared?: boolean;
      }>) =>
        walls
          .map((w) => ({
            x1: r(w.x1),
            y1: r(w.y1),
            x2: r(w.x2),
            y2: r(w.y2),
            wall_type: (w.wall_type ?? w.wallType ?? "interior") as string,
            affected: !!w.affected,
            shared: !!w.shared,
          }))
          .sort((a, b) => a.x1 - b.x1 || a.y1 - b.y1 || a.x2 - b.x2 || a.y2 - b.y2);
      const canvasSig = JSON.stringify(normalize(roomWalls));
      const backendSig = JSON.stringify(normalize(existingWalls));
      if (canvasSig === backendSig && existingWalls.length === roomWalls.length) {
        // Populate the wall id map so door/window sync later still
        // resolves. Sort both sides the same way so index i maps to i.
        const canvasSorted = [...roomWalls].sort((a, b) =>
          a.x1 - b.x1 || a.y1 - b.y1 || a.x2 - b.x2 || a.y2 - b.y2,
        );
        const backendSorted = [...existingWalls].sort((a, b) =>
          Number(a.x1) - Number(b.x1) ||
          Number(a.y1) - Number(b.y1) ||
          Number(a.x2) - Number(b.x2) ||
          Number(a.y2) - Number(b.y2),
        );
        canvasSorted.forEach((w, i) => {
          const backendW = backendSorted[i];
          if (backendW) canvasToBackendWallId.set(w.id, backendW.id);
        });
        continue;
      }

      // Capture (pin_id, sort_order_of_old_wall) for any pins on this
      // room before the DELETE wipes the wall_segment_id refs. See the
      // function-header block for the full rationale.
      const restampCaptures: Array<{ pinId: string; sortOrder: number }> = [];
      for (const w of existingWalls) {
        const pinId = pinsByOldWallId.get(w.id);
        if (pinId !== undefined) {
          restampCaptures.push({ pinId, sortOrder: Number(w.sort_order) });
        }
      }

      // Delete existing walls (clean slate — cascades openings)
      for (const w of existingWalls) {
        await apiDelete(`/v1/rooms/${backendRoomId}/walls/${w.id}`);
      }

      // Create new walls and track ID mapping. newWallBySortOrder feeds
      // the post-INSERT restamp loop below.
      const newWallBySortOrder = new Map<number, string>();
      for (let i = 0; i < roomWalls.length; i++) {
        const w = roomWalls[i];
        const created = await apiPost<WallSegment>(`/v1/rooms/${backendRoomId}/walls`, {
          x1: w.x1,
          y1: w.y1,
          x2: w.x2,
          y2: w.y2,
          wall_type: w.wallType ?? "interior",
          affected: w.affected ?? false,
          shared: w.shared ?? false,
          sort_order: i,
        });
        canvasToBackendWallId.set(w.id, created.id);
        newWallBySortOrder.set(i, created.id);
      }

      // Re-stamp captured pins. Pins whose original sort_order no
      // longer maps (geometry edit removed the wall) keep
      // wall_segment_id = NULL via ON DELETE SET NULL — that's the
      // honest answer (lesson #2). Per-pin failures don't block the
      // sync from completing.
      for (const cap of restampCaptures) {
        const newWallId = newWallBySortOrder.get(cap.sortOrder);
        if (!newWallId) continue;
        try {
          await apiPatch(`/v1/jobs/${jobId}/moisture-pins/${cap.pinId}`, {
            wall_segment_id: newWallId,
          });
          restampedAny = true;
        } catch (err) {
          console.warn("Pin wall_segment_id restamp failed", cap.pinId, err);
        }
      }
    } catch (err) {
      // First-time warn so genuine failures still surface. Mark the id as
      // bad so subsequent autosaves skip it quietly — covers the stale
      // canvas_data case where the backend room no longer exists.
      _wallSyncBadRoomIds.add(backendRoomId);
      console.warn("Wall sync failed for room", backendRoomId, err);
    }
  }

  // Sync doors → wall_openings (type: door, default height 7ft)
  for (const door of canvasData.doors ?? []) {
    const backendWallId = canvasToBackendWallId.get(door.wallId);
    if (!backendWallId) continue;
    // Find the room this wall belongs to
    const wall = canvasData.walls.find(w => w.id === door.wallId);
    if (!wall?.roomId) continue;
    const room = canvasData.rooms.find(r => r.id === wall.roomId);
    const backendRoomId = room?.propertyRoomId
      ?? jobRooms.find(r => r.room_name === room?.name)?.id;
    if (!backendRoomId) continue;

    try {
      await apiPost(`/v1/rooms/${backendRoomId}/walls/${backendWallId}/openings`, {
        opening_type: "door",
        position: door.position,
        width_ft: door.width,
        height_ft: door.height ?? 7,
        swing: door.swing,
      });
    } catch (err) {
      console.warn("Door sync failed", err);
    }
  }

  // Sync windows → wall_openings (type: window, default height 4ft)
  for (const win of canvasData.windows ?? []) {
    const backendWallId = canvasToBackendWallId.get(win.wallId);
    if (!backendWallId) continue;
    const wall = canvasData.walls.find(w => w.id === win.wallId);
    if (!wall?.roomId) continue;
    const room = canvasData.rooms.find(r => r.id === wall.roomId);
    const backendRoomId = room?.propertyRoomId
      ?? jobRooms.find(r => r.room_name === room?.name)?.id;
    if (!backendRoomId) continue;

    // Openings with "opening" prefix are missing walls
    const isOpening = win.id.startsWith("opening");

    try {
      await apiPost(`/v1/rooms/${backendRoomId}/walls/${backendWallId}/openings`, {
        opening_type: isOpening ? "missing_wall" : "window",
        position: win.position,
        width_ft: win.width,
        height_ft: win.height ?? (isOpening ? 8 : 4),
      });
    } catch (err) {
      console.warn("Window/opening sync failed", err);
    }
  }

  return { restampedAny };
}

/* ------------------------------------------------------------------ */
/*  Inline dimension inputs for rectangle rooms                         */
/*                                                                     */
/*  Holds the typing draft in local state so fast keystrokes don't     */
/*  round-trip through parent re-renders. Commits to the parent on     */
/*  blur or Enter — matches the door/window bottom sheet UX so the     */
/*  room feels consistent with every other tappable element.           */
/* ------------------------------------------------------------------ */

function RoomDimensionInputs({
  widthFt,
  heightFt,
  onResize,
}: {
  widthFt: number;
  heightFt: number;
  onResize: (widthFt: number, heightFt: number) => void;
}) {
  const [wStr, setWStr] = useState(String(widthFt));
  const [hStr, setHStr] = useState(String(heightFt));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // W8: refs mirror latest drafts + latest props so the unmount cleanup can
  // flush a pending valid edit that didn't get 400ms to land before the
  // sheet was swiped away.
  const wStrRef = useRef(wStr);
  const hStrRef = useRef(hStr);
  const widthFtRef = useRef(widthFt);
  const heightFtRef = useRef(heightFt);
  const onResizeRef = useRef(onResize);
  wStrRef.current = wStr;
  hStrRef.current = hStr;
  widthFtRef.current = widthFt;
  heightFtRef.current = heightFt;
  onResizeRef.current = onResize;
  // Track focus so server-refetch re-syncs don't trample a live edit.
  const [isFocused, setIsFocused] = useState(false);
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;

  // Commit current drafts if both are valid. Used by the debounce timer
  // (live auto-commit while typing) and by the blur/Enter handlers.
  const commit = (nextW: string, nextH: string) => {
    const w = parseFloat(nextW);
    const h = parseFloat(nextH);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    if (w < 1 || h < 1) return;
    if (w === widthFtRef.current && h === heightFtRef.current) return;
    onResizeRef.current(w, h);
  };

  // On iOS Safari, blur events are unreliable when the user dismisses the
  // bottom sheet by swipe or backdrop tap — the sheet can unmount before
  // the active input fires blur, and the edit is lost. A 400ms debounce
  // on keystrokes means the edit commits while the user is still on the
  // sheet, before any dismiss gesture gets a chance to race the blur.
  const scheduleCommit = (nextW: string, nextH: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(nextW, nextH), 400);
  };

  // W8: on unmount, cancel the timer AND flush any valid pending draft
  // that differs from the committed dims. Previously the cleanup only
  // cancelled — user types "99", swipes away before 400ms, edit dropped.
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const w = parseFloat(wStrRef.current);
      const h = parseFloat(hStrRef.current);
      if (
        Number.isFinite(w) && Number.isFinite(h) &&
        w >= 1 && h >= 1 &&
        (w !== widthFtRef.current || h !== heightFtRef.current)
      ) {
        onResizeRef.current(w, h);
      }
    }
  }, []);

  // W8: when server refetch returns new dims, re-sync the drafts — but
  // ONLY when the user isn't currently editing. Prevents the remount-key
  // workaround that was blowing away active edits on every save response.
  useEffect(() => {
    if (isFocusedRef.current) return;
    setWStr(String(widthFt));
    setHStr(String(heightFt));
  }, [widthFt, heightFt]);

  const flushOnBlur = () => {
    setIsFocused(false);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    commit(wStr, hStr);
  };

  // R17 (round 2) — live invalid state so the user sees WHY the dimension
  // didn't apply. Matches commit()'s guard: `w < 1 || h < 1` is invalid.
  // Empty string is neutral (user mid-edit / cleared field).
  const wNum = parseFloat(wStr);
  const hNum = parseFloat(hStr);
  const wInvalid = wStr !== "" && (!Number.isFinite(wNum) || wNum < 1);
  const hInvalid = hStr !== "" && (!Number.isFinite(hNum) || hNum < 1);

  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1">Width (ft)</p>
        <input
          type="text"
          inputMode="decimal"
          value={wStr}
          onFocus={(e) => { setIsFocused(true); e.target.select(); }}
          onChange={(e) => {
            const next = e.target.value;
            setWStr(next);
            scheduleCommit(next, hStr);
          }}
          onBlur={flushOnBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={`w-full h-9 px-3 rounded-lg border text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] outline-none focus:border-brand-accent ${
            wInvalid ? "border-red-400" : "border-outline-variant"
          }`}
        />
        {wInvalid && (
          <p className="mt-1 text-[10px] text-red-600">Must be at least 1</p>
        )}
      </div>
      <div className="flex-1">
        <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1">Length (ft)</p>
        <input
          type="text"
          inputMode="decimal"
          value={hStr}
          onFocus={(e) => { setIsFocused(true); e.target.select(); }}
          onChange={(e) => {
            const next = e.target.value;
            setHStr(next);
            scheduleCommit(wStr, next);
          }}
          onBlur={flushOnBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={`w-full h-9 px-3 rounded-lg border text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] outline-none focus:border-brand-accent ${
            hInvalid ? "border-red-400" : "border-outline-variant"
          }`}
        />
        {hInvalid && (
          <p className="mt-1 text-[10px] text-red-600">Must be at least 1</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile bottom panel with swipe-to-close                            */
/* ------------------------------------------------------------------ */

function MobileRoomPanel({
  room,
  jobId,
  photos,
  onClose,
  onEditRoom,
  onEditShape,
  onResize,
  wallSf,
  isPolygon,
}: {
  room: { id: string; name: string; widthFt: number; heightFt: number; propertyRoomId: string };
  jobId: string;
  photos: import("@/lib/types").Photo[];
  onClose: () => void;
  onEditRoom?: () => void;
  onEditShape?: () => void;
  /** Rectangle rooms only — updates room bbox dimensions and cascades to
   *  walls/cutouts via the canvas handle. Omitted (hidden in UI) for polygon
   *  rooms since bbox W × H is not meaningful geometry for L/T/U. */
  onResize?: (widthFt: number, heightFt: number) => void;
  wallSf?: number | null;
  isPolygon?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDragging = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only track swipe on the drag handle area (first 40px)
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touchY = e.touches[0].clientY;
    if (touchY > rect.top + 44) return; // only drag handle triggers swipe
    startYRef.current = touchY;
    currentYRef.current = touchY;
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current || !panelRef.current) return;
    currentYRef.current = e.touches[0].clientY;
    const delta = Math.max(0, currentYRef.current - startYRef.current);
    panelRef.current.style.transform = `translateY(${delta}px)`;
    panelRef.current.style.transition = "none";
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current || !panelRef.current) return;
    isDragging.current = false;
    const delta = currentYRef.current - startYRef.current;
    if (delta > 60) {
      // Swiped down enough — dismiss
      panelRef.current.style.transition = "transform 200ms ease-out";
      panelRef.current.style.transform = "translateY(100%)";
      setTimeout(onClose, 200);
    } else {
      // Snap back
      panelRef.current.style.transition = "transform 150ms ease-out";
      panelRef.current.style.transform = "translateY(0)";
    }
  }, [onClose]);

  return (
    <div className="md:hidden fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/10" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="absolute left-0 right-0 bottom-0 bg-surface-container-lowest rounded-t-2xl shadow-[0_-4px_20px_rgba(31,27,23,0.12)] min-h-[55vh] max-h-[75vh] flex flex-col pb-[env(safe-area-inset-bottom)]"
        style={{ transform: "translateY(0)", transition: "transform 200ms ease-out" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle — swipe down to close */}
        <div className="pt-3 pb-1 flex items-center justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-outline-variant/40" />
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto px-4 pb-6 space-y-3">
          {/* Room header with edit */}
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold text-on-surface">{room.name}</h3>
              <span className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                {Math.round(room.widthFt * room.heightFt)} SF
                {wallSf != null && wallSf > 0 && (
                  <> &middot; Wall {wallSf} SF</>
                )}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {onEditShape && (
                /* "Edit shape" action: dismisses this panel so the user has
                   unobstructed access to vertex drag handles on the canvas.
                   For rectangles, tapping this also converts the room to a
                   4-point polygon so its corners become draggable vertices
                   (enables L-shape and irregular shape editing). */
                <button
                  type="button"
                  onClick={onEditShape}
                  className="h-8 px-3 rounded-full border border-outline-variant text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-high active:scale-[0.98] cursor-pointer sm:h-7 sm:rounded-lg"
                >
                  {isPolygon ? "Edit shape" : "Reshape"}
                </button>
              )}
              {onEditRoom && (
                <button
                  type="button"
                  onClick={onEditRoom}
                  className="h-8 px-3 rounded-full border border-outline-variant text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-high active:scale-[0.98] cursor-pointer sm:h-7 sm:rounded-lg"
                >
                  Edit
                </button>
              )}
            </div>
          </div>

          {/* Inline dimension inputs — rectangles only. Polygon rooms have
              N edges and their bbox W × H is not actionable (editing 14 ft
              on a U-shape is ambiguous: which edge?). For polygons the
              "Edit shape" button is the right mechanism. */}
          {!isPolygon && onResize && (
            <RoomDimensionInputs
              // W8: key only on room.id — was `${room.id}-${widthFt}-${heightFt}`
              // which remounted on every server refetch and blew away drafts.
              // Re-sync on prop change now lives inside the component, gated on
              // focus so it doesn't trample live edits.
              key={room.id}
              widthFt={room.widthFt}
              heightFt={room.heightFt}
              onResize={onResize}
            />
          )}

          {/* Photos section */}
          <RoomPhotoSection
            jobId={jobId}
            roomId={room.propertyRoomId}
            roomName={room.name}
            photos={photos}
            variant="card"
          />
        </div>
      </div>
    </div>
  );
}

export default function FloorPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: jobId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: job } = useJob(jobId);
  // Jobs in this status are read-only — backend returns 403 on any save attempt,
  // and the job's pinned version is frozen against auto-upgrade from sibling jobs.
  const isJobArchived = isJobArchivedStatus(job?.status);
  const { data: floorPlans, isLoading } = useFloorPlans(jobId);
  const createFloorPlan = useCreateFloorPlan(jobId);
  const deleteFloorPlan = useDeleteFloorPlan(jobId);
  const canvasRef = useRef<KonvaFloorPlanHandle>(null);
  const { data: jobRooms } = useRooms(jobId);
  const createRoom = useCreateRoom(jobId);
  const updateRoom = useUpdateRoom(jobId);
  // Forward-declared ref for the active floor id — its value is synced
  // below (after the useState is declared) and read inside
  // handleCreateRoom so the mutation carries floor_plan_id without
  // depending on a closure over a variable not yet in scope.
  const activeFloorIdRef = useRef<string | null>(null);
  // Spec 01H Phase 2 fix (2026-04-27): bumped after a cross-floor save
  // commits to force Konva to remount with the freshly-seeded
  // `lastCanvasRef`. Konva initializes its internal state from
  // `initialData` only on mount; when the same-floor save lands new
  // data, the React Query cache is correct but Konva keeps its
  // pre-save internal state. Bumping this counter changes the Konva
  // `key` prop → React unmounts the old instance and mounts a fresh
  // one that reads the new `initialData`. Independent of any
  // auto-create-default-floor logic.
  const [canvasRemountSeed, setCanvasRemountSeed] = useState(0);
  // Forward-declared ref to ensureFloor (defined further down). Same
  // pattern as activeFloorIdRef — handleCreateRoom is defined here at
  // the top of the file but ensureFloor lives after the rooms hook
  // ordering. The ref is wired up in the render body (search
  // `ensureFloorRef.current = ensureFloor`). Used by handleCreateRoom
  // when `activeFloorIdRef.current` is null but `metadata.floorLevel`
  // tells us which floor the user picked — fixes the race on fresh-job
  // first-room creates where the user draws faster than
  // `activeFloorId` propagates from `setActiveFloorId` → render →
  // ref-sync.
  const ensureFloorRef = useRef<
    ((level: FloorLevel) => Promise<FloorPlan>) | null
  >(null);
  const handleCreateRoom = useCallback(async (
    name: string,
    dimensions?: { width: number; height: number },
    metadata?: {
      roomType?: string | null;
      ceilingHeight?: number;
      ceilingType?: string;
      floorLevel?: string | null;
      materialFlags?: string[];
      affected?: boolean;
    },
    canvasRoomId?: string,
    /** Explicit floor_plan_id to attach the new room to. Overrides
     *  `activeFloorIdRef.current`. Callers that just resolved a floor
     *  via `ensureFloor()` (the cross-floor create path on a fresh
     *  property, in particular) should pass `targetFloor.id` here so
     *  the POST doesn't race the ref update — `activeFloorId` only
     *  syncs on re-render after the active-floor switch effect runs,
     *  which is *after* this synchronous create call.
     *  Without this override, fresh-property first-room creates POSTed
     *  with `floor_plan_id = NULL`, producing the orphan-room data
     *  corruption that leaks pins across every floor referencing the
     *  orphan UUID. */
    floorPlanIdOverride?: string,
  ) => {
    // ── Floor resolution (user-intent-first) ──────────────────────
    // Every pin's floor membership is derived through the join
    // `moisture_pins.room_id → job_rooms.floor_plan_id`. A room
    // persisted with `floor_plan_id = NULL` produces pins whose floor
    // membership the render filter can't determine, and they leak
    // visually across every floor whose canvas references them.
    //
    // Priority order (Spec 01H Phase 2 fix, 2026-04-27 — second pass):
    //   1. `floorPlanIdOverride` — caller is explicit (e.g.
    //      handleCreateRoomOnDifferentFloor already resolved the
    //      target via ensureFloor). Trust them.
    //   2. `metadata.floorLevel` — the USER's explicit pick from the
    //      room confirmation form. Resolve via ensureFloor. This wins
    //      over `activeFloorIdRef.current` because the user's stated
    //      intent ("basement") MUST beat the currently-displayed
    //      canvas ("main") whenever they differ. Pre-fix on fresh
    //      jobs: cross-floor gate at konva-floor-plan.tsx:1658 failed
    //      to fire when `activeFloorLevel` was null at click-time,
    //      falling through to the regular handleCreateRoom path; the
    //      first-pass fix here only fired ensureFloor when no floor
    //      was resolved at all, missing the case where activeFloorIdRef
    //      had drifted to main while the user wanted basement. The
    //      room then landed on main — the "first room creates on
    //      wrong floor" symptom Samhith reported.
    //   3. `activeFloorIdRef.current` — the active canvas at call
    //      time. Fallback only when the user didn't explicitly pick.
    let resolvedFloorPlanId: string | null | undefined = floorPlanIdOverride;
    if (!resolvedFloorPlanId) {
      const userPickedLevel = metadata?.floorLevel as FloorLevel | null | undefined;
      if (userPickedLevel && ensureFloorRef.current) {
        try {
          const fp = await ensureFloorRef.current(userPickedLevel);
          resolvedFloorPlanId = fp.id;
        } catch (err) {
          console.error(
            "[handleCreateRoom] ensureFloor for user-picked level failed",
            { name, canvasRoomId, userPickedLevel, err },
          );
          return;
        }
      } else {
        resolvedFloorPlanId = activeFloorIdRef.current;
      }
    }
    if (!resolvedFloorPlanId) {
      console.warn(
        "[handleCreateRoom] aborting: no floor_plan_id resolved. A path bypassed the pick-floor gate.",
        { name, canvasRoomId },
      );
      return;
    }

    // Hard rule (per Samhith): every canvas room must own a unique
    // `job_rooms` UUID. Pins reference rooms by `room_id`, never by
    // name, and two canvas rooms can never share that UUID — otherwise
    // a pin placed on one renders on the other.
    //
    // We still want to BIND a freshly-drawn canvas room to a pre-
    // declared Property Layout row when the user finally draws it
    // (otherwise we'd duplicate the row), but only when nothing else
    // already owns that row. The dedupe key is therefore three-part:
    //
    //   1. Same room name.
    //   2. Same floor (`floor_plan_id`, or null for legacy / pre-
    //      multi-floor rows we can't prove a floor for).
    //   3. UNCLAIMED — no other canvas room on this floor has already
    //      bound to that backend UUID. This is the part that broke
    //      same-floor same-name placements: two "Bedroom"s on main
    //      used to collapse onto the same backend row because the
    //      old check stopped at (1) + (2) and re-bound the second
    //      drawing to the row the first was already using.
    //
    // If no existing row qualifies, we POST a fresh `job_rooms` row.
    // Two "Bedroom"s on the same floor end up as two distinct UUIDs,
    // pins stay attributed to the room they were placed on, and the
    // floor-plan editor stops having to disambiguate by name.
    const claimedBackendIds = new Set(
      canvasRef.current
        ?.getCurrentState()
        .rooms.map((r) => r.propertyRoomId)
        .filter((id): id is string => !!id) ?? [],
    );
    const existing = jobRooms?.find(
      (r) =>
        r.room_name === name
        && (r.floor_plan_id == null || r.floor_plan_id === resolvedFloorPlanId)
        && !claimedBackendIds.has(r.id),
    );
    if (existing) {
      if (canvasRoomId) canvasRef.current?.setRoomPropertyId(canvasRoomId, existing.id);
      return;
    }
    createRoom.mutate(
      {
        // Spec 01H Phase 2 (duplicate-name fix): the canvas room
        // already owns its UUID via newRoomUuid() at draw-time, and
        // that UUID lives on canvasRoomId === RoomData.id ===
        // RoomData.propertyRoomId. Pass it to the backend as the
        // job_rooms.id so the row is created with the same UUID the
        // canvas already committed to. Backend create_room is
        // idempotent on (id, company_id) — same-tenant retry returns
        // the existing row (no duplicate INSERT), cross-tenant
        // collision raises 409. Eliminates the transient
        // "unsaved-room" window that used to force the resolver into
        // a name-match fallback.
        //
        // The fallback to backend-generated UUID (when canvasRoomId
        // is somehow undefined — defensive only; both creation sites
        // pass it) preserves backward compatibility for any code path
        // we haven't migrated yet.
        ...(canvasRoomId ? { id: canvasRoomId } : {}),
        room_name: name,
        // Critical: link the new job_rooms row to the floor the tech
        // just drew it on. Without this, `job_rooms.floor_plan_id`
        // lands as NULL and every downstream per-floor query (the
        // moisture-report view, the adjuster portal, anything that
        // buckets data by floor) can't attribute the room to its
        // floor. Room creation before this fix silently produced
        // orphan rows that rendered fine in the editor — because the
        // editor keys off canvas_data, not `job_rooms.floor_plan_id`
        // — but broke every join-based consumer.
        floor_plan_id: resolvedFloorPlanId,
        length_ft: dimensions?.height ?? null,
        width_ft: dimensions?.width ?? null,
        // Persist the form's metadata so floor_level / room_type / ceiling / etc.
        // actually land in job_rooms — picking "Upper" in the form should mean
        // the room belongs to the Upper floor, not whatever canvas it was drawn on.
        ...(metadata?.roomType !== undefined && { room_type: metadata.roomType }),
        ...(metadata?.ceilingHeight !== undefined && { height_ft: metadata.ceilingHeight }),
        ...(metadata?.ceilingType !== undefined && { ceiling_type: metadata.ceilingType }),
        ...(metadata?.floorLevel !== undefined && { floor_level: metadata.floorLevel }),
        ...(metadata?.materialFlags !== undefined && { material_flags: metadata.materialFlags }),
        ...(metadata?.affected !== undefined && { affected: metadata.affected }),
      } as Record<string, unknown>,
      {
        // Pipe the server-assigned UUID back into the canvas room. Next save
        // matches by propertyRoomId (unambiguous) instead of name (ambiguous).
        onSuccess: (created) => {
          if (canvasRoomId) canvasRef.current?.setRoomPropertyId(canvasRoomId, created.id);
        },
      },
    );
  }, [jobRooms, createRoom]);

  const { data: allPhotos = [] } = usePhotos(jobId);
  const [mobileSelectedRoom, setMobileSelectedRoom] = useState<{ id: string; name: string; widthFt: number; heightFt: number; propertyRoomId: string; isPolygon?: boolean } | null>(null);
  const [editingRoomData, setEditingRoomData] = useState<RoomConfirmationData | null>(null);

  const handleEditRoom = useCallback(() => {
    if (!mobileSelectedRoom) return;
    const dbRoom = jobRooms?.find(r => r.id === mobileSelectedRoom.propertyRoomId);
    // Auto-detect room type from name if DB doesn't have it (rooms created before V2)
    const nameKey = mobileSelectedRoom.name.toLowerCase().replace(/\s+/g, "_");
    const detectedType = dbRoom?.room_type ?? (
      ["living_room","kitchen","bathroom","bedroom","basement","hallway","laundry_room","garage","dining_room","office","closet","utility_room","other"].includes(nameKey) ? nameKey : null
    );
    setEditingRoomData({
      name: mobileSelectedRoom.name,
      propertyRoomId: mobileSelectedRoom.propertyRoomId,
      roomType: detectedType as RoomConfirmationData["roomType"],
      ceilingHeight: dbRoom?.height_ft ?? 8,
      ceilingType: (dbRoom?.ceiling_type as RoomConfirmationData["ceilingType"]) ?? "flat",
      floorLevel: (dbRoom?.floor_level as RoomConfirmationData["floorLevel"]) ?? "main",
      materialFlags: dbRoom?.material_flags ?? [],
      affected: dbRoom?.affected ?? false,
    });
    setMobileSelectedRoom(null);
  }, [mobileSelectedRoom, jobRooms]);

  const handleEditRoomConfirm = useCallback((data: RoomConfirmationData) => {
    if (!data.propertyRoomId) return;
    updateRoom.mutate({
      roomId: data.propertyRoomId,
      room_name: data.name,
      room_type: data.roomType,
      height_ft: data.ceilingHeight,
      ceiling_type: data.ceilingType,
      floor_level: data.floorLevel,
      material_flags: data.materialFlags,
      affected: data.affected,
    } as Record<string, unknown> & { roomId: string });
    setEditingRoomData(null);
    // Also deselect the room on the canvas + close the mobile detail panel.
    // Otherwise the MobileRoomPanel (with "Add photos" section) pops back up
    // right after the user hits Update, which feels unfinished.
    setMobileSelectedRoom(null);
    selectedRoomRef.current = null;
    canvasRef.current?.clearSelection();
  }, [updateRoom]);

  const selectedRoomRef = useRef<{ id: string; name: string; propertyRoomId: string } | null>(null);

  const handleDesktopEditRoom = useCallback(() => {
    const sel = selectedRoomRef.current;
    if (!sel) return;
    const dbRoom = jobRooms?.find(r => r.id === sel.propertyRoomId);
    const nameKey = sel.name.toLowerCase().replace(/\s+/g, "_");
    const detectedType = dbRoom?.room_type ?? (
      ["living_room","kitchen","bathroom","bedroom","basement","hallway","laundry_room","garage","dining_room","office","closet","utility_room","other"].includes(nameKey) ? nameKey : null
    );
    setEditingRoomData({
      name: sel.name,
      propertyRoomId: sel.propertyRoomId,
      roomType: detectedType as RoomConfirmationData["roomType"],
      ceilingHeight: dbRoom?.height_ft ?? 8,
      ceilingType: (dbRoom?.ceiling_type as RoomConfirmationData["ceilingType"]) ?? "flat",
      floorLevel: (dbRoom?.floor_level as RoomConfirmationData["floorLevel"]) ?? "main",
      materialFlags: dbRoom?.material_flags ?? [],
      affected: dbRoom?.affected ?? false,
    });
  }, [jobRooms]);

  // Buffer for a tap that arrived before jobRooms finished loading. On mobile
  // especially, the user taps faster than the rooms query resolves. Without
  // this buffer, the very first tap after page load would silently fail to
  // open the modal because the name-match fallback ran against an undefined
  // jobRooms. When jobRooms arrives, the useEffect below re-runs resolution.
  const [pendingSelection, setPendingSelection] = useState<
    { selectedId: string; type: "room"; name: string; widthFt: number; heightFt: number; propertyRoomId?: string; isPolygon?: boolean } | null
  >(null);

  const resolveSelection = useCallback(
    (info: { selectedId: string; type: "room"; name: string; widthFt: number; heightFt: number; propertyRoomId?: string; isPolygon?: boolean }) => {
      let resolvedPropertyRoomId = info.propertyRoomId;
      if (!resolvedPropertyRoomId) {
        const match = jobRooms?.find((r) => r.room_name === info.name);
        resolvedPropertyRoomId = match?.id;
      }
      if (!resolvedPropertyRoomId) return null;
      return {
        id: info.selectedId,
        name: info.name,
        widthFt: info.widthFt,
        heightFt: info.heightFt,
        propertyRoomId: resolvedPropertyRoomId,
        isPolygon: info.isPolygon,
      };
    },
    [jobRooms],
  );

  const handleSelectionChange = useCallback((info: { selectedId: string; type: "room"; name: string; widthFt: number; heightFt: number; propertyRoomId?: string; isPolygon?: boolean } | null) => {
    if (!info) {
      setMobileSelectedRoom(null);
      setPendingSelection(null);
      selectedRoomRef.current = null;
      return;
    }
    const resolved = resolveSelection(info);
    if (resolved) {
      selectedRoomRef.current = { id: info.selectedId, name: info.name, propertyRoomId: resolved.propertyRoomId };
      setMobileSelectedRoom(resolved);
      setPendingSelection(null);
      return;
    }
    // Couldn't resolve yet. If jobRooms is still loading, buffer the tap
    // and retry when the query arrives — common path on fast mobile taps
    // right after page load. The flush effect below picks it up. Without
    // this buffer, the first tap after mount silently dropped the modal.
    if (jobRooms === undefined) {
      setPendingSelection(info);
      return;
    }
    // jobRooms is loaded but the match still failed — genuine data gap.
    setMobileSelectedRoom(null);
    selectedRoomRef.current = null;
  }, [jobRooms, resolveSelection]);

  // Flush the pending tap once jobRooms resolves.
  useEffect(() => {
    if (!pendingSelection) return;
    if (jobRooms === undefined) return;  // still loading
    const resolved = resolveSelection(pendingSelection);
    if (resolved) {
      selectedRoomRef.current = { id: pendingSelection.selectedId, name: pendingSelection.name, propertyRoomId: resolved.propertyRoomId };
      setMobileSelectedRoom(resolved);
    }
    setPendingSelection(null);
  }, [jobRooms, pendingSelection, resolveSelection]);

  const [activeFloorIdx, setActiveFloorIdx] = useState(0);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  // Canvas mode — Sketch (default, drawing) vs Moisture (pin placement + readings).
  // Phase 3 will add Equipment, phase 4 Photos. Driven entirely by CANVAS_MODES
  // config in components/sketch/moisture-mode.ts.
  // Honor a ?mode=moisture deeplink (used by the Drying Progress card on the
  // job detail page) so the canvas opens directly in the mode that matches
  // the user's intent instead of a sketch-then-switch extra tap.
  const searchParams = useSearchParams();
  const initialMode: CanvasMode =
    searchParams.get("mode") === "moisture" ? "moisture" : "sketch";
  const [canvasMode, setCanvasMode] = useState<CanvasMode>(initialMode);
  const lastCanvasRef = useRef<{ floorId: string | null; data: FloorPlanData } | null>(null);
  // Signature of the most recently saved canvas geometry (rooms/walls/doors/
  // windows). Guards against save handler re-invocations with identical data
  // — a cache-invalidation cascade after save can feed the same payload back
  // in a second time and produce a redundant POST version + PATCH rooms +
  // wall-sync round. Compared only against structural geometry, not against
  // canvasMode/pins/etc., so non-geometry changes still fall through.
  const lastSavedSigRef = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error" | "offline">("idle");
  /**
   * Round 3: set when a save is rejected with 412 VERSION_STALE (another
   * editor wrote to this floor plan between our read and our save).
   * The banner prompts the user to reload so they see the other editor's
   * changes before redoing theirs. Null = no conflict pending.
   */
  const [staleConflict, setStaleConflict] = useState<{
    floorPlanId: string;
    currentEtag: string | null;
  } | null>(null);
  // Ref mirror so setTimeout closures (retry queue) see the latest value
  // without adding staleConflict to every dep array that would otherwise
  // re-bind handleChange on each keystroke-driven save.
  const staleConflictRef = useRef(staleConflict);
  staleConflictRef.current = staleConflict;

  // Round 5 (Lakshman P1 #2): conflict-draft restore state. Scanned from
  // localStorage on mount; if a prior save failed with VERSION_STALE and
  // the user reloaded, the rejected canvas is persisted under a
  // `canvas-conflict-draft:${jobId}:${floorId}` key. The restore banner
  // offers the user the choice to re-apply their lost work on top of
  // the fresh server state.
  const [conflictDraft, setConflictDraft] = useState<{
    floorPlanId: string;
    canvasData: FloorPlanData;
    rejectedAt: number;
  } | null>(null);
  const manualSaveRef = useRef(false);
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // localStorage key for offline backup — keyed per-floor to prevent cross-floor data corruption
  const lsKey = activeFloorId ? `fp-backup-${jobId}-${activeFloorId}` : `fp-backup-${jobId}`;

  // Persist canvas state to localStorage on every change (survives browser close)
  const backupToLocal = useCallback((canvasData: FloorPlanData, floorId: string | null) => {
    try {
      localStorage.setItem(lsKey, JSON.stringify({ canvasData, floorId, ts: Date.now() }));
    } catch { /* storage full — ignore */ }
  }, [lsKey]);

  // Clear localStorage backup after successful save
  const clearLocalBackup = useCallback(() => {
    try { localStorage.removeItem(lsKey); } catch { /* ignore */ }
  }, [lsKey]);

  // Check for unsaved local backup — synchronous read so it's available before canvas mounts
  const [pendingBackup, setPendingBackup] = useState<FloorPlanData | null>(null);
  const [backupChecked, setBackupChecked] = useState(false);
  useEffect(() => {
    // Only check once activeFloorId is resolved (so we read the right key)
    if (!activeFloorId) { setBackupChecked(false); return; }
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) { setBackupChecked(true); return; }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.canvasData || typeof parsed.ts !== "number") {
        localStorage.removeItem(lsKey);
        setBackupChecked(true);
        return;
      }
      if (Date.now() - parsed.ts > 86_400_000) { localStorage.removeItem(lsKey); setBackupChecked(true); return; }
      if (parsed.floorId && parsed.floorId !== activeFloorId) { setBackupChecked(true); return; }
      setPendingBackup(parsed.canvasData as FloorPlanData);
      lastCanvasRef.current = { floorId: activeFloorId, data: parsed.canvasData as FloorPlanData };
    } catch { localStorage.removeItem(lsKey); }
    setBackupChecked(true);
  }, [lsKey, activeFloorId]);

  // Sync activeFloorId when floor plans load
  useEffect(() => {
    if (floorPlans && floorPlans.length > 0 && !activeFloorId) {
      setActiveFloorId(floorPlans[0].id);
    }
  }, [floorPlans, activeFloorId]);


  // Round 5 (Lakshman P1 #2): on mount, scan localStorage for any
  // conflict drafts from a prior VERSION_STALE that triggered a reload.
  // If found, surface the restore banner so the user can re-apply
  // their work on top of the fresh server state. Keys are scoped per
  // job + floor via `canvas-conflict-draft:${jobId}:${floorId}` so
  // drafts from unrelated jobs don't cross-leak.
  //
  // We pick the MOST RECENT draft for this job — if the user somehow
  // accumulated drafts across multiple floors, the banner surfaces
  // one at a time. The "Discard all" CTA on the banner wipes every
  // draft for this job so a user with a stale old draft isn't trapped.
  useEffect(() => {
    if (!jobId || typeof window === "undefined") return;
    try {
      const prefix = `canvas-conflict-draft:${jobId}:`;
      let newest: {
        floorPlanId: string;
        canvasData: FloorPlanData;
        rejectedAt: number;
      } | null = null;
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (
            parsed
            && typeof parsed === "object"
            && parsed.canvasData
            && typeof parsed.rejectedAt === "number"
          ) {
            // Age out drafts older than 7 days — the user almost
            // certainly moved on, and stale drafts clutter localStorage.
            if (Date.now() - parsed.rejectedAt > 7 * 86_400_000) {
              window.localStorage.removeItem(k);
              continue;
            }
            const floorPlanId = k.slice(prefix.length);
            if (!newest || parsed.rejectedAt > newest.rejectedAt) {
              newest = {
                floorPlanId,
                canvasData: parsed.canvasData as FloorPlanData,
                rejectedAt: parsed.rejectedAt,
              };
            }
          }
        } catch { /* malformed entry — skip, GC later */ }
      }
      if (newest) setConflictDraft(newest);
    } catch { /* localStorage unavailable — no restore flow */ }
  }, [jobId]);

  const activeFloor = floorPlans?.find((fp) => fp.id === activeFloorId)
    ?? floorPlans?.[activeFloorIdx]
    ?? null;

  // Load versions for the active floor plan. Hydration rules:
  //   - Pinned job (job.floor_plan_id set) → MUST load that exact version,
  //     never substitute. Archived jobs rely on this to stay frozen.
  //   - Unpinned job (freshly created) → load is_current so it inherits the latest
  //     snapshot from the property's shared floor plan.
  const { data: versions } = useFloorPlanHistory(activeFloor?.id ?? "");
  const hydrationCanvasData = (() => {
    if (!versions) return undefined;
    // Linear history rule:
    //   - ARCHIVED jobs (submitted/complete/collected) render their PINNED
    //     version — frozen audit view, shows exactly what was submitted.
    //   - ACTIVE jobs render the LATEST (is_current) version — so edits
    //     always go on top of the building's current state. When mitigation
    //     un-archives and saves, v3 inherits from v2 (recon's additions),
    //     not v1 (mitigation's original). DB still preserves every snapshot
    //     (immutability guarantee) — this rule only governs what the CANVAS
    //     shows to the user.
    if (isJobArchived) {
      // Strict mode for archived jobs: never fall through to is_current.
      // Falling through would leak post-archival edits — e.g., a recon job's
      // Base addition would appear when viewing mitigation's archived Base
      // view. Show only versions this job is pinned to or that it created.
      if (job?.floor_plan_id) {
        const pinned = versions.find((v) => v.id === job.floor_plan_id);
        if (pinned) return pinned.canvas_data as unknown as FloorPlanData;
      }
      const ownVersion = versions.find((v) => v.created_by_job_id === jobId);
      if (ownVersion) return ownVersion.canvas_data as unknown as FloorPlanData;
      // This archived job never touched this floor — render empty (don't show
      // another job's content as if it were part of this job's audit trail).
      return undefined;
    }
    const latest = versions.find((v) => v.is_current) ?? versions[0] ?? null;
    return (latest?.canvas_data as unknown as FloorPlanData | undefined)
      ?? (activeFloor?.canvas_data as unknown as FloorPlanData | null | undefined);
  })();

  // Sticky-per-floor readiness flag. Live gate prevents the initial "Draw
  // your first room" flash while data loads. But after the canvas mounts, we
  // must NOT let it unmount mid-edit — React Query background refetches (e.g.
  // after createRoom.mutate invalidates jobs) can momentarily flip live gates
  // false, which would unmount the canvas and kill the in-flight 2s debounce
  // timer that was about to save the user's drawing. So once a given floor is
  // ready, stay ready until activeFloorId changes (real floor switch).
  //
  // Ready = data loaded. Whether to render the canvas or the "pick a floor"
  // empty state is decided below at render time. We intentionally allow ready=true
  // with zero floors — fresh jobs show the empty state until the user picks a floor
  // (via the selector or the first room's Floor field).
  const liveCanvasReady =
    !!job
    && floorPlans !== undefined
    && !(activeFloor?.id && versions === undefined);
  const stickyReadyRef = useRef<{ floorId: string | null; ready: boolean }>({ floorId: null, ready: false });
  const currentFloorIdForReady = activeFloor?.id ?? null;
  if (stickyReadyRef.current.floorId !== currentFloorIdForReady) {
    // Floor switched — reset stickiness so the new floor goes through the
    // live gate before mounting (waits for that floor's versions to load).
    stickyReadyRef.current = { floorId: currentFloorIdForReady, ready: false };
  }
  if (liveCanvasReady) {
    stickyReadyRef.current.ready = true;
  }
  const canvasReady = stickyReadyRef.current.ready;

  // Keep refs so the save callback always uses the latest values
  const activeFloorRef = useRef(activeFloor);
  activeFloorRef.current = activeFloor;
  // Sync the forward-declared ref (see where handleCreateRoom is
  // defined) so the create-room mutation always carries the current
  // floor_plan_id, not a stale closure value.
  activeFloorIdRef.current = activeFloorId;

  const wasPendingRef = useRef(false);
  const retryCount = useRef(0);
  const MAX_RETRIES = 5;

  // Ref so the save callback can short-circuit without needing to be recreated when status changes.
  const isJobArchivedRef = useRef(isJobArchived);
  isJobArchivedRef.current = isJobArchived;

  /* ---------------------------------------------------------------- */
  /*  Save — create or update                                          */
  /* ---------------------------------------------------------------- */

  const handleChange = useCallback(
    async (canvasData: FloorPlanData) => {
      // Archived jobs are read-only — skip server save entirely. Backend would
      // reject with 403 "Cannot edit floor plan for an archived job" anyway.
      if (isJobArchivedRef.current) {
        return;
      }

      // Always backup to localStorage (survives browser close) — even during pending create
      backupToLocal(canvasData, activeFloorIdRef.current);

      // Dedup against the most recently saved payload. Identical geometry
      // means the save would be a functional no-op (same rooms, same walls,
      // same openings) — short-circuit before POSTing the version, PATCHing
      // rooms, or hitting the walls sync. Catches the rare re-invoke where
      // handleChange gets called twice with the same data in quick succession.
      const sig = JSON.stringify({
        rooms: canvasData.rooms,
        walls: canvasData.walls,
        doors: canvasData.doors,
        windows: canvasData.windows,
      });
      if (sig === lastSavedSigRef.current) return;

      // Defer ONLY when a floor creation is in flight AND we have no active
      // floor to save against. The original guard deferred on isPending alone,
      // which was over-restrictive: React 19 / React Query batching can leave
      // isPending=true for one extra render even after the new floor's row is
      // already in the query cache and activeFloorId is set. If we have an
      // active floor, we know exactly what to POST to — no duplicate risk.
      if (createFloorPlan.isPending && !activeFloorIdRef.current) {
        lastCanvasRef.current = { floorId: activeFloorIdRef.current, data: canvasData };
        return;
      }

      // If browser reports offline, queue for retry with backoff
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setSaveStatus("offline");
        if (retryCount.current < MAX_RETRIES) {
          retryCount.current++;
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => {
            const pending = lastCanvasRef.current;
            if (pending) handleChangeRef.current(pending.data);
          }, 5000 * retryCount.current);
        } else {
          setSaveStatus("error");
        }
        return;
      }

      // Round 5 (Lakshman P2 #1 / INV-4): in-flight guard. If a previous
      // autosave is still in-flight (POST hasn't returned, cache hasn't
      // reconciled), don't start a second one — it would carry the same
      // stale etag and 412 against the user's own pending save. Record
      // the latest canvas in lastCanvasRef + set the deferred flag so
      // the in-flight save's finally block replays once the response
      // lands and the fresh etag is in cache.
      if (_canvasSaveInFlight) {
        lastCanvasRef.current = { floorId: activeFloorIdRef.current, data: canvasData };
        _canvasDeferredDuringSave = true;
        return;
      }

      // Try ref first, then fall back to looking up by ID in query cache
      const currentFloor = activeFloorRef.current
        ?? (activeFloorIdRef.current ? queryClient.getQueryData<FloorPlan[]>(["floor-plans", jobId])?.find((fp) => fp.id === activeFloorIdRef.current) : null);
      // Round 5 (Lakshman P1 #2): capture source floor id NOW, before the
      // await. activeFloorRef can change during the POST (cross-floor nav,
      // another tab), and if we read it from the catch block the conflict
      // draft would be keyed on the wrong floor — banner would restore
      // the user's work onto whatever they're currently looking at instead
      // of the floor they were editing when the save fired.
      const postTimeSourceFloorId: string | null = currentFloor?.id ?? null;
      setSaveStatus("saving");
      // Track when "saving" started so the indicator stays visible long enough
      // for the human eye even if the POST returns in <100ms (otherwise React
      // batches saving→saved into a single render and you only see "Saved ✓").
      const savingStartTime = Date.now();
      // Round-5 follow-up (Lakshman LOW #1): set the in-flight flag INSIDE
      // the try — if any code between the flag-set and try-entry ever
      // throws in a future edit, the flag would lock true for the rest
      // of the page lifetime and block every autosave with a stuck
      // "saving" indicator. The finally clears it defensively now.
      try {
        _canvasSaveInFlight = true;
        if (currentFloor) {
          // Save through the versioning state machine. Backend decides: create v1,
          // update in place, or fork a new version based on job ownership.
          //
          // Round-2 follow-on #3: capture the POST response. On a Case-3 fork
          // (sibling job already edited this floor), savedVersion.id !==
          // currentFloor.id and the "active floor" in memory would stay pointed
          // at the now-frozen row. Next autosave would fork AGAIN, and the
          // FloorSelector roomCount chip would lag. Mirrors R12's cross-floor
          // save fix — apply the same reconciliation here.
          //
          // Round-5 follow-up (Lakshman M1): we must send a concrete etag.
          // If the cached FloorPlan doesn't have one populated (cross-deploy
          // window, stale refetch), refetching the list + deferring is
          // correct — silently sending "*" is the default-allow loophole
          // the strict-helper closure is meant to prevent.
          if (!hasEtag(currentFloor)) {
            queryClient.invalidateQueries({ queryKey: ["floor-plans", jobId] });
            lastCanvasRef.current = { floorId: activeFloorIdRef.current, data: canvasData };
            setSaveStatus("offline");
            return;
          }
          const savedVersion = await saveCanvasVersion({
            floorPlanId: currentFloor.id,
            jobId,
            canvasData,
            etag: currentFloor.etag,
          });
          // Round 3 (second critical review): reconcile via the shared
          // helper. Previously this block was inline at 3 sites and
          // forgotten at the 4th — exactly the sibling-miss pattern.
          reconcileSavedVersion(
            queryClient, jobId, currentFloor.id, savedVersion, setActiveFloorId,
          );
          // Case-3 fork only: floor_plans.id rotated, so the canvas-side
          // per-floor pin filter (`pin.floor_plan_id !== activeFloorPlanId`
          // → drop) would hide every existing pin until a hard refresh.
          // We DO NOT invalidate on every save — that re-introduces the
          // multi-pin drag race commit 731c061 closed (refetch lands
          // between pin A's and pin B's queued PATCHes, returns mixed
          // server state, the pin-follow effect re-PATCHes B against the
          // wrong base position, and the wrong coords land permanently
          // on the server). Pure position drags don't change the pin's
          // joined floor_plan_id, so the cache stays correct without
          // any invalidation here.
          if (savedVersion.id !== currentFloor.id) {
            queryClient.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
          }
        } else {
          // No floor plan yet — create the floor plan shell first (metadata only),
          // then save canvas through the versioning endpoint.
          const floorNum = (floorPlans?.length ?? 0) + 1;
          try {
            const created = await apiPost<FloorPlan>(`/v1/jobs/${jobId}/floor-plans`, {
              floor_number: floorNum,
              floor_name: `Floor ${floorNum}`,
            });
            // Inject into React Query cache instead of invalidating — avoids a refetch
            // round-trip that briefly returns `floorPlans=undefined`, which would
            // unmount the canvas and flash "no rooms yet" during first-room save.
            queryClient.setQueryData<FloorPlan[]>(["floor-plans", jobId], (old) => {
              if (!old) return [created];
              return old.some((fp) => fp.id === created.id) ? old : [...old, created];
            });
            setActiveFloorId(created.id);
            // Re-bind lastCanvasRef to the newly-created floor. It was captured
            // with floorId=null (no floor existed when the user started drawing),
            // and without this rebind, switching to another preset would "leak"
            // this canvas state onto that new floor via the initialData fallback.
            if (lastCanvasRef.current && lastCanvasRef.current.floorId === null) {
              lastCanvasRef.current = { floorId: created.id, data: lastCanvasRef.current.data };
            }
            // Round-2 follow-on #3: capture return; on the (rare) fork path
            // from a just-created row (shouldn't happen for v1, but defend
            // in case a sibling raced the create), swap active to the fork.
            //
            // Round-5 follow-up (Lakshman M1): `created` came from
            // ensure_job_floor_plan which stamps etag via the
            // @computed_field.
            //
            // Round-6 follow-up (Lakshman LOW): the prior comment
            // claimed `*` is "the genuine first-save creation flow."
            // After the round-6 service-layer wildcard gate, that's
            // no longer true — Postgres auto-stamps updated_at on
            // every insert, so save_canvas always sees
            // target_updated_at set and rejects `*` with 412
            // WILDCARD_ON_EXISTING. This `*` fallback is therefore a
            // belt-and-suspenders loud-failure path: if the backend
            // ever ships with broken etag stamping (@computed_field
            // returns None), we'd rather trip the stale-conflict
            // banner and force a reload than silently send
            // last-write-wins. In normal operation this branch
            // doesn't fire because hasEtag(created) is true.
            const firstSaveEtag: string = hasEtag(created) ? created.etag : "*";
            const firstSaved = await saveCanvasVersion({
              floorPlanId: created.id,
              jobId,
              canvasData,
              etag: firstSaveEtag,
            });
            // Reconcile via the shared helper (same path as autosave).
            reconcileSavedVersion(
              queryClient, jobId, created.id, firstSaved, setActiveFloorId,
            );
          } catch (err: unknown) {
            const apiErr = err as { status?: number };
            if (apiErr.status === 409) {
              // Round 3 (second critical review, HIGH #1): this 409
              // recovery branch was regressing R12's cache fix because
              // it threw away saveCanvasVersion's return. If the backend
              // forked on this save (possible since plans[0] may not be
              // the row this job owns the pin on), activeFloorId stayed
              // on the now-frozen row, roomCount went stale, and the
              // next autosave forked AGAIN. Fix: capture savedVersion
              // and run the same fork-reconciliation pattern via the
              // shared helper.
              //
              // Note: with the new ensure_job_floor_plan RPC
              // (migration b8c9d0e1f2a3), 409 only surfaces on a
              // back-to-back 23505 pathological race. The branch is
              // near-unreachable in practice but correct-when-it-fires
              // is still the rule.
              const refetched = await apiGet<{ items: FloorPlan[]; total: number } | FloorPlan[]>(
                `/v1/jobs/${jobId}/floor-plans`,
              );
              const plans = Array.isArray(refetched) ? refetched : refetched.items ?? [];
              queryClient.setQueryData<FloorPlan[]>(["floor-plans", jobId], plans);
              if (plans.length > 0) {
                const fp = plans[0];
                setActiveFloorId(fp.id);
                // Round-5 follow-up (Lakshman M1): refetched row should
                // always have etag populated (backend's @computed_field),
                // but defend against the cross-deploy window by defer +
                // invalidate rather than silent-`*`.
                if (!hasEtag(fp)) {
                  queryClient.invalidateQueries({ queryKey: ["floor-plans", jobId] });
                  lastCanvasRef.current = { floorId: fp.id, data: canvasData };
                  setSaveStatus("offline");
                  return;
                }
                const recovered = await saveCanvasVersion({
                  floorPlanId: fp.id,
                  jobId,
                  canvasData,
                  etag: fp.etag,
                });
                reconcileSavedVersion(
                  queryClient, jobId, fp.id, recovered, setActiveFloorId,
                );
              }
            } else {
              throw err;
            }
          }
        }
        // Sync room dimensions, floor_openings (cutouts), and net square
        // footage from sketch to Property Layout rooms. Floor openings live
        // on the canvas room AND the job_rooms row; keep them in lockstep so
        // backend SF calculations + Xactimate line items see the cutouts.
        if (canvasData.rooms && jobRooms) {
          const gs = canvasData.gridSize || 20;
          // Shoelace area for polygon rooms; bbox area for rectangles.
          // Mirrors floor-plan-tools.roomFloorArea but inlined so this file
          // doesn't need a canvas-state import.
          const polyArea = (pts: Array<{ x: number; y: number }>): number => {
            if (pts.length < 3) return 0;
            let s = 0;
            for (let i = 0; i < pts.length; i++) {
              const a = pts[i], b = pts[(i + 1) % pts.length];
              s += a.x * b.y - b.x * a.y;
            }
            return Math.abs(s) / 2;
          };
          // Collect room PATCHes keyed by backend id so two canvas rooms
          // resolving to the same backend row (via name-match fallback, or
          // legacy canvas data pre-propertyRoomId backfill) collapse into
          // a single PATCH — last-wins on body. Also prevents the save
          // loop from running concurrent PATCHes with conflicting payloads
          // against the same backend room within one save cycle.
          const roomUpdatesByBackendId = new Map<string, Record<string, unknown>>();
          for (const drawnRoom of canvasData.rooms) {
            const match = drawnRoom.propertyRoomId
              ? jobRooms.find((r) => r.id === drawnRoom.propertyRoomId)
              : jobRooms.find((r) => r.room_name === drawnRoom.name);
            if (match) {
              const widthFt = Math.round((drawnRoom.width / gs) * 10) / 10;
              const lengthFt = Math.round((drawnRoom.height / gs) * 10) / 10;
              const currentW = Math.round((match.width_ft ?? 0) * 10) / 10;
              const currentL = Math.round((match.length_ft ?? 0) * 10) / 10;
              const dimsChanged = widthFt !== currentW || lengthFt !== currentL;

              // Cutouts compared as JSON — small arrays, infrequent changes.
              // Convert canvas px → feet so the backend stores business units.
              const drawnCutouts = (drawnRoom.floor_openings ?? []).map((o) => ({
                x: Math.round((o.x / gs) * 100) / 100,
                y: Math.round((o.y / gs) * 100) / 100,
                width: Math.round((o.width / gs) * 100) / 100,
                height: Math.round((o.height / gs) * 100) / 100,
              }));
              const currentCutouts = (match.floor_openings ?? []).map((o: { x: number; y: number; width: number; height: number }) => ({
                x: o.x, y: o.y, width: o.width, height: o.height,
              }));
              const cutoutsChanged = JSON.stringify(drawnCutouts) !== JSON.stringify(currentCutouts);

              // Net SF: polygon (or bbox) area − cutout area, in sq ft.
              const hasPolygon = Array.isArray(drawnRoom.points) && drawnRoom.points.length >= 3;
              const areaPx = hasPolygon
                ? polyArea(drawnRoom.points!)
                : drawnRoom.width * drawnRoom.height;
              const cutoutsPx = (drawnRoom.floor_openings ?? []).reduce(
                (sum, o) => sum + Math.abs(o.width * o.height),
                0,
              );
              const netSf = Math.max(0, Math.round(((areaPx - cutoutsPx) / (gs * gs)) * 10) / 10);
              const currentSf = Math.round((match.square_footage ?? 0) * 10) / 10;
              const sfChanged = netSf !== currentSf;

              if (dimsChanged || cutoutsChanged || sfChanged) {
                const body: Record<string, unknown> = {};
                if (dimsChanged) { body.width_ft = widthFt; body.length_ft = lengthFt; }
                if (cutoutsChanged) { body.floor_openings = drawnCutouts; }
                if (sfChanged) { body.square_footage = netSf; }
                roomUpdatesByBackendId.set(match.id, body);
              }
            }
          }
          const roomUpdates = Array.from(roomUpdatesByBackendId, ([roomId, body]) =>
            apiPatch(`/v1/jobs/${jobId}/rooms/${roomId}`, body).catch((err) => {
              console.warn("Room patch failed", roomId, err);
            }),
          );
          await Promise.all(roomUpdates);
        }

        // Sync walls to backend (non-blocking — runs after save succeeds).
        // Single rooms invalidation covers the batched room PATCHes above
        // plus any wall changes, so the list re-fetches exactly once.
        syncWallsToBackend(canvasData, jobRooms, jobId)
          .then(({ restampedAny }) => {
            queryClient.invalidateQueries({ queryKey: ["rooms", jobId] });
            // Only invalidate moisture-pins when an actual restamp
            // landed — empty-restamp autosaves (today's reality, since
            // no pin has non-NULL wall_segment_id yet) skip this to
            // avoid re-introducing the multi-pin drag race that commit
            // 731c061 closed.
            if (restampedAny) {
              queryClient.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
            }
          })
          .catch(() => {});

        // Note: moisture-pins invalidation is NOT here. It only fires
        // when Case-3 fork detected (above, after reconcileSavedVersion).
        // Putting an unconditional invalidation here re-introduces the
        // multi-pin drag race that commit 731c061 closed.

        // Success — clear local backup, reset retries, show saved.
        // Record the saved signature so an immediate re-invoke with the
        // same geometry can short-circuit at the top of handleChange.
        lastSavedSigRef.current = sig;
        clearLocalBackup();
        retryCount.current = 0;
        if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
        // Hold "Saving…" for at least 400ms so the user actually sees it.
        // Without this floor, fast POSTs (<100ms) batch saving→saved into one
        // render and the indicator looks like it never appeared.
        const elapsed = Date.now() - savingStartTime;
        if (elapsed < 400) {
          await new Promise((resolve) => setTimeout(resolve, 400 - elapsed));
        }
        setSaveStatus("saved");
        if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
        saveStatusTimer.current = setTimeout(() => { setSaveStatus("idle"); manualSaveRef.current = false; }, 2000);
      } catch (err) {
        // Round 3: 412 VERSION_STALE means another editor wrote to this
        // floor plan since we read it. Do NOT retry on 412 — a retry with
        // the same etag would 412 again, and a retry without it would be
        // the exact silent-overwrite we're trying to prevent. Surface a
        // banner so the user knows to reload + merge their edits.
        // Round-3 second critical review: centralize the 412 branch in
        // handleStaleConflictIfPresent so every save site inherits the
        // same conflict handling (cross-floor save was previously missing).
        // Round 5 (Lakshman P1 #2): pass rejectedCanvas + postTimeSourceFloorId
        // so the handler can persist the user's work to a conflict-draft
        // localStorage key before the reload nukes Konva state. Source floor
        // was captured BEFORE the await; activeFloorRef.current may have
        // moved during the POST.
        // Round-5 follow-up (Lakshman LOW #2): prefer lastCanvasRef over
        // the canvasData that was actually POSTed — if the user kept
        // editing during the in-flight save (via the _canvasSaveInFlight
        // defer path), lastCanvasRef holds the POST-save state. Persisting
        // only the POSTed canvas would lose those post-POST edits when
        // the user clicks Restore after reload. Falling back to canvasData
        // covers the common case where no deferred edits accumulated.
        const draftCanvas = lastCanvasRef.current?.data ?? canvasData;
        if (handleStaleConflictIfPresent(err, {
          floorPlanId: postTimeSourceFloorId ?? activeFloorRef.current?.id ?? "",
          rejectedCanvas: draftCanvas,
          jobId,
          setStaleConflict,
          setSaveStatus,
          clearRetryTimer: () => {
            if (retryTimer.current) clearTimeout(retryTimer.current);
          },
        })) {
          return;
        }
        console.error("Failed to save floor plan:", err);
        if (retryCount.current < MAX_RETRIES) {
          retryCount.current++;
          setSaveStatus("offline");
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => {
            // Round-3 second critical review: belt-and-suspenders — if a
            // staleConflict got raised between the time we scheduled this
            // retry and it fires, do not re-submit. Safety beats retry.
            if (staleConflictRef.current !== null) return;
            const pending = lastCanvasRef.current;
            if (pending) handleChangeRef.current(pending.data);
          }, 5000 * retryCount.current);
        } else {
          setSaveStatus("error");
        }
      } finally {
        // Round 5 (INV-4): clear the in-flight flag and replay any
        // deferred edits. The replay runs through a microtask so this
        // invocation's React state updates (reconcileSavedVersion →
        // setQueryData → etag refresh) complete before the next handleChange
        // reads currentFloor.etag. Without the microtask, the replay
        // would read the cache BEFORE the write committed and re-fire
        // with the same stale etag it just failed (or succeeded) with.
        //
        // The replay goes through handleChangeRef so it picks up the
        // current useCallback closure (floorPlans/jobId/etc. may have
        // changed during the await). The signature dedup at the top
        // of handleChange short-circuits if the deferred canvas ==
        // what we just saved (no wasted work).
        _canvasSaveInFlight = false;
        if (_canvasDeferredDuringSave) {
          _canvasDeferredDuringSave = false;
          const deferred = lastCanvasRef.current;
          if (
            deferred
            && deferred.floorId === activeFloorIdRef.current
            && staleConflictRef.current === null
          ) {
            queueMicrotask(() => handleChangeRef.current(deferred.data));
          }
        }
      }
    },
    [floorPlans, jobId, queryClient, jobRooms, createFloorPlan.isPending, backupToLocal, clearLocalBackup]
  );

  // Stable ref for handleChange — avoids stale closures in setTimeout callbacks
  const handleChangeRef = useRef(handleChange);
  handleChangeRef.current = handleChange;

  // Clean up timers on unmount
  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
  }, []);

  // When coming back online, retry any pending save.
  //
  // Round-3 second critical review: guard against auto-firing a retry
  // while a VERSION_STALE banner is showing. The cache could have
  // refetched a fresh etag behind the banner (staleTime expiry, sibling
  // invalidation) — a retry at that moment would send fresh etag + stale
  // canvas = silent overwrite. Only resolution path out of a stale
  // conflict is the Reload button, which triggers window.location.reload
  // and nukes all client state. Until that happens, don't auto-save.
  useEffect(() => {
    const handleOnline = () => {
      if (staleConflict !== null) return;
      if (lastCanvasRef.current && (saveStatus === "offline" || saveStatus === "error")) {
        retryCount.current = 0;
        handleChangeRef.current(lastCanvasRef.current.data);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [saveStatus, staleConflict]);

  // Restore pending backup after handleChange is available
  useEffect(() => {
    if (!pendingBackup || !floorPlans || floorPlans.length === 0) return;
    handleChangeRef.current(pendingBackup);
    setPendingBackup(null);
  }, [pendingBackup, floorPlans]);

  // Flush deferred save when floor creation finishes — only if data matches active floor
  useEffect(() => {
    if (wasPendingRef.current && !createFloorPlan.isPending && lastCanvasRef.current) {
      if (!lastCanvasRef.current.floorId || lastCanvasRef.current.floorId === activeFloorId) {
        handleChangeRef.current(lastCanvasRef.current.data);
      }
    }
    wasPendingRef.current = createFloorPlan.isPending;
  }, [createFloorPlan.isPending, activeFloorId]);

  /* ---------------------------------------------------------------- */
  /*  Add Floor                                                        */
  /* ---------------------------------------------------------------- */

  // NOTE: Auto-Main on fresh page load has been removed (Spec 01H Session 4).
  // Floors are now created on-demand — either by tapping a preset slot in the
  // FloorSelector or by confirming a room with a Floor field set.

  // Ensure a floor exists for the given level. Returns the floor row. Creates
  // the floor plan shell via the backend if missing (stamps + pins so the next
  // save lands as Case 2 in save_canvas, not Case 1 ghost-fork). Does NOT
  // activate — callers decide when to switch. Safe to call repeatedly.
  //
  // 409 recovery: React Query cache can fall behind the DB (another tab,
  // stale cache on back-nav, etc.). If the backend says "floor already
  // exists" we refetch and return the canonical row instead of surfacing
  // the error to the user.
  const ensureFloor = useCallback(async (level: FloorLevel): Promise<FloorPlan> => {
    const targetNumber = FLOOR_LEVEL_TO_NUMBER[level];
    const existing = floorPlans?.find((fp) => fp.floor_number === targetNumber);
    if (existing) return existing;
    try {
      const created = await createFloorPlan.mutateAsync({
        floor_number: targetNumber,
        floor_name: FLOOR_LEVEL_LABEL[level],
      });
      queryClient.setQueryData<FloorPlan[]>(["floor-plans", jobId], (old) => {
        const next = [...(old ?? [])];
        if (!next.some((fp) => fp.id === created.id)) next.push(created);
        return next;
      });
      return created;
    } catch (err: unknown) {
      const apiErr = err as { status?: number };
      if (apiErr.status === 409) {
        // Stale cache — refetch and find the existing row
        const refetched = await apiGet<{ items: FloorPlan[]; total: number } | FloorPlan[]>(
          `/v1/jobs/${jobId}/floor-plans`,
        );
        const plans = Array.isArray(refetched) ? refetched : refetched.items ?? [];
        queryClient.setQueryData<FloorPlan[]>(["floor-plans", jobId], plans);
        const found = plans.find((fp) => fp.floor_number === targetNumber);
        if (found) return found;
      }
      throw err;
    }
  }, [floorPlans, createFloorPlan, queryClient, jobId]);

  // Wire up the forward-declared ensureFloorRef now that ensureFloor is
  // defined. Same pattern as activeFloorIdRef sync up at line ~1336 —
  // handleCreateRoom (defined earlier in the file) reads
  // `ensureFloorRef.current` lazily so it always sees the latest
  // closure even though the function definition itself recreates on
  // every render via useCallback.
  ensureFloorRef.current = ensureFloor;

  // Create a specific preset floor (Basement/Main/Upper/Attic) on tap, or
  // switch to it if it already exists. Pre-floor drawing carry-over logic is
  // gone — with the noActiveFloor intercept, the user can't draw before a
  // floor exists. ensureFloor handles 409 recovery if the cache is stale.
  const handleCreatePresetFloor = useCallback(async (floorNumber: number, floorName: string) => {
    void floorName; // label derived from level inside ensureFloor; arg kept to match FloorSelector's signature
    const level = floorNumberToLevel(floorNumber);
    if (!level) return;
    canvasRef.current?.flush();
    try {
      const fp = await ensureFloor(level);
      lastCanvasRef.current = null;
      setActiveFloorId(fp.id);
    } catch (err) {
      console.error("Failed to create/switch preset floor", err);
    }
  }, [ensureFloor]);

  // Cross-floor room create: user drew on the active canvas but picked a
  // different Floor in the confirmation card. Merge the new room into the
  // target floor's canvas, POST to its versions endpoint, switch active,
  // then create the job_rooms row. Preserves both floors' existing content.
  const handleCreateRoomOnDifferentFloor = useCallback(async (
    targetLevel: FloorLevel,
    roomData: RoomConfirmationData,
    pendingBounds: { x: number; y: number; width: number; height: number; points?: Array<{ x: number; y: number }> },
    gridSize: number,
  ) => {
    // Round 3 (post-review): capture the target floor id OUTSIDE the try
    // so the catch block below can thread it to the stale-conflict banner.
    // Previously the catch fell back to activeFloorRef.current?.id, which
    // points at the OLD floor (the one the user is on), not the new one
    // that saveCanvasVersion actually failed against — banner copy would
    // say "Floor X is stale" while the stale floor was actually Y.
    let targetFloorIdForConflict: string | undefined;
    // Round 6 (Lakshman P1 blocker #1 / lessons-doc pattern #3):
    // mergedCanvas must be referenced from the catch block below to
    // persist the rejected canvas into the conflict-draft localStorage
    // entry on VERSION_STALE. `const` inside the try scopes it out of
    // catch — TS2304 compile error, Vercel build red. Hoist via the
    // same `let T | undefined` pattern already used for
    // targetFloorIdForConflict above. If construction throws before
    // assignment (ensureFloor / detectSharedWalls failure), the catch
    // sees undefined; handleStaleConflictIfPresent tolerates that via
    // its `rejectedCanvas !== undefined` guard, so the banner still
    // surfaces with no draft to persist (correct behavior — there was
    // no user work past the failure point anyway).
    let mergedCanvas: FloorPlanData | undefined;
    try {
      const targetFloor = await ensureFloor(targetLevel);
      targetFloorIdForConflict = targetFloor.id;


      // Spec 01H Phase 2 (duplicate-name fix): canvas room id is a real
      // UUID generated client-side; the same UUID becomes the backend
      // job_rooms.id when handleCreateRoom POSTs. propertyRoomId set
      // from t=0; resolver never falls back to name-match. See
      // konva-floor-plan.tsx where the on-canvas creation site does
      // the equivalent.
      const roomUuid = roomData.propertyRoomId ?? newRoomUuid();
      const newRoom: RoomData = {
        id: roomUuid,
        x: pendingBounds.x,
        y: pendingBounds.y,
        width: pendingBounds.width,
        height: pendingBounds.height,
        points: pendingBounds.points,
        name: roomData.name,
        fill: roomData.affected ? "#fee2e2" : "#fff3ed",
        propertyRoomId: roomUuid,
      };
      const newRoomWalls = wallsForRoom(newRoom);

      const existingCanvas = (targetFloor.canvas_data as FloorPlanData | null) ?? {
        gridSize, rooms: [], walls: [], doors: [], windows: [],
      };
      mergedCanvas = {
        ...existingCanvas,
        gridSize: existingCanvas.gridSize ?? gridSize,
        rooms: [...(existingCanvas.rooms ?? []), newRoom],
        walls: detectSharedWalls([...(existingCanvas.walls ?? []), ...newRoomWalls]),
      };

      setSaveStatus("saving");
      // Round-5 follow-up (Lakshman M1): targetFloor came from
      // ensureFloor which either returns an existing floor-plans row
      // (etag populated) or creates one via ensure_job_floor_plan
      // (also etag-populated).
      //
      // Round-6 follow-up (Lakshman LOW): the `*` fallback is NOT a
      // "creation opt-out that succeeds" — the round-6 service-layer
      // wildcard gate rejects `*` with 412 WILDCARD_ON_EXISTING
      // whenever target_updated_at is set, which is always the case
      // for a legitimately-fetched row (trigger auto-stamps updated_at
      // on every insert). The fallback fires only if the backend
      // ships without a populated etag (rollout skew or a
      // @computed_field regression) — in that case we 412 loudly,
      // trip the stale-conflict banner, and force a reload. Strictly
      // safer than silent last-write-wins. Normal operation:
      // hasEtag(targetFloor) returns true and we use the real etag.
      const crossFloorEtag: string = hasEtag(targetFloor) ? targetFloor.etag : "*";
      const savedVersion = await saveCanvasVersion({
        floorPlanId: targetFloor.id,
        jobId,
        canvasData: mergedCanvas,
        etag: crossFloorEtag,
      });

      // R12 (round 2) + Round 3: reconcile caches using savedVersion.id
      // as truth. On Case 3 fork the selector moves to savedVersion.id;
      // the per-row list gets the canvas-enriched version so the first
      // paint after navigating to the target floor renders the merged
      // data (no empty-state flash).
      //
      // Pass the enriched row to the shared helper so its list-swap
      // writes the canvas_data into the cache. Also seed the per-row
      // floor-plan-history cache (cross-floor-specific — the other 3
      // save sites don't navigate, so they don't need this seed).
      const savedVersionWithCanvas: FloorPlan = {
        ...savedVersion,
        canvas_data: mergedCanvas as unknown as Record<string, unknown>,
      };
      queryClient.setQueryData<FloorPlan[]>(
        ["floor-plan-history", savedVersion.id],
        (old) => {
          const next = (old ?? []).map((v) => v.id === savedVersion.id ? savedVersion : v);
          if (!next.some((v) => v.id === savedVersion.id)) next.unshift(savedVersion);
          return next;
        },
      );
      reconcileSavedVersion(
        queryClient, jobId, targetFloor.id, savedVersionWithCanvas, setActiveFloorId,
      );
      // reconcileSavedVersion only switches activeFloorId on a fork
      // (savedVersion.id !== sourceFloorId). Cross-floor create is a
      // non-fork save — the user is on Main, picked Upper, and we just
      // wrote onto Upper's own row. Without this line, activeFloorId
      // stays on Main and the user sees an empty Main canvas while their
      // room lands on Upper. Restores the explicit floor switch that
      // the round-3 refactor dropped when it moved reconciliation into
      // the shared helper.
      // Spec 01H Phase 2 fix (2026-04-27): seed `lastCanvasRef` with the
      // merged canvas keyed to the new active floor BEFORE the
      // setActiveFloorId triggers Konva's remount via the
      // `key={activeFloor?.id}` prop.
      lastCanvasRef.current = { floorId: savedVersion.id, data: mergedCanvas };
      // Force Konva to remount so it re-reads `initialData` from
      // `lastCanvasRef`. Without this, Konva's internal state stays
      // at pre-save (empty) and the new room only renders on hard
      // refresh. The seed bumps the `key` regardless of whether
      // `activeFloor.id` changes, covering the case where user
      // is already on the target floor.
      setCanvasRemountSeed((n) => n + 1);
      setActiveFloorId(savedVersion.id);

      setSaveStatus("saved");
      if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
      saveStatusTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);

      // Create the job_rooms row with metadata (floor_level locked to target).
      // Pass `targetFloor.id` explicitly so handleCreateRoom doesn't race
      // the activeFloorId state update — on a fresh property we just
      // created the floor a few lines above and the React ref hasn't
      // re-rendered yet, so `activeFloorIdRef.current` could still be
      // null. The explicit override guarantees the new room's
      // `floor_plan_id` is set deterministically.
      //
      // CRITICAL: pass `roomUuid` as the canvasRoomId. Spec 01H Phase 2
      // (duplicate-name fix, 2026-04-27) routes the client-generated
      // UUID to the backend so the canvas room and backend job_rooms
      // row share the same id. Pre-fix this site passed `undefined` →
      // handleCreateRoom omitted `id` from the POST body → backend
      // generated its own UUID → canvas state and backend diverged →
      // pin POST 500'd with PGRST116 because the canvas-side UUID
      // didn't exist as a job_rooms row.
      const widthFt = Math.round((pendingBounds.width / gridSize) * 10) / 10;
      const heightFt = Math.round((pendingBounds.height / gridSize) * 10) / 10;
      handleCreateRoom(
        roomData.name,
        { width: widthFt, height: heightFt },
        {
          roomType: roomData.roomType,
          ceilingHeight: roomData.ceilingHeight,
          ceilingType: roomData.ceilingType,
          floorLevel: targetLevel,
          materialFlags: roomData.materialFlags,
          affected: roomData.affected,
        },
        roomUuid,
        targetFloor.id,
      );
    } catch (err) {
      // Round-3 second critical review (HIGH #1 sibling-miss):
      // cross-floor save previously swallowed 412 into a generic "error"
      // badge. A VERSION_STALE here is exactly the concurrent-editing
      // case the user needs to see — route through the shared helper so
      // the stale-conflict banner surfaces and the reload path works.
      // Round 5 (P1 #2): pass rejectedCanvas so the user's cross-floor
      // work gets persisted to the conflict-draft localStorage key
      // keyed on the TARGET floor (where the save was written to, not
      // the source the user drew on) — restore banner after reload
      // routes the draft back to the correct floor.
      if (handleStaleConflictIfPresent(err, {
        // Prefer the target floor id captured above — that's the floor
        // saveCanvasVersion actually wrote against. Fall back to the
        // active floor only if ensureFloor itself threw before returning
        // (targetFloorIdForConflict undefined), so the banner still has
        // a non-empty floorPlanId for its localStorage purge.
        floorPlanId: targetFloorIdForConflict
          ?? activeFloorRef.current?.id
          ?? "",
        rejectedCanvas: mergedCanvas,
        jobId,
        setStaleConflict,
        setSaveStatus,
      })) {
        return;
      }
      console.error("Cross-floor room create failed", err);
      setSaveStatus("error");
    }
  }, [ensureFloor, queryClient, jobId, handleCreateRoom]);

  // Derive active floor's semantic level for the canvas to compare against the
  // confirmation card's Floor field.
  const activeFloorLevel: FloorLevel | null = floorNumberToLevel(activeFloor?.floor_number);

  // Intercept modal — opens when the user attempts to draw (wall/door/window/
  // trace/room) while no floor is active. Picking a floor here creates or
  // switches into it; modal closes on pick or backdrop tap.
  const [pickFloorOpen, setPickFloorOpen] = useState(false);
  const handlePickFloorFromModal = useCallback(async (level: FloorLevel) => {
    try {
      const fp = await ensureFloor(level);
      setActiveFloorId(fp.id);
      setPickFloorOpen(false);
    } catch (err) {
      console.error("Failed to pick floor from modal", err);
    }
  }, [ensureFloor]);

  const [deleteFloorModalId, setDeleteFloorModalId] = useState<string | null>(null);
  const executeDeleteFloor = useCallback((floorPlanId: string) => {
    setDeleteFloorModalId(null);
    // Cancel any pending save for this floor before deleting
    lastCanvasRef.current = null;
    deleteFloorPlan.mutate(floorPlanId, {
      onSuccess: () => {
        // Read fresh from cache, not the closure's stale floorPlans
        const cached = queryClient.getQueryData<FloorPlan[]>(["floor-plans", jobId]) ?? [];
        const remaining = cached.filter((fp) => fp.id !== floorPlanId);
        if (remaining.length > 0) {
          setActiveFloorId(remaining[0].id);
          setActiveFloorIdx(0);
        }
      },
    });
  }, [deleteFloorPlan, queryClient, jobId]);

  /* ---------------------------------------------------------------- */
  /*  Loading                                                          */
  /* ---------------------------------------------------------------- */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-outline-variant border-t-brand-accent rounded-full animate-spin" />
          <span className="text-[13px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
            Loading floor plans...
          </span>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex flex-col h-dvh bg-surface overflow-hidden">
      {/* Navigation bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-outline-variant/40 bg-surface-container-lowest overflow-hidden">
        <button
          type="button"
          onClick={() => {
            canvasRef.current?.flush();
            // Invalidate job-level caches so the detail page's Property Layout
            // and floor pills reflect any rooms/floors created here. Without
            // this, back-navigation shows stale data until a hard refresh.
            queryClient.invalidateQueries({ queryKey: ["jobs", jobId] });
            queryClient.invalidateQueries({ queryKey: ["rooms", jobId] });
            queryClient.invalidateQueries({ queryKey: ["floor-plans", jobId] });
            // Pin → room → floor join is server-computed and embedded on
            // each pin row. Sketch saves can change job_rooms.floor_plan_id
            // (cross-floor moves) or the room->floor binding via canvas_data
            // dedupe, so the cached pin payload's floor_plan_id goes stale.
            // Without this invalidation, soft-navigating into Moisture mode
            // shows pins on the old floor (or as orphans, which the canvas
            // doesn't render) until the user hard-refreshes.
            queryClient.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
            router.push(`/jobs/${jobId}`);
          }}
          aria-label="Back to job"
          className="flex items-center gap-1 text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer shrink-0"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" className="sm:w-[18px] sm:h-[18px]">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {/* Text label desktop-only — mobile relies on the arrow alone to save toolbar space */}
          <span className="hidden sm:inline">Back to Job</span>
        </button>

        {/* Save button — always orange */}
        <button
          type="button"
          onClick={() => {
            manualSaveRef.current = true;
            // flush() only fires when there are pending changes. If nothing
            // to save, still give brief "Saved ✓" feedback so the click isn't
            // a silent no-op. If flush fires, handleChange drives saveStatus.
            canvasRef.current?.flush();
            if (saveStatus === "idle" || saveStatus === "saved") {
              setSaveStatus("saved");
              if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
              saveStatusTimer.current = setTimeout(() => setSaveStatus("idle"), 1200);
            }
          }}
          disabled={saveStatus === "saving"}
          // min-w-[62px] reserves room for "Saving..." / "Saved ✓" / "Offline"
          // so the Mode switcher to the right doesn't jog horizontally across
          // save transitions. 62px comfortably fits every status string at 11px.
          className={`ml-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-opacity disabled:opacity-70 shrink-0 min-w-[62px] text-center ${
            saveStatus === "offline" ? "bg-on-surface-variant/70 text-white" : "bg-brand-accent text-on-primary hover:opacity-90"
          }`}
        >
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved ✓" : saveStatus === "offline" ? "Offline" : saveStatus === "error" ? "Retry" : "Save"}
        </button>

        {/* Canvas mode switcher — Sketch ↔ Moisture. Cyan accent when Moisture
            is active; icon-only on mobile, icon + label on sm+. Sits between
            Save and the floor selector so mode + floor share the same header
            row without adding new chrome. */}
        <div className="ml-2 shrink-0">
          <CanvasModeSwitcher
            mode={canvasMode}
            onChange={setCanvasMode}
            // Do NOT disable on archived jobs. Mode switching is a
            // pure navigation — Moisture Mode becomes an audit view
            // (pin taps open a read-only reading sheet; writes are
            // hidden in UI and 403'd by the backend). Blocking the
            // switcher would leave archived-job techs unable to
            // inspect historical drying data, which is exactly what
            // the carrier expects them to be able to reference.
            disabled={saveStatus === "saving"}
          />
        </div>

        {/* Floor selector — 4 preset slots (Basement/Main/Upper/Attic) with version chip on active */}
        <div className="ml-auto min-w-0">
          <FloorSelector
            floorPlans={floorPlans}
            activeFloorId={activeFloorId}
            onSelectFloor={(id) => {
              canvasRef.current?.flush();
              // Clear in-memory canvas state so switching floors doesn't carry
              // one floor's drawings into another via the initialData fallback.
              lastCanvasRef.current = null;
              setActiveFloorId(id);
            }}
            onCreateFloor={handleCreatePresetFloor}
            disabled={isJobArchived}
            // NOTE: intentionally not forwarding createFloorPlan.isPending here.
            // Disabling empty presets during an in-flight create blocks the user
            // for ~500ms-1s and feels "stuck" — and the DB unique constraint on
            // (property_id, floor_number) already prevents duplicate creations
            // at the backend level, so defensive UI disabling isn't needed.
          />
        </div>
      </div>

      {/* Archived-job banner — shown when job.status ∈ {complete, submitted, collected}.
          The floor plan is frozen to its pinned version; edits are blocked. */}
      {isJobArchived && (
        <div className="px-4 py-2 bg-amber-50 border-y border-amber-200 text-[12px] text-amber-900 flex items-center gap-2">
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>
            <span className="font-semibold">Read-only.</span> This job is {job?.status} — its floor plan is locked to the version pinned at that time.
          </span>
        </div>
      )}

      {/* Canvas — takes remaining viewport height minus header + footer */}
      <div className="flex-1 min-h-[400px] relative">
        {!canvasReady && (
          /* Visible loader while job + versions are still in flight — prevents
             the "Draw your first room" empty-state flash on reload. */
          <div className="absolute inset-0 flex items-center justify-center bg-surface-container-low">
            <div className="flex flex-col items-center gap-3 text-on-surface-variant/60 font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-wider">
              <div className="w-7 h-7 rounded-full border-2 border-brand-accent/20 border-t-brand-accent animate-spin" />
              <span>Loading floor plan…</span>
            </div>
          </div>
        )}
        {canvasReady && <KonvaFloorPlan
          ref={canvasRef}
          // Key only tracks floor id. Previously also included backupChecked,
          // versionsLoading, and job presence — each gate flip remounted the
          // canvas and caused a ~1s stutter during the first-room save flow.
          // Gating readiness via `canvasReady` (sticky state) means mount
          // happens ONCE when data is ready, and the only subsequent remount is
          // the unavoidable "new"→real-id transition on first save.
          key={`${activeFloor?.id ?? "new"}:${canvasRemountSeed}`}
          initialData={
            pendingBackup
              // Carry user's in-memory canvas across the remount that happens when
              // the first save transitions the canvas key from "new" → real id.
              // Strictly scoped to THIS floor — no null-floor fallback, which used
              // to let pre-floor state leak across floor switches.
              ?? (
                lastCanvasRef.current
                && lastCanvasRef.current.floorId === activeFloorId
                  ? lastCanvasRef.current.data
                  : undefined
              )
              ?? hydrationCanvasData
          }
          onChange={(data: FloorPlanData) => {
            lastCanvasRef.current = { floorId: activeFloorId, data };
            handleChange(data);
          }}
          readOnly={isJobArchived}
          rooms={jobRooms?.map((r) => ({
            id: r.id,
            room_name: r.room_name,
            affected: r.affected,
            // material_flags feeds the "Suggested materials" group in the
            // moisture placement sheet — a bedroom's ["carpet","drywall"] will
            // float carpet_pad + drywall to the top of the material dropdown.
            // Coerce null → undefined so the prop type stays optional[].
            material_flags: r.material_flags ?? undefined,
            // floor_plan_id is the secondary floor-resolution path for
            // the moisture pin filter: when a pin's joined floor_plan_id
            // is missing (freshly-created cache entry), the filter looks
            // up the room here to learn which floor to gate against.
            floor_plan_id: r.floor_plan_id,
          }))}
          onCreateRoom={handleCreateRoom}
          activeFloorLevel={activeFloorLevel}
          onCreateRoomOnDifferentFloor={handleCreateRoomOnDifferentFloor}
          noActiveFloor={!activeFloor && !isJobArchived}
          onDrawAttemptWithoutFloor={() => setPickFloorOpen(true)}
          jobId={jobId}
          activeFloorPlanId={activeFloorId}
          onSelectionChange={handleSelectionChange}
          onEditRoom={handleDesktopEditRoom}
          canvasMode={canvasMode}
        />}
      </div>


      {/* Mobile bottom panel — room photos (md:hidden), positioned above bottom nav */}
      {mobileSelectedRoom && (
        <MobileRoomPanel
          room={mobileSelectedRoom}
          jobId={jobId}
          photos={allPhotos.filter(p => p.room_id === mobileSelectedRoom.propertyRoomId)}
          onClose={() => {
            setMobileSelectedRoom(null);
            selectedRoomRef.current = null;
            canvasRef.current?.clearSelection();
          }}
          onEditRoom={handleEditRoom}
          // Dismiss the panel but KEEP canvas selection so vertex drag handles
          // stay visible unobstructed. For RECTANGLES, first convert them to
          // 4-point polygons so their corners become draggable vertices.
          onEditShape={() => {
            if (!mobileSelectedRoom.isPolygon) {
              canvasRef.current?.convertRoomToPolygon(mobileSelectedRoom.id);
            }
            setMobileSelectedRoom(null);
          }}
          onResize={mobileSelectedRoom.isPolygon ? undefined : (w, h) => {
            canvasRef.current?.resizeRoomTo(mobileSelectedRoom.id, w, h);
          }}
          isPolygon={mobileSelectedRoom.isPolygon}
          wallSf={jobRooms?.find(r => r.id === mobileSelectedRoom.propertyRoomId)?.wall_square_footage}
        />
      )}

      {/* Round 3: stale-version conflict banner. Shown when another editor
          wrote to the floor plan between our read and our save (412
          VERSION_STALE). User can reload to pick up the other editor's
          changes; their pending edits are persisted to localStorage
          (round-5 P1 #2) and offered for restore on next load.
          conflictDraft banner below handles the restore flow. */}
      {staleConflict && (
        <div className="fixed inset-x-0 top-4 z-[70] flex justify-center px-4">
          <div className="max-w-md w-full rounded-xl bg-surface-container-lowest border border-red-300 shadow-lg p-4">
            <p className="text-[13px] font-semibold text-on-surface mb-1">
              Floor plan needs to be reloaded
            </p>
            <p className="text-[12px] text-on-surface-variant mb-3">
              Another editor saved this floor plan since you last
              opened it, so your changes can&apos;t land on top
              directly. Reload to pick up the latest state.
              <strong className="text-on-surface">
                {" "}
                Your unsaved work is safe — after the reload, look for
                the &ldquo;Restore my edits&rdquo; prompt at the top of
                the page and click it to bring your changes back.
              </strong>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  // Round-3 second critical review (CRITICAL silent-overwrite):
                  // React Query cache invalidation alone is NOT sufficient.
                  // Konva maintains its own stage state outside React Query,
                  // and <KonvaFloorPlan key={activeFloor?.id}> only re-mounts
                  // when the floor id changes — which doesn't happen on reload.
                  // Previous implementation: invalidate caches, clear
                  // lastSavedSigRef, dismiss banner. Result: server had fresh
                  // canvas, React Query had fresh etag, but Konva still held
                  // the user's REJECTED canvas in memory. Next keystroke
                  // wrote that stale canvas back with a now-matching fresh
                  // etag — the exact silent-overwrite the etag system was
                  // meant to prevent.
                  //
                  // window.location.reload() is the only reliably-correct
                  // reset: dumps all in-memory state (Konva, refs,
                  // pendingBackup, lastCanvasRef), forces re-hydration from
                  // the server. The browser takes ~500ms; for a safety
                  // mechanism guarding against silent data loss, that cost
                  // is acceptable. localStorage backup is cleared below
                  // first so the reload doesn't re-deliver the rejected
                  // canvas via the pendingBackup restoration path.
                  if (typeof window !== "undefined") {
                    try {
                      // Clear any local backup for this floor so the
                      // post-reload restoration flow doesn't re-deliver
                      // the rejected canvas (the backup was our client's
                      // stale view of the world).
                      // Key format mirrors the one at L862:
                      //   fp-backup-${jobId}-${activeFloorId}
                      //   or fp-backup-${jobId} when no active floor.
                      const active = activeFloorRef.current?.id ?? staleConflict.floorPlanId;
                      const lsKey = active
                        ? `fp-backup-${jobId}-${active}`
                        : `fp-backup-${jobId}`;
                      window.localStorage.removeItem(lsKey);
                    } catch {
                      // localStorage unavailable (private mode, etc.) —
                      // reload still does the right thing; backup path
                      // just won't trigger.
                    }
                    window.location.reload();
                  }
                }}
                className="h-9 rounded-lg text-[13px] font-semibold text-on-primary bg-brand-accent px-5 inline-flex items-center justify-center hover:shadow-lg active:scale-[0.98]"
              >
                Reload
              </button>
              {/*
                Round-3 second critical review: Dismiss button removed.
                The investigation caught that clearing only the banner
                left lastCanvasRef + Konva state + localStorage backup
                all holding the rejected canvas. The next keystroke
                would have silently overwritten the remote editor's work
                with stale data + fresh etag. Reload is the only safe
                exit from a stale-conflict state; making the user commit
                to that is intentional, not friction.
              */}
            </div>
          </div>
        </div>
      )}

      {/* Round 5 (Lakshman P1 #2): conflict-draft restore banner. Surfaces
          after a reload that followed a VERSION_STALE rejection — the
          pre-reload mount effect scanned localStorage for
          canvas-conflict-draft:${jobId}:* keys and picked the most
          recent. User chooses:
            Restore → apply draft on top of current canvas (which already
                      reflects the other editor's changes), clear the key.
            Discard → drop the draft, clear the key.
          We deliberately do NOT auto-apply; letting the user decide is
          the point (they may have moved on, or the draft may be stale
          enough that merging would produce garbage). */}
      {conflictDraft && !staleConflict && (
        <div className="fixed inset-x-0 top-4 z-[70] flex justify-center px-4">
          <div className="max-w-md w-full rounded-xl bg-amber-50 border-2 border-amber-400 shadow-lg p-4">
            <p className="text-[13px] font-semibold text-amber-900 mb-1">
              Restore your unsaved edits?
            </p>
            <p className="text-[12px] text-amber-900/80 mb-3">
              Before the reload, you had unsaved changes that conflicted
              with another editor&apos;s save. Your work is preserved —
              click <strong>Restore my edits</strong> to apply it on top
              of the current floor plan, or <strong>Discard</strong> to
              start fresh from the server&apos;s state.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  // Restore: switch to the draft's source floor if it's not
                  // already active (the user may have navigated elsewhere
                  // between reload and clicking Restore), hydrate Konva with
                  // the draft canvas by routing through handleChange (which
                  // also persists server-side), then clear the localStorage
                  // key so the banner doesn't resurface.
                  try {
                    if (activeFloorIdRef.current !== conflictDraft.floorPlanId) {
                      setActiveFloorId(conflictDraft.floorPlanId);
                    }
                    // Defer one tick so the activeFloor switch settles
                    // before handleChange reads currentFloor from cache.
                    queueMicrotask(() => {
                      handleChangeRef.current(conflictDraft.canvasData);
                    });
                    if (typeof window !== "undefined") {
                      window.localStorage.removeItem(
                        `canvas-conflict-draft:${jobId}:${conflictDraft.floorPlanId}`,
                      );
                    }
                  } catch (e) {
                    console.error("Restore conflict draft failed", e);
                  } finally {
                    setConflictDraft(null);
                  }
                }}
                className="h-9 rounded-lg text-[13px] font-semibold text-on-primary bg-brand-accent px-5 inline-flex items-center justify-center hover:shadow-lg active:scale-[0.98]"
              >
                Restore my edits
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    if (typeof window !== "undefined") {
                      window.localStorage.removeItem(
                        `canvas-conflict-draft:${jobId}:${conflictDraft.floorPlanId}`,
                      );
                    }
                  } catch { /* noop */ }
                  setConflictDraft(null);
                }}
                className="h-9 rounded-lg text-[13px] font-medium text-on-surface-variant border border-outline-variant px-4 inline-flex items-center justify-center hover:bg-surface-container"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Room edit modal — z-[60] to sit above bottom nav bar */}
      {editingRoomData && (
        <div className="fixed inset-0 z-[60]">
          <RoomConfirmationCard
            existingRooms={[]}
            onConfirm={handleEditRoomConfirm}
            onCancel={() => setEditingRoomData(null)}
            editingRoom={editingRoomData}
          />
        </div>
      )}

      {/* Delete floor confirmation modal */}
      {deleteFloorModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[340px] mx-4">
            <h3 className="text-[15px] font-semibold text-[#1a1a1a] mb-2">
              Delete {floorPlans?.find((fp) => fp.id === deleteFloorModalId)?.floor_name ?? "this floor"}?
            </h3>
            <p className="text-[13px] text-[#6b6560] mb-5">
              This will permanently remove the floor and all its rooms, walls, doors, and windows.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDeleteFloorModalId(null)}
                className="px-4 h-9 rounded-lg text-[13px] font-medium text-[#6b6560] bg-[#eae6e1] hover:bg-[#ddd8d2] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeDeleteFloor(deleteFloorModalId)}
                disabled={deleteFloorPlan.isPending}
                className="px-4 h-9 rounded-lg text-[13px] font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {deleteFloorPlan.isPending ? "Deleting..." : "Delete Floor"}
              </button>
            </div>
          </div>
        </div>
      )}

      <PickFloorModal
        open={pickFloorOpen}
        floorPlans={floorPlans}
        onPick={handlePickFloorFromModal}
        onClose={() => setPickFloorOpen(false)}
      />
    </div>
  );
}
