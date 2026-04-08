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
import type { PipelineStage, PipelineStageData, PriorityTask, Event, JobDetail } from "@/lib/types";

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

function eventLabel(event: Event): string {
  switch (event.event_type) {
    case "photo_uploaded": {
      const count = (event.event_data as Record<string, unknown>).count;
      const room = (event.event_data as Record<string, unknown>).room_name;
      return `${count} photos uploaded${room ? ` - ${room}` : ""}`;
    }
    case "moisture_reading_added": {
      const room = (event.event_data as Record<string, unknown>).room_name;
      return `Moisture reading${room ? ` - ${room}` : ""}`;
    }
    case "ai_photo_analysis": return "AI photo analysis complete";
    case "ai_sketch_cleanup": return "AI sketch cleanup done";
    case "report_generated": return "Report generated";
    case "job_status_changed": {
      const to = (event.event_data as Record<string, unknown>).to;
      return `Status changed to ${to}`;
    }
    case "job_created": return "Job created";
    case "room_added": {
      const room = (event.event_data as Record<string, unknown>).room_name;
      return `Room added: ${room}`;
    }
    default: return event.event_type.replace(/_/g, " ");
  }
}

const MONO = "font-[family-name:var(--font-geist-mono)]";

const STAGE_META: Record<PipelineStage, { label: string; dot: string; color: string; bg: string; text: string }> = {
  new:          { label: "New",          dot: "bg-status-new",          color: "var(--status-new)",          bg: "bg-status-new/10",          text: "text-status-new" },
  contracted:   { label: "Contracted",   dot: "bg-status-contracted",   color: "var(--status-contracted)",   bg: "bg-status-contracted/10",   text: "text-status-contracted" },
  mitigation:   { label: "Mitigation",   dot: "bg-status-mitigation",   color: "var(--status-mitigation)",   bg: "bg-status-mitigation/10",   text: "text-status-mitigation" },
  drying:       { label: "Drying",       dot: "bg-status-drying",       color: "var(--status-drying)",       bg: "bg-status-drying/10",       text: "text-status-drying" },
  job_complete: { label: "Complete",     dot: "bg-status-complete",     color: "var(--status-complete)",     bg: "bg-status-complete/10",     text: "text-status-complete" },
  submitted:    { label: "Submitted",    dot: "bg-status-submitted",    color: "var(--status-submitted)",    bg: "bg-status-submitted/10",    text: "text-status-submitted" },
  collected:    { label: "Collected",    dot: "bg-status-collected",    color: "var(--status-collected)",    bg: "bg-status-collected/10",    text: "text-status-collected" },
  scoping:      { label: "Scoping",      dot: "bg-status-scoping",      color: "var(--status-scoping)",      bg: "bg-status-scoping/10",      text: "text-status-scoping" },
  in_progress:  { label: "In Progress",  dot: "bg-status-in-progress",  color: "var(--status-in-progress)",  bg: "bg-status-in-progress/10",  text: "text-status-in-progress" },
};

const MIT_STAGE_ORDER: PipelineStage[] = ["new", "contracted", "mitigation", "drying", "job_complete", "submitted", "collected"];
const REC_STAGE_ORDER: PipelineStage[] = ["new", "scoping", "in_progress", "job_complete", "submitted", "collected"];
const STAGE_ORDER: PipelineStage[] = MIT_STAGE_ORDER;

// ---------------------------------------------------------------------------
//  Stage-to-jobs mapping
// ---------------------------------------------------------------------------

function getJobStage(job: { status: string }): PipelineStage {
  switch (job.status) {
    case "new": return "new";
    case "contracted": return "contracted";
    case "mitigation": return "mitigation";
    case "drying": return "drying";
    case "job_complete": return "job_complete";
    case "submitted": return "submitted";
    case "collected": return "collected";
    case "scoping": return "scoping";
    case "in_progress": return "in_progress";
    default: return "new";
  }
}

function getTaskStage(task: PriorityTask, jobs: JobDetail[]): PipelineStage {
  const job = jobs.find((j) => j.id === task.job_id);
  if (!job) return "new";
  return getJobStage(job);
}

