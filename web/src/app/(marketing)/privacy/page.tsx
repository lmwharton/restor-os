import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Crewmatic",
};

export default function PrivacyPage() {
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
          Privacy Policy
        </h1>
        <p
          className="text-sm mb-10 font-[family-name:var(--font-geist-mono)] uppercase tracking-wider"
          style={{ color: "#594139" }}
        >
          Last updated: March 24, 2026
        </p>

        <div className="space-y-8 text-[15px] leading-relaxed" style={{ color: "#594139" }}>
          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              1. Information We Collect
            </h2>
            <p className="mb-3">
              We collect information you provide when using Crewmatic:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Account information from Google OAuth (name, email, profile photo)</li>
              <li>Company information you enter (company name, phone number)</li>
              <li>Job data (addresses, loss details, insurance information)</li>
              <li>Photos you upload for AI scoping</li>
              <li>Moisture readings and equipment tracking data</li>
              <li>Usage data (features used, session duration, device type)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              2. How We Use Your Information
            </h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To provide the Crewmatic service and generate AI-powered scope data</li>
              <li>To improve AI accuracy through aggregated, anonymized training data</li>
              <li>To build your company knowledge store (equipment preferences, common codes)</li>
              <li>To send service-related communications</li>
              <li>To detect and prevent fraud or abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              3. Data Storage and Security
            </h2>
            <p>
              Your data is stored in Supabase (PostgreSQL) with row-level security policies
              enforcing company-level isolation. Photos are stored in private storage buckets
              accessible only via time-limited signed URLs. All data is encrypted in transit (TLS)
              and at rest (AES-256). We do not store your Google password.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              4. Data Sharing
            </h2>
            <p className="mb-3">We do not sell your personal data. We share data only with:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                Infrastructure providers (Supabase, Vercel, Railway) as necessary to operate the
                Service
              </li>
              <li>AI providers (Anthropic) for processing photo scope requests</li>
              <li>Law enforcement when required by valid legal process</li>
            </ul>
            <p className="mt-3">
              Photos sent to AI providers are processed and not retained by them beyond the
              request lifecycle.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              5. Multi-Tenancy
            </h2>
            <p>
              Each company workspace is fully isolated. Users in one company cannot access another
              company&apos;s jobs, photos, or scope data. Row-level security policies are enforced
              at the database level.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              6. Your Rights
            </h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Access and export all your data at any time</li>
              <li>Request deletion of your account and all associated data</li>
              <li>Opt out of AI model training (your data will still be processed for scope generation)</li>
              <li>Correct inaccurate personal information</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              7. Data Retention
            </h2>
            <p>
              Active account data is retained for the duration of your subscription. Upon account
              deletion, all data is permanently removed within 30 days. Anonymized, aggregated
              data used for AI model improvement is retained indefinitely.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              8. Contact
            </h2>
            <p>
              For privacy inquiries, contact us at{" "}
              <a
                href="mailto:privacy@crewmatic.ai"
                className="underline underline-offset-2"
                style={{ color: "#a63500" }}
              >
                privacy@crewmatic.ai
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
