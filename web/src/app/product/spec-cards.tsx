"use client";

import { useState } from "react";

export interface SpecData {
  filename: string;
  title: string;
  status: "draft" | "in-progress" | "implemented";
  description: string;
}

const STATUS_STYLES: Record<
  string,
  { bg: string; text: string; dot: string; label: string }
> = {
  draft: {
    bg: "bg-[#faf9f7]",
    text: "text-[#8a847e]",
    dot: "bg-[#b5b0aa]",
    label: "Draft",
  },
  "in-progress": {
    bg: "bg-[#fff3ed]",
    text: "text-[#e85d26]",
    dot: "bg-[#e85d26]",
    label: "In Progress",
  },
  implemented: {
    bg: "bg-[#edf7f0]",
    text: "text-[#2a9d5c]",
    dot: "bg-[#2a9d5c]",
    label: "Implemented",
  },
};

export function SpecCards({ specs }: { specs: SpecData[] }) {
  const [filter, setFilter] = useState<string>("all");

  const filtered =
    filter === "all" ? specs : specs.filter((s) => s.status === filter);

  const counts = {
    all: specs.length,
    draft: specs.filter((s) => s.status === "draft").length,
    "in-progress": specs.filter((s) => s.status === "in-progress").length,
    implemented: specs.filter((s) => s.status === "implemented").length,
  };

  return (
    <div>
      <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-3">
        Implementation Specs
      </h2>
      <p className="text-[13px] text-[#8a847e] mb-5">
        Technical specifications tracking what has been designed, what is being
        built, and what is shipped.
      </p>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        {(
          [
            ["all", "All"],
            ["draft", "Draft"],
            ["in-progress", "In Progress"],
            ["implemented", "Implemented"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`text-[12px] px-3 py-1.5 rounded-full font-medium transition-all ${
              filter === key
                ? "bg-[#1a1a1a] text-white"
                : "bg-white text-[#8a847e] border border-[#eae6e1] hover:border-[#b5b0aa]"
            }`}
          >
            {label}
            <span className="ml-1.5 opacity-60">{counts[key]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-[13px] text-[#b5b0aa] py-6 text-center">
          No specs in this category yet.
        </p>
      ) : (
        <div className="space-y-0">
          {filtered.map((spec, i) => {
            const style = STATUS_STYLES[spec.status];
            return (
              <div
                key={spec.filename}
                className={`flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1.5 sm:gap-4 py-3 ${
                  i < filtered.length - 1 ? "border-b border-[#eae6e1]" : ""
                }`}
              >
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold text-[#1a1a1a] leading-snug">
                    {spec.title}
                  </h3>
                  <p className="text-[12px] text-[#8a847e] leading-relaxed mt-0.5 line-clamp-2">
                    {spec.description}
                  </p>
                </div>
                <span
                  className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${style.dot}`}
                  />
                  {style.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
