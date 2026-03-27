"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useJob, useRooms, usePhotos, useReadings, useJobEvents } from "@/lib/hooks/use-jobs";

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
  useJobEvents(jobId); // pre-fetch events

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
              <button
                type="button"
                className="primary-gradient h-10 w-full rounded-xl text-sm font-medium text-on-primary transition-opacity hover:opacity-90 active:opacity-80"
              >
                Analyze with AI &rarr;
              </button>
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
          <button
            type="button"
            disabled
            className="primary-gradient h-10 w-full rounded-xl text-sm font-medium text-on-primary opacity-40"
          >
            Generate Report
          </button>
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
                <button
                  type="button"
                  className="flex flex-col items-center justify-center h-16 rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors border border-outline-variant/30 cursor-pointer"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="9" y="1" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="text-[10px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1 uppercase tracking-[0.04em]">Voice</span>
                </button>
                <button
                  type="button"
                  className="flex flex-col items-center justify-center h-16 rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors border border-outline-variant/30 cursor-pointer"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 12h16M4 6h16M4 18h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="text-[10px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1 uppercase tracking-[0.04em]">Notes</span>
                </button>
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
              <ul className="space-y-3">
                <li className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-[12px] text-on-surface">5 photos uploaded to Master Bedroom</p>
                    <p className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">Today</p>
                  </div>
                </li>
                <li className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand-accent mt-1.5 shrink-0" />
                  <div>
                    <p className="text-[12px] text-on-surface">Day 3 moisture readings added</p>
                    <p className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">Today</p>
                  </div>
                </li>
                <li className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-tertiary mt-1.5 shrink-0" />
                  <div>
                    <p className="text-[12px] text-on-surface">AI generated 3 room sketches</p>
                    <p className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">Yesterday</p>
                  </div>
                </li>
                <li className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-surface-dim mt-1.5 shrink-0" />
                  <div>
                    <p className="text-[12px] text-on-surface">Job created</p>
                    <p className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">3 days ago</p>
                  </div>
                </li>
              </ul>
            </section>

            {/* Share */}
            <section className="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_1px_3px_rgba(31,27,23,0.04)]">
              <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
                Share
              </h3>
              <button
                type="button"
                className="w-full h-10 rounded-xl text-sm font-medium text-on-surface-variant border border-outline-variant flex items-center justify-center gap-2 hover:bg-surface-container-low transition-colors cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                Share with Adjuster
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
