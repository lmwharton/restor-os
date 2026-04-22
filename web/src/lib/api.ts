// Client-side authenticated API helper for Crewmatic
// Uses Supabase JWT from the browser session

import { createClient } from "@/lib/supabase/client";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  return headers;
}

class ApiError extends Error {
  status: number;
  error_code: string;
  /**
   * Extra fields from the server's error response body (beyond `error` +
   * `error_code`). Populated for errors like 412 VERSION_STALE where the
   * server returns `current_etag` alongside the message so the client can
   * reload to the right version without another round-trip. Round 3.
   */
  body: Record<string, unknown>;

  constructor(status: number, message: string, error_code: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.error_code = error_code;
    this.body = body;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText, error_code: "UNKNOWN" }));
    throw new ApiError(
      res.status,
      body.error || res.statusText,
      body.error_code || "UNKNOWN",
      body,
    );
  }
  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Generic fetch wrappers ──────────────────────────────────────────

export async function apiGet<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}${path}`, { headers, cache: "no-store" });
  return handleResponse<T>(res);
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  /**
   * Optional additional headers. Merged into the auth headers. Round 3:
   * used for If-Match etag on floor-plan save endpoints to enable
   * optimistic-concurrency 412 VERSION_STALE rejection — see
   * `etag` on FloorPlan responses and the 412 handling at save sites.
   */
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const headers = extraHeaders ? { ...authHeaders, ...extraHeaders } : authHeaders;
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  /**
   * Optional additional headers. Mirrors `apiPost`. Reserved for
   * per-request headers (e.g., If-Match) that consumers need to
   * forward end-to-end. Kept symmetrical with apiPost so a future
   * caller threading a header through a PATCH doesn't have to retrofit
   * the wrapper first.
   */
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const headers = extraHeaders ? { ...authHeaders, ...extraHeaders } : authHeaders;
  const res = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

export async function apiDelete(path: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText, body.error_code || "UNKNOWN");
  }
}

export { ApiError };
