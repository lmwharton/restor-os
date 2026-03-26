/**
 * Determines the correct redirect destination for an authenticated user.
 * Returns "/jobs" if user has a company, "/onboarding" otherwise.
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
  } catch {
    // Backend unreachable — safe default to onboarding
  }

  return "/onboarding";
}
