import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Crewmatic",
};

export default function TermsPage() {
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
          Terms of Service
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
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing or using Crewmatic (&ldquo;the Service&rdquo;), you agree to be bound by
              these Terms of Service. If you do not agree to these terms, do not use the Service.
              Crewmatic is operated by Crewmatic Technologies, Inc.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              2. Description of Service
            </h2>
            <p>
              Crewmatic provides an AI-powered field platform for water restoration contractors,
              including photo-based damage scoping, line item generation, moisture tracking, and
              documentation tools. The Service generates data intended for use with Xactimate and
              insurance workflows but is not a substitute for professional judgment.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              3. User Accounts
            </h2>
            <p>
              You must authenticate via Google OAuth to access the Service. You are responsible for
              maintaining the security of your account. Each company workspace is isolated; you may
              not access another company&apos;s data. You must be at least 18 years old to use the
              Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              4. Data Ownership
            </h2>
            <p>
              You retain ownership of all data you upload to Crewmatic, including photos, job
              records, and scope documents. Crewmatic does not sell your data. We use your data
              solely to provide and improve the Service, including training AI models to better serve
              restoration contractors.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              5. AI-Generated Content
            </h2>
            <p>
              Line items, justifications, and other AI-generated content are suggestions based on
              image analysis and industry standards (IICRC S500, OSHA). They are not guarantees of
              insurance approval. You are responsible for reviewing, editing, and approving all
              AI-generated scope data before submission to carriers or adjusters.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              6. Limitation of Liability
            </h2>
            <p>
              Crewmatic is provided &ldquo;as is&rdquo; without warranties of any kind. We are not
              liable for claim denials, scope disputes, or financial losses resulting from use of
              AI-generated content. Our total liability is limited to the fees you paid in the 12
              months preceding any claim.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              7. Termination
            </h2>
            <p>
              Either party may terminate this agreement at any time. Upon termination, you may
              export your data for 30 days. After that period, your data will be permanently
              deleted.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3" style={{ color: "#1f1b17" }}>
              8. Contact
            </h2>
            <p>
              Questions about these terms? Contact us at{" "}
              <a
                href="mailto:legal@crewmatic.ai"
                className="underline underline-offset-2"
                style={{ color: "#a63500" }}
              >
                legal@crewmatic.ai
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
