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

    if (res.ok) {
      return "/jobs";
    }

    // Only redirect to onboarding for explicit "no company" (404)
    if (res.status === 404) {
      return "/onboarding";
    }

    // For auth errors (401/403) or server errors (5xx), fall through to /jobs
    // to avoid sending onboarded users to onboarding during outages
    return "/jobs";
  } catch {
    // Backend unreachable — don't block existing users, let protected layout handle it
    return "/jobs";
  }
}
