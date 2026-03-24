import { readFile, readdir } from "fs/promises";
import path from "path";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ProductDesignSection,
  type DesignSection,
} from "./product-design-section";
import { RoadmapSection } from "./roadmap-section";
import { SpecCards, type SpecData } from "./spec-cards";

export const metadata: Metadata = {
  title: "Product | Crewmatic",
  description:
    "What we're building — product design, feature roadmap, and implementation specs for the AI operating system for restoration contractors.",
};

// Sections from design.md that should start collapsed (detailed/long content)
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

    // Extract title from first H1
    const titleMatch = content.match(/^# (.+)$/m);
    const title = titleMatch
      ? titleMatch[1].replace(/\*\*/g, "")
      : file.replace(".md", "");

    // Extract description: first non-empty, non-heading, non-blockquote, non-hr line
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

    // Fallback: use first blockquote line if no plain text found
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
  // Read design.md
  const designPath = path.join(process.cwd(), "..", "docs", "design.md");
  const designMarkdown = await readFile(designPath, "utf-8");
  const designSections = parseDesignSections(designMarkdown);

  // Read specs from all three directories
  const [draftSpecs, inProgressSpecs, implementedSpecs] = await Promise.all([
    readSpecs("draft", "draft"),
    readSpecs("in-progress", "in-progress"),
    readSpecs("implemented", "implemented"),
  ]);
  const allSpecs = [...implementedSpecs, ...inProgressSpecs, ...draftSpecs];

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
            Product
          </h1>
          <p className="text-slate-300 text-lg sm:text-xl max-w-2xl">
            What we&apos;re building and where each piece stands
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <span className="bg-blue-500/20 text-blue-200 px-3 py-1 rounded-full">
              Internal
            </span>
            <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-full">
              {designSections.length} design sections
            </span>
            <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-full">
              {allSpecs.length} spec{allSpecs.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </header>

      {/* Navigation breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <Link
          href="/research"
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline transition-colors"
        >
          See the research behind these decisions &rarr;
        </Link>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        {/* Section 1: Product Design */}
        <section id="product-design" className="mb-16">
          <ProductDesignSection sections={designSections} />
        </section>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-16">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">
            Roadmap
          </span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        {/* Section 2: Feature Roadmap */}
        <section id="roadmap" className="mb-16">
          <RoadmapSection />
        </section>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-16">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">
            Specs
          </span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        {/* Section 3: Implementation Specs */}
        <section id="specs" className="mb-16">
          <SpecCards specs={allSpecs} />
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-sm text-slate-500">
          <p className="font-semibold text-slate-700">Crewmatic</p>
          <p className="mt-1">
            crewmatic.ai &mdash; Internal Product Reference
          </p>
        </div>
      </footer>
    </div>
  );
}
