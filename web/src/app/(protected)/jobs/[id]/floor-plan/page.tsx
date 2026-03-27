"use client";

import { use, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import FloorPlanCanvas from "@/components/sketch/floor-plan-canvas";
import {
  useFloorPlans,
  useCreateFloorPlan,
  useUpdateFloorPlan,
  useCleanupSketch,
} from "@/lib/hooks/use-jobs";

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function FloorPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: jobId } = use(params);
  const router = useRouter();

  const { data: floorPlans, isLoading } = useFloorPlans(jobId);
  const createFloorPlan = useCreateFloorPlan(jobId);
  const updateFloorPlan = useUpdateFloorPlan(jobId);

  const [activeFloorIdx, setActiveFloorIdx] = useState(0);

  const activeFloor = floorPlans?.[activeFloorIdx] ?? null;
  const cleanupMutation = useCleanupSketch(
    jobId,
    activeFloor?.id ?? ""
  );

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */

  const handleSave = useCallback(
    async (canvasData: Record<string, unknown>) => {
      if (activeFloor) {
        updateFloorPlan.mutate({
          floorPlanId: activeFloor.id,
          canvas_data: canvasData,
        });
      } else {
        try {
          await createFloorPlan.mutateAsync({
            floor_number: (floorPlans?.length ?? 0) + 1,
            floor_name: `Floor ${(floorPlans?.length ?? 0) + 1}`,
            canvas_data: canvasData,
          });
          // After create, the query invalidation will refetch and set activeFloor
        } catch {
          // 409 = floor plan already exists, refetch and try update
          // The query invalidation from the hook will refresh floorPlans
        }
      }
    },
    [activeFloor, floorPlans, updateFloorPlan, createFloorPlan]
  );

  const handleCleanup = useCallback(
    async (canvasData: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!activeFloor) {
        // Save first, then cleanup
        return canvasData;
      }
      const result = await cleanupMutation.mutateAsync(canvasData);
      return result.canvas_data;
    },
    [activeFloor, cleanupMutation]
  );

  const handleAddFloor = useCallback(() => {
    const nextNumber = (floorPlans?.length ?? 0) + 1;
    createFloorPlan.mutate(
      {
        floor_number: nextNumber,
        floor_name: `Floor ${nextNumber}`,
      },
      {
        onSuccess: () => {
          setActiveFloorIdx(nextNumber - 1);
        },
      }
    );
  }, [floorPlans, createFloorPlan]);

  /* ---------------------------------------------------------------- */
  /*  Loading state                                                    */
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
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to Job
        </button>

        {/* Floor tabs */}
        <div className="flex items-center gap-1 ml-auto">
          {floorPlans?.map((fp, idx) => (
            <button
              key={fp.id}
              type="button"
              onClick={() => setActiveFloorIdx(idx)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 cursor-pointer font-[family-name:var(--font-geist-mono)] ${
                idx === activeFloorIdx
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
