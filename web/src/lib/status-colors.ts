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
  lead:      "#8a7560",  // warm tan — quiet "in motion"
  active:    "#e85d26",  // brand orange — full motion
  on_hold:   "#b8801f",  // amber — waiting
  disputed:  "#c8501a",  // red-orange — only "act now" color
  completed: "#5fae7d",  // light green — won
  invoiced:  "#2f8a5b",  // mid green — money invoiced
  paid:      "#1f7a48",  // deep green — money landed
  cancelled: "#7a746e",  // warm gray — closed
  lost:      "#a39990",  // lighter gray — lost
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
  completed: "#e3f1e7",
  invoiced:  "#dcefe2",
  paid:      "#d4e8dc",
  cancelled: "#ebe7e3",
  lost:      "#f0ece8",
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
