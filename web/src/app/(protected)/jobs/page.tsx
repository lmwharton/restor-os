"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "@/components/icons";
import { useJobs, usePhotos } from "@/lib/hooks/use-jobs";
import type { JobDetail, JobStatus } from "@/lib/types";

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
  { label: string; className: string }
> = {
  new: {
    label: "New",
    className: "bg-red-500/15 text-red-600",
  },
  contracted: {
    label: "Contracted",
    className: "bg-amber-500/15 text-amber-700",
  },
  mitigation: {
    label: "Mitigation",
    className: "bg-brand-accent/15 text-brand-accent",
  },
  drying: {
    label: "Drying",
    className: "bg-blue-500/15 text-blue-600",
  },
  job_complete: {
    label: "Complete",
    className: "bg-slate-400/15 text-slate-600",
  },
  submitted: {
    label: "Submitted",
    className: "bg-cyan-600/15 text-cyan-700",
  },
  collected: {
    label: "Collected",
    className: "bg-emerald-500/15 text-emerald-700",
  },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const config = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className}`}
    >
      {config.label}
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
    <div className="grid grid-cols-7 gap-4 px-4 py-3 animate-pulse">
      <div className="h-4 bg-surface-container-high rounded w-3/4 col-span-1" />
      <div className="h-5 bg-surface-container-high rounded-full w-20" />
      <div className="h-4 bg-surface-container-high rounded w-10" />
      <div className="h-4 bg-surface-container-high rounded w-8" />
      <div className="h-4 bg-surface-container-high rounded w-8" />
      <div className="h-4 bg-surface-container-high rounded w-16" />
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
}: {
  job: JobDetail;
  isFirst: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const days = daysSince(job.created_at);

  return (
    <div
      onClick={onSelect}
      className={`grid grid-cols-[1fr_90px_50px_50px_50px_90px_70px] gap-2 items-center px-4 py-3 rounded-lg cursor-pointer transition-colors duration-100 ${
        isSelected
          ? "bg-brand-accent/6 ring-1 ring-brand-accent/20"
          : "hover:bg-surface-container-low"
      } ${isFirst ? "border-l-3 border-brand-accent" : ""}`}
    >
      <span className="truncate text-[13px] font-semibold text-on-surface">
        {job.address_line1}
      </span>
      <StatusBadge status={job.status} />
      <span className="text-xs font-[family-name:var(--font-geist-mono)] text-on-surface-variant tabular-nums text-center">
        {days}
      </span>
      <span className="text-xs font-[family-name:var(--font-geist-mono)] text-on-surface-variant tabular-nums text-center">
        {job.room_count || "--"}
      </span>
      <span className="text-xs font-[family-name:var(--font-geist-mono)] text-on-surface-variant tabular-nums text-center">
        {job.photo_count || "--"}
      </span>
      <span className="text-xs text-on-surface-variant truncate">
        {categoryLabel(job.loss_category) || "--"}
      </span>
      <span className="text-xs text-on-surface-variant tabular-nums text-right">
        {formatDate(job.created_at)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop Preview Panel                                              */
/* ------------------------------------------------------------------ */

function PreviewPanel({ job }: { job: JobDetail | null }) {
  const { data: photos } = usePhotos(job?.id ?? "");

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

  const heroPhoto = photos?.[0] ?? null;
  const days = daysSince(job.created_at);

  return (
    <div className="sticky top-24 bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] overflow-hidden flex flex-col">
      {/* Hero Photo */}
      <div className="relative w-full h-48 bg-surface-container-high rounded-xl overflow-hidden">
        {heroPhoto ? (
          <img
            src={heroPhoto.storage_url}
            alt={`${job.address_line1} hero`}
            className="absolute inset-0 w-full h-full object-cover"
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
        {!heroPhoto && (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-on-surface-variant/40">
              <rect x="2" y="4" width="20" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="8" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M2 17l5-5 3 3 4-4 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
            <span className="text-xs font-[family-name:var(--font-geist-mono)] text-on-surface">
              {job.claim_number ? `#${job.claim_number}` : "Pending"}
            </span>
          </div>
        </div>

        {/* Open Job button */}
        <Link
          href={`/jobs/${job.id}`}
          className="w-full h-11 rounded-xl text-sm font-semibold text-on-primary primary-gradient flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98]"
        >
          Open Job
          <span aria-hidden="true">&rarr;</span>
        </Link>

        {/* Action links */}
        <div className="flex flex-col gap-2">
          <Link
            href={`/jobs/${job.id}/photos`}
            className="w-full h-10 rounded-lg text-sm font-medium text-on-surface bg-surface-container-lowest border border-outline-variant/30 flex items-center gap-2.5 px-3.5 hover:bg-surface-container-low transition-colors active:scale-[0.98]"
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
            className="w-full h-10 rounded-lg text-sm font-medium text-on-surface bg-surface-container-lowest border border-outline-variant/30 flex items-center gap-2.5 px-3.5 hover:bg-surface-container-low transition-colors active:scale-[0.98]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
              <path d="M3 20V8l4 4 4-6 4 4 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 20h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Log Reading
          </Link>
        </div>

        {/* Footer row — Share */}
        <div className="flex items-center justify-center pt-2 border-t border-outline-variant/20">
          <Link
            href={`/jobs/${job.id}`}
            className="flex items-center gap-1.5 text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.12em] text-on-surface-variant font-semibold hover:text-on-surface transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M12 3v12M8 7l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Share
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Job Card                                                           */
/* ------------------------------------------------------------------ */

