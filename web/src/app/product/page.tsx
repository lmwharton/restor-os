import { readFile, readdir } from "fs/promises";
import path from "path";
import Link from "next/link";
import type { Metadata } from "next";
import { ProductDesignSection, type DesignSection } from "./product-design-section";
import { RoadmapSection } from "./roadmap-section";
import { SpecCards, type SpecData } from "./spec-cards";

export const metadata: Metadata = {
  title: "Product | Crewmatic",
  description:
    "What we're building — product design, feature roadmap, and implementation specs for the AI operating system for restoration contractors.",
};

const DETAILED_SECTIONS = new Set([
  "architecture",
  "job-lifecycle",
  "key-domain-rules",
  "dependencies",
  "open-questions",
  "references",
]);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function parseDesignSections(markdown: string): DesignSection[] {
  const lines = markdown.split("\n");
  const sections: DesignSection[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];
  let started = false;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)$/);
    if (h2Match) {
      if (started && currentTitle) {
        const id = slugify(currentTitle);
        sections.push({
          id,
          title: currentTitle.replace(/\*\*/g, ""),
          content: currentLines.join("\n"),
          isDetailed: DETAILED_SECTIONS.has(id),
        });
      }
      currentTitle = h2Match[1];
      currentLines = [];
      started = true;
    } else if (started) {
      currentLines.push(line);
    }
  }

  if (currentTitle) {
    const id = slugify(currentTitle);
    sections.push({
      id,
      title: currentTitle.replace(/\*\*/g, ""),
      content: currentLines.join("\n"),
      isDetailed: DETAILED_SECTIONS.has(id),
    });
  }

  return sections;
}

async function readSpecs(
  dirName: string,
  status: "draft" | "in-progress" | "implemented"
): Promise<SpecData[]> {
  const dirPath = path.join(process.cwd(), "..", "docs", "specs", dirName);
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch {
    return [];
  }

  const specs: SpecData[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await readFile(path.join(dirPath, file), "utf-8");

    const titleMatch = content.match(/^# (.+)$/m);
    const title = titleMatch
      ? titleMatch[1].replace(/\*\*/g, "")
      : file.replace(".md", "");

    const descLines = content.split("\n");
    let description = "";
    for (const line of descLines) {
      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith(">") &&
        !trimmed.startsWith("---") &&
        !trimmed.startsWith("- [")
      ) {
        description = trimmed;
        break;
      }
    }

    if (!description) {
      for (const line of descLines) {
        const trimmed = line.trim();
        if (trimmed.startsWith(">")) {
          description = trimmed.replace(/^>\s*/, "").replace(/\*\*/g, "");
          break;
        }
      }
    }

    specs.push({ filename: file, title, status, description });
  }

  return specs.sort((a, b) => a.filename.localeCompare(b.filename));
}

