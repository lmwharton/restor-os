"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useDashboardKPIs,
  usePipeline,
  usePriorityTasks,
  useTeamMembers,
} from "@/lib/hooks/use-dashboard";
import { mockJobs } from "@/lib/mock-data";
import type { PipelineStage, PipelineStageData, PriorityTask } from "@/lib/types";

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function fmtCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

const MONO = "font-[family-name:var(--font-geist-mono)]";
const LABEL_STYLE = `text-[11px] ${MONO} uppercase tracking-[0.1em] text-outline`;

const STAGE_LABEL: Record<PipelineStage, { label: string; dot: string }> = {
  new: { label: "New", dot: "bg-red-500" },
  contracted: { label: "Contracted", dot: "bg-amber-500" },
  mitigation: { label: "Mitigation", dot: "bg-brand-accent" },
  drying: { label: "Drying", dot: "bg-blue-500" },
  completed: { label: "Job Complete", dot: "bg-slate-400" },
  submitted: { label: "Submitted", dot: "bg-cyan-600" },
  collected: { label: "Collected", dot: "bg-emerald-500" },
};

// ---------------------------------------------------------------------------
//  Stage-to-jobs mapping
// ---------------------------------------------------------------------------

function getJobStage(job: { status: string }): PipelineStage {
  switch (job.status) {
    case "new": return "new";
    case "contracted": return "contracted";
    case "mitigation": return "mitigation";
    case "drying": return "drying";
    case "completed": return "completed";
    case "submitted": return "submitted";
    case "collected": return "collected";
    default: return "new";
  }
}

const PIN_COLOR: Record<PipelineStage, string> = {
  new: "#dc2626",
  contracted: "#f59e0b",
  mitigation: "#e85d26",
  drying: "#2563eb",
  completed: "#6b7280",
  submitted: "#0891b2",
  collected: "#9ca3af",
};

// Map pin positions spread within the map area
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
//  Stage-to-task mapping (which tasks relate to which stage)
// ---------------------------------------------------------------------------

function getTaskStage(task: PriorityTask): PipelineStage {
  const job = mockJobs.find((j) => j.id === task.job_id);
  if (!job) return "new";
  return getJobStage(job);
}

// ---------------------------------------------------------------------------
//  Skeleton placeholder
// ---------------------------------------------------------------------------

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      className={`block animate-pulse rounded-lg bg-surface-container ${className}`}
    />
  );
}

// ---------------------------------------------------------------------------
//  Card wrapper
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
//  Notification Bell
// ---------------------------------------------------------------------------

function NotificationBell() {
  return (
    <button
      type="button"
      className="relative p-2 rounded-lg hover:bg-surface-container transition-colors cursor-pointer"
      aria-label="Notifications"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        className="text-on-surface-variant"
      >
        <path
          d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M13.73 21a2 2 0 0 1-3.46 0"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#dc2626]" />
    </button>
  );
}

// ---------------------------------------------------------------------------
//  Header Bar
// ---------------------------------------------------------------------------

