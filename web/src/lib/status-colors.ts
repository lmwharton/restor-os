/**
 * Status colors — single source of truth for JS.
 * Keep in sync with globals.css :root { --status-* } variables.
 * Change a color here AND in globals.css to update everywhere.
 */

export const STATUS_COLORS = {
  new:          "#14b8a6",
  contracted:   "#f59e0b",
  mitigation:   "#e85d26",
  drying:       "#2563eb",
  complete:     "#14b8a6",
  submitted:    "#818cf8",
  collected:    "#10b981",
  scoping:      "#7c3aed",
  in_progress:  "#d97706",
} as const;

export const JOB_TYPE_COLORS = {
  mitigation:     "#3b82f6",
  reconstruction: "#e85d26",
} as const;

/** Get hex with alpha (0-1) appended as 2-digit hex suffix */
export function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}
