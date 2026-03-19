import { readFile } from "fs/promises";
import path from "path";
import type { Metadata } from "next";
import { CollapsibleDocument } from "./collapsible-sections";
import { parseSections } from "./parse-sections";

export const metadata: Metadata = {
  title: "Competitive Analysis & Product Strategy | Crewmatic",
  description:
    "Crewmatic competitive analysis — the AI operating system for water restoration contractors.",
};

export default async function CompetitiveAnalysisPage() {
  const filePath = path.join(
    process.cwd(),
    "..",
    "docs",
    "competitive-analysis.md"
  );
  const markdown = await readFile(filePath, "utf-8");
  const sections = parseSections(markdown);

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      {/* Header */}
      <header className="bg-slate-900 text-white print:bg-white print:text-black print:border-b-2 print:border-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-lg print:border print:border-black print:bg-white print:text-black">
              C
            </div>
            <span className="text-2xl font-bold tracking-tight">Crewmatic</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-3">
            Competitive Analysis &amp; Product Strategy
          </h1>
          <p className="text-slate-300 text-lg sm:text-xl max-w-2xl print:text-slate-600">
            crewmatic.ai &mdash; The Operating System for Restoration Contractors
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <span className="bg-blue-500/20 text-blue-200 px-3 py-1 rounded-full print:border print:border-slate-400 print:text-black">
              Confidential
            </span>
            <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-full print:border print:border-slate-400 print:text-black">
              Strategy Document
            </span>
            <span className="text-slate-500 text-xs ml-2">
              {sections.length} sections
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        <CollapsibleDocument sections={sections} />
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12 print:mt-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-sm text-slate-500">
          <p className="font-semibold text-slate-700">Crewmatic</p>
          <p className="mt-1">crewmatic.ai &mdash; Confidential</p>
        </div>
      </footer>
    </div>
  );
}
