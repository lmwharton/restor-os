/**
 * Job lifecycle helpers shared between frontend and backend.
 *
 * Mirrors backend/api/shared/constants.py::ARCHIVED_JOB_STATUSES.
 * Keep these in sync — the backend rejects writes to archived jobs with 403,
 * and the UI should match so users don't see "Save failed" on a status they
 * expect to be editable.
 *
 * Only "collected" is a true terminal status:
 *   - "complete"  = tech finished field work; docs still being assembled
 *   - "submitted" = docs sent to carrier; rejections + resubmits are routine
 *   - "collected" = payment received, file closed → frozen
 */

export const ARCHIVED_JOB_STATUSES = ["collected"] as const;

export type ArchivedJobStatus = (typeof ARCHIVED_JOB_STATUSES)[number];

export function isJobArchived(status?: string | null): boolean {
  return !!status && (ARCHIVED_JOB_STATUSES as readonly string[]).includes(status);
}
