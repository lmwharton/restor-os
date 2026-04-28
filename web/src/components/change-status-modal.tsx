"use client";

/**
 * ChangeStatusModal — bottom-sheet flow for moving a job through Spec 01K's
 * 9-status lifecycle.
 *
 * Triggered when the user taps the status pill on the job detail page.
 * Shows only legal target statuses from the transition matrix. Captures
 * required reason for on_hold / cancelled / lost / disputed. Optionally
 * captures a resume date when moving to on_hold. Sends through the
 * `useUpdateJobStatus` mutation with `expected_current_status` for
 * optimistic-locking on the server side.
 *
 * If the user picks `completed`, this modal closes and the parent should
 * open <CloseoutChecklistModal /> instead — closeout has its own gate flow.
 */

import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BottomSheet, SheetFooterButton } from "./bottom-sheet";
import { JobStatusBadge } from "./job-status-badge";
import { useUpdateJobStatus } from "@/lib/hooks/use-jobs";
import { apiGet } from "@/lib/api";
import type { JobStatus } from "@/lib/types";
import type { CloseoutGatesResponse } from "@/lib/hooks/use-closeout";
import { STATUS_META, STATUS_TRANSITIONS, REASON_REQUIRED_STATUSES } from "@/lib/labels";

interface ChangeStatusModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  jobAddress: string;
  currentStatus: JobStatus;
  /**
   * If the user picks `completed`, the parent should typically open the
   * Closeout Checklist modal instead of submitting directly. This callback
   * fires WITHOUT closing the modal so the parent can hand off seamlessly.
   * If omitted, picking `completed` proceeds as a normal submit.
   */
  onCompletedSelected?: () => void;
}

