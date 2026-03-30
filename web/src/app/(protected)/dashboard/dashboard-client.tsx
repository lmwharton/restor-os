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
const LABEL_STYLE = `text-[11px] ${MONO} uppercase tracking-[0.1em] text-outline`;

const STAGE_META: Record<PipelineStage, { label: string; dot: string; color: string; bg: string; text: string }> = {
  new:        { label: "New",          dot: "bg-red-500",      color: "#dc2626", bg: "bg-red-500/10",              text: "text-red-600" },
  contracted: { label: "Contracted",   dot: "bg-amber-500",    color: "#f59e0b", bg: "bg-amber-500/10",            text: "text-amber-700" },
  mitigation: { label: "Mitigation",   dot: "bg-brand-accent", color: "#e85d26", bg: "bg-brand-accent/10",         text: "text-brand-accent" },
  drying:     { label: "Drying",       dot: "bg-blue-500",     color: "#2563eb", bg: "bg-blue-500/10",             text: "text-blue-600" },
  job_complete: { label: "Complete",   dot: "bg-slate-400",    color: "#6b7280", bg: "bg-surface-container-high",  text: "text-on-surface" },
  submitted:  { label: "Submitted",    dot: "bg-cyan-600",     color: "#0891b2", bg: "bg-cyan-600/10",             text: "text-cyan-700" },
  collected:  { label: "Collected",    dot: "bg-emerald-500",  color: "#16a34a", bg: "bg-surface-container-high",  text: "text-emerald-600" },
};

const STAGE_ORDER: PipelineStage[] = ["new", "contracted", "mitigation", "drying", "job_complete", "submitted", "collected"];

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
    default: return "new";
  }
}

function getTaskStage(task: PriorityTask, jobs: JobDetail[]): PipelineStage {
  const job = jobs.find((j) => j.id === task.job_id);
  if (!job) return "new";
  return getJobStage(job);
}

const PIN_COLOR: Record<PipelineStage, string> = {
  new: "#dc2626",
  contracted: "#f59e0b",
  mitigation: "#e85d26",
  drying: "#2563eb",
  job_complete: "#6b7280",
  submitted: "#0891b2",
  collected: "#9ca3af",
};

const MAP_PIN_POSITIONS: { top: string; left: string }[] = [
  { top: "28%", left: "32%" },
  { top: "55%", left: "72%" },
  { top: "70%", left: "22%" },
  { top: "18%", left: "60%" },
  { top: "42%", left: "48%" },
  { top: "62%", left: "82%" },
  { top: "35%", left: "15%" },
];

// ---------------------------------------------------------------------------
//  Skeleton
// ---------------------------------------------------------------------------

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      className={`block animate-pulse rounded-lg bg-surface-container ${className}`}
    />
  );
}

