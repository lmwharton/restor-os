"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Section } from "./parse-sections";

const GROUP_LABELS = [
  "Overview",
  "Market & Competition",
  "Product",
  "Go-to-Market",
  "Validation",
  "Workflows",
] as const;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (children == null) return "";
  if (Array.isArray(children))
    return children.map(extractTextFromChildren).join("");
  if (typeof children === "object" && "props" in children) {
    return extractTextFromChildren(
      (children as React.ReactElement<{ children?: React.ReactNode }>).props
        .children
    );
  }
  return "";
}

const SECTION_SUMMARIES: Record<string, string> = {
  "executive-summary":
    "$180-360M TAM · $149/mo vs $700-1,900/mo · 0 competitors with AI photo-to-Xactimate",
  "the-contractors-reality":
    "30% documentation / 70% field · Scheduling is #1 pain · Tool fragmentation leads to paper",
  "the-problem":
    "4-6 tools at $700-1,900/mo · 2-4 hours manual Xactimate entry per job",
  "market-opportunity":
    "62,582 US restoration businesses · $7.2B market · 4.3% YoY growth",
  "competitor-deep-dive":
    "Encircle (CRITICAL) · DASH/Mitigate · Albi · PSA · JobSight · DocuSketch · magicplan",
  "feature-matrix":
    "24 features compared across 8 competitors · 3 features only Crewmatic has",
  "workflow-level-competitive-comparison":
    "16 workflows compared · 5 where Crewmatic has zero competition",
  "what-were-building":
    "AI Photo Scope · Voice Scoping · Site Log · Sketching · Job Mgmt · Reports · Hazmat Scanner",
  pricing:
    "Solo $49 · Team $149 · Pro $299 · Enterprise custom + Hazmat marketplace revenue",
  "strategy-to-win":
    "Lead with magic moment · Complement Xactimate · Win on price · Voice-first · FOMO lever",
  "xactimate-integration-strategy":
    "V1: ESX file generation (no partnership needed) · V2: ESX import · V3: Verisk TPI partnership",
  "distribution-channels":
    "Facebook groups · YouTube/TikTok · IICRC conferences · Supply distributors · Referrals",
  "expansion-roadmap":
    "V1 Water then V2 Fire then V3 Mold then V4 Contents then V5 Adjacent trades",
  risks:
    "7 risks tracked · Encircle AI live · Speed to market · MICA mandates",
  "strategic-intelligence-verisk--the-xactimate-moat":
    "Verisk $31B · Xactimate $350/mo · Failed AccuLynx deal · Crowdsourced pricing opportunity",
  "appendix-a-contractor-interview--brett-sodders-co-founder":
    "30 Q&As · Feature priorities · Pricing validation · Competitive insights",
  "appendix-b-workflow-review--validation-questions":
    "16 workflow descriptions with 35+ validation questions for Brett",
  "workflow-1-new-job-creation":
    "Cat/class NOT needed on first call · Two-phase create: quick dispatch then full details on site",
  "workflow-2-job-site-arrival":
    "Empathy first, documentation second · Sketch on first visit · Safety checklist NOT needed in V1",
  "workflow-3-voice-guided-scoping":
    "Voice hugely desired — hands occupied with gloves/mask · Accuracy is the hard gate",
  "workflow-4-manual-scoping-keyboard":
    "Keyboard fallback for noisy environments · Room-by-room entry",
  "workflow-5-moisture-reading-collection":
    "Atmospheric + point readings · Compare to yesterday's readings · Drying progress tracking",
  "workflow-6-equipment-placement--tracking":
    "Dehu/fan placement · Equipment logs for billing · Move/swap tracking",
  "workflow-7-photo-documentation":
    "Techs take photos while owner scopes · Before/during/after required · Auto-tag to rooms",
  "workflow-8-ai-photo-scope":
    "Non-obvious line items are the real value · Must find what techs miss · Game changer if accurate",
  "workflow-9-daily-monitoring-dry-log":
    "1-3 days monitoring after day-1 work · Check readings, adjust equipment · Quick in/out visits",
  "workflow-10-report-generation":
    "PDF is default · Must match what adjusters expect · Auto-generate from collected data",
  "workflow-10b-auto-adjuster-reports":
    "Auto-send daily updates to adjusters · Speeds payment · Builds trust",
  "workflow-11-job-scheduling--dispatch":
    "Scheduling is #1 pain · Right vehicle + equipment to right job · Replace 11pm texting",
  "workflow-12-team-management":
    "Roles: owner > admin > tech · Tech permissions · Activity tracking",
  "workflow-13-job-review--qa":
    "Owner reviews tech work · Catch missing line items · Quality gate before submission",
  "workflow-14-dashboard":
    "Guided workflow > feature dashboard · 3 KPIs: jobs/month, revenue, days to payment",
  "workflow-15-the-whole-job--end-to-end":
    "Full job walkthrough · TPA vs independent paths · Post-job payment fight · Supply inventory gap",
  "workflow-16-what-we-havent-thought-of":
    "Contents is separate business · Digital contracts expected · 50-50 mitigation vs rebuild split",
  "thank-you":
    "W15 end-to-end walkthrough is the most valuable single answer",
};

