"use client";

import { useState, useMemo, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import FormField from "@/components/forms/FormField";
import { createClient } from "@/lib/supabase/client";
import { getAuthenticatedRedirect } from "@/lib/auth-redirect";

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

/**
 * Login form: email + password + Google OAuth.
 *
 * Stays deliberately quiet on errors — we use a generic
 * "Invalid email or password" message so the form doesn't leak whether
 * an account exists at the entered address.
 */
export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Prefill from ?email= so signup -> "already registered -> Sign In" feels seamless.
  const initialEmail = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");

  const [touched, setTouched] = useState({ email: false, password: false });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const fieldErrors = useMemo(() => {
    const next: { email?: string; password?: string } = {};
    if (!email) next.email = "Email is required.";
    else if (!EMAIL_REGEX.test(email))
      next.email = "Enter a valid email like name@domain.com.";
    if (!password) next.password = "Password is required.";
    return next;
  }, [email, password]);

  const isValid = !fieldErrors.email && !fieldErrors.password;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    setSubmitError(null);
    setResetMessage(null);
    setResetError(null);

    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Generic message — don't enumerate accounts.
        setSubmitError("Invalid email or password.");
        setIsSubmitting(false);
        return;
      }

      // Use the same destination logic the OAuth callback uses, so the
      // post-login route depends on whether the user has a company yet.
      const accessToken = data.session?.access_token;
      const destination = accessToken
        ? await getAuthenticatedRedirect(accessToken)
        : "/onboarding";

      // Push to the destination — its server components will see the
      // freshly-set Supabase auth cookies on their own SSR pass. No need
      // for an extra router.refresh() here (would only re-fetch the current
      // page's RSC, which is about to unmount anyway).
      router.push(destination);
    } catch (err) {
      const isOffline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      setSubmitError(
        isOffline
          ? "You appear to be offline. Check your connection and try again."
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      );
      setIsSubmitting(false);
    }
  }

  async function handleGoogle() {
    if (isGoogleLoading) return;
    setIsGoogleLoading(true);
    setSubmitError(null);
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
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Google sign-in failed.");
      setIsGoogleLoading(false);
    }
  }

  async function handleForgotPassword() {
    setResetMessage(null);
    setResetError(null);

    // Need an email to send a reset link to.
    if (!email || !EMAIL_REGEX.test(email)) {
      setTouched((t) => ({ ...t, email: true }));
      setResetError("Enter your email above first, then try again.");
      return;
    }

    if (isResetting) return;
    setIsResetting(true);

    try {
      const supabase = createClient();
      const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/callback`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) {
        setResetError(error.message || "Could not send reset email.");
      } else {
        setResetMessage(
          `If an account exists for ${email}, we've sent a password reset link.`,
        );
      }
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <FormField
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          placeholder="you@company.com"
          error={touched.email ? fieldErrors.email : undefined}
        />

        <div>
          <FormField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            placeholder="Your password"
            error={touched.password ? fieldErrors.password : undefined}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={isResetting}
              className="text-[12px] font-medium underline underline-offset-2 transition-colors hover:opacity-80 disabled:opacity-60"
              style={{ color: "#e85d26" }}
            >
              {isResetting ? "Sending…" : "Forgot password?"}
            </button>
          </div>
        </div>

        {submitError ? (
          <p role="alert" className="text-sm text-red-600 text-center">
            {submitError}
          </p>
        ) : null}

        {resetMessage ? (
          <div
            role="status"
            className="rounded-xl border px-4 py-3 text-[13px] leading-snug"
            style={{
              borderColor: "#bbe6c7",
              backgroundColor: "#f0fbf3",
              color: "#15512c",
            }}
          >
            {resetMessage}
          </div>
        ) : null}
        {resetError ? (
          <p role="alert" className="text-[12px] leading-snug text-red-600">
            {resetError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!isValid || isSubmitting}
          className="w-full h-14 rounded-xl text-[15px] font-semibold text-on-primary bg-brand-accent cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100 flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            "Sign In"
          )}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="h-px flex-1" style={{ backgroundColor: "#e1bfb4" }} />
        <span
          className="whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em] font-[family-name:var(--font-geist-mono)]"
          style={{ color: "#594139" }}
        >
          or
        </span>
        <div className="h-px flex-1" style={{ backgroundColor: "#e1bfb4" }} />
      </div>

      {/* Google */}
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

      {/* Sign up */}
      <p className="text-center text-sm" style={{ color: "#594139" }}>
        New to Crewmatic?{" "}
        <Link
          href="/signup"
          className="font-semibold underline underline-offset-2 transition-colors hover:opacity-80"
          style={{ color: "#e85d26" }}
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
