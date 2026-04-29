/**
 * Step 1A — Quick Add Active Jobs (optional sidetrack from Step 1).
 *
 * Up to 10 jobs in one batch. Each row is collapsible-style — every field
 * inline. Backend `POST /v1/jobs/batch` is atomic: one bad row = full
 * rollback, so we validate hard client-side before sending.
 *
 * Job-status dropdown shows the 3 entry-points into the 01K lifecycle
 * (Lead / Active / Invoiced) — backend `_normalize_batch_status` maps
 * the friendly label to the snake_case enum.
 *
 * This component is mode-agnostic: it can render as a modal-style
 * sub-screen (during onboarding) or as a full settings page
 * (`/settings/jobs/import`). The wrapper supplies the cancel/done labels.
 */
"use client";

import { useState, useMemo } from "react";
import FormField from "@/components/forms/FormField";
import {
  AddressAutocomplete,
  type AddressParts,
} from "@/components/address-autocomplete";
import {
  PrimaryButton,
  SecondaryButton,
  SelectField,
  US_STATE_OPTIONS,
} from "../components/UiBits";
import {
  validateQuickJob,
  type QuickJobErrors,
  type QuickJobFields,
} from "../lib/validators";
import {
  batchCreateJobs,
  jobTypeChoiceToBackend,
  type JobStatusChoice,
  type JobTypeChoice,
  type QuickJobRow,
} from "@/lib/onboarding-api";

const JOB_TYPE_OPTIONS: { value: JobTypeChoice; label: string }[] = [
  { value: "Water Damage", label: "Water Damage" },
  { value: "Fire Damage", label: "Fire Damage" },
  { value: "Mold Remediation", label: "Mold Remediation" },
  { value: "Reconstruction", label: "Reconstruction" },
];

// Spec 01K — Lead/Active/Invoiced map to the 9-status lifecycle's
// "stages of the job in our world right now": Lead = haven't started,
// Active = currently working it, Invoiced = bill is out, payment pending.
// Backend `_normalize_batch_status` rejects any other values.
const JOB_STATUS_OPTIONS: { value: JobStatusChoice; label: string }[] = [
  { value: "Lead", label: "Lead" },
  { value: "Active", label: "Active" },
  { value: "Invoiced", label: "Invoiced" },
];

const MAX_ROWS = 10;

type RowState = QuickJobFields & {
  job_type: JobTypeChoice;
  status: JobStatusChoice;
  /** Track which fields the user has touched for soft validation. */
  touched: Partial<Record<keyof QuickJobFields, boolean>>;
};

function blankRow(): RowState {
  return {
    address_line1: "",
    city: "",
    state: "",
    zip: "",
    customer_name: "",
    customer_phone: "",
    job_type: "Water Damage",
    status: "Lead",
    touched: {},
  };
}

type Props = {
  /** Header copy. Modal context shows different label than settings page. */
  heading?: string;
  subheading?: string;
  /** Label for the "back/cancel" button. */
  cancelLabel?: string;
  /** Label for the submit button before the count is known. */
  submitVerb?: string;
  /** Called on user-initiated cancel (back button etc.). */
  onCancel: () => void;
  /** Called after `POST /v1/jobs/batch` succeeds. Args: number imported. */
  onImported: (count: number) => void;
};