export function ChangeStatusModal({
  open,
  onClose,
  jobId,
  jobAddress,
  currentStatus,
  onCompletedSelected,
}: ChangeStatusModalProps) {
  // Filter out terminal targets we shouldn't expose as one-tap actions
  // (cancelled / lost still need their own confirmation flow — for now they
  // surface as targets so the UI is complete; future polish can move them
  // behind a "More options" reveal).
  const legalTargets = useMemo<JobStatus[]>(
    () => STATUS_TRANSITIONS[currentStatus] ?? [],
    [currentStatus],
  );

  const [target, setTarget] = useState<JobStatus | null>(legalTargets[0] ?? null);
  const [reason, setReason] = useState("");
  const [resumeDate, setResumeDate] = useState("");

  const updateStatus = useUpdateJobStatus(jobId);
  const qc = useQueryClient();

  // Prefetch closeout gates the instant the user picks 'completed'.
  // The closeout-checklist modal that opens next reads from the same
  // ['closeout-gates', jobId, 'completed'] cache key, so by the time it
  // mounts the gate list is already there — no skeleton flash on a fast
  // backend (~50ms localhost). On a slow link, worst case is the same
  // skeleton the modal showed before this fix.
  useEffect(() => {
    if (target !== "completed" || !jobId) return;
    qc.prefetchQuery({
      queryKey: ["closeout-gates", jobId, "completed"],
      queryFn: () =>
        apiGet<CloseoutGatesResponse>(
          `/v1/jobs/${jobId}/closeout-gates?target=completed`,
        ),
      staleTime: 30_000,
    });
  }, [target, jobId, qc]);

  const showResume = target === "on_hold";
  const needsReason = target ? REASON_REQUIRED_STATUSES.has(target) : false;
  const reasonValid = !needsReason || reason.trim().length > 0;
  const canSubmit = !!target && reasonValid && !updateStatus.isPending;

  const targetMeta = target ? STATUS_META[target] : null;

  function handleSubmit() {
    if (!target) return;

    // Special-case: moving to `completed` opens the closeout checklist instead.
    if (target === "completed" && onCompletedSelected) {
      onCompletedSelected();
      return;
    }

    updateStatus.mutate(
      {
        status: target,
        expected_current_status: currentStatus,
        reason: needsReason ? reason.trim() : undefined,
        resume_date: showResume && resumeDate ? resumeDate : undefined,
      },
      {
        onSuccess: () => onClose(),
        // 409 handling: TanStack will surface the error; UI shows it inline.
      },
    );
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Change job status"
      subtitle={
        <span className="inline-flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-on-surface">{jobAddress}</span>
          <span>· currently</span>
          <JobStatusBadge status={currentStatus} size="sm" />
        </span>
      }
      footer={
        <>
          <SheetFooterButton variant="cancel" onClick={onClose} flex={1}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            onClick={handleSubmit}
            disabled={!canSubmit}
            flex={2}
            bg={targetMeta?.color}
          >
            {updateStatus.isPending ? (
              "Working…"
            ) : target ? (
              <>
                Move to {targetMeta?.label}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12h14m0 0l-5-5m5 5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            ) : (
              "Pick a status"
            )}
          </SheetFooterButton>
        </>
      }
    >
      {/* "Move to" — pill-style selector. House style is rounded-lg, not pill,
          per web/CLAUDE.md. We use rounded-xl + 56px height for gloved-hand feel. */}
      <div className="text-[11px] font-semibold text-on-surface-variant tracking-[0.06em] uppercase">
        Move to
      </div>
      <div className="mt-2.5 flex flex-col gap-2">
        {legalTargets.length === 0 && (
          <div className="rounded-xl border border-dashed border-outline-variant/50 bg-surface-container p-4 text-[13px] text-on-surface-variant">
            This status is terminal — no further transitions are allowed.
          </div>
        )}
        {legalTargets.map((t) => {
          const meta = STATUS_META[t];
          const selected = t === target;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTarget(t)}
              className="h-14 w-full rounded-xl px-4 flex items-center gap-3 text-left transition active:scale-[0.99]"
              style={{
                backgroundColor: selected ? meta.bg : "var(--surface-container-lowest)",
                border: `1px solid ${selected ? meta.color : "var(--outline-variant)"}`,
              }}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: meta.color }}
                aria-hidden="true"
              />
              <span className="text-[15px] font-semibold text-on-surface flex-1">
                {meta.label}
              </span>
              {selected && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M5 12.5l4.5 4.5L19 7.5"
                    stroke={meta.color}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* Reason — required when target needs one (on_hold, cancelled, lost, disputed) */}
      {needsReason && (
        <div className="mt-5">
          <label className="text-[11px] font-semibold text-on-surface-variant tracking-[0.06em] uppercase">
            Reason
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this changing?"
            onFocus={(e) => e.target.select()}
            className="mt-2 w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3.5 py-3 text-[16px] leading-snug text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/40 resize-none"
          />
          <div className="mt-1.5 text-[12px] text-on-surface-variant/80">
            Logged to job timeline.
          </div>
        </div>
      )}

      {/* Expected resume date — only meaningful for on_hold */}
      {showResume && (
        <div className="mt-5">
          <label className="text-[11px] font-semibold text-on-surface-variant tracking-[0.06em] uppercase">
            Expected resume <span className="font-normal normal-case tracking-normal text-on-surface-variant/80">(optional)</span>
          </label>
          <input
            type="date"
            value={resumeDate}
            onChange={(e) => setResumeDate(e.target.value)}
            className="mt-2 h-12 w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3.5 text-[16px] text-on-surface outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/40"
          />
        </div>
      )}

      {/* Error display — surfaces 409 stale-status conflicts and other errors */}
      {updateStatus.isError && (
        <div className="mt-4 rounded-xl border border-status-cancelled/30 bg-status-cancelled/10 p-3.5 text-[13px] text-on-surface">
          <div className="font-semibold text-[#9b1c1c]">Status update failed</div>
          <div className="mt-1 text-on-surface-variant">
            {updateStatus.error instanceof Error
              ? updateStatus.error.message
              : "Something went wrong. The job may have been updated by someone else — try refreshing."}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
