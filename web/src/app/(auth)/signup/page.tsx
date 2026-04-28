"use client";

import { useState, useMemo, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import FormField from "@/components/forms/FormField";
import { createClient } from "@/lib/supabase/client";

function GoogleLogo() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

type FormErrors = {
  email?: string;
  password?: string;
  confirm?: string;
  terms?: string;
};

type AlreadyRegisteredError = {
  kind: "already_registered";
  email: string;
};

type ConfirmEmailNotice = {
  email: string;
};

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);

  // Track which fields the user has interacted with to avoid yelling
  // at them about empty fields they haven't touched yet.
  const [touched, setTouched] = useState<Record<keyof FormErrors, boolean>>({
    email: false,
    password: false,
    confirm: false,
    terms: false,
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [registeredError, setRegisteredError] =
    useState<AlreadyRegisteredError | null>(null);
  const [confirmNotice, setConfirmNotice] =
    useState<ConfirmEmailNotice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Validation runs every render; cheap and gives us live state.
  const errors = useMemo<FormErrors>(() => {
    const next: FormErrors = {};
    if (!email) {
      next.email = "Email is required.";
    } else if (!EMAIL_REGEX.test(email)) {
      next.email = "Enter a valid email like name@domain.com.";
    }
    if (!password) {
      next.password = "Password is required.";
    } else if (password.length < MIN_PASSWORD) {
      next.password = `Must be at least ${MIN_PASSWORD} characters.`;
    }
    if (!confirm) {
      next.confirm = "Re-enter your password.";
    } else if (confirm !== password) {
      next.confirm = "Passwords don't match.";
    }
    if (!terms) {
      next.terms = "Please agree to the Terms of Service.";
    }
    return next;
  }, [email, password, confirm, terms]);

  const isValid =
    !errors.email && !errors.password && !errors.confirm && !errors.terms;

  function markTouched(field: keyof FormErrors) {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched({ email: true, password: true, confirm: true, terms: true });
    setSubmitError(null);
    setRegisteredError(null);
    setConfirmNotice(null);

    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Login-callback route lives at /callback (within the (auth) route
          // group). The Supabase email-confirm link will redirect here, which
          // exchanges the code → session and routes the user onward via
          // getAuthenticatedRedirect (→ /onboarding for new users).
          emailRedirectTo: `${window.location.origin}/callback`,
        },
      });

      if (error) {
        // Detect "already registered" by message; only fall back to the 422
        // status code if Supabase didn't include any text. Status alone is too
        // broad — 422/400 also fire for password policy + rate limits.
        const msg = error.message?.toLowerCase() ?? "";
        const status = (error as { status?: number }).status ?? 0;
        const isDup =
          msg.includes("registered") ||
          msg.includes("already") ||
          msg.includes("exists") ||
          (msg === "" && status === 422);
        if (isDup) {
          setRegisteredError({ kind: "already_registered", email });
        } else {
          setSubmitError(error.message || "Something went wrong. Please try again.");
        }
        setIsSubmitting(false);
        return;
      }

      // Supabase may return identities=[] when an account already exists with
      // the same email but signups are configured not to leak. Treat that as a
      // duplicate too, with the same UX.
      const identities = data.user?.identities;
      if (data.user && Array.isArray(identities) && identities.length === 0) {
        setRegisteredError({ kind: "already_registered", email });
        setIsSubmitting(false);
        return;
      }

      // If the Supabase project has email-confirmation enabled, signUp succeeds
      // but no session is returned. Pushing to /onboarding now would land the
      // user on a page that immediately fails to fetch a session. Show a
      // "check your email" notice instead and let them confirm before
      // continuing. (When confirmation is disabled, data.session is set and we
      // route straight to /onboarding.)
      if (!data.session) {
        setConfirmNotice({ email });
        setIsSubmitting(false);
        return;
      }

      router.push("/onboarding");
    } catch (err) {
      const isOffline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      const fallback = isOffline
        ? "You appear to be offline. Check your connection and try again."
        : "Something went wrong. Please try again.";
      setSubmitError(err instanceof Error ? err.message || fallback : fallback);
      setIsSubmitting(false);
    }
  }

  async function handleGoogle() {
    if (isGoogleLoading) return;
    setIsGoogleLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/callback`,
        },
      });
      if (error) {
        setSubmitError(error.message);
        setIsGoogleLoading(false);
      }
      // On success, browser navigates to Google — no state reset needed.
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Google sign-in failed.");
      setIsGoogleLoading(false);
    }
  }

  return (
    <main
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-10 font-[family-name:var(--font-geist-sans)]"
      style={{ backgroundColor: "#fff8f4" }}
    >
      {/* Background blobs — same warm gradient language as /login */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #e85d26 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, #cc4911 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[480px]">

        {/*
          Floating feature badge — top-right, tilted, overlapping card edge.
          Mirrors the login page's "Field Sync" / "Moisture Analysis"
          pattern. Different feature on each auth/onboarding screen so the
          journey previews different parts of the product.
          /signup highlights Photo Scope — the headline differentiator.
          (No "AI" prefix anywhere — Crewmatic is positioned as the
          contractor's restoration partner, not an AI tool.)
        */}
        <div
          className="pointer-events-none absolute -right-4 -top-2 z-20 w-[150px] overflow-hidden rounded-xl sm:-right-20 sm:top-12 sm:w-[180px]"
          aria-hidden="true"
          style={{
            backgroundColor: "#1f1b17",
            boxShadow: "0 8px 32px rgba(31, 27, 23, 0.25)",
            transform: "rotate(6deg)",
          }}
        >
          <div className="px-3 pt-2.5 sm:pt-3">
            <p
              className="text-[8px] font-semibold uppercase tracking-[0.1em] font-[family-name:var(--font-geist-mono)] sm:text-[9px]"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              Photo Scope
            </p>
          </div>
          <div className="flex items-baseline gap-1.5 px-3 pb-1">
            <span
              className="text-[24px] font-bold leading-none font-[family-name:var(--font-geist-mono)] sm:text-[30px]"
              style={{ color: "#ffffff" }}
            >
              12
            </span>
            <span
              className="text-[10px] font-medium font-[family-name:var(--font-geist-sans)] sm:text-[12px]"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              line items
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-3 pb-2.5 sm:pb-3">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="#e85d26" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[9px] font-semibold font-[family-name:var(--font-geist-mono)] sm:text-[10px]" style={{ color: "#e85d26" }}>
              S500 cited
            </span>
          </div>
        </div>

        <div
          className="rounded-2xl border px-6 py-10 sm:px-10"
          style={{
            backgroundColor: "#ffffff",
            borderColor: "#e1bfb4",
            boxShadow:
              "0 4px 32px rgba(166, 53, 0, 0.06), 0 1px 4px rgba(166, 53, 0, 0.04)",
          }}
        >
          {/* Brand wordmark — uses the official logo art (lowercase
              "crewmatic" with droplet over the i). Replaces the prior
              SVG droplet + text combo. */}
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
            Your restoration partner starts here
          </h1>
          <p
            className="mb-8 text-center text-[15px] leading-relaxed"
            style={{ color: "#594139" }}
          >
            Damage photos in. Xactimate-ready estimates out. Built for
            restoration contractors.
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <FormField
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (registeredError) setRegisteredError(null);
                if (confirmNotice) setConfirmNotice(null);
              }}
              onBlur={() => markTouched("email")}
              placeholder="you@company.com"
              error={touched.email ? errors.email : undefined}
            />

            <FormField
              label="Password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => markTouched("password")}
              placeholder="At least 8 characters"
              helper={`Must be at least ${MIN_PASSWORD} characters.`}
              error={touched.password ? errors.password : undefined}
            />

            <FormField
              label="Confirm Password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={() => markTouched("confirm")}
              placeholder="Re-enter password"
              error={touched.confirm ? errors.confirm : undefined}
            />

            {/* Terms checkbox */}
            <div className="pt-1">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => {
                    setTerms(e.target.checked);
                    markTouched("terms");
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-outline-variant accent-[#e85d26]"
                  aria-describedby={
                    touched.terms && errors.terms ? "terms-error" : undefined
                  }
                />
                <span className="text-[13px] leading-snug text-on-surface-variant">
                  I agree to the{" "}
                  <a
                    href="#"
                    className="underline underline-offset-2 transition-colors hover:opacity-80"
                    style={{ color: "#e85d26" }}
                  >
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a
                    href="#"
                    className="underline underline-offset-2 transition-colors hover:opacity-80"
                    style={{ color: "#e85d26" }}
                  >
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>
              {touched.terms && errors.terms ? (
                <p
                  id="terms-error"
                  role="alert"
                  className="mt-1.5 ml-8 text-[12px] leading-snug text-red-600"
                >
                  {errors.terms}
                </p>
              ) : null}
            </div>

            {/* "Already registered" recovery block */}
            {registeredError ? (
              <div
                className="rounded-xl border p-4 text-sm"
                role="alert"
                style={{
                  borderColor: "#fbcab5",
                  backgroundColor: "#fff4ed",
                  color: "#7a2c0b",
                }}
              >
                <p className="font-semibold leading-snug">
                  This email is already registered.
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-on-surface-variant">
                  Sign in instead, or use a different email to start a new account.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/login?email=${encodeURIComponent(registeredError.email)}`}
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-brand-accent px-4 text-[13px] font-semibold text-white transition hover:shadow-md active:scale-[0.98]"
                  >
                    Sign In
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail("");
                      setRegisteredError(null);
                      setTouched((t) => ({ ...t, email: false }));
                    }}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-outline-variant bg-white px-4 text-[13px] font-medium text-on-surface transition hover:bg-surface-container-low active:scale-[0.98]"
                  >
                    Use Different Email
                  </button>
                </div>
              </div>
            ) : null}

            {/* Email-confirmation notice (Supabase configured to require confirm) */}
            {confirmNotice ? (
              <div
                className="rounded-xl border p-4 text-sm"
                role="status"
                style={{
                  borderColor: "#bbe6c7",
                  backgroundColor: "#f0fbf3",
                  color: "#15512c",
                }}
              >
                <p className="font-semibold leading-snug">
                  Check your email to verify your account.
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-on-surface-variant">
                  We sent a confirmation link to{" "}
                  <span className="font-semibold">{confirmNotice.email}</span>. Click it
                  to continue setting up Crewmatic.
                </p>
              </div>
            ) : null}

            {/* Generic error */}
            {submitError ? (
              <p role="alert" className="text-sm text-red-600 text-center">
                {submitError}
              </p>
            ) : null}

            {/* Submit */}
            <button
              type="submit"
              disabled={!isValid || isSubmitting}
              className="w-full h-14 rounded-xl text-[15px] font-semibold text-on-primary bg-brand-accent cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          {/* Sign-in link */}
          <p className="mt-5 text-center text-sm" style={{ color: "#594139" }}>
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold underline underline-offset-2 transition-colors hover:opacity-80"
              style={{ color: "#e85d26" }}
            >
              Sign In
            </Link>
          </p>

          {/* Divider */}
          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1" style={{ backgroundColor: "#e1bfb4" }} />
            <span
              className="whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em] font-[family-name:var(--font-geist-mono)]"
              style={{ color: "#594139" }}
            >
              or
            </span>
            <div className="h-px flex-1" style={{ backgroundColor: "#e1bfb4" }} />
          </div>

          {/* Google OAuth — same flow as /login sign-in-button */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={isGoogleLoading || isSubmitting}
            className="group relative flex h-14 w-full cursor-pointer items-center justify-center gap-3 overflow-hidden rounded-xl border bg-white text-[15px] font-semibold text-on-surface transition-all duration-200 hover:shadow-md active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait"
            style={{ borderColor: "#e1bfb4" }}
          >
            {isGoogleLoading ? (
              <span className="inline-block w-5 h-5 border-2 border-on-surface/30 border-t-on-surface rounded-full animate-spin" />
            ) : (
              <>
                <GoogleLogo />
                Continue with Google
              </>
            )}
          </button>
        </div>

        {/* Utility footer */}
        <div
          className="mt-5 flex items-center justify-between px-2 text-xs"
          style={{ color: "#594139" }}
        >
          <Link
            href="/support"
            className="transition-colors hover:opacity-80"
            style={{ color: "#e85d26" }}
          >
            Field Support
          </Link>
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
