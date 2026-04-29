"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useDashboardKPIs,
  usePipeline,
  usePriorityTasks,
  useTeamMembers,
  useCompanyEvents,
} from "@/lib/hooks/use-dashboard";
import { useJobs } from "@/lib/hooks/use-jobs";
import DashboardMap from "@/components/dashboard-map";
import SetupBanner from "@/components/dashboard/SetupBanner";
import type { PipelineStage, PipelineStageData, PriorityTask, Event, JobDetail } from "@/lib/types";
import { JOB_STATUSES } from "@/lib/types";
import { STATUS_COLORS, JOB_TYPE_COLORS, withAlpha } from "@/lib/status-colors";
import { STATUS_META } from "@/lib/labels";

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Event formatting ────────────────────────────────────────────────

interface EventMeta {
  label: string;
  icon: React.ReactNode;
  color: string;       // icon bg color
  accent: string;      // icon color
}

function getEventMeta(event: Event): EventMeta {
  const d = event.event_data as Record<string, unknown>;
  switch (event.event_type) {
    case "photos_uploaded":
    case "photo_uploaded": {
      const count = d.count;
      const room = d.room_name;
      return {
        label: `${count ?? ""} Photos Uploaded${room ? ` — ${room}` : ""}`.trim(),
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path d="M3 16l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    }
    case "moisture_reading_added":
    case "reading_added": {
      const day = d.day_number;
      return {
        label: `Moisture Reading${day ? ` — Day ${day}` : ""}`,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2C12 2 5 10 5 15a7 7 0 0014 0c0-5-7-13-7-13z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    }
    case "ai_photo_analysis": {
      const items = d.line_items_found;
      return {
        label: `Photo Analysis${items ? ` — ${items} items found` : ""}`,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.09 6.26H21l-5.55 4.04L17.55 18.54 12 14.49l-5.55 4.05 2.1-6.24L3 8.26h6.91L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    }
    case "ai_sketch_cleanup":
      return {
        label: "Sketch Cleanup Complete",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.09 6.26H21l-5.55 4.04L17.55 18.54 12 14.49l-5.55 4.05 2.1-6.24L3 8.26h6.91L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    case "report_generated":
      return {
        label: "Report Generated",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    case "status_changed":
    case "job_status_changed": {
      const to = d.to as string;
      return {
        label: `Status → ${to ? to.charAt(0).toUpperCase() + to.slice(1).replace(/_/g, " ") : "Updated"}`,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    }
    case "job_created":
      return {
        label: "New Job Created",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    case "job_linked":
      return {
        label: "Job Linked",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    case "recon_phase_created":
      return {
        label: `Phase Added${d.phase_name ? ` — ${d.phase_name}` : ""}`,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 11l3 3L22 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    case "recon_phase_updated":
      return {
        label: `Phase Updated${d.phase_name ? ` — ${d.phase_name}` : ""}`,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    case "recon_phase_completed":
      return {
        label: `Phase Complete${d.phase_name ? ` — ${d.phase_name}` : ""}`,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 4L12 14.01l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    case "room_added":
    case "room_created": {
      const room = d.room_name;
      return {
        label: `Room Created${room ? ` — ${room}` : ""}`,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M9 12h6M12 9v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    }
    case "room_updated": {
      const room = d.room_name;
      return {
        label: `Room Updated${room ? ` — ${room}` : ""}`,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 13l3 3 5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    }
    case "room_deleted": {
      const room = d.room_name;
      return {
        label: `Room Deleted${room ? ` — ${room}` : ""}`,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M9 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    }
    case "job_updated":
      return {
        label: "Job Updated",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    case "job_deleted":
      return {
        label: "Job Deleted",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    case "floor_plan_created":
    case "floor_plan_updated":
      return {
        label: event.event_type === "floor_plan_created" ? "Floor Plan Created" : "Floor Plan Updated",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M3 9h18M9 3v18" stroke="currentColor" strokeWidth="1.5"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    case "note_added":
    case "tech_notes_updated":
      return {
        label: "Notes Updated",
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
    default:
      return {
        label: event.event_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/><path d="M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
        color: "bg-surface-container", accent: "text-on-surface-variant",
      };
  }
}

const MONO = "font-[family-name:var(--font-geist-mono)]";

// Spec 01K — single 9-status pipeline. STAGE_META imports STATUS_META from labels.ts
// (single source of truth), but exposes the {label, color, bg} shape this file uses.
const STAGE_META: Record<PipelineStage, { label: string; color: string; bg: string }> =
  Object.fromEntries(
    JOB_STATUSES.map((s) => [s, { label: STATUS_META[s].label, color: STATUS_META[s].color, bg: STATUS_META[s].bg }])
  ) as Record<PipelineStage, { label: string; color: string; bg: string }>;

const STAGE_ORDER: readonly PipelineStage[] = JOB_STATUSES;

// ---------------------------------------------------------------------------
//  Stage-to-jobs mapping
// ---------------------------------------------------------------------------

function getJobStage(job: { status: string }): PipelineStage {
  // Spec 01K — migration already maps any legacy values; expect valid JobStatus.
  // Defensive fallback to "lead" for unrecognized values shouldn't fire in practice.
  return (JOB_STATUSES as readonly string[]).includes(job.status)
    ? (job.status as PipelineStage)
    : "lead";
}

function getTaskStage(task: PriorityTask, jobs: JobDetail[]): PipelineStage {
  const job = jobs.find((j) => j.id === task.job_id);
  if (!job) return "lead";
  return getJobStage(job);
}

const PIN_COLOR: Record<PipelineStage, string> = STATUS_COLORS;

// ---------------------------------------------------------------------------
//  Skeleton
// ---------------------------------------------------------------------------

function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded-lg bg-surface-container ${className}`} />;
}

// ---------------------------------------------------------------------------
//  Card
// ---------------------------------------------------------------------------

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-5 ${className}`}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  KPI Gauges — big numbers, no boxes
// ---------------------------------------------------------------------------

function ChangeIndicator({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (value === 0) return null;
  const isUp = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] ${MONO} font-semibold ${isUp ? "text-emerald-600" : "text-red-500"}`}>
      <svg width="8" height="8" viewBox="0 0 10 10" fill="none" className={isUp ? "" : "rotate-180"}>
        <path d="M5 1L9 6H1L5 1Z" fill="currentColor" />
      </svg>
      {Math.abs(value)}{suffix}
    </span>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function KPIGauges({ kpis }: { kpis: import("@/lib/types").DashboardKPIs | undefined }) {
  const k = kpis;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {[
        { icon: <><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" /></>, value: String(k?.active_jobs ?? "--"), label: "Active Jobs", accent: false, iconColor: "text-on-surface-variant/40" },
        { icon: <><path d="M2 17l4-4 4 4 4-8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>, value: k && k.revenue_mtd > 0 ? fmtCurrency(k.revenue_mtd) : "—", label: "Revenue", accent: false, iconColor: "text-on-surface-variant/40" },
        { icon: <><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" /><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>, value: k && k.outstanding_ar > 0 ? fmtCurrency(k.outstanding_ar) : "—", label: "Owed to You", accent: true, iconColor: "text-brand-accent/40" },
        { icon: <path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />, value: k ? `${k.avg_cycle_days}d` : "--", label: "Avg Cycle", accent: false, iconColor: "text-on-surface-variant/40" },
      ].map((item) => (
        <div key={item.label} className="flex items-center justify-center gap-2.5 bg-surface-container-lowest rounded-lg py-3 shadow-[0_1px_2px_rgba(31,27,23,0.04)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className={`shrink-0 ${item.iconColor}`}>{item.icon}</svg>
          <div>
            <p className={`text-[20px] sm:text-[24px] font-extrabold ${MONO} leading-none ${item.accent ? "text-brand-accent" : "text-on-surface"}`}>{item.value}</p>
            <p className={`text-[9px] sm:text-[10px] ${MONO} uppercase tracking-[0.04em] text-on-surface-variant/60 mt-0.5`}>{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className={`text-[10px] ${MONO} uppercase tracking-[0.12em] text-on-surface-variant/50 mb-2`}>
      {children}
    </p>
  );
}

function AttentionBar({ jobs }: { jobs: JobDetail[] }) {
  // Find jobs that need attention
  const alerts: { text: string; jobId: string; type: "warning" | "info" }[] = [];

  for (const job of jobs) {
    if (job.status === "active" && job.room_count > 0) {
      alerts.push({ text: `Moisture readings due — ${job.address_line1}`, jobId: job.id, type: "warning" });
    }
    if (job.status === "lead" && job.photo_count === 0) {
      alerts.push({ text: `No photos yet — ${job.address_line1}`, jobId: job.id, type: "info" });
    }
  }

  if (alerts.length === 0) {
    return (
      <div className="bg-emerald-50/50 border border-emerald-200/30 rounded-xl px-4 py-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        <p className="text-[13px] text-emerald-700">All clear — no items need immediate attention</p>
      </div>
    );
  }

  return (
    <div className="bg-amber-50/50 border border-amber-200/30 rounded-xl px-4 py-2.5 space-y-1.5">
      {alerts.slice(0, 3).map((alert, i) => (
        <Link
          key={i}
          href={`/jobs/${alert.jobId}`}
          className="flex items-center gap-2.5 py-1 hover:opacity-80 transition-opacity"
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${alert.type === "warning" ? "bg-amber-500" : "bg-blue-400"}`} />
          <p className="text-[13px] text-on-surface flex-1">{alert.text}</p>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-on-surface-variant/40 shrink-0">
            <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Pipeline Bar — proportional segmented horizontal bar
// ---------------------------------------------------------------------------

function PipelineBar({
  label,
  dotColor,
  stageOrder,
  stageCounts,
  selectedStage,
  onStageClick,
  onClearFilter,
}: {
  label: string;
  dotColor: string;
  stageOrder: readonly PipelineStage[];
  stageCounts: Map<PipelineStage, number>;
  selectedStage: PipelineStage | null;
  onStageClick: (stage: PipelineStage) => void;
  onClearFilter: () => void;
}) {
  const total = stageOrder.reduce((sum, s) => sum + (stageCounts.get(s) ?? 0), 0);
  // Is the selected stage part of THIS pipeline?
  const isFilteredHere = selectedStage && stageOrder.includes(selectedStage);

  return (
    <div>
      {/* Label row */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
        <span className="text-[11px] sm:text-[12px] font-bold text-on-surface">{label}</span>
        <span className={`text-[10px] sm:text-[11px] ${MONO} text-on-surface-variant`}>{total}</span>
        {isFilteredHere && (
          <button
            type="button"
            onClick={onClearFilter}
            className={`flex items-center gap-1 text-[10px] ${MONO} ml-1 px-1.5 py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer`}
          >
            {STAGE_META[selectedStage!].label}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>

      {/* Segmented bar */}
      {total > 0 ? (
        <>
          <div className="flex h-10 rounded-lg overflow-hidden gap-[1px] bg-outline-variant/15">
            {stageOrder.map((stage) => {
              const count = stageCounts.get(stage) ?? 0;
              if (count === 0) return null;
              const meta = STAGE_META[stage];
              const isSelected = selectedStage === stage;
              const widthPct = Math.max((count / total) * 100, 10);

              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => onStageClick(stage)}
                  className={`relative flex items-center justify-center gap-1.5 cursor-pointer transition-all duration-150 ${
                    isSelected
                      ? "ring-2 ring-on-surface/20 z-10 brightness-110"
                      : "hover:brightness-110 active:brightness-95"
                  }`}
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: meta.color,
                  }}
                  title={`${count} jobs in ${meta.label} — click to filter`}
                >
                  <span className="text-[13px] font-bold text-white leading-none drop-shadow-sm">{count}</span>
                  <span className="text-[9px] font-semibold text-white/90 uppercase tracking-wide drop-shadow-sm hidden sm:inline">{meta.label}</span>
                </button>
              );
            })}
          </div>
          {/* Legend — mobile only */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 sm:hidden">
            {stageOrder.map((stage) => {
              const count = stageCounts.get(stage) ?? 0;
              if (count === 0) return null;
              return (
                <span key={stage} className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STAGE_META[stage].color }} />
                  <span className={`text-[9px] ${MONO} text-on-surface-variant`}>{STAGE_META[stage].label}</span>
                </span>
              );
            })}
          </div>
        </>
      ) : (
        <div className="h-10 rounded-lg bg-surface-container/30 flex items-center justify-center">
          <span className={`text-[11px] ${MONO} text-on-surface-variant/40`}>No jobs yet</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Jobs List
// ---------------------------------------------------------------------------

function JobsList({
  tasks,
  filter,
  now,
  jobs,
}: {
  tasks: PriorityTask[];
  filter: { stage: PipelineStage; jobType: "mitigation" | "reconstruction" } | null;
  now: number;
  jobs: JobDetail[];
}) {
  const activeTasks = tasks.filter((t) => {
    const s = getTaskStage(t, jobs);
    return s !== "paid" && s !== "cancelled" && s !== "lost";
  });
  const filteredTasks = filter
    ? activeTasks.filter((t) => {
        const job = jobs.find((j) => j.id === t.job_id);
        return job && getJobStage(job) === filter.stage && job.job_type === filter.jobType;
      })
    : activeTasks;
  const selectedStage = filter?.stage ?? null;

  return (
    <Card className="flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-bold text-on-surface">
          {selectedStage ? `${STAGE_META[selectedStage].label} Jobs` : "Active Jobs"}
        </h2>
        <span className={`text-[11px] ${MONO} uppercase tracking-[0.1em] text-on-surface-variant`}>
          {filteredTasks.length} {filteredTasks.length === 1 ? "job" : "jobs"}
        </span>
      </div>

      <div className="flex-1 space-y-0.5 max-h-[440px] overflow-y-auto scrollbar-hide" role="list" style={{ scrollbarWidth: "none" }}>
        {filteredTasks.length === 0 ? (
          <p className="text-[13px] text-on-surface-variant py-8 text-center">
            {selectedStage ? "No jobs in this stage" : "No active jobs"}
          </p>
        ) : (
          filteredTasks.map((t, idx) => {
            const stage = getTaskStage(t, jobs);
            const meta = STAGE_META[stage];
            const job = jobs.find((j) => j.id === t.job_id);
            const days = job ? Math.max(1, Math.ceil((now - new Date(job.created_at).getTime()) / 86400000)) : 0;

            return (
              <Link
                key={t.id}
                href={`/jobs/${t.job_id}`}
                className="flex gap-3 items-center py-2 rounded-lg sm:px-2 hover:bg-surface-container/60 transition-colors group"
                role="listitem"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: meta.color }}
                  aria-label={meta.label}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-on-surface group-hover:text-brand-accent transition-colors truncate">
                    {t.address}
                  </p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5 leading-snug truncate">
                    {job?.customer_name ?? "No customer"}{" "}
                    <span className="text-on-surface-variant/50">·</span>{" "}
                    Day {days}
                  </p>
                </div>
                <span
                  className={`text-[9px] ${MONO} uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0`}
                  style={{ backgroundColor: meta.bg, color: meta.color }}
                >
                  {meta.label}
                </span>
              </Link>
            );
          })
        )}
      </div>

      <Link
        href="/jobs"
        className={`mt-3 w-full bg-surface-container rounded-lg h-9 flex items-center justify-center ${MONO} text-[11px] uppercase tracking-[0.1em] text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer`}
      >
        View All Jobs
      </Link>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Live Operations Map
// ---------------------------------------------------------------------------

function LiveOperationsMap({ selectedStage, jobs }: { selectedStage: PipelineStage | null; jobs: JobDetail[] }) {
  const activeJobs = jobs.filter((job) => {
    const s = getJobStage(job);
    return s !== "paid" && s !== "cancelled" && s !== "lost";
  });
  const mapJobs = activeJobs.map((job) => {
    const stage = getJobStage(job);
    return {
      id: job.id,
      address_line1: job.address_line1,
      city: job.city,
      state: job.state,
      zip: job.zip,
      stage,
      stageLabel: STAGE_META[stage].label,
      // Spec 01K Option A — map pins read lifecycle status, not job type.
      // Pipeline strip already filters by status; the map's job is to show
      // where × what stage. Job type is exposed in the InfoWindow popup.
      color: STATUS_COLORS[stage],
      customerName: job.customer_name,
      latitude: job.latitude,
      longitude: job.longitude,
    };
  });

  return (
    <Card className="flex flex-col min-h-[540px]">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-bold text-on-surface">Live Operations</h2>
        <span className={`text-[11px] ${MONO} uppercase tracking-[0.1em] text-on-surface-variant`}>{mapJobs.length} pins</span>
      </div>
      <div className="flex-1 min-h-0">
        <DashboardMap jobs={mapJobs} selectedStage={selectedStage} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Operations Team
// ---------------------------------------------------------------------------

function OperationsTeam() {
  const team = useTeamMembers();
  const members = team.data ?? [];

  const statusColors: Record<string, string> = {
    on_site: "bg-emerald-500",
    available: "bg-blue-500",
    off: "bg-slate-300",
  };

  const statusLabels: Record<string, string> = {
    on_site: "On site",
    available: "Available",
    off: "Off",
  };

  return (
    <Card>
      <h3 className="text-[15px] font-bold text-on-surface mb-3">Operations Team</h3>
      <div className="space-y-2.5">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2.5">
            <div className="relative shrink-0">
              <span className="w-8 h-8 rounded-full bg-surface-container-high text-[11px] font-bold text-on-surface-variant flex items-center justify-center">
                {m.name.split(" ").map((n) => n[0]).join("")}
              </span>
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-container-lowest ${statusColors[m.status] ?? "bg-slate-300"}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-on-surface truncate">{m.name}</p>
              <p className="text-[11px] text-on-surface-variant truncate">
                {m.current_job_address ? m.current_job_address : statusLabels[m.status] ?? m.status}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Latest Activity
// ---------------------------------------------------------------------------

function LatestActivity({ jobs, initialEvents }: { jobs: JobDetail[]; initialEvents?: Event[] }) {
  const { data: companyEvents } = useCompanyEvents(initialEvents);
  const recentEvents = [...(companyEvents ?? [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-bold text-on-surface">Latest Activity</h3>
        <Link href="/jobs" className="text-[11px] font-medium text-brand-accent hover:underline">
          View all &rarr;
        </Link>
      </div>
      <div className="space-y-0.5">
        {recentEvents.length === 0 ? (
          <p className="text-[13px] text-on-surface-variant py-6 text-center">No recent activity</p>
        ) : (
          recentEvents.map((event, i) => {
            const job = jobs.find((j) => j.id === event.job_id);
            const d = event.event_data as Record<string, unknown>;
            const jobNum = (d.job_number as string) || job?.job_number;
            const addr = job?.address_line1 || (d.address as string);
            const meta = getEventMeta(event);

            return (
              <Link
                href={job ? `/jobs/${job.id}` : "/jobs"}
                key={`${event.event_type}-${i}`}
                className="flex gap-3 items-start py-2.5 px-2 -mx-2 rounded-lg hover:bg-surface-container/50 active:bg-surface-container transition-colors cursor-pointer"
              >
                <span className={`w-7 h-7 rounded-lg ${meta.color} ${meta.accent} flex items-center justify-center shrink-0 mt-0.5`}>
                  {meta.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-on-surface leading-snug">{meta.label}</p>

                  {/* Mobile: compact — address + time */}
                  <p className="md:hidden text-[11px] text-on-surface-variant mt-0.5 truncate">
                    {addr || "Unknown"} · {timeAgo(event.created_at)}
                  </p>

                  {/* Desktop: full detail — user / job ID / address / time */}
                  <div className="hidden md:flex items-center gap-1.5 mt-0.5 text-[11px] text-on-surface-variant leading-snug">
                    {event.is_ai ? (
                      <span className="inline-flex items-center gap-0.5 text-amber-600 font-medium">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.09 6.26H21l-5.55 4.04L17.55 18.54 12 14.49l-5.55 4.05 2.1-6.24L3 8.26h6.91L12 2z" fill="currentColor"/></svg>
                        Auto
                      </span>
                    ) : (
                      <span className="font-medium text-on-surface-variant">You</span>
                    )}
                    {jobNum && <><span className="text-on-surface-variant/40">/</span><span className={MONO + " text-[10px] tracking-wide"}>{jobNum}</span></>}
                    {addr && <><span className="text-on-surface-variant/40">/</span><span className="truncate">{addr}</span></>}
                    <span className="text-on-surface-variant/40">/</span>
                    <span className="shrink-0">{timeAgo(event.created_at)}</span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Loading Skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="w-full px-4 sm:px-6 py-4 space-y-4">
      {/* KPI gauges */}
      <div className="flex gap-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i}>
            <Skeleton className="w-16 h-7 mb-1.5" />
            <Skeleton className="w-12 h-2.5" />
          </div>
        ))}
      </div>
      {/* Pipeline bars */}
      <div className="space-y-3">
        <Skeleton className="w-full h-9 rounded-lg" />
        <Skeleton className="w-full h-9 rounded-lg" />
      </div>
      {/* Content */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <Skeleton className="w-32 h-5 mb-4" />
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="w-full h-12 mb-2" />
          ))}
        </Card>
        <Card>
          <Skeleton className="w-32 h-5 mb-4" />
          <Skeleton className="w-full h-[300px] rounded-xl" />
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardClient({
  initialJobs,
  initialEvents,
}: {
  initialJobs?: JobDetail[];
  initialEvents?: Event[];
}) {
  const kpis = useDashboardKPIs(initialJobs);
  const pipeline = usePipeline(initialJobs);
  const tasks = usePriorityTasks(initialJobs);
  const team = useTeamMembers();
  const { data: jobs = [] } = useJobs(undefined, initialJobs);
  const [filter, setFilter] = useState<{ stage: PipelineStage; jobType: "mitigation" | "reconstruction" } | null>(null);
  const [now] = useState(() => Date.now());

  // For backward compat — components that only need the stage
  const selectedStage = filter?.stage ?? null;

  const isLoading =
    kpis.isLoading || pipeline.isLoading || tasks.isLoading || team.isLoading;

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const pipelineData = pipeline.data ?? [];
  const taskData = tasks.data ?? [];

  function handleStageClick(stage: PipelineStage, jobType: "mitigation" | "reconstruction") {
    // Skip clicks on terminal/archived statuses (no active jobs to filter into)
    if (stage === "paid" || stage === "cancelled" || stage === "lost") return;
    setFilter((prev) => (prev?.stage === stage && prev?.jobType === jobType) ? null : { stage, jobType });
  }

  // Spec 01K — single 9-status lifecycle pipeline replaces the dual mit/recon rows.
  // We still split counts by job_type so users can filter the panel below by either,
  // but both rows use the same 9 statuses now.
  const mitCounts = new Map<PipelineStage, number>();
  const recCounts = new Map<PipelineStage, number>();
  for (const s of JOB_STATUSES) {
    mitCounts.set(s, 0);
    recCounts.set(s, 0);
  }
  for (const job of jobs) {
    const stage = getJobStage(job);
    if (job.job_type === "mitigation") {
      mitCounts.set(stage, (mitCounts.get(stage) ?? 0) + 1);
    } else if (job.job_type === "reconstruction") {
      recCounts.set(stage, (recCounts.get(stage) ?? 0) + 1);
    }
  }

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="w-full px-4 sm:px-6 py-5 space-y-5">
      {/* -- Header -------------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] sm:text-[22px] font-bold text-on-surface">{getGreeting()}</h1>
          <p className={`text-[10px] sm:text-[11px] ${MONO} text-on-surface-variant mt-0.5`}>{today}</p>
        </div>
        <Link
          href="/jobs/new"
          className="flex items-center gap-1.5 px-4 h-9 rounded-lg text-[12px] font-semibold text-white bg-brand-accent hover:brightness-110 transition-all active:scale-[0.98] cursor-pointer"
        >
          <span className="text-[15px] leading-none">+</span> New Job
        </Link>
      </div>

      {/* Search — mobile only (desktop has it in the app shell header) */}
      <div className="sm:hidden relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="text-on-surface-variant/50">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <input
          type="text"
          placeholder="Search jobs..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.trim()) {
              window.location.href = `/jobs?search=${encodeURIComponent(e.currentTarget.value.trim())}`;
            }
          }}
          className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface-container text-[13px] text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:ring-2 focus:ring-brand-accent/30 transition-shadow"
        />
      </div>

      {/* -- Setup banner (Spec 01I) -------------------------------------- */}
      {/* Reads onboarding-status; renders only when show_setup_banner = true */}
      <SetupBanner />

      {/* -- KPIs ---------------------------------------------------------- */}
      <KPIGauges kpis={kpis.data ?? undefined} />

      {/* Divider: KPIs → Pipeline */}
      <div className="border-t border-outline-variant/20" />

      {/* -- Pipeline ------------------------------------------------------ */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className={`text-[10px] ${MONO} uppercase tracking-[0.12em] text-on-surface-variant/50`}>
            Pipeline
          </p>
          <span className={`text-[9px] ${MONO} text-on-surface-variant/35`}>Tap to filter</span>
        </div>
        <div className="space-y-3">
          <PipelineBar
            label="Mitigation"
            dotColor={JOB_TYPE_COLORS.mitigation}
            stageOrder={JOB_STATUSES}
            stageCounts={mitCounts}
            selectedStage={filter?.jobType === "mitigation" ? filter.stage : null}
            onStageClick={(s) => handleStageClick(s, "mitigation")}
            onClearFilter={() => setFilter(null)}
          />
          <PipelineBar
            label="Reconstruction"
            dotColor={JOB_TYPE_COLORS.reconstruction}
            stageOrder={JOB_STATUSES}
            stageCounts={recCounts}
            selectedStage={filter?.jobType === "reconstruction" ? filter.stage : null}
            onStageClick={(s) => handleStageClick(s, "reconstruction")}
            onClearFilter={() => setFilter(null)}
          />
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-outline-variant/20" />

      {/* -- Active Jobs + Live Operations (side by side) ------------------ */}
      <div className="grid lg:grid-cols-2 gap-4">
        <JobsList
          tasks={taskData}
          filter={filter}
          now={now}
          jobs={jobs}
        />
        <LiveOperationsMap selectedStage={selectedStage} jobs={jobs} />
      </div>

      {/* Divider */}
      <div className="border-t border-outline-variant/20" />

      {/* -- Team + Activity ----------------------------------------------- */}
      <div className="grid md:grid-cols-2 gap-4">
        <OperationsTeam />
        <LatestActivity jobs={jobs} initialEvents={initialEvents} />
      </div>
    </div>
  );
}