function getSummary(id: string): string {
  return SECTION_SUMMARIES[id] || "";
}

const PROSE_CLASSES =
  "prose prose-sm max-w-none prose-headings:text-[#1a1a1a] prose-headings:scroll-mt-8 prose-h3:text-base prose-h3:font-semibold prose-h3:mt-8 prose-h3:mb-3 prose-h4:text-sm prose-h4:font-semibold prose-h4:mt-6 prose-h4:mb-2 prose-p:text-[13px] prose-p:leading-relaxed prose-p:text-[#171717] prose-li:text-[13px] prose-li:text-[#171717] prose-li:marker:text-[#b5b0aa] prose-table:text-xs prose-th:bg-[#1a1a1a] prose-th:text-white prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:text-[#171717] prose-td:border-[#eae6e1] prose-tr:border-[#eae6e1] even:prose-tr:bg-[#faf9f7] prose-blockquote:border-[#e85d26] prose-blockquote:bg-[#fff3ed] prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:text-sm prose-blockquote:not-italic prose-strong:text-[#1a1a1a] prose-a:text-[#e85d26] prose-a:no-underline hover:prose-a:underline prose-pre:bg-[#faf9f7] prose-pre:text-[#171717] prose-pre:border prose-pre:border-[#eae6e1] prose-pre:rounded-lg prose-pre:text-xs prose-code:bg-[#faf9f7] prose-code:text-[#171717] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-hr:border-[#eae6e1] prose-hr:my-6";

