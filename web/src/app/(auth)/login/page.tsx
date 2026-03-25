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

      {/* ── Card ── */}
      <div className="relative z-10 w-full max-w-[480px]">
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
