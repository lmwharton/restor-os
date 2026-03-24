"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface DesignSection {
  id: string;
  title: string;
  content: string;
  isDetailed: boolean;
}

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

const PROSE_CLASSES =
  "prose prose-slate prose-sm max-w-none prose-headings:scroll-mt-8 prose-h3:text-base prose-h3:font-semibold prose-h3:mt-8 prose-h3:mb-3 prose-h4:text-sm prose-h4:font-semibold prose-h4:mt-6 prose-h4:mb-2 prose-table:text-xs prose-th:bg-slate-800 prose-th:text-white prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:text-slate-700 prose-td:border-slate-200 prose-tr:border-slate-200 even:prose-tr:bg-slate-50 prose-blockquote:border-blue-500 prose-blockquote:bg-blue-50/60 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:text-sm prose-blockquote:not-italic prose-strong:text-slate-900 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-pre:bg-slate-50 prose-pre:text-slate-700 prose-pre:border prose-pre:border-slate-200 prose-pre:rounded-lg prose-pre:text-xs prose-code:bg-slate-100 prose-code:text-slate-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-hr:border-slate-200 prose-hr:my-6 prose-li:marker:text-slate-400 prose-p:text-[13px] prose-p:leading-relaxed prose-li:text-[13px]";

export function ProductDesignSection({
  sections,
}: {
  sections: DesignSection[];
}) {
  // Show key sections open by default, detailed ones collapsed
  const [openSections, setOpenSections] = useState<Set<string>>(
    () =>
      new Set(
        sections.filter((s) => !s.isDetailed).map((s) => s.id)
      )
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Product Design</h2>
          <p className="text-sm text-slate-500 mt-1">
            From the master design document — vision, scope, and architecture
          </p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={expandAll}
            className="text-xs text-slate-400 hover:text-blue-500 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            className="text-xs text-slate-400 hover:text-blue-500 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Collapse all
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {sections.map((section) => {
          const isOpen = openSections.has(section.id);

          return (
            <div
              key={section.id}
              className={`bg-white rounded-xl border transition-all duration-200 ${
                isOpen
                  ? "border-slate-200 shadow-sm"
                  : "border-slate-100 hover:border-slate-200 hover:shadow-sm"
              }`}
            >
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full text-left px-5 py-4 flex items-center gap-3 group"
              >
                <span
                  className={`text-[10px] text-slate-300 group-hover:text-slate-500 transition-all duration-200 ${
                    isOpen ? "rotate-90 text-blue-500" : ""
                  }`}
                >
                  {"\u25B6"}
                </span>
                <h3
                  className={`text-[15px] font-semibold leading-snug transition-colors flex-1 ${
                    isOpen
                      ? "text-slate-900"
                      : "text-slate-700 group-hover:text-slate-900"
                  }`}
                >
                  {section.title}
                </h3>
                {section.isDetailed && !isOpen && (
                  <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">
                    Detailed
                  </span>
                )}
              </button>

              {isOpen && (
                <div className="px-5 pb-6 pt-0">
                  <div className="border-t border-slate-100 pt-5">
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
          );
        })}
      </div>
    </div>
  );
}
