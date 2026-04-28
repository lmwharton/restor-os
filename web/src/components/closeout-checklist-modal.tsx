"use client";

/**
 * CloseoutChecklistModal — Spec 01K's soft-gate closeout flow.
 *
 * Surfaces when the user picks "Completed" in the change-status modal.
 * Shows per-job-type gates, supports "Close Anyway" for acknowledge-level
 * fails, and hard-blocks with a clear next-step CTA for hard_block fails.
 *
 * Final submit moves the job to status='completed' via useUpdateJobStatus,
 * passing override_gates + override_reason for any acknowledge-level gates
 * the user accepted. The reason gets logged to event_history as
 * event_type='closeout_override' on the server side.
 */

import { useState, useMemo } from "react";
import Link from "next/link";
import { BottomSheet, SheetFooterButton } from "./bottom-sheet";
import { useUpdateJobStatus } from "@/lib/hooks/use-jobs";
import { useCloseoutGates, CLOSE_ANYWAY_REASONS } from "@/lib/hooks/use-closeout";
import type { CloseoutGate } from "@/lib/hooks/use-closeout";
import type { JobStatus } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Token shorthands — pull through CSS vars so the modal re-themes    */
/*  with globals.css.                                                  */
/*                                                                     */
/*  TODO(palette): migrate to --st-* aliases once the parallel agent   */
/*  lands them in globals.css (--st-on_hold-bg, --st-disputed,         */
/*  --st-disputed-bg, --st-completed, --st-completed-bg). The          */
/*  --status-* tokens defined today are functionally equivalent.       */
/* ------------------------------------------------------------------ */

const TOKEN = {
  warnFg:     "var(--status-on-hold)",       // amber
  warnBg:     "color-mix(in srgb, var(--status-on-hold) 12%, var(--surface-container-lowest))",
  warnBgSel:  "color-mix(in srgb, var(--status-on-hold) 18%, var(--surface-container-lowest))",
  warnBorder: "color-mix(in srgb, var(--status-on-hold) 30%, transparent)",
  warnInk:    "color-mix(in srgb, var(--status-on-hold) 75%, var(--on-surface))",
  blockFg:    "var(--status-cancelled)",     // red
  blockBg:    "color-mix(in srgb, var(--status-cancelled) 12%, var(--surface-container-lowest))",
  blockBorder:"color-mix(in srgb, var(--status-cancelled) 25%, transparent)",
  blockInk:   "color-mix(in srgb, var(--status-cancelled) 75%, var(--on-surface))",
  okFg:       "var(--status-completed)",     // green
  okBg:       "color-mix(in srgb, var(--status-completed) 14%, var(--surface-container-lowest))",
  ink:        "var(--on-surface)",
};

interface CloseoutChecklistModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  jobAddress: string;
  jobType: string;
  currentStatus: JobStatus;
}

