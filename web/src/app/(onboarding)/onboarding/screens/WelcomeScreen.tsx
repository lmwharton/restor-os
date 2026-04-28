/**
 * Onboarding Welcome — final celebratory screen.
 *
 * Personalized greeting using the contractor's company name. Two clear
 * actions: create a job (the thing they came here to do) or just go to
 * the dashboard.
 *
 * The first-job-during-wizard step was removed per UX feedback — felt
 * redundant after company creation. The natural place to create a job
 * is from the dashboard, where every future job will be created too.
 *
 * Company name comes from either:
 *   - the wizard's React state (set when Step 1 submitted in this session)
 *   - or a lazy GET /v1/me on mount (resume case — user came back after
 *     finishing Step 1 in a previous session)
 * If both fail (rare network case), we fall back to a generic greeting.
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { PrimaryButton, SecondaryButton } from "../components/UiBits";
import { getMyAccount, setOnboardingStep } from "@/lib/onboarding-api";

type Props = {
  /** Captured at Step 1. Null on resume — we'll fetch from /v1/me. */
  companyName: string | null;
  /** Server-derived: did pricing get uploaded? Affects the optional badge. */
  hasPricing: boolean;
};

export default function WelcomeScreen({ companyName, hasPricing }: Props) {
  const router = useRouter();

  // Belt-and-suspenders: stamp the user as 'complete' on mount.
  //
  // The wizard's `handlePricingContinue` already PATCHes 'complete' before
  // routing here, but a few legacy / edge paths land users on Welcome with
  // a non-terminal server-side step:
  //   - users mid-onboarding when the wizard rewrite shipped (server step
  //     was 'first_job', wizard renders Welcome — clicking Go to Dashboard
  //     would otherwise bounce back through the protected-layout gate)
  //   - any future code path that routes to Welcome without going through
  //     handlePricingContinue
  // Welcome IS the "you're done" surface — make the server agree. The
  // PATCH is forward-only and idempotent, so calling 'complete' when
  // already complete is a no-op.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await setOnboardingStep("complete");
      } catch {
        // Best-effort. If it fails, the user can still navigate; the next
        // protected-route load will retry status lookup. Failure here is
        // not actionable from the Welcome screen.
      }
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resume case: name wasn't passed through wizard state. Fetch from
  // /v1/me on mount. Falls back to null → generic greeting if it fails.
  const [resolvedName, setResolvedName] = useState<string | null>(companyName);
  useEffect(() => {
    if (companyName) return;
    let cancelled = false;
    (async () => {
      const account = await getMyAccount();
      if (!cancelled && account?.company?.name) {
        setResolvedName(account.company.name);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyName]);

  const greeting = resolvedName
    ? `Welcome aboard, ${resolvedName}!`
    : "Welcome to Crewmatic!";

  return (
    <div className="space-y-8 text-center sm:text-left">
      <div>
        {/*
          Celebratory hero — the official Crewmatic wordmark logo. Larger
          than the in-wizard BrandHeader so it reads as a "you've arrived"
          moment without leaning on a 🎉 emoji.
        */}
        <div className="mb-5 flex justify-center sm:justify-start" aria-hidden>
          <Image
            src="/crewmatic-logo.png"
            alt=""
            width={220}
            height={54}
            priority
            className="h-auto w-[180px] sm:w-[220px]"
          />
        </div>
        <h1
          className="text-[28px] sm:text-[32px] font-bold leading-tight"
          style={{ color: "#1f1b17" }}
        >
          {greeting}
        </h1>
        <p
          className="mt-3 text-[15px] sm:text-[16px] leading-relaxed"
          style={{ color: "#594139" }}
        >
          You&apos;re all set. From here, Crewmatic is your shop&apos;s
          command center — log jobs, capture damage, and keep your
          documentation tight for every claim.
        </p>
      </div>

      {/*
        Compact status pill — only shown if pricing is missing, since
        company profile is always done by the time we render this. Tone
        is "nudge", not "checklist." No more ✓/○ celebration list — felt
        like padding.
      */}
      {!hasPricing ? (
        <div
          className="rounded-xl border px-4 py-3 text-left"
          style={{ borderColor: "#fbcab5", backgroundColor: "#fff4ed" }}
        >
          <p className="text-[13px] font-semibold" style={{ color: "#7a2c0b" }}>
            One optional step left: pricing
          </p>
          <p
            className="mt-0.5 text-[12.5px] leading-relaxed"
            style={{ color: "#594139" }}
          >
            Upload your Xactimate price list anytime from{" "}
            <span className="font-medium">Settings → Pricing</span>{" "}
            for faster estimates. Skip for now if you don&apos;t have it
            ready.
          </p>
        </div>
      ) : null}

      <div
        className="rounded-xl border p-5 text-left"
        style={{ borderColor: "#e1bfb4", backgroundColor: "#fffaf6" }}
      >
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.12em] font-[family-name:var(--font-geist-mono)]"
          style={{ color: "#a63500" }}
        >
          What&apos;s next
        </p>
        <ul
          className="mt-3 space-y-2 text-[14px] leading-relaxed"
          style={{ color: "#1f1b17" }}
        >
          <li className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ backgroundColor: "#fde6d8", color: "#a63500" }}
            >
              1
            </span>
            <span>
              <span className="font-medium">Create your first job</span> —
              when the next call comes in, log it in seconds and start
              capturing damage photos.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ backgroundColor: "#fde6d8", color: "#a63500" }}
            >
              2
            </span>
            <span>
              <span className="font-medium">Browse jobs from the dashboard</span> —
              everything you log shows up there, ready to scope, estimate,
              and submit.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ backgroundColor: "#fde6d8", color: "#a63500" }}
            >
              3
            </span>
            <span>
              <span className="font-medium">Invite your team</span>{" "}
              when you&apos;re ready — owners and techs each get the views
              they need.
            </span>
          </li>
        </ul>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-2">
        <SecondaryButton type="button" onClick={() => router.push("/dashboard")}>
          Go to Dashboard
        </SecondaryButton>
        <PrimaryButton type="button" onClick={() => router.push("/jobs/new")}>
          Create Your First Job
          <span aria-hidden className="text-[16px]">
            &rarr;
          </span>
        </PrimaryButton>
      </div>
    </div>
  );
}
