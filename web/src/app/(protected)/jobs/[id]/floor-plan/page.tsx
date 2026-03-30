"use client";

import { use, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import FloorPlanCanvas from "@/components/sketch/floor-plan-canvas";
import {
  useFloorPlans,
  useCreateFloorPlan,
  useUpdateFloorPlan,
  useCleanupSketch,
} from "@/lib/hooks/use-jobs";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import type { FloorPlan } from "@/lib/types";

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

  const [activeFloorIdx, setActiveFloorIdx] = useState(0);
  // Track the active floor plan ID separately to survive refetches
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);

  // Sync activeFloorId when floor plans load
  useEffect(() => {
    if (floorPlans && floorPlans.length > 0 && !activeFloorId) {
      setActiveFloorId(floorPlans[0].id);
    }
  }, [floorPlans, activeFloorId]);

  const activeFloor = floorPlans?.find((fp) => fp.id === activeFloorId)
    ?? floorPlans?.[activeFloorIdx]
    ?? null;

  const cleanupMutation = useCleanupSketch(jobId, activeFloor?.id ?? "");

  /* ---------------------------------------------------------------- */
  /*  Save — create or update, handle 409 gracefully                   */
  /* ---------------------------------------------------------------- */

  const handleSave = useCallback(
    async (canvasData: Record<string, unknown>) => {
      try {
        if (activeFloor) {
          // Update existing floor plan
          await apiPatch<FloorPlan>(`/v1/jobs/${jobId}/floor-plans/${activeFloor.id}`, {
            canvas_data: canvasData,
          });
          queryClient.invalidateQueries({ queryKey: ["floor-plans", jobId] });
        } else {
          // Create new floor plan
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
            // 409 = floor plan already exists — refetch and update instead
            const apiErr = err as { status?: number };
            if (apiErr.status === 409) {
              // Fetch fresh list directly from API (bypass cache to avoid stale/undefined data)
              const refetched = await apiGet<FloorPlan[]>(`/v1/jobs/${jobId}/floor-plans`);
              const plans = Array.isArray(refetched) ? refetched : [];
              // Update the query cache with the fresh data
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
      } catch (err) {
        console.error("Failed to save floor plan:", err);
      }
    },
    [activeFloor, floorPlans, jobId, queryClient]
  );

  /* ---------------------------------------------------------------- */
  /*  Cleanup — send to Shapely backend                                */
  /* ---------------------------------------------------------------- */

  const handleCleanup = useCallback(
    async (canvasData: Record<string, unknown>): Promise<Record<string, unknown>> => {
      // If no floor plan saved yet, save first then cleanup
      if (!activeFloor) {
        await handleSave(canvasData);
        // After save, activeFloor should be set — but we need the ID
        // For now, return the data as-is and let user click cleanup again
        return canvasData;
      }
      try {
        const result = await cleanupMutation.mutateAsync(canvasData);
        return result.canvas_data;
      } catch (err) {
        console.error("Cleanup failed:", err);
        return canvasData;
      }
    },
    [activeFloor, cleanupMutation, handleSave]
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
    <div className="flex flex-col h-dvh bg-surface">
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

      {/* Canvas */}
      <div className="flex-1 min-h-0">
        <FloorPlanCanvas
          key={activeFloor?.id ?? "new"}
          canvasData={activeFloor?.canvas_data}
          onSave={handleSave}
          onCleanup={handleCleanup}
          floorName={activeFloor?.floor_name ?? "Floor 1"}
        />
      </div>
    </div>
  );
}
