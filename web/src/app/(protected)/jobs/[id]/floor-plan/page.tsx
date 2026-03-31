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
  const handleCreateRoom = useCallback((name: string, dimensions?: { width: number; height: number }) => {
    // Check if room already exists in Property Layout
    if (jobRooms?.some((r) => r.room_name === name)) return;
    createRoom.mutate({
      room_name: name,
      length_ft: dimensions?.height ?? null,
      width_ft: dimensions?.width ?? null,
    } as Record<string, unknown>);
  }, [jobRooms, createRoom]);

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

  /* ---------------------------------------------------------------- */
  /*  Save — create or update                                          */
  /* ---------------------------------------------------------------- */

  const handleChange = useCallback(
    async (canvasData: FloorPlanData) => {
      setSaveStatus("saving");
      try {
        if (activeFloor) {
          await apiPatch<FloorPlan>(`/v1/jobs/${jobId}/floor-plans/${activeFloor.id}`, {
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
        setSaveStatus("saved");
        if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
        saveStatusTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (err) {
        console.error("Failed to save floor plan:", err);
        setSaveStatus("error");
      }
    },
    [activeFloor, floorPlans, jobId, queryClient]
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
        <div className="flex items-center gap-1 ml-auto">
          {floorPlans?.map((fp, idx) => (
            <button
              key={fp.id}
              type="button"
              onClick={() => {
                setActiveFloorIdx(idx);
                setActiveFloorId(fp.id);
              }}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 cursor-pointer font-[family-name:var(--font-geist-mono)] ${
                fp.id === activeFloorId || (idx === activeFloorIdx && !activeFloorId)
                  ? "bg-on-surface text-surface"
                  : "text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              {fp.floor_name}
            </button>
          ))}
          <button
            type="button"
            onClick={handleAddFloor}
            disabled={createFloorPlan.isPending}
            className="px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-brand-accent hover:bg-brand-accent/8 transition-colors cursor-pointer font-[family-name:var(--font-geist-mono)] disabled:opacity-40"
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
