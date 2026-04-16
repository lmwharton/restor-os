"use client";

import { TOOLS, type ToolType } from "./floor-plan-tools";
import type Konva from "konva";

/* ------------------------------------------------------------------ */
/*  Tool Icons (inline SVG paths)                                      */
/* ------------------------------------------------------------------ */

function ToolIcon({ type }: { type: string }) {
  const s = 18;
  switch (type) {
    case "rect":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "line":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M4 20L20 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "door":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M4 20V4h2v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M6 4a14 14 0 0 1 10 10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
        </svg>
      );
    case "window":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="4" y="6" width="16" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
          <line x1="12" y1="6" x2="12" y2="18" stroke="currentColor" strokeWidth="1.5" />
          <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "opening":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
          <line x1="4" y1="8" x2="4" y2="16" stroke="currentColor" strokeWidth="2" />
          <line x1="20" y1="8" x2="20" y2="16" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "pointer":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M5 3l14 10-6 1-3 6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      );
    case "trash":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Toolbar button style                                               */
/* ------------------------------------------------------------------ */

const btnBase = "flex flex-col items-center justify-center w-[36px] h-[36px] sm:w-[44px] sm:h-[44px] rounded-lg text-[10px] font-medium cursor-pointer";
const btnInactive = `${btnBase} text-[#6b6560] hover:bg-[#eae6e1]`;
const btnDisabled = `${btnBase} text-[#6b6560] hover:bg-[#eae6e1] disabled:opacity-30`;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface FloorPlanToolbarProps {
  tool: ToolType;
  onToolChange: (t: ToolType) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  stageScale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  stageRef: React.RefObject<Konva.Stage | null>;
}

export function FloorPlanToolbar({
  tool, onToolChange, canUndo, canRedo, onUndo, onRedo,
  stageScale, onZoomIn, onZoomOut, onFit, stageRef,
}: FloorPlanToolbarProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-[#eae6e1] bg-[#faf8f5] flex-wrap">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onToolChange(t.id)}
          aria-label={t.label}
          className={`${btnBase} transition-all ${
            tool === t.id
              ? "bg-[#e85d26]/12 text-[#e85d26]"
              : "text-[#6b6560] hover:bg-[#eae6e1]"
          }`}
        >
          <ToolIcon type={t.icon} />
          <span className="mt-0.5">{t.label}</span>
        </button>
      ))}
      <div className="w-px h-8 bg-[#eae6e1] mx-1" />
      <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" className={btnDisabled}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><path d="M3 10h14a4 4 0 0 1 0 8H10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 6L3 10l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="mt-0.5">Undo</span>
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Redo" className={btnDisabled}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><path d="M21 10H7a4 4 0 0 0 0 8h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M17 6l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="mt-0.5">Redo</span>
      </button>
      <div className="w-px h-8 bg-[#eae6e1] mx-1" />
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" className={btnInactive}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M21 21l-4-4M8 11h6M11 8v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <span className="mt-0.5">Zoom+</span>
      </button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" className={btnInactive}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M21 21l-4-4M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <span className="mt-0.5">Zoom-</span>
      </button>
      <button type="button" onClick={onFit} aria-label="Reset view" className={btnInactive}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M9 3v18M3 9h18" stroke="currentColor" strokeWidth="1" opacity="0.3" /></svg>
        <span className="mt-0.5">Fit</span>
      </button>
      <span className="text-[10px] text-[#8a847e] font-[family-name:var(--font-geist-mono)] ml-1">{Math.round(stageScale * 100)}%</span>
      <div className="w-px h-8 bg-[#eae6e1] mx-1" />
      <button
        type="button"
        onClick={() => {
          const stage = stageRef.current;
          if (!stage) return;
          // Hide grid layer (first layer) for clean export
          const layers = stage.getLayers();
          const gridLayer = layers[0];
          if (gridLayer) gridLayer.visible(false);
          // Hide selection handles + resize handles for clean export
          const hiddenNodes: Array<{ visible: (v: boolean) => void }> = [];
          stage.find("Circle").forEach((c: { attrs: { fill?: string }; visible: (v: boolean) => void }) => {
            if (c.attrs.fill === "#5b6abf" || c.attrs.fill === "#e85d26") {
              c.visible(false);
              hiddenNodes.push(c);
            }
          });
          stage.draw();
          const uri = stage.toDataURL({ pixelRatio: 2 });
          // Restore only the nodes we actually hid
          if (gridLayer) gridLayer.visible(true);
          hiddenNodes.forEach(c => c.visible(true));
          stage.draw();
          const link = document.createElement("a");
          link.download = "floor-plan.png";
          link.href = uri;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }}
        aria-label="Export PNG"
        className={btnInactive}
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="mt-0.5">Export</span>
      </button>
    </div>
  );
}
