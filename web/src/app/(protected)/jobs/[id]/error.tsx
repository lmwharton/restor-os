"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function JobDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[job-detail] Unhandled error:", error);
  }, [error]);

  // Check if this looks like a 404 (job not found)
  const isNotFound =
    error.message.toLowerCase().includes("not found") ||
    error.message.includes("404");

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div
        className="w-full max-w-md rounded-2xl border p-8 text-center"
        style={{
          backgroundColor: "var(--surface-container-low)",
          borderColor: "var(--outline-variant)",
        }}
      >
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--error-container)" }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--error)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {isNotFound ? (
              <>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </>
            ) : (
              <>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </>
            )}
          </svg>
        </div>

        <h2
          className="mb-2 text-lg font-semibold"
          style={{ color: "var(--on-surface)" }}
        >
          {isNotFound ? "Job not found" : "Failed to load job"}
        </h2>

        <p
          className="mb-6 text-sm leading-relaxed"
          style={{ color: "var(--on-surface-variant)" }}
        >
          {isNotFound
            ? "This job may have been deleted or you don't have access to it."
            : error.message || "An unexpected error occurred while loading this job."}
        </p>

        <div className="flex items-center justify-center gap-3">
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--outline-variant)",
              color: "var(--on-surface)",
            }}
          >
            Back to Jobs
          </Link>

          {!isNotFound && (
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2"
              style={{
                backgroundColor: "var(--brand-accent)",
                color: "var(--on-primary)",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Try Again
            </button>
          )}
        </div>

        {error.digest && (
          <p
            className="mt-4 text-xs"
            style={{ color: "var(--outline)" }}
          >
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
