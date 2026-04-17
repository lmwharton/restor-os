"use client";

import { use, useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import type { FloorPlan } from "@/lib/types";
import type { FloorPlanData } from "@/components/sketch/floor-plan-tools";
import type { KonvaFloorPlanHandle } from "@/components/sketch/konva-floor-plan";
import { RoomConfirmationCard, type RoomConfirmationData } from "@/components/sketch/room-confirmation-card";
import { FloorSelector } from "@/components/sketch/floor-selector";
import type { WallSegment } from "@/lib/types";

const KonvaFloorPlan = dynamic(() => import("@/components/sketch/konva-floor-plan"), { ssr: false });

/* ------------------------------------------------------------------ */
/*  Wall sync: canvas walls → backend wall_segments                    */
/* ------------------------------------------------------------------ */

async function syncWallsToBackend(
  canvasData: FloorPlanData,
  jobRooms: Array<{ id: string; room_name: string }> | undefined,
) {
  if (!canvasData.walls || !jobRooms || jobRooms.length === 0) return;

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

  for (const room of canvasData.rooms) {
    const backendRoomId = room.propertyRoomId
      ?? jobRooms.find((r) => r.room_name === room.name)?.id;

    if (!backendRoomId) continue;

    const roomWalls = wallsByRoom.get(room.id) ?? [];
    if (roomWalls.length === 0) continue;

    try {
      // Get existing backend walls
      const existing = await apiGet<{ items: WallSegment[] } | WallSegment[]>(
        `/v1/rooms/${backendRoomId}/walls`
      );
      const existingWalls = Array.isArray(existing) ? existing : existing.items ?? [];

      // Delete existing walls (clean slate — cascades openings)
      for (const w of existingWalls) {
        await apiDelete(`/v1/rooms/${backendRoomId}/walls/${w.id}`);
      }

      // Create new walls and track ID mapping
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
      }
    } catch (err) {
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
  wallSf,
  isPolygon,
}: {
  room: { id: string; name: string; widthFt: number; heightFt: number; propertyRoomId: string };
  jobId: string;
  photos: import("@/lib/types").Photo[];
  onClose: () => void;
  onEditRoom?: () => void;
  onEditShape?: () => void;
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
            <div>
              <h3 className="text-[14px] font-semibold text-on-surface">{room.name}</h3>
              <span className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                {room.widthFt} &times; {room.heightFt} ft &middot; {Math.round(room.widthFt * room.heightFt)} SF
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
  // Jobs in these statuses are read-only — backend returns 403 on any save attempt,
  // and the job's pinned version is frozen against auto-upgrade from sibling jobs.
  const isJobArchived = job?.status === "complete" || job?.status === "submitted" || job?.status === "collected";
  const { data: floorPlans, isLoading } = useFloorPlans(jobId);
  const createFloorPlan = useCreateFloorPlan(jobId);
  const deleteFloorPlan = useDeleteFloorPlan(jobId);
  const canvasRef = useRef<KonvaFloorPlanHandle>(null);
  const { data: jobRooms } = useRooms(jobId);
  const createRoom = useCreateRoom(jobId);
  const updateRoom = useUpdateRoom(jobId);
  const handleCreateRoom = useCallback((
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
  ) => {
    // Check if room already exists in Property Layout — update dimensions if so
    const existing = jobRooms?.find((r) => r.room_name === name);
    if (existing) {
      if (dimensions) {
        updateRoom.mutate({ roomId: existing.id, width_ft: dimensions.width, length_ft: dimensions.height } as Record<string, unknown> & { roomId: string });
      }
      return;
    }
    createRoom.mutate({
      room_name: name,
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
    } as Record<string, unknown>);
  }, [jobRooms, createRoom, updateRoom]);

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

  const handleSelectionChange = useCallback((info: { selectedId: string; type: "room"; name: string; widthFt: number; heightFt: number; propertyRoomId?: string; isPolygon?: boolean } | null) => {
    if (!info) { setMobileSelectedRoom(null); selectedRoomRef.current = null; return; }
    const propertyRoom = info.propertyRoomId
      ? jobRooms?.find(r => r.id === info.propertyRoomId)
      : jobRooms?.find(r => r.room_name === info.name);
    if (!propertyRoom) { setMobileSelectedRoom(null); selectedRoomRef.current = null; return; }
    selectedRoomRef.current = { id: info.selectedId, name: info.name, propertyRoomId: propertyRoom.id };
    setMobileSelectedRoom({ id: info.selectedId, name: info.name, widthFt: info.widthFt, heightFt: info.heightFt, propertyRoomId: propertyRoom.id, isPolygon: info.isPolygon });
  }, [jobRooms]);

  const [activeFloorIdx, setActiveFloorIdx] = useState(0);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const lastCanvasRef = useRef<{ floorId: string | null; data: FloorPlanData } | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error" | "offline">("idle");
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
  // Active jobs additionally wait for at least one floor to exist. On a fresh
  // property, floorPlans loads as [] and auto-Main fires asynchronously.
  const liveCanvasReady =
    !!job
    && floorPlans !== undefined
    && (isJobArchived || floorPlans.length > 0)
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
  const activeFloorIdRef = useRef(activeFloorId);
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
      // eslint-disable-next-line no-console
      console.log("[autosave] handleChange called", { isPending: createFloorPlan.isPending, archived: isJobArchivedRef.current, activeFloorId: activeFloorIdRef.current });
      // Archived jobs are read-only — skip server save entirely. Backend would
      // reject with 403 "Cannot edit floor plan for an archived job" anyway.
      if (isJobArchivedRef.current) {
        // eslint-disable-next-line no-console
        console.log("[autosave] handleChange EXIT: archived");
        return;
      }

      // Always backup to localStorage (survives browser close) — even during pending create
      backupToLocal(canvasData, activeFloorIdRef.current);

      // Defer ONLY when a floor creation is in flight AND we have no active
      // floor to save against. The original guard deferred on isPending alone,
      // which was over-restrictive: React 19 / React Query batching can leave
      // isPending=true for one extra render even after the new floor's row is
      // already in the query cache and activeFloorId is set. If we have an
      // active floor, we know exactly what to POST to — no duplicate risk.
      if (createFloorPlan.isPending && !activeFloorIdRef.current) {
        // eslint-disable-next-line no-console
        console.log("[autosave] handleChange DEFER: createFloorPlan.isPending AND no active floor");
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

      // Try ref first, then fall back to looking up by ID in query cache
      const currentFloor = activeFloorRef.current
        ?? (activeFloorIdRef.current ? queryClient.getQueryData<FloorPlan[]>(["floor-plans", jobId])?.find((fp) => fp.id === activeFloorIdRef.current) : null);
      // eslint-disable-next-line no-console
      console.log("[autosave] handleChange POSTING", { floorId: currentFloor?.id, hasCurrentFloor: !!currentFloor });
      setSaveStatus("saving");
      // Track when "saving" started so the indicator stays visible long enough
      // for the human eye even if the POST returns in <100ms (otherwise React
      // batches saving→saved into a single render and you only see "Saved ✓").
      const savingStartTime = Date.now();
      try {
        if (currentFloor) {
          // Save through the versioning state machine. Backend decides: create v1,
          // update in place, or fork a new version based on job ownership.
          await apiPost(`/v1/floor-plans/${currentFloor.id}/versions`, {
            job_id: jobId,
            canvas_data: canvasData,
          });
          queryClient.invalidateQueries({ queryKey: ["floor-plan-history", currentFloor.id] });
          // Backend may update jobs.floor_plan_id on first save (Case 1) or
          // fork (Case 3). Sibling jobs keep their own pins — no auto-upgrade.
          // Refetch this job so hydration reads the fresh pin; invalidate jobs
          // broadly so other open tabs pick up the new version in their lists.
          queryClient.invalidateQueries({ queryKey: ["jobs", jobId] });
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
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
            await apiPost(`/v1/floor-plans/${created.id}/versions`, {
              job_id: jobId,
              canvas_data: canvasData,
            });
            queryClient.invalidateQueries({ queryKey: ["floor-plan-history", created.id] });
            queryClient.invalidateQueries({ queryKey: ["jobs", jobId] });
            queryClient.invalidateQueries({ queryKey: ["jobs"] });
          } catch (err: unknown) {
            const apiErr = err as { status?: number };
            if (apiErr.status === 409) {
              const refetched = await apiGet<{ items: FloorPlan[]; total: number } | FloorPlan[]>(
                `/v1/jobs/${jobId}/floor-plans`,
              );
              const plans = Array.isArray(refetched) ? refetched : refetched.items ?? [];
              queryClient.setQueryData<FloorPlan[]>(["floor-plans", jobId], plans);
              if (plans.length > 0) {
                const fp = plans[0];
                setActiveFloorId(fp.id);
                await apiPost(`/v1/floor-plans/${fp.id}/versions`, {
                  job_id: jobId,
                  canvas_data: canvasData,
                });
                queryClient.invalidateQueries({ queryKey: ["floor-plan-history", fp.id] });
                queryClient.invalidateQueries({ queryKey: ["jobs", jobId] });
                queryClient.invalidateQueries({ queryKey: ["jobs"] });
              }
            } else {
              throw err;
            }
          }
        }
        // Sync room dimensions from sketch to Property Layout rooms
        if (canvasData.rooms && jobRooms) {
          const gs = canvasData.gridSize || 20;
          for (const drawnRoom of canvasData.rooms) {
            const match = drawnRoom.propertyRoomId
              ? jobRooms.find((r) => r.id === drawnRoom.propertyRoomId)
              : jobRooms.find((r) => r.room_name === drawnRoom.name);
            if (match) {
              const widthFt = Math.round((drawnRoom.width / gs) * 10) / 10;
              const lengthFt = Math.round((drawnRoom.height / gs) * 10) / 10;
              const currentW = Math.round((match.width_ft ?? 0) * 10) / 10;
              const currentL = Math.round((match.length_ft ?? 0) * 10) / 10;
              if (widthFt !== currentW || lengthFt !== currentL) {
                updateRoom.mutate({ roomId: match.id, width_ft: widthFt, length_ft: lengthFt } as Record<string, unknown> & { roomId: string });
              }
            }
          }
        }

        // Sync walls to backend (non-blocking — runs after save succeeds)
        syncWallsToBackend(canvasData, jobRooms)
          .then(() => queryClient.invalidateQueries({ queryKey: ["rooms", jobId] }))
          .catch(() => {});

        // Success — clear local backup, reset retries, show saved
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
        // eslint-disable-next-line no-console
        console.log("[autosave] save SUCCEEDED, flipping to Saved ✓");
        setSaveStatus("saved");
        if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
        saveStatusTimer.current = setTimeout(() => { setSaveStatus("idle"); manualSaveRef.current = false; }, 2000);
      } catch (err) {
        console.error("Failed to save floor plan:", err);
        if (retryCount.current < MAX_RETRIES) {
          retryCount.current++;
          setSaveStatus("offline");
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => {
            const pending = lastCanvasRef.current;
            if (pending) handleChangeRef.current(pending.data);
          }, 5000 * retryCount.current);
        } else {
          setSaveStatus("error");
        }
      }
    },
    [floorPlans, jobId, queryClient, jobRooms, updateRoom, createFloorPlan.isPending, backupToLocal, clearLocalBackup]
  );

  // Stable ref for handleChange — avoids stale closures in setTimeout callbacks
  const handleChangeRef = useRef(handleChange);
  handleChangeRef.current = handleChange;

  // Clean up timers on unmount
  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
  }, []);

  // When coming back online, retry any pending save
  useEffect(() => {
    const handleOnline = () => {
      if (lastCanvasRef.current && (saveStatus === "offline" || saveStatus === "error")) {
        retryCount.current = 0;
        handleChangeRef.current(lastCanvasRef.current.data);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [saveStatus]);

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

  // Create a specific preset floor (Basement/Main/Upper/Attic) on tap.
  // Unlike handleAddFloor's auto-increment, this uses a fixed floor_number so
  // preset slots always land on the same row in the selector.
  const handleCreatePresetFloor = useCallback((floorNumber: number, floorName: string) => {
    // Snapshot pin state BEFORE the create. Only when there's no active floor
    // (auto-Main / fresh property) is it correct to carry the canvas's live
    // state into the new floor. For "user clicked Base while editing Main",
    // canvas state belongs to the OLD floor — flush() already persisted it
    // there, and reading it again would leak it into the new floor's row.
    const wasUnpinned = activeFloorIdRef.current === null;
    canvasRef.current?.flush();
    createFloorPlan.mutate(
      { floor_number: floorNumber, floor_name: floorName },
      {
        onSuccess: (data) => {
          // Only inspect live canvas state in the auto-Main case; for
          // subsequent preset creates it would be content from another floor.
          const liveState = wasUnpinned ? canvasRef.current?.getCurrentState() : null;
          const hasUserDrawings = !!liveState && (
            liveState.rooms.length > 0 || liveState.walls.length > 0
          );
          if (hasUserDrawings || (lastCanvasRef.current && lastCanvasRef.current.floorId === null)) {
            const inFlightData = liveState ?? lastCanvasRef.current!.data;
            lastCanvasRef.current = { floorId: data.id, data: inFlightData };
            // Also persist the pre-floor drawings to the new floor's v1 so reload
            // doesn't lose them if the 2s autosave debounce hasn't fired yet.
            // Drive the visible save status too — the canvas remount on activeFloorId
            // change cancels the pending debounce timer, so without this the UI
            // would never flip to "Saving…" / "Saved ✓" despite the data being persisted.
            setSaveStatus("saving");
            apiPost(`/v1/floor-plans/${data.id}/versions`, {
              job_id: jobId,
              canvas_data: inFlightData,
            })
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ["floor-plan-history", data.id] });
                queryClient.invalidateQueries({ queryKey: ["jobs", jobId] });
                setSaveStatus("saved");
                if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
                saveStatusTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
              })
              .catch((err) => {
                console.warn("Failed to persist pre-floor drawings to new floor", err);
                setSaveStatus("error");
              });
          } else {
            lastCanvasRef.current = null;
          }
          queryClient.setQueryData<FloorPlan[]>(["floor-plans", jobId], (old) => {
            const next = [...(old ?? [])];
            if (!next.some((fp) => fp.id === data.id)) next.push(data);
            return next;
          });
          setActiveFloorId(data.id);
        },
      }
    );
  }, [createFloorPlan, queryClient, jobId]);

  // Auto-create Main Floor on first page load if the property has no floors yet.
  // Without this, a fresh job opens with 4 dashed pills and no active floor —
  // drawing a room before tapping a preset has nowhere to save and gets lost
  // on refresh. Main is the safe default (most buildings have a main floor);
  // the user can still tap Base/Upper/Attic to create/switch to those, and
  // can delete Main if they really don't need it.
  const mainAutoCreatedRef = useRef(false);
  useEffect(() => {
    if (mainAutoCreatedRef.current) return;
    if (!floorPlans) return;                // still loading
    if (floorPlans.length > 0) return;      // property already has at least one floor
    if (createFloorPlan.isPending) return;  // creation in flight
    if (!job) return;                        // wait for job data
    if (isJobArchived) return;               // archived jobs are read-only
    mainAutoCreatedRef.current = true;
    handleCreatePresetFloor(1, "Main Floor");
  }, [floorPlans, createFloorPlan.isPending, job, isJobArchived, handleCreatePresetFloor]);

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
          onClick={() => { canvasRef.current?.flush(); router.push(`/jobs/${jobId}`); }}
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
            // flush() already calls handleChange via onChangeRef — no need to call twice
            canvasRef.current?.flush();
          }}
          disabled={saveStatus === "saving"}
          className={`ml-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-opacity disabled:opacity-70 shrink-0 ${
            saveStatus === "offline" ? "bg-on-surface-variant/70 text-white" : "bg-brand-accent text-on-primary hover:opacity-90"
          }`}
        >
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved ✓" : saveStatus === "offline" ? "Offline" : saveStatus === "error" ? "Retry" : "Save"}
        </button>

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
            currentVersion={
              job?.floor_plan_id
                ? versions?.find((v) => v.id === job.floor_plan_id)?.version_number ?? null
                : null
            }
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
          key={activeFloor?.id ?? "new"}
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
            // eslint-disable-next-line no-console
            console.log("[autosave] canvas onChange fired in parent", { activeFloorId, rooms: data.rooms?.length, walls: data.walls?.length });
            lastCanvasRef.current = { floorId: activeFloorId, data };
            handleChange(data);
          }}
          readOnly={isJobArchived}
          rooms={jobRooms?.map((r) => ({ id: r.id, room_name: r.room_name, affected: r.affected }))}
          onCreateRoom={handleCreateRoom}
          jobId={jobId}
          onSelectionChange={handleSelectionChange}
          onEditRoom={handleDesktopEditRoom}
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
          isPolygon={mobileSelectedRoom.isPolygon}
          wallSf={jobRooms?.find(r => r.id === mobileSelectedRoom.propertyRoomId)?.wall_square_footage}
        />
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
    </div>
  );
}
