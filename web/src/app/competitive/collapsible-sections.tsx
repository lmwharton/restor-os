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
    "30% documentation / 70% field · Scheduling is #1 pain · Tool fragmentation → paper",
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
    "V1 Water → V2 Fire → V3 Mold → V4 Contents → V5 Adjacent trades",
  risks:
    "7 risks tracked · Encircle AI live · Speed to market · MICA mandates",
  "strategic-intelligence-verisk--the-xactimate-moat":
    "Verisk $31B · Xactimate $350/mo · Failed AccuLynx deal · Crowdsourced pricing opportunity",
  "appendix-a-contractor-interview--brett-sodders-co-founder":
    "30 Q&As · Feature priorities · Pricing validation · Competitive insights",
  "appendix-b-workflow-review--validation-questions":
    "16 workflow descriptions with 35+ validation questions for Brett",
};

function getSummary(id: string): string {
  return SECTION_SUMMARIES[id] || "";
}

export function CollapsibleDocument({
  sections,
}: {
  sections: Section[];
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(["executive-summary"])
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(GROUP_LABELS as unknown as string[])
  );

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setOpenSections(new Set(sections.map((s) => s.id)));
  }, [sections]);

  const collapseAll = useCallback(() => {
    setOpenSections(new Set());
  }, []);

  // Group sections by their groupLabel, preserving order from GROUP_LABELS
  const grouped = GROUP_LABELS.map((label) => {
    const groupSections = sections.filter((s) => s.groupLabel === label);
    const icon = groupSections[0]?.icon || "•";
    return { label, icon, sections: groupSections };
  }).filter((g) => g.sections.length > 0);

  return (
    <div className="lg:grid lg:grid-cols-[300px_1fr] lg:gap-8">
      {/* Sidebar TOC — grouped */}
      <aside className="hidden lg:block print:hidden">
        <nav className="sticky top-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
              Contents
            </h2>
            <div className="flex gap-1">
              <button
                onClick={expandAll}
                className="text-[10px] text-slate-400 hover:text-blue-500 px-2 py-0.5 rounded hover:bg-slate-100 transition-colors"
              >
                Expand all
              </button>
              <button
                onClick={collapseAll}
                className="text-[10px] text-slate-400 hover:text-blue-500 px-2 py-0.5 rounded hover:bg-slate-100 transition-colors"
              >
                Collapse all
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.label}>
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="flex items-center gap-2 w-full text-left text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors mb-1.5"
                >
                  <span
                    className={`text-[10px] transition-transform duration-200 ${
                      expandedGroups.has(group.label) ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                  <span className="text-sm opacity-60">{group.icon}</span>
                  <span className="uppercase tracking-[0.12em]">
                    {group.label}
                  </span>
                  <span className="text-[10px] text-slate-400 ml-auto tabular-nums">
                    {group.sections.length}
                  </span>
                </button>

                {expandedGroups.has(group.label) && (
                  <ul className="ml-5 space-y-0.5 border-l border-slate-100">
                    {group.sections.map((section) => (
                      <li key={section.id}>
                        <button
                          onClick={() => {
                            if (!openSections.has(section.id)) {
                              toggleSection(section.id);
                            }
                            document
                              .getElementById(`section-${section.id}`)
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                          }}
                          className={`block w-full text-left pl-3 py-1 text-[13px] leading-snug transition-colors rounded-r ${
                            openSections.has(section.id)
                              ? "text-blue-600 font-medium border-l-2 border-blue-500 -ml-[1px] bg-blue-50/50"
                              : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {section.title.length > 38
                            ? section.title.slice(0, 35) + "..."
                            : section.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </nav>
      </aside>

      {/* Main content — collapsible sections */}
      <main className="min-w-0 space-y-3">
        {grouped.map((group) => (
          <div key={group.label}>
            {/* Group header */}
            <div className="flex items-center gap-3 mb-3 mt-8 first:mt-0">
              <span className="text-lg opacity-40">{group.icon}</span>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                {group.label}
              </h2>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            <div className="space-y-2">
              {group.sections.map((section) => {
                const isOpen = openSections.has(section.id);
                const summary = getSummary(section.id);

                return (
                  <div
                    key={section.id}
                    id={`section-${section.id}`}
                    className="scroll-mt-6"
                  >
                    <div
                      className={`bg-white rounded-xl border transition-all duration-200 ${
                        isOpen
                          ? "border-slate-200 shadow-sm"
                          : "border-slate-100 hover:border-slate-200 hover:shadow-sm"
                      }`}
                    >
                      {/* Section header — always visible */}
                      <button
                        onClick={() => toggleSection(section.id)}
                        className="w-full text-left px-5 py-4 flex items-start gap-3 group"
                      >
                        <span
                          className={`mt-1 text-[10px] text-slate-300 group-hover:text-slate-500 transition-all duration-200 ${
                            isOpen ? "rotate-90 text-blue-500" : ""
                          }`}
                        >
                          ▶
                        </span>
                        <div className="flex-1 min-w-0">
                          <h3
                            className={`text-[15px] font-semibold leading-snug transition-colors ${
                              isOpen
                                ? "text-slate-900"
                                : "text-slate-700 group-hover:text-slate-900"
                            }`}
                          >
                            {section.title}
                          </h3>
                          {summary && !isOpen && (
                            <p className="text-[12px] text-slate-500 mt-1 leading-relaxed truncate">
                              {summary}
                            </p>
                          )}
                          {/* Subsection pills when collapsed */}
                          {!isOpen && section.subsections.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {section.subsections.slice(0, 6).map((sub) => (
                                <span
                                  key={sub.id}
                                  className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full"
                                >
                                  {sub.title.length > 30
                                    ? sub.title.slice(0, 27) + "..."
                                    : sub.title}
                                </span>
                              ))}
                              {section.subsections.length > 6 && (
                                <span className="text-[10px] text-slate-400 px-1 py-0.5">
                                  +{section.subsections.length - 6} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </button>

                      {/* Section content — collapsible */}
                      {isOpen && (
                        <div className="px-5 pb-6 pt-0">
                          <div className="border-t border-slate-100 pt-5">
                            <div className="prose prose-slate prose-sm max-w-none prose-headings:scroll-mt-8 prose-h3:text-base prose-h3:font-semibold prose-h3:mt-8 prose-h3:mb-3 prose-h4:text-sm prose-h4:font-semibold prose-h4:mt-6 prose-h4:mb-2 prose-table:text-xs prose-th:bg-slate-800 prose-th:text-white prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:text-slate-700 prose-td:border-slate-200 prose-tr:border-slate-200 even:prose-tr:bg-slate-50 prose-blockquote:border-blue-500 prose-blockquote:bg-blue-50/60 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:text-sm prose-blockquote:not-italic prose-strong:text-slate-900 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-pre:bg-slate-50 prose-pre:text-slate-700 prose-pre:border prose-pre:border-slate-200 prose-pre:rounded-lg prose-pre:text-xs prose-code:bg-slate-100 prose-code:text-slate-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-hr:border-slate-200 prose-hr:my-6 prose-li:marker:text-slate-400 prose-p:text-[13px] prose-p:leading-relaxed prose-li:text-[13px]">
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
                                    <div className="overflow-x-auto -mx-2 sm:mx-0 my-4 rounded-lg border border-slate-200">
                                      <table className="min-w-full">
                                        {children}
                                      </table>
                                    </div>
                                  ),
                                }}
                              >
                                {section.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
