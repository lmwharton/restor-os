"use client";

import { useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useJob, useRooms, useReadings, usePhotos } from "@/lib/hooks/use-jobs";
import type { Room, MoistureReading } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function daysSinceLoss(lossDate: string | null): number {
  if (!lossDate) return 0;
  const diff = Date.now() - new Date(lossDate).getTime();
  return Math.max(1, Math.ceil(diff / 86_400_000));
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function categoryColor(cat: string | null): string {
  switch (cat) {
    case "1":
      return "bg-emerald-100 text-emerald-700";
    case "2":
      return "bg-amber-100 text-amber-700";
    case "3":
      return "bg-red-100 text-red-700";
    default:
      return "bg-surface-container-high text-on-surface-variant";
  }
}

function classColor(cls: string | null): string {
  switch (cls) {
    case "1":
      return "bg-sky-100 text-sky-700";
    case "2":
      return "bg-blue-100 text-blue-700";
    case "3":
      return "bg-indigo-100 text-indigo-700";
    case "4":
      return "bg-violet-100 text-violet-700";
    default:
      return "bg-surface-container-high text-on-surface-variant";
  }
}

function getLatestReading(
  readings: MoistureReading[] | undefined
): MoistureReading | null {
  if (!readings || readings.length === 0) return null;
  return [...readings].sort(
    (a, b) =>
      new Date(b.reading_date).getTime() - new Date(a.reading_date).getTime()
  )[0];
}

function getPreviousReading(
  readings: MoistureReading[] | undefined
): MoistureReading | null {
  if (!readings || readings.length < 2) return null;
  const sorted = [...readings].sort(
    (a, b) =>
      new Date(b.reading_date).getTime() - new Date(a.reading_date).getTime()
  );
  return sorted[1];
}

/* ------------------------------------------------------------------ */
/*  Icons (inline SVGs for field mode — no extra imports)              */
/* ------------------------------------------------------------------ */

function ChevronLeft({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRight({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 18l6-6-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FanIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 12c-1.66-2.87-1-6.46 1.5-8.5 3.03-2.47 5.5-.5 5.5 2 0 3-3 4.5-7 6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 12c2.87-1.66 6.46-1 8.5 1.5 2.47 3.03.5 5.5-2 5.5-3 0-4.5-3-6.5-7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 12c1.66 2.87 1 6.46-1.5 8.5-3.03 2.47-5.5.5-5.5-2 0-3 3-4.5 7-6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 12c-2.87 1.66-6.46 1-8.5-1.5C1.03 7.47 3 5 5.5 5c3 0 4.5 3 6.5 7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function DehuIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="5"
        y="4"
        width="14"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12 8v2m0 4v2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M9 10h6m-6 4h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CameraIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2v11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ChartIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M18 20V10M12 20V4M6 20v-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="1"
        width="6"
        height="11"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M19 10v1a7 7 0 0 1-14 0v-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="19"
        x2="12"
        y2="23"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="8"
        y1="23"
        x2="16"
        y2="23"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MinusIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <line
        x1="5"
        y1="12"
        x2="19"
        y2="12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <line
        x1="12"
        y1="5"
        x2="12"
        y2="19"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="5"
        y1="12"
        x2="19"
        y2="12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function FieldModeSkeleton() {
  return (
    <div className="flex flex-col min-h-screen bg-surface">
      {/* Header skeleton */}
      <div className="sticky top-0 z-40 h-14 bg-surface/70 backdrop-blur-xl border-b border-outline-variant/20 flex items-center justify-between px-4">
        <div className="w-8 h-8 rounded-lg bg-surface-container animate-pulse" />
        <div className="w-32 h-5 rounded bg-surface-container animate-pulse" />
        <div className="w-14 h-6 rounded-full bg-surface-container animate-pulse" />
      </div>
      <div className="flex-1 max-w-lg mx-auto w-full px-4 pt-5 space-y-4">
        <div className="h-20 rounded-2xl bg-surface-container-lowest animate-pulse" />
        <div className="h-32 rounded-2xl bg-surface-container-lowest animate-pulse" />
        <div className="h-24 rounded-2xl bg-surface-container-lowest animate-pulse" />
        <div className="h-40 rounded-2xl bg-surface-container-lowest animate-pulse" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Equipment Counter                                                  */
/* ------------------------------------------------------------------ */

function EquipmentCounter({
  icon,
  label,
  count,
  onDecrement,
  onIncrement,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center gap-2">
      <div className="flex items-center gap-1.5 text-on-surface-variant">
        {icon}
        <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] font-semibold">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onDecrement}
          disabled={count <= 0}
          aria-label={`Decrease ${label}`}
          className="w-12 h-12 flex items-center justify-center rounded-lg border border-outline-variant/40 text-on-surface-variant hover:border-brand-accent hover:text-brand-accent active:bg-brand-accent/10 disabled:opacity-30 disabled:hover:border-outline-variant/40 disabled:hover:text-on-surface-variant transition-colors cursor-pointer"
        >
          <MinusIcon />
        </button>
        <span className="text-2xl font-[family-name:var(--font-geist-mono)] font-bold text-on-surface tabular-nums min-w-[2ch] text-center">
          {count}
        </span>
        <button
          type="button"
          onClick={onIncrement}
          aria-label={`Increase ${label}`}
          className="w-12 h-12 flex items-center justify-center rounded-lg border border-outline-variant/40 text-on-surface-variant hover:border-brand-accent hover:text-brand-accent active:bg-brand-accent/10 transition-colors cursor-pointer"
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

export default function JobFieldModePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = params.id;

  // Data hooks
  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: rooms } = useRooms(jobId);

  // Room navigation state
  const [roomIndex, setRoomIndex] = useState(0);
  const currentRoom: Room | undefined = rooms?.[roomIndex];
  const roomId = currentRoom?.id ?? "";

  // Readings for current room
  const { data: readings } = useReadings(jobId, roomId);
  const { data: photos } = usePhotos(jobId);

  // Equipment local state (mock edits)
  const [airMoverDelta, setAirMoverDelta] = useState<Record<string, number>>(
    {}
  );
  const [dehuDelta, setDehuDelta] = useState<Record<string, number>>({});

  const airMovers =
    (currentRoom?.equipment_air_movers ?? 0) + (airMoverDelta[roomId] ?? 0);
  const dehus =
    (currentRoom?.equipment_dehus ?? 0) + (dehuDelta[roomId] ?? 0);

  // Latest and previous readings
  const latestReading = useMemo(
    () => getLatestReading(readings),
    [readings]
  );
  const previousReading = useMemo(
    () => getPreviousReading(readings),
    [readings]
  );

  // GPP calculation
  const currentGpp = latestReading?.atmospheric_gpp ?? null;
  const previousGpp = previousReading?.atmospheric_gpp ?? null;
  const targetGpp = 45; // Standard dry target for GPP
  const gppTrend =
    currentGpp !== null && previousGpp !== null
      ? currentGpp < previousGpp
        ? "dropping"
        : currentGpp > previousGpp
          ? "rising"
          : "stable"
      : null;

  // GPP progress (0..1, clamped): from starting high GPP towards target
  const startGpp = 85; // assumed starting GPP
  const gppProgress =
    currentGpp !== null
      ? Math.min(
          1,
          Math.max(0, (startGpp - currentGpp) / (startGpp - targetGpp))
        )
      : 0;

  // Day number
  const dayNumber = job?.loss_date ? daysSinceLoss(job.loss_date) : null;

  // Room photos
  const roomPhotos = useMemo(() => {
    if (!photos || !currentRoom) return [];
    return photos.filter((p) => p.room_id === currentRoom.id);
  }, [photos, currentRoom]);

  const totalPhotos = roomPhotos.length;

  // Navigation handlers
  const prevRoom = useCallback(() => {
    setRoomIndex((i) => Math.max(0, i - 1));
  }, []);

  const nextRoom = useCallback(() => {
    if (!rooms) return;
    setRoomIndex((i) => Math.min(rooms.length - 1, i + 1));
  }, [rooms]);

  // Loading
  if (jobLoading || !job) {
    return <FieldModeSkeleton />;
  }

  const roomCount = rooms?.length ?? 0;
  const hasRooms = roomCount > 0;

  return (
    <div className="flex flex-col min-h-screen bg-surface">
      {/* ── Sticky Header ───────────────────────────────────────── */}
      <header className="sticky top-0 z-40 h-14 bg-surface/70 backdrop-blur-xl border-b border-outline-variant/20">
        <div className="h-full max-w-lg lg:max-w-6xl mx-auto w-full px-4 flex items-center justify-between">
          {/* Back */}
          <button
            type="button"
            onClick={() => router.push("/jobs")}
            aria-label="Back to jobs"
            className="w-10 h-10 -ml-2 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface active:bg-surface-container transition-colors cursor-pointer"
          >
            <ChevronLeft />
          </button>

          {/* Address */}
          <h1 className="text-[15px] font-semibold text-on-surface truncate max-w-[50%] text-center">
            {job.address_line1}
          </h1>

          {/* Day pill */}
          {dayNumber !== null && (
            <span className="shrink-0 px-3 py-1 rounded-full bg-brand-accent text-on-primary text-[12px] font-bold font-[family-name:var(--font-geist-mono)] tracking-wide">
              Day {dayNumber}
            </span>
          )}
          {dayNumber === null && <span className="w-14" />}
        </div>
      </header>

      {/* ── Two-Pane Layout (desktop) / Single column (mobile) ── */}
      <div className="flex-1 max-w-lg lg:max-w-6xl mx-auto w-full px-4 pt-5 pb-28 lg:pb-6 lg:grid lg:grid-cols-[1fr_380px] lg:gap-6">

        {/* ── Left Pane: Room Data ────────────────────────────── */}
        <div className="space-y-4">
          {/* ── Room Selector ─────────────────────────────────── */}
          {hasRooms && currentRoom ? (
            <section className="text-center" aria-label="Room selector">
              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={prevRoom}
                  disabled={roomIndex === 0}
                  aria-label="Previous room"
                  className="w-12 h-12 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface active:bg-surface-container disabled:opacity-20 transition-colors cursor-pointer"
                >
                  <ChevronLeft size={28} />
                </button>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-on-surface truncate">
                    {currentRoom.room_name}
                  </h2>
                  <p className="text-[13px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant mt-0.5">
                    {currentRoom.length_ft && currentRoom.width_ft
                      ? `${currentRoom.length_ft} x ${currentRoom.width_ft} ft`
                      : ""}
                    {currentRoom.square_footage
                      ? ` · ${Math.round(currentRoom.square_footage)} SF`
                      : ""}
                  </p>
                  {/* Category + Class pills */}
                  <div className="flex items-center justify-center gap-2 mt-2">
                    {currentRoom.water_category && (
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold font-[family-name:var(--font-geist-mono)] uppercase tracking-wider ${categoryColor(currentRoom.water_category)}`}
                      >
                        Cat {currentRoom.water_category}
                      </span>
                    )}
                    {currentRoom.water_class && (
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold font-[family-name:var(--font-geist-mono)] uppercase tracking-wider ${classColor(currentRoom.water_class)}`}
                      >
                        Class {currentRoom.water_class}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={nextRoom}
                  disabled={roomIndex >= roomCount - 1}
                  aria-label="Next room"
                  className="w-12 h-12 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface active:bg-surface-container disabled:opacity-20 transition-colors cursor-pointer"
                >
                  <ChevronRight size={28} />
                </button>
              </div>
              {/* Room indicator dots */}
              {roomCount > 1 && (
                <div className="flex items-center justify-center gap-1.5 mt-3">
                  {rooms?.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setRoomIndex(i)}
                      aria-label={`Go to room ${i + 1}`}
                      className={`w-2 h-2 rounded-full transition-all cursor-pointer ${
                        i === roomIndex
                          ? "bg-brand-accent w-5"
                          : "bg-outline-variant/40 hover:bg-outline-variant"
                      }`}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section className="text-center py-8">
              <p className="text-on-surface-variant text-[14px]">
                No rooms added yet
              </p>
              <button
                type="button"
                onClick={() => console.log("Add room")}
                className="mt-3 px-5 py-2.5 rounded-lg primary-gradient text-on-primary text-[13px] font-semibold cursor-pointer"
              >
                + Add First Room
              </button>
            </section>
          )}

          {/* ── GPP Drying Status ─────────────────────────────── */}
          {hasRooms && currentRoom && (
            <section
              className="bg-surface-container-lowest rounded-2xl p-4"
              aria-label="GPP drying status"
            >
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant">
                  GPP Status
                </span>
                {latestReading && (
                  <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                    Day {latestReading.day_number ?? "?"}
                  </span>
                )}
              </div>

              {/* GPP values */}
              <div className="flex items-end justify-between mb-2">
                <span className="text-3xl font-[family-name:var(--font-geist-mono)] font-bold text-on-surface tabular-nums">
                  {currentGpp !== null ? currentGpp.toFixed(0) : "--"}
                </span>
                <span className="text-lg font-[family-name:var(--font-geist-mono)] text-on-surface-variant tabular-nums">
                  <span className="text-[13px] mr-0.5">&rarr;</span> {targetGpp}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-3 rounded-full bg-surface-container overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${Math.max(4, gppProgress * 100)}%`,
                    background:
                      gppProgress > 0.8
                        ? "linear-gradient(90deg, #e85d26 0%, #16a34a 100%)"
                        : gppProgress > 0.5
                          ? "linear-gradient(90deg, #e85d26 0%, #eab308 100%)"
                          : "#e85d26",
                  }}
                />
              </div>

              {/* Trend text */}
              {gppTrend && (
                <p
                  className={`mt-2 text-[12px] font-[family-name:var(--font-geist-mono)] ${
                    gppTrend === "dropping"
                      ? "text-emerald-600"
                      : gppTrend === "rising"
                        ? "text-brand-accent"
                        : "text-on-surface-variant"
                  }`}
                >
                  {gppTrend === "dropping" && (
                    <>
                      &darr; Dropping &middot; ~
                      {Math.max(
                        1,
                        Math.ceil(
                          ((currentGpp ?? 0) - targetGpp) /
                            ((previousGpp ?? 0) - (currentGpp ?? 0) || 1)
                        )
                      )}{" "}
                      more days estimated
                    </>
                  )}
                  {gppTrend === "rising" && (
                    <>
                      &uarr; Rising &mdash; check equipment placement
                    </>
                  )}
                  {gppTrend === "stable" && <>&#8596; Holding steady</>}
                </p>
              )}
            </section>
          )}

          {/* ── Equipment Row ─────────────────────────────────── */}
          {hasRooms && currentRoom && (
            <section
              className="bg-surface-container-lowest rounded-2xl p-4"
              aria-label="Equipment"
            >
              <div className="flex items-stretch">
                <EquipmentCounter
                  icon={<FanIcon />}
                  label="Air Movers"
                  count={airMovers}
                  onDecrement={() =>
                    setAirMoverDelta((prev) => ({
                      ...prev,
                      [roomId]: (prev[roomId] ?? 0) - 1,
                    }))
                  }
                  onIncrement={() =>
                    setAirMoverDelta((prev) => ({
                      ...prev,
                      [roomId]: (prev[roomId] ?? 0) + 1,
                    }))
                  }
                />
                <div className="w-px bg-outline-variant/20 mx-2" />
                <EquipmentCounter
                  icon={<DehuIcon />}
                  label="Dehus"
                  count={dehus}
                  onDecrement={() =>
                    setDehuDelta((prev) => ({
                      ...prev,
                      [roomId]: (prev[roomId] ?? 0) - 1,
                    }))
                  }
                  onIncrement={() =>
                    setDehuDelta((prev) => ({
                      ...prev,
                      [roomId]: (prev[roomId] ?? 0) + 1,
                    }))
                  }
                />
              </div>
            </section>
          )}

          {/* ── Today's Moisture Points ─────────────────────── */}
          {hasRooms && currentRoom && latestReading && (
            <section
              className="bg-surface-container-lowest rounded-2xl p-4"
              aria-label="Moisture readings"
            >
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-[14px] font-semibold text-on-surface">
                  Today&apos;s Readings
                </h3>
                <span className="text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                  Day {latestReading.day_number ?? "?"} &middot;{" "}
                  {formatDateShort(latestReading.reading_date)}
                </span>
              </div>
              <ul className="space-y-2">
                {latestReading.points.map((point) => {
                  const overDry =
                    currentRoom.dry_standard !== null &&
                    point.reading_value > currentRoom.dry_standard;
                  return (
                    <li
                      key={point.id}
                      className="flex items-center justify-between py-2 border-b border-outline-variant/10 last:border-b-0"
                    >
                      <span className="text-[13px] text-on-surface">
                        {point.location_name}
                      </span>
                      <span
                        className={`text-[16px] font-[family-name:var(--font-geist-mono)] font-bold tabular-nums ${
                          overDry ? "text-brand-accent" : "text-on-surface"
                        }`}
                      >
                        {overDry && (
                          <span className="mr-1" aria-label="Above dry standard">
                            &#9888;
                          </span>
                        )}
                        {point.reading_value}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {currentRoom.dry_standard !== null && (
                <p className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant mt-2">
                  Dry standard: {currentRoom.dry_standard}
                </p>
              )}
              <button
                type="button"
                onClick={() => console.log("Add moisture point")}
                className="mt-3 text-[13px] font-semibold text-brand-accent hover:underline cursor-pointer"
              >
                + Add Point
              </button>
            </section>
          )}

          {/* ── Room Photos ─────────────────────────────────── */}
          {hasRooms && currentRoom && (
            <section
              className="bg-surface-container-lowest rounded-2xl p-4"
              aria-label="Room photos"
            >
              <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
                {(roomPhotos.length > 0
                  ? roomPhotos.slice(0, 4)
                  : Array.from({ length: 4 }, () => null)
                ).map((photo, i) => (
                  <div
                    key={photo?.id ?? i}
                    className="w-16 h-16 rounded-lg bg-surface-container-high shrink-0 overflow-hidden"
                  >
                    <div className="w-full h-full flex items-center justify-center text-outline/40">
                      <CameraIcon size={16} />
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => console.log("View all photos")}
                className="mt-2 text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant hover:text-brand-accent transition-colors cursor-pointer"
              >
                {totalPhotos > 0
                  ? `${totalPhotos} photos · See all \u2192`
                  : "No photos yet · Add photos \u2192"}
              </button>
            </section>
          )}
        </div>

        {/* ── Right Pane: Desktop Sidebar ─────────────────────── */}
        <div className="hidden lg:block">
          <div className="sticky top-20 space-y-4">
            {/* Quick Actions */}
            <section className="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_1px_3px_rgba(31,27,23,0.04)]">
              <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
                Quick Actions
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => console.log("Take photo")}
                  className="flex flex-col items-center justify-center h-20 rounded-xl text-on-surface-variant hover:bg-surface-container active:bg-surface-container-high transition-colors cursor-pointer border border-outline-variant/30"
                >
                  <CameraIcon size={22} />
                  <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1.5 uppercase tracking-[0.04em]">
                    Photo
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => console.log("New reading")}
                  className="flex flex-col items-center justify-center h-20 rounded-xl text-brand-accent bg-brand-accent/8 hover:bg-brand-accent/12 transition-colors cursor-pointer border border-brand-accent/20"
                >
                  <ChartIcon size={22} />
                  <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-bold mt-1.5 uppercase tracking-[0.04em]">
                    Reading
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => console.log("Voice note")}
                  className="flex flex-col items-center justify-center h-20 rounded-xl text-on-surface-variant hover:bg-surface-container active:bg-surface-container-high transition-colors cursor-pointer border border-outline-variant/30"
                >
                  <MicIcon size={22} />
                  <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1.5 uppercase tracking-[0.04em]">
                    Voice
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => console.log("View photos")}
                  className="flex flex-col items-center justify-center h-20 rounded-xl text-on-surface-variant hover:bg-surface-container active:bg-surface-container-high transition-colors cursor-pointer border border-outline-variant/30"
                >
                  <CameraIcon size={22} />
                  <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1.5 uppercase tracking-[0.04em]">
                    Photos
                  </span>
                </button>
              </div>
            </section>

            {/* Room Summary */}
            {hasRooms && rooms && (
              <section className="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_1px_3px_rgba(31,27,23,0.04)]">
                <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
                  Room Summary
                </h3>
                <ul className="space-y-2">
                  {rooms.map((room, i) => (
                    <li key={room.id}>
                      <button
                        type="button"
                        onClick={() => setRoomIndex(i)}
                        className={`w-full flex items-center justify-between py-2 px-3 rounded-lg text-left transition-colors cursor-pointer ${
                          i === roomIndex
                            ? "bg-brand-accent/8 text-brand-accent"
                            : "hover:bg-surface-container text-on-surface"
                        }`}
                      >
                        <span className="text-[13px] font-medium truncate">
                          {room.room_name}
                        </span>
                        <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant shrink-0 ml-2">
                          {room.reading_count > 0
                            ? `${room.reading_count} readings`
                            : "No data"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Job Info Compact */}
            <section className="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_1px_3px_rgba(31,27,23,0.04)]">
              <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant mb-3">
                Job Info
              </h3>
              <div className="space-y-2 text-[13px]">
                {job.customer_name && (
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant">Customer</span>
                    <span className="font-medium text-on-surface">{job.customer_name}</span>
                  </div>
                )}
                {job.carrier && (
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant">Carrier</span>
                    <span className="font-medium text-on-surface">{job.carrier}</span>
                  </div>
                )}
                {job.claim_number && (
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant">Claim #</span>
                    <span className="font-[family-name:var(--font-geist-mono)] text-on-surface">{job.claim_number}</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* ── Bottom Action Bar (mobile only) ────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="max-w-lg mx-auto px-4 pb-[68px] md:pb-4">
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_-2px_20px_rgba(31,27,23,0.08),0_-1px_4px_rgba(31,27,23,0.04)] p-2 flex items-stretch gap-1">
            <button
              type="button"
              onClick={() => console.log("Take photo")}
              className="flex-1 flex flex-col items-center justify-center min-h-[56px] rounded-xl text-on-surface-variant hover:bg-surface-container active:bg-surface-container-high transition-colors cursor-pointer"
            >
              <CameraIcon size={22} />
              <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-semibold mt-1 uppercase tracking-[0.04em]">
                Photo
              </span>
            </button>
            <button
              type="button"
              onClick={() => console.log("New reading")}
              className="flex-1 flex flex-col items-center justify-center min-h-[56px] rounded-xl text-brand-accent bg-brand-accent/8 hover:bg-brand-accent/12 active:bg-brand-accent/16 transition-colors cursor-pointer"
            >
              <ChartIcon size={22} />
              <span className="text-[11px] font-[family-name:var(--font-geist-mono)] font-bold mt-1 uppercase tracking-[0.04em]">
                Reading
              </span>
            </button>
            <button
              type="button"
              onClick={() => console.log("Voice note")}
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
