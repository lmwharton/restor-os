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
    bg: "bg-slate-100",
    text: "text-slate-600",
    dot: "bg-slate-400",
    label: "Draft",
  },
  "in-progress": {
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-400",
    label: "In Progress",
  },
  implemented: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
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
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">
          Implementation Specs
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Technical specifications tracking what has been designed, what is being
          built, and what is shipped
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
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
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
              filter === key
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-500 border border-slate-200 hover:border-slate-300"
            }`}
          >
            {label}
            <span className="ml-1.5 opacity-60">{counts[key]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-8 text-center">
          <p className="text-sm text-slate-400">
            No specs in this category yet.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((spec) => {
            const style = STATUS_STYLES[spec.status];
            return (
              <div
                key={spec.filename}
                className="bg-white rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all p-5"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-slate-800 leading-snug">
                    {spec.title}
                  </h3>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${style.dot}`}
                    />
                    {style.label}
                  </span>
                </div>
                <p className="text-[12px] text-slate-500 leading-relaxed line-clamp-3">
                  {spec.description}
                </p>
                <p className="text-[10px] text-slate-300 mt-3 font-mono">
                  {spec.filename}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
