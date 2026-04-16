"use client";

import { use, useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  useFloorPlans,
  useCreateFloorPlan,
  useUpdateFloorPlan,
  useDeleteFloorPlan,
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
  wallSf,
}: {
  room: { id: string; name: string; widthFt: number; heightFt: number; propertyRoomId: string };
  jobId: string;
  photos: import("@/lib/types").Photo[];
  onClose: () => void;
  onEditRoom?: () => void;
  wallSf?: number | null;
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

  const { data: floorPlans, isLoading } = useFloorPlans(jobId);
  const createFloorPlan = useCreateFloorPlan(jobId);
  const updateFloorPlan = useUpdateFloorPlan(jobId);
  const deleteFloorPlan = useDeleteFloorPlan(jobId);
  const canvasRef = useRef<KonvaFloorPlanHandle>(null);
  const { data: jobRooms } = useRooms(jobId);
  const createRoom = useCreateRoom(jobId);
  const updateRoom = useUpdateRoom(jobId);
  const handleCreateRoom = useCallback((name: string, dimensions?: { width: number; height: number }) => {
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
    } as Record<string, unknown>);
  }, [jobRooms, createRoom, updateRoom]);

  const { data: allPhotos = [] } = usePhotos(jobId);
  const [mobileSelectedRoom, setMobileSelectedRoom] = useState<{ id: string; name: string; widthFt: number; heightFt: number; propertyRoomId: string } | null>(null);
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

  const handleSelectionChange = useCallback((info: { selectedId: string; type: "room"; name: string; widthFt: number; heightFt: number; propertyRoomId?: string } | null) => {
    if (!info) { setMobileSelectedRoom(null); selectedRoomRef.current = null; return; }
    const propertyRoom = info.propertyRoomId
      ? jobRooms?.find(r => r.id === info.propertyRoomId)
      : jobRooms?.find(r => r.room_name === info.name);
    if (!propertyRoom) { setMobileSelectedRoom(null); selectedRoomRef.current = null; return; }
    selectedRoomRef.current = { id: info.selectedId, name: info.name, propertyRoomId: propertyRoom.id };
    setMobileSelectedRoom({ id: info.selectedId, name: info.name, widthFt: info.widthFt, heightFt: info.heightFt, propertyRoomId: propertyRoom.id });
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

  // Keep refs so the save callback always uses the latest values
  const activeFloorRef = useRef(activeFloor);
  activeFloorRef.current = activeFloor;
  const activeFloorIdRef = useRef(activeFloorId);
  activeFloorIdRef.current = activeFloorId;

  const wasPendingRef = useRef(false);
  const retryCount = useRef(0);
  const MAX_RETRIES = 5;

  /* ---------------------------------------------------------------- */
  /*  Save — create or update                                          */
  /* ---------------------------------------------------------------- */

  const handleChange = useCallback(
    async (canvasData: FloorPlanData) => {
      // Always backup to localStorage (survives browser close) — even during pending create
      backupToLocal(canvasData, activeFloorIdRef.current);

      // Skip server save while a floor creation is in-flight to avoid duplicates
      if (createFloorPlan.isPending) {
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
      try {
        if (currentFloor) {
          await updateFloorPlan.mutateAsync({
            floorPlanId: currentFloor.id,
            canvas_data: canvasData as unknown as Record<string, unknown>,
          });
        } else {
          // No floor plan yet — create one
          const floorNum = (floorPlans?.length ?? 0) + 1;
          try {
            const created = await apiPost<FloorPlan>(`/v1/jobs/${jobId}/floor-plans`, {
              floor_number: floorNum,
              floor_name: `Floor ${floorNum}`,
              canvas_data: canvasData,
            });
            setActiveFloorId(created.id);
            queryClient.invalidateQueries({ queryKey: ["floor-plans", jobId] });
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
                await updateFloorPlan.mutateAsync({
                  floorPlanId: fp.id,
                  canvas_data: canvasData as unknown as Record<string, unknown>,
                });
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
    [floorPlans, jobId, queryClient, jobRooms, updateRoom, updateFloorPlan, createFloorPlan.isPending, backupToLocal, clearLocalBackup]
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

  const handleAddFloor = useCallback(() => {
    // Flush current floor's data — don't null lastCanvasRef yet (async save may still need it)
    canvasRef.current?.flush();

    const maxNum = floorPlans?.reduce((max, fp) => Math.max(max, fp.floor_number ?? 0), 0) ?? 0;
    const nextNumber = maxNum + 1;
    createFloorPlan.mutate(
      {
        floor_number: nextNumber,
        floor_name: `Floor ${nextNumber}`,
      },
      {
        onSuccess: (data) => {
          lastCanvasRef.current = null; // safe to clear now — previous floor's save resolved
          queryClient.setQueryData<FloorPlan[]>(["floor-plans", jobId], (old) => [
            ...(old ?? []),
            data,
          ]);
          setActiveFloorId(data.id);
          setActiveFloorIdx((floorPlans?.length ?? 0));
        },
      }
    );
  }, [floorPlans, createFloorPlan, queryClient, jobId]);

  // Floor rename state
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null);
  const [editingFloorName, setEditingFloorName] = useState("");
  const handleRenameFloor = useCallback((floorPlanId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) { setEditingFloorId(null); return; }
    updateFloorPlan.mutate({ floorPlanId, floor_name: trimmed } as { floorPlanId: string; floor_name: string });
    setEditingFloorId(null);
  }, [updateFloorPlan]);

  // Double-tap detection for mobile floor rename
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);

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
          className="flex items-center gap-1 text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer shrink-0"
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="hidden sm:inline">Back to Job</span>
          <span className="sm:hidden">Back</span>
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

        {/* Floor tabs — horizontally scrollable */}
        <div className="flex items-center gap-1.5 ml-auto overflow-x-auto scrollbar-hide min-w-0 pt-1">
          {floorPlans?.map((fp, idx) => {
            const isActive = fp.id === activeFloorId || (idx === activeFloorIdx && !activeFloorId);
            const roomCount = (fp.canvas_data as FloorPlanData | null)?.rooms?.length ?? 0;
            const canDelete = (floorPlans?.length ?? 0) > 1;
            return (
              <div key={fp.id} className="relative group shrink-0">
                {editingFloorId === fp.id ? (
                  <input
                    type="text"
                    value={editingFloorName}
                    onChange={(e) => setEditingFloorName(e.target.value)}
                    onBlur={() => handleRenameFloor(fp.id, editingFloorName)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameFloor(fp.id, editingFloorName);
                      if (e.key === "Escape") setEditingFloorId(null);
                    }}
                    autoFocus
                    className="px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[11px] sm:text-[13px] font-semibold font-[family-name:var(--font-geist-mono)] bg-white border-2 border-brand-accent text-[#1a1a1a] outline-none w-[80px] sm:w-[100px]"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      // Double-tap detection for mobile
                      const now = Date.now();
                      if (lastTapRef.current && lastTapRef.current.id === fp.id && now - lastTapRef.current.time < 400) {
                        setEditingFloorId(fp.id);
                        setEditingFloorName(fp.floor_name);
                        lastTapRef.current = null;
                        return;
                      }
                      lastTapRef.current = { id: fp.id, time: now };
                      canvasRef.current?.flush();
                      setActiveFloorIdx(idx);
                      setActiveFloorId(fp.id);
                    }}
                    onDoubleClick={() => {
                      setEditingFloorId(fp.id);
                      setEditingFloorName(fp.floor_name);
                    }}
                    className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-[12px] sm:text-[13px] font-semibold transition-all duration-150 cursor-pointer font-[family-name:var(--font-geist-mono)] whitespace-nowrap ${
                      isActive
                        ? "bg-[#1a1a1a] text-white shadow-sm"
                        : "bg-[#eae6e1] text-[#6b6560] hover:bg-[#ddd8d2]"
                    }`}
                  >
                    <span>{fp.floor_name}</span>
                    {roomCount > 0 && (
                    <span className={`ml-1.5 text-[10px] font-bold ${isActive ? "text-white/60" : "text-[#6b6560]/60"}`}>
                      {roomCount} {roomCount === 1 ? "rm" : "rms"}
                    </span>
                  )}
                  </button>
                )}
                {canDelete && isActive && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeleteFloorModalId(fp.id); }}
                    className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-red-500 text-white text-[8px] sm:text-[10px] font-bold flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-red-600 shadow-sm"
                    aria-label={`Delete ${fp.floor_name}`}
                  >
                    x
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={handleAddFloor}
            disabled={createFloorPlan.isPending}
            className="px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-[12px] sm:text-[13px] font-semibold text-brand-accent bg-brand-accent/8 hover:bg-brand-accent/15 transition-colors cursor-pointer font-[family-name:var(--font-geist-mono)] disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            + Floor
          </button>
        </div>
      </div>

      {/* Canvas — takes remaining viewport height minus header + footer */}
      <div className="flex-1 min-h-[400px]">
        <KonvaFloorPlan
          ref={canvasRef}
          key={`${activeFloor?.id ?? "new"}-${backupChecked ? "ready" : "wait"}`}
          initialData={pendingBackup ?? activeFloor?.canvas_data as FloorPlanData | null | undefined}
          onChange={(data: FloorPlanData) => { lastCanvasRef.current = { floorId: activeFloorId, data }; handleChange(data); }}
          rooms={jobRooms?.map((r) => ({ id: r.id, room_name: r.room_name }))}
          onCreateRoom={handleCreateRoom}
          jobId={jobId}
          onSelectionChange={handleSelectionChange}
          onEditRoom={handleDesktopEditRoom}
        />
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
