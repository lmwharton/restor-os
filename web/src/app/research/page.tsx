import { readFile } from "fs/promises";
import path from "path";
import type { Metadata } from "next";
import { ResearchTabs } from "./tab-content";

export const metadata: Metadata = {
  title: "Research & Evidence | Crewmatic",
  description:
    "The evidence base behind Crewmatic's product decisions — competitive analysis, Xactimate codes, and TPA guidelines.",
};

export default async function ResearchPage() {
  const docsDir = path.join(process.cwd(), "..", "docs", "research");

  const [xactimateContent, tpaContent] = await Promise.all([
    readFile(path.join(docsDir, "xactimate-codes-water.md"), "utf-8"),
    readFile(path.join(docsDir, "tpa-carrier-guidelines.md"), "utf-8"),
  ]);

  const contents: Record<string, string> = {
    xactimate: xactimateContent,
    tpa: tpaContent,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-lg">
              C
            </div>
            <span className="text-2xl font-bold tracking-tight">Crewmatic</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-3">
            Research &amp; Evidence
          </h1>
          <p className="text-slate-300 text-lg sm:text-xl max-w-2xl">
            The evidence base behind Crewmatic&apos;s product decisions
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <span className="bg-blue-500/20 text-blue-200 px-3 py-1 rounded-full">
              Confidential
            </span>
            <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-full">
              Research Library
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <ResearchTabs contents={contents} />
      </div>

      {/* CTA */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="bg-slate-900 rounded-xl p-6 sm:p-8 text-center">
          <h2 className="text-white text-lg font-semibold mb-2">
            See how this research shaped the product
          </h2>
          <p className="text-slate-400 text-sm mb-5 max-w-md mx-auto">
            Every feature decision traces back to contractor interviews, market
            data, and competitive gaps documented here.
          </p>
          <a
            href="/product"
            className="inline-flex items-center gap-2 bg-blue-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
          >
            See what we&apos;re building
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-sm text-slate-500">
          <p className="font-semibold text-slate-700">Crewmatic</p>
          <p className="mt-1">crewmatic.ai &mdash; Confidential</p>
        </div>
      </footer>
    </div>
  );
}