export default function QuickAddJobsScreen({
  heading = "Quick Add Active Jobs",
  subheading = "Have jobs already in progress? Add up to 10 in one batch — you can refine details later.",
  cancelLabel = "Cancel",
  submitVerb = "Import",
  onCancel,
  onImported,
}: Props) {
  const [rows, setRows] = useState<RowState[]>([blankRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const errors = useMemo<QuickJobErrors[]>(
    () => rows.map((r) => validateQuickJob(r)),
    [rows],
  );
  const allRowsValid =
    rows.length > 0 && errors.every((e) => Object.keys(e).length === 0);

  function updateRow<K extends keyof RowState>(
    index: number,
    key: K,
    value: RowState[K],
  ) {
    setRows((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [key]: value };
      return copy;
    });
  }

  function markTouched(index: number, key: keyof QuickJobFields) {
    setRows((prev) => {
      const copy = [...prev];
      const r = copy[index];
      copy[index] = { ...r, touched: { ...r.touched, [key]: true } };
      return copy;
    });
  }

  function handleAddressSelect(index: number, parts: AddressParts) {
    setRows((prev) => {
      const copy = [...prev];
      const r = copy[index];
      copy[index] = {
        ...r,
        address_line1: parts.address_line1,
        city: parts.city || r.city,
        state: parts.state || r.state,
        zip: parts.zip || r.zip,
        touched: {
          ...r.touched,
          address_line1: true,
          city: true,
          state: true,
          zip: true,
        },
      };
      return copy;
    });
  }

  function addRow() {
    // Guard inside the functional setState so rapid clicks (or anything
    // that batches multiple addRow calls in the same render) honor the
    // cap. Reading `rows.length` from closure was letting fast clicks
    // exceed MAX_ROWS — caught during /qa-refine-loop.
    setRows((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, blankRow()]));
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit() {
    // Mark every field touched so missing-field errors surface.
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        touched: {
          address_line1: true,
          city: true,
          state: true,
          zip: true,
          customer_name: true,
          customer_phone: true,
        },
      })),
    );
    setSubmitError(null);
    if (!allRowsValid || submitting) return;

    const payload: QuickJobRow[] = rows.map((r) => {
      const mapped = jobTypeChoiceToBackend(r.job_type);
      return {
        address_line1: r.address_line1.trim(),
        city: r.city.trim(),
        state: r.state.trim().toUpperCase(),
        zip: r.zip.trim(),
        customer_name: r.customer_name.trim(),
        customer_phone: r.customer_phone.trim(),
        loss_type: mapped.loss_type,
        job_type: mapped.job_type,
        status: r.status,
      };
    });

    setSubmitting(true);
    try {
      await batchCreateJobs(payload);
      onImported(payload.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to import jobs.";
      setSubmitError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] sm:text-[26px] font-bold leading-tight" style={{ color: "#1f1b17" }}>
          {heading}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "#594139" }}>
          {subheading}
        </p>
      </div>

      <div className="space-y-4">
        {rows.map((row, idx) => {
          const rowErrors = errors[idx];
          return (
            <div
              key={idx}
              className="rounded-xl border p-4 sm:p-5 space-y-4"
              style={{ borderColor: "#e1bfb4", backgroundColor: "#fffaf6" }}
            >
              <div className="flex items-center justify-between gap-2">
                <p
                  className="text-[11px] font-semibold uppercase tracking-[0.12em] font-[family-name:var(--font-geist-mono)]"
                  style={{ color: "#a63500" }}
                >
                  Job {idx + 1}
                </p>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="text-[12px] font-medium text-red-600 hover:text-red-700 transition-colors"
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              <div className="flex flex-col">
                <label
                  htmlFor={`quick-add-address-${idx}`}
                  className="block text-[11px] font-semibold tracking-[0.1em] uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]"
                >
                  Address
                  <span aria-hidden className="ml-1 text-red-500">*</span>
                </label>
                <AddressAutocomplete
                  value={row.address_line1}
                  onChange={(v) => updateRow(idx, "address_line1", v)}
                  onSelect={(parts) => handleAddressSelect(idx, parts)}
                  placeholder="Start typing the property address..."
                  className={[
                    "w-full h-12 px-4 rounded-lg text-on-surface text-[15px]",
                    "placeholder:text-outline outline-none transition-all duration-200",
                    "bg-surface-container-low focus:bg-surface-container-lowest",
                    row.touched.address_line1 && rowErrors.address_line1
                      ? "ring-2 ring-red-400/60 focus:ring-red-500/70"
                      : "focus:ring-2 focus:ring-primary/20",
                  ].join(" ")}
                />
                {row.touched.address_line1 && rowErrors.address_line1 ? (
                  <p role="alert" className="mt-1.5 text-[12px] leading-snug text-red-600">
                    {rowErrors.address_line1}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-[1fr_140px_120px] gap-3">
                <FormField
                  label="City"
                  required
                  autoComplete="address-level2"
                  value={row.city}
                  onChange={(e) => updateRow(idx, "city", e.target.value)}
                  onBlur={() => markTouched(idx, "city")}
                  placeholder="Detroit"
                  error={row.touched.city ? rowErrors.city : undefined}
                />
                <SelectField
                  label="State"
                  required
                  value={row.state}
                  onChange={(e) => {
                    updateRow(idx, "state", e.target.value);
                    markTouched(idx, "state");
                  }}
                  placeholder="Select"
                  options={US_STATE_OPTIONS}
                  error={row.touched.state ? rowErrors.state : undefined}
                />
                <FormField
                  label="ZIP"
                  required
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={row.zip}
                  onChange={(e) => updateRow(idx, "zip", e.target.value)}
                  onBlur={() => markTouched(idx, "zip")}
                  placeholder="48089"
                  className="col-span-2 sm:col-span-1"
                  error={row.touched.zip ? rowErrors.zip : undefined}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField
                  label="Customer Name"
                  required
                  value={row.customer_name}
                  onChange={(e) => updateRow(idx, "customer_name", e.target.value)}
                  onBlur={() => markTouched(idx, "customer_name")}
                  placeholder="Jane Doe"
                  error={row.touched.customer_name ? rowErrors.customer_name : undefined}
                />
                <FormField
                  label="Customer Phone"
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={row.customer_phone}
                  onChange={(e) => updateRow(idx, "customer_phone", e.target.value)}
                  onBlur={() => markTouched(idx, "customer_phone")}
                  placeholder="(555) 555-1212"
                  error={row.touched.customer_phone ? rowErrors.customer_phone : undefined}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SelectField
                  label="Job Type"
                  required
                  value={row.job_type}
                  onChange={(e) =>
                    updateRow(idx, "job_type", e.target.value as JobTypeChoice)
                  }
                  options={JOB_TYPE_OPTIONS}
                />
                <SelectField
                  label="Status"
                  required
                  value={row.status}
                  onChange={(e) =>
                    updateRow(idx, "status", e.target.value as JobStatusChoice)
                  }
                  options={JOB_STATUS_OPTIONS}
                />
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= MAX_ROWS}
          className="w-full rounded-xl border border-dashed py-3 text-[13px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-container-low/40"
          style={{
            borderColor: "#e1bfb4",
            color: rows.length >= MAX_ROWS ? "#8d7168" : "#a63500",
          }}
        >
          {rows.length >= MAX_ROWS
            ? "Maximum 10 jobs per import"
            : `+ Add Another Job  (${rows.length} of ${MAX_ROWS})`}
        </button>
      </div>

      {submitError ? (
        <p role="alert" className="text-sm text-red-600">{submitError}</p>
      ) : null}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <SecondaryButton type="button" onClick={onCancel} disabled={submitting}>
          {cancelLabel}
        </SecondaryButton>
        <PrimaryButton
          type="button"
          onClick={handleSubmit}
          loading={submitting}
          disabled={submitting || !allRowsValid}
        >
          {submitting
            ? "Importing…"
            : `${submitVerb} ${rows.length} ${rows.length === 1 ? "Job" : "Jobs"}`}
        </PrimaryButton>
      </div>
    </div>
  );
}