export default async function ProductPage() {
  const designPath = path.join(process.cwd(), "..", "docs", "design.md");
  const designMarkdown = await readFile(designPath, "utf-8");
  const designSections = parseDesignSections(designMarkdown);

  const [draftSpecs, inProgressSpecs, implementedSpecs] = await Promise.all([
    readSpecs("draft", "draft"),
    readSpecs("in-progress", "in-progress"),
    readSpecs("implemented", "implemented"),
  ]);
  const allSpecs = [...implementedSpecs, ...inProgressSpecs, ...draftSpecs];

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Nav */}
      <nav className="max-w-[768px] w-full mx-auto px-6 py-6 flex items-center justify-between">
        <Link
          href="/"
          className="text-[17px] font-semibold tracking-[-0.45px] text-[#1a1a1a]"
        >
          crewmatic
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-[14px] font-medium text-[#6b6560] hover:text-[#1a1a1a] transition-colors"
          >
            Home
          </Link>
          <Link
            href="/research"
            className="text-[14px] font-medium text-[#6b6560] hover:text-[#1a1a1a] transition-colors"
          >
            Research
          </Link>
        </div>
      </nav>

      {/* Header */}
      <div className="max-w-[768px] w-full mx-auto px-6 pt-8 pb-4">
        <Link
          href="/research"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-[#e85d26] hover:underline mb-4"
        >
          Based on our research
          <span aria-hidden="true">&rarr;</span>
        </Link>
        <h1 className="text-[32px] sm:text-[40px] font-bold tracking-[-1.5px] text-[#1a1a1a] mb-2">
          Product
        </h1>
        <p className="text-[16px] text-[#6b6560] leading-relaxed">
          What we&apos;re building and where each piece stands.
        </p>
      </div>

      {/* Main content */}
      <main className="max-w-[768px] w-full mx-auto px-6 pb-16 flex-1">
        {/* Vision */}
        <section className="py-8 border-b border-[#eae6e1]">
          <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-3">
            Vision
          </h2>
          <p className="text-[15px] text-[#171717] leading-relaxed mb-3">
            Crewmatic is a field-first AI platform for water restoration
            contractors. It replaces 4&ndash;6 fragmented tools with a single
            app that turns damage photos into Xactimate-ready estimates, guides
            techs through scoping via voice, and automates insurance
            documentation.
          </p>
          <p className="text-[14px] text-[#8a847e] leading-relaxed">
            The AI capabilities &mdash; photo-to-line-items, auto S500/OSHA
            justifications &mdash; do not exist in any tool on the market today.
            Crewmatic complements Xactimate, never competes with it.
          </p>
        </section>

        {/* V1 Scope */}
        <section className="py-8 border-b border-[#eae6e1]">
          <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-3">
            V1 Scope
          </h2>
          <p className="text-[14px] text-[#8a847e] mb-4">
            AI Photo Scope wrapped in a minimal job management shell. The job
            shell creates stickiness and a data moat.
          </p>
          <div className="space-y-0">
            {[
              {
                name: "AI Photo Scope",
                desc: "Upload damage photos, AI generates Xactimate line items with S500/OSHA justifications",
              },
              {
                name: "Job Shell",
                desc: "Create and manage jobs with customer, address, insurance, and loss details",
              },
              {
                name: "PDF Reports",
                desc: "Company-branded scope reports with line items, justifications, and photo grids",
              },
              {
                name: "Auth",
                desc: "Email + password signup. Single user per company in V1",
              },
            ].map((item, i) => (
              <div
                key={item.name}
                className={`flex items-start gap-3 py-3 ${
                  i < 3 ? "border-b border-[#eae6e1]" : ""
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-[#edf7f0] text-[#2a9d5c] text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <span className="text-[14px] font-semibold text-[#1a1a1a]">
                    {item.name}
                  </span>
                  <span className="text-[14px] text-[#8a847e]">
                    {" "}
                    &mdash; {item.desc}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Workflows */}
        <section className="py-8 border-b border-[#eae6e1]">
          <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-3">
            Workflows
          </h2>
          <p className="text-[14px] text-[#8a847e] mb-4">
            How contractors will use Crewmatic day-to-day.
          </p>
          <div className="space-y-0">
            {[
              "A contractor takes damage photos and gets Xactimate line items with justifications in seconds",
              "A contractor creates a job from a phone call and tracks it from dispatch to payment",
              "AI catches non-obvious line items the tech would have missed (HEPA filters, baseboard removal, PPE)",
              "A contractor exports a branded PDF report for the adjuster with photos and S500 citations",
              "A contractor re-runs AI scope as more damage is discovered over multiple days",
            ].map((workflow, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 py-3 ${
                  i < 4 ? "border-b border-[#eae6e1]" : ""
                }`}
              >
                <span className="text-[14px] text-[#b5b0aa] shrink-0 mt-0.5 tabular-nums">
                  {i + 1}.
                </span>
                <p className="text-[14px] text-[#171717] leading-relaxed">
                  {workflow}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Roadmap */}
        <section className="py-8 border-b border-[#eae6e1]">
          <RoadmapSection />
        </section>

        {/* Design Document */}
        <section className="py-8 border-b border-[#eae6e1]">
          <ProductDesignSection sections={designSections} />
        </section>

        {/* Specs */}
        {allSpecs.length > 0 && (
          <section className="py-8">
            <SpecCards specs={allSpecs} />
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-[768px] w-full mx-auto px-6 pb-10">
        <div className="border-t border-[#eae6e1] pt-6 flex items-center gap-2 justify-center">
          <span className="w-2 h-2 rounded-full bg-[#e85d26]" />
          <span className="text-[13px] text-[#b5b0aa]">
            crewmatic.ai &mdash; Internal
          </span>
        </div>
      </footer>
    </div>
  );
}
