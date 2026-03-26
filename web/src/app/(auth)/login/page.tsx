import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import SignInButton from "./sign-in-button";

/**
 * Water droplet SVG icon used in the brand wordmark.
 * Inline to avoid external component dependencies during bootstrap.
 */
function WaterDropIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 2C16 2 6 14 6 20a10 10 0 0020 0C26 14 16 2 16 2z"
        fill="#e85d26"
        opacity="0.9"
      />
      <path
        d="M16 2C16 2 6 14 6 20a10 10 0 0020 0C26 14 16 2 16 2z"
        fill="url(#dropGrad)"
      />
      <ellipse cx="12.5" cy="18" rx="2.5" ry="3.5" fill="white" opacity="0.25" />
      <defs>
        <linearGradient id="dropGrad" x1="6" y1="2" x2="26" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e85d26" stopOpacity="0" />
          <stop offset="1" stopColor="#a63500" stopOpacity="0.5" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Shield icon for the "Secure Contractor Portal" info card.
 */
function ShieldIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#a63500"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export default async function LoginPage() {
  const user = await getUser();
  if (user) {
    redirect("/jobs");
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-10 font-[family-name:var(--font-geist-sans)]" style={{ backgroundColor: "#fff8f4" }}>
      {/* ── Background decorative shapes ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {/* Top-right warm blob */}
        <div
          className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #e85d26 0%, transparent 70%)" }}
        />
        {/* Bottom-left subtle blob */}
        <div
          className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-15 blur-3xl"
          style={{ background: "radial-gradient(circle, #cc4911 0%, transparent 70%)" }}
        />
        {/* Center-right faint accent */}
        <div
          className="absolute right-1/4 top-1/2 h-48 w-48 rounded-full opacity-10 blur-3xl"
          style={{ background: "radial-gradient(circle, #a63500 0%, transparent 70%)" }}
        />
      </div>

      {/* ── Card wrapper with floating badges ── */}
      <div className="relative z-10 w-full max-w-[480px]">

        {/* Field Sync badge — bottom-left, tilted, overlapping card edge */}
        <div
          className="pointer-events-none absolute bottom-14 -left-36 z-20 flex w-[160px] flex-col gap-2 rounded-xl border p-3 sm:-left-40 sm:bottom-16 sm:w-[180px]"
          aria-hidden="true"
          style={{
            backgroundColor: "#ffffff",
            borderColor: "#e8ddd6",
            boxShadow: "0 8px 32px rgba(166, 53, 0, 0.10)",
            transform: "rotate(-6deg)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: "#fff0e8" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e85d26" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 11-6.22-8.56" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-bold font-[family-name:var(--font-geist-sans)]" style={{ color: "#1f1b17" }}>Field Sync</p>
              <p className="text-[10px] font-[family-name:var(--font-geist-sans)]" style={{ color: "#8a7060" }}>Real-time update active</p>
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: "#f0e4da" }}>
            <div className="h-full w-3/4 rounded-full" style={{ backgroundColor: "#e85d26" }} />
          </div>
        </div>

        {/* AI Moisture Analysis badge — top-right, tilted, overlapping card edge */}
        <div
          className="pointer-events-none absolute -right-4 -top-2 z-20 w-[130px] overflow-hidden rounded-xl sm:-right-16 sm:top-8 sm:w-[155px]"
          aria-hidden="true"
          style={{
            backgroundColor: "#1a8a9a",
            boxShadow: "0 8px 32px rgba(26, 138, 154, 0.25)",
            transform: "rotate(6deg)",
          }}
        >
          <div className="px-3 pt-2.5 sm:pt-3">
            <p
              className="text-[8px] font-semibold uppercase tracking-[0.1em] font-[family-name:var(--font-geist-mono)] sm:text-[9px]"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              AI Moisture Analysis
            </p>
          </div>
          <div className="px-3 pb-0.5">
            <span
              className="text-[28px] font-bold leading-none font-[family-name:var(--font-geist-mono)] sm:text-[36px]"
              style={{ color: "#ffffff" }}
            >
              42.8
            </span>
            <span
              className="text-sm font-medium font-[family-name:var(--font-geist-mono)] sm:text-lg"
              style={{ color: "rgba(255,255,255,0.8)" }}
            >
              %
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-3 pb-2.5 sm:pb-3">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#fbbf24" />
            </svg>
            <span className="text-[9px] font-semibold font-[family-name:var(--font-geist-mono)] sm:text-[10px]" style={{ color: "#fbbf24" }}>
              Saturation Alert
            </span>
          </div>
        </div>
        <div
          className="rounded-2xl border px-6 py-10 sm:px-10"
          style={{
            backgroundColor: "#ffffff",
            borderColor: "#e1bfb4",
            boxShadow: "0 4px 32px rgba(166, 53, 0, 0.06), 0 1px 4px rgba(166, 53, 0, 0.04)",
          }}
        >
          {/* Brand wordmark */}
          <div className="mb-8 flex items-center justify-center gap-2.5">
            <WaterDropIcon />
            <span
              className="text-[17px] font-semibold lowercase"
              style={{ color: "#1f1b17", letterSpacing: "-0.45px" }}
            >
              crewmatic
            </span>
          </div>

          {/* Heading */}
          <h1
            className="mb-2 text-center text-[28px] font-bold leading-tight"
            style={{ color: "#1f1b17" }}
          >
            Sign In
          </h1>
          <p
            className="mb-8 text-center text-sm leading-relaxed"
            style={{ color: "#594139" }}
          >
            The Operating System for Restoration Contractors
          </p>

          {/* Sign-in button */}
          <SignInButton />

          {/* Divider */}
          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1" style={{ backgroundColor: "#e1bfb4" }} />
            <span
              className="whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em] font-[family-name:var(--font-geist-mono)]"
              style={{ color: "#594139" }}
            >
              Precision Field Access
            </span>
            <div className="h-px flex-1" style={{ backgroundColor: "#e1bfb4" }} />
          </div>

          {/* Secure portal info card */}
          <div
            className="flex items-start gap-3 rounded-xl p-4"
            style={{ backgroundColor: "#f5ece6" }}
          >
            <div
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: "#fbf2eb" }}
            >
              <ShieldIcon />
            </div>
            <div>
              <p
                className="text-sm font-semibold leading-tight"
                style={{ color: "#1f1b17" }}
              >
                Secure Contractor Portal
              </p>
              <p
                className="mt-1 text-xs leading-relaxed"
                style={{ color: "#594139" }}
              >
                Enterprise-grade security with Google SSO. Your project data is encrypted and isolated per company.
              </p>
            </div>
          </div>

          {/* Terms footer */}
          <p
            className="mt-6 text-center text-xs leading-relaxed"
            style={{ color: "#594139" }}
          >
            By signing in you agree to our{" "}
            <a
              href="/terms"
              className="underline underline-offset-2 transition-colors hover:opacity-80"
              style={{ color: "#a63500" }}
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              className="underline underline-offset-2 transition-colors hover:opacity-80"
              style={{ color: "#a63500" }}
            >
              Privacy Policy
            </a>
          </p>
        </div>

        {/* Utility footer */}
        <div
          className="mt-5 flex items-center justify-between px-2 text-xs"
          style={{ color: "#594139" }}
        >
          <a
            href="/support"
            className="transition-colors hover:opacity-80"
            style={{ color: "#a63500" }}
          >
            Field Support
          </a>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: "#22c55e" }}
            />
            System Operational
          </span>
        </div>
      </div>
    </main>
  );
}
