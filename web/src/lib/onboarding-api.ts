/**
 * Spec 01I — Onboarding API client.
 *
 * Typed wrappers around the onboarding endpoints so screens don't reach for
 * raw fetch + Supabase plumbing. Mirrors the shape of `lib/api.ts` but kept
 * in its own file so the wizard's surface area is self-contained.
 *
 * State is server-derived (Decision Log #5): the only writeable fields are
 * `onboarding_step` (forward-only) and `setup_banner_dismissed_at`.
 */

import { createClient } from "@/lib/supabase/client";

// Backend port is 5174 per backend/CLAUDE.md.
// Production sets NEXT_PUBLIC_API_URL via Vercel env vars.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5174";

// ─── Types ───────────────────────────────────────────────────────────

export type OnboardingStep =
  | "company_profile"
  | "jobs_import"
  | "pricing"
  | "first_job"
  | "complete";

export interface OnboardingStatus {
  step: OnboardingStep;
  completed_at: string | null;
  setup_banner_dismissed_at: string | null;
  has_jobs: boolean;
  has_pricing: boolean;
  has_company: boolean;
  show_setup_banner: boolean;
}

export type JobTypeChoice =
  | "Water Damage"
  | "Fire Damage"
  | "Mold Remediation"
  | "Reconstruction";

export type JobStatusChoice = "Lead" | "Scoped" | "Submitted";

export interface CompanyCreatePayload {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  service_area?: string[];
}

export interface QuickJobRow {
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  customer_name: string;
  customer_phone: string;
  loss_type: "water" | "fire" | "mold" | "other";
  job_type: "mitigation" | "reconstruction";
  status: JobStatusChoice;
}

export interface PricingUploadError {
  row: number;
  field?: string;
  message: string;
}

export interface PricingUploadResult {
  items_loaded: number;
  tier: string;
  errors: PricingUploadError[];
  run_id: string | null;
}

// ─── Mapping helpers ─────────────────────────────────────────────────

/**
 * Brett's PRD shows four UI options for Job Type. The backend only knows
 * `mitigation` / `reconstruction`. Map here so each screen doesn't redo it.
 */
export function jobTypeChoiceToBackend(choice: JobTypeChoice): {
  job_type: "mitigation" | "reconstruction";
  loss_type: "water" | "fire" | "mold" | "other";
} {
  switch (choice) {
    case "Water Damage":
      return { job_type: "mitigation", loss_type: "water" };
    case "Fire Damage":
      return { job_type: "mitigation", loss_type: "fire" };
    case "Mold Remediation":
      return { job_type: "mitigation", loss_type: "mold" };
    case "Reconstruction":
      return { job_type: "reconstruction", loss_type: "other" };
  }
}

// ─── Auth + fetch core ───────────────────────────────────────────────

/**
 * Build authenticated headers using the live Supabase session. Throws if
 * no session — callers should treat that as a hard error and bounce the
 * user back to /login.
 */
async function getAuthHeaders(extra?: Record<string, string>) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    ...(extra ?? {}),
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}

export class OnboardingApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function parseJsonError(res: Response): Promise<OnboardingApiError> {
  const body = await res.json().catch(() => ({}));
  const message =
    (body.detail as string) ||
    (body.error as string) ||
    res.statusText ||
    "Request failed";
  return new OnboardingApiError(res.status, message, body);
}

// ─── Endpoint wrappers ───────────────────────────────────────────────

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}/v1/company/onboarding-status`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw await parseJsonError(res);
  return res.json();
}

export async function createCompany(payload: CompanyCreatePayload) {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${API_URL}/v1/company`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseJsonError(res);
  return res.json();
}

export async function batchCreateJobs(jobs: QuickJobRow[]) {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${API_URL}/v1/jobs/batch`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jobs }),
  });
  if (!res.ok) throw await parseJsonError(res);
  return res.json();
}

export async function setOnboardingStep(step: OnboardingStep) {
  const headers = await getAuthHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`${API_URL}/v1/me/onboarding-step`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ step }),
  });
  if (!res.ok) throw await parseJsonError(res);
  return res.json() as Promise<OnboardingStatus>;
}

export async function dismissSetupBanner() {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}/v1/me/dismiss-setup-banner`, {
    method: "PATCH",
    headers,
  });
  if (!res.ok) throw await parseJsonError(res);
  return res.json() as Promise<OnboardingStatus>;
}

/**
 * Upload an Xactimate-style pricing workbook. The browser sets the
 * multipart boundary for us — DO NOT manually set Content-Type here or the
 * upload will 400 on the backend.
 */
export async function uploadPricing(file: File): Promise<PricingUploadResult> {
  const headers = await getAuthHeaders();
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/v1/pricing/upload`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) throw await parseJsonError(res);
  return res.json();
}

/**
 * Trigger a browser download of the pre-built Tier-A pricing template.
 * Streams via blob → object URL so we can preserve the filename.
 */
export async function downloadPricingTemplate(): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}/v1/pricing/template`, { headers });
  if (!res.ok) throw await parseJsonError(res);
  const blob = await res.blob();
  triggerBlobDownload(blob, "crewmatic-pricing-template.xlsx");
}

/**
 * Download the row-level error report CSV for a failed pricing upload.
 */
export async function downloadPricingErrorReport(runId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `${API_URL}/v1/pricing/error-report/${encodeURIComponent(runId)}`,
    { headers },
  );
  if (!res.ok) throw await parseJsonError(res);
  const blob = await res.blob();
  triggerBlobDownload(blob, `pricing-errors-${runId}.csv`);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Fetch the current user + company from /v1/me. Used by the Welcome
 * screen to personalize copy with the company name on the resume case
 * (when the wizard wasn't carrying it through React state).
 */
export interface MyAccount {
  user: {
    id: string;
    email: string;
    name: string;
  };
  company: {
    id: string;
    name: string;
    phone: string | null;
  } | null;
}

export async function getMyAccount(): Promise<MyAccount | null> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_URL}/v1/me`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      user: { id: data.id, email: data.email, name: data.name },
      company: data.company
        ? {
            id: data.company.id,
            name: data.company.name,
            phone: data.company.phone ?? null,
          }
        : null,
    };
  } catch {
    return null;
  }
}

// ─── Server-side helpers ─────────────────────────────────────────────

/**
 * Server-side variant — used in `(protected)/layout.tsx` and the onboarding
 * server page to read status without re-doing the Supabase plumbing each
 * time. Returns `null` on transport/server failure so the gate can fall
 * back to permissive routing instead of a hard crash.
 */
export async function getOnboardingStatusServer(
  accessToken: string,
): Promise<OnboardingStatus | null> {
  try {
    const res = await fetch(`${API_URL}/v1/company/onboarding-status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OnboardingStatus;
  } catch {
    return null;
  }
}
