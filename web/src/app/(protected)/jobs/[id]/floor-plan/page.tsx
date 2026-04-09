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
} from "@/lib/hooks/use-jobs";
import { apiGet, apiPost } from "@/lib/api";
import type { FloorPlan } from "@/lib/types";
import type { FloorPlanData } from "@/components/sketch/floor-plan-tools";
import type { KonvaFloorPlanHandle } from "@/components/sketch/konva-floor-plan";

const KonvaFloorPlan = dynamic(() => import("@/components/sketch/konva-floor-plan"), { ssr: false });

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

  const [activeFloorIdx, setActiveFloorIdx] = useState(0);
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);
  const lastCanvasRef = useRef<FloorPlanData | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const manualSaveRef = useRef(false);
  const saveStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Try ref first, then fall back to looking up by ID in query cache
      const currentFloor = activeFloorRef.current
        ?? (activeFloorIdRef.current ? queryClient.getQueryData<FloorPlan[]>(["floor-plans", jobId])?.find((fp) => fp.id === activeFloorIdRef.current) : null);
      setSaveStatus("saving");
      try {
        if (currentFloor) {
          // Use mutation hook for consistent cache invalidation
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
              // Floor already exists (race condition) — refetch and update
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

        setSaveStatus("saved");
        if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
        saveStatusTimer.current = setTimeout(() => { setSaveStatus("idle"); manualSaveRef.current = false; }, 2000);
      } catch (err) {
        console.error("Failed to save floor plan:", err);
        setSaveStatus("error");
      }
    },
    [floorPlans, jobId, queryClient, jobRooms, updateRoom, updateFloorPlan, createFloorPlan.isPending]
  );

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
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-outline-variant/40 bg-surface-container-lowest">
        <button
          type="button"
          onClick={() => { canvasRef.current?.flush(); router.push(`/jobs/${jobId}`); }}
          className="flex items-center gap-1 text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Job
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
          className="ml-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer bg-brand-accent text-on-primary hover:opacity-90 transition-opacity disabled:opacity-70"
        >
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? (manualSaveRef.current ? "Saved" : "Auto-saved") : saveStatus === "error" ? "Retry Save" : "Save"}
        </button>

        {/* Floor tabs */}
        <div className="flex items-center gap-1.5 ml-auto">
          {floorPlans?.map((fp, idx) => {
            const isActive = fp.id === activeFloorId || (idx === activeFloorIdx && !activeFloorId);
            const roomCount = (fp.canvas_data as FloorPlanData | null)?.rooms?.length ?? 0;
            const canDelete = (floorPlans?.length ?? 0) > 1;
            return (
              <div key={fp.id} className="relative group">
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
                    className="px-3 py-1.5 rounded-lg text-[13px] font-semibold font-[family-name:var(--font-geist-mono)] bg-white border-2 border-brand-accent text-[#1a1a1a] outline-none w-[100px]"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      canvasRef.current?.flush();
                      setActiveFloorIdx(idx);
                      setActiveFloorId(fp.id);
                    }}
                    onDoubleClick={() => {
                      setEditingFloorId(fp.id);
                      setEditingFloorName(fp.floor_name);
                    }}
                    className={`px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-150 cursor-pointer font-[family-name:var(--font-geist-mono)] ${
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
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-red-600 shadow-sm"
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
            className="px-3.5 py-2 rounded-lg text-[13px] font-semibold text-brand-accent bg-brand-accent/8 hover:bg-brand-accent/15 transition-colors cursor-pointer font-[family-name:var(--font-geist-mono)] disabled:opacity-40"
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
          initialData={activeFloor?.canvas_data as FloorPlanData | null | undefined}
          onChange={(data: FloorPlanData) => { lastCanvasRef.current = data; handleChange(data); }}
          rooms={jobRooms?.map((r) => ({ id: r.id, room_name: r.room_name }))}
          onCreateRoom={handleCreateRoom}
        />
      </div>

      {/* Footer */}
      <div className="py-2 px-4 text-center shrink-0">
        <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.15em] text-on-surface-variant/50">
          Precision scoping powered by Crewmatic AI
        </p>
      </div>

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
