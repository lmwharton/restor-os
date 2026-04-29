/**
 * Job lifecycle helpers shared between frontend and backend.
 *
 * Mirrors backend/api/shared/constants.py::ARCHIVED_JOB_STATUSES.
 * Keep these in sync — the backend rejects writes to archived jobs with 403,
 * and the UI should match so users don't see "Save failed" on a status they
 * expect to be editable.
 *
 * Spec 01K terminal statuses (frozen, archived from active lists):
 *   - "paid"       = payment received, job closed → frozen
 *   - "cancelled"  = active work cancelled → frozen
 *   - "lost"       = lead never converted → frozen
 *
 * READ_ONLY_STATUSES is broader — includes invoiced (estimate locked while
 * waiting on payment) but only the three terminal states above are "archived"
 * (excluded from default lists).
 */
import type { JobStatus } from "./types";

export const ARCHIVED_JOB_STATUSES: readonly JobStatus[] = ["paid", "cancelled", "lost"] as const;
export const READ_ONLY_STATUSES: readonly JobStatus[] = ["invoiced", "paid", "cancelled", "lost"] as const;
export const ACTIVE_LIST_STATUSES: readonly JobStatus[] = [
  "lead", "active", "on_hold", "completed", "invoiced", "disputed",
] as const;

export type ArchivedJobStatus = (typeof ARCHIVED_JOB_STATUSES)[number];

export function isJobArchived(status?: string | null): boolean {
  return !!status && (ARCHIVED_JOB_STATUSES as readonly string[]).includes(status);
}

export function isJobReadOnly(status?: string | null): boolean {
  return !!status && (READ_ONLY_STATUSES as readonly string[]).includes(status);
}

/**
 * Spec 01K — estimate edit lock is DERIVED from status.
 * Editable while still working (lead/active/completed) or filing supplement (disputed).
 * Locked once sent (invoiced) or settled (paid/cancelled/lost).
 */
export function isEstimateEditable(status?: string | null): boolean {
  if (!status) return false;
  return ["lead", "active", "completed", "disputed"].includes(status);
}
