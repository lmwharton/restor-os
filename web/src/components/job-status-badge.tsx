/**
 * JobStatusBadge — single source of truth for rendering a job's lifecycle status.
 *
 * Spec 01K 9-status palette. Pulls labels and colors from `@/lib/labels`.
 * Falls back gracefully on legacy / unknown status strings via `getStatusMeta()`.
 *
 * Usage:
 *   <JobStatusBadge status={job.status} />               // default sm pill
 *   <JobStatusBadge status="active" size="lg" />         // larger
 *   <JobStatusBadge status="active" interactive          // button styling
 *                   onClick={() => openModal()} />
 */

"use client";

import { getStatusMeta } from "@/lib/labels";
import type { JobStatus } from "@/lib/types";

type BadgeSize = "sm" | "md" | "lg";

interface JobStatusBadgeProps {
  status: JobStatus | string | null | undefined;
  size?: BadgeSize;
  /** When true, render as a clickable button with chevron and hover state */
  interactive?: boolean;
  onClick?: () => void;
  className?: string;
}

const SIZE_STYLES: Record<BadgeSize, { padX: string; padY: string; fontSize: string; dot: string; gap: string }> = {
  sm: { padX: "px-2",   padY: "py-0.5", fontSize: "text-[11px]", dot: "w-1.5 h-1.5", gap: "gap-1.5" },
  md: { padX: "px-2.5", padY: "py-1",   fontSize: "text-[12px]", dot: "w-2 h-2",     gap: "gap-2"   },
  lg: { padX: "px-3",   padY: "py-1.5", fontSize: "text-[13px]", dot: "w-2 h-2",     gap: "gap-2"   },
};

export function JobStatusBadge({
  status,
  size = "sm",
  interactive = false,
  onClick,
  className = "",
}: JobStatusBadgeProps) {
  const meta = getStatusMeta(status);
  const s = SIZE_STYLES[size];

  const baseClass = `inline-flex items-center ${s.gap} ${s.padX} ${s.padY} rounded-full ${s.fontSize} font-semibold leading-none whitespace-nowrap`;

  const style = {
    backgroundColor: meta.bg,
    color: meta.color,
    border: `1px solid ${meta.border}`,
    textDecoration: meta.strike ? "line-through" : "none",
  };

  const dot = (
    <span
      className={`${s.dot} rounded-full shrink-0`}
      style={{ backgroundColor: meta.color }}
      aria-hidden="true"
    />
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} ${className} hover:brightness-95 active:scale-[0.98] transition`}
        style={style}
        aria-label={`Change status (current: ${meta.label})`}
      >
        {dot}
        <span>{meta.label}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke={meta.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <span className={`${baseClass} ${className}`} style={style}>
      {dot}
      <span>{meta.label}</span>
    </span>
  );
}
