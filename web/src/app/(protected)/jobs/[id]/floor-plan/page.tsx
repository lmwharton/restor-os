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
import { apiGet, apiPost } from "@/lib/api";
import type { FloorPlan } from "@/lib/types";
import type { FloorPlanData } from "@/components/sketch/floor-plan-tools";
import type { KonvaFloorPlanHandle } from "@/components/sketch/konva-floor-plan";

const KonvaFloorPlan = dynamic(() => import("@/components/sketch/konva-floor-plan"), { ssr: false });

/* ------------------------------------------------------------------ */
/*  Mobile bottom panel with swipe-to-close                            */
/* ------------------------------------------------------------------ */

function MobileRoomPanel({
  room,
  jobId,
  photos,
  onClose,
}: {
  room: { id: string; name: string; widthFt: number; heightFt: number; propertyRoomId: string };
  jobId: string;
  photos: import("@/lib/types").Photo[];
  onClose: () => void;
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
    <div className="md:hidden fixed inset-0 z-[45]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/10" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="absolute left-0 right-0 bottom-16 bg-surface-container-lowest rounded-t-2xl shadow-[0_-4px_20px_rgba(31,27,23,0.12)] max-h-[45vh] flex flex-col pb-[env(safe-area-inset-bottom)]"
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
        <div className="overflow-y-auto px-4 pb-4 space-y-3">
          {/* Room header */}
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold text-on-surface">{room.name}</h3>
            <span className="text-[12px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
              {room.widthFt} &times; {room.heightFt} ft &middot; {Math.round(room.widthFt * room.heightFt)} SF
            </span>
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

  const handleSelectionChange = useCallback((info: { selectedId: string; type: "room"; name: string; widthFt: number; heightFt: number } | null) => {
    if (!info) { setMobileSelectedRoom(null); return; }
    const propertyRoom = jobRooms?.find(r => r.room_name === info.name);
    if (!propertyRoom) { setMobileSelectedRoom(null); return; }
    setMobileSelectedRoom({ id: info.selectedId, name: info.name, widthFt: info.widthFt, heightFt: info.heightFt, propertyRoomId: propertyRoom.id });
  }, [jobRooms]);

  const [activeFloorIdx, setActiveFloorIdx] = useState(0);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const lastCanvasRef = useRef<FloorPlanData | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error" | "offline">("idle");
  const manualSaveRef = useRef(false);
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // localStorage key for offline backup
  const lsKey = `fp-backup-${jobId}`;

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

  // On mount, check for unsaved local backup
  const [pendingBackup, setPendingBackup] = useState<FloorPlanData | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Validate shape before trusting localStorage content
      if (!parsed || typeof parsed !== "object" || !parsed.canvasData || typeof parsed.ts !== "number") {
        localStorage.removeItem(lsKey);
        return;
      }
      if (Date.now() - parsed.ts > 86_400_000) { localStorage.removeItem(lsKey); return; }
      setPendingBackup(parsed.canvasData as FloorPlanData);
      lastCanvasRef.current = parsed.canvasData as FloorPlanData;
    } catch { localStorage.removeItem(lsKey); }
  }, [lsKey]);

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

  /* ---------------------------------------------------------------- */
  /*  Save — create or update                                          */
  /* ---------------------------------------------------------------- */

  const handleChange = useCallback(
    async (canvasData: FloorPlanData) => {
      // Skip auto-save while a floor creation is in-flight to avoid duplicates
      if (createFloorPlan.isPending) {
        lastCanvasRef.current = canvasData;
        return;
      }

      // Backup to localStorage immediately (survives browser close)
      backupToLocal(canvasData, activeFloorIdRef.current);

      // If browser reports offline, skip the API call entirely — just queue for retry
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setSaveStatus("offline");
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => {
          const pending = lastCanvasRef.current;
          if (pending) handleChange(pending);
        }, 5000);
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
            const match = jobRooms.find((r) => r.room_name === drawnRoom.name);
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

        // Success — clear local backup, show saved
        clearLocalBackup();
        if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
        setSaveStatus("saved");
        if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
        saveStatusTimer.current = setTimeout(() => { setSaveStatus("idle"); manualSaveRef.current = false; }, 2000);
      } catch (err) {
        console.error("Failed to save floor plan:", err);
        // Show offline status and schedule auto-retry in 5 seconds
        setSaveStatus("offline");
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => {
          const pending = lastCanvasRef.current;
          if (pending) handleChange(pending);
        }, 5000);
      }
    },
    [floorPlans, jobId, queryClient, jobRooms, updateRoom, updateFloorPlan, createFloorPlan.isPending, backupToLocal, clearLocalBackup]
  );

  // When coming back online, retry any pending save
  useEffect(() => {
    const handleOnline = () => {
      if (lastCanvasRef.current && (saveStatus === "offline" || saveStatus === "error")) {
        handleChange(lastCanvasRef.current);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [saveStatus, handleChange]);

  // Restore pending backup after handleChange is available
  useEffect(() => {
    if (!pendingBackup || !floorPlans || floorPlans.length === 0) return;
    handleChange(pendingBackup);
    setPendingBackup(null);
  }, [pendingBackup, floorPlans, handleChange]);

  // Flush deferred save when floor creation finishes
  useEffect(() => {
    if (wasPendingRef.current && !createFloorPlan.isPending && lastCanvasRef.current) {
      handleChange(lastCanvasRef.current);
    }
    wasPendingRef.current = createFloorPlan.isPending;
  }, [createFloorPlan.isPending, handleChange]);

  /* ---------------------------------------------------------------- */
  /*  Add Floor                                                        */
  /* ---------------------------------------------------------------- */

  const handleAddFloor = useCallback(() => {
    // Flush current floor's data first, then clear so it doesn't leak to the new floor
    canvasRef.current?.flush();
    lastCanvasRef.current = null;

    const maxNum = floorPlans?.reduce((max, fp) => Math.max(max, fp.floor_number ?? 0), 0) ?? 0;
    const nextNumber = maxNum + 1;
    createFloorPlan.mutate(
      {
        floor_number: nextNumber,
        floor_name: `Floor ${nextNumber}`,
      },
      {
        onSuccess: (data) => {
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
    <div className="flex flex-col h-[calc(100dvh-48px)] bg-surface overflow-hidden">
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
          key={activeFloor?.id ?? "new"}
          initialData={pendingBackup ?? activeFloor?.canvas_data as FloorPlanData | null | undefined}
          onChange={(data: FloorPlanData) => { lastCanvasRef.current = data; handleChange(data); }}
          rooms={jobRooms?.map((r) => ({ id: r.id, room_name: r.room_name }))}
          onCreateRoom={handleCreateRoom}
          jobId={jobId}
          onSelectionChange={handleSelectionChange}
        />
      </div>

      {/* Footer — hidden on mobile when room panel is open */}
      <div className={`py-2 px-4 text-center shrink-0 ${mobileSelectedRoom ? "hidden md:block" : ""}`}>
        <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.15em] text-on-surface-variant/50">
          Precision scoping powered by Crewmatic AI
        </p>
      </div>

      {/* Mobile bottom panel — room photos (md:hidden), positioned above bottom nav */}
      {mobileSelectedRoom && (
        <MobileRoomPanel
          room={mobileSelectedRoom}
          jobId={jobId}
          photos={allPhotos.filter(p => p.room_id === mobileSelectedRoom.propertyRoomId)}
          onClose={() => setMobileSelectedRoom(null)}
        />
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