const PIN_COLOR: Record<PipelineStage, string> = {
  new: "var(--status-new)",
  contracted: "var(--status-contracted)",
  mitigation: "var(--status-mitigation)",
  drying: "var(--status-drying)",
  job_complete: "var(--status-complete)",
  submitted: "var(--status-submitted)",
  collected: "var(--status-collected)",
  scoping: "var(--status-scoping)",
  in_progress: "var(--status-in-progress)",
};

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
    if (job.status === "drying" && job.room_count > 0) {
      alerts.push({ text: `Moisture readings due — ${job.address_line1}`, jobId: job.id, type: "warning" });
    }
    if (job.status === "new" && job.photo_count === 0) {
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
  stageOrder: PipelineStage[];
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
            <span className={`text-[9px] ${MONO} text-on-surface-variant/40 ml-auto`}>Tap to filter</span>
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
  const activeTasks = tasks.filter((t) => getTaskStage(t, jobs) !== "collected");
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
                className="flex gap-3 items-center py-2 rounded-lg px-2 hover:bg-surface-container/60 transition-colors group"
                role="listitem"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${job?.job_type === "reconstruction" ? "bg-type-reconstruction" : "bg-type-mitigation"}`}
                  aria-label={job?.job_type === "reconstruction" ? "Reconstruction" : "Mitigation"}
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
                <span className={`text-[9px] ${MONO} uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.bg} ${meta.text} shrink-0`}>
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
  const activeJobs = jobs.filter((job) => getJobStage(job) !== "collected");
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
      color: job.job_type === "reconstruction" ? "#e85d26" : "#3b82f6",
      customerName: job.customer_name,
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
    .slice(0, 4);

  return (
    <Card>
      <h3 className="text-[15px] font-bold text-on-surface mb-3">Latest Activity</h3>
      <div className="space-y-2.5">
        {recentEvents.length === 0 ? (
          <p className="text-[13px] text-on-surface-variant py-4 text-center">No recent activity</p>
        ) : (
          recentEvents.map((event, i) => {
            const job = jobs.find((j) => j.id === event.job_id);
            return (
              <div key={`${event.event_type}-${i}`} className="flex gap-2.5 items-start">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${event.is_ai ? "bg-brand-accent" : "bg-outline-variant"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-on-surface leading-snug">{eventLabel(event)}</p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5 leading-snug">
                    {job ? `${job.address_line1} ` : ""}<span className="text-on-surface-variant/50">·</span> {timeAgo(event.created_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <Link href="/jobs" className="mt-3 block text-[11px] font-medium text-brand-accent hover:underline">
        View full log &rarr;
      </Link>
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

  function handleMitStageClick(stage: PipelineStage) {
    if (stage === "collected") return;
    setFilter((prev) => (prev?.stage === stage && prev?.jobType === "mitigation") ? null : { stage, jobType: "mitigation" });
  }

  function handleRecStageClick(stage: PipelineStage) {
    if (stage === "collected") return;
    setFilter((prev) => (prev?.stage === stage && prev?.jobType === "reconstruction") ? null : { stage, jobType: "reconstruction" });
  }

  // Compute per-type stage counts
  const mitCounts = new Map<PipelineStage, number>();
  const recCounts = new Map<PipelineStage, number>();
  for (const s of MIT_STAGE_ORDER) mitCounts.set(s, 0);
  for (const s of REC_STAGE_ORDER) recCounts.set(s, 0);
  for (const job of jobs) {
    const stage = getJobStage(job);
    if (job.job_type === "mitigation" && mitCounts.has(stage)) {
      mitCounts.set(stage, (mitCounts.get(stage) ?? 0) + 1);
    }
    if (job.job_type === "reconstruction" && recCounts.has(stage)) {
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

      {/* -- KPIs ---------------------------------------------------------- */}
      <KPIGauges kpis={kpis.data ?? undefined} />

      {/* Divider: KPIs → Pipeline */}
      <div className="border-t border-outline-variant/20" />

      {/* -- Pipeline ------------------------------------------------------ */}
      <div>
        <SectionLabel>Pipeline</SectionLabel>
        <div className="space-y-3">
          <PipelineBar
            label="Mitigation"
            dotColor="#3b82f6"
            stageOrder={MIT_STAGE_ORDER}
            stageCounts={mitCounts}
            selectedStage={filter?.jobType === "mitigation" ? filter.stage : null}
            onStageClick={handleMitStageClick}
            onClearFilter={() => setFilter(null)}
          />
          <PipelineBar
            label="Reconstruction"
            dotColor="#e85d26"
            stageOrder={REC_STAGE_ORDER}
            stageCounts={recCounts}
            selectedStage={filter?.jobType === "reconstruction" ? filter.stage : null}
            onStageClick={handleRecStageClick}
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
