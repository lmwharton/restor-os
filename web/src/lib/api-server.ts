// Server-side API helper — used in Server Components to prefetch data
// Mirrors the client-side apiGet but uses the Supabase session from cookies.

import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiGetServer<T>(path: string): Promise<T> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { headers, cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({
      error: res.statusText,
      error_code: "UNKNOWN",
    }));
    throw new ApiError(
      res.status,
      body.error || body.detail || res.statusText,
      body.error_code || "UNKNOWN"
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
