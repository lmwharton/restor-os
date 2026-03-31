"use client";

import { useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  useJob,
  useRooms,
  useAllReadings,
  usePhotos,
  useJobEvents,
  useDeleteJob,
  useCreateShareLink,
  useFloorPlans,
  useUpdateJob,
  useCreateReading,
  useCreateRoom,
  useDeleteRoom,
} from "@/lib/hooks/use-jobs";
import { apiGet } from "@/lib/api";
// Types used via hook return inference — no direct imports needed

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CanvasWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface CanvasRoom {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  fill: string;
}

interface CanvasData {
  walls?: CanvasWall[];
  rooms?: CanvasRoom[];
}

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
    case "job_complete":
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
      return `added ${evt.event_data.count ?? ""} photo${(evt.event_data.count as number) !== 1 ? "s" : ""}`;
    case "moisture_reading_added":
      return `logged Day ${evt.event_data.day_number ?? "?"} moisture readings`;
    case "ai_sketch_cleanup":
      return "cleaned up floor plan with AI";
    case "ai_photo_analysis":
      return `generated ${evt.event_data.line_items_generated ?? ""} line items from photos`;
    case "job_created":
      return "created the job";
    case "job_updated": {
      const fields = evt.event_data.fields as string[] | undefined;
      if (fields && fields.length > 0) return `updated ${fields.join(", ")}`;
      return "updated job details";
    }
    case "room_added":
      return `added room "${evt.event_data.room_name ?? ""}"`;
    case "room_deleted":
      return `removed room "${evt.event_data.room_name ?? ""}"`;
    case "photo_tagged":
      return `tagged photo to ${evt.event_data.room_name ?? "a room"}`;
    case "status_changed":
      return `changed status to ${evt.event_data.new_status ?? ""}`;
    case "report_generated":
      return "generated scope report";
    case "share_link_created":
      return "created a share link";
    default:
      return evt.event_type.replace(/_/g, " ");
  }
}

