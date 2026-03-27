"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LossType, WaterCategory, WaterClass } from "@/lib/types";
import { useCreateJob } from "@/lib/hooks/use-jobs";
import { AddressAutocomplete, type AddressParts } from "@/components/address-autocomplete";

/* ------------------------------------------------------------------ */
/*  Inline Icons                                                       */
/* ------------------------------------------------------------------ */

function ArrowLeft() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M19 12H5m0 0 6-6m-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Loss Type Icons (custom SVG for field clarity)                     */
/* ------------------------------------------------------------------ */

function DropletIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.69l.66.72C13.52 4.35 16.5 7.7 16.5 11.5a4.5 4.5 0 0 1-9 0c0-3.8 2.98-7.15 3.84-8.09L12 2.69Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2c.5 3.5-1.5 5.5-1.5 5.5C12.5 9 14 7 14 7c2 3.5 1 7-2 9-1.5-1-2-3-2-3s-1 2.5 0 5c-3-1.5-5-5-4-9 0 0 2-2 3-5 .5 1.5 2 2 3-2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
    </svg>
  );
}

function MoldIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Segmented Button Group                                             */
/* ------------------------------------------------------------------ */

function SegmentedButtons<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-2">
        {label}
      </label>
      <div className="flex gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 h-12 rounded-lg text-sm font-semibold transition-all duration-150 cursor-pointer ${
              value === opt.value
                ? "primary-gradient text-on-primary shadow-sm"
                : "bg-surface-container-lowest text-on-surface-variant border border-outline-variant hover:bg-surface-container-low"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Form Input                                                         */
/* ------------------------------------------------------------------ */

function FormInput({
  label,
  required,
  type = "text",
  placeholder,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant">
          {label}
        </span>
        {required && (
          <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-brand-accent font-semibold">
            Required
          </span>
        )}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-14 px-4 rounded-lg bg-surface-container-lowest text-on-surface text-[15px] placeholder:text-on-surface-variant/50 outline-none focus:ring-2 focus:ring-brand-accent/30 transition-shadow"
      />
    </div>
  );
}

