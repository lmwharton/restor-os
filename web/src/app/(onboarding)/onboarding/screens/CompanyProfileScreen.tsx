/**
 * Step 1 of 3 — Company Profile.
 *
 * This is the first REQUIRED step and the only one that creates the
 * `companies`/`users` rows (Decision Log #2: Screen 2 is the CREATE step).
 * One atomic `POST /v1/company` call. Backend's RPC handles the advisory
 * lock + onboarding-step bump to `'jobs_import'`. We do NOT issue a
 * follow-up PATCH /v1/me/onboarding-step here (advisor pitfall #2).
 *
 * Optional sidetrack: if the user has active jobs already, they can pop a
 * Quick-Add modal from inline link below the form.
 */
"use client";

import { useMemo, useState, type FormEvent } from "react";
import FormField from "@/components/forms/FormField";
import {
  PrimaryButton,
  SelectField,
  US_STATE_OPTIONS,
} from "../components/UiBits";
import {
  validateCompanyProfile,
  type CompanyProfileFields,
} from "../lib/validators";
import { createCompany, type CompanyCreatePayload } from "@/lib/onboarding-api";

const SERVICE_AREA_OPTIONS = [
  "Warren/Macomb County",
  "Oakland County",
  "Wayne County",
];

type Props = {
  /** Show the "Welcome back!" banner above the form (resume case). */
  showWelcomeBack?: boolean;
  /** Called after successful POST /v1/company. */
  onCreated: () => void;
  /** Called when the "Have active jobs in progress?" link is clicked. */
  onOpenQuickAdd: () => void;
};

export default function CompanyProfileScreen({
  showWelcomeBack,
  onCreated,
  onOpenQuickAdd,
}: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [serviceArea, setServiceArea] = useState<string[]>([]);
  const [otherChecked, setOtherChecked] = useState(false);
  const [otherText, setOtherText] = useState("");

  const [touched, setTouched] = useState<Record<keyof CompanyProfileFields, boolean>>({
    name: false,
    phone: false,
    address: false,
    city: false,
    state: false,
    zip: false,
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fields: CompanyProfileFields = { name, phone, address, city, state, zip };
  // `fields` is rebuilt each render — depend on its primitives so the
  // memo refreshes on the actual inputs, not on the object identity.
  const errors = useMemo(
    () => validateCompanyProfile(fields),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, phone, address, city, state, zip],
  );
  const isValid = Object.keys(errors).length === 0;

  function markTouched(key: keyof CompanyProfileFields) {
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }

  function toggleArea(area: string) {
    setServiceArea((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area],
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched({ name: true, phone: true, address: true, city: true, state: true, zip: true });
    setSubmitError(null);
    if (!isValid || submitting) return;

    const finalAreas = [...serviceArea];
    if (otherChecked && otherText.trim()) finalAreas.push(otherText.trim());

    const payload: CompanyCreatePayload = {
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim().toUpperCase(),
      zip: zip.trim(),
      service_area: finalAreas.length > 0 ? finalAreas : undefined,
    };

    setSubmitting(true);
    try {
      await createCompany(payload);
      onCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create company.";
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
            Let&apos;s finish setting up your account.
          </p>
        </div>
      ) : null}

      <div>
        <h1 className="text-[26px] sm:text-[28px] font-bold leading-tight" style={{ color: "#1f1b17" }}>
          Tell us about your company
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "#594139" }}>
          We use this to brand your reports and route your team to jobs.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <FormField
          label="Company Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => markTouched("name")}
          placeholder="Restoration Pro Services"
          error={touched.name ? errors.name : undefined}
        />

        <FormField
          label="Phone Number"
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => markTouched("phone")}
          placeholder="(555) 123-4567"
          error={touched.phone ? errors.phone : undefined}
        />

        <FormField
          label="Business Address"
          required
          autoComplete="street-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onBlur={() => markTouched("address")}
          placeholder="123 Main Street"
          error={touched.address ? errors.address : undefined}
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
            autoComplete="address-level1"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              markTouched("state");
            }}
            onBlur={() => markTouched("state")}
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

        <fieldset className="space-y-2">
          <legend className="block text-[11px] font-semibold tracking-[0.1em] uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
            Service Area{" "}
            <span className="ml-0.5 text-outline font-normal normal-case tracking-normal">
              (optional)
            </span>
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SERVICE_AREA_OPTIONS.map((area) => {
              const checked = serviceArea.includes(area);
              return (
                <label
                  key={area}
                  className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer hover:bg-surface-container-low/50 transition-colors"
                  style={{
                    borderColor: checked ? "#e85d26" : "#e1bfb4",
                    backgroundColor: checked ? "#fff4ed" : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleArea(area)}
                    className="h-4 w-4 cursor-pointer rounded border-outline-variant accent-[#e85d26]"
                  />
                  <span className="text-[13px] text-on-surface">{area}</span>
                </label>
              );
            })}
            <label
              className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer hover:bg-surface-container-low/50 transition-colors sm:col-span-2"
              style={{
                borderColor: otherChecked ? "#e85d26" : "#e1bfb4",
                backgroundColor: otherChecked ? "#fff4ed" : undefined,
              }}
            >
              <input
                type="checkbox"
                checked={otherChecked}
                onChange={(e) => setOtherChecked(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-outline-variant accent-[#e85d26]"
              />
              <span className="text-[13px] text-on-surface shrink-0">Other</span>
              {otherChecked ? (
                <input
                  type="text"
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="e.g. St. Clair County"
                  className="flex-1 h-8 px-2 rounded-md text-[13px] outline-none bg-white border border-outline-variant focus:ring-2 focus:ring-primary/20"
                />
              ) : null}
            </label>
          </div>
        </fieldset>

        {submitError ? (
          <p role="alert" className="text-sm text-red-600">{submitError}</p>
        ) : null}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={onOpenQuickAdd}
            className="text-left text-[13px] font-medium underline underline-offset-2 transition-colors hover:opacity-80"
            style={{ color: "#e85d26" }}
          >
            Have active jobs in progress? Add them now &rarr;
          </button>
          <PrimaryButton type="submit" loading={submitting} disabled={!isValid || submitting}>
            Continue
            <span aria-hidden className="text-[16px]">&rarr;</span>
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}
