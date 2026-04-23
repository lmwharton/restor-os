"use client";

import type { FloorPlan } from "@/lib/types";

/**
 * Four preset floors per Spec 01H. floor_number is the integer column on
 * floor_plans; `short` is what shows on the pill (kept tight to fit on mobile),
 * `full` is for longer contexts / a11y labels.
 */
const FLOOR_PRESETS = [
  { number: 0, short: "Base", full: "Basement" },
  { number: 1, short: "Main", full: "Main Floor" },
  { number: 2, short: "Upper", full: "Upper Floor" },
  { number: 3, short: "Attic", full: "Attic" },
] as const;

interface FloorSelectorProps {
  floorPlans: FloorPlan[] | undefined;
  activeFloorId: string | null;
  onSelectFloor: (floorPlanId: string) => void;
  onCreateFloor: (floorNumber: number, floorName: string) => void;
  /** Archived jobs: tapping an empty preset won't create a floor. */
  disabled?: boolean;
  /** Blocked while a create is in flight — all empty slots disable briefly. */
  busy?: boolean;
}

/**
 * Elevation strip: four preset floor slots (Basement → Attic). Each cell shows
 * its preset name, room count (once drawn), and a "v{N}" chip for the active
 * pin. Empty slots render as dashed-outlined affordances — tap to create that
 * floor's plan in one step. Mobile-first, horizontally scrollable on narrow
 * viewports; on desktop the row fits without overflow.
 */
export function FloorSelector({
  floorPlans,
  activeFloorId,
  onSelectFloor,
  onCreateFloor,
  disabled = false,
  busy = false,
}: FloorSelectorProps) {
  const byNumber = new Map<number, FloorPlan>();
  floorPlans?.forEach((fp) => {
    if (typeof fp.floor_number === "number") byNumber.set(fp.floor_number, fp);
  });

  return (
    <div
      className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto scrollbar-hide min-w-0 py-0.5"
      role="tablist"
      aria-label="Floor selector"
    >
      {FLOOR_PRESETS.map((preset) => {
        const existing = byNumber.get(preset.number);

        if (!existing) {
          // Empty preset — dashed outline affordance; tap creates the floor.
          return (
            <button
              key={preset.number}
              type="button"
              role="tab"
              aria-selected="false"
              aria-label={`Create ${preset.full}`}
              onClick={() => {
                if (disabled || busy) return;
                onCreateFloor(preset.number, preset.full);
              }}
              disabled={disabled || busy}
              className="group h-9 sm:h-10 px-2 sm:px-3.5 rounded-lg text-[11px] sm:text-[13px] font-medium font-[family-name:var(--font-geist-mono)] border border-dashed border-outline-variant/60 text-on-surface-variant/60 hover:bg-surface-container-low hover:text-on-surface-variant hover:border-outline-variant transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 flex items-center gap-1"
            >
              {/* "+" glyph hidden on narrow screens — the dashed border itself signals "tap to create". */}
              <span className="hidden sm:inline text-[13px] leading-none opacity-70 group-hover:opacity-100 transition-opacity">+</span>
              <span>{preset.short}</span>
            </button>
          );
        }

        const isActive = existing.id === activeFloorId;
        const roomCount = ((existing.canvas_data as { rooms?: unknown[] } | null)?.rooms ?? []).length;

        return (
          <button
            key={preset.number}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={preset.full}
            onClick={() => onSelectFloor(existing.id)}
            className={`h-9 sm:h-10 px-3 sm:px-4 rounded-lg text-[12px] sm:text-[13px] font-semibold font-[family-name:var(--font-geist-mono)] transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-2 ${
              isActive
                ? "bg-[#1a1a1a] text-white shadow-sm"
                : "bg-[#eae6e1] text-[#6b6560] hover:bg-[#ddd8d2]"
            }`}
          >
            <span>{preset.short}</span>
            {roomCount > 0 && (
              <span
                aria-label={`${roomCount} ${roomCount === 1 ? "room" : "rooms"}`}
                className={`min-w-[16px] h-[16px] sm:min-w-[18px] sm:h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[9px] sm:text-[10px] font-bold tabular-nums leading-none ${
                  isActive ? "bg-white/20 text-white" : "bg-[#1a1a1a]/10 text-[#6b6560]"
                }`}
              >
                {roomCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
