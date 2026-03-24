"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CollapsibleDocument } from "../competitive/collapsible-sections";
import type { Section } from "../competitive/parse-sections";

interface Tab {
  id: string;
  label: string;
  description: string;
}

const TABS: Tab[] = [
  {
    id: "competitive",
    label: "Market & Competition",
    description:
      "Full competitive analysis, market sizing, Brett's co-founder interview, and product strategy",
  },
  {
    id: "xactimate",
    label: "Xactimate Codes",
    description:
      "Water damage line item codes, units, and scope ordering reference",
  },
  {
    id: "tpa",
    label: "Insurance & TPA Rules",
    description:
      "Third-party administrator guidelines, rejection triggers, and carrier-specific rules",
  },
];

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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-slate prose-sm max-w-none prose-headings:scroll-mt-8 prose-h2:text-xl prose-h2:font-bold prose-h2:mt-10 prose-h2:mb-4 prose-h2:pb-2 prose-h2:border-b prose-h2:border-slate-200 prose-h3:text-base prose-h3:font-semibold prose-h3:mt-8 prose-h3:mb-3 prose-h4:text-sm prose-h4:font-semibold prose-h4:mt-6 prose-h4:mb-2 prose-table:text-xs prose-th:bg-slate-800 prose-th:text-white prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:text-slate-700 prose-td:border-slate-200 prose-tr:border-slate-200 even:prose-tr:bg-slate-50 prose-blockquote:border-blue-500 prose-blockquote:bg-blue-50/60 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:text-sm prose-blockquote:not-italic prose-strong:text-slate-900 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-pre:bg-slate-50 prose-pre:text-slate-700 prose-pre:border prose-pre:border-slate-200 prose-pre:rounded-lg prose-pre:text-xs prose-code:bg-slate-100 prose-code:text-slate-700 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-hr:border-slate-200 prose-hr:my-6 prose-li:marker:text-slate-400 prose-p:text-[13px] prose-p:leading-relaxed prose-li:text-[13px]">
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
              <h2 id={id} className="scroll-mt-8">
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
            <div className="overflow-x-auto -mx-2 sm:mx-0 my-4 rounded-lg border border-slate-200">
              <table className="min-w-full">{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function ResearchTabs({
  contents,
  competitiveSections,
}: {
  contents: Record<string, string>;
  competitiveSections: Section[];
}) {
  const [activeTab, setActiveTab] = useState("competitive");

  return (
    <div>
      {/* Tab navigation */}
      <div className="border-b border-slate-200 mb-8">
        <nav
          className="flex gap-0 -mb-px overflow-x-auto"
          aria-label="Research tabs"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab description */}
      <div className="mb-6">
        <p className="text-sm text-slate-500">
          {TABS.find((t) => t.id === activeTab)?.description}
        </p>
      </div>

      {/* Tab content */}
      {activeTab === "competitive" ? (
        <CollapsibleDocument sections={competitiveSections} />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8">
          <MarkdownContent content={contents[activeTab] || ""} />
        </div>
      )}
    </div>
  );
}
