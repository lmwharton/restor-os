"use client";

// Edit sheet for an existing moisture pin. Opens from the moisture
// reading sheet via the "Edit pin" action. Lets the tech correct
// material + dry_standard after placement — e.g., "I picked drywall but
// it's actually carpet pad" — without deleting the pin (which would
// lose the reading history).
//
// Only material + dry_standard are editable here. Surface/position and
// the original reading aren't editable: position is implied by the
// pin's canvas location (draggable separately) and readings live in
// the reading sheet's log flow. Keeps the edit UI small and focused.
//
// Mobile: bottom sheet (drag-to-dismiss handle on top).
// Desktop: centered modal. Same contents either way.

import { useMemo, useRef, useState } from "react";
import type { MoistureMaterial, MoisturePin } from "@/lib/types";
import { DRY_STANDARDS } from "@/lib/hooks/use-moisture-pins";

export interface EditSheetData {
  material: MoistureMaterial;
  dry_standard: number;
}

interface MoistureEditSheetProps {
  open: boolean;
  pin: MoisturePin;
  onSave: (data: EditSheetData) => void;
  onClose: () => void;
  /** True while the parent's update-pin mutation is in flight. Drives
   *  the Update button's disabled + "Updating…" label. */
  isSaving?: boolean;
}

// Same material catalog as the placement sheet — kept local so the
// edit path stays self-contained and doesn't couple to placement-sheet
// internals.
const MATERIAL_OPTIONS: Array<{ value: MoistureMaterial; label: string }> = [
  { value: "drywall", label: "Drywall" },
  { value: "wood_subfloor", label: "Wood subfloor" },
  { value: "carpet_pad", label: "Carpet pad" },
  { value: "concrete", label: "Concrete" },
  { value: "hardwood", label: "Hardwood" },
  { value: "osb_plywood", label: "OSB / plywood" },
  { value: "block_wall", label: "Block wall" },
];