// ---------------------------------------------------------------------------
//  Card
// ---------------------------------------------------------------------------

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-5 ${className}`}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Row 1: Pipeline Boxes
// ---------------------------------------------------------------------------

function PipelineBoxes({
  stages,
  selectedStage,
  onStageClick,
}: {
  stages: PipelineStageData[];
  selectedStage: PipelineStage | null;
  onStageClick: (stage: PipelineStage) => void;
}) {
  const stageMap = new Map(stages.map((s) => [s.stage, s]));

  return (
    <div className="grid grid-cols-4 lg:grid-cols-7 gap-2">
      {STAGE_ORDER.map((stage) => {
        const data = stageMap.get(stage);
        const count = data?.count ?? 0;
        const meta = STAGE_META[stage];
        const isSelected = selectedStage === stage;
        const isCollected = stage === "collected";

        return (
          <button
            key={stage}
            type="button"
            onClick={() => !isCollected && onStageClick(stage)}
            disabled={isCollected}
            className={`relative rounded-xl p-3 text-left transition-all duration-200 border-2 ${
              isSelected
                ? `border-current ${meta.bg} ${meta.text}`
                : isCollected
                  ? "border-outline-variant/20 bg-surface-container-lowest cursor-default"
                  : "border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40 cursor-pointer"
            }`}
          >
            <p className={`text-[10px] ${MONO} uppercase tracking-[0.1em] ${
              isSelected ? meta.text : "text-outline"
            } leading-tight mb-1`}>
              {meta.label}
            </p>
            <p className={`text-[24px] font-bold ${MONO} leading-none ${
              isSelected ? meta.text : "text-on-surface"
            }`}>
              {count}
            </p>
            {/* Color accent bar at bottom */}
            <span
              className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full"
              style={{ backgroundColor: meta.color, opacity: isSelected ? 1 : 0.3 }}
            />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Row 2 Left: Jobs List
// ---------------------------------------------------------------------------

function JobsList({
  tasks,
  selectedStage,
  now,
  jobs,
}: {
  tasks: PriorityTask[];
  selectedStage: PipelineStage | null;
  now: number;
  jobs: JobDetail[];
}) {
  const activeTasks = tasks.filter((t) => getTaskStage(t, jobs) !== "collected");

  const filteredTasks = selectedStage
    ? activeTasks.filter((t) => getTaskStage(t, jobs) === selectedStage)
    : activeTasks;

  return (
    <Card className="flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[16px] font-bold text-on-surface">
          {selectedStage
            ? `${STAGE_META[selectedStage].label} Jobs`
            : "Active Jobs"}
        </h2>
        <span className={`${LABEL_STYLE}`}>
          {filteredTasks.length} {filteredTasks.length === 1 ? "job" : "jobs"}
        </span>
      </div>

      <div className="flex-1 space-y-1" role="list">
        {filteredTasks.length === 0 ? (
          <p className="text-[13px] text-outline py-8 text-center">
            No jobs in this stage
          </p>
        ) : (
          filteredTasks.map((t) => {
            const stage = getTaskStage(t, jobs);
            const meta = STAGE_META[stage];
            const job = jobs.find((j) => j.id === t.job_id);
            const subtitle = job
              ? `Day ${Math.max(1, Math.ceil((now - new Date(job.created_at).getTime()) / 86400000))}, ${job.photo_count} photos, ${job.room_count} rooms`
              : t.description;

            return (
              <Link
                key={t.id}
                href={`/jobs/${t.job_id}`}
                className="flex gap-3 items-start py-2.5 rounded-lg px-2 hover:bg-surface-container/60 transition-colors group"
                role="listitem"
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${meta.dot}`}
                  aria-label={`${meta.label} stage`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-semibold text-on-surface group-hover:text-brand-accent transition-colors truncate">
                      {t.address}
                    </p>
                    <span className={`text-[10px] ${MONO} uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.bg} ${meta.text} shrink-0`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-[12px] text-outline mt-0.5 leading-snug truncate">
                    {subtitle}
                  </p>
                </div>
              </Link>
            );
          })
        )}
      </div>

      <Link
        href="/jobs"
        className={`mt-4 w-full bg-surface-container rounded-xl h-10 flex items-center justify-center ${MONO} text-[11px] uppercase tracking-[0.1em] text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer`}
      >
        View All Jobs
      </Link>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Row 2 Right: Live Operations Map
// ---------------------------------------------------------------------------

