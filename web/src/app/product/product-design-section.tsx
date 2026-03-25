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

// Strip file path links from markdown content
function stripFilePathLinks(content: string): string {
  return content
    .replace(/\[([^\]]+)\]\([^)]*\.md[^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(research\/[^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(competitive-analysis[^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(https:\/\/github\.com\)/g, "$1");
}

const PROSE_CLASSES =
  "prose prose-sm max-w-none prose-headings:text-[#1a1a1a] prose-headings:scroll-mt-8 prose-h3:text-base prose-h3:font-semibold prose-h3:mt-8 prose-h3:mb-3 prose-h4:text-sm prose-h4:font-semibold prose-h4:mt-6 prose-h4:mb-2 prose-p:text-[13px] prose-p:leading-relaxed prose-p:text-[#171717] prose-li:text-[13px] prose-li:text-[#171717] prose-li:marker:text-[#b5b0aa] prose-table:text-xs prose-th:bg-[#1a1a1a] prose-th:text-white prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:text-[#171717] prose-td:border-[#eae6e1] prose-tr:border-[#eae6e1] even:prose-tr:bg-[#faf9f7] prose-blockquote:border-[#e85d26] prose-blockquote:bg-[#fff3ed] prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:text-sm prose-blockquote:not-italic prose-strong:text-[#1a1a1a] prose-a:text-[#e85d26] prose-a:no-underline hover:prose-a:underline prose-pre:bg-[#faf9f7] prose-pre:text-[#171717] prose-pre:border prose-pre:border-[#eae6e1] prose-pre:rounded-lg prose-pre:text-xs prose-code:bg-[#faf9f7] prose-code:text-[#171717] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-hr:border-[#eae6e1] prose-hr:my-6";

export function ProductDesignSection({
  sections,
}: {
  sections: DesignSection[];
}) {
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px]">
          Design Document
        </h2>
        <div className="flex items-center gap-1">
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
      </div>
      <p className="text-[13px] text-[#8a847e] mb-5">
        From the master design document &mdash; vision, scope, architecture, and domain rules.
      </p>

      <div className="space-y-0">
        {sections.map((section) => {
          const isOpen = openSections.has(section.id);

          return (
            <div
              key={section.id}
              className="border-b border-[#eae6e1] last:border-b-0"
            >
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full text-left py-4 flex items-center gap-3 group"
              >
                <span
                  className={`text-[10px] text-[#b5b0aa] group-hover:text-[#e85d26] transition-all duration-200 ${
                    isOpen ? "rotate-90 text-[#e85d26]" : ""
                  }`}
                >
                  &#9654;
                </span>
                <h3
                  className={`text-[15px] font-semibold leading-snug transition-colors flex-1 ${
                    isOpen
                      ? "text-[#1a1a1a]"
                      : "text-[#1a1a1a] group-hover:text-[#e85d26]"
                  }`}
                >
                  {section.title}
                </h3>
                {section.isDetailed && !isOpen && (
                  <span className="text-[10px] bg-[#faf9f7] text-[#b5b0aa] px-2 py-0.5 rounded-full border border-[#eae6e1]">
                    Detailed
                  </span>
                )}
              </button>

              {isOpen && (
                <div className="pb-6 pl-0 sm:pl-7">
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
                            if (
                              href &&
                              (href.endsWith(".md") ||
                                href.includes(".md#") ||
                                href.startsWith("research/") ||
                                href.startsWith("competitive-analysis") ||
                                href === "https://github.com")
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
  );
}
