"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useJob,
  useRooms,
  useReadings,
  usePhotos,
  useJobEvents,
  useDeleteJob,
} from "@/lib/hooks/use-jobs";
// Types used via hook return inference — no direct imports needed

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function daysSinceLoss(lossDate: string | null): number {
  if (!lossDate) return 0;
  const diff = Date.now() - new Date(lossDate).getTime();
  return Math.max(1, Math.ceil(diff / 86_400_000));
}

function statusLabel(status: string): string {
  switch (status) {
    case "new":
      return "New";
    case "contracted":
      return "Contracted";
    case "mitigation":
      return "Mitigation";
    case "drying":
      return "Drying";
    case "completed":
      return "Complete";
    case "submitted":
      return "Submitted";
    case "collected":
      return "Collected";
    default:
      return status;
  }
}

function eventDescription(evt: { event_type: string; is_ai: boolean; event_data: Record<string, unknown> }): string {
  switch (evt.event_type) {
    case "photo_uploaded":
      return `uploaded ${evt.event_data.count ?? ""} photos`;
    case "moisture_reading_added":
      return `logged Day ${evt.event_data.day_number ?? "?"} readings`;
    case "ai_sketch_cleanup":
      return `cleaned up floor plan`;
    case "ai_photo_analysis":
      return `generated ${evt.event_data.line_items_generated ?? ""} line items from photos`;
    case "job_created":
      return `created the job`;
    case "report_generated":
      return `generated ${evt.event_data.report_type ?? "report"}`;
    default:
      return evt.event_type.replace(/_/g, " ");
  }
}

