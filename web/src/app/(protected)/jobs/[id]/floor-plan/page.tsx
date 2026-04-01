"use client";

import { use, useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  useFloorPlans,
  useCreateFloorPlan,
  useRooms,
  useCreateRoom,
  useUpdateRoom,
} from "@/lib/hooks/use-jobs";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import type { FloorPlan } from "@/lib/types";
import type { FloorPlanData } from "@/components/sketch/floor-plan-tools";

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
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
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

  // Keep a ref to activeFloor so the save callback always uses the latest
  const activeFloorRef = useRef(activeFloor);
  activeFloorRef.current = activeFloor;

  /* ---------------------------------------------------------------- */
  /*  Save — create or update                                          */
  /* ---------------------------------------------------------------- */

  const handleChange = useCallback(
    async (canvasData: FloorPlanData) => {
      const currentFloor = activeFloorRef.current;
      setSaveStatus("saving");
      try {
        if (currentFloor) {
          await apiPatch<FloorPlan>(`/v1/jobs/${jobId}/floor-plans/${currentFloor.id}`, {
            canvas_data: canvasData,
          });
          queryClient.invalidateQueries({ queryKey: ["floor-plans", jobId] });
        } else {
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
              const refetched = await apiGet<FloorPlan[]>(`/v1/jobs/${jobId}/floor-plans`);
              const plans = Array.isArray(refetched) ? refetched : [];
              queryClient.setQueryData<FloorPlan[]>(["floor-plans", jobId], plans);
              if (plans.length > 0) {
                const fp = plans[0];
                setActiveFloorId(fp.id);
                await apiPatch<FloorPlan>(`/v1/jobs/${jobId}/floor-plans/${fp.id}`, {
                  canvas_data: canvasData,
                });
                queryClient.invalidateQueries({ queryKey: ["floor-plans", jobId] });
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
        saveStatusTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (err) {
        console.error("Failed to save floor plan:", err);
        setSaveStatus("error");
      }
    },
    [floorPlans, jobId, queryClient, jobRooms, updateRoom]
  );

  /* ---------------------------------------------------------------- */
  /*  Add Floor                                                        */
  /* ---------------------------------------------------------------- */

  const handleAddFloor = useCallback(() => {
    const nextNumber = (floorPlans?.length ?? 0) + 1;
    createFloorPlan.mutate(
      {
        floor_number: nextNumber,
        floor_name: `Floor ${nextNumber}`,
      },
      {
        onSuccess: (data) => {
          setActiveFloorId(data.id);
          setActiveFloorIdx(nextNumber - 1);
        },
      }
    );
  }, [floorPlans, createFloorPlan]);

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
          onClick={() => router.push(`/jobs/${jobId}`)}
          className="flex items-center gap-1 text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Job
        </button>

        {/* Save status */}
        <div className="ml-2 text-[11px] font-[family-name:var(--font-geist-mono)]">
          {saveStatus === "saving" && <span className="text-on-surface-variant">Saving...</span>}
          {saveStatus === "saved" && <span className="text-green-600">Saved</span>}
          {saveStatus === "error" && <span className="text-red-600">Save failed</span>}
        </div>

        {/* Floor tabs */}
        <div className="flex items-center gap-1.5 ml-auto">
          {floorPlans?.map((fp, idx) => {
            const isActive = fp.id === activeFloorId || (idx === activeFloorIdx && !activeFloorId);
            const roomCount = (fp.canvas_data as FloorPlanData | null)?.rooms?.length ?? 0;
            return (
              <button
                key={fp.id}
                type="button"
                onClick={() => {
                  setActiveFloorIdx(idx);
                  setActiveFloorId(fp.id);
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
          key={activeFloor?.id ?? "new"}
          initialData={activeFloor?.canvas_data as FloorPlanData | null | undefined}
          onChange={handleChange}
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
    </div>
  );
}
