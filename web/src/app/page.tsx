import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crewmatic — The Operating System for Restoration Contractors",
  description:
    "AI-powered field platform for water restoration contractors. Turns damage photos into Xactimate-ready estimates with S500/OSHA justifications.",
};

function Nav() {
  return (
    <nav className="max-w-[768px] w-full mx-auto px-6 py-6 flex items-center justify-between">
      <Link
        href="/"
        className="text-[17px] font-semibold tracking-[-0.45px] text-[#1a1a1a]"
      >
        crewmatic
      </Link>
      <Link
        href="/login"
        className="text-[14px] font-medium text-[#6b6560] hover:text-[#1a1a1a] transition-colors"
      >
        Sign in
      </Link>
    </nav>
  );
}

function FeatureRow({
  icon,
  iconBg,
  title,
  description,
  link,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="flex items-start gap-4 py-6">
      <div
        className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
        style={{ backgroundColor: iconBg }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-[15px] font-semibold text-[#1a1a1a] leading-snug">
          {title}
        </h3>
        <p className="text-[14px] text-[#8a847e] leading-relaxed mt-1">
          {description}
        </p>
        {link && (
          <Link
            href={link.href}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-[#e85d26] hover:underline mt-2"
          >
            {link.label}
            <span aria-hidden="true">&rarr;</span>
          </Link>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Nav />

      {/* Hero */}
      <main className="flex-1 flex flex-col">
        <div className="max-w-[768px] w-full mx-auto px-6 pt-16 sm:pt-24 pb-12">
          {/* Eyebrow */}
          <div className="mb-6">
            <span className="inline-block text-[12px] font-semibold tracking-[0.08em] uppercase text-[#e85d26] bg-[#fff3ed] px-3 py-1.5 rounded-full">
              For Restoration Contractors
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-[40px] sm:text-[52px] font-bold tracking-[-1.5px] leading-[1.1] text-[#1a1a1a] mb-5">
            Take a photo of the damage.{" "}
            <span className="text-[#e85d26]">Get paid.</span>
          </h1>

          {/* Subtitle */}
          <p className="text-[17px] sm:text-[19px] text-[#6b6560] leading-relaxed max-w-[600px] mb-4">
            AI turns damage photos into Xactimate-ready line items with
            S500/OSHA justifications. Stop leaving money on the table.
          </p>
          <p className="text-[14px] text-[#b5b0aa]">
            Replaces 4&ndash;6 tools at $700&ndash;$1,900/mo with one app at
            $149/mo.
          </p>
        </div>

        {/* Feature rows */}
        <div className="max-w-[768px] w-full mx-auto px-6 pb-20">
          <div className="border-t border-[#eae6e1]">
            <FeatureRow
              icon={
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M4 5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Z"
                    stroke="#e85d26"
                    strokeWidth="1.5"
                  />
                  <circle cx="8" cy="8" r="1.5" fill="#e85d26" />
                  <path
                    d="M4 13l3-3 2 2 3-4 4 5"
                    stroke="#e85d26"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              }
              iconBg="#fff3ed"
              title="AI Photo Scope"
              description="Snap photos of water damage. AI generates Xactimate line items with the codes, quantities, and S500/OSHA justifications adjusters need."
              link={{ href: "/product", label: "See what we're building" }}
            />
          </div>
          <div className="border-t border-[#eae6e1]">
            <FeatureRow
              icon={
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M10 4v12M6 8l4-4 4 4"
                    stroke="#2a9d5c"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <rect
                    x="4"
                    y="14"
                    width="12"
                    height="2"
                    rx="1"
                    fill="#2a9d5c"
                  />
                </svg>
              }
              iconBg="#edf7f0"
              title="Find Hidden Revenue"
              description="AI catches the line items techs forget — HEPA filters, equipment decon, PPE, baseboards. Every missed item is money left on the table."
              link={{
                href: "/research",
                label: "See our competitive research",
              }}
            />
          </div>
          <div className="border-t border-[#eae6e1]">
            <FeatureRow
              icon={
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M10 3l1.5 4.5H16l-3.5 2.5L14 15l-4-3-4 3 1.5-5L4 7.5h4.5L10 3Z"
                    stroke="#5b6abf"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              }
              iconBg="#eef0fc"
              title="Adjuster-Proof Scope"
              description="Every line item backed by S500 and OSHA citations. When the adjuster says &ldquo;we're not paying for that,&rdquo; the justification says otherwise."
            />
          </div>
          <div className="border-t border-[#eae6e1]" />
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-[768px] w-full mx-auto px-6 pb-10">
        <div className="flex items-center gap-2 justify-center">
          <span className="w-2 h-2 rounded-full bg-[#e85d26]" />
          <span className="text-[13px] text-[#b5b0aa]">Coming soon</span>
        </div>
      </footer>
    </div>
  );
}
