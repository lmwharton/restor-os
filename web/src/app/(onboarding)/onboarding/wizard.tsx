/**
 * Onboarding wizard — client orchestrator.
 *
 * The server `page.tsx` reads `GET /v1/company/onboarding-status` and
 * passes the initial step + has_pricing flag in. Everything else lives
 * in React state — refreshing the browser re-reads from the server, so
 * we never persist screen state in URL params.
 *
 * State machine (matches backend onboarding_step exactly, plus a synthetic
 * `quick_add_jobs` modal layer and a `welcome` finale):
 *
 *   company_profile  ─┬─►  pricing  ─►  first_job  ─►  welcome
 *                     │      ▲                ▲
 *      (link)         │      │                │
 *      ▼              │   "Skip"           "Skip"
 *   quick_add_jobs    │
 *      └──── back ────┘
 *
 * The two PATCH calls we make ourselves:
 *   - skip-or-success on Step 2 → `'first_job'`
 *   - skip-or-success on Step 3 → `'complete'`
 * Step 1 advances itself via the backend RPC (no PATCH).
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { BrandHeader } from "./components/BrandHeader";
import { ProgressBar } from "./components/ProgressBar";
import CompanyProfileScreen from "./screens/CompanyProfileScreen";
import QuickAddJobsScreen from "./screens/QuickAddJobsScreen";
import PricingUploadScreen from "./screens/PricingUploadScreen";
import FirstJobScreen from "./screens/FirstJobScreen";
import WelcomeScreen from "./screens/WelcomeScreen";
import {
  getOnboardingStatus,
  setOnboardingStep,
  type OnboardingStatus,
  type OnboardingStep,
} from "@/lib/onboarding-api";

// Phases the wizard renders. Quick-Add is a true overlay (rendered as a
// modal on top of Step 1), not its own phase — that way Step 1's form
// state survives the side trip (qa-checklist E4).
type WizardPhase =
  | "company_profile"
  | "pricing"
  | "first_job"
  | "welcome";

function backendStepToPhase(step: OnboardingStep): WizardPhase {
  switch (step) {
    case "company_profile": return "company_profile";
    case "jobs_import":     return "pricing"; // server uses this between Step 1 and 2
    case "pricing":         return "pricing";
    case "first_job":       return "first_job";
    case "complete":        return "welcome";
  }
}

type Toast = { message: string; tone: "success" | "info" | "error" } | null;

type Props = {
  initialStatus: OnboardingStatus;
};

export default function OnboardingWizard({ initialStatus }: Props) {
  const [phase, setPhase] = useState<WizardPhase>(() =>
    backendStepToPhase(initialStatus.step),
  );

  // Quick-Add modal visibility (separate axis from `phase`). Keeping
  // it as a sibling boolean preserves Company Profile state across the
  // sidetrack (qa-checklist E4 — "Back button preserves data").
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // The user's resume state — true when we initially arrive at any step
  // beyond company_profile (Decision Log: shows "Welcome back!" header).
  const [showWelcomeBack] = useState<boolean>(
    initialStatus.has_company && initialStatus.step !== "complete",
  );

  // Whether the user has uploaded pricing — used by Welcome screen + may
  // refresh after a successful upload.
  const [hasPricing, setHasPricing] = useState<boolean>(initialStatus.has_pricing);

  // Whether the user explicitly created a first job in this wizard run.
  const [createdFirstJob, setCreatedFirstJob] = useState<boolean>(false);

  // Lightweight toast (e.g. "3 jobs imported successfully").
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // ─── Transitions ──────────────────────────────────────────────────

  async function handleCompanyCreated() {
    // The backend RPC creates the company + user atomically but does NOT
    // bump `users.onboarding_step` — we have to nudge it forward
    // ourselves so a refresh after Step 1 lands the user back at Step 2
    // (Pricing) instead of Step 1.
    //
    // Don't advance the local screen if the PATCH fails. Otherwise the
    // user lands on Pricing locally, then on refresh the server still
    // says they're at Step 1 and the wizard bounces them back — confusing.
    // Surface the error inline; let them retry. (PricingUploadScreen and
    // FirstJobScreen already do this — be consistent.)
    try {
      await setOnboardingStep("jobs_import");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't advance onboarding step.";
      setToast({ message: msg, tone: "error" });
      return;
    }
    setPhase("pricing");
  }

  function handleOpenQuickAdd() {
    setQuickAddOpen(true);
  }

  function handleQuickAddCancel() {
    setQuickAddOpen(false);
  }

  function handleQuickAddImported(count: number) {
    setToast({ message: `${count} job${count === 1 ? "" : "s"} imported successfully.`, tone: "success" });
    setQuickAddOpen(false);
    // Step 1's CompanyProfileScreen stayed mounted under the modal, so
    // the user's already-entered fields are preserved (qa-checklist E4).
  }

  async function handlePricingContinue() {
    // Refresh the server-side `has_pricing` so Welcome shows ✓ if the
    // user uploaded successfully. Best-effort.
    try {
      const fresh = await getOnboardingStatus();
      setHasPricing(fresh.has_pricing);
    } catch {
      // Ignore — Welcome still renders, just without the up-to-date tick.
    }
    setPhase("first_job");
  }

  function handleFirstJobComplete(createdAJob: boolean) {
    setCreatedFirstJob(createdAJob);
    setPhase("welcome");
  }

  function handleFirstJobBack() {
    setPhase("pricing");
  }

  function handlePricingBack() {
    // Backwards from Pricing isn't useful (Step 1 already created the
    // company); show a confirm-style hop back to Step 1 anyway because
    // the spec lists "Back button preserves data" as expected behavior.
    setPhase("company_profile");
  }

  // ─── Layout ───────────────────────────────────────────────────────

  // Welcome takes over the viewport — no progress bar.
  if (phase === "welcome") {
    return (
      <Shell wide>
        <WelcomeScreen createdJob={createdFirstJob} hasPricing={hasPricing} />
      </Shell>
    );
  }

  const stepNumber: 1 | 2 | 3 =
    phase === "company_profile" ? 1 : phase === "pricing" ? 2 : 3;

  return (
    <>
      <Shell>
        <ProgressBar current={stepNumber} />
        <BrandHeader />

        {phase === "company_profile" ? (
          <CompanyProfileScreen
            showWelcomeBack={false /* never on Step 1 — the user is fresh */}
            onCreated={handleCompanyCreated}
            onOpenQuickAdd={handleOpenQuickAdd}
          />
        ) : null}

        {phase === "pricing" ? (
          <PricingUploadScreen
            showWelcomeBack={showWelcomeBack}
            allowSkip
            showBack
            onBack={handlePricingBack}
            onContinue={handlePricingContinue}
            continueLabel="Continue"
          />
        ) : null}

        {phase === "first_job" ? (
          <FirstJobScreen
            showWelcomeBack={showWelcomeBack}
            onComplete={handleFirstJobComplete}
            onBack={handleFirstJobBack}
          />
        ) : null}

        {toast ? (
          <div
            role="status"
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-[13px] font-medium shadow-lg"
            style={{
              backgroundColor:
                toast.tone === "success"
                  ? "#15512c"
                  : toast.tone === "error"
                    ? "#7a2c0b"
                    : "#1f1b17",
              color: "white",
            }}
          >
            {toast.message}
          </div>
        ) : null}
      </Shell>

      {/*
        Quick-Add modal overlay. Mounted on top of Step 1 so the parent's
        form state isn't unmounted during the side trip — fixes E4
        "Back button preserves data" without lifting state.
      */}
      {quickAddOpen ? (
        <QuickAddModal onCancel={handleQuickAddCancel} onImported={handleQuickAddImported} />
      ) : null}
    </>
  );
}

