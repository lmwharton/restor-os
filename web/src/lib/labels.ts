/**
 * Single source of truth for JobStatus labels + display tokens.
 * UI components import from here. Don't redefine STATUS_META locally.
 *
 * Spec 01K — backed by the 9-status lifecycle. Colors mirror status-colors.ts
 * (which mirrors globals.css :root --status-* vars).
 */
import { JOB_STATUSES, type JobStatus } from "./types";
import { STATUS_COLORS, STATUS_BG, STATUS_INK, STATUS_FG, withAlpha } from "./status-colors";

export interface StatusMeta {
  label: string;
  color: string;       // saturated mid-tone — used for dot, pipeline-segment bg, map pin
  bg: string;          // light tint — used for chip/badge backgrounds
  ink: string;         // dark text color — used for chip/badge text on the bg tint
  fg: string;          // contrast text color on the saturated `color` — used for pipeline segments
  border: string;      // for outlined variants — derived alpha of color
  /** True when label should render with strikethrough (lost = never converted) */
  strike?: boolean;
}

// Option A 4-bucket palette: bg colors come straight from STATUS_BG (hand-tuned
// warm tints), borders are an alpha derivative of the fg color. Disputed gets a
// slightly stronger border because it's the alarm/"act now" voice.
//
// Three foreground roles, intentionally separate (canonical Option A):
//  - `color` = saturated dot/segment-bg (e.g. lead = #c8b8a8)
//  - `ink`   = dark text on the LIGHT `bg` tint (e.g. lead chip text = #5a544f)
//  - `fg`    = contrast text on the SATURATED `color` (e.g. lead segment text = #1a1a1a)
//
// Using `color` for chip text (the old behavior) makes light-tone chips like
// Lead and Lost too low-contrast against their pale bgs, which was the bug
// surfaced 2026-04-29.
export const STATUS_META: Record<JobStatus, StatusMeta> = {
  lead:      { label: "Lead",      color: STATUS_COLORS.lead,      bg: STATUS_BG.lead,      ink: STATUS_INK.lead,      fg: STATUS_FG.lead,      border: withAlpha(STATUS_COLORS.lead, 0.25) },
  active:    { label: "Active",    color: STATUS_COLORS.active,    bg: STATUS_BG.active,    ink: STATUS_INK.active,    fg: STATUS_FG.active,    border: withAlpha(STATUS_COLORS.active, 0.30) },
  on_hold:   { label: "On Hold",   color: STATUS_COLORS.on_hold,   bg: STATUS_BG.on_hold,   ink: STATUS_INK.on_hold,   fg: STATUS_FG.on_hold,   border: withAlpha(STATUS_COLORS.on_hold, 0.30) },
  completed: { label: "Completed", color: STATUS_COLORS.completed, bg: STATUS_BG.completed, ink: STATUS_INK.completed, fg: STATUS_FG.completed, border: withAlpha(STATUS_COLORS.completed, 0.30) },
  invoiced:  { label: "Invoiced",  color: STATUS_COLORS.invoiced,  bg: STATUS_BG.invoiced,  ink: STATUS_INK.invoiced,  fg: STATUS_FG.invoiced,  border: withAlpha(STATUS_COLORS.invoiced, 0.30) },
  disputed:  { label: "Disputed",  color: STATUS_COLORS.disputed,  bg: STATUS_BG.disputed,  ink: STATUS_INK.disputed,  fg: STATUS_FG.disputed,  border: withAlpha(STATUS_COLORS.disputed, 0.35) },
  paid:      { label: "Paid",      color: STATUS_COLORS.paid,      bg: STATUS_BG.paid,      ink: STATUS_INK.paid,      fg: STATUS_FG.paid,      border: withAlpha(STATUS_COLORS.paid, 0.30) },
  cancelled: { label: "Cancelled", color: STATUS_COLORS.cancelled, bg: STATUS_BG.cancelled, ink: STATUS_INK.cancelled, fg: STATUS_FG.cancelled, border: withAlpha(STATUS_COLORS.cancelled, 0.25) },
  lost:      { label: "Lost",      color: STATUS_COLORS.lost,      bg: STATUS_BG.lost,      ink: STATUS_INK.lost,      fg: STATUS_FG.lost,      border: withAlpha(STATUS_COLORS.lost, 0.22), strike: true },
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
    ink: STATUS_INK.lead,
    fg: STATUS_FG.lead,
    border: withAlpha(STATUS_COLORS.lead, 0.25),
  };
}

/**
 * Spec 01K transition matrix — every status can transition to every other
 * status. Originally a strict happy-path matrix, opened up 2026-04-29 because
 * contractors make mistakes and need an undo path. Off-happy-path transitions
 * still require a reason (see `transitionNeedsReason`); closeout gates are
 * still enforced via the closeout-checklist modal when target = `completed`.
 * Mirrored on the server side in backend/api/jobs/lifecycle.py.
 */
const _ALL_STATUSES: JobStatus[] = JOB_STATUSES.slice();
export const STATUS_TRANSITIONS: Record<JobStatus, JobStatus[]> = Object.fromEntries(
  _ALL_STATUSES.map((s) => [s, _ALL_STATUSES.filter((t) => t !== s)]),
) as Record<JobStatus, JobStatus[]>;

/**
 * Canonical forward-pipeline transitions that never need a reason. Anything
 * else (off-ramp, backward, skip-ahead) requires a reason so the audit trail
 * captures *why* the contractor went off-script.
 */
const HAPPY_PATH_TRANSITIONS = new Set<string>([
  "lead→active",
  "active→completed",
  "completed→invoiced",
  "invoiced→paid",
  "on_hold→active",      // resume
  "disputed→invoiced",   // dispute resolved
]);

/** True if a target status always requires a reason (off-ramps + dispute). */
export const REASON_REQUIRED_STATUSES: Set<JobStatus> = new Set([
  "on_hold", "cancelled", "lost", "disputed",
]);

/**
 * True if this from/to transition needs a reason. Combines:
 *   • Off-ramp / dispute targets (always need a reason)
 *   • Any move OFF the canonical happy-path forward pipeline
 *
 * Intentional happy-path transitions (lead→active, etc.) stay reason-free.
 */
export function transitionNeedsReason(from: JobStatus, to: JobStatus): boolean {
  if (REASON_REQUIRED_STATUSES.has(to)) return true;
  return !HAPPY_PATH_TRANSITIONS.has(`${from}→${to}`);
}

/**
 * Spec 01K D4 — Cancel reason dropdown options. Shared by both `cancelled` and
 * `lost` transitions; the *target status* encodes whether work-stopped vs.
 * lead-never-converted, while the *reason* captures why. Storage shape per
 * D-impl-1 is two columns: `cancel_reason` (snake_case key, NULL if Other) and
 * `cancel_reason_other` (free text). One populated, never both.
 */
export const CANCEL_REASONS: { value: string; label: string }[] = [
  { value: "customer_chose_other",  label: "Customer chose another contractor" },
  { value: "customer_cancelled",    label: "Customer cancelled claim" },
  { value: "carrier_denied",        label: "Carrier denied claim before work started" },
  { value: "scope_outside_trades",  label: "Scope outside our trades" },
  { value: "couldnt_reach",         label: "Couldn't reach customer" },
  { value: "other",                 label: "Other (free text)" },
];
