// Centralized resolution for the FastAPI backend URL.
//
// Previous shape — `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"`
// duplicated across 10 files — silently shipped a localhost fallback to
// production when a Vercel deploy was missing the env var. The page
// rendered, every fetch failed, and the only signal was the console.
//
// New rule:
//   * env var present → use it.
//   * env var missing AND NODE_ENV !== "production" → localhost
//     fallback + one-time console.warn so the dev knows.
//   * env var missing AND NODE_ENV === "production" → throw loudly
//     at module-import time. Crashes the page (root error boundary
//     catches the import-level throw on the client; the SSR pass
//     surfaces it in the Vercel build / runtime logs) so a misconfigured
//     deploy can never silently ship localhost to a real user.
//
// Imported once per file via `import { API_URL } from "@/lib/api-url"`.
// Resolution happens at module load — there's no per-call cost.

const RAW = process.env.NEXT_PUBLIC_API_URL;

function resolveApiUrl(): string {
  if (RAW && RAW.length > 0) return RAW;

  // Next.js inlines `process.env.NODE_ENV` at build time; in
  // production builds it's the literal string "production".
  if (process.env.NODE_ENV !== "production") {
    if (typeof window !== "undefined") {
      console.warn(
        "[api-url] NEXT_PUBLIC_API_URL is not set; falling back to " +
          "http://localhost:8000. Set it in .env.local to silence this.",
      );
    }
    return "http://localhost:8000";
  }

  throw new Error(
    "[api-url] NEXT_PUBLIC_API_URL is required in production but is not set. " +
      "Configure it on your Vercel project (Settings → Environment Variables) " +
      "and redeploy. Refusing to fall back to localhost.",
  );
}

export const API_URL = resolveApiUrl();
