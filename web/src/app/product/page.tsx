import { readFile, readdir } from "fs/promises";
import path from "path";
import Link from "next/link";
import type { Metadata } from "next";
import { ProductDesignSection, type DesignSection } from "./product-design-section";
import { ProductFunctionalities } from "./product-functionalities";
import { SpecCards, type SpecData } from "./spec-cards";

export const metadata: Metadata = {
  title: "Product | Crewmatic",
  description:
    "The complete product vision — every functionality a restoration contractor needs, from first call to getting paid.",
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

const LIFECYCLE_STEPS = [
  { label: "Call Comes In", sub: "Customer or TPA" },
  { label: "Create Job", sub: "Name, address, insurance" },
  { label: "Dispatch Tech", sub: "Schedule + notify" },
  { label: "Arrive & Assess", sub: "Walk site, ID damage" },
  { label: "Document", sub: "Photos, voice, sketches" },
  { label: "AI Scope", sub: "Photos → line items" },
  { label: "Demo & Dry", sub: "Equipment + monitoring" },
  { label: "Daily Logs", sub: "Readings + progress" },
  { label: "Review & QA", sub: "Owner checks work" },
  { label: "Generate Report", sub: "PDF + justifications" },
  { label: "Submit to Adjuster", sub: "Auto progress updates" },
  { label: "Get Paid", sub: "Clean docs = faster pay" },
];

const MOAT_ITEMS = [
  {
    name: "AI Photo Scope",
    desc: "Damage photos → Xactimate line items with S500/OSHA justifications. No competitor offers this.",
  },
  {
    name: "AI Hazmat Scanner",
    desc: "Auto-flags asbestos-risk materials and lead paint in every photo. No competitor offers this.",
  },
  {
    name: "S500/OSHA Auto-Justifications",
    desc: "Every line item auto-backed by industry standard citations. Adjusters can't deny what OSHA requires.",
  },
  {
    name: "Auto Adjuster Reports",
    desc: "Daily progress auto-sent to adjusters with limited-access secure link. No competitor automates this.",
  },
  {
    name: "AI Completeness Check",
    desc: "Before submission, AI reviews scope for missing items — baseboard removal, HEPA filters, consumables, PPE.",
  },
];

const PLATFORM_BLOCKS = [
  {
    title: "Field Capture",
    items: ["Photo Documentation", "Voice Scoping", "Manual Scoping", "Room Sketching", "Moisture Readings", "Equipment Logging"],
    color: "border-[#2a9d5c]",
    bg: "bg-[#f6faf7]",
  },
  {
    title: "AI Engine",
    items: ["Photo → Line Items", "Hazmat Detection", "S500/OSHA Citations", "Completeness Check", "Non-Obvious Items"],
    color: "border-[#7c5cbf]",
    bg: "bg-[#f8f5ff]",
  },
  {
    title: "Operations",
    items: ["Job Management", "Scheduling & Dispatch", "Team Management", "Daily Monitoring", "Job Review & QA"],
    color: "border-[#e85d26]",
    bg: "bg-[#fff8f5]",
  },
  {
    title: "Output & Revenue",
    items: ["PDF Reports", "ESX Export", "Auto Adjuster Reports", "Customer Portal", "Dashboard & Metrics"],
    color: "border-[#3b82f6]",
    bg: "bg-[#f5f8ff]",
  },
];

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
            href="/research"
            className="text-[13px] sm:text-[14px] font-medium text-[#6b6560] hover:text-[#1a1a1a] transition-colors"
          >
            Research
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-[768px] w-full mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-2">
        <Link
          href="/research"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-[#e85d26] hover:underline mb-4"
        >
          Based on 16 validated workflows from co-founder interviews
          <span aria-hidden="true">&rarr;</span>
        </Link>
        <h1 className="text-[32px] sm:text-[40px] font-bold tracking-[-1.5px] text-[#1a1a1a] mb-3">
          The Complete Product
        </h1>
        <p className="text-[16px] text-[#171717] leading-relaxed mb-2">
          Crewmatic replaces 4&ndash;6 fragmented tools with a single
          field-first AI platform. A contractor opens one app to capture photos,
          scope damage by voice, track moisture and equipment, generate
          Xactimate-ready reports, and get paid faster.
        </p>
        <p className="text-[14px] text-[#8a847e] leading-relaxed">
          13 functionalities covering all 16 validated workflows. From the first
          emergency call to the final payment &mdash; nothing is left out.
        </p>
      </div>

      {/* Main content */}
      <main className="max-w-[768px] w-full mx-auto px-4 sm:px-6 pb-16 flex-1">
        {/* Platform Block Diagram */}
        <section className="py-8 border-b border-[#eae6e1]">
          <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-2">
            Platform Overview
          </h2>
          <p className="text-[14px] text-[#8a847e] mb-5">
            Four pillars that make up the operating system for restoration contractors.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PLATFORM_BLOCKS.map((block) => (
              <div
                key={block.title}
                className={`${block.bg} border-l-2 ${block.color} rounded-r-lg px-3 py-3`}
              >
                <h3 className="text-[13px] font-semibold text-[#1a1a1a] mb-2">
                  {block.title}
                </h3>
                <ul className="space-y-1">
                  {block.items.map((item) => (
                    <li
                      key={item}
                      className="text-[11px] text-[#6b6560] leading-snug"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* End-to-End Lifecycle */}
        <section className="py-8 border-b border-[#eae6e1]">
          <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-2">
            The Full Job Lifecycle
          </h2>
          <p className="text-[14px] text-[#8a847e] mb-5">
            Every water damage job follows this arc. Crewmatic covers every step.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {LIFECYCLE_STEPS.map((step, i) => (
              <div
                key={step.label}
                className="relative px-2.5 py-2.5 bg-[#faf9f7] rounded-lg border border-[#eae6e1]"
              >
                <span className="text-[10px] font-mono text-[#b5b0aa] block mb-0.5">
                  {i + 1}
                </span>
                <p className="text-[12px] font-semibold text-[#1a1a1a] leading-snug">
                  {step.label}
                </p>
                <p className="text-[10px] text-[#8a847e] leading-snug mt-0.5">
                  {step.sub}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 px-3 py-2.5 bg-[#fff8f5] border-l-2 border-[#e85d26] rounded-r">
            <p className="text-[12px] text-[#6b6560] leading-relaxed">
              <span className="font-semibold text-[#1a1a1a]">Two payment paths:</span>{" "}
              TPA path (Alacrity, Accuserve, Sedgwick) &mdash; stricter review, faster payment.
              Independent path &mdash; less strict, but typical delay is January job &rarr; April payment.
              Clean documentation with S500/OSHA justifications wins on both paths.
            </p>
          </div>
        </section>

        {/* All Functionalities */}
        <section className="py-8 border-b border-[#eae6e1]">
          <ProductFunctionalities />
        </section>

        {/* Competitive Moat */}
        <section className="py-8 border-b border-[#eae6e1]">
          <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-2">
            What No Competitor Has
          </h2>
          <p className="text-[14px] text-[#8a847e] mb-5">
            Five capabilities that create a defensible moat. No tool on the market today offers any of these.
          </p>

          <div className="space-y-0">
            {MOAT_ITEMS.map((item, i) => (
              <div
                key={item.name}
                className={`flex items-start gap-3 py-3 ${
                  i < MOAT_ITEMS.length - 1 ? "border-b border-[#eae6e1]" : ""
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-[#fff3ed] text-[#e85d26] text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <span className="text-[14px] font-semibold text-[#1a1a1a]">
                    {item.name}
                  </span>
                  <span className="text-[13px] text-[#6b6560]">
                    {" "}&mdash; {item.desc}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* The ROI Case */}
        <section className="py-8 border-b border-[#eae6e1]">
          <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-3">
            The ROI Case
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="px-3 py-3 bg-[#faf9f7] rounded-lg border border-[#eae6e1]">
              <p className="text-[22px] font-bold text-[#1a1a1a] tracking-[-0.5px]">
                30%
              </p>
              <p className="text-[12px] text-[#8a847e]">
                of a contractor&apos;s day is documentation
              </p>
            </div>
            <div className="px-3 py-3 bg-[#faf9f7] rounded-lg border border-[#eae6e1]">
              <p className="text-[22px] font-bold text-[#1a1a1a] tracking-[-0.5px]">
                2&ndash;4 hrs
              </p>
              <p className="text-[12px] text-[#8a847e]">
                per job for manual Xactimate entry
              </p>
            </div>
            <div className="px-3 py-3 bg-[#faf9f7] rounded-lg border border-[#eae6e1]">
              <p className="text-[22px] font-bold text-[#1a1a1a] tracking-[-0.5px]">
                $149/mo
              </p>
              <p className="text-[12px] text-[#8a847e]">
                replaces $700&ndash;$1,900/mo in tools
              </p>
            </div>
            <div className="px-3 py-3 bg-[#faf9f7] rounded-lg border border-[#eae6e1]">
              <p className="text-[22px] font-bold text-[#1a1a1a] tracking-[-0.5px]">
                Day 1
              </p>
              <p className="text-[12px] text-[#8a847e]">
                ROI payback &mdash; 3 hrs saved at $50/hr
              </p>
            </div>
          </div>
          <div className="mt-4 px-3 py-2.5 bg-[#faf9f7] rounded-lg border border-[#eae6e1]">
            <p className="text-[12px] text-[#8a847e] italic leading-relaxed">
              &ldquo;$149/mo is a no-brainer. I would absolutely pay it. I would
              pay more than that.&rdquo;
            </p>
            <p className="text-[11px] text-[#b5b0aa] mt-1">
              &mdash; Brett Sodders, Co-founder &amp; 15-year restoration veteran
            </p>
          </div>
        </section>

        {/* Market Opportunity */}
        <section className="py-8 border-b border-[#eae6e1]">
          <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-3">
            Market
          </h2>
          <div className="space-y-0">
            {[
              { label: "US restoration businesses", value: "62,582" },
              { label: "With <50 employees (Census 2022)", value: "94.6%" },
              { label: "US restoration services market", value: "$7.2B" },
              { label: "Software TAM (US)", value: "$225M–$600M/yr" },
              { label: "Current contractor tool spend", value: "$700–$1,900/mo" },
              { label: "AI adoption in restoration", value: "Near zero" },
              { label: "Competitors with photo-to-line-items", value: "Zero" },
            ].map((item, i) => (
              <div
                key={item.label}
                className={`flex flex-col sm:flex-row sm:items-center sm:justify-between py-2.5 gap-0.5 sm:gap-4 ${
                  i < 5 ? "border-b border-[#f0ede9]" : ""
                }`}
              >
                <span className="text-[12px] sm:text-[13px] text-[#6b6560]">{item.label}</span>
                <span className="text-[13px] font-semibold text-[#1a1a1a] tabular-nums shrink-0">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Platform Roadmap */}
        <section className="py-8 border-b border-[#eae6e1]">
          <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-2">
            Platform Roadmap
          </h2>
          <p className="text-[14px] text-[#8a847e] mb-5">
            Crewmatic starts with water restoration, then expands into adjacent
            trades. Each vertical shares the same core engine &mdash; what
            changes is the data model, AI prompts, and document outputs.
          </p>

          <div className="space-y-3">
            {[
              {
                phase: "V1",
                label: "Now",
                title: "Water Restoration",
                desc: "AI Photo Scope, job management, moisture tracking, PDF reports, adjuster portal. The foundation everything else builds on.",
                color: "bg-[#2a9d5c]",
                border: "border-[#2a9d5c]",
                bg: "bg-[#f6faf7]",
              },
              {
                phase: "V2",
                label: "Next",
                title: "Insurance Repair (Reconstruction)",
                desc: "Post-mitigation rebuild scoping. Same adjusters, same Xactimate language. Supplement management, code upgrade tracking, O&P monitoring, ACV/RCV holdback tracking. Turns Crewmatic from a mitigation tool into a full-lifecycle claim tool.",
                color: "bg-[#e85d26]",
                border: "border-[#e85d26]",
                bg: "bg-[#fff8f5]",
              },
              {
                phase: "V3",
                label: "Future",
                title: "Remodeling",
                desc: "Proposal generator (voice to line-item), change order workflows, permit/inspection tracking, subcontractor coordination, punch lists, lien waiver management. No adjuster \u2014 customer is the decision-maker.",
                color: "bg-[#7c5cbf]",
                border: "border-[#7c5cbf]",
                bg: "bg-[#f8f5ff]",
              },
              {
                phase: "V4",
                label: "Future",
                title: "Plumbing",
                desc: "Photo diagnostic engine, water heater EOL detection, whole-house repipe trigger, source-of-loss referrals back to restoration. Service call + project modes.",
                color: "bg-[#3b82f6]",
                border: "border-[#3b82f6]",
                bg: "bg-[#f5f8ff]",
              },
              {
                phase: "V5",
                label: "Future",
                title: "Electrical",
                desc: "Panel photo diagnosis (flags Federal Pacific, Zinsco, double-taps, heat damage), load calculation assistant, EV charger and generator install workflows, hazard documentation.",
                color: "bg-[#eab308]",
                border: "border-[#eab308]",
                bg: "bg-[#fefce8]",
              },
              {
                phase: "V6",
                label: "Future",
                title: "HVAC",
                desc: "Symptom-to-diagnosis engine, system replacement triggers, maintenance visit autopilot, contract management, equipment EOL alerts. Most unique data model \u2014 recurring visits and maintenance contracts.",
                color: "bg-[#ec4899]",
                border: "border-[#ec4899]",
                bg: "bg-[#fdf2f8]",
              },
            ].map((item) => (
              <div
                key={item.phase}
                className={`${item.bg} border-l-2 ${item.border} rounded-r-lg px-3 py-3`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`${item.color} text-white text-[10px] font-bold px-1.5 py-0.5 rounded`}
                  >
                    {item.phase}
                  </span>
                  <span className="text-[10px] font-medium text-[#8a847e] uppercase tracking-wider">
                    {item.label}
                  </span>
                </div>
                <h3 className="text-[14px] font-semibold text-[#1a1a1a] mb-1">
                  {item.title}
                </h3>
                <p className="text-[12px] text-[#6b6560] leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Cross-Trade Network */}
          <div className="mt-5 px-3 py-3 bg-[#faf9f7] rounded-lg border border-[#eae6e1]">
            <h3 className="text-[13px] font-semibold text-[#1a1a1a] mb-1">
              The Network Effect
            </h3>
            <p className="text-[12px] text-[#6b6560] leading-relaxed">
              Every trade on the platform becomes a lead source for every other
              trade. Plumber finds a burst pipe &rarr; one-tap refers restoration
              job. HVAC tech finds condensate damage &rarr; refers restoration.
              Electrician finds moisture near wiring &rarr; refers restoration.
              The more trades, the more valuable the platform becomes for
              everyone on it.
            </p>
          </div>

          <p className="text-[11px] text-[#b5b0aa] mt-3 italic">
            Source: Co-founder product vision session, March 2026.
            Full research in docs/research/multi-trade-expansion.md
          </p>
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
      <footer className="max-w-[768px] w-full mx-auto px-4 sm:px-6 pb-10">
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