function LiveOperationsMap({ selectedStage, jobs }: { selectedStage: PipelineStage | null; jobs: JobDetail[] }) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const ZOOM_STEPS = [0.8, 1, 1.2, 1.5];

  function zoomIn() {
    setZoomLevel((prev) => {
      const idx = ZOOM_STEPS.indexOf(prev);
      return idx < ZOOM_STEPS.length - 1 ? ZOOM_STEPS[idx + 1] : prev;
    });
  }

  function zoomOut() {
    setZoomLevel((prev) => {
      const idx = ZOOM_STEPS.indexOf(prev);
      return idx > 0 ? ZOOM_STEPS[idx - 1] : prev;
    });
  }

  const activeJobs = jobs.filter((job) => getJobStage(job) !== "collected");
  const pins = activeJobs.map((job, i) => {
    const stage = getJobStage(job);
    const pos = MAP_PIN_POSITIONS[i % MAP_PIN_POSITIONS.length];
    return {
      address: job.address_line1,
      color: PIN_COLOR[stage],
      stage,
      top: pos.top,
      left: pos.left,
    };
  });

  return (
    <Card className="flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[16px] font-bold text-on-surface">
          Live Operations
        </h2>
        <span className={`${LABEL_STYLE}`}>{pins.length} Pins</span>
      </div>

      <div className="relative min-h-[400px] flex-1 bg-surface-container-high rounded-xl overflow-hidden">
        {/* Zoom controls */}
        <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoomLevel === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            className="w-7 h-7 rounded-lg bg-surface-container-lowest shadow-sm text-on-surface flex items-center justify-center text-[14px] font-bold hover:bg-surface-container transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoomLevel === ZOOM_STEPS[0]}
            className="w-7 h-7 rounded-lg bg-surface-container-lowest shadow-sm text-on-surface flex items-center justify-center text-[14px] font-bold hover:bg-surface-container transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Zoom out"
          >
            &minus;
          </button>
        </div>

        <div
          className="absolute inset-0 transition-transform duration-300 origin-center"
          style={{ transform: `scale(${zoomLevel})` }}
        >
          {/* Grid pattern */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.08]" aria-hidden="true">
            <defs>
              <pattern id="mapGrid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#mapGrid)" />
          </svg>

          {/* Pins */}
          {pins.map((pin) => {
            const isMatch = selectedStage === null || pin.stage === selectedStage;
            return (
              <div
                key={pin.address}
                className={`absolute flex items-center gap-1.5 transition-opacity duration-300 ${
                  !isMatch ? "opacity-20" : ""
                }`}
                style={{ top: pin.top, left: pin.left }}
              >
                {isMatch && (
                  <span
                    className="absolute w-5 h-5 rounded-full opacity-20 animate-ping"
                    style={{ backgroundColor: pin.color }}
                  />
                )}
                <span
                  className="relative w-3 h-3 rounded-full border-2 border-white shadow-sm z-10"
                  style={{ backgroundColor: pin.color }}
                />
                <span
                  className="relative z-10 text-[11px] font-medium text-white rounded px-2 py-0.5 shadow-sm whitespace-nowrap"
                  style={{ backgroundColor: pin.color }}
                >
                  {pin.address}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Row 3 Left: Operations Team
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
      <h3 className={`${LABEL_STYLE} mb-3`}>Operations Team</h3>
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
              <p className="text-[11px] text-outline truncate">
                {m.current_job_address
                  ? m.current_job_address
                  : statusLabels[m.status] ?? m.status}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Row 3 Center: Latest Activity
// ---------------------------------------------------------------------------

function LatestActivity({ jobs, initialEvents }: { jobs: JobDetail[]; initialEvents?: Event[] }) {
  const { data: companyEvents } = useCompanyEvents(initialEvents);

  // Get 4 most recent events
  const recentEvents = [...(companyEvents ?? [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 4);

  return (
    <Card>
      <h3 className={`${LABEL_STYLE} mb-3`}>Latest Activity</h3>
      <div className="space-y-2.5">
        {recentEvents.length === 0 ? (
          <p className="text-[13px] text-outline py-4 text-center">No recent activity</p>
        ) : (
          recentEvents.map((event, i) => {
            const job = jobs.find((j) => j.id === event.job_id);
            return (
              <div key={`${event.event_type}-${i}`} className="flex gap-2.5 items-start">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${event.is_ai ? "bg-brand-accent" : "bg-outline-variant"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-on-surface leading-snug">
                    {eventLabel(event)}
                  </p>
                  <p className={`text-[10px] ${MONO} text-outline mt-0.5`}>
                    {job ? `${job.address_line1} ` : ""}{timeAgo(event.created_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <Link
        href="/jobs"
        className="mt-3 block text-[11px] font-medium text-brand-accent hover:underline"
      >
        View full log &rarr;
      </Link>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Row 3 Right: KPI Cards (2x2 mini grid)
// ---------------------------------------------------------------------------

function KPIMiniGrid({ kpis }: { kpis: import("@/lib/types").DashboardKPIs | undefined }) {
  const k = kpis;

  return (
    <Card>
      <h3 className={`${LABEL_STYLE} mb-3`}>Key Metrics</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className={`text-[10px] ${MONO} uppercase tracking-[0.08em] text-outline`}>Active Jobs</p>
          <p className={`text-[20px] font-bold ${MONO} text-on-surface leading-tight`}>{k?.active_jobs ?? "--"}</p>
        </div>
        <div>
          <p className={`text-[10px] ${MONO} uppercase tracking-[0.08em] text-outline`}>Revenue MTD</p>
          <p className={`text-[20px] font-bold ${MONO} text-on-surface leading-tight`}>{k ? fmtCurrency(k.revenue_mtd) : "--"}</p>
        </div>
        <div>
          <p className={`text-[10px] ${MONO} uppercase tracking-[0.08em] text-outline`}>Outstanding AR</p>
          <p className={`text-[20px] font-bold ${MONO} text-brand-accent leading-tight`}>{k ? fmtCurrency(k.outstanding_ar) : "--"}</p>
        </div>
        <div>
          <p className={`text-[10px] ${MONO} uppercase tracking-[0.08em] text-outline`}>Avg Cycle</p>
          <p className={`text-[20px] font-bold ${MONO} text-on-surface leading-tight`}>
            {k ? k.avg_cycle_days : "--"}
            <span className="text-[12px] font-normal text-on-surface-variant ml-0.5">d</span>
          </p>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Loading Skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="w-full px-4 sm:px-6 py-5 space-y-5">
      {/* Pipeline boxes skeleton */}
      <div className="grid grid-cols-4 lg:grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-xl border-2 border-outline-variant/20 p-3">
            <Skeleton className="w-12 h-2.5 mb-2" />
            <Skeleton className="w-8 h-6" />
          </div>
        ))}
      </div>
      {/* Two-column skeleton */}
      <div className="grid lg:grid-cols-[55fr_45fr] gap-5">
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
      {/* Three-column skeleton */}
      <div className="grid md:grid-cols-3 gap-5">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <Skeleton className="w-24 h-3 mb-3" />
            <Skeleton className="w-full h-20" />
          </Card>
        ))}
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
  const [selectedStage, setSelectedStage] = useState<PipelineStage | null>(null);
  const [now] = useState(() => Date.now());

  const isLoading =
    kpis.isLoading || pipeline.isLoading || tasks.isLoading || team.isLoading;

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const pipelineData = pipeline.data ?? [];
  const taskData = tasks.data ?? [];

  function handleStageClick(stage: PipelineStage) {
    if (stage === "collected") return;
    setSelectedStage((prev) => (prev === stage ? null : stage));
  }

  return (
    <div className="w-full px-4 sm:px-6 py-5 space-y-5">
      {/* -- Row 1: Pipeline Boxes ------------------------------------------ */}
      <PipelineBoxes
        stages={pipelineData}
        selectedStage={selectedStage}
        onStageClick={handleStageClick}
      />

      {/* -- Row 2: Jobs List (55%) + Map (45%) ----------------------------- */}
      <div className="grid lg:grid-cols-[55fr_45fr] gap-5">
        <JobsList tasks={taskData} selectedStage={selectedStage} now={now} jobs={jobs} />
        <LiveOperationsMap selectedStage={selectedStage} jobs={jobs} />
      </div>

      {/* -- Row 3: Team + Activity + KPIs ---------------------------------- */}
      <div className="grid md:grid-cols-3 gap-5">
        <OperationsTeam />
        <LatestActivity jobs={jobs} initialEvents={initialEvents} />
        <KPIMiniGrid kpis={kpis.data ?? undefined} />
      </div>
    </div>
  );
}
