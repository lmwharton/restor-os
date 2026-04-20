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
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import type { FloorPlan, FloorLevel } from "@/lib/types";
import { FLOOR_LEVEL_TO_NUMBER, FLOOR_LEVEL_LABEL, floorNumberToLevel } from "@/lib/types";
import type { FloorPlanData, RoomData } from "@/components/sketch/floor-plan-tools";
import { wallsForRoom, detectSharedWalls, uid } from "@/components/sketch/floor-plan-tools";
import type { KonvaFloorPlanHandle } from "@/components/sketch/konva-floor-plan";
import { RoomConfirmationCard, type RoomConfirmationData } from "@/components/sketch/room-confirmation-card";
import { FloorSelector } from "@/components/sketch/floor-selector";
import { PickFloorModal } from "@/components/sketch/pick-floor-modal";
import type { WallSegment } from "@/lib/types";

const KonvaFloorPlan = dynamic(() => import("@/components/sketch/konva-floor-plan"), { ssr: false });

/* ------------------------------------------------------------------ */
/*  Wall sync: canvas walls → backend wall_segments                    */
/* ------------------------------------------------------------------ */

// Module-level mutex: prevents concurrent syncs from interleaving
// their delete-all + recreate cycles, which used to create duplicate
// wall rows in the backend. Only one wall-sync runs at a time;
// queued ones short-circuit and trust the in-flight one to converge.
let _wallSyncInFlight = false;

async function syncWallsToBackend(
  canvasData: FloorPlanData,
  jobRooms: Array<{ id: string; room_name: string }> | undefined,
) {
  if (!canvasData.walls || !jobRooms || jobRooms.length === 0) return;
  if (_wallSyncInFlight) return;
  _wallSyncInFlight = true;
  try {
    await _syncWallsToBackendImpl(canvasData, jobRooms);
  } finally {
    _wallSyncInFlight = false;
  }
}