function eventActor(evt: { is_ai: boolean; user_id: string | null }): string {
  if (evt.is_ai) return "Crewmatic AI";
  // Mock user names
  switch (evt.user_id) {
    case "user1":
      return "Brett Miller";
    default:
      return "Team Member";
  }
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/* ------------------------------------------------------------------ */
/*  Inline SVG Icons                                                   */
/* ------------------------------------------------------------------ */

function ChevronDown({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowLeftIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 12H5m6-6-6 6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CameraIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2v11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ChartIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="1" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BellIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DocumentIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Accordion Section wrapper                                          */
/* ------------------------------------------------------------------ */

function AccordionSection({
  icon,
  title,
  badge,
  preview,
  defaultOpen = false,
  compact = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  preview?: React.ReactNode;
  defaultOpen?: boolean;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] overflow-hidden">
      <button
        type="button"
        onClick={() => !compact && setOpen(!open)}
        className={`w-full flex items-center gap-3 px-5 py-4 text-left transition-colors ${
          compact ? "cursor-default" : "cursor-pointer hover:bg-surface-container-low/50"
        }`}
        aria-expanded={compact ? undefined : open}
      >
        <span className="shrink-0">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-on-surface">{title}</span>
            {badge}
          </span>
          {!open && preview && (
            <span className="block text-[13px] text-on-surface-variant mt-0.5 truncate">
              {preview}
            </span>
          )}
        </span>
        {!compact && (
          <span className="shrink-0 text-on-surface-variant">
            {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </span>
        )}
        {compact && (
          <span className="shrink-0 text-on-surface-variant">
            <ChevronRight size={18} />
          </span>
        )}
      </button>
      {!compact && open && children && (
        <div className="px-5 pb-5 pt-0">
          {children}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-surface">
      <div className="h-16 bg-surface/70 backdrop-blur-xl border-b border-outline-variant/20" />
      <div className="max-w-6xl mx-auto px-4 pt-6 lg:grid lg:grid-cols-[1fr_320px] lg:gap-6">
        <div className="space-y-4">
          {[120, 200, 96, 80, 64, 48, 48].map((h, i) => (
            <div key={i} className="rounded-xl bg-surface-container-lowest animate-pulse" style={{ height: h }} />
          ))}
        </div>
        <div className="hidden lg:block space-y-4">
          <div className="h-52 rounded-xl bg-surface-container-lowest animate-pulse" />
          <div className="h-40 rounded-xl bg-surface-container-lowest animate-pulse" />
          <div className="h-48 rounded-xl bg-surface-container-lowest animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status icon helpers                                                */
/* ------------------------------------------------------------------ */

function StatusCheck() {
  return (
    <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-[12px] font-bold shrink-0">
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function StatusWarning() {
  return (
    <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-[12px] font-bold shrink-0">
      !
    </span>
  );
}

function StatusLock() {
  return (
    <span className="w-5 h-5 rounded-full bg-surface-container-high text-on-surface-variant flex items-center justify-center shrink-0">
      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="5" y="11" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function StatusSparkle() {
  return (
    <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center shrink-0">
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function StatusGray() {
  return (
    <span className="w-5 h-5 rounded-full bg-surface-container-high text-on-surface-variant flex items-center justify-center text-[12px] shrink-0">
      --
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  GPP Bar Chart                                                      */
/* ------------------------------------------------------------------ */

function GppTrendChart({ readings, target }: { readings: { day: number; gpp: number }[]; target: number }) {
  const maxGpp = Math.max(...readings.map((r) => r.gpp), target + 10);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 h-[100px]">
        {readings.map((r) => {
          const pct = (r.gpp / maxGpp) * 100;
          const isAboveTarget = r.gpp > target;
          return (
            <div key={r.day} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-bold text-on-surface tabular-nums">
                {r.gpp.toFixed(0)}
              </span>
              <div className="w-full flex items-end" style={{ height: 80 }}>
                <div
                  className="w-full rounded-t-md transition-all duration-500"
                  style={{
                    height: `${pct}%`,
                    background: isAboveTarget
                      ? "linear-gradient(180deg, #e85d26 0%, #cc4911 100%)"
                      : "linear-gradient(180deg, #16a34a 0%, #15803d 100%)",
                  }}
                />
              </div>
              <span className="text-[10px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                Day {r.day}
              </span>
            </div>
          );
        })}
        {/* Target line visual */}
        <div className="flex-1 flex flex-col items-center gap-1">
          <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-bold text-emerald-600 tabular-nums">
            {target}
          </span>
          <div className="w-full flex items-end" style={{ height: 80 }}>
            <div
              className="w-full rounded-t-md border-2 border-dashed border-emerald-400 bg-emerald-50"
              style={{ height: `${(target / maxGpp) * 100}%` }}
            />
          </div>
          <span className="text-[10px] font-[family-name:var(--font-geist-mono)] text-emerald-600 font-semibold">
            Target
          </span>
        </div>
      </div>

      <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant text-center">
        GPP Trend
      </p>

      <div className="flex items-center gap-4 justify-center">
        <span className="flex items-center gap-1.5 text-[11px] font-[family-name:var(--font-geist-mono)]">
          <span className="w-2 h-2 rounded-full bg-brand-accent" />
          <span className="text-on-surface-variant">Latest: {readings[readings.length - 1]?.gpp.toFixed(0)} GPP</span>
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-[family-name:var(--font-geist-mono)]">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-on-surface-variant">Target: {target} GPP</span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = params.id;

  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: rooms } = useRooms(jobId);
  const { data: photos } = usePhotos(jobId);
  const { data: events } = useJobEvents(jobId);
  const deleteJob = useDeleteJob();

  // Use first room for readings
  const firstRoomId = rooms?.[0]?.id ?? "";
  const { data: readings } = useReadings(jobId, firstRoomId);

  const dayNumber = job?.loss_date ? daysSinceLoss(job.loss_date) : null;

  // Untagged photos (no room assigned)
  const untaggedPhotos = useMemo(
    () => photos?.filter((p) => !p.room_id) ?? [],
    [photos]
  );

  // GPP data from readings
  const gppData = useMemo(() => {
    if (!readings || readings.length === 0) return [];
    return [...readings]
      .sort((a, b) => new Date(a.reading_date).getTime() - new Date(b.reading_date).getTime())
      .filter((r) => r.atmospheric_gpp !== null)
      .map((r) => ({ day: r.day_number ?? 0, gpp: r.atmospheric_gpp! }));
  }, [readings]);

  // Job events for this job, sorted newest first
  const jobEvents = useMemo(() => {
    if (!events) return [];
    return [...events].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [events]);

  if (jobLoading || !job) {
    return <PageSkeleton />;
  }

  const hasPhotos = (photos?.length ?? 0) > 0;
  const hasTechNotes = !!job.tech_notes;

  return (
    <div className="min-h-screen bg-surface">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/15">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
          {/* Back */}
          <button
            type="button"
            onClick={() => router.push("/jobs")}
            aria-label="Back to jobs"
            className="w-9 h-9 -ml-1 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
          >
            <ArrowLeftIcon size={20} />
          </button>

          {/* Address + Job number */}
          <div className="flex-1 min-w-0">
            <h1 className="text-[16px] font-bold text-on-surface truncate leading-tight">
              {job.address_line1}
            </h1>
            <p className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant leading-tight mt-0.5">
              {job.job_number}
            </p>
          </div>

          {/* Right: Day pill + Status badge + Bell + Avatar */}
          <div className="flex items-center gap-2 shrink-0">
            {dayNumber !== null && (
              <span className="px-2.5 py-1 rounded-full bg-brand-accent text-on-primary text-[11px] font-bold font-[family-name:var(--font-geist-mono)] tracking-wide">
                Day {dayNumber}
              </span>
            )}
            <span className="px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface-variant text-[11px] font-semibold font-[family-name:var(--font-geist-mono)]">
              {statusLabel(job.status)}
            </span>
            <button
              type="button"
              aria-label="Notifications"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer hidden sm:flex"
            >
              <BellIcon size={18} />
            </button>
            <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-[12px] font-bold text-on-surface-variant hidden sm:flex">
              BM
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Content Grid ───────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 py-6 pb-28 lg:pb-6 lg:grid lg:grid-cols-[1fr_320px] lg:gap-6">

        {/* ── LEFT COLUMN: Accordion Sections ───────────────────── */}
        <div className="space-y-3">

          {/* Section 1: Job Info */}
          <AccordionSection
            icon={<StatusCheck />}
            title="Job Info"
            preview={
              [job.customer_name, job.carrier, job.claim_number ? `#${job.claim_number}` : null]
                .filter(Boolean)
                .join(" \u00B7 ")
            }
          >
            <div className="space-y-4">
              {/* Customer */}
              <div>
                <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-2">
                  Customer
                </h4>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                  {job.customer_name && (
                    <>
                      <span className="text-on-surface-variant">Name</span>
                      <span className="text-on-surface font-medium">{job.customer_name}</span>
                    </>
                  )}
                  {job.customer_phone && (
                    <>
                      <span className="text-on-surface-variant">Phone</span>
                      <span className="font-[family-name:var(--font-geist-mono)] text-on-surface">{job.customer_phone}</span>
                    </>
                  )}
                  {job.customer_email && (
                    <>
                      <span className="text-on-surface-variant">Email</span>
                      <span className="text-on-surface">{job.customer_email}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Loss Info */}
              <div>
                <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-2">
                  Loss Info
                </h4>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                  {job.loss_date && (
                    <>
                      <span className="text-on-surface-variant">Date</span>
                      <span className="font-[family-name:var(--font-geist-mono)] text-on-surface">{job.loss_date}</span>
                    </>
                  )}
                  {job.loss_cause && (
                    <>
                      <span className="text-on-surface-variant">Cause</span>
                      <span className="text-on-surface">{job.loss_cause}</span>
                    </>
                  )}
                  <span className="text-on-surface-variant">Category</span>
                  <div className="flex gap-2">
                    {job.loss_category && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold font-[family-name:var(--font-geist-mono)]">
                        Cat {job.loss_category}
                      </span>
                    )}
                    {job.loss_class && (
                      <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold font-[family-name:var(--font-geist-mono)]">
                        Class {job.loss_class}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Insurance */}
              <div>
                <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-2">
                  Insurance
                </h4>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                  {job.carrier && (
                    <>
                      <span className="text-on-surface-variant">Carrier</span>
                      <span className="text-on-surface font-medium">{job.carrier}</span>
                    </>
                  )}
                  {job.claim_number && (
                    <>
                      <span className="text-on-surface-variant">Claim #</span>
                      <span className="font-[family-name:var(--font-geist-mono)] text-on-surface">{job.claim_number}</span>
                    </>
                  )}
                  {job.adjuster_name && (
                    <>
                      <span className="text-on-surface-variant">Adjuster</span>
                      <span className="text-on-surface">{job.adjuster_name}</span>
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                className="text-[13px] font-semibold text-brand-accent hover:underline cursor-pointer"
              >
                Edit &rarr;
              </button>
            </div>
          </AccordionSection>

          {/* Section 2: Property Layout */}
          <AccordionSection
            icon={<StatusCheck />}
            title="Property Layout"
            defaultOpen
          >
            <div className="space-y-3">
              {/* Floor plan placeholder */}
              <div className="relative bg-surface-container-high rounded-lg min-h-[200px] flex items-center justify-center overflow-hidden">
                {/* Grid pattern */}
                <div
                  className="absolute inset-0 opacity-[0.08]"
                  style={{
                    backgroundImage: "linear-gradient(to right, var(--on-surface) 1px, transparent 1px), linear-gradient(to bottom, var(--on-surface) 1px, transparent 1px)",
                    backgroundSize: "32px 32px",
                  }}
                />
                {/* Room shapes placeholder */}
                <div className="relative z-10 flex flex-col items-center gap-2 text-on-surface-variant">
                  <svg width={32} height={32} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M3 9h18M9 3v18" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  <span className="text-[12px] font-[family-name:var(--font-geist-mono)]">
                    {rooms?.length ?? 0} rooms mapped
                  </span>
                </div>
                <button
                  type="button"
                  className="absolute bottom-3 right-3 text-[12px] font-semibold text-brand-accent hover:underline cursor-pointer font-[family-name:var(--font-geist-mono)]"
                >
                  View Plan &rarr;
                </button>
              </div>

              {/* Room pills */}
              <div className="flex flex-wrap gap-2">
                {rooms?.map((room) => (
                  <span
                    key={room.id}
                    className="px-3 py-1.5 rounded-full bg-surface-container text-[13px] font-medium text-on-surface cursor-pointer hover:bg-surface-container-high transition-colors"
                  >
                    {room.room_name}
                  </span>
                ))}
                {(!rooms || rooms.length === 0) && (
                  <span className="text-[13px] text-on-surface-variant">No rooms added yet</span>
                )}
              </div>
            </div>
          </AccordionSection>

          {/* Section 3: Photos */}
          <AccordionSection
            icon={untaggedPhotos.length > 0 ? <StatusWarning /> : <StatusCheck />}
            title="Photos"
            badge={
              untaggedPhotos.length > 0 ? (
                <span className="text-[11px] font-bold font-[family-name:var(--font-geist-mono)] text-brand-accent">
                  {untaggedPhotos.length} UNTAGGED
                </span>
              ) : undefined
            }
            defaultOpen
          >
            <div className="space-y-3">
              <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
                {(photos && photos.length > 0
                  ? photos.slice(0, 4)
                  : Array.from({ length: 4 }, () => null)
                ).map((photo, i) => (
                  <div
                    key={photo?.id ?? `placeholder-${i}`}
                    className="relative w-24 h-24 rounded-lg bg-surface-container-high shrink-0 overflow-hidden flex items-center justify-center"
                  >
                    {photo ? (
                      <img src={photo.storage_url} alt={photo.room_name || "Job photo"} className="w-full h-full object-cover" />
                    ) : (
                      <CameraIcon size={18} />
                    )}
                    {/* Untagged dot */}
                    {photo && !photo.room_id && (
                      <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-brand-accent" />
                    )}
                  </div>
                ))}
                {/* Add more */}
                <button
                  type="button"
                  className="w-24 h-24 rounded-lg border-2 border-dashed border-outline-variant/40 shrink-0 flex flex-col items-center justify-center gap-1 text-on-surface-variant hover:border-brand-accent hover:text-brand-accent transition-colors cursor-pointer"
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="text-[10px] font-[family-name:var(--font-geist-mono)] font-semibold uppercase">Add</span>
                </button>
              </div>
              {photos && photos.length > 4 && (
                <p className="text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                  {photos.length} total photos &middot;{" "}
                  <button type="button" className="text-brand-accent hover:underline cursor-pointer font-semibold">
                    View all &rarr;
                  </button>
                </p>
              )}
            </div>
          </AccordionSection>

          {/* Section 4: Readings */}
          <AccordionSection
            icon={<StatusWarning />}
            title="Readings"
            preview={
              gppData.length > 0
                ? `GPP: ${gppData.map((d) => d.gpp.toFixed(0)).join(" \u2192 ")} \u2193 Target: 45`
                : "No readings yet"
            }
          >
            {gppData.length > 0 ? (
              <GppTrendChart readings={gppData} target={45} />
            ) : (
              <p className="text-[13px] text-on-surface-variant py-2">
                No moisture readings logged yet. Use the &quot;Log Reading&quot; action to start tracking.
              </p>
            )}
          </AccordionSection>

          {/* Section 5: Tech Notes */}
          <AccordionSection
            icon={hasTechNotes ? <StatusCheck /> : <StatusGray />}
            title="Tech Notes"
            badge={
              hasTechNotes ? (
                <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                  2 entries today
                </span>
              ) : undefined
            }
            preview={hasTechNotes ? undefined : "No notes yet"}
          >
            {hasTechNotes ? (
              <div className="space-y-3">
                <p className="text-[13px] text-on-surface leading-relaxed">
                  {job.tech_notes}
                </p>
                <button
                  type="button"
                  className="text-[13px] font-semibold text-brand-accent hover:underline cursor-pointer"
                >
                  Edit
                </button>
              </div>
            ) : (
              <p className="text-[13px] text-on-surface-variant py-2">
                No tech notes yet. Add notes from the field.
              </p>
            )}
          </AccordionSection>

          {/* Section 6: AI Scope */}
          <AccordionSection
            icon={<StatusSparkle />}
            title="AI Scope"
            badge={
              hasPhotos ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold font-[family-name:var(--font-geist-mono)] uppercase">
                  Ready
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-bold font-[family-name:var(--font-geist-mono)] uppercase">
                  Needs Photos
                </span>
              )
            }
            compact
          />

          {/* Section 7: Final Report */}
          <AccordionSection
            icon={<StatusLock />}
            title="Final Report"
            badge={
              <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-bold font-[family-name:var(--font-geist-mono)] uppercase">
                Locked
              </span>
            }
            compact
          />
        </div>

        {/* ── RIGHT COLUMN: Sticky Sidebar ──────────────────────── */}
        <div className="hidden lg:block lg:sticky lg:top-20 lg:self-start space-y-4">

          {/* Quick Actions */}
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="flex flex-col items-center justify-center h-20 rounded-xl primary-gradient text-on-primary cursor-pointer hover:opacity-90 transition-opacity"
              >
                <CameraIcon size={22} />
                <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-bold mt-1.5 uppercase tracking-[0.04em]">
                  Take Photo
                </span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center justify-center h-20 rounded-xl primary-gradient text-on-primary cursor-pointer hover:opacity-90 transition-opacity"
              >
                <ChartIcon size={22} />
                <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-bold mt-1.5 uppercase tracking-[0.04em]">
                  Log Reading
                </span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center justify-center h-20 rounded-xl bg-surface-container text-on-surface cursor-pointer hover:bg-surface-container-high transition-colors"
              >
                <MicIcon size={22} />
                <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1.5 uppercase tracking-[0.04em]">
                  Voice Note
                </span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center justify-center h-20 rounded-xl bg-surface-container text-on-surface cursor-pointer hover:bg-surface-container-high transition-colors"
              >
                <PencilIcon size={22} />
                <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1.5 uppercase tracking-[0.04em]">
                  Edit Job
                </span>
              </button>
            </div>
          </section>

          {/* Upcoming Task Requirements */}
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4">
            <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
              Upcoming Task Requirements
            </h3>
            <div className="space-y-3">
              <div className="flex gap-2.5">
                <span className="w-2 h-2 rounded-full bg-error mt-1.5 shrink-0" />
                <div>
                  <p className="text-[13px] font-semibold text-brand-accent">
                    Day {dayNumber ?? 3} readings not logged
                  </p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    Required for AI scoping engine
                  </p>
                </div>
              </div>
              <div className="flex gap-2.5">
                <span className="w-2 h-2 rounded-full bg-surface-container-highest mt-1.5 shrink-0" />
                <div>
                  <p className="text-[13px] font-medium text-on-surface">
                    {untaggedPhotos.length} photos need room tags
                  </p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    Assigned to: Brett Miller
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Activity Timeline */}
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4">
            <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
              Activity Timeline
            </h3>
            <div className="space-y-3">
              {jobEvents.slice(0, 4).map((evt) => (
                <div key={evt.id} className="flex gap-2.5">
                  <span
                    className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                      evt.is_ai ? "bg-brand-accent" : evt.event_type.includes("photo") ? "bg-blue-500" : "bg-surface-container-highest"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] ${evt.is_ai ? "text-brand-accent" : "text-on-surface"}`}>
                      <span className="font-medium">{eventActor(evt)}</span>{" "}
                      {eventDescription(evt)}
                    </p>
                    <p className="text-[10px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant mt-0.5">
                      {formatTime(evt.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 text-[11px] font-[family-name:var(--font-geist-mono)] font-semibold text-brand-accent hover:underline cursor-pointer uppercase tracking-[0.06em]"
            >
              View Full Log
            </button>
          </section>

          {/* Footer Links */}
          <div className="flex items-center gap-4 px-1">
            <button
              type="button"
              className="flex items-center gap-1.5 text-[12px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            >
              <ShareIcon size={14} />
              Share Job
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 text-[12px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            >
              <DocumentIcon size={14} />
              Export PDF
            </button>
            <button
              type="button"
              onClick={async () => {
                if (window.confirm("Are you sure you want to delete this job?")) {
                  await deleteJob.mutateAsync(jobId);
                  router.push("/jobs");
                }
              }}
              disabled={deleteJob.isPending}
              className="flex items-center gap-1.5 text-[12px] font-medium text-error hover:text-error/80 transition-colors cursor-pointer ml-auto disabled:opacity-50"
            >
              <TrashIcon size={14} />
              {deleteJob.isPending ? "Deleting..." : "Delete Job"}
            </button>
          </div>
        </div>
      </main>

      {/* ── Mobile Bottom Action Bar ────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="max-w-lg mx-auto px-4 pb-[68px] md:pb-4">
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_-2px_20px_rgba(31,27,23,0.08),0_-1px_4px_rgba(31,27,23,0.04)] p-2 flex items-stretch gap-1">
            <button
              type="button"
              className="flex-1 flex flex-col items-center justify-center min-h-[56px] rounded-xl primary-gradient text-on-primary cursor-pointer"
            >
              <CameraIcon size={22} />
              <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-bold mt-1 uppercase tracking-[0.04em]">
                Photo
              </span>
            </button>
            <button
              type="button"
              className="flex-1 flex flex-col items-center justify-center min-h-[56px] rounded-xl primary-gradient text-on-primary cursor-pointer"
            >
              <ChartIcon size={22} />
              <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-bold mt-1 uppercase tracking-[0.04em]">
                Reading
              </span>
            </button>
            <button
              type="button"
              className="flex-1 flex flex-col items-center justify-center min-h-[56px] rounded-xl text-on-surface-variant hover:bg-surface-container active:bg-surface-container-high transition-colors cursor-pointer"
            >
              <MicIcon size={22} />
              <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1 uppercase tracking-[0.04em]">
                Voice
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
