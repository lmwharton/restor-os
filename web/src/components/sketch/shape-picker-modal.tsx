"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * First-step picker when the user activates the Room tool. Client-requested
 * Google-Sheets-style flow: tap a shape → it drops at default dimensions →
 * existing confirmation card opens. Tap Cancel to fall back to the classic
 * click-and-drag rectangle drawing.
 *
 * Mobile-first: bottom sheet on phones (matches RoomConfirmationCard with
 * swipe-to-close from the drag handle), centered dialog on desktop. Shape
 * geometry is defined in feet; the caller converts to pixels via the canvas's
 * gridSize (px per ft) and centers the polygon on the viewport.
 */

export type ShapeId = "rect" | "l" | "t" | "u" | "notch";

export interface ShapeTemplate {
  id: ShapeId;
  label: string;
  /** Axis-aligned bounding box in feet — used to size the default placement. */
  widthFt: number;
  heightFt: number;
  /** Polygon vertices in feet, relative to the bounding box top-left (0,0).
   *  Undefined for the plain rectangle — it uses the bbox directly. */
  pointsFt?: Array<{ x: number; y: number }>;
}

export const SHAPE_TEMPLATES: ShapeTemplate[] = [
  { id: "rect", label: "Rectangle", widthFt: 12, heightFt: 10 },
  {
    id: "l",
    label: "L-Shape",
    widthFt: 14,
    heightFt: 12,
    pointsFt: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 5 },
      { x: 14, y: 5 },
      { x: 14, y: 12 },
      { x: 0, y: 12 },
    ],
  },
  {
    id: "t",
    label: "T-Shape",
    widthFt: 14,
    heightFt: 12,
    pointsFt: [
      { x: 0, y: 0 },
      { x: 14, y: 0 },
      { x: 14, y: 4 },
      { x: 10, y: 4 },
      { x: 10, y: 12 },
      { x: 4, y: 12 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ],
  },
  {
    id: "u",
    label: "U-Shape",
    widthFt: 14,
    heightFt: 12,
    pointsFt: [
      { x: 0, y: 0 },
      { x: 14, y: 0 },
      { x: 14, y: 12 },
      { x: 9, y: 12 },
      { x: 9, y: 4 },
      { x: 5, y: 4 },
      { x: 5, y: 12 },
      { x: 0, y: 12 },
    ],
  },
  {
    id: "notch",
    label: "Rect + Notch",
    widthFt: 12,
    heightFt: 10,
    pointsFt: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 12, y: 3 },
      { x: 12, y: 10 },
      { x: 0, y: 10 },
    ],
  },
];

/** Render the shape as an SVG thumbnail. Scales the polygon (feet) to fit the
 *  viewBox with a small margin so every tile looks uniformly sized even though
 *  the underlying widthFt × heightFt differ. */
function ShapeThumb({ template }: { template: ShapeTemplate }) {
  const VB_W = 56;
  const VB_H = 44;
  const PAD = 5;
  const scale = Math.min(
    (VB_W - PAD * 2) / template.widthFt,
    (VB_H - PAD * 2) / template.heightFt,
  );
  const drawW = template.widthFt * scale;
  const drawH = template.heightFt * scale;
  const offX = (VB_W - drawW) / 2;
  const offY = (VB_H - drawH) / 2;

  const pts = template.pointsFt ?? [
    { x: 0, y: 0 },
    { x: template.widthFt, y: 0 },
    { x: template.widthFt, y: template.heightFt },
    { x: 0, y: template.heightFt },
  ];
  const polyPoints = pts
    .map((p) => `${offX + p.x * scale},${offY + p.y * scale}`)
    .join(" ");

  return (
    <svg width={VB_W} height={VB_H} viewBox={`0 0 ${VB_W} ${VB_H}`} fill="none" aria-hidden="true">
      <polygon
        points={polyPoints}
        fill="#fff3ed"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface ShapePickerModalProps {
  open: boolean;
  onPick: (template: ShapeTemplate) => void;
  onCancel: () => void;
}

export function ShapePickerModal({ open, onPick, onCancel }: ShapePickerModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDragging = useRef(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  // Swipe-to-close — only tracked when touch starts on the top drag handle.
  // Matches RoomConfirmationCard so the interaction feels consistent across
  // both bottom sheets in the sketch flow.
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touchY = e.touches[0].clientY;
    if (touchY > rect.top + 24) return;
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
      panelRef.current.style.transition = "transform 200ms ease-out";
      panelRef.current.style.transform = "translateY(100%)";
      setTimeout(onCancel, 200);
    } else {
      panelRef.current.style.transition = "transform 150ms ease-out";
      panelRef.current.style.transform = "translateY(0)";
    }
  }, [onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shape-picker-title"
    >
      <div className="absolute inset-0 bg-black/25" onClick={onCancel} />

      <div
        ref={panelRef}
        className="relative bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl shadow-[0_-4px_24px_rgba(31,27,23,0.1)] sm:shadow-[0_8px_30px_rgba(31,27,23,0.12)] w-full sm:w-[400px] max-h-[85dvh] sm:max-h-none overflow-hidden flex flex-col"
        style={{ animation: "shapePickerSlideUp 0.18s ease-out" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-1.5 sm:hidden shrink-0">
          <div className="w-8 h-0.5 rounded-full bg-outline-variant/40" />
        </div>

        <div className="px-5 pt-4 sm:px-6 sm:pt-6 pb-3">
          <h2 id="shape-picker-title" className="text-[15px] font-semibold text-on-surface sm:text-[16px]">
            Pick a room shape
          </h2>
          <p className="mt-1 text-[12px] text-on-surface-variant leading-relaxed sm:text-[13px]">
            Drops at a default size — adjust after placing. Or draw it yourself.
          </p>
        </div>

        <div className="px-5 sm:px-6 pb-5 flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SHAPE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onPick(template)}
                className="flex flex-col items-center justify-center gap-1 py-3 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-high hover:border-brand-accent/40 hover:text-brand-accent active:scale-[0.97] cursor-pointer transition-all min-h-[84px]"
              >
                <ShapeThumb template={template} />
                <span className="text-[11px] font-medium sm:text-[12px]">{template.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="shrink-0 px-5 pt-3 pb-4 sm:px-6 sm:pt-3 sm:pb-5 border-t border-outline-variant/30 bg-surface-container-lowest">
          <button
            type="button"
            onClick={onCancel}
            className="w-full h-10 rounded-lg border border-red-200 text-[13px] font-medium text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes shapePickerSlideUp {
          from {
            transform: translateY(16px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
