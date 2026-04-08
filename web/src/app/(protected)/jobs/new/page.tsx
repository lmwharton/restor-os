"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { JobType, LossType, WaterCategory, WaterClass } from "@/lib/types";
import { useJobs } from "@/lib/hooks/use-jobs";
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  tooltip,
}: {
  options: { value: T; label: string; subtitle?: string }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  tooltip?: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <div>
      <label className="flex items-center gap-1.5 mb-2">
        <span className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant">
          {label}
        </span>
        {tooltip && (
          <span className="text-[10px] text-on-surface-variant/60 font-[family-name:var(--font-geist-mono)]">
            — {tooltip}
          </span>
        )}
      </label>
      <div className="flex gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            title={opt.subtitle}
            className={`flex-1 h-9 rounded-lg text-[12px] font-semibold transition-all duration-150 cursor-pointer ${
              value === opt.value
                ? "bg-brand-accent text-on-primary shadow-sm"
                : "bg-surface-container-lowest text-on-surface-variant border border-outline-variant hover:bg-surface-container-low"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {selected?.subtitle && (
        <p className="mt-1.5 text-[12px] text-on-surface-variant/70 font-[family-name:var(--font-geist-mono)]">
          {selected.subtitle}
        </p>
      )}
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
        className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-on-surface text-[13px] placeholder:text-on-surface-variant/50 outline-none border border-outline-variant/30 focus:border-brand-accent/50 focus:ring-2 focus:ring-brand-accent/20 transition-all"
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
        className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-on-surface text-[13px] placeholder:text-on-surface-variant/50 outline-none border border-outline-variant/30 focus:border-brand-accent/50 focus:ring-2 focus:ring-brand-accent/20 transition-all"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

function StormIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13 2L3 14h9l-1 8 10-12h-9l1-8Z"
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

function OtherIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="8" cy="12" r="1.5" fill="currentColor" />
      <circle cx="16" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

const lossTypes: { value: LossType; label: string; icon: React.ReactNode }[] = [
  { value: "water", label: "Water", icon: <DropletIcon /> },
  { value: "fire", label: "Fire", icon: <FlameIcon /> },
  { value: "mold", label: "Mold", icon: <MoldIcon /> },
  { value: "storm", label: "Storm", icon: <StormIcon /> },
  { value: "other", label: "Other", icon: <OtherIcon /> },
];

const categoryOptions: { value: WaterCategory; label: string; subtitle: string }[] = [
  { value: "1", label: "Cat 1", subtitle: "Clean water — supply line, rain" },
  { value: "2", label: "Cat 2", subtitle: "Gray water — dishwasher, washing machine, toilet overflow (no solids)" },
  { value: "3", label: "Cat 3", subtitle: "Black water — sewage, river flooding, standing water >72hrs" },
];

const classOptions: { value: WaterClass; label: string; subtitle: string }[] = [
  { value: "1", label: "Class 1", subtitle: "Least water — small area, minimal absorption" },
  { value: "2", label: "Class 2", subtitle: "Large amount — carpet + walls wet <24 inches" },
  { value: "3", label: "Class 3", subtitle: "Greatest amount — walls, ceilings, insulation saturated" },
  { value: "4", label: "Class 4", subtitle: "Specialty — deep saturation in hardwood, concrete, stone" },
];

export default function NewJobPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const createJob = useCreateJob();

  // Job type — read from URL param if present (?type=reconstruction)
  const [jobType, setJobType] = useState<JobType>(
    searchParams.get("type") === "reconstruction" ? "reconstruction" : "mitigation"
  );
  const [linkedJobId, setLinkedJobId] = useState<string>(searchParams.get("linked") ?? "");

  // Fetch existing mitigation jobs for linking dropdown
  const { data: allJobs } = useJobs();
  const mitigationJobs = allJobs?.filter((j) => j.job_type === "mitigation") ?? [];

  // Core fields
  const [lossType, setLossType] = useState<LossType>("water");
  const [address, setAddress] = useState("");
  const [addressParts, setAddressParts] = useState<AddressParts | null>(null);

  // Expanded details — auto-expand on desktop
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setShowDetails(true);
    }
  }, []);

  // Customer
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  // Loss Details
  const [lossDate, setLossDate] = useState("");
  const [lossCause, setLossCause] = useState("");
  const [category, setCategory] = useState<WaterCategory | null>(null);
  const [waterClass, setWaterClass] = useState<WaterClass | null>(null);
  const [homeYearBuilt, setHomeYearBuilt] = useState("");

  // Insurance
  const [carrier, setCarrier] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [adjusterName, setAdjusterName] = useState("");
  const [adjusterEmail, setAdjusterEmail] = useState("");
  const [adjusterPhone, setAdjusterPhone] = useState("");

  // Auto-copy fields when linking a mitigation job
  const handleLinkJob = useCallback((jobId: string) => {
    setLinkedJobId(jobId);
    if (!jobId) {
      // Clear all auto-filled fields when unlinking
      setAddress("");
      setAddressParts(null);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setLossType("water");
      setLossDate("");
      setLossCause("");
      setCarrier("");
      setClaimNumber("");
      setAdjusterName("");
      setAdjusterEmail("");
      setAdjusterPhone("");
      return;
    }
    const linked = mitigationJobs.find((j) => j.id === jobId);
    if (!linked) return;
    // Auto-fill address
    setAddress(linked.address_line1);
    setAddressParts({ address_line1: linked.address_line1, city: linked.city, state: linked.state, zip: linked.zip, latitude: linked.latitude, longitude: linked.longitude });
    // Auto-fill customer
    setCustomerName(linked.customer_name ?? "");
    setCustomerPhone(linked.customer_phone ?? "");
    setCustomerEmail(linked.customer_email ?? "");
    // Auto-fill loss details
    setLossType(linked.loss_type);
    setLossDate(linked.loss_date ?? "");
    setLossCause(linked.loss_cause ?? "");
    // Auto-fill insurance
    setCarrier(linked.carrier ?? "");
    setClaimNumber(linked.claim_number ?? "");
    setAdjusterName(linked.adjuster_name ?? "");
    setAdjusterEmail(linked.adjuster_email ?? "");
    setAdjusterPhone(linked.adjuster_phone ?? "");
    // Auto-expand details so user sees what was filled
    setShowDetails(true);
  }, [mitigationJobs]);

  // Auto-fill from URL param (?linked=jobId) once mitigation jobs load
  const linkedParam = searchParams.get("linked");
  useEffect(() => {
    if (linkedParam && mitigationJobs.length > 0 && !address) {
      handleLinkJob(linkedParam);
    }
  }, [linkedParam, mitigationJobs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Error + validation state
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const handleCreate = async () => {
    setAttempted(true);
    setError(null);
    if (!address.trim()) return;
    try {
      const result = await createJob.mutateAsync({
        job_type: jobType,
        linked_job_id: linkedJobId || undefined,
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
        home_year_built: homeYearBuilt ? parseInt(homeYearBuilt, 10) : undefined,
        claim_number: claimNumber.trim() || undefined,
        carrier: carrier.trim() || undefined,
        adjuster_name: adjusterName.trim() || undefined,
        adjuster_phone: adjusterPhone.trim() || undefined,
        adjuster_email: adjusterEmail.trim() || undefined,
        latitude: addressParts?.latitude || undefined,
        longitude: addressParts?.longitude || undefined,
      });
      router.push(`/jobs/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-surface flex flex-col">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/15">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2">
          <Link
            href="/jobs"
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-container-low active:bg-surface-container-high transition-colors"
            aria-label="Back to jobs"
          >
            <ArrowLeft />
          </Link>
          <h1 className="text-[16px] font-bold text-on-surface">
            New Job
          </h1>
        </div>
      </header>

      {/* ── Form Body ──────────────────────────────────────────── */}
      <div className="flex-1 px-4 pt-4 pb-8 max-w-6xl mx-auto w-full lg:grid lg:grid-cols-[1fr_320px] lg:gap-6">
        {/* Left: Form */}
        <div className="space-y-4">
        {/* Card 1: Job Type + Loss Type */}
        <div className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4 space-y-4">
        <div>
          <label className="block text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-2">
            Job Type
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setJobType("mitigation")}
              className={`flex items-center gap-2 px-4 h-9 rounded-full text-[13px] font-medium transition-all duration-150 cursor-pointer ${
                jobType === "mitigation"
                  ? "bg-type-mitigation text-white"
                  : "bg-surface-container-lowest text-on-surface-variant border border-outline-variant hover:bg-surface-container-low"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${jobType === "mitigation" ? "bg-white" : "bg-type-mitigation"}`} />
              Mitigation
            </button>
            <button
              type="button"
              onClick={() => { setJobType("reconstruction"); setLinkedJobId(""); }}
              className={`flex items-center gap-2 px-4 h-9 rounded-full text-[13px] font-medium transition-all duration-150 cursor-pointer ${
                jobType === "reconstruction"
                  ? "bg-type-reconstruction text-white"
                  : "bg-surface-container-lowest text-on-surface-variant border border-outline-variant hover:bg-surface-container-low"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${jobType === "reconstruction" ? "bg-white" : "bg-type-reconstruction"}`} />
              Reconstruction
            </button>
          </div>
        </div>

        {/* Link to Mitigation Job — shown immediately when reconstruction selected */}
        {jobType === "reconstruction" && (
          <div className="animate-[fadeSlideIn_200ms_ease-out]">
            <label className="block text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1">
              Link to Mitigation Job
            </label>
            <p className="text-[11px] text-on-surface-variant/70 mb-2">
              Auto-fills address, customer, and insurance from the linked job.
            </p>
            <select
              value={linkedJobId}
              onChange={(e) => handleLinkJob(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-on-surface text-[13px] outline-none focus:ring-2 focus:ring-brand-accent/30 transition-shadow border border-outline-variant appearance-none cursor-pointer"
            >
              <option value="">No linked job (standalone)</option>
              {mitigationJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.job_number} — {j.address_line1}, {j.city} {j.state}
                </option>
              ))}
            </select>
            {linkedJobId && (
              <p className="mt-1.5 text-[11px] text-[#2a9d5c] font-[family-name:var(--font-geist-mono)]">
                Address, customer, carrier, and adjuster will be copied from the linked job.
              </p>
            )}
          </div>
        )}

        {/* Loss Type Selector */}
        <div>
          <label className="block text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-2">
            Loss Type
          </label>
          <div className="flex flex-wrap gap-2">
            {lossTypes.map((lt) => (
              <button
                key={lt.value}
                type="button"
                onClick={() => setLossType(lt.value)}
                className={`flex items-center gap-1.5 px-3 h-9 rounded-full text-[12px] font-medium transition-all duration-150 cursor-pointer ${
                  lossType === lt.value
                    ? "bg-brand-accent text-on-primary"
                    : "bg-surface-container-lowest text-on-surface-variant border border-outline-variant hover:bg-surface-container-low"
                }`}
              >
                {lt.icon}
                {lt.label}
              </button>
            ))}
          </div>
        </div>
        </div>

        {/* Card 2: Address + Details */}
        <div className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4 space-y-4">

        {/* Address */}
        <div>
          <label className="flex items-center gap-1.5 mb-2">
            <span className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant">
              Address
            </span>
            <span className="text-brand-accent text-[13px] leading-none">*</span>
          </label>
          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            onSelect={(parts) => {
              setAddress(parts.address_line1);
              setAddressParts(parts);
            }}
            placeholder="Start typing an address..."
            className={`w-full h-10 px-3 rounded-lg bg-surface-container-lowest text-on-surface text-[13px] placeholder:text-on-surface-variant/50 outline-none transition-all ${
              attempted && !address.trim()
                ? "border-2 border-red-400 focus:ring-2 focus:ring-red-200"
                : "border border-outline-variant/30 focus:border-brand-accent/50 focus:ring-2 focus:ring-brand-accent/20"
            }`}
          />
          {attempted && !address.trim() && (
            <p className="mt-1 text-[11px] text-red-500">Address is required to create a job.</p>
          )}
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
            className="flex items-center gap-1.5 text-sm font-medium text-brand-accent hover:text-primary transition-colors cursor-pointer lg:hidden"
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
                {lossType === "water" && jobType === "mitigation" && (
                  <>
                    <SegmentedButtons
                      label="Category"
                      tooltip="IICRC S500 contamination level"
                      options={categoryOptions}
                      value={category}
                      onChange={setCategory}
                    />
                    <SegmentedButtons
                      label="Class"
                      tooltip="IICRC S500 damage severity"
                      options={classOptions}
                      value={waterClass}
                      onChange={setWaterClass}
                    />
                  </>
                )}
                <FormInputSmall
                  label="Year Home Built"
                  type="number"
                  placeholder="e.g. 1975"
                  value={homeYearBuilt}
                  onChange={setHomeYearBuilt}
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
        </div>

        {/* ── Error Message ────────────────────────────────────── */}
        {error && (
          <div className="rounded-lg bg-error-container/20 border border-error/20 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        {/* ── Action Buttons ──────────────────────────────────── */}
        <div className="flex items-center gap-3 justify-end">
          <Link
            href="/jobs"
            className="hidden lg:flex h-10 px-5 rounded-lg text-[13px] font-medium text-on-surface-variant bg-surface-container-lowest border border-outline-variant/30 items-center hover:bg-surface-container-low transition-colors"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!address.trim() || createJob.isPending}
            className="flex-1 lg:flex-none lg:px-8 h-10 rounded-lg text-[13px] font-semibold text-on-primary bg-brand-accent cursor-pointer transition-all duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {createJob.isPending ? "Creating..." : "Create Job →"}
          </button>
        </div>

        </div>

        {/* Right: Sidebar — tips & checklist */}
        <div className="hidden lg:block space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* Checklist */}
          <div className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4">
            <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
              To Create This Job
            </h3>
            <div className="space-y-2.5">
              <div className="flex gap-2.5">
                <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${jobType ? "bg-emerald-500" : "bg-outline-variant"}`} />
                <p className={`text-[12px] ${jobType ? "text-on-surface-variant" : "text-on-surface font-medium"}`}>
                  Select job type
                </p>
              </div>
              <div className="flex gap-2.5">
                <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${address.trim() ? "bg-emerald-500" : "bg-brand-accent"}`} />
                <div>
                  <p className={`text-[12px] ${address.trim() ? "text-on-surface-variant" : "text-brand-accent font-semibold"}`}>
                    {address.trim() ? "Address entered" : "Enter job address"}
                  </p>
                  {!address.trim() && (
                    <p className="text-[11px] text-on-surface-variant mt-0.5">Required to create the job</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2.5">
                <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${customerName.trim() ? "bg-emerald-500" : "bg-outline-variant"}`} />
                <p className={`text-[12px] ${customerName.trim() ? "text-on-surface-variant" : "text-on-surface-variant"}`}>
                  Add customer info
                </p>
              </div>
              <div className="flex gap-2.5">
                <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${carrier.trim() ? "bg-emerald-500" : "bg-outline-variant"}`} />
                <p className={`text-[12px] ${carrier.trim() ? "text-on-surface-variant" : "text-on-surface-variant"}`}>
                  Add insurance details
                </p>
              </div>
            </div>
          </div>

          {/* Tips */}
          <div className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4">
            <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
              Tips
            </h3>
            <ul className="space-y-2.5 text-[12px] text-on-surface-variant leading-snug ml-4 list-disc">
              <li className="pl-1">Only the <span className="font-medium text-on-surface">address</span> is required. Add other details later.</li>
              {jobType === "reconstruction" && (
                <li className="pl-1">Link a mitigation job to auto-fill customer and insurance.</li>
              )}
              <li className="pl-1">Add photos, rooms, and floor plans after creating.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
