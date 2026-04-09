"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useJob, useRooms, usePhotos, useReadings, useJobEvents } from "@/lib/hooks/use-jobs";

// ─── Helpers ────────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Types ─────────────────────────────────────────────────────────
type TimelineStatus = "complete" | "in-progress" | "not-started";

interface TimelineSection {
  label: string;
  status: TimelineStatus;
  content: React.ReactNode;
}

// ─── Status dot colors ─────────────────────────────────────────────
function StatusDot({ status }: { status: TimelineStatus }) {
  const styles: Record<TimelineStatus, string> = {
    complete: "bg-emerald-500",
    "in-progress": "bg-amber-500",
    "not-started": "bg-surface-dim",
  };
  const icons: Record<TimelineStatus, React.ReactNode> = {
    complete: (
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M1.5 4L3.2 5.7L6.5 2.3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    "in-progress": (
      <svg width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden="true">
        <path d="M3 0.5V3H5.5" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    "not-started": null,
  };
  return (
    <div
      className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-full ${styles[status]}`}
      aria-label={status.replace("-", " ")}
    >
      {icons[status]}
    </div>
  );
}

// ─── Section card wrapper ──────────────────────────────────────────
function TimelineCard({
  section,
  isLast,
}: {
  section: TimelineSection;
  isLast: boolean;
}) {
  return (
    <div className="flex gap-4">
      {/* Left rail: dot + connecting line */}
      <div className="flex flex-col items-center pt-5">
        <StatusDot status={section.status} />
        {!isLast && (
          <div className="mt-1 w-[2px] flex-1 bg-surface-dim" />
        )}
      </div>
      {/* Card */}
      <div className="mb-3 flex-1 rounded-xl bg-surface-container-lowest p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-on-surface">
            {section.label}
          </h3>
          <StatusLabel status={section.status} />
        </div>
        {section.content}
      </div>
    </div>
  );
}

function StatusLabel({ status }: { status: TimelineStatus }) {
  if (status === "complete") {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        Complete
      </span>
    );
  }
  if (status === "in-progress") {
    return (
      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        In Progress
      </span>
    );
  }
  return (
    <span className="rounded-full bg-surface-dim/30 px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">
      Not Started
    </span>
  );
}

// ─── Main page ─────────────────────────────────────────────────────
export default function JobTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: jobId } = use(params);
  const { data: job } = useJob(jobId);
  const { data: rooms } = useRooms(jobId);
  const { data: photos } = usePhotos(jobId);
  // Fetch readings for the first room (for GPP display)
  const firstRoomId = rooms?.[0]?.id ?? "";
  const { data: readings } = useReadings(jobId, firstRoomId);
  const { data: events } = useJobEvents(jobId);

  const lossDate = job?.loss_date ?? null;
  const dayNumber = useMemo(() => {
    if (!lossDate) return 1;
    const now = new Date();
    const loss = new Date(lossDate);
    return Math.max(1, Math.ceil((now.getTime() - loss.getTime()) / 86400000));
  }, [lossDate]);

  const photosForAi = photos?.filter((p) => p.selected_for_ai).length ?? 0;
  const untaggedPhotos = photos?.filter((p) => !p.room_id).length ?? 0;
  const totalPhotos = photos?.length ?? job?.photo_count ?? 0;

  // GPP trend from readings
  const gppValues = (readings ?? [])
    .sort((a, b) => a.reading_date.localeCompare(b.reading_date))
    .map((r) => r.atmospheric_gpp)
    .filter((v): v is number => v !== null);

  if (!job) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-accent border-t-transparent" />
      </div>
    );
  }

  const sections: TimelineSection[] = [
    // 1. Job Info
    {
      label: "Job Info",
      status: "complete",
      content: (
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-on-surface-variant">
            {job.customer_name ?? "No customer"}
            {job.carrier ? ` \u00B7 ${job.carrier}` : ""}
            {job.claim_number ? ` \u00B7 #${job.claim_number}` : ""}
          </p>
          <Link
            href={`/jobs/${jobId}`}
            className="text-[13px] font-medium text-brand-accent"
          >
            Edit &rarr;
          </Link>
        </div>
      ),
    },

    // 2. Property Layout
    {
      label: "Property Layout",
      status: rooms && rooms.length > 0 ? "complete" : "not-started",
      content: (
        <div>
          <p className="mb-2 text-[13px] text-on-surface-variant">
            {rooms?.length ?? 0} room{(rooms?.length ?? 0) !== 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {(rooms ?? []).map((room) => (
              <span
                key={room.id}
                className="rounded-full bg-surface-container px-3 py-1 text-[12px] font-medium text-on-surface-variant"
              >
                {room.room_name}
              </span>
            ))}
          </div>
        </div>
      ),
    },

    // 3. Photos
    {
      label: "Photos",
      status:
        totalPhotos === 0
          ? "not-started"
          : untaggedPhotos > 0
            ? "in-progress"
            : "complete",
      content: (
        <div>
          {/* Photo strip */}
          <div className="mb-3 flex gap-2 overflow-x-auto scrollbar-none">
            {(photos ?? []).slice(0, 5).map((photo) => (
              <div
                key={photo.id}
                className="h-12 w-12 shrink-0 rounded-lg bg-surface-container-high overflow-hidden"
              >
                <img
                  src={photo.storage_url}
                  alt={photo.room_name || "Job photo"}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
            {totalPhotos > 5 && (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-[11px] font-medium text-on-surface-variant">
                +{totalPhotos - 5}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-on-surface-variant">
              {totalPhotos}/100 photos
              {untaggedPhotos > 0 && (
                <span className="text-amber-600">
                  {" "}
                  &middot; {untaggedPhotos} untagged &#9888;&#65039;
                </span>
              )}
            </p>
            {untaggedPhotos > 0 && (
              <Link
                href={`/jobs/${jobId}`}
                className="text-[13px] font-medium text-brand-accent"
              >
                Tag Rooms
              </Link>
            )}
          </div>
        </div>
      ),
    },

    // 4. Readings
    {
      label: "Readings",
      status:
        gppValues.length === 0
          ? "not-started"
          : gppValues[gppValues.length - 1]! <= 45
            ? "complete"
            : "in-progress",
      content: (
        <div>
          {gppValues.length > 0 ? (
            <>
              <p className="mb-1 text-[13px] font-medium text-on-surface">
                {gppValues.map((v, i) => (
                  <span key={i}>
                    {Math.round(v)}
                    {i < gppValues.length - 1 ? " \u2192 " : ""}
                  </span>
                ))}
                {gppValues.length >= 2 &&
                  gppValues[gppValues.length - 1]! <
                    gppValues[gppValues.length - 2]! && (
                    <span> &#8595;</span>
                  )}
              </p>
              <p className="text-[12px] text-on-surface-variant">
                Target: 45
              </p>
              {gppValues[gppValues.length - 1]! > 45 && (
                <p className="mt-2 text-[13px] font-medium text-brand-accent">
                  Day {dayNumber} &mdash; log readings
                </p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-on-surface-variant">
              No readings yet
            </p>
          )}
        </div>
      ),
    },

    // 5. Tech Notes
    {
      label: "Tech Notes",
      status: job.tech_notes ? "in-progress" : "not-started",
      content: (
        <div className="flex items-start justify-between gap-3">
          {job.tech_notes ? (
            <p className="line-clamp-2 text-[13px] leading-relaxed text-on-surface-variant">
              {job.tech_notes}
            </p>
          ) : (
            <p className="text-[13px] text-on-surface-variant">
              No tech notes yet
            </p>
          )}
          <Link
            href={`/jobs/${jobId}`}
            className="shrink-0 text-[13px] font-medium text-brand-accent"
          >
            Edit
          </Link>
        </div>
      ),
    },

    // 6. AI Scope
    {
      label: "AI Scope",
      status:
        job.line_item_count > 0
          ? "complete"
          : photosForAi > 0
            ? "not-started"
            : "not-started",
      content: (
        <div>
          {job.line_item_count > 0 ? (
            <p className="text-[13px] text-on-surface-variant">
              {job.line_item_count} line items generated
            </p>
          ) : (
            <>
              <p className="mb-3 text-[13px] text-on-surface-variant">
                {photosForAi} photo{photosForAi !== 1 ? "s" : ""} ready for
                analysis
              </p>
              <div
                className="inline-flex h-9 px-5 rounded-lg text-[13px] font-medium items-center justify-center gap-2 bg-surface-container text-on-surface-variant/60 border border-dashed border-outline-variant/50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                Coming Soon
              </div>
            </>
          )}
        </div>
      ),
    },

    // 7. Report
    {
      label: "Report",
      status: "not-started",
      content: (
        <div>
          <p className="mb-3 text-[13px] text-on-surface-variant">
            Needs scope to generate
          </p>
          <Link
            href={`/jobs/${jobId}/report`}
            className="inline-flex h-9 px-5 rounded-lg text-[13px] font-semibold text-on-primary bg-brand-accent items-center justify-center gap-2 transition-all hover:shadow-lg active:scale-[0.98]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
            Generate Report
          </Link>
        </div>
      ),
    },
  ];

  const completedCount = sections.filter((s) => s.status === "complete").length;
  const totalCount = sections.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="mx-auto max-w-lg lg:max-w-6xl px-4 pb-24 pt-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/jobs/${jobId}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container text-on-surface transition-colors hover:bg-surface-container-high"
            aria-label="Back to job"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M19 12H5m6-6-6 6 6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-on-surface">
              {job.address_line1}
            </h1>
          </div>
          <span className="rounded-full bg-surface-container px-3 py-1 text-[12px] font-semibold text-on-surface-variant">
            Day {dayNumber}
          </span>
        </div>

        {/* View toggle */}
        <div className="mt-4 flex gap-1 rounded-xl bg-surface-container p-1 lg:max-w-sm">
          <Link
            href={`/jobs/${jobId}`}
            className="flex-1 rounded-lg px-4 py-2 text-center text-[13px] font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            Field Mode
          </Link>
          <div className="flex-1 rounded-lg bg-surface-container-lowest px-4 py-2 text-center text-[13px] font-semibold text-brand-accent shadow-sm">
            Full View
          </div>
        </div>
      </div>

      {/* Desktop: two-pane / Mobile: single column */}
      <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-6">
        {/* ── Left: Timeline sections ─────────────────────────── */}
        <div>
          {sections.map((section, i) => (
            <TimelineCard
              key={section.label}
              section={section}
              isLast={i === sections.length - 1}
            />
          ))}
        </div>

        {/* ── Right: Desktop sidebar ──────────────────────────── */}
        <div className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            {/* Quick Actions */}
            <section className="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_1px_3px_rgba(31,27,23,0.04)]">
              <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
                Quick Actions
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href={`/jobs/${jobId}/photos`}
                  className="flex flex-col items-center justify-center h-16 rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors border border-outline-variant/30"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2v11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  <span className="text-[10px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1 uppercase tracking-[0.04em]">Photos</span>
                </Link>
                <Link
                  href={`/jobs/${jobId}/readings`}
                  className="flex flex-col items-center justify-center h-16 rounded-xl text-brand-accent bg-brand-accent/8 hover:bg-brand-accent/12 transition-colors border border-brand-accent/20"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-[10px] font-[family-name:var(--font-geist-mono)] font-bold mt-1 uppercase tracking-[0.04em]">Readings</span>
                </Link>
                <Link
                  href={`/jobs/${jobId}/report`}
                  className="flex flex-col items-center justify-center h-16 rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors border border-outline-variant/30"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6 2h9l5 5v15H6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M15 2v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="text-[10px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1 uppercase tracking-[0.04em]">Report</span>
                </Link>
              </div>
            </section>

            {/* Job Progress Ring */}
            <section className="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_1px_3px_rgba(31,27,23,0.04)]">
              <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
                Job Progress
              </h3>
              <div className="flex items-center gap-4">
                {/* Progress ring */}
                <div className="relative w-16 h-16 shrink-0">
                  <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
                    <circle cx="32" cy="32" r="28" fill="none" stroke="var(--surface-dim)" strokeWidth="6" />
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill="none"
                      stroke="var(--brand-accent)"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 28}`}
                      strokeDashoffset={`${2 * Math.PI * 28 * (1 - progressPct / 100)}`}
                      className="transition-all duration-500"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-bold font-[family-name:var(--font-geist-mono)] text-on-surface">
                    {progressPct}%
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-on-surface">
                    {completedCount}/{totalCount} steps
                  </p>
                  <p className="text-[12px] text-on-surface-variant mt-0.5">
                    {completedCount === totalCount
                      ? "All steps complete"
                      : `${totalCount - completedCount} remaining`}
                  </p>
                </div>
              </div>
            </section>

            {/* Activity Feed */}
            <section className="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_1px_3px_rgba(31,27,23,0.04)]">
              <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
                Activity Feed
              </h3>
              {events && events.length > 0 ? (
                <ul className="space-y-3">
                  {events.slice(0, 10).map((event) => {
                    const eventLabel = event.event_type
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (c) => c.toUpperCase());
                    const timeAgo = formatTimeAgo(event.created_at);
                    const dotColor = event.is_ai
                      ? "bg-tertiary"
                      : event.event_type.includes("photo")
                        ? "bg-emerald-500"
                        : event.event_type.includes("reading")
                          ? "bg-brand-accent"
                          : "bg-surface-dim";
                    return (
                      <li key={event.id} className="flex gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${dotColor} mt-1.5 shrink-0`} />
                        <div>
                          <p className="text-[12px] text-on-surface">{eventLabel}</p>
                          <p className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">{timeAgo}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[12px] text-on-surface-variant">No activity yet</p>
              )}
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}
