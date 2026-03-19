import { readFile } from "fs/promises";
import path from "path";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const metadata: Metadata = {
  title: "Competitive Analysis & Product Strategy | Crewmatic",
  description:
    "Crewmatic competitive analysis — the AI operating system for water restoration contractors.",
};

// Extract headings from markdown for the table of contents
function extractHeadings(
  markdown: string
): Array<{ id: string; text: string; level: number }> {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: Array<{ id: string; text: string; level: number }> = [];
  let match;

  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2].replace(/\*\*/g, "").replace(/`/g, "");
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
    headings.push({ id, text, level });
  }

  return headings;
}

// Generate a slug from heading text (same logic used by the custom heading renderers)
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export default async function CompetitiveAnalysisPage() {
  const filePath = path.join(process.cwd(), "..", "docs", "competitive-analysis.md");
  const markdown = await readFile(filePath, "utf-8");
  const headings = extractHeadings(markdown);

  // Only show top-level (h2) headings in TOC to keep it manageable
  const tocHeadings = headings.filter((h) => h.level === 2);

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      {/* Header */}
      <header className="bg-slate-900 text-white print:bg-white print:text-black print:border-b-2 print:border-black">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
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
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <span className="bg-blue-500/20 text-blue-200 px-3 py-1 rounded-full print:border print:border-slate-400 print:text-black">
              Confidential
            </span>
            <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-full print:border print:border-slate-400 print:text-black">
              Strategy Document
            </span>
          </div>
        </div>
      </header>

      {/* Main content with sidebar TOC */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-12">
          {/* Sidebar TOC — desktop only */}
          <aside className="hidden lg:block print:hidden">
            <nav className="sticky top-8">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
                Table of Contents
              </h2>
              <ul className="space-y-1 text-sm border-l-2 border-slate-200">
                {tocHeadings.map((heading) => (
                  <li key={heading.id}>
                    <a
                      href={`#${heading.id}`}
                      className="block pl-4 py-1.5 text-slate-600 hover:text-blue-600 hover:border-l-2 hover:border-blue-600 hover:-ml-[2px] hover:pl-[18px] transition-colors leading-snug"
                    >
                      {heading.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Main content */}
          <main className="min-w-0">
            <article className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 sm:px-10 lg:px-14 py-10 lg:py-14 print:shadow-none print:border-none print:rounded-none print:p-0">
              <div className="prose prose-slate prose-lg max-w-none prose-headings:scroll-mt-8 prose-h2:text-2xl prose-h2:font-bold prose-h2:border-b prose-h2:border-slate-200 prose-h2:pb-3 prose-h2:mb-6 prose-h2:mt-14 first:prose-h2:mt-0 prose-h3:text-xl prose-h3:font-semibold prose-h3:mt-10 prose-h3:mb-4 prose-table:text-sm prose-th:bg-slate-800 prose-th:text-white prose-th:font-semibold prose-th:px-4 prose-th:py-3 prose-td:px-4 prose-td:py-3 prose-td:border-slate-200 prose-tr:border-slate-200 even:prose-tr:bg-slate-50 prose-blockquote:border-blue-500 prose-blockquote:bg-blue-50 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:not-italic prose-strong:text-slate-900 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-code:bg-slate-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-hr:border-slate-200 prose-hr:my-10 prose-li:marker:text-slate-400 prose-img:rounded-lg">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => {
                      const text =
                        typeof children === "string"
                          ? children
                          : String(children);
                      const id = slugify(text);
                      return (
                        <h1 id={id} className="scroll-mt-8">
                          {children}
                        </h1>
                      );
                    },
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
                      <div className="overflow-x-auto -mx-4 sm:mx-0 my-6">
                        <table className="min-w-full">{children}</table>
                      </div>
                    ),
                  }}
                >
                  {markdown}
                </ReactMarkdown>
              </div>
            </article>
          </main>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12 print:mt-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-sm text-slate-500">
          <p className="font-semibold text-slate-700">Crewmatic</p>
          <p className="mt-1">
            crewmatic.ai &mdash; Confidential
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Recursively extract text content from React children */
function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (children == null) return "";
  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join("");
  }
  if (typeof children === "object" && "props" in children) {
    return extractTextFromChildren(
      (children as React.ReactElement<{ children?: React.ReactNode }>).props
        .children
    );
  }
  return "";
}
