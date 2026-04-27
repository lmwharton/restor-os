/**
 * Step 3 of 3 — Create Your First Job (optional).
 *
 * Simplified Spec 01F form: address, customer, phone, job-type radio. No
 * loss date, emergency, or notes — backend defaults the rest.
 *
 * Skip → PATCH onboarding-step to 'complete' → Welcome.
 * Create Job → POST /v1/jobs → PATCH onboarding-step to 'complete' → Welcome.
 */
"use client";

import { useMemo, useState } from "react";
import FormField from "@/components/forms/FormField";
import {
  PrimaryButton,
  SecondaryButton,
  SelectField,
  US_STATE_OPTIONS,
} from "../components/UiBits";
import { validateFirstJob, type FirstJobFields } from "../lib/validators";
import {
  createFirstJob,
  jobTypeChoiceToBackend,
  setOnboardingStep,
  type JobTypeChoice,
} from "@/lib/onboarding-api";

const JOB_TYPE_OPTIONS: { value: JobTypeChoice; label: string }[] = [
  { value: "Water Damage", label: "Water Damage" },
  { value: "Fire Damage", label: "Fire Damage" },
  { value: "Mold Remediation", label: "Mold Remediation" },
  { value: "Reconstruction", label: "Reconstruction" },
];

type Props = {
  showWelcomeBack?: boolean;
  /** Called after either skip or successful job creation. */
  onComplete: (createdAJob: boolean) => void;
  onBack?: () => void;
};

export default function FirstJobScreen({
  showWelcomeBack,
  onComplete,
  onBack,
}: Props) {
  const [address_line1, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [customer_name, setCustomerName] = useState("");
  const [customer_phone, setCustomerPhone] = useState("");
  const [jobType, setJobType] = useState<JobTypeChoice>("Water Damage");

  const [touched, setTouched] = useState<Record<keyof FirstJobFields, boolean>>({
    address_line1: false,
    city: false,
    state: false,
    zip: false,
    customer_name: false,
    customer_phone: false,
  });

  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fields: FirstJobFields = {
    address_line1, city, state, zip, customer_name, customer_phone,
  };
  // `fields` rebuilds each render — depend on its primitives.
  const errors = useMemo(
    () => validateFirstJob(fields),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address_line1, city, state, zip, customer_name, customer_phone],
  );
  const isValid = Object.keys(errors).length === 0;

  function markTouched(key: keyof FirstJobFields) {
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }

  async function handleSkip() {
    setSkipping(true);
    setSubmitError(null);
    try {
      await setOnboardingStep("complete");
      onComplete(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't finish setup.";
      setSubmitError(msg);
      setSkipping(false);
    }
  }

  async function handleCreate() {
    setTouched({
      address_line1: true, city: true, state: true, zip: true,
      customer_name: true, customer_phone: true,
    });
    if (!isValid || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const mapped = jobTypeChoiceToBackend(jobType);
      await createFirstJob({
        address_line1: address_line1.trim(),
        city: city.trim(),
        state: state.trim().toUpperCase(),
        zip: zip.trim(),
        customer_name: customer_name.trim(),
        customer_phone: customer_phone.trim(),
        loss_type: mapped.loss_type,
        job_type: mapped.job_type,
      });
      await setOnboardingStep("complete");
      onComplete(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create job.";
      setSubmitError(msg);
      setSubmitting(false);
    }
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
            One more step to finish your setup.
          </p>
        </div>
      ) : null}

      <div>
        <h1 className="text-[26px] sm:text-[28px] font-bold leading-tight" style={{ color: "#1f1b17" }}>
          Create your first job
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "#594139" }}>
          Add the basics — you can finish the rest from the job page.
        </p>
      </div>

      <div className="space-y-5">
        <FormField
          label="Property Address"
          required
          autoComplete="street-address"
          value={address_line1}
          onChange={(e) => setAddress(e.target.value)}
          onBlur={() => markTouched("address_line1")}
          placeholder="123 Main Street"
          error={touched.address_line1 ? errors.address_line1 : undefined}
        />

        <div className="grid grid-cols-2 sm:grid-cols-[1fr_140px_120px] gap-3">
          <FormField
            label="City"
            required
            autoComplete="address-level2"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onBlur={() => markTouched("city")}
            placeholder="Detroit"
            error={touched.city ? errors.city : undefined}
          />
          <SelectField
            label="State"
            required
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              markTouched("state");
            }}
            placeholder="Select"
            options={US_STATE_OPTIONS}
            error={touched.state ? errors.state : undefined}
          />
          <FormField
            label="ZIP"
            required
            inputMode="numeric"
            autoComplete="postal-code"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            onBlur={() => markTouched("zip")}
            placeholder="48089"
            className="col-span-2 sm:col-span-1"
            error={touched.zip ? errors.zip : undefined}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField
            label="Customer Name"
            required
            value={customer_name}
            onChange={(e) => setCustomerName(e.target.value)}
            onBlur={() => markTouched("customer_name")}
            placeholder="Jane Doe"
            error={touched.customer_name ? errors.customer_name : undefined}
          />
          <FormField
            label="Customer Phone"
            required
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={customer_phone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            onBlur={() => markTouched("customer_phone")}
            placeholder="(555) 555-1212"
            error={touched.customer_phone ? errors.customer_phone : undefined}
          />
        </div>

        <fieldset>
          <legend className="block text-[11px] font-semibold tracking-[0.1em] uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
            Job Type
            <span aria-hidden className="ml-1 text-red-500">*</span>
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {JOB_TYPE_OPTIONS.map((opt) => {
              const checked = jobType === opt.value;
              return (
                <label
                  key={opt.value}
                  className="flex items-center gap-2.5 rounded-lg border px-4 py-3 cursor-pointer hover:bg-surface-container-low/50 transition-colors"
                  style={{
                    borderColor: checked ? "#e85d26" : "#e1bfb4",
                    backgroundColor: checked ? "#fff4ed" : undefined,
                  }}
                >
                  <input
                    type="radio"
                    name="job_type"
                    value={opt.value}
                    checked={checked}
                    onChange={() => setJobType(opt.value)}
                    className="h-4 w-4 cursor-pointer accent-[#e85d26]"
                  />
                  <span className="text-[14px] font-medium text-on-surface">{opt.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      {submitError ? (
        <p role="alert" className="text-sm text-red-600">{submitError}</p>
      ) : null}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          {onBack ? (
            <SecondaryButton
              type="button"
              onClick={onBack}
              disabled={submitting || skipping}
            >
              &larr; Back
            </SecondaryButton>
          ) : null}
          <SecondaryButton
            type="button"
            onClick={handleSkip}
            disabled={submitting || skipping}
          >
            {skipping ? "Finishing…" : "Skip for Now"}
          </SecondaryButton>
        </div>
        <PrimaryButton
          type="button"
          onClick={handleCreate}
          loading={submitting}
          disabled={submitting || skipping}
        >
          Create Job
          <span aria-hidden className="text-[16px]">&rarr;</span>
        </PrimaryButton>
      </div>
    </div>
  );
}
