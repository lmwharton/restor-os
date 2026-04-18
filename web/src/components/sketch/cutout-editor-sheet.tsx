"use client";

import { useRef, useState } from "react";
import type { FloorOpeningData } from "./floor-plan-tools";

/**
 * Bottom-sheet editor for a floor cutout (E7). Opens immediately after
 * placement AND on any subsequent tap of a cutout (Select tool). Matches
 * the RoomConfirmationCard visual language so the sheet feels consistent:
 * drag-handle on top, swipe-down to dismiss, sticky footer with Delete +
 * Done. Desktop renders as a centered card, mobile as bottom sheet.
 *
 * Why this exists: cutouts often need exact dimensions (the tech reads
 * "4 ft × 6 ft stairwell" off a tape measure) — dragging corners isn't
 * precise enough. Typed inputs let them nail the number.
 */

interface CutoutEditorSheetProps {
  open: boolean;
  cutout: FloorOpeningData | null;
  gridSize: number;
  /** Max available room bbox dims (ft) so we can show a clamp hint if the
   *  user types a value larger than the host room can fit. Optional. */
  maxWidthFt?: number;
  maxLengthFt?: number;
  onSave: (widthFt: number, lengthFt: number, name?: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function CutoutEditorSheet({
  open,
  cutout,
  gridSize,
  maxWidthFt,
  maxLengthFt,
  onSave,
  onDelete,
  onClose,
}: CutoutEditorSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDragging = useRef(false);

  // Local string state for inputs so users can type intermediate values
  // (empty, "4.", "4.5") without state rejecting them. Seeded from the
  // initial cutout on mount — parent passes `key={cutout.id}` so a fresh
  // cutout remounts the sheet with fresh inputs, avoiding setState-in-effect.
  const initialW = cutout ? Math.round((cutout.width / gridSize) * 10) / 10 : 0;
  const initialL = cutout ? Math.round((cutout.height / gridSize) * 10) / 10 : 0;
  const [widthStr, setWidthStr] = useState(String(initialW));
  const [lengthStr, setLengthStr] = useState(String(initialL));
  const [name, setName] = useState(cutout?.name ?? "");

  const handleTouchStart = (e: React.TouchEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.touches[0].clientY;
    // Only the top ~24px of the panel is a drag-to-dismiss handle
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
      panelRef.current.style.transition = "transform 150ms ease-out";
      panelRef.current.style.transform = "translateY(0)";
    }
  };

  if (!open || !cutout) return null;

  const wNum = Number(widthStr);
  const lNum = Number(lengthStr);
  const wValid = Number.isFinite(wNum) && wNum > 0;
  const lValid = Number.isFinite(lNum) && lNum > 0;
  const wOver = typeof maxWidthFt === "number" && wValid && wNum > maxWidthFt;
  const lOver = typeof maxLengthFt === "number" && lValid && lNum > maxLengthFt;
  const canSave = wValid && lValid && !wOver && !lOver;

  const handleSave = () => {
    if (!canSave) return;
    onSave(wNum, lNum, name.trim() || undefined);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div
        ref={panelRef}
        className="relative bg-surface-container-lowest rounded-t-2xl sm:rounded-xl shadow-[0_-4px_24px_rgba(31,27,23,0.1)] sm:shadow-[0_8px_24px_rgba(31,27,23,0.1)] w-full sm:w-[360px] max-h-[85dvh] sm:max-h-[80vh] overflow-hidden flex flex-col"
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
          <div className="mb-3 sm:mb-4">
            <h3 className="text-[15px] sm:text-[16px] font-semibold text-on-surface">Floor Cutout</h3>
            <p className="text-[12px] text-on-surface-variant mt-0.5 leading-relaxed">
              Size of the hole in the floor (stairwell, HVAC shaft, elevator).
            </p>
          </div>

          {/* Name — optional label for reports / selection panel. */}
          <div className="mb-3 sm:mb-4">
            <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1">Name <span className="opacity-60">(optional)</span></p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="e.g. Stairwell"
              maxLength={40}
              className="w-full h-10 px-3 rounded-lg border border-outline-variant text-[13px] text-on-surface outline-none focus:border-brand-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3 sm:mb-4">
            <div>
              <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1">Width</p>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  value={widthStr}
                  onChange={(e) => setWidthStr(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  min={0.5}
                  max={maxWidthFt ?? 60}
                  step={0.5}
                  className={`w-full h-10 px-3 pr-8 rounded-lg border text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] outline-none focus:border-brand-accent ${
                    wOver || (!wValid && widthStr !== "") ? "border-red-400" : "border-outline-variant"
                  }`}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">ft</span>
              </div>
              {wOver && (
                <p className="text-[10px] text-red-600 mt-1">Max {maxWidthFt} ft (fits in room)</p>
              )}
            </div>
            <div>
              <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1">Length</p>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  value={lengthStr}
                  onChange={(e) => setLengthStr(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  min={0.5}
                  max={maxLengthFt ?? 60}
                  step={0.5}
                  className={`w-full h-10 px-3 pr-8 rounded-lg border text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] outline-none focus:border-brand-accent ${
                    lOver || (!lValid && lengthStr !== "") ? "border-red-400" : "border-outline-variant"
                  }`}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">ft</span>
              </div>
              {lOver && (
                <p className="text-[10px] text-red-600 mt-1">Max {maxLengthFt} ft (fits in room)</p>
              )}
            </div>
          </div>

          {wValid && lValid && !wOver && !lOver && (
            <p className="text-[11px] text-on-surface-variant mb-1 font-[family-name:var(--font-geist-mono)]">
              {Math.round(wNum * lNum * 10) / 10} sq ft will be subtracted from the room&apos;s floor area.
            </p>
          )}
        </div>

        {/* Sticky action footer — matches RoomConfirmationCard style */}
        <div className="shrink-0 px-4 pt-3 pb-4 sm:px-5 sm:pt-3 sm:pb-4 border-t border-outline-variant/30 bg-surface-container-lowest">
          <div className="flex gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={onDelete}
              className="flex-1 h-10 rounded-lg border border-red-200 text-[12px] font-medium text-red-600 hover:bg-red-50 cursor-pointer transition-colors sm:h-10 sm:text-[13px]"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 h-10 rounded-lg bg-brand-accent text-on-primary text-[12px] font-semibold cursor-pointer disabled:opacity-40 active:scale-[0.98] transition-all sm:h-10 sm:text-[13px]"
            >
              Done
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
