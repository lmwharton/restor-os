import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support — Crewmatic",
};

export default function SupportPage() {
  return (
    <div
      className="min-h-screen font-[family-name:var(--font-geist-sans)]"
      style={{ backgroundColor: "#fff8f4", color: "#1f1b17" }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b"
        style={{
          backgroundColor: "rgba(255,248,244,0.8)",
          borderColor: "rgba(225,191,180,0.3)",
        }}
      >
        <div className="max-w-[640px] mx-auto px-6 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="text-[17px] font-semibold tracking-[-0.45px]"
            style={{ color: "#1f1b17" }}
          >
            crewmatic
          </Link>
          <Link
            href="/login"
            className="text-[13px] font-medium transition-colors"
            style={{ color: "#a63500" }}
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="max-w-[640px] mx-auto px-6 py-12 sm:py-16">
        <h1 className="text-[32px] sm:text-[40px] font-bold tracking-[-1px] leading-tight mb-2">
          Field Support
        </h1>
        <p
          className="text-sm mb-10 font-[family-name:var(--font-geist-mono)] uppercase tracking-wider"
          style={{ color: "#594139" }}
        >
          We&apos;re here to help
        </p>

        <div
          className="rounded-xl p-8 sm:p-10 text-center"
          style={{ backgroundColor: "#ffffff", boxShadow: "0 1px 3px rgba(31,27,23,0.04), 0 8px 32px rgba(31,27,23,0.08)" }}
        >
          <div
            className="w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center"
            style={{ backgroundColor: "#f5ece6" }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="#a63500" strokeWidth="1.5" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" stroke="#a63500" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="17" r="0.5" fill="#a63500" stroke="#a63500" strokeWidth="1" />
            </svg>
          </div>

          <h2 className="text-xl font-bold mb-3" style={{ color: "#1f1b17" }}>
            Support is coming soon
          </h2>
          <p className="text-[15px] leading-relaxed mb-8 max-w-sm mx-auto" style={{ color: "#594139" }}>
            We&apos;re building a direct support channel so you can get help right from the field.
            In the meantime, reach out by email.
          </p>

          <a
            href="mailto:support@crewmatic.ai"
            className="inline-flex h-12 px-8 rounded-xl text-[15px] font-semibold text-white items-center justify-center transition-all hover:shadow-lg active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #a63500, #cc4911)" }}
          >
            support@crewmatic.ai
          </a>
        </div>
      </main>
    </div>
  );
}
