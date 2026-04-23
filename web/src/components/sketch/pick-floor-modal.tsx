"use client";

import { useEffect, useRef, useCallback } from "react";
import type { FloorPlan, FloorLevel } from "@/lib/types";
import { FLOOR_LEVEL_TO_NUMBER } from "@/lib/types";

/**
 * Intercept modal that appears when the user tries to draw a wall / door /
 * window / trace on the canvas without an active floor. Room tool is
 * handled separately — it has its own confirmation card with a Floor field.
 * Styling mirrors ConfirmModal for a consistent feel across the app.
 */

interface PickFloorModalProps {
  open: boolean;
  floorPlans: FloorPlan[] | undefined;
  onPick: (level: FloorLevel) => void;
  onClose: () => void;
}

const OPTIONS: { level: FloorLevel; label: string }[] = [
  { level: "basement", label: "Basement" },
  { level: "main", label: "Main" },
  { level: "upper", label: "Upper" },
  { level: "attic", label: "Attic" },
];

export function PickFloorModal({ open, floorPlans, onPick, onClose }: PickFloorModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  // Existing floors show a checkmark — picking switches instead of creates.
  const existingNumbers = new Set(
    (floorPlans ?? [])
      .map((fp) => fp.floor_number)
      .filter((n): n is number => typeof n === "number"),
  );

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pick-floor-title"
    >
      <div className="w-full max-w-sm mx-4 bg-surface-container-lowest rounded-2xl shadow-[0_8px_30px_rgba(31,27,23,0.12),0_2px_8px_rgba(31,27,23,0.06)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 pt-6 pb-4">
          <h2 id="pick-floor-title" className="text-[16px] font-semibold text-on-surface">
            Pick a floor first
          </h2>
          <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
            Choose which floor this drawing belongs to.
          </p>
        </div>
        <div className="px-6 pb-5">
          <div className="grid grid-cols-2 gap-2">
            {OPTIONS.map(({ level, label }) => {
              const exists = existingNumbers.has(FLOOR_LEVEL_TO_NUMBER[level]);
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onPick(level)}
                  className="h-10 px-3 rounded-lg border border-outline-variant text-[13px] font-medium text-on-surface-variant hover:bg-surface-container-high active:scale-[0.98] cursor-pointer transition-all inline-flex items-center justify-center gap-1.5"
                >
                  <span>{label}</span>
                  {exists && (
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" className="text-brand-accent shrink-0">
                      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full h-10 rounded-lg border border-red-200 text-[13px] font-medium text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
