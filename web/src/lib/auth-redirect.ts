/**
 * Determines the correct redirect destination for an authenticated user.
 *
 * Spec 01I: routes against `GET /v1/company/onboarding-status` (server-
 * derived state). Returns `/onboarding` when the user hasn't yet finished
 * the wizard, otherwise `/dashboard`. On transport errors we permissively
 * return `/dashboard` so an unrelated outage doesn't strand existing
 * users at /onboarding — the protected layout will catch any real auth
 * problems on the next request.
 *
 * Used at three call sites: /login, /login `LoginForm`, and the
 * (protected)/layout.tsx gate. Single source of truth.
 */

// Backend port is 5174 per backend/CLAUDE.md (uvicorn --port 5174).
// Production sets NEXT_PUBLIC_API_URL via Vercel env vars.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5174";

interface OnboardingStatusResponse {
  step:
    | "company_profile"
    | "jobs_import"
    | "pricing"
    | "first_job"
    | "complete";
  has_company: boolean;
}

export async function getAuthenticatedRedirect(
  accessToken: string,
): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/v1/company/onboarding-status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (res.ok) {
      const data: OnboardingStatusResponse = await res.json();
      if (!data.has_company || data.step !== "complete") {
        return "/onboarding";
      }
      return "/dashboard";
    }

    // 404 = no users row yet (OAuth callback racing the user-row insert).
    // 401 = no auth user. Both → onboarding so the wizard can stand up
    // the user/company atomically.
    if (res.status === 404 || res.status === 401) {
      return "/onboarding";
    }

    // 5xx / unknown → permissive fallback so existing users aren't blocked
    // by an unrelated outage.
    return "/dashboard";
  } catch {
    return "/dashboard";
  }
}