async function _syncWallsToBackendImpl(
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

  // Commit current drafts if both are valid. Used by the debounce timer
  // (live auto-commit while typing) and by the blur/Enter handlers.
  const commit = (nextW: string, nextH: string) => {
    const w = parseFloat(nextW);
    const h = parseFloat(nextH);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    if (w < 1 || h < 1) return;
    if (w === widthFt && h === heightFt) return;
    onResize(w, h);
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

  // Cancel pending commit on unmount so we never fire into a stale ref.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const flushOnBlur = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    commit(wStr, hStr);
  };

  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1">Width (ft)</p>
        <input
          type="text"
          inputMode="decimal"
          value={wStr}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const next = e.target.value;
            setWStr(next);
            scheduleCommit(next, hStr);
          }}
          onBlur={flushOnBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-full h-9 px-3 rounded-lg border border-outline-variant text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] outline-none focus:border-brand-accent"
        />
      </div>
      <div className="flex-1">
        <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1">Length (ft)</p>
        <input
          type="text"
          inputMode="decimal"
          value={hStr}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const next = e.target.value;
            setHStr(next);
            scheduleCommit(wStr, next);
          }}
          onBlur={flushOnBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="w-full h-9 px-3 rounded-lg border border-outline-variant text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] outline-none focus:border-brand-accent"
        />
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
              key={`${room.id}-${room.widthFt}-${room.heightFt}`}
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
    // If the room already exists in Property Layout, skip create.
    // Dimension sync is handled by the canvas save loop (handleChange)
    // which runs on the same confirm tick — PATCHing here too used to
    // race with that loop and produce duplicate PATCHes for the same
    // room within ~1s.
    const existing = jobRooms?.find((r) => r.room_name === name);
    if (existing) return;
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
  // Signature of the most recently saved canvas geometry (rooms/walls/doors/
  // windows). Guards against save handler re-invocations with identical data
  // — a cache-invalidation cascade after save can feed the same payload back
  // in a second time and produce a redundant POST version + PATCH rooms +
  // wall-sync round. Compared only against structural geometry, not against
  // canvasMode/pins/etc., so non-geometry changes still fall through.
  const lastSavedSigRef = useRef<string | null>(null);
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

      // Try ref first, then fall back to looking up by ID in query cache
      const currentFloor = activeFloorRef.current
        ?? (activeFloorIdRef.current ? queryClient.getQueryData<FloorPlan[]>(["floor-plans", jobId])?.find((fp) => fp.id === activeFloorIdRef.current) : null);
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
          // Collect room PATCHes and fire them in parallel without each
          // invalidating the rooms query on its own. Drawing one room can
          // update several rooms' dimensions (shared walls) — routing them
          // through updateRoom.mutate() used to trigger one rooms-refetch
          // per PATCH, so a 4-room edit spammed 4+ duplicate GET /rooms.
          // Single rooms invalidation happens below after walls sync.
          const roomUpdates: Array<Promise<unknown>> = [];
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
                roomUpdates.push(
                  apiPatch(`/v1/jobs/${jobId}/rooms/${match.id}`, body).catch((err) => {
                    console.warn("Room patch failed", match.id, err);
                  }),
                );
              }
            }
          }
          await Promise.all(roomUpdates);
        }

        // Sync walls to backend (non-blocking — runs after save succeeds).
        // Single rooms invalidation covers the batched room PATCHes above
        // plus any wall changes, so the list re-fetches exactly once.
        syncWallsToBackend(canvasData, jobRooms)
          .then(() => queryClient.invalidateQueries({ queryKey: ["rooms", jobId] }))
          .catch(() => {});

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
    try {
      const targetFloor = await ensureFloor(targetLevel);

      const newRoom: RoomData = {
        id: uid("room"),
        x: pendingBounds.x,
        y: pendingBounds.y,
        width: pendingBounds.width,
        height: pendingBounds.height,
        points: pendingBounds.points,
        name: roomData.name,
        fill: roomData.affected ? "#fee2e2" : "#fff3ed",
        propertyRoomId: roomData.propertyRoomId,
      };
      const newRoomWalls = wallsForRoom(newRoom);

      const existingCanvas = (targetFloor.canvas_data as FloorPlanData | null) ?? {
        gridSize, rooms: [], walls: [], doors: [], windows: [],
      };
      const mergedCanvas: FloorPlanData = {
        ...existingCanvas,
        gridSize: existingCanvas.gridSize ?? gridSize,
        rooms: [...(existingCanvas.rooms ?? []), newRoom],
        walls: detectSharedWalls([...(existingCanvas.walls ?? []), ...newRoomWalls]),
      };

      setSaveStatus("saving");
      const savedVersion = await apiPost<FloorPlan>(`/v1/floor-plans/${targetFloor.id}/versions`, {
        job_id: jobId,
        canvas_data: mergedCanvas,
      });

      // Prime both caches synchronously BEFORE switching floors so the
      // canvas hydrates from the merged data on first mount (no empty-state
      // flash while the background refetch runs):
      //   1. floorPlans list → update the target row's canvas_data so
      //      activeFloor.canvas_data already has the new room.
      //   2. floor-plan-history → seed with the returned version so
      //      `versions.find(is_current)` returns it immediately.
      queryClient.setQueryData<FloorPlan[]>(["floor-plans", jobId], (old) => {
        if (!old) return old;
        return old.map((fp) =>
          fp.id === targetFloor.id
            ? { ...fp, canvas_data: mergedCanvas as unknown as Record<string, unknown> }
            : fp,
        );
      });
      queryClient.setQueryData<FloorPlan[]>(["floor-plan-history", targetFloor.id], (old) => {
        const next = (old ?? []).map((v) => v.id === savedVersion.id ? savedVersion : v);
        if (!next.some((v) => v.id === savedVersion.id)) next.unshift(savedVersion);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["floor-plan-history", targetFloor.id] });
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId] });
      setSaveStatus("saved");
      if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
      saveStatusTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);

      // Switch active canvas to the target floor so the user sees their room
      // land where they picked. Caches are primed above, so hydration shows
      // the merged canvas immediately with no empty-state flash.
      setActiveFloorId(targetFloor.id);

      // Create the job_rooms row with metadata (floor_level locked to target).
      const widthFt = Math.round((pendingBounds.width / gridSize) * 10) / 10;
      const heightFt = Math.round((pendingBounds.height / gridSize) * 10) / 10;
      handleCreateRoom(roomData.name, { width: widthFt, height: heightFt }, {
        roomType: roomData.roomType,
        ceilingHeight: roomData.ceilingHeight,
        ceilingType: roomData.ceilingType,
        floorLevel: targetLevel,
        materialFlags: roomData.materialFlags,
        affected: roomData.affected,
      });
    } catch (err) {
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
            lastCanvasRef.current = { floorId: activeFloorId, data };
            handleChange(data);
          }}
          readOnly={isJobArchived}
          rooms={jobRooms?.map((r) => ({ id: r.id, room_name: r.room_name, affected: r.affected }))}
          onCreateRoom={handleCreateRoom}
          activeFloorLevel={activeFloorLevel}
          onCreateRoomOnDifferentFloor={handleCreateRoomOnDifferentFloor}
          noActiveFloor={!activeFloor && !isJobArchived}
          onDrawAttemptWithoutFloor={() => setPickFloorOpen(true)}
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
          onResize={mobileSelectedRoom.isPolygon ? undefined : (w, h) => {
            canvasRef.current?.resizeRoomTo(mobileSelectedRoom.id, w, h);
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

      <PickFloorModal
        open={pickFloorOpen}
        floorPlans={floorPlans}
        onPick={handlePickFloorFromModal}
        onClose={() => setPickFloorOpen(false)}
      />
    </div>
  );
}
