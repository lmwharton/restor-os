/**
 * Determines the correct redirect destination for an authenticated user.
 * Returns "/jobs" if user has a company, "/onboarding" if no company (404),
 * or "/jobs" as fallback if backend is unreachable (don't block existing users).
 */
export async function getAuthenticatedRedirect(accessToken: string): Promise<string> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  try {
    const res = await fetch(`${API_URL}/v1/company`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    console.log(`[auth-redirect] GET ${API_URL}/v1/company → ${res.status}`);

    if (res.ok) {
      return "/dashboard";
    }

    // 404 = user exists but no company, 401 = user not in DB yet
    // Both mean the user needs to go through onboarding
    if (res.status === 404 || res.status === 401) {
      console.log("[auth-redirect] → /onboarding (no company)");
      return "/onboarding";
    }

    // 500 = backend error — could be expired token. Return /dashboard
    // but the protected layout will catch actual auth failures.
    console.log(`[auth-redirect] → /dashboard (status=${res.status})`);
    return "/dashboard";
  } catch (err) {
    console.log(`[auth-redirect] → /dashboard (catch: ${err})`);
    return "/dashboard";
  }
}
