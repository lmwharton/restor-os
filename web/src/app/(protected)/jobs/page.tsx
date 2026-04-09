"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Plus } from "@/components/icons";
import { useJobs, usePhotos, useUpdateJob } from "@/lib/hooks/use-jobs";
import type { JobDetail, JobStatus, JobType } from "@/lib/types";
import { STATUS_COLORS, withAlpha } from "@/lib/status-colors";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function daysSince(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function categoryLabel(cat: string | null): string {
  if (!cat) return "";
  const labels: Record<string, string> = {
    "1": "Cat 1 (Clean)",
    "2": "Cat 2 (Gray)",
    "3": "Cat 3 (Black)",
  };
  return labels[cat] ?? `Cat ${cat}`;
}

/* ------------------------------------------------------------------ */
/*  Status Badge                                                       */
/* ------------------------------------------------------------------ */

const statusConfig: Record<
  JobStatus,
  { label: string; color: string; bg: string }
> = {
  new:          { label: "New",         color: STATUS_COLORS.new,         bg: withAlpha(STATUS_COLORS.new, 0.15) },
  contracted:   { label: "Contracted",  color: STATUS_COLORS.contracted,  bg: withAlpha(STATUS_COLORS.contracted, 0.15) },
  mitigation:   { label: "Mitigation",  color: STATUS_COLORS.mitigation,  bg: withAlpha(STATUS_COLORS.mitigation, 0.15) },
  drying:       { label: "Drying",      color: STATUS_COLORS.drying,      bg: withAlpha(STATUS_COLORS.drying, 0.15) },
  complete:     { label: "Complete",    color: STATUS_COLORS.complete,    bg: withAlpha(STATUS_COLORS.complete, 0.15) },
  submitted:    { label: "Submitted",   color: STATUS_COLORS.submitted,   bg: withAlpha(STATUS_COLORS.submitted, 0.15) },
  collected:    { label: "Collected",   color: STATUS_COLORS.collected,   bg: withAlpha(STATUS_COLORS.collected, 0.15) },
  scoping:      { label: "Scoping",     color: STATUS_COLORS.scoping,     bg: withAlpha(STATUS_COLORS.scoping, 0.15) },
  in_progress:  { label: "In Progress", color: STATUS_COLORS.in_progress, bg: withAlpha(STATUS_COLORS.in_progress, 0.15) },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const config = statusConfig[status] ?? {
    label: status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    color: "#6b7280",
    bg: "rgba(107,114,128,0.15)",
  };
  return (
    <span
      className="inline-flex items-center px-2 py-px rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: config.bg, color: config.color }}
    >
      {config.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Job Type Badge                                                     */
/* ------------------------------------------------------------------ */

function TypeBadge({ type }: { type: JobType }) {
  return type === "mitigation" ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#eff6ff] text-[#3b82f6]">
      MIT
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#fff3ed] text-[#e85d26]">
      REC
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Search Icon (inline, page-specific)                                */
/* ------------------------------------------------------------------ */

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-on-surface-variant"
    >
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M16 16l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Clipboard Icon (for empty state)                                   */
/* ------------------------------------------------------------------ */

function ClipboardIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="8" y="4" width="16" height="24" rx="2.5" stroke="#a63500" strokeWidth="1.5" />
      <path
        d="M12 4h8v2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V4z"
        fill="#a63500"
        opacity="0.15"
        stroke="#a63500"
        strokeWidth="1.5"
      />
      <path d="M12 13h8M12 17h6M12 21h4" stroke="#a63500" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton Card                                                      */
/* ------------------------------------------------------------------ */

function SkeletonCard() {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-4 animate-pulse">
      <div className="h-4 bg-surface-container-high rounded w-3/4 mb-3" />
      <div className="flex gap-2 mb-3">
        <div className="h-5 bg-surface-container-high rounded-full w-20" />
        <div className="h-5 bg-surface-container-high rounded w-12" />
      </div>
      <div className="h-3 bg-surface-container rounded w-1/2" />
    </div>
  );
}

function SkeletonTableRow() {
  return (
    <div className="grid grid-cols-6 gap-3 px-4 py-3 animate-pulse">
      <div className="h-4 bg-surface-container-high rounded w-3/4 col-span-1" />
      <div className="h-5 bg-surface-container-high rounded-full w-16" />
      <div className="h-4 bg-surface-container-high rounded w-8" />
      <div className="h-4 bg-surface-container-high rounded w-8" />
      <div className="h-4 bg-surface-container-high rounded w-8" />
      <div className="h-4 bg-surface-container-high rounded w-14" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop Table Row                                                  */
/* ------------------------------------------------------------------ */

function JobTableRow({
  job,
  isFirst,
  isSelected,
  onSelect,
  onOpen,
}: {
  job: JobDetail;
  isFirst: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const days = daysSince(job.created_at);

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`grid grid-cols-[minmax(120px,0.8fr)_90px_60px_60px_60px_70px] gap-2 items-center px-4 py-2.5 cursor-pointer transition-colors duration-100 border-b border-outline-variant/10 ${
        isSelected
          ? "bg-brand-accent/6"
          : "hover:bg-surface-container-low"
      }`}
    >
      {/* Address + type indicator */}
      <span className="truncate min-w-0">
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${job.job_type === "mitigation" ? "bg-type-mitigation" : "bg-type-reconstruction"}`} title={job.job_type === "mitigation" ? "Mitigation" : "Reconstruction"} />
          <span className="truncate text-[13px] font-semibold text-on-surface">{job.address_line1}</span>
          {job.linked_job_id && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-on-surface-variant/40">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </span>
        <span className="block text-[11px] text-on-surface-variant/60 mt-0.5 ml-4 truncate">
          {job.customer_name || job.job_number}
        </span>
      </span>
      {/* Status */}
      <span className="text-center"><StatusBadge status={job.status} /></span>
      {/* Days */}
      <span className="text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant tabular-nums text-center">
        {days}
      </span>
      {/* Rooms */}
      <span className="text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant tabular-nums text-center">
        {job.room_count || "–"}
      </span>
      {/* Photos */}
      <span className="text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant tabular-nums text-center">
        {job.photo_count || "–"}
      </span>
      {/* Date */}
      <span className="text-[12px] text-on-surface-variant tabular-nums text-center">
        {formatDate(job.created_at)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop Preview Panel                                              */
/* ------------------------------------------------------------------ */

const MITIGATION_PHASES: { value: JobStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contracted", label: "Contracted" },
  { value: "mitigation", label: "Mitigation" },
  { value: "drying", label: "Drying" },
  { value: "complete", label: "Complete" },
  { value: "submitted", label: "Submitted" },
  { value: "collected", label: "Collected" },
];
const RECONSTRUCTION_PHASES: { value: JobStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "scoping", label: "Scoping" },
  { value: "in_progress", label: "In Progress" },
  { value: "complete", label: "Complete" },
  { value: "submitted", label: "Submitted" },
  { value: "collected", label: "Collected" },
];

function PreviewPanel({ job }: { job: JobDetail | null }) {
  const { data: photos } = usePhotos(job?.id ?? "");
  const updateJob = useUpdateJob(job?.id ?? "");
  const [photoIndex, setPhotoIndex] = useState(0);

  // Reset when job changes
  useEffect(() => { setPhotoIndex(0); }, [job?.id]);

  if (!job) {
    return (
      <div className="sticky top-24 bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-6 flex flex-col items-center justify-center min-h-[300px] text-center">
        <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center mb-3">
          <ClipboardIcon />
        </div>
        <p className="text-sm text-on-surface-variant">Select a job to preview</p>
      </div>
    );
  }

  const photoList = photos ?? [];
  const dotCount = Math.min(photoList.length, 8);
  const currentPhoto = photoList[photoIndex] ?? null;
  const days = daysSince(job.created_at);

  return (
    <div className="sticky top-24 bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] overflow-hidden flex flex-col">
      {/* Hero Photo Carousel */}
      <div className="relative w-full h-48 bg-surface-container-high rounded-xl overflow-hidden">
        {currentPhoto ? (
          <img
            src={currentPhoto.storage_url}
            alt={`${job.address_line1} photo`}
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
            key={currentPhoto.id}
          />
        ) : null}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, transparent 40%, rgba(31,27,23,0.55) 100%)",
          }}
          aria-hidden="true"
        />
        {!currentPhoto && (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-on-surface-variant/40">
              <rect x="2" y="4" width="20" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="8" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M2 17l5-5 3 3 4-4 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
        {/* Clickable dots — right side, vertical stack */}
        {photoList.length > 1 && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5">
            {Array.from({ length: dotCount }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => { e.stopPropagation(); setPhotoIndex(i); }}
                className={`rounded-full transition-all cursor-pointer ${
                  i === photoIndex
                    ? "w-2 h-2 bg-white shadow-sm"
                    : "w-1.5 h-1.5 bg-white/50 hover:bg-white/80"
                }`}
                aria-label={`View photo ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="p-5 space-y-4">
        {/* JOB PREVIEW label */}
        <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.14em] text-on-surface-variant font-semibold">
          Job Preview
        </span>

        {/* Address */}
        <h2 className="text-lg font-bold text-on-surface leading-tight -mt-1">
          {job.address_line1}{job.city || job.state ? `, ${[job.city, job.state].filter(Boolean).join(" ")}` : ""}
        </h2>

        {/* Quick stats line */}
        <p className="text-xs text-on-surface-variant">
          {job.room_count} {job.room_count === 1 ? "room" : "rooms"} &middot; {job.photo_count} photos &middot; Day {days}
        </p>

        {/* Customer & Insurance compact section */}
        <div className="space-y-2 py-2 border-t border-outline-variant/20">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant">Customer</span>
            <span className="text-xs font-medium text-on-surface">{job.customer_name || "\u2014"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant">Insurance</span>
            <span className="text-xs font-medium text-on-surface">{job.carrier || "\u2014"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant">Claim ID</span>
            <span className="text-xs font-[family-name:var(--font-geist-mono)] text-on-surface truncate max-w-[140px]">
              {job.claim_number ? `#${job.claim_number}` : "Pending"}
            </span>
          </div>
        </div>

        {/* Phase selector */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant">Phase</span>
          <select
            value={job.status}
            onChange={(e) => updateJob.mutate({ status: e.target.value } as Record<string, string | null>)}
            className="appearance-none h-7 px-2 pr-6 rounded-md bg-surface-container-low text-xs font-medium text-on-surface outline-none cursor-pointer border border-outline-variant/30 focus:border-brand-accent/50"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='10' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M6 9l6 6 6-6' stroke='%23594139' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}
          >
            {(job.job_type === "reconstruction" ? RECONSTRUCTION_PHASES : MITIGATION_PHASES).map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Open Job button */}
        <Link
          href={`/jobs/${job.id}`}
          className="w-full h-11 rounded-xl text-sm font-semibold text-on-primary bg-brand-accent flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98]"
        >
          Open Job
          <span aria-hidden="true">&rarr;</span>
        </Link>

        {/* Action links */}
        <div className="flex flex-col gap-2">
          <Link
            href={`/jobs/${job.id}/photos`}
            className="w-full h-10 rounded-lg text-sm font-medium text-on-surface bg-surface-container-lowest border border-outline-variant/30 flex items-center justify-center gap-2 hover:bg-surface-container-low transition-colors active:scale-[0.98]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
              <rect x="2" y="4" width="20" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="8" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M2 17l5-5 3 3 4-4 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Add Photo
          </Link>
          <Link
            href={`/jobs/${job.id}/readings`}
            className="w-full h-10 rounded-lg text-sm font-medium text-on-surface bg-surface-container-lowest border border-outline-variant/30 flex items-center justify-center gap-2 hover:bg-surface-container-low transition-colors active:scale-[0.98]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
              <path d="M3 20V8l4 4 4-6 4 4 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 20h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Log Reading
          </Link>
        </div>

        {/* Share button */}
        <Link
          href={`/jobs/${job.id}`}
          className="w-full h-10 rounded-lg text-sm font-medium text-on-surface bg-surface-container-lowest border border-outline-variant/30 flex items-center justify-center gap-2 hover:bg-surface-container-low transition-colors active:scale-[0.98]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
            <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M12 3v12M8 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Share
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Job Card                                                           */
/* ------------------------------------------------------------------ */

function JobCard({ job }: { job: JobDetail; isFirst?: boolean }) {
  const days = daysSince(job.created_at);
  const typeColor = job.job_type === "mitigation" ? "bg-[#3b82f6]" : "bg-[#e85d26]";

  return (
    <Link href={`/jobs/${job.id}`} className="block group">
      <div className="bg-surface-container-lowest rounded-xl px-3.5 py-3 shadow-[0_1px_3px_rgba(31,27,23,0.04)] flex items-center gap-3">
        {/* Type dot */}
        <span className={`w-2 h-2 rounded-full ${typeColor} shrink-0`} />

        {/* Address + status */}
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-on-surface truncate leading-tight">
            {job.address_line1}
          </h3>
          <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
            {job.customer_name || "No customer"}
          </p>
        </div>

        {/* Date */}
        <span className="text-[11px] text-on-surface-variant shrink-0 font-[family-name:var(--font-geist-mono)]">
          {formatDate(job.created_at)}
        </span>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty State                                                        */
/* ------------------------------------------------------------------ */

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 md:py-24 relative">
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full opacity-30 blur-[120px] pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(232,93,38,0.08) 0%, transparent 70%)",
        }}
        aria-hidden="true"
      />
      <div className="relative flex flex-col items-center text-center max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-surface-container flex items-center justify-center mb-6">
          <ClipboardIcon />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-[-1px] text-on-surface mb-3">
          No jobs yet.
        </h1>
        <p className="text-[15px] text-on-surface-variant leading-relaxed mb-8 max-w-sm">
          Create your first job to start AI scoping and real-time field data
          monitoring.
        </p>
        <Link
          href="/jobs/new"
          className="h-12 px-8 rounded-xl text-[15px] font-semibold text-on-primary bg-brand-accent transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] flex items-center gap-2"
        >
          <Plus size={18} />
          Create Job
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  No Results State (search has no matches)                           */
/* ------------------------------------------------------------------ */

function NoResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center mb-4">
        <SearchIcon />
      </div>
      <p className="text-base font-semibold text-on-surface mb-1">
        No jobs found
      </p>
      <p className="text-sm text-on-surface-variant">
        Nothing matches &ldquo;{query}&rdquo;. Try a different search.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reconstruction Empty State                                         */
/* ------------------------------------------------------------------ */

function ReconEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[#b5b0aa]">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-base font-semibold text-on-surface mb-1">
        No reconstruction jobs yet
      </p>
      <p className="text-sm text-on-surface-variant max-w-xs">
        Track insurance repair and rebuild work alongside your mitigation jobs.
      </p>
      <Link
        href="/jobs/new?type=reconstruction"
        className="mt-4 h-10 px-6 rounded-xl text-sm font-semibold text-on-primary bg-brand-accent flex items-center gap-1.5 transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98]"
      >
        <Plus size={16} />
        Create Reconstruction Job
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

type TypeFilter = "all" | "mitigation" | "reconstruction";

export default function JobsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: jobs, isLoading } = useJobs();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showNewJobSheet, setShowNewJobSheet] = useState(false);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    let result = jobs;
    if (typeFilter !== "all") {
      result = result.filter((j) => j.job_type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (j) =>
          j.address_line1.toLowerCase().includes(q) ||
          (j.customer_name && j.customer_name.toLowerCase().includes(q))
      );
    }
    return result;
  }, [jobs, search, typeFilter]);

  // Derive effective selection: use explicit pick, or fall back to first job
  const effectiveJobId = selectedJobId ?? (filtered.length > 0 ? filtered[0].id : null);

  const selectedJob = useMemo(() => {
    if (!effectiveJobId || !filtered) return null;
    return filtered.find((j) => j.id === effectiveJobId) ?? null;
  }, [effectiveJobId, filtered]);

  const handleSelectJob = useCallback((id: string) => {
    setSelectedJobId((prev) => (prev === id ? null : id));
  }, []);

  // True empty: no jobs at all (not loading, truly zero)
  if (!isLoading && jobs && jobs.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      {/* Header */}
      {/* Header */}
      <div className="px-4 sm:px-6 pt-4 pb-1 flex items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <SearchIcon />
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search address or customer..."
            className="w-full h-9 pl-10 pr-4 rounded-lg bg-surface-container text-[13px] text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:ring-2 focus:ring-brand-accent/30 transition-shadow"
          />
        </div>

        {/* Desktop New Job button — pushed to right */}
        <div className="hidden sm:flex ml-auto">
          <Link
            href="/jobs/new"
            className="flex h-9 px-4 rounded-lg text-[12px] font-semibold text-white bg-brand-accent items-center gap-1.5 hover:brightness-110 transition-all active:scale-[0.98] shrink-0 cursor-pointer"
          >
            <Plus size={14} />
            New Job
          </Link>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-4 sm:px-6 pt-3 pb-3 flex items-center gap-4">
        {(["all", "mitigation", "reconstruction"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => { setTypeFilter(tab); setSelectedJobId(null); }}
            className={`pb-2 text-sm font-medium transition-colors cursor-pointer ${
              typeFilter === tab
                ? "text-on-surface border-b-2 border-brand-accent"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {tab === "mitigation" && <span className="w-2 h-2 rounded-full bg-type-mitigation inline-block mr-1.5" />}
            {tab === "reconstruction" && <span className="w-2 h-2 rounded-full bg-type-reconstruction inline-block mr-1.5" />}
            {tab === "all" ? "All" : tab === "mitigation" ? "Mitigation" : "Reconstruction"}
            {jobs && (
              <span className="ml-1.5 text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant/60">
                {tab === "all" ? jobs.length : jobs.filter((j) => j.job_type === tab).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Desktop: table + preview panel */}
      <div className="px-4 sm:px-6 pb-28 sm:pb-6 lg:grid lg:grid-cols-[3fr_2fr] lg:gap-6">
        {/* ── Mobile card list (hidden on lg) ── */}
        <div className="flex flex-col gap-2 lg:hidden">
          {isLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : filtered.length === 0 ? (
            typeFilter === "reconstruction" && !search.trim() ? <ReconEmptyState /> : <NoResults query={search} />
          ) : (
            filtered.map((job, i) => (
              <JobCard key={job.id} job={job} isFirst={i === 0} />
            ))
          )}
        </div>

        {/* ── Desktop table (hidden below lg) ── */}
        <div className="hidden lg:block">
          {/* Table header */}
          <div className="grid grid-cols-[minmax(120px,0.8fr)_90px_60px_60px_60px_70px] gap-2 px-4 py-2 mb-1">
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant/60 font-semibold">Address</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant/60 font-semibold text-center">Phase</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant/60 font-semibold text-center">Days</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant/60 font-semibold text-center">Rooms</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant/60 font-semibold text-center">Photos</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant/60 font-semibold text-center">Date</span>
          </div>

          {/* Table body */}
          <div className="flex flex-col gap-0.5">
            {isLoading ? (
              <>
                <SkeletonTableRow />
                <SkeletonTableRow />
                <SkeletonTableRow />
                <SkeletonTableRow />
              </>
            ) : filtered.length === 0 ? (
              <NoResults query={search} />
            ) : (
              filtered.map((job, i) => (
                <JobTableRow
                  key={job.id}
                  job={job}
                  isFirst={i === 0}
                  isSelected={effectiveJobId === job.id}
                  onSelect={() => handleSelectJob(job.id)}
                  onOpen={() => router.push(`/jobs/${job.id}`)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Desktop preview panel (hidden below lg) ── */}
        <div className="hidden lg:block">
          <PreviewPanel job={selectedJob} />
        </div>
      </div>

      {/* Mobile FAB */}
      <button
        type="button"
        onClick={() => setShowNewJobSheet(true)}
        className="sm:hidden fixed bottom-[84px] right-5 z-40 w-12 h-12 rounded-full bg-brand-accent flex items-center justify-center shadow-lg shadow-primary/25 active:scale-95 transition-transform cursor-pointer"
        aria-label="New Job"
      >
        <Plus size={22} className="text-on-primary" />
      </button>

      {/* Mobile bottom sheet — pick MIT or REC */}
      {showNewJobSheet && (
        <>
          {/* Backdrop */}
          <div
            className="sm:hidden fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
            onClick={() => setShowNewJobSheet(false)}
          />
          {/* Sheet */}
          <div className="sm:hidden fixed bottom-[68px] left-4 right-4 z-50 bg-surface-container-lowest rounded-2xl shadow-[0_-4px_32px_rgba(0,0,0,0.12)] px-4 pt-4 pb-5 animate-[slideUp_200ms_ease-out]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-semibold text-on-surface">New Job</h2>
              <button
                type="button"
                onClick={() => setShowNewJobSheet(false)}
                className="w-7 h-7 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant active:scale-95"
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex gap-2.5">
              <Link
                href="/jobs/new?type=mitigation"
                onClick={() => setShowNewJobSheet(false)}
                className="flex-1 rounded-xl h-11 flex items-center justify-center gap-2 bg-[#eff6ff] transition-all active:scale-[0.97]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[#3b82f6]">
                  <path d="M12 2.69l.66.72C13.52 4.35 16.5 7.7 16.5 11.5a4.5 4.5 0 0 1-9 0c0-3.8 2.98-7.15 3.84-8.09L12 2.69Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.15" />
                </svg>
                <span className="text-[13px] font-semibold text-[#3b82f6]">Mitigation</span>
              </Link>
              <Link
                href="/jobs/new?type=reconstruction"
                onClick={() => setShowNewJobSheet(false)}
                className="flex-1 rounded-xl h-11 flex items-center justify-center gap-2 bg-[#fff3ed] transition-all active:scale-[0.97]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[#e85d26]">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="currentColor" fillOpacity="0.15" />
                </svg>
                <span className="text-[13px] font-semibold text-[#e85d26]">Reconstruction</span>
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}
