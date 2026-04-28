/**
 * Step 2 of 3 — Pricing Upload (optional).
 *
 * Drag-and-drop xlsx zone + template download. The picked `File` object
 * lives in component state so [Try Again] / [Retry] can re-submit without
 * forcing the user to browse for the same file again (Brett's edge case
 * E2 + advisor pitfall #3).
 *
 * On success: ✓ + count + Continue. On row-level validation failure:
 * scrollable error list (cap 50, expandable) + [Download Error Report] +
 * [Try Again]. On network failure: retry banner with the file still
 * selected.
 */
"use client";

import { useRef, useState, type DragEvent } from "react";
import {
  PrimaryButton,
  SecondaryButton,
} from "../components/UiBits";
import { isXlsxFile } from "../lib/validators";
import {
  downloadPricingErrorReport,
  downloadPricingTemplate,
  setOnboardingStep,
  uploadPricing,
  type PricingUploadError,
  type PricingUploadResult,
} from "@/lib/onboarding-api";

const MAX_VISIBLE_ERRORS = 50;

type Phase =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "success"; result: PricingUploadResult }
  | { kind: "row_errors"; result: PricingUploadResult }
  | { kind: "network_error"; message: string };

type Props = {
  /** Show the "Welcome back!" banner above the screen (resume case). */
  showWelcomeBack?: boolean;
  /** Show the wizard "Skip for Now" button (false on settings page). */
  allowSkip?: boolean;
  /** Show the wizard back button (false on settings page). */
  showBack?: boolean;
  onBack?: () => void;
  /** Called when the user finishes (skip or successful upload + continue). */
  onContinue: () => void;
  /** Continue button label — wizard says "Continue", settings says "Done". */
  continueLabel?: string;
  /**
   * When true (wizard mode), advance the user's onboarding_step on
   * skip/continue. When false (settings recovery), skip the PATCH —
   * a `'complete'` user calling PATCH 'first_job' would 400 on the
   * backend's forward-only check.
   */
  advanceOnboardingOnExit?: boolean;
};

