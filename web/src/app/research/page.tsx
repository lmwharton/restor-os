import { readFile } from "fs/promises";
import path from "path";
import type { Metadata } from "next";
import Link from "next/link";
import { parseSections } from "./components/parse-sections";
import { ResearchContent } from "./research-content";

export const metadata: Metadata = {
  title: "Research & Evidence | Crewmatic",
  description:
    "The evidence base behind Crewmatic — competitive analysis, contractor interviews, Xactimate codes, and TPA guidelines.",
};

export default async function ResearchPage() {
  const docsDir = path.join(process.cwd(), "..", "docs", "research");

  const [competitiveContent, xactimateContent, tpaContent] = await Promise.all([
    readFile(path.join(docsDir, "competitive-analysis.md"), "utf-8"),
    readFile(path.join(docsDir, "xactimate-codes-water.md"), "utf-8"),
    readFile(path.join(docsDir, "tpa-carrier-guidelines.md"), "utf-8"),
  ]);

  const competitiveSections = parseSections(competitiveContent);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Nav */}
      <nav className="max-w-[768px] w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 flex items-center justify-between">
        <Link
          href="/"
          className="text-[15px] sm:text-[17px] font-semibold tracking-[-0.45px] text-[#1a1a1a]"
        >
          crewmatic
        </Link>
        <div className="flex items-center gap-4 sm:gap-6">
          <Link
            href="/"
            className="text-[13px] sm:text-[14px] font-medium text-[#6b6560] hover:text-[#1a1a1a] transition-colors"
          >
            Home
          </Link>
          <Link
            href="/product"
            className="text-[13px] sm:text-[14px] font-medium text-[#6b6560] hover:text-[#1a1a1a] transition-colors"
          >
            Product
          </Link>
        </div>
      </nav>

      {/* Header */}
      <div className="max-w-[768px] w-full mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-8">
        <h1 className="text-[32px] sm:text-[40px] font-bold tracking-[-1.5px] text-[#1a1a1a] mb-2">
          Research &amp; Evidence
        </h1>
        <p className="text-[16px] text-[#6b6560] leading-relaxed">
          Competitive analysis, contractor interviews, market data, and
          industry reference material.
        </p>
      </div>

      {/* Main content */}
      <main className="max-w-[768px] w-full mx-auto px-4 sm:px-6 pb-16 flex-1">
        <ResearchContent
          competitiveSections={competitiveSections}
          xactimateContent={xactimateContent}
          tpaContent={tpaContent}
        />
      </main>

      {/* Footer */}
      <footer className="max-w-[768px] w-full mx-auto px-4 sm:px-6 pb-10">
        <div className="border-t border-[#eae6e1] pt-6 flex items-center gap-2 justify-center">
          <span className="w-2 h-2 rounded-full bg-[#e85d26]" />
          <span className="text-[13px] text-[#b5b0aa]">
            crewmatic.ai &mdash; Confidential
          </span>
        </div>
      </footer>
    </div>
  );
}
