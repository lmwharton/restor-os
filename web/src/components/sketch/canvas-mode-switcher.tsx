"use client";

// Segmented Sketch↔Moisture toggle that lives in the floor plan's top bar.
// Mobile: icon-only (32x32 segments inside a 64x36 container).
// Desktop: icon + label ("Sketch" / "Moisture") — same container, wider segments.

import { CANVAS_MODES, type CanvasMode } from "./moisture-mode";

interface CanvasModeSwitcherProps {
  mode: CanvasMode;
  onChange: (mode: CanvasMode) => void;
  /** Prevents interaction while a save or other long-running op is in flight. */
  disabled?: boolean;
}

function SketchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 20h9M16.5 3.5l4 4L7 21H3v-4L16.5 3.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DropletIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5s6 6.5 6 11.5a6 6 0 1 1-12 0c0-5 6-11.5 6-11.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ORDER: CanvasMode[] = ["sketch", "moisture"];

export function CanvasModeSwitcher({ mode, onChange, disabled }: CanvasModeSwitcherProps) {
  return (
    <div
      className="inline-flex items-center h-9 p-0.5 rounded-lg bg-surface-container-low border border-outline-variant shrink-0"
      role="tablist"
      aria-label="Canvas mode"
    >
      {ORDER.map((m) => {
        const cfg = CANVAS_MODES[m];
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${cfg.label} mode`}
            disabled={disabled}
            onClick={() => !active && onChange(m)}
            // touch-action prevents Safari's double-tap-to-zoom from swallowing
            // quick toggles when techs switch modes mid-job.
            className={`inline-flex items-center justify-center gap-1.5 h-8 rounded-md transition-all duration-150 [touch-action:manipulation] disabled:opacity-50 ${
              // Mobile: icon-only 32px square. Desktop (sm+): icon + label, auto width.
              "w-8 sm:w-auto sm:px-2.5 sm:text-[12px] sm:font-semibold"
            } ${
              active
                ? "text-white shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
                : "text-on-surface-variant hover:bg-surface-container-high"
            }`}
            style={active ? { background: cfg.accent } : undefined}
          >
            {m === "sketch" ? <SketchIcon /> : <DropletIcon />}
            <span className="hidden sm:inline">{cfg.label}</span>
          </button>
        );
      })}
    </div>
  );
}
