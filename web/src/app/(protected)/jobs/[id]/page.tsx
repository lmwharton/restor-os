"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useJob,
  useRooms,
  useAllReadings,
  usePhotos,
  useJobEvents,
  useDeleteJob,
  useCreateShareLink,
  useFloorPlans,
  useFloorPlanHistory,
  useUpdateJob,

  useCreateRoom,
  useDeleteRoom,
  useUpdateRoom,
  useReconPhases,
  useUpdateReconPhase,
  useCreateReconPhase,
  useDeleteReconPhase,
  useReorderReconPhases,
} from "@/lib/hooks/use-jobs";
import { useMe } from "@/lib/hooks/use-me";
import type { JobStatus, ReconPhase, ReconPhaseStatus, Room } from "@/lib/types";
import { STATUS_META } from "@/lib/labels";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ConfirmModal } from "@/components/confirm-modal";
import { JobStatusBadge } from "@/components/job-status-badge";
import { ChangeStatusModal } from "@/components/change-status-modal";
import { CloseoutChecklistModal } from "@/components/closeout-checklist-modal";
import { STATUS_COLORS, withAlpha } from "@/lib/status-colors";
import { isJobArchived } from "@/lib/job-status";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CanvasWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface CanvasFloorOpening {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasRoom {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  fill: string;
  points?: Array<{ x: number; y: number }>;
  floor_openings?: CanvasFloorOpening[];
}

interface CanvasData {
  walls?: CanvasWall[];
  rooms?: CanvasRoom[];
  gridSize?: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function daysSinceLoss(lossDate: string | null): number {
  if (!lossDate) return 0;
  // Use date-only arithmetic to match backend: (reading_date - loss_date) + 1
  const loss = new Date(lossDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - loss.getTime()) / 86_400_000);
  return Math.max(1, diffDays + 1);
}

// Spec 01K — header metric helpers + utility for "X min ago" timestamps.
function daysBetween(start: string | number, end: string | number): number {
  const s = typeof start === "string" ? new Date(start).getTime() : start;
  const e = typeof end === "string" ? new Date(end).getTime() : end;
  return Math.max(0, Math.floor((e - s) / 86400000));
}

function timeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function countRoomsDrying(rooms: Room[]): number {
  // Rooms with active drying = has equipment placed AND not at dry standard yet.
  return rooms.filter((r) => (r.equipment_air_movers + r.equipment_dehus) > 0).length;
}

function countRoomsAtDryStandard(rooms: Room[]): number {
  // Heuristic until backend exposes per-room dry-standard status: rooms with a
  // moisture reading and no equipment placed indicate drying complete.
  return rooms.filter((r) => r.reading_count > 0 && (r.equipment_air_movers + r.equipment_dehus) === 0).length;
}

function countEquipmentOnSite(rooms: Room[]): number {
  return rooms.reduce((sum, r) => sum + r.equipment_air_movers + r.equipment_dehus, 0);
}

function equipmentBreakdown(rooms: Room[]): string {
  const am = rooms.reduce((sum, r) => sum + r.equipment_air_movers, 0);
  const de = rooms.reduce((sum, r) => sum + r.equipment_dehus, 0);
  if (am === 0 && de === 0) return "—";
  const parts: string[] = [];
  if (am > 0) parts.push(`${am} air mover${am === 1 ? "" : "s"}`);
  if (de > 0) parts.push(`${de} dehu${de === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

// Single metric tile in the job-detail header grid.
//
// Spec 01K — `valueColor` is a CSS color (token preferred — e.g.
// `var(--status-on-hold)`) used to render the value when a threshold
// indicates a "watch" or "bad" zone. Default is the neutral on-surface
// ink. Only applied to the big numeric value, not the label/hint, so
// the cell still reads as a metric not an alert.
function MetricBlock({
  label,
  value,
  unit,
  hint,
  last,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
  last?: boolean;
  valueColor?: string;
}) {
  return (
    <div className={`px-4 py-3 ${last ? "" : "border-r border-outline-variant/40"} border-b sm:border-b-0 border-outline-variant/40 last:border-b-0`}>
      <div className="text-[11px] font-semibold tracking-[0.06em] uppercase text-on-surface-variant/80">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="text-[22px] font-bold tracking-[-0.01em] leading-none"
          style={{ color: valueColor ?? "var(--on-surface)" }}
        >
          {value}
        </span>
        {unit && <span className="text-[13px] text-on-surface-variant">{unit}</span>}
      </div>
      {hint && (
        <div className="text-[11px] text-on-surface-variant/70 mt-1">{hint}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Threshold helpers — surface "watch" / "bad" zones in metric grid   */
/*                                                                     */
/*  Color tiers map to the status palette so flipping a token in       */
/*  globals.css cascades. Cycle time:                                  */
/*    < 14 days → neutral                                              */
/*    14-21 days → on_hold (amber)                                     */
/*    > 21 days → disputed (dark amber/red-orange)                     */
/*  Days to payment:                                                   */
/*    < 30 days → neutral                                              */
/*    30-60 days → on_hold (amber)                                     */
/*    > 60 days → disputed                                             */
/* ------------------------------------------------------------------ */

const THRESHOLD_NEUTRAL = "var(--on-surface)";
const THRESHOLD_WATCH   = "var(--status-on-hold)";
const THRESHOLD_BAD     = "var(--status-disputed)";

function cycleTimeColor(days: number | null): string {
  if (days === null) return THRESHOLD_NEUTRAL;
  if (days > 21) return THRESHOLD_BAD;
  if (days >= 14) return THRESHOLD_WATCH;
  return THRESHOLD_NEUTRAL;
}

function daysToPaymentColor(days: number | null): string {
  if (days === null) return THRESHOLD_NEUTRAL;
  if (days > 60) return THRESHOLD_BAD;
  if (days >= 30) return THRESHOLD_WATCH;
  return THRESHOLD_NEUTRAL;
}

function eventDescription(evt: { event_type: string; is_ai: boolean; event_data: Record<string, unknown> }): string {
  switch (evt.event_type) {
    case "photo_uploaded":
      return `added ${evt.event_data.count ?? ""} photo${(evt.event_data.count as number) !== 1 ? "s" : ""}`;
    case "moisture_reading_added":
      return `logged Day ${evt.event_data.day_number ?? "?"} moisture readings`;
    case "ai_sketch_cleanup":
      return "cleaned up floor plan automatically";
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
    case "room_updated":
      return `updated room${evt.event_data.room_name ? ` "${evt.event_data.room_name}"` : ""} dimensions`;
    case "room_deleted":
      return `removed room "${evt.event_data.room_name ?? ""}"`;
    case "photo_tagged":
      return `tagged photo to ${evt.event_data.room_name ?? "a room"}`;
    case "status_changed": {
      // Spec 01K: rpc_update_job_status writes { from_status, to_status }
      // into event_data. STATUS_META gives a human label per status.
      const to = evt.event_data.to_status as string | undefined;
      const from = evt.event_data.from_status as string | undefined;
      const toLabel = to ? STATUS_META[to as JobStatus]?.label ?? to : "";
      const fromLabel = from ? STATUS_META[from as JobStatus]?.label ?? from : "";
      return fromLabel
        ? `changed status from ${fromLabel} to ${toLabel}`
        : `changed status to ${toLabel}`;
    }
    case "report_generated":
      return "generated scope report";
    case "share_link_created":
      return "created a share link";
    default:
      return evt.event_type.replace(/_/g, " ");
  }
}

function eventActor(evt: { is_ai: boolean; user_id: string | null }, currentUserId?: string, currentUserName?: string): string {
  if (evt.is_ai) return "Crewmatic";
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

function ArrowLeftIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
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

function FloorPlanPreview({ canvasData, hasFloorPlan = false }: { canvasData: CanvasData | null; hasFloorPlan?: boolean }) {
  const rawWalls = canvasData?.walls;
  const walls = Array.isArray(rawWalls) ? rawWalls : [];
  const rawRooms = canvasData?.rooms;
  const rooms = Array.isArray(rawRooms) ? rawRooms : [];
  const gs = canvasData?.gridSize || 20;

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
          {/* If a floor plan row exists but the canvas is empty, the user has
              created a floor (e.g. via auto-Main) but hasn't drawn anything
              yet. Saying "No floor plan yet" is misleading in that case. */}
          <span className="text-[12px] font-[family-name:var(--font-geist-mono)]">
            {hasFloorPlan ? "Tap to start drawing" : "No floor plan yet"}
          </span>
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
        {rooms.map((room) => {
          // Net floor SF: subtract cutouts from polygon (or bbox) area.
          // Shoelace for polygons; bbox for rectangles.
          let areaPx: number;
          if (Array.isArray(room.points) && room.points.length >= 3) {
            let sum = 0;
            for (let i = 0; i < room.points.length; i++) {
              const a = room.points[i];
              const b = room.points[(i + 1) % room.points.length];
              sum += a.x * b.y - b.x * a.y;
            }
            areaPx = Math.abs(sum) / 2;
          } else {
            areaPx = room.width * room.height;
          }
          const cutoutsPx = (room.floor_openings ?? []).reduce(
            (s, o) => s + Math.abs(o.width * o.height),
            0,
          );
          const netSf = Math.max(0, (areaPx - cutoutsPx) / (gs * gs));
          return (
            <g key={room.id}>
              <rect
                x={room.x}
                y={room.y}
                width={room.width}
                height={room.height}
                fill={room.fill ?? "rgba(232,93,38,0.08)"}
                stroke="#e85d26"
                strokeWidth={Math.max(1, vbW / 200)}
              />
              {/* Floor cutouts — dashed white rectangles inside the room */}
              {(room.floor_openings ?? []).map((op, i) => (
                <rect
                  key={op.id ?? `cut-${i}`}
                  x={op.x}
                  y={op.y}
                  width={op.width}
                  height={op.height}
                  fill="#ffffff"
                  stroke="#6b6560"
                  strokeWidth={Math.max(0.5, vbW / 300)}
                  strokeDasharray={`${Math.max(1, vbW / 120)} ${Math.max(1, vbW / 150)}`}
                />
              ))}
              {room.name && (
                <>
                  <text
                    x={room.x + room.width / 2}
                    y={room.y + room.height / 2 - 5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={Math.max(8, Math.min(14, Math.min(room.width, room.height) / 6))}
                    fill="#6b6560"
                    fontFamily="var(--font-geist-mono), monospace"
                  >
                    {room.name}
                  </text>
                  <text
                    x={room.x + room.width / 2}
                    y={room.y + room.height / 2 + 7}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={7}
                    fill="#8a847e"
                    fontFamily="var(--font-geist-mono), monospace"
                  >
                    {Math.round(netSf)} SF
                  </text>
                </>
              )}
            </g>
          );
        })}
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
  action,
  defaultOpen = false,
  compact = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  preview?: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] overflow-hidden">
      <div
        role="button"
        tabIndex={compact ? -1 : 0}
        onClick={() => !compact && setOpen(!open)}
        onKeyDown={(e) => { if (!compact && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen(!open); } }}
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
        {open && action && (
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {action}
          </span>
        )}
        <span className="shrink-0 text-on-surface-variant">
          {!compact && open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </span>
      </div>
      {!compact && open && children && (
        <div className="px-5 pb-5 pt-0">
          {children}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Recon Phases Section (interactive)                                 */
/* ------------------------------------------------------------------ */

// Recon phase status palette — distinct from job lifecycle status (Spec 01K).
// These are work-state indicators on individual reconstruction phases.
const PHASE_STATUSES: { value: ReconPhaseStatus; label: string; color: string; bg: string; border: string }[] = [
  { value: "pending",     label: "Pending",     color: "#b5b0aa",                  bg: withAlpha("#b5b0aa", 0.1),                  border: withAlpha("#b5b0aa", 0.3) },
  { value: "in_progress", label: "In Progress", color: STATUS_COLORS.active,       bg: withAlpha(STATUS_COLORS.active, 0.1),       border: withAlpha(STATUS_COLORS.active, 0.3) },
  { value: "on_hold",     label: "On Hold",     color: STATUS_COLORS.on_hold,      bg: withAlpha(STATUS_COLORS.on_hold, 0.1),      border: withAlpha(STATUS_COLORS.on_hold, 0.3) },
  { value: "complete",    label: "Complete",    color: STATUS_COLORS.completed,    bg: withAlpha(STATUS_COLORS.completed, 0.1),    border: withAlpha(STATUS_COLORS.completed, 0.3) },
];

function PhaseStatusIcon({ status }: { status: ReconPhaseStatus }) {
  switch (status) {
    case "complete":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <circle cx="8" cy="8" r="7" fill="#2a9d5c" />
          <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "in_progress":
      return (
        <span className="relative shrink-0 flex h-4 w-4">
          <span className="absolute inset-0 rounded-full bg-type-mitigation animate-ping opacity-40" />
          <span className="relative rounded-full h-4 w-4 bg-type-mitigation" />
        </span>
      );
    case "on_hold":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <circle cx="8" cy="8" r="7" fill="#d97706" fillOpacity="0.15" stroke="#d97706" strokeWidth="1" />
          <rect x="6" y="5" width="1.5" height="6" rx="0.5" fill="#d97706" />
          <rect x="8.5" y="5" width="1.5" height="6" rx="0.5" fill="#d97706" />
        </svg>
      );
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <circle cx="8" cy="8" r="6.5" stroke="#b5b0aa" strokeWidth="1" />
        </svg>
      );
  }
}

function DragHandle({ listeners, attributes }: { listeners?: React.HTMLAttributes<HTMLButtonElement>; attributes?: React.HTMLAttributes<HTMLButtonElement> }) {
  return (
    <button
      type="button"
      className="shrink-0 w-5 h-8 flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant cursor-grab active:cursor-grabbing touch-none"
      {...listeners}
      {...attributes}
      aria-roledescription="sortable"
    >
      <svg width="10" height="16" viewBox="0 0 10 16" fill="none" aria-hidden="true">
        <circle cx="3" cy="2" r="1.2" fill="currentColor" />
        <circle cx="7" cy="2" r="1.2" fill="currentColor" />
        <circle cx="3" cy="8" r="1.2" fill="currentColor" />
        <circle cx="7" cy="8" r="1.2" fill="currentColor" />
        <circle cx="3" cy="14" r="1.2" fill="currentColor" />
        <circle cx="7" cy="14" r="1.2" fill="currentColor" />
      </svg>
    </button>
  );
}

function SortablePhaseRow({
  phase,
  isExpanded,
  onToggle,
  onStatusChange,
  onDelete,
}: {
  phase: ReconPhase;
  isExpanded: boolean;
  onToggle: () => void;
  onStatusChange: (status: ReconPhaseStatus) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: phase.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg overflow-hidden">
      {/* Phase row */}
      <div className="flex items-center gap-1">
        <DragHandle listeners={listeners} attributes={attributes} />
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-3 px-1 py-2.5 rounded-lg hover:bg-surface-container-low/50 transition-colors cursor-pointer text-left"
        >
          <PhaseStatusIcon status={phase.status} />
          <span className="flex-1 text-[14px] font-medium text-on-surface">
            {phase.phase_name}
          </span>
          <span
            className="text-[12px] font-[family-name:var(--font-geist-mono)]"
            style={{ color: phase.status === "complete" ? STATUS_COLORS.completed : phase.status === "in_progress" ? STATUS_COLORS.active : phase.status === "on_hold" ? STATUS_COLORS.on_hold : "#b5b0aa" }}
          >
            {phase.status === "complete" && phase.completed_at
              ? `Completed ${new Date(phase.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : phase.status === "in_progress" ? "In Progress"
              : phase.status === "on_hold" ? "On Hold"
              : "Pending"}
          </span>
          <ChevronDown size={14} className={`text-on-surface-variant transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Expanded: status toggles + notes */}
      {isExpanded && (
        <div className="px-2 pb-3 pt-1 ml-6 space-y-3 animate-[fadeSlideIn_150ms_ease-out]">
          <div className="flex gap-1.5">
            {PHASE_STATUSES.map((s) => {
              const isActive = phase.status === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => onStatusChange(s.value)}
                  aria-label={`Set phase status to ${s.label}`}
                  className={`flex-1 h-8 rounded-md text-[11px] font-semibold border transition-all cursor-pointer ${
                    !isActive ? "bg-surface-container-lowest text-on-surface-variant/60 border-outline-variant/30 hover:border-outline-variant" : ""
                  }`}
                  style={isActive ? { backgroundColor: s.bg, color: s.color, borderColor: s.border } : undefined}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {phase.notes && (
            <p className="text-[12px] text-on-surface-variant px-1">{phase.notes}</p>
          )}
          <div className="flex items-center gap-4 text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant/60 px-1">
            {phase.started_at && (
              <span>Started {new Date(phase.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            )}
            {phase.completed_at && (
              <span>Completed {new Date(phase.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="ml-auto text-[11px] text-error/60 hover:text-error transition-colors cursor-pointer"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReconPhasesSection({ phases: initialPhases, jobId }: { phases: ReconPhase[]; jobId: string }) {
  const [phases, setPhases] = useState(initialPhases);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const updatePhase = useUpdateReconPhase(jobId);
  const createPhase = useCreateReconPhase(jobId);
  const deletePhase = useDeleteReconPhase(jobId);
  const reorderPhases = useReorderReconPhases(jobId);

  // Sync when server data refetches
  useEffect(() => {
    setPhases(initialPhases);
  }, [initialPhases]);

  const sorted = useMemo(() => [...phases].sort((a, b) => a.sort_order - b.sort_order), [phases]);
  const completeCount = phases.filter((p) => p.status === "complete").length;
  const pct = phases.length > 0 ? Math.round((completeCount / phases.length) * 100) : 0;

  function handleStatusChange(phaseId: string, newStatus: ReconPhaseStatus) {
    // Optimistic update
    setPhases((prev) =>
      prev.map((p) => {
        if (p.id !== phaseId) return p;
        return {
          ...p,
          status: newStatus,
          started_at: newStatus === "in_progress" && !p.started_at ? new Date().toISOString() : p.started_at,
          completed_at: newStatus === "complete" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        };
      })
    );
    updatePhase.mutate({ phaseId, status: newStatus });
  }

  const [newPhaseName, setNewPhaseName] = useState("");
  const [showAddInput, setShowAddInput] = useState(false);

  function handleAddPhase() {
    const name = newPhaseName.trim();
    if (!name) return;
    const maxOrder = phases.length > 0 ? Math.max(...phases.map((p) => p.sort_order)) : -1;
    const now = new Date().toISOString();
    const newPhase: ReconPhase = {
      id: crypto.randomUUID(),
      job_id: jobId,
      company_id: "",
      phase_name: name,
      status: "pending",
      sort_order: maxOrder + 1,
      started_at: null,
      completed_at: null,
      notes: null,
      created_at: now,
      updated_at: now,
    };
    setPhases((prev) => [...prev, newPhase]);
    setNewPhaseName("");
    setShowAddInput(false);
    createPhase.mutate({ phase_name: name, sort_order: maxOrder + 1 });
  }

  function handleDeletePhase(phaseId: string) {
    setPhases((prev) => prev.filter((p) => p.id !== phaseId));
    setExpandedId(null);
    deletePhase.mutate(phaseId);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPhases((prev) => {
      const sortedPrev = [...prev].sort((a, b) => a.sort_order - b.sort_order);
      const oldIndex = sortedPrev.findIndex((p) => p.id === active.id);
      const newIndex = sortedPrev.findIndex((p) => p.id === over.id);
      const reordered = arrayMove(sortedPrev, oldIndex, newIndex);
      const updated = reordered.map((p, i) => ({ ...p, sort_order: i }));
      reorderPhases.mutate(updated.map((p) => ({ id: p.id, sort_order: p.sort_order })));
      return updated;
    });
  }

  return (
    <AccordionSection
      icon={
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-on-surface-variant">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      }
      title="Reconstruction Phases"
      defaultOpen
      preview={phases.length > 0 ? `${completeCount} of ${phases.length} complete` : "No phases yet"}
    >
      {phases.length > 0 ? (
        <div className="space-y-1">
          {/* Progress bar */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-1 rounded-full bg-[#eae6e1] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${STATUS_COLORS.active}, ${STATUS_COLORS.paid})`,
                }}
              />
            </div>
            <span className="text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant tabular-nums">
              {pct}%
            </span>
          </div>

          {/* Phase rows — drag to reorder */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sorted.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {sorted.map((phase) => (
                <SortablePhaseRow
                  key={phase.id}
                  phase={phase}
                  isExpanded={expandedId === phase.id}
                  onToggle={() => setExpandedId(expandedId === phase.id ? null : phase.id)}
                  onStatusChange={(status) => handleStatusChange(phase.id, status)}
                  onDelete={() => handleDeletePhase(phase.id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Add Phase */}
          {showAddInput ? (
            <div className="flex items-center gap-2 mt-2 px-2">
              <input
                type="text"
                value={newPhaseName}
                onChange={(e) => setNewPhaseName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddPhase(); if (e.key === "Escape") { setShowAddInput(false); setNewPhaseName(""); } }}
                placeholder="Phase name (e.g. Cabinetry)"
                autoFocus
                className="flex-1 h-9 px-3 rounded-lg bg-surface-container-lowest text-[13px] text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:ring-2 focus:ring-brand-accent/30 border border-outline-variant"
              />
              <button
                type="button"
                onClick={handleAddPhase}
                disabled={!newPhaseName.trim()}
                className="h-9 px-4 rounded-lg text-[12px] font-semibold text-on-primary bg-brand-accent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setShowAddInput(false); setNewPhaseName(""); }}
                className="h-9 px-3 rounded-lg text-[12px] text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddInput(true)}
              className="flex items-center gap-1.5 mt-2 px-2 py-2 text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14m-7-7h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Add Phase
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {!showAddInput && (
            <div className="text-center py-6 border border-dashed border-outline-variant/40 rounded-lg">
              <p className="text-[14px] text-on-surface-variant">Add phases to track your reconstruction progress</p>
              <p className="text-[12px] text-outline-variant mt-1">Common phases: Demo, Drywall, Paint, Flooring, Trim, Final Walkthrough</p>
              <button
                type="button"
                onClick={() => setShowAddInput(true)}
                className="mt-3 h-9 px-5 rounded-lg text-[13px] font-semibold text-on-primary bg-brand-accent cursor-pointer"
              >
                Add Phase
              </button>
            </div>
          )}
          {showAddInput && (
            <div className="flex items-center gap-2 px-2">
              <input
                type="text"
                value={newPhaseName}
                onChange={(e) => setNewPhaseName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddPhase(); if (e.key === "Escape") { setShowAddInput(false); setNewPhaseName(""); } }}
                placeholder="Phase name (e.g. Demo)"
                autoFocus
                className="flex-1 h-9 px-3 rounded-lg bg-surface-container-lowest text-[13px] text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:ring-2 focus:ring-brand-accent/30 border border-outline-variant"
              />
              <button
                type="button"
                onClick={handleAddPhase}
                disabled={!newPhaseName.trim()}
                className="h-9 px-4 rounded-lg text-[12px] font-semibold text-on-primary bg-brand-accent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setShowAddInput(false); setNewPhaseName(""); }}
                className="h-9 px-3 rounded-lg text-[12px] text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </AccordionSection>
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
/*  Job Info Section (single edit mode)                                */
/* ------------------------------------------------------------------ */

function validateField(type: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (type === "email") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) return "Enter a valid email (e.g. name@example.com)";
  }
  if (type === "tel") {
    const digitsOnly = trimmed.replace(/[\s\-().+]/g, "");
    if (!/^\d{7,15}$/.test(digitsOnly)) return "Enter a valid phone number (7-15 digits)";
  }
  return null;
}

interface FieldDef {
  label: string;
  field: string;
  type?: string;
  mono?: boolean;
}

function InfoField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <>
      <span className="text-on-surface-variant text-[13px]">{label}</span>
      <span className={`${mono ? "font-[family-name:var(--font-geist-mono)]" : ""} ${value ? "text-on-surface" : "text-on-surface-variant/50"} text-[13px]`}>
        {value || "Not set"}
      </span>
    </>
  );
}

function EditField({
  label,
  value,
  type = "text",
  mono,
  error,
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  mono?: boolean;
  error?: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <label className="text-on-surface-variant text-[13px] pt-1.5">{label}</label>
      <div>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          placeholder={`Enter ${label.toLowerCase()}...`}
          className={`w-full h-8 px-2.5 rounded-lg bg-surface-container text-[13px] text-on-surface outline-none border transition-colors ${
            error
              ? "border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-200"
              : "border-outline-variant/30 focus:border-brand-accent/50 focus:ring-1 focus:ring-brand-accent/20"
          } ${mono ? "font-[family-name:var(--font-geist-mono)]" : ""}`}
        />
        {error && <p className="mt-0.5 text-[11px] text-red-500">{error}</p>}
      </div>
    </>
  );
}

function JobInfoContent({
  job,
  editing,
  onSave,
  onCancel,
  isSaving,
}: {
  job: {
    customer_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    loss_date: string | null;
    loss_cause: string | null;
    loss_category: string | null;
    loss_class: string | null;
    home_year_built: number | null;
    carrier: string | null;
    claim_number: string | null;
    adjuster_name: string | null;
    adjuster_email: string | null;
    adjuster_phone: string | null;
    job_type: string;
  };
  editing: boolean;
  onSave: (updates: Record<string, string | number | null>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset draft whenever editing is toggled on
  useEffect(() => {
    if (editing) {
      setDraft({
        customer_name: job.customer_name || "",
        customer_phone: job.customer_phone || "",
        customer_email: job.customer_email || "",
        loss_date: job.loss_date || "",
        loss_cause: job.loss_cause || "",
        loss_category: job.loss_category || "",
        loss_class: job.loss_class || "",
        home_year_built: job.home_year_built != null ? String(job.home_year_built) : "",
        carrier: job.carrier || "",
        claim_number: job.claim_number || "",
        adjuster_name: job.adjuster_name || "",
        adjuster_email: job.adjuster_email || "",
        adjuster_phone: job.adjuster_phone || "",
      });
      setErrors({});
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateDraft = (field: string, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => { const next = { ...prev }; delete next[field]; return next; });
  };

  const handleSave = () => {
    // Validate
    const newErrors: Record<string, string> = {};
    const emailFields = ["customer_email", "adjuster_email"];
    const phoneFields = ["customer_phone", "adjuster_phone"];

    for (const f of emailFields) {
      const err = validateField("email", draft[f] || "");
      if (err) newErrors[f] = err;
    }
    for (const f of phoneFields) {
      const err = validateField("tel", draft[f] || "");
      if (err) newErrors[f] = err;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Build only changed fields
    const fieldMap: Record<string, string | null> = {
      customer_name: job.customer_name,
      customer_phone: job.customer_phone,
      customer_email: job.customer_email,
      loss_date: job.loss_date,
      loss_cause: job.loss_cause,
      loss_category: job.loss_category,
      loss_class: job.loss_class,
      carrier: job.carrier,
      claim_number: job.claim_number,
      adjuster_name: job.adjuster_name,
      adjuster_email: job.adjuster_email,
      adjuster_phone: job.adjuster_phone,
    };

    const updates: Record<string, string | number | null> = {};
    for (const [key, original] of Object.entries(fieldMap)) {
      const newVal = (draft[key] || "").trim();
      const origVal = original || "";
      if (newVal !== origVal) {
        updates[key] = newVal || null;
      }
    }

    // Handle home_year_built separately (number field)
    const newYear = (draft.home_year_built || "").trim();
    const origYear = job.home_year_built != null ? String(job.home_year_built) : "";
    if (newYear !== origYear) {
      updates.home_year_built = newYear ? parseInt(newYear, 10) : null;
    }

    onSave(updates);
  };

  const customerFields: FieldDef[] = [
    { label: "Name", field: "customer_name" },
    { label: "Phone", field: "customer_phone", type: "tel", mono: true },
    { label: "Email", field: "customer_email", type: "email" },
  ];
  const lossFields: FieldDef[] = [
    { label: "Date", field: "loss_date", type: "date", mono: true },
    { label: "Cause", field: "loss_cause" },
    { label: "Year Built", field: "home_year_built", type: "number", mono: true },
  ];
  const insuranceFields: FieldDef[] = [
    { label: "Carrier", field: "carrier" },
    { label: "Claim #", field: "claim_number", mono: true },
    { label: "Adjuster", field: "adjuster_name" },
    { label: "Email", field: "adjuster_email", type: "email" },
    { label: "Phone", field: "adjuster_phone", type: "tel", mono: true },
  ];

  const renderFields = (fields: FieldDef[]) =>
    fields.map((f) =>
      editing ? (
        <EditField
          key={f.field}
          label={f.label}
          value={draft[f.field] || ""}
          type={f.type}
          mono={f.mono}
          error={errors[f.field]}
          onChange={(v) => updateDraft(f.field, v)}
        />
      ) : (
        <InfoField
          key={f.field}
          label={f.label}
          value={(job as Record<string, string | null>)[f.field]}
          mono={f.mono}
        />
      )
    );

  return (
    <div className="divide-y divide-outline-variant/15">
      {/* Customer */}
      <div className="pb-4">
        <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-2">
          Customer
        </h4>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 items-start">
          {renderFields(customerFields)}
        </div>
      </div>

      {/* Loss Info */}
      <div className="py-4">
        <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-2">
          Loss Info
        </h4>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 items-start">
          {renderFields(lossFields)}
          {job.job_type === "mitigation" && (
            editing ? (
              <>
                <label className="text-on-surface-variant text-[13px] pt-1.5">Category</label>
                <div className="flex gap-1.5">
                  {[
                    { value: "1", label: "Cat 1", subtitle: "Clean water" },
                    { value: "2", label: "Cat 2", subtitle: "Gray water" },
                    { value: "3", label: "Cat 3", subtitle: "Black water" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      title={opt.subtitle}
                      onClick={() => updateDraft("loss_category", opt.value)}
                      className={`flex-1 h-8 rounded-lg text-[12px] font-semibold transition-all duration-150 cursor-pointer ${
                        draft.loss_category === opt.value
                          ? "bg-brand-accent text-on-primary shadow-sm"
                          : "bg-surface-container text-on-surface-variant border border-outline-variant/30 hover:bg-surface-container-low"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <label className="text-on-surface-variant text-[13px] pt-1.5">Class</label>
                <div className="flex gap-1.5">
                  {[
                    { value: "1", label: "Class 1" },
                    { value: "2", label: "Class 2" },
                    { value: "3", label: "Class 3" },
                    { value: "4", label: "Class 4" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateDraft("loss_class", opt.value)}
                      className={`flex-1 h-8 rounded-lg text-[12px] font-semibold transition-all duration-150 cursor-pointer ${
                        draft.loss_class === opt.value
                          ? "bg-brand-accent text-on-primary shadow-sm"
                          : "bg-surface-container text-on-surface-variant border border-outline-variant/30 hover:bg-surface-container-low"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <span className="text-on-surface-variant text-[13px]">Category</span>
                <span className={job.loss_category ? "text-on-surface text-[13px]" : "text-on-surface-variant/50 text-[13px]"}>
                  {job.loss_category ? `Cat ${job.loss_category}` : "Not set"}
                </span>
                <span className="text-on-surface-variant text-[13px]">Class</span>
                <span className={job.loss_class ? "text-on-surface text-[13px]" : "text-on-surface-variant/50 text-[13px]"}>
                  {job.loss_class ? `Class ${job.loss_class}` : "Not set"}
                </span>
              </>
            )
          )}
        </div>
      </div>

      {/* Insurance */}
      <div className="pt-4">
        <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-2">
          Insurance
        </h4>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 items-start">
          {renderFields(insuranceFields)}
        </div>
      </div>

      {/* Save / Cancel buttons */}
      {editing && (
        <div className="flex items-center gap-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-5 rounded-lg text-[13px] font-medium text-on-surface-variant bg-surface-container-lowest border border-outline-variant/30 hover:bg-surface-container-low transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="h-9 px-5 rounded-lg text-[13px] font-semibold text-on-primary bg-brand-accent hover:shadow-lg active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Room Row (inline rename, dimensions, delete)                       */
/* ------------------------------------------------------------------ */

function RoomRow({
  room,
  onUpdateRoom,
  onDeleteRoom,
}: {
  room: {
    id: string;
    room_name: string;
    width_ft: number | null;
    length_ft: number | null;
    square_footage?: number | null;
    floor_openings?: Array<{ width: number; height: number }> | null;
  };
  onUpdateRoom: (data: Record<string, unknown>) => void;
  onDeleteRoom: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(room.room_name);

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== room.room_name) {
      onUpdateRoom({ room_name: trimmed });
    }
    setRenaming(false);
  };

  return (
    <div className="grid grid-cols-[1fr_60px_60px_50px_28px] gap-1.5 items-center px-1 py-1 rounded-lg hover:bg-surface-container/50 transition-colors">
      {/* Room name — click to rename */}
      {renaming ? (
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") { setDraftName(room.room_name); setRenaming(false); }
          }}
          onFocus={(e) => e.target.select()}
          autoFocus
          className="h-7 px-2 rounded bg-surface-container text-[13px] font-medium text-on-surface outline-none focus:ring-1 focus:ring-brand-accent/40"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setDraftName(room.room_name); setRenaming(true); }}
          className="text-[13px] font-medium text-on-surface truncate text-left cursor-pointer hover:text-brand-accent transition-colors"
          title="Click to rename"
        >
          {room.room_name}
        </button>
      )}

      {/* Width */}
      <input
        type="number"
        defaultValue={room.width_ft ?? ""}
        placeholder="—"
        onFocus={(e) => { e.target.placeholder = ""; e.target.select(); }}
        onBlur={(e) => {
          e.target.placeholder = "—";
          const v = parseFloat(e.target.value) || null;
          if (v !== room.width_ft) onUpdateRoom({ width_ft: v });
        }}
        className="h-7 w-full px-1.5 rounded bg-surface-container text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface text-center outline-none focus:ring-1 focus:ring-brand-accent/40 placeholder:text-on-surface-variant/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />

      {/* Length */}
      <input
        type="number"
        defaultValue={room.length_ft ?? ""}
        placeholder="—"
        onFocus={(e) => { e.target.placeholder = ""; e.target.select(); }}
        onBlur={(e) => {
          e.target.placeholder = "—";
          const v = parseFloat(e.target.value) || null;
          if (v !== room.length_ft) onUpdateRoom({ length_ft: v });
        }}
        className="h-7 w-full px-1.5 rounded bg-surface-container text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface text-center outline-none focus:ring-1 focus:ring-brand-accent/40 placeholder:text-on-surface-variant/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />

      {/* Square footage — prefers the backend-stored net SF (which accounts
          for polygon shape + floor cutouts). Falls back to width × length
          only if nothing has populated square_footage yet. */}
      <span
        className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant tabular-nums text-center"
        title={
          (room.floor_openings?.length ?? 0) > 0
            ? `Net after ${room.floor_openings!.length} cutout${room.floor_openings!.length === 1 ? "" : "s"}`
            : undefined
        }
      >
        {typeof room.square_footage === "number" && room.square_footage > 0
          ? Math.round(room.square_footage)
          : room.width_ft && room.length_ft
            ? Math.round(room.width_ft * room.length_ft)
            : "—"}
      </span>

      {/* Delete */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDeleteRoom(); }}
        className="text-on-surface-variant/30 hover:text-red-600 transition-colors cursor-pointer shrink-0"
        aria-label={`Delete ${room.room_name}`}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tech Notes Section (auto-save with indicator)                      */
/* ------------------------------------------------------------------ */

function useTimeSince(savedAt: number | null) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!savedAt) { setLabel(""); return; }
    const tick = () => {
      const diff = Math.floor((Date.now() - savedAt) / 1000);
      if (diff < 5) setLabel("just now");
      else if (diff < 60) setLabel(`${diff}s ago`);
      else if (diff < 3600) setLabel(`${Math.floor(diff / 60)}m ago`);
      else setLabel("");
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [savedAt]);
  return label;
}

function TechNotesSection({
  techNotes,
  hasTechNotes,
  onSave,
}: {
  techNotes: string | null;
  hasTechNotes: boolean;
  onSave: (val: string | null) => void;
}) {
  const [saveStatus, setSaveStatus] = useState<"idle" | "typing" | "saving" | "saved">("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const timeAgo = useTimeSince(savedAt);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(techNotes || "");

  const doSave = useCallback((val: string) => {
    const trimmed = val.trim();
    if (trimmed === lastSavedRef.current) { setSaveStatus(savedAt ? "saved" : "idle"); return; }
    setSaveStatus("saving");
    lastSavedRef.current = trimmed;
    onSave(trimmed || null);
    setTimeout(() => {
      setSaveStatus("saved");
      setSavedAt(Date.now());
    }, 300);
  }, [onSave, savedAt]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSaveStatus("typing");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const val = e.target.value;
    debounceRef.current = setTimeout(() => doSave(val), 2000);
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSave(e.target.value);
  };

  // Cleanup on unmount
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const statusText = saveStatus === "typing"
    ? "Typing..."
    : saveStatus === "saving"
      ? "Saving..."
      : saveStatus === "saved" && timeAgo
        ? `Saved ${timeAgo}`
        : "Auto-saves as you type";

  const statusColor = saveStatus === "typing"
    ? "text-brand-accent"
    : saveStatus === "saving"
      ? "text-on-surface-variant"
      : saveStatus === "saved" && timeAgo
        ? "text-emerald-600"
        : "text-on-surface-variant/50";

  return (
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
          defaultValue={techNotes || ""}
          placeholder="Add field notes, observations, site conditions..."
          onChange={handleChange}
          onBlur={handleBlur}
          className="w-full min-h-[80px] px-3 py-2 rounded-lg bg-surface-container text-[13px] text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:ring-1 focus:ring-brand-accent/40 resize-y font-[family-name:var(--font-geist-mono)]"
        />
        <div className="flex items-center gap-1.5 mt-1.5">
          {saveStatus === "saved" && timeAgo && (
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" className="text-emerald-600 shrink-0"><path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
          <p className={`text-[11px] font-[family-name:var(--font-geist-mono)] ${statusColor} transition-colors`}>
            {statusText}
          </p>
        </div>
      </div>
    </AccordionSection>
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
  const { data: floorPlans, isLoading: floorPlansLoading } = useFloorPlans(jobId);
  const isArchived = isJobArchived(job?.status);

  // Spec 01K — status change modal + closeout checklist modal state
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [closeoutModalOpen, setCloseoutModalOpen] = useState(false);
  // Archived jobs prefer anchoring on their own pin so the resolved floor
  // matches the frozen view. When the pin is missing (legacy row without
  // floor_plan_id set), fall back to the first is_current row — list_versions
  // scopes by (property, floor_number), so ANY row on a floor this job
  // touched will surface all versions including the ones this job created,
  // enabling the created_by_job_id fallback in bestFloorPlan below.
  const primaryFloorPlanId =
    (isArchived && job?.floor_plan_id) ||
    floorPlans?.[0]?.id ||
    "";
  const { data: fpVersions, isLoading: fpVersionsLoading } = useFloorPlanHistory(primaryFloorPlanId);
  const bestFloorPlan = useMemo(() => {
    if (!floorPlans?.length) return null;
    if (!job) return null;

    // Linear history rule for thumbnail (archived jobs):
    //   1. Pin — frozen audit view, exactly what was submitted.
    //   2. Version this job created (latest) — fallback when the pin is
    //      legacy/stale (e.g., shell created but never re-pinned after a
    //      Case 3 fork before today's backend fix).
    //   3. Floor with most content from floorPlans — last resort for very
    //      old archived data where neither pin nor created_by_job_id resolves.
    //      Not strictly the "frozen" canvas, but guarantees users see SOMETHING
    //      rather than the misleading "Tap to start drawing" empty state on
    //      a job they obviously drew on.
    //
    // Active jobs always show the is_current snapshot (floorPlans filters
    // server-side).
    const hasContent = (cd: CanvasData | null | undefined): boolean => {
      if (!cd) return false;
      const r = Array.isArray(cd.rooms) ? cd.rooms.length : 0;
      const w = Array.isArray(cd.walls) ? cd.walls.length : 0;
      return r > 0 || w > 0;
    };
    if (isArchived) {
      if (!fpVersions) return null; // wait for history
      // 1. Pin
      if (job.floor_plan_id) {
        const pinned = fpVersions.find((v) => v.id === job.floor_plan_id);
        const cd = pinned?.canvas_data as CanvasData | null | undefined;
        if (hasContent(cd)) return cd as CanvasData;
      }
      // 2. Latest version created_by this job
      const ownVersion = [...fpVersions]
        .filter((v) => v.created_by_job_id === job.id)
        .sort((a, b) => b.version_number - a.version_number)[0];
      const ownCd = ownVersion?.canvas_data as CanvasData | null | undefined;
      if (hasContent(ownCd)) return ownCd as CanvasData;
      // 3. Any is_current floor with content (legacy-data safety net).
      // KNOWN LIMITATION: this CAN leak sibling job content into an archived
      // job's preview when pins were lost to legacy bugs. Accept for now so
      // the preview shows *something* rather than a misleading empty state.
      // FOLLOW-UP (tracked in spec 01H Phase 1 TODO): data migration to
      // backfill archived jobs' pins (`jobs.floor_plan_id`) from
      // `created_by_job_id` on floor_plans rows. Once pins are clean, remove
      // this tier so archived previews strictly reflect the frozen snapshot.
      for (const fp of floorPlans) {
        const cd = fp.canvas_data as CanvasData | null;
        if (hasContent(cd)) return cd as CanvasData;
      }
      return null;
    }

    let best: CanvasData | null = null;
    let bestCount = 0;
    for (const fp of floorPlans) {
      const cd = fp.canvas_data as CanvasData | null;
      const count = (cd?.rooms?.length ?? 0) + (cd?.walls?.length ?? 0);
      if (count > bestCount) { best = cd; bestCount = count; }
    }
    return best;
  }, [floorPlans, fpVersions, job, isArchived]);
  const { data: photos } = usePhotos(jobId);
  const { data: events } = useJobEvents(jobId);
  const { data: reconPhases } = useReconPhases(jobId);
  const { data: me } = useMe();
  const deleteJob = useDeleteJob();
  const createShareLink = useCreateShareLink(jobId);
  const updateJob = useUpdateJob(jobId);
  const createRoom = useCreateRoom(jobId);
  const deleteRoom = useDeleteRoom(jobId);
  const updateRoom = useUpdateRoom(jobId);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomWidth, setNewRoomWidth] = useState("");
  const [newRoomLength, setNewRoomLength] = useState("");
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [roomSavedFlash, setRoomSavedFlash] = useState(false);

  const resetAddRoom = () => { setNewRoomName(""); setNewRoomWidth(""); setNewRoomLength(""); setShowAddRoom(false); };

  const handleAddRoom = () => {
    if (!newRoomName.trim()) { return; }
    const w = parseFloat(newRoomWidth) || null;
    const l = parseFloat(newRoomLength) || null;
    const sf = w && l ? Math.round(w * l) : null;
    createRoom.mutate({ room_name: newRoomName.trim(), width_ft: w, length_ft: l, square_footage: sf } as Partial<Room>, {
      onSuccess: () => {
        setNewRoomName(""); setNewRoomWidth(""); setNewRoomLength("");
        setRoomSavedFlash(true);
        setTimeout(() => setRoomSavedFlash(false), 1500);
      },
    });
  };

  const [editingJobInfo, setEditingJobInfo] = useState(false);

  const handleJobInfoSave = useCallback((updates: Record<string, string | number | null>) => {
    if (Object.keys(updates).length === 0) {
      setEditingJobInfo(false);
      return;
    }
    updateJob.mutate(updates as Record<string, string | null>, {
      onSuccess: () => setEditingJobInfo(false),
    });
  }, [updateJob]);

  const [shareModal, setShareModal] = useState<{
    url: string;
    expires_at: string;
  } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [showDeleteJobConfirm, setShowDeleteJobConfirm] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const handleShareJob = useCallback(async () => {
    setShareError(null);
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
      setShareError("Failed to create share link. Please try again.");
      setTimeout(() => setShareError(null), 4000);
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

  // Spec 01K — header metric durations. `Date.now()` is impure, so we
  // freeze it via lazy useState initializer (matches the pattern used in
  // dashboard-client) and reuse the snapshot across both metric memos.
  // Day-granular precision is fine for a header metric — re-mount on
  // route change refreshes it.
  const [renderNow] = useState<number>(() => Date.now());
  const cycleDays = useMemo<number | null>(() => {
    if (!job) return null;
    if (job.active_at && job.completed_at) return daysBetween(job.active_at, job.completed_at);
    if (job.active_at) return daysBetween(job.active_at, renderNow);
    return null;
  }, [job, renderNow]);
  const payDays = useMemo<number | null>(() => {
    if (!job) return null;
    if (job.invoiced_at && job.paid_at) return daysBetween(job.invoiced_at, job.paid_at);
    if (job.invoiced_at) return daysBetween(job.invoiced_at, renderNow);
    return null;
  }, [job, renderNow]);

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
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-container-low active:bg-surface-container-high transition-colors cursor-pointer"
          >
            <ArrowLeftIcon size={20} className="text-on-surface-variant" />
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
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                job.job_type === "mitigation" ? "bg-[var(--type-mitigation-bg)] text-type-mitigation" : "bg-[var(--type-reconstruction-bg)] text-type-reconstruction"
              }`}>
                {job.job_type === "mitigation" ? "MIT" : "REC"}
              </span>
              {job.assigned_to && (
                <span className="text-[11px] text-on-surface-variant">
                  · Assigned to <span className="font-medium text-on-surface">{job.assigned_to}</span>
                </span>
              )}
            </div>
          </div>

          {/* Right: Status pill (clickable, opens ChangeStatusModal) + Day pill */}
          <div className="flex items-center gap-2 shrink-0">
            <JobStatusBadge
              status={job.status}
              size="md"
              interactive
              onClick={() => setStatusModalOpen(true)}
            />
            {dayNumber !== null && (
              <span className="px-2.5 py-1 rounded-full bg-brand-accent text-on-primary text-[11px] font-bold font-[family-name:var(--font-geist-mono)] tracking-wide">
                Day {dayNumber}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Spec 01K — Status change bottom-sheet. Selecting "Completed" hands off
          to the closeout-checklist modal so gates can be evaluated. */}
      <ChangeStatusModal
        open={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        jobId={job.id}
        jobAddress={job.address_line1}
        currentStatus={job.status}
        onCompletedSelected={() => {
          setStatusModalOpen(false);
          setCloseoutModalOpen(true);
        }}
      />
      <CloseoutChecklistModal
        open={closeoutModalOpen}
        onClose={() => setCloseoutModalOpen(false)}
        jobId={job.id}
        jobAddress={job.address_line1}
        jobType={job.job_type}
        currentStatus={job.status}
      />

      {/* ── Spec 01K — Lifecycle meta row + metric blocks ──────────────────────
          Replaces the legacy phase stepper. Status changes go through the
          clickable JobStatusBadge in the header → ChangeStatusModal. */}
      <div className="max-w-6xl mx-auto px-4 pt-3">
        {/* Meta row: contract badge + loss type + adjuster (right-aligned timestamp) */}
        <div className="flex items-center gap-2 flex-wrap">
          {job.contract_signed_at && (
            <span
              className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold"
              style={{ backgroundColor: "#e7f6ec", border: "1px solid #b8e2c5", color: "#1f6f3e" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#2a9d5c" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Contract signed
            </span>
          )}
          {job.loss_category && (
            <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold border border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant">
              Cat {job.loss_category}{job.loss_cause ? ` · ${job.loss_cause}` : ""}
            </span>
          )}
          {job.adjuster_name && (
            <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold border border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant">
              Adjuster · {job.adjuster_name}{job.carrier ? ` · ${job.carrier}` : ""}
            </span>
          )}
          <div className="flex-1" />
          <span className="text-[12px] text-on-surface-variant/70">
            Updated{" "}
            <span className="font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
              {timeAgoShort(job.updated_at)}
            </span>
            {dayNumber !== null && (
              <>
                {" "}· Day{" "}
                <span className="font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                  {dayNumber}
                </span>
              </>
            )}
          </span>
        </div>

        {/* Metric blocks: 4-up grid, single-row card.
            Cycle time + Days to payment are threshold-aware:
              cycle > 21d  → disputed   (red)
              cycle 14-21d → on_hold    (amber)
              pay   > 60d  → disputed   (red)
              pay   30-60d → on_hold    (amber)
            Rooms drying + Equipment on site stay neutral — they're status
            indicators, not durations. */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 bg-surface-container-lowest border border-outline-variant/50 rounded-xl overflow-hidden">
          <MetricBlock
            label="Cycle time"
            value={cycleDays === null ? "—" : String(cycleDays)}
            unit={cycleDays === null ? undefined : "days"}
            valueColor={cycleTimeColor(cycleDays)}
            hint={job.status === "completed" || job.status === "invoiced" || job.status === "paid"
              ? "Active → Completed"
              : "Loss → today"}
          />
          <MetricBlock
            label="Days to payment"
            value={payDays === null ? "—" : String(payDays)}
            unit={payDays === null ? undefined : "days"}
            valueColor={daysToPaymentColor(payDays)}
            hint={
              job.paid_at ? "Invoiced → Paid"
              : job.invoiced_at ? "Invoiced → today"
              : "Not yet invoiced"
            }
          />
          <MetricBlock
            label="Rooms drying"
            value={
              <span>
                <span className="font-[family-name:var(--font-geist-mono)] font-semibold">
                  {countRoomsDrying(rooms ?? [])}
                </span>
                <span className="text-on-surface-variant/60 text-[12px]"> / {(rooms ?? []).length}</span>
              </span>
            }
            hint={
              countRoomsAtDryStandard(rooms ?? []) > 0
                ? `${countRoomsAtDryStandard(rooms ?? [])} at dry standard`
                : "—"
            }
          />
          <MetricBlock
            label="Equipment on site"
            value={
              <span>
                <span className="font-[family-name:var(--font-geist-mono)] font-semibold">
                  {countEquipmentOnSite(rooms ?? [])}
                </span>
                <span className="text-on-surface-variant/60 text-[12px]"> units</span>
              </span>
            }
            hint={equipmentBreakdown(rooms ?? [])}
            last
          />
        </div>
      </div>

      {/* ── Linked Job Banner ─────────────────────────────────── */}
      {job.linked_job_summary && (
        <div className="max-w-6xl mx-auto px-4 pt-4">
          <button
            type="button"
            onClick={() => router.push(`/jobs/${job.linked_job_summary!.id}`)}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[#faf9f7] border border-[#eae6e1] hover:bg-surface-container-low transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-outline-variant">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="flex-1 text-[13px] text-[#6b6560] text-left">
              Linked {job.linked_job_summary.job_type === "mitigation" ? "mitigation" : "reconstruction"} job:{" "}
              <span className="font-semibold text-on-surface">{job.linked_job_summary.job_number}</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-outline-variant">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Main Content Grid ───────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 py-6 pb-32 lg:pb-6 lg:grid lg:grid-cols-[1fr_320px] lg:gap-6">

        {/* ── LEFT COLUMN: Accordion Sections ───────────────────── */}
        <div className="space-y-3">

          {/* Section 1: Job Info */}
          <AccordionSection
            icon={<IconJobInfo />}
            title="Job Info"
            preview={
              [
                job.customer_name,
                job.job_type === "mitigation" && job.loss_category ? `Cat ${job.loss_category}` : null,
                job.job_type === "mitigation" && job.loss_class ? `Class ${job.loss_class}` : null,
              ]
                .filter(Boolean)
                .join(" \u00B7 ")
            }
            action={
              !editingJobInfo ? (
                <button
                  type="button"
                  onClick={() => setEditingJobInfo(true)}
                  className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Edit
                </button>
              ) : null
            }
          >
            <JobInfoContent
              job={job}
              editing={editingJobInfo}
              onSave={handleJobInfoSave}
              onCancel={() => setEditingJobInfo(false)}
              isSaving={updateJob.isPending}
            />
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
                className="relative bg-surface-container-high rounded-lg min-h-[140px] sm:min-h-[200px] flex items-center justify-center overflow-hidden cursor-pointer hover:bg-surface-container-high/80 transition-colors group"
              >
                {jobLoading || floorPlansLoading || (isArchived && fpVersionsLoading) ? (
                  /* Loading shimmer while fetches resolve — prevents the
                     "No floor plan yet" flash on reload when data is still
                     in flight from the backend. Archived jobs additionally
                     wait on fpVersions so the pinned-version canvas resolves
                     before rendering (avoids an empty-state flash before the
                     frozen snapshot arrives). */
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-full h-full bg-gradient-to-r from-surface-container-high via-surface-container to-surface-container-high animate-pulse rounded-lg" />
                    <span className="relative text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/40">
                      Loading…
                    </span>
                  </div>
                ) : (
                  <FloorPlanPreview
                    canvasData={bestFloorPlan}
                    hasFloorPlan={!!floorPlans && floorPlans.length > 0}
                  />
                )}
              </div>
              {/* View Plan link — below preview to avoid overlap */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/jobs/${jobId}/floor-plan`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/jobs/${jobId}/floor-plan`); }}
                className="flex items-center justify-end px-1 py-1 -mt-1 cursor-pointer group"
              >
                <span className="text-[12px] font-semibold text-brand-accent group-hover:underline font-[family-name:var(--font-geist-mono)]">
                  View Plan &rarr;
                </span>
              </div>

              {/* Room list grouped by floor */}
              {rooms && rooms.length > 0 && (() => {
                // Group by floor_plan.id (stable, unique) — NOT floor_name
                // (legacy data can have duplicate "Floor 1" rows from before
                // the preset-naming refactor, which would crash React with
                // duplicate keys).
                const grouped: Array<{ key: string; floorName: string; floorRooms: typeof rooms }> = [];
                const assigned = new Set<string>();

                floorPlans?.forEach((fp) => {
                  const cd = fp.canvas_data as CanvasData | null;
                  const names = cd?.rooms
                    ? new Set(cd.rooms.map((r: { name?: string }) => r.name).filter(Boolean) as string[])
                    : new Set<string>();
                  if (names.size === 0) return;
                  const floorRooms = rooms.filter((r) => names.has(r.room_name) && !assigned.has(r.id));
                  if (floorRooms.length > 0) {
                    grouped.push({ key: fp.id, floorName: fp.floor_name, floorRooms });
                    floorRooms.forEach((r) => assigned.add(r.id));
                  }
                });

                const unassigned = rooms.filter((r) => !assigned.has(r.id));
                if (unassigned.length > 0) {
                  grouped.push({ key: "__unassigned", floorName: grouped.length === 0 ? "Rooms" : "Not on floor plan", floorRooms: unassigned });
                }

                // If no floor plans at all, just show "Rooms"
                if (grouped.length === 0) {
                  grouped.push({ key: "__all", floorName: "Rooms", floorRooms: rooms });
                }

                return (
                  <div className="space-y-4">
                    {grouped.map(({ key, floorName, floorRooms }) => (
                      <div key={key} className="space-y-0.5">
                        <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/70 mb-1.5 px-1">
                          {floorName}
                        </p>
                        {/* Header row — room name column has no label (the floor header above labels this block) */}
                        <div className="grid grid-cols-[1fr_60px_60px_50px_28px] gap-1.5 px-1 mb-1">
                          <span />
                          <span className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/50">W ft</span>
                          <span className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/50">L ft</span>
                          <span className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/50">SF</span>
                          <span />
                        </div>
                        {floorRooms.map((room) => (
                          <RoomRow
                            key={room.id}
                            room={room}
                            onUpdateRoom={(data) => updateRoom.mutate({ roomId: room.id, ...data } as Record<string, unknown> & { roomId: string })}
                            onDeleteRoom={() => deleteRoom.mutate(room.id)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Add room */}
              <div>
                {showAddRoom ? (
                  <div className="rounded-lg bg-surface-container/50 p-3 space-y-2 animate-[fadeSlideIn_200ms_ease-out]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant/50">
                        {roomSavedFlash ? (
                          <span className="text-emerald-600 animate-[fadeSlideIn_150ms_ease-out]">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="inline -mt-0.5 mr-1"><path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Saved — add another
                          </span>
                        ) : createRoom.isPending ? (
                          <span className="text-brand-accent">Saving...</span>
                        ) : (
                          "Name → Width → Length · auto-saves"
                        )}
                      </span>
                      <button type="button" onClick={resetAddRoom} className="w-6 h-6 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer" aria-label="Close">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </button>
                    </div>
                    <div className="grid grid-cols-[1fr_60px_60px] gap-2 items-end sm:grid-cols-[1fr_80px_80px_60px]">
                      <div>
                        <label className="block text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/60 mb-1">Room name</label>
                        <input
                          type="text"
                          value={newRoomName}
                          onChange={(e) => setNewRoomName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddRoom(); if (e.key === "Escape") resetAddRoom(); }}
                          placeholder="Kitchen, Bedroom 1..."
                          autoFocus
                          className="w-full h-8 px-2.5 rounded-lg bg-surface-container-lowest text-[13px] text-on-surface outline-none border border-outline-variant/30 focus:border-brand-accent/50 focus:ring-1 focus:ring-brand-accent/20"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/60 mb-1">W ft</label>
                        <input
                          type="number"
                          value={newRoomWidth}
                          onChange={(e) => setNewRoomWidth(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddRoom(); if (e.key === "Escape") resetAddRoom(); }}
                          placeholder="—"
                          onFocus={(e) => e.target.select()}
                          className="w-full h-8 px-2 rounded-lg bg-surface-container-lowest text-[13px] text-on-surface text-center outline-none border border-outline-variant/30 focus:border-brand-accent/50 focus:ring-1 focus:ring-brand-accent/20 font-[family-name:var(--font-geist-mono)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/60 mb-1">L ft</label>
                        <input
                          type="number"
                          value={newRoomLength}
                          onChange={(e) => setNewRoomLength(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddRoom(); if (e.key === "Escape") resetAddRoom(); }}
                          onBlur={() => { if (newRoomName.trim()) handleAddRoom(); }}
                          placeholder="—"
                          onFocus={(e) => e.target.select()}
                          className="w-full h-8 px-2 rounded-lg bg-surface-container-lowest text-[13px] text-on-surface text-center outline-none border border-outline-variant/30 focus:border-brand-accent/50 focus:ring-1 focus:ring-brand-accent/20 font-[family-name:var(--font-geist-mono)]"
                        />
                      </div>
                      {/* SF auto-calc — desktop only inline */}
                      <div className="hidden sm:block">
                        <label className="block text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/60 mb-1">SF</label>
                        <span className="flex h-8 items-center justify-center text-[13px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                          {newRoomWidth && newRoomLength ? Math.round(parseFloat(newRoomWidth) * parseFloat(newRoomLength)) || "—" : "—"}
                        </span>
                      </div>
                    </div>
                    {/* Mobile SF preview */}
                    {newRoomWidth && newRoomLength && (
                      <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant/60 sm:hidden">
                        {Math.round(parseFloat(newRoomWidth) * parseFloat(newRoomLength)) || 0} sq ft
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddRoom(true)}
                      className="px-3 py-1.5 rounded-full border border-dashed border-outline-variant/40 text-[13px] text-on-surface-variant hover:border-brand-accent hover:text-brand-accent transition-colors cursor-pointer"
                    >
                      + Add room
                    </button>
                    <span className="text-[11px] text-on-surface-variant/40">Double-tap name to rename · auto-saves</span>
                  </div>
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
            <button
              type="button"
              onClick={() => router.push(`/jobs/${jobId}/photos`)}
              className="w-full flex items-center gap-3 cursor-pointer group"
            >
              <div className="flex gap-1 shrink-0">
                {photos && photos.length > 0 && photos.slice(0, 4).map((photo) => (
                  <div key={photo.id} className="w-11 h-11 lg:w-16 lg:h-16 rounded-md bg-surface-container-high overflow-hidden">
                    <img src={photo.storage_url} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
                {(!photos || photos.length === 0) && (
                  <div className="w-11 h-11 lg:w-16 lg:h-16 rounded-md bg-surface-container-high flex items-center justify-center">
                    <CameraIcon size={14} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-on-surface">
                  {photos?.length ?? 0} photo{(photos?.length ?? 0) !== 1 ? "s" : ""}
                </p>
                <p className="text-[11px] text-brand-accent font-semibold group-hover:underline">
                  {photos && photos.length > 0 ? "View all \u2192" : "Add photos \u2192"}
                </p>
              </div>
            </button>
          </AccordionSection>

          {/* Section 3B: Recon Phases (reconstruction jobs only) */}
          {job.job_type === "reconstruction" && (
            <ReconPhasesSection phases={reconPhases ?? []} jobId={jobId} />
          )}

          {/* Section 4: Readings (mitigation only) */}
          {job.job_type === "mitigation" && (
          <AccordionSection
            icon={<IconReadings />}
            title="Moisture Readings"
            defaultOpen={!!(readings && readings.length > 0)}
            preview={
              readings && readings.length > 0
                ? `${readings.length} reading${readings.length !== 1 ? "s" : ""} logged`
                : "No readings yet"
            }
            action={
              rooms && rooms.length > 0 ? (
                <span
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/jobs/${jobId}/readings`)}
                  onKeyDown={(e) => { if (e.key === "Enter") router.push(`/jobs/${jobId}/readings`); }}
                  className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Log Reading
                </span>
              ) : null
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
              ) : (() => {
                const currentDay = dayNumber ?? 1;
                const hasReadingsForCurrentDay = readings?.some((r) => (r.day_number ?? 1) === currentDay);

                // Get latest day's readings grouped by room
                const latestDay = readings && readings.length > 0
                  ? Math.max(...readings.map((r) => r.day_number ?? 1))
                  : null;
                const latestReadings = latestDay != null
                  ? readings!.filter((r) => (r.day_number ?? 1) === latestDay)
                  : [];
                const latestDate = latestReadings.length > 0 ? latestReadings[0].reading_date : null;

                return (
                  <>
                    {/* Latest day header */}
                    {latestDay != null && (
                      <div className="flex items-center justify-between">
                        <p className="text-[12px] text-on-surface-variant/70 font-[family-name:var(--font-geist-mono)]">
                          Day {latestDay}
                          {latestDate && ` — ${new Date(latestDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                        </p>
                        {hasReadingsForCurrentDay && (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                            <svg width={12} height={12} viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Logged today
                          </span>
                        )}
                      </div>
                    )}

                    {/* Per-room read-only summaries */}
                    {latestReadings.length > 0 ? (
                      latestReadings.map((reading) => {
                        const roomName = rooms.find((r) => r.id === reading.room_id)?.room_name ?? "Unknown Room";
                        const dryStd = rooms.find((r) => r.id === reading.room_id)?.dry_standard ?? 16;
                        const pointCount = reading.points?.length ?? 0;
                        const dryCount = reading.points?.filter((p) => p.reading_value <= dryStd).length ?? 0;
                        const wetCount = pointCount - dryCount;
                        const dehu = reading.dehus?.[0];

                        return (
                          <div key={reading.id} className="rounded-lg bg-surface-container/50 p-3 space-y-1.5">
                            <p className="text-[12px] font-semibold text-on-surface font-[family-name:var(--font-geist-mono)]">{roomName}</p>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-[family-name:var(--font-geist-mono)]">
                              <span className="text-on-surface-variant">
                                {reading.atmospheric_temp_f != null ? `${reading.atmospheric_temp_f}°F` : "--"}
                                {" / "}
                                {reading.atmospheric_rh_pct != null ? `${reading.atmospheric_rh_pct}%` : "--"}
                                {" / "}
                                {reading.atmospheric_gpp != null ? `${reading.atmospheric_gpp} GPP` : "-- GPP"}
                              </span>
                              {pointCount > 0 && (
                                <span className="text-on-surface-variant">
                                  {pointCount} pt{pointCount !== 1 ? "s" : ""}
                                  {wetCount > 0 && (
                                    <span className="text-orange-500 ml-1">({wetCount} wet)</span>
                                  )}
                                  {wetCount === 0 && (
                                    <span className="text-emerald-600 ml-1">(all dry)</span>
                                  )}
                                </span>
                              )}
                              {dehu && (
                                <span className="text-on-surface-variant">
                                  {dehu.dehu_model || "Dehu"}
                                  {dehu.rh_out_pct != null ? ` ${dehu.rh_out_pct}%` : ""}
                                  {dehu.temp_out_f != null ? ` / ${dehu.temp_out_f}°F` : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-[12px] text-on-surface-variant/60 font-[family-name:var(--font-geist-mono)]">
                        No readings logged yet
                      </p>
                    )}

                    {/* CTA + View all link */}
                    <div className="flex items-center justify-between pt-1">
                      {!hasReadingsForCurrentDay && (
                        <button
                          type="button"
                          onClick={() => router.push(`/jobs/${jobId}/readings`)}
                          className="h-8 px-4 bg-brand-accent text-on-primary font-semibold rounded-lg text-[12px] active:scale-[0.98] transition-all hover:shadow-lg hover:shadow-primary/20 cursor-pointer"
                        >
                          + Log Today&apos;s Reading
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => router.push(`/jobs/${jobId}/readings`)}
                        className="text-[12px] font-medium text-brand-accent hover:underline cursor-pointer ml-auto"
                      >
                        View all readings →
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </AccordionSection>
          )}

          {/* Section 5: Tech Notes */}
          <TechNotesSection
            techNotes={job.tech_notes}
            hasTechNotes={hasTechNotes}
            onSave={(val) => updateJob.mutate({ tech_notes: val || null })}
          />

          {/* Section 6: Photo Scope */}
          <AccordionSection
            icon={<IconAIScope />}
            title="Photo Scope"
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
            defaultOpen={false}
            preview="View or print report"
          >
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => router.push(`/jobs/${jobId}/report`)}
                className="flex-1 h-10 rounded-lg text-sm font-semibold text-on-primary bg-brand-accent flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] cursor-pointer"
              >
                View {job.job_type === "reconstruction" ? "Reconstruction" : "Scope"} Report →
              </button>
            </div>
          </AccordionSection>
        </div>

        {/* ── RIGHT COLUMN: Sticky Sidebar ──────────────────────── */}
        <div className="hidden lg:block lg:sticky lg:top-20 lg:self-start space-y-4">

          {/* Upcoming Task Requirements */}
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4">
            <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
              To Complete This Job
            </h3>
            <div className="space-y-3">
              {(!readings || readings.length === 0) && (
                <div className="flex gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-error mt-1.5 shrink-0" />
                  <div>
                    <p className="text-[13px] font-semibold text-brand-accent">
                      No moisture readings logged
                    </p>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">
                      Needed for drying documentation
                    </p>
                  </div>
                </div>
              )}
              {readings && readings.length > 0 && !rooms?.length && (
                <div className="flex gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-[13px] font-medium text-on-surface">
                      Add rooms to log per-room readings
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
                      Tag rooms before generating scope
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

          {/* Create Reconstruction Job — shown on mitigation jobs that have
              reached the post-work part of the lifecycle. Spec 01K: legacy
              "complete/submitted/collected" → "completed/invoiced/paid". */}
          {job.job_type === "mitigation" && ["completed", "invoiced", "paid"].includes(job.status) && (
            <button
              type="button"
              onClick={() => router.push(`/jobs/new?type=reconstruction&linked=${jobId}`)}
              className="w-full h-10 rounded-lg text-[13px] font-semibold text-on-surface border border-outline-variant flex items-center justify-center gap-2 hover:bg-surface-container-low transition-colors cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-type-reconstruction">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Create Reconstruction Job
            </button>
          )}

          {/* Share error */}
          {shareError && (
            <p className="text-[12px] text-error px-1 mb-2">{shareError}</p>
          )}

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
              onClick={() => setShowDeleteJobConfirm(true)}
              disabled={deleteJob.isPending}
              className="flex items-center gap-1.5 text-[12px] font-medium text-red-600 hover:bg-red-50 rounded-lg px-2 py-1.5 transition-colors cursor-pointer ml-auto disabled:opacity-50"
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
          <div className="bg-brand-accent rounded-full shadow-[0_2px_12px_rgba(31,27,23,0.15)] flex items-center gap-0 overflow-hidden">
            <button
              type="button"
              onClick={() => router.push(`/jobs/${jobId}/photos`)}
              className="flex-1 flex items-center justify-center gap-1.5 h-10 text-on-primary cursor-pointer active:bg-white/10 transition-colors"
            >
              <CameraIcon size={16} />
              <span className="text-[11px] font-semibold tracking-wide">Photo</span>
            </button>
            <div className="w-px h-5 bg-on-primary/20" />
            <button
              type="button"
              onClick={() => router.push(`/jobs/${jobId}/readings`)}
              className="flex-1 flex items-center justify-center gap-1.5 h-10 text-on-primary cursor-pointer active:bg-white/10 transition-colors"
            >
              <ChartIcon size={16} />
              <span className="text-[11px] font-semibold tracking-wide">Reading</span>
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

      {/* ── Delete Job confirmation modal ─────────────────────── */}
      <ConfirmModal
        open={showDeleteJobConfirm}
        title="Delete this job?"
        description="This will permanently delete the job and all associated data including photos, readings, and floor plans. This action cannot be undone."
        confirmLabel="Delete Job"
        cancelLabel="Cancel"
        variant="danger"
        onCancel={() => setShowDeleteJobConfirm(false)}
        onConfirm={() => {
          setShowDeleteJobConfirm(false);
          deleteJob.mutateAsync(jobId).then(() => router.push("/jobs"));
        }}
      />
    </div>
  );
}
