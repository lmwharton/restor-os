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

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

    console.log(
      `[auth-redirect] GET ${API_URL}/v1/company/onboarding-status → ${res.status}`,
    );

    if (res.ok) {
      const data: OnboardingStatusResponse = await res.json();
      if (!data.has_company || data.step !== "complete") {
        console.log(
          `[auth-redirect] → /onboarding (step=${data.step} has_company=${data.has_company})`,
        );
        return "/onboarding";
      }
      return "/dashboard";
    }

    // 404 = no users row yet (OAuth callback racing the user-row insert).
    // 401 = no auth user. Both → onboarding so the wizard can stand up
    // the user/company atomically.
    if (res.status === 404 || res.status === 401) {
      console.log("[auth-redirect] → /onboarding (no user/auth row)");
      return "/onboarding";
    }

    // 5xx / unknown → permissive fallback so existing users aren't blocked
    // by an unrelated outage.
    console.log(`[auth-redirect] → /dashboard (status=${res.status})`);
    return "/dashboard";
  } catch (err) {
    console.log(`[auth-redirect] → /dashboard (catch: ${err})`);
    return "/dashboard";
  }
}