// Strip file path links from markdown content
function stripFilePathLinks(content: string): string {
  // Remove markdown links that point to local file paths
  return content
    .replace(/\[([^\]]+)\]\([^)]*\.md[^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(competitive-analysis\.md[^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(research\/[^)]*\)/g, "$1");
}

export function CollapsibleDocument({
  sections,
}: {
  sections: Section[];
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(["executive-summary"])
  );

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setOpenSections(new Set(sections.map((s) => s.id)));
  }, [sections]);

  const collapseAll = useCallback(() => {
    setOpenSections(new Set());
  }, []);

  // Group sections by their groupLabel
  const grouped = GROUP_LABELS.map((label) => {
    const groupSections = sections.filter((s) => s.groupLabel === label);
    return { label, sections: groupSections };
  }).filter((g) => g.sections.length > 0);

  return (
    <div>
      {/* Expand/Collapse controls */}
      <div className="flex items-center justify-end gap-1 mb-4">
        <button
          onClick={expandAll}
          className="text-[12px] text-[#b5b0aa] hover:text-[#e85d26] px-2 py-1 rounded hover:bg-[#fff3ed] transition-colors"
        >
          Expand all
        </button>
        <span className="text-[#eae6e1]">|</span>
        <button
          onClick={collapseAll}
          className="text-[12px] text-[#b5b0aa] hover:text-[#e85d26] px-2 py-1 rounded hover:bg-[#fff3ed] transition-colors"
        >
          Collapse all
        </button>
      </div>

      <div className="space-y-8">
        {grouped.map((group) => (
          <div key={group.label}>
            {/* Group header */}
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#b5b0aa]">
                {group.label}
              </h3>
              <div className="flex-1 h-px bg-[#eae6e1]" />
            </div>

            <div className="space-y-0">
              {group.sections.map((section) => {
                const isOpen = openSections.has(section.id);
                const summary = getSummary(section.id);

                return (
                  <div
                    key={section.id}
                    id={`section-${section.id}`}
                    className="scroll-mt-6 border-b border-[#eae6e1] last:border-b-0"
                  >
                    {/* Section header */}
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="w-full text-left py-4 flex items-start gap-3 group"
                    >
                      <span
                        className={`mt-1 text-[10px] text-[#b5b0aa] group-hover:text-[#e85d26] transition-all duration-200 ${
                          isOpen ? "rotate-90 text-[#e85d26]" : ""
                        }`}
                      >
                        &#9654;
                      </span>
                      <div className="flex-1 min-w-0">
                        <h4
                          className={`text-[15px] font-semibold leading-snug transition-colors ${
                            isOpen
                              ? "text-[#1a1a1a]"
                              : "text-[#1a1a1a] group-hover:text-[#e85d26]"
                          }`}
                        >
                          {section.title}
                        </h4>
                        {summary && !isOpen && (
                          <p className="text-[12px] text-[#8a847e] mt-1 leading-relaxed truncate">
                            {summary}
                          </p>
                        )}
                      </div>
                    </button>

                    {/* Section content */}
                    {isOpen && (
                      <div className="pb-6 pl-7">
                        <div className="border-t border-[#eae6e1] pt-5">
                          <div className={PROSE_CLASSES}>
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                h3: ({ children }) => {
                                  const text =
                                    typeof children === "string"
                                      ? children
                                      : extractTextFromChildren(children);
                                  const id = slugify(text);
                                  return (
                                    <h3 id={id} className="scroll-mt-8">
                                      {children}
                                    </h3>
                                  );
                                },
                                h4: ({ children }) => {
                                  const text =
                                    typeof children === "string"
                                      ? children
                                      : extractTextFromChildren(children);
                                  const id = slugify(text);
                                  return (
                                    <h4 id={id} className="scroll-mt-8">
                                      {children}
                                    </h4>
                                  );
                                },
                                table: ({ children }) => (
                                  <div className="overflow-x-auto my-4 rounded-lg border border-[#eae6e1]">
                                    <table className="min-w-full">
                                      {children}
                                    </table>
                                  </div>
                                ),
                                a: ({ href, children }) => {
                                  // Strip links to local file paths
                                  if (
                                    href &&
                                    (href.endsWith(".md") ||
                                      href.includes(".md#") ||
                                      href.startsWith("research/") ||
                                      href.startsWith("competitive-analysis"))
                                  ) {
                                    return <span>{children}</span>;
                                  }
                                  return (
                                    <a href={href} className="text-[#e85d26] hover:underline">
                                      {children}
                                    </a>
                                  );
                                },
                              }}
                            >
                              {stripFilePathLinks(section.content)}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Simple markdown renderer for non-competitive content */
export function MarkdownSection({ content }: { content: string }) {
  return (
    <div className={PROSE_CLASSES}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => {
            const text =
              typeof children === "string"
                ? children
                : extractTextFromChildren(children);
            const id = slugify(text);
            return (
              <h2 id={id} className="scroll-mt-8 text-xl font-bold mt-10 mb-4 pb-2 border-b border-[#eae6e1]">
                {children}
              </h2>
            );
          },
          h3: ({ children }) => {
            const text =
              typeof children === "string"
                ? children
                : extractTextFromChildren(children);
            const id = slugify(text);
            return (
              <h3 id={id} className="scroll-mt-8">
                {children}
              </h3>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto my-4 rounded-lg border border-[#eae6e1]">
              <table className="min-w-full">{children}</table>
            </div>
          ),
          a: ({ href, children }) => {
            if (
              href &&
              (href.endsWith(".md") ||
                href.includes(".md#") ||
                href.startsWith("research/") ||
                href.startsWith("docs/"))
            ) {
              return <span>{children}</span>;
            }
            return (
              <a href={href} className="text-[#e85d26] hover:underline">
                {children}
              </a>
            );
          },
        }}
      >
        {stripFilePathLinks(content)}
      </ReactMarkdown>
    </div>
  );
}
