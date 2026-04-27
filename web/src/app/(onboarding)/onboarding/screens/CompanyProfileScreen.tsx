/**
 * Step 1 of 3 — Company Profile.
 *
 * This is the first REQUIRED step and the only one that creates the
 * `companies`/`users` rows (Decision Log #2: Screen 2 is the CREATE step).
 * One atomic `POST /v1/company` call. Backend's RPC handles the advisory
 * lock. The screen does NOT issue the PATCH /v1/me/onboarding-step here —
 * that's the wizard's `handleCompanyCreated` after `onCreated()`, which
 * surfaces any failure inline rather than silently advancing.
 *
 * Optional sidetrack: if the user has active jobs already, they can pop a
 * Quick-Add modal from inline link below the form.
 */
"use client";

import { useMemo, useState, type FormEvent } from "react";
import FormField from "@/components/forms/FormField";
import {
  AddressAutocomplete,
  type AddressParts,
} from "@/components/address-autocomplete";
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

type Props = {
  /** Show the "Welcome back!" banner above the form (resume case). */
  showWelcomeBack?: boolean;
  /** Called after successful POST /v1/company. Receives the entered company name so Welcome can personalize. */
  onCreated: (companyName: string) => void;
  /** Called when the "Have active jobs in progress?" link is clicked. */
  onOpenQuickAdd: () => void;
};

export default function CompanyProfileScreen({
  showWelcomeBack,
  onCreated,
  onOpenQuickAdd,
}: Props) {
  const [ownerName, setOwnerName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  // Service area was specced by Brett as an optional metadata field
  // intended to power future lead-gen features (route inbound damage
  // leads to contractors by county). No code path reads `service_area`
  // today, so collecting it during onboarding is noise. The DB column
  // (`companies.service_area TEXT[]`) stays — when lead-gen ships, the
  // wizard will get a proper county picker tied to a real outcome.

  const [touched, setTouched] = useState<Record<keyof CompanyProfileFields, boolean>>({
    ownerName: false,
    name: false,
    phone: false,
    address: false,
    city: false,
    state: false,
    zip: false,
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fields: CompanyProfileFields = {
    ownerName, name, phone, address, city, state, zip,
  };
  // `fields` is rebuilt each render — depend on its primitives so the
  // memo refreshes on the actual inputs, not on the object identity.
  const errors = useMemo(
    () => validateCompanyProfile(fields),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownerName, name, phone, address, city, state, zip],
  );
  const isValid = Object.keys(errors).length === 0;

  function markTouched(key: keyof CompanyProfileFields) {
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }

  function handleAddressSelect(parts: AddressParts) {
    // Google Places picks: street_number + route → address_line1, plus
    // locality, admin_area_level_1, postal_code. Auto-fill the dependent
    // fields so the user types one address and we get all four.
    setAddress(parts.address_line1);
    if (parts.city) setCity(parts.city);
    if (parts.state) setState(parts.state);
    if (parts.zip) setZip(parts.zip);
    // Mark them all touched so any stale errors clear on the next render.
    setTouched((prev) => ({
      ...prev,
      address: true,
      city: true,
      state: true,
      zip: true,
    }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched({
      ownerName: true,
      name: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      zip: true,
    });
    setSubmitError(null);
    if (!isValid || submitting) return;

    const payload: CompanyCreatePayload = {
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim().toUpperCase(),
      zip: zip.trim(),
      owner_name: ownerName.trim(),
      // service_area intentionally omitted — collected when lead-gen ships
    };

    setSubmitting(true);
    try {
      await createCompany(payload);
      onCreated(payload.name);
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
          label="Your Name"
          required
          autoComplete="name"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          onBlur={() => markTouched("ownerName")}
          placeholder="Brett Sodders"
          helper="Shown on reports and the team roster — you can change it later."
          error={touched.ownerName ? errors.ownerName : undefined}
        />

        <FormField
          label="Company Name"
          required
          autoComplete="organization"
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

        <div className="flex flex-col">
          <label
            htmlFor="company-address"
            className="block text-[11px] font-semibold tracking-[0.1em] uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]"
          >
            Business Address
            <span aria-hidden="true" className="ml-1 text-red-500">
              *
            </span>
          </label>
          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            onSelect={handleAddressSelect}
            placeholder="Start typing your business address..."
            className={[
              "w-full h-12 px-4 rounded-lg text-on-surface text-[15px]",
              "placeholder:text-outline outline-none transition-all duration-200",
              "bg-surface-container-low focus:bg-surface-container-lowest",
              touched.address && errors.address
                ? "ring-2 ring-red-400/60 focus:ring-red-500/70"
                : "focus:ring-2 focus:ring-primary/20",
            ].join(" ")}
          />
          {touched.address && errors.address ? (
            <p role="alert" className="mt-1.5 text-[12px] leading-snug text-red-600">
              {errors.address}
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] leading-snug text-on-surface-variant">
              Pick a suggestion to auto-fill city, state, and ZIP.
            </p>
          )}
        </div>

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
