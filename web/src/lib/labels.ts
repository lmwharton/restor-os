/**
 * Single source of truth for JobStatus labels + display tokens.
 * UI components import from here. Don't redefine STATUS_META locally.
 *
 * Spec 01K — backed by the 9-status lifecycle. Colors mirror status-colors.ts
 * (which mirrors globals.css :root --status-* vars).
 */
import type { JobStatus } from "./types";
import { STATUS_COLORS, STATUS_BG, withAlpha } from "./status-colors";

export interface StatusMeta {
  label: string;
  color: string;       // foreground / dot
  bg: string;          // light background tint (for badges) — Option A tuned warm tint
  border: string;      // for outlined variants — derived alpha of fg
  /** True when label should render with strikethrough (lost = never converted) */
  strike?: boolean;
}

// Option A 4-bucket palette: bg colors come straight from STATUS_BG (hand-tuned
// warm tints), borders are an alpha derivative of the fg color. Disputed gets a
// slightly stronger border because it's the alarm/"act now" voice.
export const STATUS_META: Record<JobStatus, StatusMeta> = {
  lead:      { label: "Lead",      color: STATUS_COLORS.lead,      bg: STATUS_BG.lead,      border: withAlpha(STATUS_COLORS.lead, 0.25) },
  active:    { label: "Active",    color: STATUS_COLORS.active,    bg: STATUS_BG.active,    border: withAlpha(STATUS_COLORS.active, 0.30) },
  on_hold:   { label: "On Hold",   color: STATUS_COLORS.on_hold,   bg: STATUS_BG.on_hold,   border: withAlpha(STATUS_COLORS.on_hold, 0.30) },
  completed: { label: "Completed", color: STATUS_COLORS.completed, bg: STATUS_BG.completed, border: withAlpha(STATUS_COLORS.completed, 0.30) },
  invoiced:  { label: "Invoiced",  color: STATUS_COLORS.invoiced,  bg: STATUS_BG.invoiced,  border: withAlpha(STATUS_COLORS.invoiced, 0.30) },
  disputed:  { label: "Disputed",  color: STATUS_COLORS.disputed,  bg: STATUS_BG.disputed,  border: withAlpha(STATUS_COLORS.disputed, 0.35) },
  paid:      { label: "Paid",      color: STATUS_COLORS.paid,      bg: STATUS_BG.paid,      border: withAlpha(STATUS_COLORS.paid, 0.30) },
  cancelled: { label: "Cancelled", color: STATUS_COLORS.cancelled, bg: STATUS_BG.cancelled, border: withAlpha(STATUS_COLORS.cancelled, 0.25) },
  lost:      { label: "Lost",      color: STATUS_COLORS.lost,      bg: STATUS_BG.lost,      border: withAlpha(STATUS_COLORS.lost, 0.22), strike: true },
};

/**
 * Resolve a status string to a StatusMeta. The migration already mapped any
 * legacy values to the new lifecycle, so anything outside the 9 canonical
 * statuses falls through to a neutral "Unknown" meta — defensive only,
 * shouldn't happen against a migrated database.
 */
export function getStatusMeta(status: string | null | undefined): StatusMeta {
  if (status && status in STATUS_META) {
    return STATUS_META[status as JobStatus];
  }
  return {
    label: status ? `Unknown (${status})` : "Unknown",
    color: STATUS_COLORS.lead,
    bg: STATUS_BG.lead,
    border: withAlpha(STATUS_COLORS.lead, 0.25),
  };
}

/**
 * Spec 01K transition matrix — which target statuses are legal from each source.
 * Mirrored on the server side in backend/api/jobs/lifecycle.py STATUS_TRANSITIONS.
 * UI uses this to render the legal target options in the change-status modal.
 */
export const STATUS_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  lead:      ["active", "lost"],
  active:    ["on_hold", "completed", "cancelled"],
  on_hold:   ["active", "cancelled"],
  completed: ["invoiced", "active"],          // active = reopen
  invoiced:  ["paid", "disputed"],
  disputed:  ["invoiced", "cancelled"],       // invoiced = supplement filed/resolved
  paid:      [],
  cancelled: [],
  lost:      [],
};

/** True if a status requires a `reason` field on transition into it. */
export const REASON_REQUIRED_STATUSES: Set<JobStatus> = new Set([
  "on_hold", "cancelled", "lost", "disputed",
]);
