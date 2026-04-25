import { createClient } from "@/lib/supabase/server";
import { API_URL } from "@/lib/api-url";

/**
 * Authenticated fetch wrapper. Automatically extracts the Supabase JWT
 * and sends it as a Bearer token. Use from Server Components or Route Handlers.
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });
}

/**
 * Public fetch wrapper (no auth token). Use for unauthenticated endpoints.
 */
export async function apiFetchPublic(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });
}
