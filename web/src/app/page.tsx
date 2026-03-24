import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crewmatic — The Operating System for Restoration Contractors",
  description:
    "AI-powered field platform for water restoration contractors. Turns damage photos into Xactimate-ready estimates with S500/OSHA justifications.",
};

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero */}
      <header className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-xl">
              C
            </div>
            <span className="text-3xl font-bold tracking-tight">Crewmatic</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 max-w-3xl">
            The Operating System for Restoration Contractors
          </h1>
          <p className="text-slate-300 text-lg sm:text-xl max-w-2xl mb-4 leading-relaxed">
            One app. AI-powered. Turns damage photos into Xactimate-ready
            estimates with S500/OSHA justifications that adjusters can&apos;t
            deny.
          </p>
          <p className="text-slate-400 text-base max-w-2xl leading-relaxed">
            Replaces 4-6 fragmented tools ($700-1,900/mo) with a single platform
            at $149/mo. Every line item backed by industry standards. Every
            forgotten billable item caught by AI.
          </p>
        </div>
      </header>

      {/* Value chain */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 text-center text-sm font-medium text-slate-700">
            <span className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg">
              One app with AI
            </span>
            <span className="text-slate-300 hidden sm:block">&rarr;</span>
            <span className="text-slate-300 sm:hidden">&darr;</span>
            <span className="bg-slate-100 px-4 py-2 rounded-lg">
              Less documentation time
            </span>
            <span className="text-slate-300 hidden sm:block">&rarr;</span>
            <span className="text-slate-300 sm:hidden">&darr;</span>
            <span className="bg-slate-100 px-4 py-2 rounded-lg">
              Finds hidden line items
            </span>
            <span className="text-slate-300 hidden sm:block">&rarr;</span>
            <span className="text-slate-300 sm:hidden">&darr;</span>
            <span className="bg-green-50 text-green-700 px-4 py-2 rounded-lg">
              More money per job
            </span>
          </div>
        </div>
      </div>

      {/* Navigation cards */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Research card */}
          <Link
            href="/research"
            className="group bg-white rounded-xl border border-slate-200 shadow-sm p-8 hover:border-blue-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-xl group-hover:bg-blue-50 transition-colors">
                <span role="img" aria-label="research">&#x1F50D;</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900">Research</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              The evidence behind every product decision. Competitive analysis
              across 8 competitors, co-founder interview (30+ questions),
              Xactimate code database, and TPA insurance rules.
            </p>
            <ul className="text-xs text-slate-500 space-y-1.5 mb-6">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Market &amp; competition (62K businesses, $7.2B market)
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Brett Sodders interview (16 workflow validations)
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                50+ Xactimate water damage codes
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                TPA guidelines &amp; rejection patterns
              </li>
            </ul>
            <span className="text-sm text-blue-600 font-medium group-hover:underline">
              View research &rarr;
            </span>
          </Link>

          {/* Product card */}
          <Link
            href="/product"
            className="group bg-white rounded-xl border border-slate-200 shadow-sm p-8 hover:border-blue-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-xl group-hover:bg-blue-50 transition-colors">
                <span role="img" aria-label="product">&#x1F3D7;&#xFE0F;</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900">Product</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              What we&apos;re building and where each piece stands. Product
              design, architecture, V1/V2/V3 feature roadmap, and implementation
              specs with live status tracking.
            </p>
            <ul className="text-xs text-slate-500 space-y-1.5 mb-6">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                V1: AI Photo Scope + Job Shell
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                V2: Moisture tracking, voice, scheduling
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                V3: Carrier AI, rejection predictor
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Implementation specs with checklists
              </li>
            </ul>
            <span className="text-sm text-blue-600 font-medium group-hover:underline">
              View product plan &rarr;
            </span>
          </Link>
        </div>
      </div>

      {/* Key numbers */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">62K</div>
            <div className="text-xs text-slate-500 mt-1">US restoration businesses</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">$7.2B</div>
            <div className="text-xs text-slate-500 mt-1">Market size (2025)</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">0</div>
            <div className="text-xs text-slate-500 mt-1">Competitors with AI photo-to-scope</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">$149</div>
            <div className="text-xs text-slate-500 mt-1">/mo replaces $700-1,900</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-sm text-slate-500">
          <p className="font-semibold text-slate-700">Crewmatic</p>
          <p className="mt-1">crewmatic.ai &mdash; Confidential</p>
        </div>
      </footer>
    </div>
  );
}