export function CloseoutChecklistModal({
  open,
  onClose,
  jobId,
  jobAddress,
  jobType,
  currentStatus,
}: CloseoutChecklistModalProps) {
  const { data: gatesData, isLoading } = useCloseoutGates(jobId, "completed", open);
  const updateStatus = useUpdateJobStatus(jobId);

  const [reason, setReason] = useState<string>(CLOSE_ANYWAY_REASONS[1].value);
  const [otherReason, setOtherReason] = useState("");

  const gates = useMemo(() => gatesData?.gates ?? [], [gatesData]);
  const stats = useMemo(() => countGates(gates), [gates]);

  const hardBlocks = gates.filter((g) => g.status === "hard_block");
  // Spec 01K voice: warn = surfaces in the list but doesn't block close
  // (no reason required). acknowledge = must select a Close Anyway reason.
  // Treating warn like acknowledge would make the seed default (most gates
  // = warn) demand a reason for every imperfect job, which the spec explicitly
  // rejects ("soft gate by default — not a hard block").
  const acknowledgeFails = gates.filter((g) => g.status === "acknowledge");
  const hasHardBlock = hardBlocks.length > 0;
  const needsAcknowledgment = acknowledgeFails.length > 0;

  // Submit gates:
  //  - Block while gates are still loading. Without this, gates=[] →
  //    hasHardBlock=false → "Mark Completed" enabled → a fast click bypasses
  //    hard_block evaluation entirely (the PATCH /status endpoint does NOT
  //    re-evaluate gates server-side; it trusts the client's override list).
  //  - Block if any hard_block gate is failing.
  //  - If any acknowledge-level gate failed, require a Close Anyway reason
  //    (and "other" requires free text).
  //  - Block during pending mutation.
  const canSubmit = !isLoading
    && !hasHardBlock
    && (!needsAcknowledgment || (reason && (reason !== "other" || otherReason.trim().length > 0)))
    && !updateStatus.isPending;

  function handleSubmit() {
    // Only acknowledge-level gates need explicit override + reason.
    // warn-level gates surface in the modal but are non-fatal — no override.
    const overrideGates = acknowledgeFails.map((g) => g.item_key);
    const overrideReason = needsAcknowledgment
      ? (reason === "other" ? `other: ${otherReason.trim()}` : reason)
      : undefined;

    updateStatus.mutate(
      {
        status: "completed",
        expected_current_status: currentStatus,
        override_gates: overrideGates.length > 0 ? overrideGates : undefined,
        override_reason: overrideReason,
      },
      {
        onSuccess: () => onClose(),
      },
    );
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Mark this job completed?"
      maxHeightPct={94}
      subtitle={
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-on-surface">{jobAddress}</span>
          <span>·</span>
          <span className="capitalize">{jobType.replace("_", "/")}</span>
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
            bg="var(--status-completed)"
          >
            {updateStatus.isPending ? "Working…" : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Mark Completed
              </>
            )}
          </SheetFooterButton>
        </>
      }
    >
      {/* Progress bar — shows gate completion status at a glance */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[11px] font-semibold text-on-surface-variant tracking-[0.06em] uppercase whitespace-nowrap">
            Closeout gates
          </span>
          <span className="font-[family-name:var(--font-geist-mono)] text-[11px] text-on-surface-variant whitespace-nowrap">
            {stats.passed} / {stats.total} · {stats.warn} warn · {stats.block} block
          </span>
        </div>
        <div className="flex gap-[3px] h-1">
          {gates.map((g, i) => (
            <div
              key={`${g.item_key}-${i}`}
              className="flex-1 rounded-sm"
              style={{ backgroundColor: gateBarColor(g.status) }}
            />
          ))}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-surface-container animate-pulse" />
          ))}
        </div>
      )}

      {/* Checklist rows */}
      {!isLoading && (
        <div className="mt-2">
          {gates.map((g) => (
            <CheckRow key={g.item_key} gate={g} />
          ))}
        </div>
      )}

      {/* Acknowledgment block — appears only when at least one ack-level gate failed */}
      {!isLoading && needsAcknowledgment && !hasHardBlock && (
        <div
          className="mt-3.5 rounded-xl p-3.5"
          style={{ backgroundColor: TOKEN.warnBg, border: `1px solid ${TOKEN.warnBorder}` }}
        >
          <div className="flex gap-2.5 items-start">
            <GateIcon kind="warn" />
            <div className="flex-1">
              <div className="text-[13px] font-bold" style={{ color: TOKEN.warnInk }}>
                {acknowledgeFails.length} item{acknowledgeFails.length === 1 ? "" : "s"} need{acknowledgeFails.length === 1 ? "s" : ""} acknowledgment
              </div>
              <div className="mt-1 text-[12px] leading-snug" style={{ color: TOKEN.warnInk }}>
                Pick a reason to close anyway. We&rsquo;ll log it to the job timeline.
              </div>
            </div>
          </div>

          <div className="mt-2.5 flex flex-col gap-1.5">
            {CLOSE_ANYWAY_REASONS.map((r) => {
              const sel = reason === r.value;
              return (
                <label
                  key={r.value}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition"
                  style={{
                    backgroundColor: sel ? TOKEN.warnBgSel : "var(--surface-container-lowest)",
                    border: `1px solid ${sel ? TOKEN.warnFg : TOKEN.warnBorder}`,
                    minHeight: 44,
                  }}
                >
                  <input
                    type="radio"
                    name="closeout-reason"
                    checked={sel}
                    onChange={() => setReason(r.value)}
                    style={{ accentColor: "var(--status-on-hold)", width: 18, height: 18 }}
                  />
                  <span
                    className={`text-[13px] ${sel ? "font-semibold" : "font-medium"}`}
                    style={{ color: TOKEN.ink }}
                  >
                    {r.label}
                  </span>
                </label>
              );
            })}
          </div>

          {reason === "other" && (
            <textarea
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
              rows={2}
              placeholder="Describe…"
              onFocus={(e) => e.target.select()}
              className="mt-2 w-full px-3 py-2.5 text-[14px] rounded-lg outline-none resize-none"
              style={{
                backgroundColor: "var(--surface-container-lowest)",
                border: `1px solid ${TOKEN.warnBorder}`,
                color: TOKEN.ink,
              }}
            />
          )}
        </div>
      )}

      {/* Hard-block helper — only shown for hard_block gates */}
      {!isLoading && hasHardBlock && (
        <div
          className="mt-3 rounded-xl p-3.5 flex gap-2.5 items-start"
          style={{ backgroundColor: TOKEN.blockBg, border: `1px solid ${TOKEN.blockBorder}` }}
        >
          <GateIcon kind="block" />
          <div className="flex-1">
            <div className="text-[13px] font-bold" style={{ color: TOKEN.blockInk }}>
              {hardBlocks.length === 1
                ? `${hardBlocks[0].label} required`
                : `${hardBlocks.length} blocking items`}
            </div>
            <div className="mt-1 text-[12px] leading-snug" style={{ color: TOKEN.blockInk }}>
              {hardBlockHelperCopy(hardBlocks, jobId)}
            </div>
            <HardBlockAction gate={hardBlocks[0]} jobId={jobId} onClose={onClose} />
          </div>
        </div>
      )}

      {/* Mutation error */}
      {updateStatus.isError && (
        <div
          className="mt-3 rounded-xl p-3 text-[13px]"
          style={{
            backgroundColor: TOKEN.blockBg,
            border: `1px solid ${TOKEN.blockBorder}`,
            color: TOKEN.blockInk,
          }}
        >
          <div className="font-semibold">Couldn&rsquo;t mark completed</div>
          <div className="mt-1">
            {updateStatus.error instanceof Error
              ? updateStatus.error.message
              : "Something went wrong. Try again."}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

function gateKind(status: CloseoutGate["status"]): "ok" | "warn" | "block" {
  switch (status) {
    case "ok":          return "ok";
    case "warn":
    case "acknowledge": return "warn";
    case "hard_block":  return "block";
  }
}

function CheckRow({ gate }: { gate: CloseoutGate }) {
  const kind = gateKind(gate.status);
  return (
    <div className="flex items-start gap-3 py-3 border-b border-outline-variant/40 last:border-b-0">
      <GateIcon kind={kind} />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-on-surface leading-tight">{gate.label}</div>
        {gate.detail && (
          <div className="text-[12px] text-on-surface-variant mt-0.5 leading-snug">{gate.detail}</div>
        )}
      </div>
    </div>
  );
}

function GateIcon({ kind }: { kind: "ok" | "warn" | "block" }) {
  if (kind === "ok") {
    return (
      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: TOKEN.okBg }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke={TOKEN.okFg} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (kind === "warn") {
    return (
      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: TOKEN.warnBg }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 4l9.5 16.5h-19L12 4z" stroke={TOKEN.warnFg} strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 10v4" stroke={TOKEN.warnFg} strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="17" r="1" fill={TOKEN.warnFg} />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: TOKEN.blockBg }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke={TOKEN.blockFg} strokeWidth="2" />
        <path d="M5.5 5.5l13 13" stroke={TOKEN.blockFg} strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

const GATE_KIND_TOKEN: Record<"ok" | "warn" | "block", string> = {
  ok:    "var(--status-completed)",
  warn:  "var(--status-on-hold)",
  block: "var(--status-cancelled)",
};

function gateBarColor(status: CloseoutGate["status"]): string {
  return GATE_KIND_TOKEN[gateKind(status)];
}

/* ------------------------------------------------------------------ */
/*  Hard-block deep-link helpers                                       */
/*                                                                     */
/*  Map gate item_key → (label, route) so the helper offers a real     */
/*  next step instead of a dead "Resolve" CTA. Routes that don't yet   */
/*  exist fall back to a soft message — see hardBlockHelperCopy().     */
/* ------------------------------------------------------------------ */

interface DeepLink {
  label: string;
  /** Path to navigate to. Relative to the app root. */
  href: string;
}

function deepLinkForGate(itemKey: string, jobId: string): DeepLink | null {
  switch (itemKey) {
    case "certificate_generated":
      // Cert generation route doesn't exist yet (CREW-25). The /report
      // page is the closest surface — the user gets there, sees the
      // scope, and can ship the cert from a future button there.
      // TODO(CREW-25): replace with /jobs/{id}/reports/certificate when
      // the dedicated cert UI lands.
      return { label: "Open scope report", href: `/jobs/${jobId}/report` };
    case "scope_finalized":
      return { label: "Open scope report", href: `/jobs/${jobId}/report` };
    case "moisture_per_room":
    case "all_rooms_dry_standard":
      return { label: "Add room readings", href: `/jobs/${jobId}/readings` };
    case "all_equipment_pulled":
      // Equipment lives inside readings (atmospheric + per-reading dehus).
      return { label: "Update equipment", href: `/jobs/${jobId}/readings` };
    case "photos_final_after":
      return { label: "Tag final photos", href: `/jobs/${jobId}/photos` };
    case "contract_signed":
      // No dedicated contract UI yet — job detail's "Job Info" is the closest.
      return { label: "Open job details", href: `/jobs/${jobId}` };
    default:
      return null;
  }
}

function hardBlockHelperCopy(blocks: CloseoutGate[], jobId: string): string {
  if (blocks.length > 1) {
    return "Resolve the blocked items above, then try again.";
  }
  const link = deepLinkForGate(blocks[0].item_key, jobId);
  if (link) return "This is a hard block. Resolve it below before marking the job completed.";
  return "Resolve the blocked items above, then try again.";
}

function HardBlockAction({
  gate,
  jobId,
  onClose,
}: {
  gate: CloseoutGate;
  jobId: string;
  onClose: () => void;
}) {
  const link = deepLinkForGate(gate.item_key, jobId);
  if (!link) return null;
  return (
    <Link
      href={link.href}
      onClick={onClose}
      className="mt-2.5 h-10 px-3.5 rounded-lg text-[13px] font-bold inline-flex items-center gap-1.5 active:scale-[0.98] transition no-underline"
      style={{
        backgroundColor: "var(--status-cancelled)",
        color: "#fff",
        border: "none",
      }}
    >
      {link.label}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12h14m0 0l-5-5m5 5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

function countGates(gates: CloseoutGate[]) {
  let passed = 0, warn = 0, block = 0;
  for (const g of gates) {
    const k = gateKind(g.status);
    if (k === "ok") passed++;
    else if (k === "warn") warn++;
    else block++;
  }
  return { total: gates.length, passed, warn, block };
}
