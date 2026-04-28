import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedRedirect } from "@/lib/auth-redirect";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to Crewmatic.",
};

export default async function LoginPage() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data: { session } } = await supabase.auth.getSession();
      const destination = session?.access_token
        ? await getAuthenticatedRedirect(session.access_token)
        : "/onboarding";
      redirect(destination);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    // Supabase not configured — show login page anyway (sign-in won't work but UI is visible)
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-10 font-[family-name:var(--font-geist-sans)]" style={{ backgroundColor: "#fff8f4" }}>
      {/* ── Background decorative shapes ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {/* Top-right warm blob */}
        <div
          className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #e85d26 0%, transparent 70%)" }}
        />
        {/* Bottom-left subtle blob */}
        <div
          className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, #cc4911 0%, transparent 70%)" }}
        />
        {/* Center-right faint accent */}
        <div
          className="absolute right-1/4 top-1/2 h-48 w-48 rounded-full opacity-10 blur-3xl"
          style={{ background: "radial-gradient(circle, #a63500 0%, transparent 70%)" }}
        />
      </div>

      {/* ── Card wrapper with floating badges ── */}
      <div className="relative z-10 w-full max-w-[480px]">

        {/* Field Sync badge — bottom-left, tilted, overlapping card edge */}
        <div
          className="pointer-events-none absolute bottom-14 -left-36 z-20 flex w-[160px] flex-col gap-2 rounded-xl border p-3 sm:-left-40 sm:bottom-16 sm:w-[180px]"
          aria-hidden="true"
          style={{
            backgroundColor: "#ffffff",
            borderColor: "#e8ddd6",
            boxShadow: "0 8px 32px rgba(166, 53, 0, 0.10)",
            transform: "rotate(-6deg)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: "#fff0e8" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e85d26" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 11-6.22-8.56" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-bold font-[family-name:var(--font-geist-sans)]" style={{ color: "#1f1b17" }}>Field Sync</p>
              <p className="text-[10px] font-[family-name:var(--font-geist-sans)]" style={{ color: "#8a7060" }}>Real-time update active</p>
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: "#f0e4da" }}>
            <div className="h-full w-3/4 rounded-full" style={{ backgroundColor: "#e85d26" }} />
          </div>
        </div>

        {/* Moisture Analysis badge — top-right, tilted, overlapping card edge */}
        <div
          className="pointer-events-none absolute -right-4 -top-2 z-20 w-[130px] overflow-hidden rounded-xl sm:-right-16 sm:top-8 sm:w-[155px]"
          aria-hidden="true"
          style={{
            backgroundColor: "#1a8a9a",
            boxShadow: "0 8px 32px rgba(26, 138, 154, 0.25)",
            transform: "rotate(6deg)",
          }}
        >
          <div className="px-3 pt-2.5 sm:pt-3">
            <p
              className="text-[8px] font-semibold uppercase tracking-[0.1em] font-[family-name:var(--font-geist-mono)] sm:text-[9px]"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              Moisture Analysis
            </p>
          </div>
          <div className="px-3 pb-0.5">
            <span
              className="text-[28px] font-bold leading-none font-[family-name:var(--font-geist-mono)] sm:text-[36px]"
              style={{ color: "#ffffff" }}
            >
              42.8
            </span>
            <span
              className="text-sm font-medium font-[family-name:var(--font-geist-mono)] sm:text-lg"
              style={{ color: "rgba(255,255,255,0.8)" }}
            >
              %
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-3 pb-2.5 sm:pb-3">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#fbbf24" />
            </svg>
            <span className="text-[9px] font-semibold font-[family-name:var(--font-geist-mono)] sm:text-[10px]" style={{ color: "#fbbf24" }}>
              Saturation Alert
            </span>
          </div>
        </div>
        <div
          className="rounded-2xl border px-6 py-10 sm:px-10"
          style={{
            backgroundColor: "#ffffff",
            borderColor: "#e1bfb4",
            boxShadow: "0 4px 32px rgba(166, 53, 0, 0.06), 0 1px 4px rgba(166, 53, 0, 0.04)",
          }}
        >
          {/* Brand wordmark — official logo art. */}
          <div className="mb-8 flex items-center justify-center">
            <Image
              src="/crewmatic-logo.png"
              alt="Crewmatic"
              width={160}
              height={42}
              priority
              className="h-auto w-[140px] sm:w-[160px]"
            />
          </div>

          {/* Heading */}
          <h1
            className="mb-2 text-center text-[28px] font-bold leading-tight"
            style={{ color: "#1f1b17" }}
          >
            Sign In
          </h1>
          <p
            className="mb-8 text-center text-sm leading-relaxed"
            style={{ color: "#594139" }}
          >
            The Operating System for Restoration Contractors
          </p>

          {/* Login form (email/password + Google + forgot password + sign up link) */}
          <Suspense fallback={<div className="h-[420px]" aria-hidden="true" />}>
            <LoginForm />
          </Suspense>

          {/* Terms footer */}
          <p
            className="mt-6 text-center text-xs leading-relaxed"
            style={{ color: "#594139" }}
          >
            By signing in you agree to our{" "}
            <a
              href="/terms"
              className="underline underline-offset-2 transition-colors hover:opacity-80"
              style={{ color: "#e85d26" }}
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              className="underline underline-offset-2 transition-colors hover:opacity-80"
              style={{ color: "#e85d26" }}
            >
              Privacy Policy
            </a>
          </p>
        </div>

        {/* Utility footer */}
        <div
          className="mt-5 flex items-center justify-between px-2 text-xs"
          style={{ color: "#594139" }}
        >
          <a
            href="/support"
            className="transition-colors hover:opacity-80"
            style={{ color: "#e85d26" }}
          >
            Field Support
          </a>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: "#22c55e" }}
            />
            System Operational
          </span>
        </div>
      </div>
    </main>
  );
}