function FormInputSmall({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-2">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-12 px-4 rounded-lg bg-surface-container-lowest text-on-surface text-[15px] placeholder:text-on-surface-variant/50 outline-none focus:ring-2 focus:ring-brand-accent/30 transition-shadow"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const lossTypes: { value: LossType; label: string; icon: React.ReactNode }[] = [
  { value: "water", label: "Water", icon: <DropletIcon /> },
  { value: "fire", label: "Fire", icon: <FlameIcon /> },
  { value: "mold", label: "Mold", icon: <MoldIcon /> },
];

const categoryOptions: { value: WaterCategory; label: string }[] = [
  { value: "1", label: "Cat 1" },
  { value: "2", label: "Cat 2" },
  { value: "3", label: "Cat 3" },
];

const classOptions: { value: WaterClass; label: string }[] = [
  { value: "1", label: "Class 1" },
  { value: "2", label: "Class 2" },
  { value: "3", label: "Class 3" },
  { value: "4", label: "Class 4" },
];

export default function NewJobPage() {
  const router = useRouter();
  const createJob = useCreateJob();

  // Core fields
  const [lossType, setLossType] = useState<LossType>("water");
  const [address, setAddress] = useState("");
  const [addressParts, setAddressParts] = useState<AddressParts | null>(null);

  // Expanded details
  const [showDetails, setShowDetails] = useState(false);

  // Customer
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  // Loss Details
  const [lossDate, setLossDate] = useState("");
  const [lossCause, setLossCause] = useState("");
  const [category, setCategory] = useState<WaterCategory | null>(null);
  const [waterClass, setWaterClass] = useState<WaterClass | null>(null);

  // Insurance
  const [carrier, setCarrier] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [adjusterName, setAdjusterName] = useState("");
  const [adjusterEmail, setAdjusterEmail] = useState("");
  const [adjusterPhone, setAdjusterPhone] = useState("");

  // Error state
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);
    try {
      const result = await createJob.mutateAsync({
        address_line1: address.trim(),
        loss_type: lossType,
        city: addressParts?.city || undefined,
        state: addressParts?.state || undefined,
        zip: addressParts?.zip || undefined,
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        customer_email: customerEmail.trim() || undefined,
        loss_category: category || undefined,
        loss_class: waterClass || undefined,
        loss_cause: lossCause.trim() || undefined,
        loss_date: lossDate || undefined,
        claim_number: claimNumber.trim() || undefined,
        carrier: carrier.trim() || undefined,
        adjuster_name: adjusterName.trim() || undefined,
        adjuster_phone: adjusterPhone.trim() || undefined,
        adjuster_email: adjusterEmail.trim() || undefined,
      });
      router.push(`/jobs/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-surface flex flex-col">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-5 pt-6 pb-2 lg:max-w-2xl lg:mx-auto lg:w-full">
        <Link
          href="/jobs"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-colors"
          aria-label="Back to jobs"
        >
          <ArrowLeft />
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-on-surface">
          New Job
        </h1>
      </header>

      {/* ── Form Body ──────────────────────────────────────────── */}
      <div className="flex-1 px-5 pt-4 pb-8 space-y-6 max-w-lg mx-auto w-full lg:max-w-2xl lg:bg-surface-container-lowest lg:rounded-2xl lg:shadow-[0_1px_3px_rgba(31,27,23,0.04)] lg:p-8 lg:mt-8">
        {/* Loss Type Selector */}
        <div>
          <label className="block text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-2">
            Loss Type
          </label>
          <div className="flex gap-3">
            {lossTypes.map((lt) => (
              <button
                key={lt.value}
                type="button"
                onClick={() => setLossType(lt.value)}
                className={`flex-1 lg:w-40 h-20 rounded-xl flex flex-col items-center justify-center gap-1.5 text-sm font-semibold transition-all duration-150 cursor-pointer ${
                  lossType === lt.value
                    ? "primary-gradient text-on-primary shadow-md shadow-primary/20"
                    : "bg-surface-container-lowest text-on-surface-variant border border-outline-variant hover:bg-surface-container-low hover:border-outline"
                }`}
              >
                {lt.icon}
                {lt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Address */}
        <div>
          <label className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant">
              Address
            </span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-brand-accent font-semibold">
              Required
            </span>
          </label>
          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            onSelect={(parts) => {
              setAddress(parts.address_line1);
              setAddressParts(parts);
            }}
            placeholder="Start typing an address..."
            className="w-full h-14 px-4 rounded-lg bg-surface-container-lowest text-on-surface text-[15px] placeholder:text-on-surface-variant/50 outline-none focus:ring-2 focus:ring-brand-accent/30 transition-shadow"
          />
          {addressParts && (
            <p className="mt-1.5 text-[12px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
              {addressParts.city}{addressParts.state ? `, ${addressParts.state}` : ""}{addressParts.zip ? ` ${addressParts.zip}` : ""}
            </p>
          )}
        </div>

        {/* ── Collapsible Details ──────────────────────────────── */}
        <div>
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1.5 text-sm font-medium text-brand-accent hover:text-primary transition-colors cursor-pointer"
          >
            Add more details
            <ChevronDown open={showDetails} />
          </button>

          {showDetails && (
            <div className="mt-5 space-y-8 animate-[fadeSlideIn_200ms_ease-out] lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0">
              {/* Customer Section */}
              <section className="space-y-3">
                <h2 className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/70 border-b border-outline-variant/40 pb-2">
                  Customer
                </h2>
                <FormInputSmall
                  label="Name"
                  placeholder="John Smith"
                  value={customerName}
                  onChange={setCustomerName}
                />
                <FormInputSmall
                  label="Phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={customerPhone}
                  onChange={setCustomerPhone}
                />
                <FormInputSmall
                  label="Email"
                  type="email"
                  placeholder="john@example.com"
                  value={customerEmail}
                  onChange={setCustomerEmail}
                />
              </section>

              {/* Loss Details Section */}
              <section className="space-y-3">
                <h2 className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/70 border-b border-outline-variant/40 pb-2">
                  Loss Details
                </h2>
                <FormInputSmall
                  label="Date of Loss"
                  type="date"
                  value={lossDate}
                  onChange={setLossDate}
                />
                <FormInputSmall
                  label="Cause"
                  placeholder="Burst pipe, appliance leak, etc."
                  value={lossCause}
                  onChange={setLossCause}
                />
                <SegmentedButtons
                  label="Category"
                  options={categoryOptions}
                  value={category}
                  onChange={setCategory}
                />
                <SegmentedButtons
                  label="Class"
                  options={classOptions}
                  value={waterClass}
                  onChange={setWaterClass}
                />
              </section>

              {/* Insurance Section — spans full width on desktop */}
              <section className="space-y-3 lg:col-span-2">
                <h2 className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/70 border-b border-outline-variant/40 pb-2">
                  Insurance
                </h2>
                <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
                  <FormInputSmall
                    label="Carrier"
                    placeholder="State Farm, Allstate, etc."
                    value={carrier}
                    onChange={setCarrier}
                  />
                  <FormInputSmall
                    label="Claim Number"
                    placeholder="CLM-2026-00123"
                    value={claimNumber}
                    onChange={setClaimNumber}
                  />
                  <FormInputSmall
                    label="Adjuster Name"
                    placeholder="Jane Doe"
                    value={adjusterName}
                    onChange={setAdjusterName}
                  />
                  <FormInputSmall
                    label="Adjuster Email"
                    type="email"
                    placeholder="adjuster@carrier.com"
                    value={adjusterEmail}
                    onChange={setAdjusterEmail}
                  />
                  <FormInputSmall
                    label="Adjuster Phone"
                    type="tel"
                    placeholder="(555) 987-6543"
                    value={adjusterPhone}
                    onChange={setAdjusterPhone}
                  />
                </div>
              </section>
            </div>
          )}
        </div>

        {/* ── Error Message ────────────────────────────────────── */}
        {error && (
          <div className="rounded-lg bg-error-container/20 border border-error/20 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        {/* ── Create Button ────────────────────────────────────── */}
        <div className="lg:flex lg:items-center lg:justify-between lg:gap-4">
          <Link
            href="/jobs"
            className="hidden lg:inline-flex text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!address.trim() || createJob.isPending}
            className="w-full lg:w-auto lg:px-12 h-14 rounded-xl text-[16px] font-semibold text-on-primary primary-gradient cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100"
          >
            {createJob.isPending ? "Creating..." : "Create Job \u2192"}
          </button>
        </div>

        {/* ── Footer ───────────────────────────────────────────── */}
        <p className="text-center text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.15em] text-on-surface-variant/50 pt-2">
          Precision scoping powered by Crewmatic AI
        </p>
      </div>
    </div>
  );
}