function eventActor(evt: { is_ai: boolean; user_id: string | null }, currentUserId?: string, currentUserName?: string): string {
  if (evt.is_ai) return "Crewmatic AI";
  if (currentUserId && evt.user_id === currentUserId && currentUserName) return currentUserName;
  return "Team Member";
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


function TrashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Floor Plan Preview (SVG thumbnail)                                 */
/* ------------------------------------------------------------------ */

function FloorPlanPreview({ canvasData }: { canvasData: CanvasData | null }) {
  const rawWalls = canvasData?.walls;
  const walls = Array.isArray(rawWalls) ? rawWalls : [];
  const rawRooms = canvasData?.rooms;
  const rooms = Array.isArray(rawRooms) ? rawRooms : [];

  if (walls.length === 0 && rooms.length === 0) {
    return (
      <>
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--on-surface) 1px, transparent 1px), linear-gradient(to bottom, var(--on-surface) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-2 text-on-surface-variant">
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 9h18M9 3v18" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="text-[12px] font-[family-name:var(--font-geist-mono)]">No floor plan yet</span>
        </div>
      </>
    );
  }

  // Compute bounding box from rooms and walls
  const allX = [
    ...walls.flatMap((w) => [w.x1, w.x2]),
    ...rooms.flatMap((r) => [r.x, r.x + r.width]),
  ];
  const allY = [
    ...walls.flatMap((w) => [w.y1, w.y2]),
    ...rooms.flatMap((r) => [r.y, r.y + r.height]),
  ];
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const padding = 20;
  const vbW = maxX - minX + padding * 2;
  const vbH = maxY - minY + padding * 2;

  return (
    <>
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`${minX - padding} ${minY - padding} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Floor plan preview"
      >
        {rooms.map((room) => (
          <rect
            key={room.id}
            x={room.x}
            y={room.y}
            width={room.width}
            height={room.height}
            fill={room.fill ?? "rgba(232,93,38,0.08)"}
            stroke="#e85d26"
            strokeWidth={Math.max(1, vbW / 200)}
          />
        ))}
        {walls.map((w, i) => (
          <line
            key={`wall-${i}`}
            x1={w.x1}
            y1={w.y1}
            x2={w.x2}
            y2={w.y2}
            stroke="var(--on-surface)"
            strokeWidth={Math.max(2, vbW / 150)}
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div className="absolute bottom-3 left-3 z-10">
        <span className="text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant bg-surface-container/80 px-2 py-1 rounded">
          {rooms.length} room{rooms.length !== 1 ? "s" : ""} · {walls.length} wall{walls.length !== 1 ? "s" : ""}
        </span>
      </div>
    </>
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
        <span className="shrink-0 text-on-surface-variant">
          {!compact && open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </span>
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

/* Section icons — simple outline strokes, no backgrounds, consistent 18px */

function IconJobInfo() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-on-surface-variant shrink-0">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconLayout() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-on-surface-variant shrink-0">
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 12h18M12 3v18" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconCamera() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-on-surface-variant shrink-0">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconReadings() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-on-surface-variant shrink-0">
      <path d="M14 4h-4a2 2 0 00-2 2v12a2 2 0 002 2h4a2 2 0 002-2V6a2 2 0 00-2-2Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 18v2M10 8h4M10 11h4M10 14h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconNotes() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-on-surface-variant shrink-0">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6M8 13h8M8 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconAIScope() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-on-surface-variant shrink-0">
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconReport() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-on-surface-variant shrink-0">
      <path d="M4 4a2 2 0 012-2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


/* ------------------------------------------------------------------ */
/*  Inline Moisture Quick-Entry                                        */
/* ------------------------------------------------------------------ */

function calculateGPP(tempF: number, rh: number): number {
  const tc = (tempF - 32) * (5 / 9);
  const es = 6.112 * Math.exp((17.67 * tc) / (tc + 243.5));
  const ea = es * (rh / 100);
  const w = (621.97 * ea) / (1013.25 - ea);
  return Math.round(w * 7 * 10) / 10;
}

function InlineReadingForm({ jobId, roomId, roomName, dayNumber, onSaved }: {
  jobId: string;
  roomId: string;
  roomName: string;
  dayNumber: number;
  onSaved: () => void;
}) {
  const createReading = useCreateReading(jobId, roomId);
  const [temp, setTemp] = useState("72");
  const [rh, setRh] = useState("45");
  const [dirty, setDirty] = useState(false);

  const gpp = (() => {
    const t = parseFloat(temp);
    const r = parseFloat(rh);
    if (isNaN(t) || isNaN(r) || r <= 0 || r > 100) return "--";
    return calculateGPP(t, r).toFixed(1);
  })();

  const handleSave = () => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    createReading.mutate(
      { reading_date: dateStr, atmospheric_temp_f: parseFloat(temp) || undefined, atmospheric_rh_pct: parseFloat(rh) || undefined },
      { onSuccess: onSaved }
    );
  };

  return (
    <div className="rounded-lg bg-surface-container/50 p-3 space-y-2">
      <p className="text-[12px] font-semibold text-on-surface font-[family-name:var(--font-geist-mono)]">{roomName}</p>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)] uppercase">Temp °F</label>
          <input type="number" value={temp} onChange={(e) => { setTemp(e.target.value); setDirty(true); }}
            className="w-full h-8 px-2 rounded bg-surface-container-lowest text-[13px] font-[family-name:var(--font-geist-mono)] text-on-surface outline-none focus:ring-1 focus:ring-brand-accent/40" />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)] uppercase">RH %</label>
          <input type="number" value={rh} onChange={(e) => { setRh(e.target.value); setDirty(true); }}
            className="w-full h-8 px-2 rounded bg-surface-container-lowest text-[13px] font-[family-name:var(--font-geist-mono)] text-on-surface outline-none focus:ring-1 focus:ring-brand-accent/40" />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)] uppercase">GPP</label>
          <p className="h-8 flex items-center text-[13px] font-[family-name:var(--font-geist-mono)] font-semibold text-on-surface">{gpp}</p>
        </div>
        <button type="button" onClick={handleSave} disabled={!dirty || createReading.isPending}
          className={`self-end h-8 px-3 rounded-lg text-[12px] font-semibold transition-all ${
            dirty
              ? "bg-brand-accent text-on-primary cursor-pointer hover:opacity-90"
              : "bg-surface-container text-on-surface-variant/50 cursor-default"
          } disabled:opacity-50`}>
          {createReading.isPending ? "..." : "Save"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Editable Field                                              */
/* ------------------------------------------------------------------ */

function EditableField({
  label,
  value,
  field,
  onSave,
  mono = false,
  type = "text",
}: {
  label: string;
  value: string | null;
  field: string;
  onSave: (field: string, value: string) => void;
  mono?: boolean;
  type?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  const handleSave = () => {
    onSave(field, draft.trim());
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value || "");
    setEditing(false);
  };

  if (editing) {
    return (
      <>
        <span className="text-on-surface-variant text-[13px]">{label}</span>
        <div className="flex items-center gap-1.5">
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            autoFocus
            className={`flex-1 h-7 px-2 rounded bg-surface-container text-[13px] text-on-surface outline-none focus:ring-1 focus:ring-brand-accent/40 ${mono ? "font-[family-name:var(--font-geist-mono)]" : ""}`}
          />
          <button type="button" onClick={handleSave} className="text-emerald-600 hover:text-emerald-700 cursor-pointer" aria-label="Save">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button type="button" onClick={handleCancel} className="text-on-surface-variant hover:text-error cursor-pointer" aria-label="Cancel">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <span className="text-on-surface-variant text-[13px]">{label}</span>
      <div className="flex items-center gap-2 group">
        <span className={`${mono ? "font-[family-name:var(--font-geist-mono)]" : ""} ${value ? "text-on-surface" : "text-on-surface-variant/50"} text-[13px]`}>
          {value || "Not set"}
        </span>
        <button
          type="button"
          onClick={() => { setDraft(value || ""); setEditing(true); }}
          className="opacity-0 group-hover:opacity-100 text-on-surface-variant/40 hover:text-brand-accent transition-all cursor-pointer"
          aria-label={`Edit ${label}`}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </>
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
                {(r.gpp ?? 0).toFixed(0)}
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
  const { data: floorPlans } = useFloorPlans(jobId);
  const { data: photos } = usePhotos(jobId);
  const { data: events } = useJobEvents(jobId);
  const { data: me } = useQuery<{ id: string; name: string; first_name: string | null; last_name: string | null }>({
    queryKey: ["me"],
    queryFn: () => apiGet("/v1/me"),
    staleTime: 5 * 60 * 1000,
  });
  const deleteJob = useDeleteJob();
  const createShareLink = useCreateShareLink(jobId);
  const updateJob = useUpdateJob(jobId);
  const createRoom = useCreateRoom(jobId);
  const deleteRoom = useDeleteRoom(jobId);
  const [newRoomName, setNewRoomName] = useState("");
  const [showAddRoom, setShowAddRoom] = useState(false);

  const handleAddRoom = () => {
    if (!newRoomName.trim()) return;
    createRoom.mutate({ room_name: newRoomName.trim() } as Record<string, string>, {
      onSuccess: () => { setNewRoomName(""); setShowAddRoom(false); },
    });
  };

  const handleFieldSave = useCallback((field: string, value: string) => {
    updateJob.mutate({ [field]: value || null } as Record<string, string | null>);
  }, [updateJob]);

  const [shareModal, setShareModal] = useState<{
    url: string;
    expires_at: string;
  } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleShareJob = useCallback(async () => {
    try {
      const result = await createShareLink.mutateAsync({
        scope: "full",
        expires_days: 7,
      });
      setShareModal({
        url: result.share_url,
        expires_at: result.expires_at,
      });
      setShareCopied(false);
    } catch {
      alert("Failed to create share link. Please try again.");
    }
  }, [createShareLink]);

  const handleCopyShareLink = useCallback(async () => {
    if (!shareModal) return;
    try {
      await navigator.clipboard.writeText(shareModal.url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = shareModal.url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  }, [shareModal]);

  const { data: readings } = useAllReadings(jobId);

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
      .filter((r) => r.atmospheric_gpp != null && typeof r.atmospheric_gpp === "number")
      .map((r) => ({ day: r.day_number ?? 0, gpp: Number(r.atmospheric_gpp) }));
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
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant leading-tight">
                {job.job_number}
              </p>
              <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-[10px] font-semibold font-[family-name:var(--font-geist-mono)]">
                {statusLabel(job.status)}
              </span>
              {job.assigned_to && (
                <span className="text-[11px] text-on-surface-variant">
                  · Assigned to <span className="font-medium text-on-surface">{job.assigned_to}</span>
                </span>
              )}
            </div>
          </div>

          {/* Right: Day pill */}
          <div className="flex items-center gap-2 shrink-0">
            {dayNumber !== null && (
              <span className="px-2.5 py-1 rounded-full bg-brand-accent text-on-primary text-[11px] font-bold font-[family-name:var(--font-geist-mono)] tracking-wide">
                Day {dayNumber}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content Grid ───────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 py-6 pb-28 lg:pb-6 lg:grid lg:grid-cols-[1fr_320px] lg:gap-6">

        {/* ── LEFT COLUMN: Accordion Sections ───────────────────── */}
        <div className="space-y-3">

          {/* Section 1: Job Info */}
          <AccordionSection
            icon={<IconJobInfo />}
            title="Job Info"
            preview={
              [
                job.customer_name,
                job.loss_category ? `Cat ${job.loss_category}` : null,
                job.loss_class ? `Class ${job.loss_class}` : null,
              ]
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
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  <EditableField label="Name" value={job.customer_name} field="customer_name" onSave={handleFieldSave} />
                  <EditableField label="Phone" value={job.customer_phone} field="customer_phone" onSave={handleFieldSave} mono type="tel" />
                  <EditableField label="Email" value={job.customer_email} field="customer_email" onSave={handleFieldSave} type="email" />
                </div>
              </div>

              {/* Loss Info */}
              <div>
                <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-2">
                  Loss Info
                </h4>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  <EditableField label="Date" value={job.loss_date} field="loss_date" onSave={handleFieldSave} mono type="date" />
                  <EditableField label="Cause" value={job.loss_cause} field="loss_cause" onSave={handleFieldSave} />
                  <span className="text-on-surface-variant text-[13px]">Category</span>
                  <span className={job.loss_category ? "text-on-surface text-[13px]" : "text-on-surface-variant/50 text-[13px]"}>
                    {job.loss_category ? `Cat ${job.loss_category}` : "Not set"}
                  </span>
                  <span className="text-on-surface-variant text-[13px]">Class</span>
                  <span className={job.loss_class ? "text-on-surface text-[13px]" : "text-on-surface-variant/50 text-[13px]"}>
                    {job.loss_class ? `Class ${job.loss_class}` : "Not set"}
                  </span>
                </div>
              </div>

              {/* Insurance */}
              <div>
                <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-2">
                  Insurance
                </h4>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  <EditableField label="Carrier" value={job.carrier} field="carrier" onSave={handleFieldSave} />
                  <EditableField label="Claim #" value={job.claim_number} field="claim_number" onSave={handleFieldSave} mono />
                  <EditableField label="Adjuster" value={job.adjuster_name} field="adjuster_name" onSave={handleFieldSave} />
                  <EditableField label="Email" value={job.adjuster_email} field="adjuster_email" onSave={handleFieldSave} type="email" />
                  <EditableField label="Phone" value={job.adjuster_phone} field="adjuster_phone" onSave={handleFieldSave} mono type="tel" />
                </div>
              </div>

            </div>
          </AccordionSection>

          {/* Section 2: Property Layout */}
          <AccordionSection
            icon={<IconLayout />}
            title="Property Layout"
            defaultOpen={!!(rooms && rooms.length > 0)}
            preview={
              rooms && rooms.length > 0
                ? [
                    `${rooms.length} room${rooms.length !== 1 ? "s" : ""}`,
                    floorPlans && floorPlans.length > 0 ? `${floorPlans.length} floor${floorPlans.length !== 1 ? "s" : ""}` : null,
                    rooms.slice(0, 3).map(r => r.room_name).join(", "),
                  ].filter(Boolean).join(" \u00b7 ")
                : "No rooms added yet"
            }
          >
            <div className="space-y-3">
              {/* Floor plan preview — renders saved sketch or empty state */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/jobs/${jobId}/floor-plan`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/jobs/${jobId}/floor-plan`); }}
                className="relative bg-surface-container-high rounded-lg min-h-[200px] flex items-center justify-center overflow-hidden cursor-pointer hover:bg-surface-container-high/80 transition-colors group"
              >
                <FloorPlanPreview canvasData={(floorPlans?.[0]?.canvas_data as CanvasData) ?? null} />
                <span className="absolute bottom-3 right-3 z-10 text-[12px] font-semibold text-brand-accent group-hover:underline font-[family-name:var(--font-geist-mono)]">
                  View Plan &rarr;
                </span>
              </div>

              {/* Room pills */}
              <div className="flex flex-wrap gap-2">
                {rooms?.map((room) => (
                  <span
                    key={room.id}
                    className="group px-3 py-1.5 rounded-full bg-surface-container text-[13px] font-medium text-on-surface flex items-center gap-1.5"
                  >
                    {room.room_name}
                    {room.width_ft && room.length_ft && (
                      <span className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)] ml-1">
                        {room.width_ft}&times;{room.length_ft}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deleteRoom.mutate(room.id); }}
                      className="opacity-0 group-hover:opacity-100 text-on-surface-variant/40 hover:text-error transition-all cursor-pointer"
                      aria-label={`Remove ${room.room_name}`}
                    >
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                  </span>
                ))}
                {showAddRoom ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddRoom(); if (e.key === "Escape") { setShowAddRoom(false); setNewRoomName(""); } }}
                      placeholder="Kitchen, Bedroom 1..."
                      autoFocus
                      className="h-8 px-3 rounded-full bg-surface-container text-[13px] text-on-surface outline-none focus:ring-1 focus:ring-brand-accent/40 w-40"
                    />
                    <button type="button" onClick={handleAddRoom} disabled={!newRoomName.trim() || createRoom.isPending}
                      className="text-emerald-600 hover:text-emerald-700 cursor-pointer disabled:opacity-40" aria-label="Save room">
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button type="button" onClick={() => { setShowAddRoom(false); setNewRoomName(""); }}
                      className="text-on-surface-variant hover:text-error cursor-pointer" aria-label="Cancel">
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddRoom(true)}
                    className="px-3 py-1.5 rounded-full border border-dashed border-outline-variant/40 text-[13px] text-on-surface-variant hover:border-brand-accent hover:text-brand-accent transition-colors cursor-pointer"
                  >
                    + Add room
                  </button>
                )}
              </div>
            </div>
          </AccordionSection>

          {/* Section 3: Photos */}
          <AccordionSection
            icon={<IconCamera />}
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
                {photos && photos.length > 0 && photos.slice(0, 4).map((photo) => (
                  <div
                    key={photo.id}
                    className="relative w-24 h-24 rounded-lg bg-surface-container-high shrink-0 overflow-hidden flex items-center justify-center"
                  >
                    <img src={photo.storage_url} alt={photo.room_name || "Job photo"} className="w-full h-full object-cover" />
                    {/* Untagged dot */}
                    {!photo.room_id && (
                      <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-brand-accent" />
                    )}
                  </div>
                ))}
                {/* Add button */}
                <button
                  type="button"
                  onClick={() => router.push(`/jobs/${jobId}/photos`)}
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
                  <button type="button" onClick={() => router.push(`/jobs/${jobId}/photos`)} className="text-brand-accent hover:underline cursor-pointer font-semibold">
                    View all &rarr;
                  </button>
                </p>
              )}
            </div>
          </AccordionSection>

          {/* Section 4: Readings */}
          <AccordionSection
            icon={<IconReadings />}
            title="Moisture Readings"
            defaultOpen={!!(readings && readings.length > 0)}
            preview={
              readings && readings.length > 0
                ? `${readings.length} reading${readings.length !== 1 ? "s" : ""} logged`
                : "No readings yet"
            }
          >
            <div className="space-y-3">
              {gppData.length > 0 && (
                <GppTrendChart readings={gppData} target={45} />
              )}

              {(!rooms || rooms.length === 0) ? (
                <p className="text-[13px] text-on-surface-variant">
                  Add rooms first to log moisture readings.
                </p>
              ) : (
                <>
                  <p className="text-[12px] text-on-surface-variant/70 font-[family-name:var(--font-geist-mono)]">
                    Day {(gppData.length || 0) + 1} — Log temperature and humidity per room
                  </p>
                  {rooms.map((room) => (
                    <InlineReadingForm
                      key={room.id}
                      jobId={jobId}
                      roomId={room.id}
                      roomName={room.room_name}
                      dayNumber={(gppData.length || 0) + 1}
                      onSaved={() => {}}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => router.push(`/jobs/${jobId}/readings`)}
                    className="text-[12px] font-medium text-brand-accent hover:underline cursor-pointer"
                  >
                    Open full readings view →
                  </button>
                </>
              )}
            </div>
          </AccordionSection>

          {/* Section 5: Tech Notes */}
          <AccordionSection
            icon={<IconNotes />}
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
            <div>
              <textarea
                defaultValue={job.tech_notes || ""}
                placeholder="Add field notes, observations, site conditions..."
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val !== (job.tech_notes || "")) {
                    updateJob.mutate({ tech_notes: val || null });
                  }
                }}
                className="w-full min-h-[80px] px-3 py-2 rounded-lg bg-surface-container text-[13px] text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:ring-1 focus:ring-brand-accent/40 resize-y font-[family-name:var(--font-geist-mono)]"
              />
              <p className="text-[11px] text-on-surface-variant/50 mt-1.5">
                Auto-saves on blur. Voice input coming soon.
              </p>
            </div>
          </AccordionSection>

          {/* Section 6: AI Scope */}
          <AccordionSection
            icon={<IconAIScope />}
            title="AI Scope"
            badge={
              hasPhotos ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold font-[family-name:var(--font-geist-mono)] uppercase">
                  Ready
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant/70 text-[9px] font-bold font-[family-name:var(--font-geist-mono)] uppercase">
                  Needs Photos
                </span>
              )
            }
            compact
          />

          {/* Section 7: Final Report */}
          <AccordionSection
            icon={<IconReport />}
            title="Final Report"
            badge={
              <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant/70 text-[9px] font-bold font-[family-name:var(--font-geist-mono)] uppercase">
                Locked
              </span>
            }
            compact
          />
        </div>

        {/* ── RIGHT COLUMN: Sticky Sidebar ──────────────────────── */}
        <div className="hidden lg:block lg:sticky lg:top-20 lg:self-start space-y-4">

          {/* Upcoming Task Requirements */}
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4">
            <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
              To Complete This Job
            </h3>
            <div className="space-y-3">
              {(!readings || readings.length === 0 || !readings.some((r) => {
                const now = new Date();
                const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
                return r.reading_date === localDate;
              })) && (
                <div className="flex gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-error mt-1.5 shrink-0" />
                  <div>
                    <p className="text-[13px] font-semibold text-brand-accent">
                      Day {dayNumber ?? 1} readings not logged
                    </p>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">
                      Needed for drying documentation
                    </p>
                  </div>
                </div>
              )}
              {photos && photos.length > 0 && (
                <div className="flex gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-surface-container-highest mt-1.5 shrink-0" />
                  <div>
                    <p className="text-[13px] font-medium text-on-surface">
                      {untaggedPhotos.length} photos need room tags
                    </p>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">
                      Tag rooms before AI scope
                    </p>
                  </div>
                </div>
              )}
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
                      <span className="font-medium">{eventActor(evt, me?.id, me?.name || [me?.first_name, me?.last_name].filter(Boolean).join(" ") || undefined)}</span>{" "}
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
              onClick={() => router.push(`/jobs/${jobId}/timeline`)}
              className="mt-3 text-[11px] font-[family-name:var(--font-geist-mono)] font-semibold text-brand-accent hover:underline cursor-pointer uppercase tracking-[0.06em]"
            >
              View Full Log
            </button>
          </section>

          {/* Footer Links */}
          <div className="flex items-center gap-4 px-1">
            <button
              type="button"
              onClick={handleShareJob}
              disabled={createShareLink.isPending}
              title="Creates a read-only link for adjusters and customers"
              className="flex items-center gap-1.5 text-[12px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer disabled:opacity-50"
            >
              <ShareIcon size={14} />
              {createShareLink.isPending ? "Creating..." : "Share Job"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 3000);
                  return;
                }
                deleteJob.mutateAsync(jobId).then(() => router.push("/jobs")).catch((err) => {
                  alert(err instanceof Error ? err.message : "Failed to delete job.");
                  setConfirmDelete(false);
                });
              }}
              disabled={deleteJob.isPending}
              className={`flex items-center gap-1.5 text-[12px] font-medium transition-colors cursor-pointer ml-auto disabled:opacity-50 ${
                confirmDelete ? "text-on-primary bg-error px-3 py-1.5 rounded-lg" : "text-error hover:text-error/80"
              }`}
            >
              <TrashIcon size={14} />
              {deleteJob.isPending ? "Deleting..." : confirmDelete ? "Confirm Delete?" : "Delete Job"}
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
              onClick={() => router.push(`/jobs/${jobId}/photos`)}
              className="flex-1 flex flex-col items-center justify-center min-h-[56px] rounded-xl primary-gradient text-on-primary cursor-pointer"
            >
              <CameraIcon size={22} />
              <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-bold mt-1 uppercase tracking-[0.04em]">
                Photo
              </span>
            </button>
            <button
              type="button"
              onClick={() => router.push(`/jobs/${jobId}/readings`)}
              className="flex-1 flex flex-col items-center justify-center min-h-[56px] rounded-xl primary-gradient text-on-primary cursor-pointer"
            >
              <ChartIcon size={22} />
              <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-bold mt-1 uppercase tracking-[0.04em]">
                Reading
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Share Link Modal ─────────────────────────────────── */}
      {shareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl bg-surface-container-lowest shadow-[0_8px_32px_rgba(31,27,23,0.12)] p-6 space-y-4">
            <h3 className="text-lg font-semibold text-on-surface">Share Link Created</h3>
            <p className="text-sm text-on-surface-variant">
              Anyone with this link can view this job. Expires in 7 days.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareModal.url}
                className="flex-1 h-10 px-3 rounded-lg bg-surface-container-low text-sm text-on-surface font-[family-name:var(--font-geist-mono)] outline-none select-all truncate"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={handleCopyShareLink}
                className="shrink-0 h-10 px-4 rounded-lg bg-brand-accent text-on-primary text-sm font-medium transition-colors hover:bg-brand-accent/90 cursor-pointer"
              >
                {shareCopied ? "Copied!" : "Copy Link"}
              </button>
            </div>
            <p className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
              Expires {new Date(shareModal.expires_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShareModal(null)}
                className="h-9 px-4 rounded-lg text-sm font-medium text-on-surface-variant hover:bg-surface-container-low transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
