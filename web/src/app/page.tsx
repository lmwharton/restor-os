import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crewmatic — The Operating System for Restoration Contractors",
  description:
    "AI-powered field platform for water restoration contractors. Turns damage photos into Xactimate-ready estimates with S500/OSHA justifications.",
};

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Nav */}
      <nav className="max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-base">
            C
          </div>
          <span className="text-xl font-bold tracking-tight">Crewmatic</span>
        </div>
        <Link
          href="/login"
          className="text-sm font-medium text-slate-300 hover:text-white transition-colors"
        >
          Sign in
        </Link>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 -mt-16">
        <div className="max-w-3xl text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-tight">
            The Operating System for{" "}
            <span className="text-blue-400">Restoration Contractors</span>
          </h1>
          <p className="text-slate-400 text-lg sm:text-xl max-w-2xl mx-auto mb-8 leading-relaxed">
            Take a photo of the damage. Get Xactimate-ready line items with
            S500/OSHA justifications in seconds. Stop leaving money on the table.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/login"
              className="bg-blue-500 hover:bg-blue-600 text-white px-8 py-3 rounded-lg text-base font-medium transition-colors w-full sm:w-auto"
            >
              Get Started
            </Link>
            <a
              href="mailto:hello@crewmatic.ai"
              className="border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-white px-8 py-3 rounded-lg text-base font-medium transition-colors w-full sm:w-auto text-center"
            >
              Contact Us
            </a>
          </div>
        </div>

        {/* Value props */}
        <div className="max-w-4xl w-full grid sm:grid-cols-3 gap-6 mt-20">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
            <div className="text-blue-400 text-2xl mb-3">&#x1F4F7;</div>
            <h3 className="font-semibold text-base mb-2">AI Photo Scope</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Snap photos of water damage. AI generates Xactimate line items
              with the codes, quantities, and justifications adjusters need.
            </p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
            <div className="text-blue-400 text-2xl mb-3">&#x1F4B0;</div>
            <h3 className="font-semibold text-base mb-2">Find Hidden Revenue</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              AI catches the line items techs forget &mdash; HEPA filters,
              equipment decon, PPE, baseboards. Every missed item is money
              left on the table.
            </p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
            <div className="text-blue-400 text-2xl mb-3">&#x1F6E1;&#xFE0F;</div>
            <h3 className="font-semibold text-base mb-2">Adjuster-Proof Scope</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Every line item backed by S500 and OSHA citations. When the
              adjuster says &ldquo;we&apos;re not paying for that,&rdquo; the
              justification says otherwise.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-sm text-slate-600">
        <p>crewmatic.ai &mdash; Built for contractors, by contractors.</p>
      </footer>
    </div>
  );
}