function JobCard({ job, isFirst }: { job: JobDetail; isFirst: boolean }) {
  const days = daysSince(job.created_at);

  return (
    <Link href={`/jobs/${job.id}`} className="block group">
      <div
        className={`bg-surface-container-lowest rounded-xl p-4 shadow-[0_1px_3px_rgba(31,27,23,0.04)] transition-shadow duration-150 group-hover:shadow-[0_2px_8px_rgba(31,27,23,0.08)] ${
          isFirst ? "border-l-4 border-brand-accent" : ""
        }`}
      >
        {/* Row 1: Address */}
        <h3 className="text-base font-semibold text-on-surface truncate">
          {job.address_line1}
        </h3>

        {/* Row 2: Status + Day count */}
        <div className="flex items-center gap-2 mt-1.5">
          <StatusBadge status={job.status} />
          <span className="text-xs text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
            Day {days}
          </span>
        </div>

        {/* Row 3: Metadata + date */}
        <div className="flex items-center justify-between mt-2.5">
          <div className="flex items-center gap-3 text-xs text-on-surface-variant">
            {job.room_count > 0 && (
              <span className="font-[family-name:var(--font-geist-mono)]">
                {job.room_count} {job.room_count === 1 ? "room" : "rooms"}
              </span>
            )}
            {job.photo_count > 0 && (
              <span className="font-[family-name:var(--font-geist-mono)]">
                {job.photo_count} photos
              </span>
            )}
            {job.loss_category && (
              <span>{categoryLabel(job.loss_category)}</span>
            )}
          </div>
          <span className="text-xs text-on-surface-variant shrink-0 ml-2">
            {formatDate(job.created_at)}
          </span>
        </div>
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
          className="h-12 px-8 rounded-xl text-[15px] font-semibold text-on-primary primary-gradient transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] flex items-center gap-2"
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
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function JobsPage() {
  const searchParams = useSearchParams();
  const { data: jobs, isLoading } = useJobs();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter(
      (j) =>
        j.address_line1.toLowerCase().includes(q) ||
        (j.customer_name && j.customer_name.toLowerCase().includes(q))
    );
  }, [jobs, search]);

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
      <div className="px-4 sm:px-6 pt-6 pb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-on-surface shrink-0">Jobs</h1>

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
            className="w-full h-10 pl-10 pr-4 rounded-full bg-surface-container text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-2 focus:ring-brand-accent/30 transition-shadow"
          />
        </div>

        {/* Desktop New Job button */}
        <Link
          href="/jobs/new"
          className="hidden sm:flex h-10 px-5 rounded-xl text-sm font-semibold text-on-primary primary-gradient items-center gap-1.5 transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] shrink-0"
        >
          <Plus size={16} />
          New Job
        </Link>
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
            <NoResults query={search} />
          ) : (
            filtered.map((job, i) => (
              <JobCard key={job.id} job={job} isFirst={i === 0} />
            ))
          )}
        </div>

        {/* ── Desktop table (hidden below lg) ── */}
        <div className="hidden lg:block">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_90px_50px_50px_50px_90px_70px] gap-2 px-4 py-2 border-b border-outline-variant/30 mb-1">
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant font-semibold">Address</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant font-semibold">Status</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant font-semibold text-center">Days</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant font-semibold text-center">Rooms</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant font-semibold text-center">Photos</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant font-semibold">Category</span>
            <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] text-on-surface-variant font-semibold text-right">Date</span>
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
      <Link
        href="/jobs/new"
        className="sm:hidden fixed bottom-6 right-6 z-40 w-16 h-16 rounded-full primary-gradient flex items-center justify-center shadow-lg shadow-primary/25 active:scale-95 transition-transform"
        aria-label="New Job"
      >
        <Plus size={28} className="text-on-primary" />
      </Link>
    </>
  );
}