export function MoistureEditSheet({
  open,
  pin,
  onSave,
  onClose,
  isSaving = false,
}: MoistureEditSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDragging = useRef(false);

  const [material, setMaterial] = useState<MoistureMaterial>(pin.material);
  // String-state for numeric input so the user can type intermediate
  // values ("4.", empty) without state rejecting them.
  const [dryStandardStr, setDryStandardStr] = useState(String(pin.dry_standard));

  // Detect whether the current dry_standard matches the material's
  // default. If not, the tech has a per-pin override — surface a small
  // "reset to default" affordance so they can revert cleanly.
  const materialDefault = DRY_STANDARDS[material];
  const isOverride = useMemo(() => {
    const n = Number(dryStandardStr);
    return Number.isFinite(n) && Math.abs(n - materialDefault) > 0.01;
  }, [dryStandardStr, materialDefault]);

  // When the user picks a different material, auto-fill the dry
  // standard with its default (can still override after).
  const handleMaterialChange = (m: MoistureMaterial) => {
    setMaterial(m);
    setDryStandardStr(String(DRY_STANDARDS[m]));
  };

  const dryNum = Number(dryStandardStr);
  const dryValid = Number.isFinite(dryNum) && dryNum >= 0 && dryNum <= 100;
  const hasChange =
    material !== pin.material
    || Math.abs(dryNum - Number(pin.dry_standard)) > 0.01;
  const canSave = dryValid && hasChange;

  // Drag-to-dismiss — mirrors placement-sheet + cutout-editor patterns.
  const handleTouchStart = (e: React.TouchEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.touches[0].clientY;
    if (y > rect.top + 24) return;
    startYRef.current = y;
    currentYRef.current = y;
    isDragging.current = true;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current || !panelRef.current) return;
    currentYRef.current = e.touches[0].clientY;
    const delta = Math.max(0, currentYRef.current - startYRef.current);
    panelRef.current.style.transform = `translateY(${delta}px)`;
    panelRef.current.style.transition = "none";
  };
  const handleTouchEnd = () => {
    if (!isDragging.current || !panelRef.current) return;
    isDragging.current = false;
    const delta = currentYRef.current - startYRef.current;
    if (delta > 60) {
      panelRef.current.style.transition = "transform 200ms ease-out";
      panelRef.current.style.transform = "translateY(100%)";
      setTimeout(onClose, 200);
    } else {
      panelRef.current.style.transition = "transform 200ms ease-out";
      panelRef.current.style.transform = "translateY(0)";
    }
  };

  if (!open) return null;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ material, dry_standard: dryNum });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div
        ref={panelRef}
        // Taller than the placement sheet on purpose — edit has fewer
        // fields so a short sheet felt empty/pop-up-like. min-h keeps a
        // substantial presence on mobile; max-h still caps it against
        // the keyboard + safe areas so the footer never gets clipped.
        className="relative bg-surface-container-lowest rounded-t-2xl sm:rounded-xl shadow-[0_-4px_24px_rgba(31,27,23,0.1)] sm:shadow-[0_8px_24px_rgba(31,27,23,0.1)] w-full sm:w-[400px] min-h-[48dvh] sm:min-h-[380px] max-h-[85dvh] sm:max-h-[80vh] overflow-hidden flex flex-col"
        style={{ animation: "slideUp 0.15s ease-out" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-1.5 sm:hidden shrink-0">
          <div className="w-8 h-0.5 rounded-full bg-outline-variant/40" />
        </div>

        <div className="px-4 pt-3 pb-2 sm:px-5 sm:pt-5 sm:pb-3 flex-1 min-h-0 overflow-y-auto">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between">
            <div className="min-w-0">
              <h3 className="text-[15px] sm:text-[16px] font-semibold text-on-surface">
                Edit pin
              </h3>
              <p className="mt-1 text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant truncate">
                {pin.location_name}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 -mr-1 -mt-1 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low cursor-pointer shrink-0"
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Material — native select. Default to listing every material
              (no "suggested" grouping here — the tech is correcting a
              known wrong pick, so all options should be equally findable). */}
          <div className="mb-4">
            <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1.5">
              Material
            </p>
            <div className="relative">
              <select
                value={material}
                onChange={(e) => handleMaterialChange(e.target.value as MoistureMaterial)}
                className="appearance-none w-full h-10 pl-3 pr-8 rounded-lg bg-surface-container-low text-[13px] text-on-surface outline-none focus:ring-2 focus:ring-brand-accent cursor-pointer"
              >
                {MATERIAL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}  ·  {DRY_STANDARDS[m.value]}% std
                  </option>
                ))}
              </select>
              <svg
                aria-hidden
                width={14} height={14} viewBox="0 0 24 24" fill="none"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
              >
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>

          {/* Dry standard — full width on edit (no sibling field). */}
          <div className="mb-2">
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant">
                Dry standard
              </p>
              {isOverride && (
                <button
                  type="button"
                  onClick={() => setDryStandardStr(String(materialDefault))}
                  className="text-[11px] font-medium text-brand-accent hover:underline cursor-pointer"
                >
                  Reset to default ({materialDefault}%)
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type="number"
                inputMode="decimal"
                value={dryStandardStr}
                onChange={(e) => setDryStandardStr(e.target.value)}
                onFocus={(e) => e.target.select()}
                min={0}
                max={100}
                step={0.5}
                className={`w-full h-10 px-3 pr-8 rounded-lg border text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] font-semibold outline-none focus:border-brand-accent ${
                  !dryValid && dryStandardStr !== "" ? "border-red-400" : "border-outline-variant"
                }`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">%</span>
            </div>
            <p className="mt-1.5 text-[11px] text-on-surface-variant">
              Pin color re-derives from the latest reading against this standard.
            </p>
          </div>
        </div>

        {/* Sticky footer — Cancel + Update */}
        <div className="shrink-0 px-4 pt-3 pb-4 sm:px-5 sm:pt-3 sm:pb-4 border-t border-outline-variant/30 bg-surface-container-lowest">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 rounded-lg bg-surface-container-low text-[13px] font-medium text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || isSaving}
              className="flex-1 h-10 rounded-lg bg-brand-accent text-on-primary text-[13px] font-semibold cursor-pointer disabled:opacity-40 active:scale-[0.98] transition-all"
            >
              {isSaving ? "Updating…" : "Update"}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from { transform: translateY(16px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