function HeaderBar() {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[22px] sm:text-[26px] font-bold tracking-[-0.5px] text-on-surface">
          DryPros
        </h1>
        <span className={`text-[11px] ${MONO} uppercase tracking-[0.12em] text-outline`}>
          HQ Operations
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[14px] text-on-surface-variant hidden sm:block">
          {getGreeting()}, Brett
        </span>
        <NotificationBell />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Priority Tasks (Left Column)
// ---------------------------------------------------------------------------

function PriorityTaskList({
  tasks,
  selectedStage,
}: {
  tasks: PriorityTask[];
  selectedStage: PipelineStage | null;
}) {
  // Filter out collected tasks and group by stage
  const activeTasks = tasks.filter((t) => {
    const stage = getTaskStage(t);
    return stage !== "collected";
  });

  // Group tasks by stage, preserving stage order
  const stageOrder: PipelineStage[] = ["new", "contracted", "mitigation", "drying", "completed", "submitted"];
  const grouped = stageOrder
    .map((stage) => ({
      stage,
      tasks: activeTasks.filter((t) => getTaskStage(t) === stage),
    }))
    .filter((g) => g.tasks.length > 0);

  return (
    <Card className="flex flex-col">
      <h2 className="text-xl font-bold text-on-surface mb-4">
        Priority Tasks
      </h2>
      <div className="flex-1 space-y-4" role="list">
        {grouped.map((group) => {
          const sl = STAGE_LABEL[group.stage];
          return (
            <div key={group.stage}>
              {/* Stage header */}
              <p className={`text-[11px] ${MONO} uppercase tracking-[0.1em] text-outline mb-2`}>
                {sl.label}
              </p>
              <ul className="space-y-1">
                {group.tasks.map((t) => {
                  const taskStage = getTaskStage(t);
                  const isMatch = selectedStage === null || taskStage === selectedStage;
                  return (
                    <li
                      key={t.id}
                      className={`flex gap-3 items-start py-2.5 transition-all duration-200 rounded-lg px-2 ${
                        selectedStage !== null && isMatch
                          ? "border-l-2 border-l-brand-accent pl-3 bg-brand-accent/5"
                          : selectedStage !== null
                            ? "opacity-40"
                            : ""
                      }`}
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${sl.dot}`}
                        aria-label={`${sl.label} stage`}
                      />
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-on-surface">
                          {t.address}
                        </p>
                        <p className={`text-[12px] text-outline mt-0.5 leading-snug`}>
                          {t.description}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <Link
        href="/jobs"
        className={`mt-5 w-full bg-surface-container rounded-xl h-12 flex items-center justify-center ${MONO} text-[12px] uppercase tracking-[0.1em] text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer`}
      >
        View All Jobs
      </Link>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Job Pipeline Metrics (Right Column)
// ---------------------------------------------------------------------------

const PIPELINE_DISPLAY: {
  stage: PipelineStage;
  label: string;
  bg: string;
  text: string;
  amount: string;
}[] = [
  { stage: "new", label: "New", bg: "bg-red-500/10", text: "text-red-600", amount: "$0" },
  { stage: "contracted", label: "Contracted", bg: "bg-amber-500/10", text: "text-amber-700", amount: "$0" },
  { stage: "mitigation", label: "Mitigation", bg: "bg-brand-accent/10", text: "text-brand-accent", amount: "$4,200 Est." },
  { stage: "drying", label: "Drying", bg: "bg-blue-500/10", text: "text-blue-600", amount: "$28,500 Est." },
  { stage: "completed", label: "Job Complete", bg: "bg-surface-container-high", text: "text-on-surface", amount: "$0" },
  { stage: "submitted", label: "Submitted", bg: "bg-cyan-600/10", text: "text-cyan-700", amount: "$12,600 Est." },
  { stage: "collected", label: "Collected", bg: "bg-surface-container-high", text: "text-emerald-600", amount: "$41,200 Total" },
];

function PipelineMetrics({
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
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-on-surface">
          Job Pipeline Metrics
        </h2>
        <button
          type="button"
          className="p-1.5 rounded-lg hover:bg-surface-container transition-colors cursor-pointer"
          aria-label="Pipeline settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-outline">
            <path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>

      <div className="space-y-2.5">
        {PIPELINE_DISPLAY.map((p) => {
          const data = stageMap.get(p.stage);
          const count = data?.count ?? 0;
          const isSelected = selectedStage === p.stage;
          const isCollected = p.stage === "collected";

          if (isCollected) {
            // Collected bar: not clickable, no ring, informational only
            return (
              <div
                key={p.stage}
                className={`w-full ${p.bg} ${p.text} rounded-xl py-3 px-4 flex items-center justify-between cursor-default`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={`text-[15px] font-bold ${MONO}`}>{count}</span>
                  <span className="text-[13px] font-medium">{p.label}</span>
                </div>
                <span className={`text-[12px] ${MONO} opacity-90`}>{p.amount}</span>
              </div>
            );
          }

          return (
            <button
              key={p.stage}
              type="button"
              onClick={() => onStageClick(p.stage)}
              className={`w-full ${p.bg} ${p.text} rounded-xl py-3 px-4 flex items-center justify-between cursor-pointer transition-all duration-200 ${
                isSelected ? "ring-2 ring-brand-accent" : ""
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`text-[15px] font-bold ${MONO}`}>{count}</span>
                <span className="text-[13px] font-medium">{p.label}</span>
              </div>
              <span className={`text-[12px] ${MONO} opacity-90`}>{p.amount}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Live Operations Map
// ---------------------------------------------------------------------------

function LiveOperationsMap({ selectedStage }: { selectedStage: PipelineStage | null }) {
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

  // Build pins from mock jobs — exclude collected jobs
  const activeJobs = mockJobs.filter((job) => getJobStage(job) !== "collected");
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

  const activePinCount = pins.length;

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xl font-bold text-on-surface">
          Live Operations Map
        </h2>
        <span className={`${LABEL_STYLE}`}>{activePinCount} Pins Active</span>
      </div>

      {/* Map area */}
      <div className="relative min-h-[320px] bg-surface-container-high rounded-xl overflow-hidden">
        {/* Zoom controls */}
        <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoomLevel === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            className="w-8 h-8 rounded-lg bg-surface-container-lowest shadow-sm text-on-surface flex items-center justify-center text-[16px] font-bold hover:bg-surface-container transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoomLevel === ZOOM_STEPS[0]}
            className="w-8 h-8 rounded-lg bg-surface-container-lowest shadow-sm text-on-surface flex items-center justify-center text-[16px] font-bold hover:bg-surface-container transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Zoom out"
          >
            &minus;
          </button>
        </div>

        {/* Scalable content area */}
        <div
          className="absolute inset-0 transition-transform duration-300 origin-center"
          style={{ transform: `scale(${zoomLevel})` }}
        >
          {/* Subtle grid pattern */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.08]" aria-hidden="true">
            <defs>
              <pattern id="mapGrid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#mapGrid)" />
          </svg>

          {/* Map pins */}
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
                {/* Pulse ring for active/matching pins */}
                {isMatch && (
                  <span
                    className="absolute w-5 h-5 rounded-full opacity-20 animate-ping"
                    style={{ backgroundColor: pin.color }}
                  />
                )}
                {/* Dot */}
                <span
                  className="relative w-3 h-3 rounded-full border-2 border-white shadow-sm z-10"
                  style={{ backgroundColor: pin.color }}
                />
                {/* Label pill */}
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
//  Operations Team Status
// ---------------------------------------------------------------------------

function OperationsTeamStatus() {
  const displayMembers = [
    { name: "Marcus V.", initials: "MV" },
    { name: "Sarah J.", initials: "SJ" },
    { name: "David R.", initials: "DR" },
  ];

  return (
    <div>
      <p className={`${LABEL_STYLE} mb-4`}>Operations Team Status</p>
      <div className="flex gap-8 justify-center">
        {displayMembers.map((m) => (
          <div key={m.name} className="flex flex-col items-center gap-2">
            <span className="w-12 h-12 rounded-full bg-surface-container-high text-[13px] font-bold text-on-surface-variant flex items-center justify-center">
              {m.initials}
            </span>
            <span className="text-[13px] font-medium text-on-surface">{m.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Contractor Score
// ---------------------------------------------------------------------------

function ContractorScore() {
  const score = 72;
  const circumference = 2 * Math.PI * 20; // r=20
  const dashArray = (score / 100) * circumference;

  return (
    <Card className="flex flex-col items-center justify-center text-center py-6">
      {/* Circular gauge */}
      <div className="relative w-16 h-16 mb-2">
        <svg viewBox="0 0 48 48" className="w-16 h-16" aria-hidden="true">
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke="var(--surface-container)"
            strokeWidth="4"
          />
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke="var(--brand-accent)"
            strokeWidth="4"
            strokeDasharray={`${dashArray} ${circumference}`}
            strokeLinecap="round"
            transform="rotate(-90 24 24)"
          />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center text-[20px] font-bold text-brand-accent ${MONO}`}>
          {score}
        </span>
      </div>
      <span className="text-[12px] font-semibold text-[#0891b2] uppercase tracking-wider">
        Good Standing
      </span>
      <span className="text-[11px] text-outline mt-1 leading-snug">
        Top 10% response time in Chicago
      </span>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Customer Trust
// ---------------------------------------------------------------------------

function CustomerTrust() {
  return (
    <Card className="flex flex-col items-center justify-center text-center py-6">
      <span className={`text-[32px] font-bold text-on-surface ${MONO} leading-none`}>
        4.7
      </span>
      <span className="text-[18px] tracking-tight text-[#f59e0b] mt-1" aria-label="4.7 out of 5 stars">
        {"★".repeat(5)}
      </span>
      <span className={`${LABEL_STYLE} mt-2`}>108 Google Reviews</span>
    </Card>
  );
}

// ---------------------------------------------------------------------------
//  Mini Sparkline SVG
// ---------------------------------------------------------------------------

function Sparkline({ color = "currentColor" }: { color?: string }) {
  return (
    <svg width="48" height="16" viewBox="0 0 48 16" fill="none" className="inline-block ml-2 align-middle">
      <polyline
        points="0,14 8,10 16,12 24,6 32,8 40,3 48,1"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
//  KPI Cards Row
// ---------------------------------------------------------------------------

function KPICards({ kpis }: { kpis: import("@/lib/types").DashboardKPIs | undefined }) {
  const k = kpis;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Active Jobs */}
      <Card>
        <p className={LABEL_STYLE}>Active Jobs</p>
        <div className="mt-1.5 flex items-end gap-1">
          <span className={`text-3xl font-bold ${MONO} text-on-surface leading-none`}>
            {k ? k.active_jobs : "--"}
          </span>
          <Sparkline color="#16a34a" />
        </div>
        <p className="mt-2 text-[12px] text-[#16a34a] font-medium">
          {k ? `+${k.active_jobs_change} wk` : ""}
        </p>
      </Card>

      {/* Revenue MTD */}
      <Card>
        <p className={LABEL_STYLE}>Revenue (MTD)</p>
        <p className={`mt-1.5 text-2xl font-bold ${MONO} text-on-surface leading-none`}>
          {k ? fmtCurrency(k.revenue_mtd) : "--"}
        </p>
        <p className="mt-2 text-[12px] text-[#16a34a] font-medium">
          {k ? `\u2191 ${k.revenue_change_pct}%` : ""}
        </p>
      </Card>

      {/* Outstanding AR */}
      <Card>
        <p className={LABEL_STYLE}>Outstanding AR</p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className={`text-2xl font-bold ${MONO} text-brand-accent leading-none`}>
            {k ? fmtCurrency(k.outstanding_ar) : "--"}
          </span>
          <span className="text-[14px] text-[#f59e0b]" aria-label="Attention needed">
            {"\u26A0"}
          </span>
        </div>
        <p className={`mt-2 text-[11px] ${MONO} uppercase tracking-[0.08em] text-brand-accent font-medium`}>
          Action
        </p>
      </Card>

      {/* Avg Cycle */}
      <Card>
        <p className={LABEL_STYLE}>Avg Cycle</p>
        <p className="mt-1.5 flex items-baseline gap-1">
          <span className={`text-2xl font-bold ${MONO} text-on-surface leading-none`}>
            {k ? k.avg_cycle_days : "--"}
          </span>
          <span className="text-[13px] text-on-surface-variant">days</span>
        </p>
        <p className="mt-2 text-[12px] text-outline">
          {k && k.cycle_change_days < 0
            ? `\u2193 ${Math.abs(k.cycle_change_days)} from last mo`
            : ""}
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Loading Skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="w-48 h-7" />
        <Skeleton className="w-10 h-10 rounded-lg" />
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <Skeleton className="w-32 h-5 mb-4" />
          <div className="space-y-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="w-full h-10" />
            ))}
          </div>
        </Card>
        <Card>
          <Skeleton className="w-40 h-5 mb-4" />
          <div className="space-y-2.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="w-full h-12 rounded-xl" />
            ))}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <Skeleton className="w-20 h-3 mb-3" />
            <Skeleton className="w-24 h-7 mb-2" />
            <Skeleton className="w-16 h-3" />
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const kpis = useDashboardKPIs();
  const pipeline = usePipeline();
  const tasks = usePriorityTasks();
  const team = useTeamMembers();
  const [selectedStage, setSelectedStage] = useState<PipelineStage | null>(null);

  const isLoading =
    kpis.isLoading || pipeline.isLoading || tasks.isLoading || team.isLoading;

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const pipelineData = pipeline.data ?? [];
  const taskData = tasks.data ?? [];

  function handleStageClick(stage: PipelineStage) {
    if (stage === "collected") return; // Collected is informational only
    setSelectedStage((prev) => (prev === stage ? null : stage));
  }

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
      {/* -- Header Bar ---------------------------------------------------- */}
      <HeaderBar />

      {/* -- Main Content: 2-column grid ----------------------------------- */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: Priority Tasks */}
        <PriorityTaskList tasks={taskData} selectedStage={selectedStage} />

        {/* Right: Pipeline Metrics */}
        <PipelineMetrics
          stages={pipelineData}
          selectedStage={selectedStage}
          onStageClick={handleStageClick}
        />
      </div>

      {/* -- Bottom Section: 2-column grid --------------------------------- */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Bottom-left: Live Operations Map */}
        <LiveOperationsMap selectedStage={selectedStage} />

        {/* Bottom-right: Team + Score/Trust */}
        <div className="space-y-5">
          <Card>
            <OperationsTeamStatus />
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <ContractorScore />
            <CustomerTrust />
          </div>
        </div>
      </div>

      {/* -- KPI Cards Row (bottom) ---------------------------------------- */}
      <KPICards kpis={kpis.data} />
    </div>
  );
}
