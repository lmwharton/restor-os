/**
 * Onboarding wizard — client orchestrator.
 *
 * The server `page.tsx` reads `GET /v1/company/onboarding-status` and
 * passes the initial step + has_pricing flag in. Everything else lives
 * in React state — refreshing the browser re-reads from the server, so
 * we never persist screen state in URL params.
 *
 * State machine (the user-visible flow is two steps; first-job lives at
 * /dashboard not in the wizard, per UX feedback that "create your first
 * job" right after company creation is redundant — they'll do it from
 * the dashboard naturally):
 *
 *   company_profile  ─┬─►  pricing  ─►  welcome
 *                     │      ▲
 *      (link)         │      │
 *      ▼              │   "Skip"
 *   quick_add_jobs    │
 *      └──── back ────┘
 *
 * The one PATCH we make ourselves: skip-or-success on Pricing → `'complete'`.
 * Step 1 advances itself via the backend RPC (no PATCH).
 *
 * Backend `onboarding_step` enum still has a `first_job` value; the wizard
 * just never visits it. Forward-only state transitions allow `pricing` →
 * `complete` directly. If a returning user is server-side at `first_job`
 * (legacy data from before this change), we render Welcome — they're
 * effectively done.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { BrandHeader } from "./components/BrandHeader";
import { ProgressBar } from "./components/ProgressBar";
import CompanyProfileScreen from "./screens/CompanyProfileScreen";
import QuickAddJobsScreen from "./screens/QuickAddJobsScreen";
import PricingUploadScreen from "./screens/PricingUploadScreen";
import WelcomeScreen from "./screens/WelcomeScreen";
import {
  setOnboardingStep,
  type OnboardingStatus,
  type OnboardingStep,
} from "@/lib/onboarding-api";

// Phases the wizard renders. Quick-Add is a true overlay (rendered as a
// modal on top of Step 1), not its own phase — that way Step 1's form
// state survives the side trip (qa-checklist E4).
type WizardPhase = "company_profile" | "pricing" | "welcome";

function backendStepToPhase(step: OnboardingStep): WizardPhase {
  switch (step) {
    case "company_profile":
      return "company_profile";
    case "jobs_import":
      return "pricing"; // server uses this between Step 1 and 2
    case "pricing":
      return "pricing";
    case "first_job":
      return "welcome"; // legacy enum value — treat as effectively complete
    case "complete":
      return "welcome";
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

  // Company name captured at Step 1 submission so Welcome can personalize
  // ("Welcome aboard, Dry Pros!"). On resume — when the user lands on
  // Pricing/Welcome without going through Step 1 in this session — Welcome
  // fetches it lazily via /v1/me. Falls back to a generic greeting if both
  // paths fail.
  const [companyName, setCompanyName] = useState<string | null>(null);

  // Lightweight toast (e.g. "3 jobs imported successfully").
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // ─── Transitions ──────────────────────────────────────────────────

  async function handleCompanyCreated(name: string) {
    // The backend RPC creates the company + user atomically but does NOT
    // bump `users.onboarding_step` — we have to nudge it forward
    // ourselves so a refresh after Step 1 lands the user back at Step 2
    // (Pricing) instead of Step 1.
    //
    // Don't advance the local screen if the PATCH fails. Otherwise the
    // user lands on Pricing locally, then on refresh the server still
    // says they're at Step 1 and the wizard bounces them back — confusing.
    // Surface the error inline; let them retry. (PricingUploadScreen does
    // this too — be consistent.)
    try {
      await setOnboardingStep("jobs_import");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't advance onboarding step.";
      setToast({ message: msg, tone: "error" });
      return;
    }
    setCompanyName(name);
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
    // Stamp the user as 'complete' on the server so future logins skip
    // the wizard entirely. Forward-only state machine allows pricing →
    // complete (we skip the legacy first_job step). Failure surfaces as
    // a toast; we still advance locally because the user has already
    // done the work — they'll re-stamp on next visit.
    try {
      await setOnboardingStep("complete");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't finish setup.";
      setToast({ message: msg, tone: "error" });
      // Don't return — we'd trap the user. Better to render Welcome and
      // let the next API call (e.g. dashboard load) re-derive state.
    }
    // Refresh the server-side `has_pricing` so Welcome shows ✓ if the
    // user uploaded successfully. Best-effort — Welcome's own `/v1/me`
    // call also covers this on resume.
    setHasPricing((prev) => prev || true /* will refresh in WelcomeScreen */);
    setPhase("welcome");
  }

  function handlePricingBack() {
    // Backwards from Pricing isn't useful (Step 1 already created the
    // company); we still allow it because the spec lists "Back button
    // preserves data" as expected behavior.
    setPhase("company_profile");
  }

  // ─── Layout ───────────────────────────────────────────────────────

  // Welcome takes over the viewport — no progress bar.
  if (phase === "welcome") {
    return (
      <Shell wide>
        <WelcomeScreen
          companyName={companyName}
          hasPricing={hasPricing}
        />
      </Shell>
    );
  }

  const stepNumber: 1 | 2 = phase === "company_profile" ? 1 : 2;
  const phaseBadge =
    phase === "company_profile" ? <S500BadgeStep1 /> :
    phase === "pricing" ? <SmartMatchBadgeStep2 /> :
    null;

  return (
    <>
      <Shell featureBadge={phaseBadge}>
        <ProgressBar current={stepNumber} totalSteps={2} />
        <BrandHeader />

        {phase === "company_profile" ? (
          <CompanyProfileScreen
            showWelcomeBack={false /* never on Step 1 — the user is fresh */}
            onCreated={handleCompanyCreated}
            onOpenQuickAdd={handleOpenQuickAdd}
            hasCompany={initialStatus.has_company || companyName !== null}
          />
        ) : null}

        {phase === "pricing" ? (
          <PricingUploadScreen
            showWelcomeBack={showWelcomeBack}
            allowSkip
            showBack
            onBack={handlePricingBack}
            onContinue={handlePricingContinue}
            continueLabel="Finish setup"
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
 *
 * `featureBadge` overlaps the card edge with a tilted "what you'll
 * unlock" preview pill — same pattern as `/login`'s "Field Sync" +
 * "Moisture Analysis" badges. Each onboarding step previews a different
 * product moment so the journey feels exciting, not transactional.
 */
function Shell({
  children,
  wide,
  featureBadge,
}: {
  children: React.ReactNode;
  wide?: boolean;
  featureBadge?: React.ReactNode;
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
        {featureBadge}
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

// ─── Feature preview badges ──────────────────────────────────────────
// Each step shows ONE distinct product moment so the journey teases what's
// coming, not just collects data. Same visual language as login's two
// badges. All decorative — pointer-events-none, aria-hidden.

/** Step 1 preview — S500/OSHA citations as a "trust badge" pulled from a
 * future estimate. White card, brand-orange accent, tilted slightly. */
function S500BadgeStep1() {
  return (
    <div
      className="pointer-events-none absolute -right-6 top-20 z-20 w-[170px] rounded-xl border bg-white p-3 sm:-right-20 sm:top-28 sm:w-[195px]"
      aria-hidden="true"
      style={{
        borderColor: "#e8ddd6",
        boxShadow: "0 8px 32px rgba(166, 53, 0, 0.10)",
        transform: "rotate(5deg)",
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: "#fff0e8" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z"
              fill="none"
              stroke="#e85d26"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M9 12l2 2 4-4" stroke="#e85d26" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p
          className="text-[11px] font-bold leading-tight"
          style={{ color: "#1f1b17" }}
        >
          Every line item
          <br />
          S500-cited.
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <span className="rounded-full px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.04em]" style={{ backgroundColor: "#fff0e8", color: "#a63500" }}>S500</span>
        <span className="rounded-full px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.04em]" style={{ backgroundColor: "#fff0e8", color: "#a63500" }}>OSHA</span>
        <span className="rounded-full px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.04em]" style={{ backgroundColor: "#fff0e8", color: "#a63500" }}>EPA</span>
      </div>
    </div>
  );
}

/** Step 2 preview — Smart Code Match. Shows "WTR DRYOUT → matched" with a
 * count, signaling what uploaded pricing unlocks. Cyan card to differentiate
 * from Step 1 + login badges. */
function SmartMatchBadgeStep2() {
  return (
    <div
      className="pointer-events-none absolute -left-6 top-24 z-20 w-[160px] overflow-hidden rounded-xl sm:-left-24 sm:top-28 sm:w-[185px]"
      aria-hidden="true"
      style={{
        backgroundColor: "#1a8a9a",
        boxShadow: "0 8px 32px rgba(26, 138, 154, 0.25)",
        transform: "rotate(-5deg)",
      }}
    >
      <div className="px-3 pt-2.5 sm:pt-3">
        <p
          className="text-[8px] font-semibold uppercase tracking-[0.1em] font-[family-name:var(--font-geist-mono)] sm:text-[9px]"
          style={{ color: "rgba(255,255,255,0.7)" }}
        >
          Smart Code Match
        </p>
      </div>
      <div className="px-3 pb-1">
        <p
          className="text-[14px] font-bold leading-tight font-[family-name:var(--font-geist-mono)] sm:text-[15px]"
          style={{ color: "#ffffff" }}
        >
          WTR DRYOUT
        </p>
        <p
          className="text-[10px] leading-tight font-[family-name:var(--font-geist-sans)]"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          matched · your tier A price
        </p>
      </div>
      <div className="flex items-center gap-1.5 px-3 pb-2.5 sm:pb-3">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="#7be8c0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[9px] font-semibold font-[family-name:var(--font-geist-mono)] sm:text-[10px]" style={{ color: "#7be8c0" }}>
          147 of 147
        </span>
      </div>
    </div>
  );
}