export default function PricingUploadScreen({
  showWelcomeBack,
  allowSkip = true,
  showBack = false,
  onBack,
  onContinue,
  continueLabel = "Continue",
  advanceOnboardingOnExit = true,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [pickerKey, setPickerKey] = useState(0); // remount the input on reset
  const [dragActive, setDragActive] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile() {
    inputRef.current?.click();
  }

  function setSelectedFile(next: File | null) {
    setFile(next);
    setPhase({ kind: "idle" });
    setShowAllErrors(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (!isXlsxFile(f)) {
      setPhase({ kind: "network_error", message: "Please select a .xlsx file." });
      return;
    }
    setSelectedFile(f);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    if (!f) return;
    if (!isXlsxFile(f)) {
      setPhase({ kind: "network_error", message: "Please drop a .xlsx file." });
      return;
    }
    setSelectedFile(f);
  }

  async function handleUpload() {
    if (!file) return;
    setPhase({ kind: "validating" });
    setShowAllErrors(false);
    try {
      const result = await uploadPricing(file);
      if (result.errors && result.errors.length > 0) {
        setPhase({ kind: "row_errors", result });
      } else {
        setPhase({ kind: "success", result });
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Upload failed. Please check your connection and try again.";
      setPhase({ kind: "network_error", message });
    }
  }

  async function handleSkip() {
    setSkipping(true);
    try {
      if (advanceOnboardingOnExit) {
        await setOnboardingStep("first_job");
      }
      onContinue();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't advance step.";
      setPhase({ kind: "network_error", message: msg });
      setSkipping(false);
    }
  }

  async function handleSuccessContinue() {
    setContinuing(true);
    try {
      if (advanceOnboardingOnExit) {
        await setOnboardingStep("first_job");
      }
      onContinue();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't advance step.";
      setPhase({ kind: "network_error", message: msg });
      setContinuing(false);
    }
  }

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    try {
      await downloadPricingTemplate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't download template.";
      setPhase({ kind: "network_error", message: msg });
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleDownloadReport(runId: string) {
    setDownloadingReport(true);
    try {
      await downloadPricingErrorReport(runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't download error report.";
      setPhase({ kind: "network_error", message: msg });
    } finally {
      setDownloadingReport(false);
    }
  }

  function handleTryAgain() {
    // Keep the file in state. Force the hidden <input> to remount so the
    // user could optionally pick a different file, but don't clear our File.
    setPickerKey((k) => k + 1);
    setPhase({ kind: "idle" });
    setShowAllErrors(false);
  }

  function handleClearFile() {
    setFile(null);
    setPickerKey((k) => k + 1);
    setPhase({ kind: "idle" });
    setShowAllErrors(false);
  }

  return (
    <div className="space-y-6">
      {showWelcomeBack ? (
        <div
          role="status"
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "#fbcab5", backgroundColor: "#fff4ed", color: "#7a2c0b" }}
        >
          <p className="font-semibold leading-snug">Welcome back!</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-on-surface-variant">
            Let&apos;s finish setting up your account.
          </p>
        </div>
      ) : null}

      <div>
        <h1
          className="text-[26px] sm:text-[28px] font-bold leading-tight"
          style={{ color: "#1f1b17" }}
        >
          Drop your prices in once. Save 2-4 hours per job.
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "#594139" }}>
          Upload your Xactimate spreadsheet now — Photo Scope (shipping
          next) auto-applies these to every generated line item. Optional;
          you can do this later from Settings.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className="rounded-2xl border-2 border-dashed transition-colors px-6 py-10 text-center cursor-pointer"
        style={{
          borderColor: dragActive ? "#e85d26" : "#e1bfb4",
          backgroundColor: dragActive ? "#fff4ed" : "#fffaf6",
        }}
        onClick={pickFile}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") pickFile();
        }}
      >
        <UploadCloudIcon />
        {file ? (
          <div className="mt-3">
            <p className="text-[14px] font-semibold text-on-surface">{file.name}</p>
            <p className="mt-0.5 text-[12px] text-on-surface-variant">
              {(file.size / 1024).toFixed(0)} KB selected
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClearFile();
              }}
              className="mt-2 text-[12px] font-medium underline underline-offset-2 hover:opacity-80"
              style={{ color: "#e85d26" }}
            >
              Clear
            </button>
          </div>
        ) : (
          <>
            <p className="mt-3 text-[14px] font-semibold text-on-surface">
              Drop your .xlsx here, or click to browse
            </p>
            <p className="mt-1 text-[12px] text-on-surface-variant">
              We support Tier A / B / C Xactimate exports.
            </p>
          </>
        )}
        <input
          key={pickerKey}
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleInputChange}
          className="hidden"
          aria-label="Select pricing spreadsheet"
        />
      </div>

      {/* Template download */}
      <p className="text-[13px] text-on-surface-variant">
        Don&apos;t have your pricing ready?{" "}
        <button
          type="button"
          onClick={handleDownloadTemplate}
          disabled={downloadingTemplate}
          className="font-medium underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
          style={{ color: "#e85d26" }}
        >
          {downloadingTemplate ? "Preparing…" : "Download Pricing Template"}
        </button>
      </p>

      {/* Phase-specific UI */}
      {phase.kind === "validating" ? (
        <ValidationBanner kind="info">
          <span className="inline-block w-4 h-4 border-2 border-on-surface/30 border-t-[#e85d26] rounded-full animate-spin" />
          <span>Validating your spreadsheet…</span>
        </ValidationBanner>
      ) : null}

      {phase.kind === "success" ? (
        <ValidationBanner kind="success">
          <CheckIcon />
          <span>
            Loaded <strong>{phase.result.items_loaded}</strong> line items from
            Tier {phase.result.tier}.
          </span>
        </ValidationBanner>
      ) : null}

      {phase.kind === "row_errors" ? (
        <div
          role="alert"
          className="rounded-xl border p-4 space-y-3"
          style={{ borderColor: "#f8bdb1", backgroundColor: "#fff4ed" }}
        >
          <div className="flex items-start gap-2">
            <CrossIcon />
            <div>
              <p className="text-[14px] font-semibold" style={{ color: "#7a2c0b" }}>
                We found {phase.result.errors.length} issue{phase.result.errors.length === 1 ? "" : "s"} in your spreadsheet.
              </p>
              <p className="mt-0.5 text-[12px]" style={{ color: "#594139" }}>
                Fix the rows below and try again, or download the full report.
              </p>
            </div>
          </div>
          <ErrorList
            errors={phase.result.errors}
            showAll={showAllErrors}
            onShowAll={() => setShowAllErrors(true)}
          />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {phase.result.run_id ? (
              <SecondaryButton
                type="button"
                onClick={() => handleDownloadReport(phase.result.run_id!)}
                disabled={downloadingReport}
              >
                {downloadingReport ? "Preparing…" : "Download Error Report"}
              </SecondaryButton>
            ) : null}
            <SecondaryButton type="button" onClick={handleTryAgain}>
              Try Again
            </SecondaryButton>
          </div>
        </div>
      ) : null}

      {phase.kind === "network_error" ? (
        <div
          role="alert"
          className="rounded-xl border p-4 flex flex-wrap items-center gap-3"
          style={{ borderColor: "#f8bdb1", backgroundColor: "#fff4ed" }}
        >
          <p className="text-[13px] flex-1 min-w-[200px]" style={{ color: "#7a2c0b" }}>
            {phase.message}
          </p>
          {file ? (
            <SecondaryButton type="button" onClick={handleUpload}>
              Retry
            </SecondaryButton>
          ) : null}
        </div>
      ) : null}

      {/* Action row */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          {showBack ? (
            <SecondaryButton type="button" onClick={onBack} disabled={skipping || continuing}>
              &larr; Back
            </SecondaryButton>
          ) : null}
          {allowSkip ? (
            <SecondaryButton
              type="button"
              onClick={handleSkip}
              disabled={skipping || continuing || phase.kind === "validating"}
            >
              {skipping ? "Skipping…" : "Skip for Now"}
            </SecondaryButton>
          ) : null}
        </div>

        {phase.kind === "success" ? (
          <PrimaryButton type="button" loading={continuing} onClick={handleSuccessContinue}>
            {continueLabel}
            <span aria-hidden className="text-[16px]">&rarr;</span>
          </PrimaryButton>
        ) : (
          <PrimaryButton
            type="button"
            onClick={handleUpload}
            disabled={!file || phase.kind === "validating" || skipping}
            loading={phase.kind === "validating"}
          >
            Upload Pricing
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function ValidationBanner({
  kind,
  children,
}: {
  kind: "info" | "success";
  children: React.ReactNode;
}) {
  const colors =
    kind === "success"
      ? { border: "#bbe6c7", bg: "#f0fbf3", text: "#15512c" }
      : { border: "#e1bfb4", bg: "#fffaf6", text: "#594139" };
  return (
    <div
      role={kind === "success" ? "status" : undefined}
      className="rounded-xl border px-4 py-3 flex items-center gap-2.5 text-[14px]"
      style={{ borderColor: colors.border, backgroundColor: colors.bg, color: colors.text }}
    >
      {children}
    </div>
  );
}

function ErrorList({
  errors,
  showAll,
  onShowAll,
}: {
  errors: PricingUploadError[];
  showAll: boolean;
  onShowAll: () => void;
}) {
  const visible = showAll ? errors : errors.slice(0, MAX_VISIBLE_ERRORS);
  return (
    <div className="rounded-lg bg-white border max-h-72 overflow-y-auto" style={{ borderColor: "#e1bfb4" }}>
      <ul className="divide-y" style={{ borderColor: "#f0d6c5" }}>
        {visible.map((err, i) => (
          <li key={i} className="px-3 py-2 text-[12px] leading-snug">
            <span
              className="font-semibold font-[family-name:var(--font-geist-mono)] mr-2"
              style={{ color: "#a63500" }}
            >
              Row {err.row}
            </span>
            {err.field ? (
              <span className="text-on-surface-variant">({err.field}) </span>
            ) : null}
            <span className="text-on-surface">{err.message}</span>
          </li>
        ))}
      </ul>
      {!showAll && errors.length > MAX_VISIBLE_ERRORS ? (
        <button
          type="button"
          onClick={onShowAll}
          className="block w-full px-3 py-2 text-[12px] font-medium border-t hover:bg-surface-container-low/40 transition-colors"
          style={{ borderColor: "#f0d6c5", color: "#a63500" }}
        >
          Show all {errors.length} errors
        </button>
      ) : null}
    </div>
  );
}

function UploadCloudIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="mx-auto"
    >
      <path
        d="M16 16l-4-4-4 4M12 12v9"
        stroke="#a63500"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"
        stroke="#a63500"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="10" fill="#15512c" fillOpacity="0.12" />
      <path
        d="M8 12.5l3 3 5-6"
        stroke="#15512c"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="10" fill="#7a2c0b" fillOpacity="0.12" />
      <path
        d="M9 9l6 6M15 9l-6 6"
        stroke="#7a2c0b"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
