/**
 * Status colors — single source of truth for JS.
 * Keep in sync with globals.css :root { --status-* } variables AND
 * STATUS_BG below (which maps each status to its tuned warm-tinted bg).
 * Change a color here AND in globals.css to update everywhere.
 *
 * Spec 01K — 9-status job lifecycle, Option A "4-bucket" palette:
 *   • motion    — orange (active is loudest; lead is a quiet warm tan)
 *   • waiting   — amber (on_hold quiet, disputed is the only "act now" alarm)
 *   • won       — green deepens as money lands (completed → invoiced → paid)
 *   • closed    — warm gray (lost is lighter than cancelled — both terminal,
 *                 neither alarming; cancelled is no longer red)
 */
import type { JobStatus } from "./types";

export const STATUS_COLORS: Record<JobStatus, string> = {
  lead:      "#c8b8a8",  // cream tan — quiet "in motion", reads as neutral entry
  active:    "#e85d26",  // brand orange — full motion
  on_hold:   "#e8a23a",  // warm amber — waiting (was #b8801f, design called for warmer)
  disputed:  "#c8501a",  // red-orange — only "act now" color
  completed: "#a8d4b6",  // light mint — won bucket entry
  invoiced:  "#5fae7d",  // medium green — money invoiced
  paid:      "#1f7a48",  // deep green — money landed
  cancelled: "#7a746e",  // warm gray — closed
  lost:      "#d4cdc6",  // light gray — lead-that-never-converted
} as const;

/**
 * Tuned warm-tinted backgrounds (Option A) — these are NOT pure alpha overlays
 * of STATUS_COLORS. They're hand-picked to sit gracefully on the cream
 * (#fff8f4) surface. Use directly for badge backgrounds; do not derive via
 * withAlpha() for these.
 */
export const STATUS_BG: Record<JobStatus, string> = {
  lead:      "#f3ece4",
  active:    "#fff3ed",
  on_hold:   "#fdefd8",
  disputed:  "#fbe8dc",
  completed: "#ecf6ef",  // lightest green — pairs with #a8d4b6
  invoiced:  "#e3f1e7",  // medium-light green — pairs with #5fae7d
  paid:      "#dcefe2",  // medium green tint — pairs with #1f7a48
  cancelled: "#ebe7e3",
  lost:      "#f0ece8",
} as const;

/**
 * Pipeline-segment foreground (text on the saturated STATUS_COLORS bg).
 * Picked for WCAG AA contrast: dark text on light fills, white on dark.
 * Per design Option A `--c-{status}-fg`.
 */
export const STATUS_FG: Record<JobStatus, string> = {
  lead:      "#1a1a1a",
  active:    "#ffffff",
  on_hold:   "#1a1a1a",
  disputed:  "#ffffff",
  completed: "#1a1a1a",
  invoiced:  "#ffffff",
  paid:      "#ffffff",
  cancelled: "#ffffff",
  lost:      "#5a544f",
} as const;

/**
 * Chip ink (text color on the LIGHT STATUS_BG tint, NOT on the saturated
 * fill). Darker than STATUS_COLORS so the label stays legible against the
 * pale tint. Per design Option A chip palette.
 */
export const STATUS_INK: Record<JobStatus, string> = {
  lead:      "#5a544f",
  active:    "#c44912",
  on_hold:   "#a35e0c",
  disputed:  "#a23f10",
  completed: "#1f6a3c",
  invoiced:  "#1c6b41",
  paid:      "#155f37",
  cancelled: "#3a3633",
  lost:      "#7a746e",
} as const;

// Job type indicator dots — distinct from lifecycle status colors. Spec 01K
// Option A bans pure blue; mitigation gets a desaturated teal that still
// reads as "water / drying" without breaking the warm palette.
export const JOB_TYPE_COLORS = {
  mitigation:     "#3a8a8c",
  reconstruction: "#e85d26",
} as const;

/** Get hex with alpha (0-1) appended as 2-digit hex suffix */
export function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}
