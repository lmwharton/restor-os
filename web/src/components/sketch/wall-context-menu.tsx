"use client";

import type { WallData } from "./floor-plan-tools";

interface WallContextMenuProps {
  wall: WallData;
  position: { x: number; y: number };
  onAddDoor: () => void;
  onAddWindow: () => void;
  onAddOpening: () => void;
  onToggleType: () => void;
  onToggleAffected: () => void;
  onClose: () => void;
  wallType?: "interior" | "exterior";
  affected?: boolean;
  hasOpening?: boolean;
}

export function WallContextMenu({
  position,
  onAddDoor,
  onAddWindow,
  onAddOpening,
  onToggleType,
  onToggleAffected,
  onClose,
  wallType = "interior",
  affected = false,
  hasOpening = false,
}: WallContextMenuProps) {
  return (
    <div
      className="absolute z-30"
      style={{ left: position.x, top: position.y }}
    >
      {/* Backdrop to close — stopPropagation prevents canvas click-through */}
      <div className="fixed inset-0" onClick={(e) => { e.stopPropagation(); onClose(); }} />

      {/* Menu card */}
      <div
        className="relative bg-surface-container-lowest rounded-xl shadow-[0_4px_20px_rgba(31,27,23,0.15)] border border-outline-variant/20 overflow-hidden w-[160px]"
        style={{ animation: "fadeIn 0.1s ease-out" }}
      >
        <button
          type="button"
          onClick={() => { onAddDoor(); onClose(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] font-medium text-on-surface hover:bg-surface-container transition-colors cursor-pointer text-left"
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="2" width="14" height="20" rx="1" />
            <circle cx="14" cy="12" r="1.5" fill="currentColor" />
          </svg>
          Add Door
        </button>

        <button
          type="button"
          onClick={() => { onAddWindow(); onClose(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] font-medium text-on-surface hover:bg-surface-container transition-colors cursor-pointer text-left"
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="4" width="18" height="16" rx="1" />
            <line x1="12" y1="4" x2="12" y2="20" />
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
          Add Window
        </button>

        {!hasOpening && (
          <button
            type="button"
            onClick={() => { onAddOpening(); onClose(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] font-medium text-on-surface hover:bg-surface-container transition-colors cursor-pointer text-left"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="4 3">
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
            Add Opening
          </button>
        )}

        <div className="h-px bg-outline-variant/20 mx-2" />

        <button
          type="button"
          onClick={() => { onToggleType(); onClose(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] font-medium text-on-surface hover:bg-surface-container transition-colors cursor-pointer text-left"
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
          {wallType === "interior" ? "Mark Exterior" : "Mark Interior"}
        </button>

        <button
          type="button"
          onClick={() => { onToggleAffected(); onClose(); }}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] font-medium transition-colors cursor-pointer text-left ${
            affected
              ? "text-error hover:bg-error-container/20"
              : "text-on-surface hover:bg-surface-container"
          }`}
        >
          <svg width={14} height={14} viewBox="0 0 20 20" fill="none">
            <path
              d="M10 2L12.09 7.26L18 8.27L13.55 12.14L14.82 18L10 15.27L5.18 18L6.45 12.14L2 8.27L7.91 7.26L10 2Z"
              fill={affected ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={1.5}
            />
          </svg>
          {affected ? "Remove Affected" : "Mark Affected"}
        </button>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