/**
 * Quick-Add modal — fixed-positioned card on top of the wizard. Body
 * scroll is locked while open. Closing routes back to the existing
 * Company Profile screen with all its `useState` intact.
 */
function QuickAddModal({
  onCancel,
  onImported,
}: {
  onCancel: () => void;
  onImported: (count: number) => void;
}) {
  // Lock background scroll while the modal is open.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick Add Active Jobs"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-8 sm:py-12"
      style={{ backgroundColor: "rgba(31, 27, 23, 0.55)" }}
      // Intentionally no backdrop-click-to-close — a stray click outside
      // the card could destroy typed-in job rows. Closing requires the
      // X button or "Back to Profile".
    >
      <div
        className="relative w-full max-w-[640px] rounded-2xl border bg-white px-6 py-9 sm:px-10"
        style={{
          borderColor: "#e1bfb4",
          boxShadow:
            "0 24px 64px rgba(15, 10, 5, 0.35), 0 4px 16px rgba(15, 10, 5, 0.18)",
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <QuickAddJobsScreen
          heading="Quick Add Active Jobs"
          subheading="Have jobs already in progress? Add up to 10 in one batch — you can refine details later."
          cancelLabel="Back to Profile"
          submitVerb="Import"
          onCancel={onCancel}
          onImported={onImported}
        />
      </div>
    </div>
  );
}

/**
 * Outer chrome — warm background, decorative blobs, white card. Card is
 * `wide` for screens with denser content (Quick Add, Welcome). Header
 * has a discreet "Need help?" link to /support.
 */
function Shell({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main
      className="relative flex min-h-dvh flex-col items-center justify-start overflow-hidden px-5 py-10 font-[family-name:var(--font-geist-sans)] sm:py-14"
      style={{ backgroundColor: "#fff8f4" }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #e85d26 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, #cc4911 0%, transparent 70%)" }}
        />
      </div>

      <div
        className={`relative z-10 w-full ${wide ? "max-w-[640px]" : "max-w-[560px]"}`}
      >
        <div
          className="rounded-2xl border px-6 pt-10 pb-9 sm:px-10"
          style={{
            backgroundColor: "#ffffff",
            borderColor: "#e1bfb4",
            boxShadow:
              "0 4px 32px rgba(166, 53, 0, 0.06), 0 1px 4px rgba(166, 53, 0, 0.04)",
          }}
        >
          {children}
        </div>

        <div
          className="mt-5 flex items-center justify-between px-2 text-xs"
          style={{ color: "#594139" }}
        >
          <Link
            href="/support"
            className="transition-colors hover:opacity-80"
            style={{ color: "#e85d26" }}
          >
            Need help?
          </Link>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: "#22c55e" }}
            />
            Setup secured
          </span>
        </div>
      </div>
    </main>
  );
}
