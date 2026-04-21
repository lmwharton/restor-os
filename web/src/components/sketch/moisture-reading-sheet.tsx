"use client";

// Reading sheet for an existing moisture pin. Opens when the tech taps a
// pin with the Pin tool while in Moisture Mode (Spec 01H Phase 2, Blocks
// 3A + 3B).
//
// Shows pin metadata + a single input for today's reading. If today's
// reading already exists, the input is prefilled and a small banner
// flags it — saving a changed value triggers a confirm modal before
// overwriting.
//
// Below the input, a History section renders a compact SVG sparkline and
// a chronological list of prior readings (newest first). A green pill
// above the input flags when the pin has reached dry standard, and an
// amber banner flags a day-over-day regression.
//
// Mobile: bottom sheet (drag-to-dismiss).
// Desktop: centered modal. Same contents either way.

import { useMemo, useRef, useState } from "react";
import { ConfirmModal } from "@/components/confirm-modal";
import {
  computePinColor,
  useCreatePinReading,
  usePinReadings,
  useUpdatePinReading,
} from "@/lib/hooks/use-moisture-pins";
import type {
  MoisturePin,
  MoisturePinReading,
  MoistureMaterial,
  PinColor,
} from "@/lib/types";

// Human-facing names for each material. Kept local (not shared with
// placement sheet) so the two sheets can evolve independently without
// one accidentally dropping a label the other relies on.
const MATERIAL_LABELS: Record<MoistureMaterial, string> = {
  drywall: "Drywall",
  wood_subfloor: "Wood subfloor",
  carpet_pad: "Carpet pad",
  concrete: "Concrete",
  hardwood: "Hardwood",
  osb_plywood: "OSB / plywood",
  block_wall: "Block wall",
};

// Tailwind bg classes for the pin color dot. Mirrors the canvas layer's
// palette so the sheet's dot matches the on-canvas pin color exactly.
const COLOR_BG: Record<PinColor, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

// Same palette as the Konva pin layer so the sparkline dots visually
// match what the tech sees on canvas. Kept as hex because SVG fills
// can't consume Tailwind classes.
const COLOR_HEX: Record<PinColor, string> = {
  green: "#16a34a",
  amber: "#f59e0b",
  red: "#dc2626",
};

// Format an ISO date (YYYY-MM-DD) for the history list. Uses the local
// TZ so "Apr 20" reads as the tech's day. Built from a parsed Date to
// avoid `new Date("2026-04-20")` quirks (which gets interpreted as UTC
// midnight and can appear as the previous day in negative offsets).
function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Days between two ISO dates (YYYY-MM-DD), floored. Positive when `b`
// is later than `a`. Used to place the dry-date pill as "Day N" where
// N = days between first reading and first dry-standard-met reading,
// +1 (so the first reading is "Day 1", not "Day 0").
function daysBetween(aIso: string, bIso: string): number {
  const [ay, am, ad] = aIso.split("-").map(Number);
  const [by, bm, bd] = bIso.split("-").map(Number);
  const a = new Date(ay, am - 1, ad).getTime();
  const b = new Date(by, bm - 1, bd).getTime();
  return Math.floor((b - a) / 86400000);
}

interface MoistureReadingSheetProps {
  open: boolean;
  jobId: string;
  pin: MoisturePin;
  onClose: () => void;
}

// Today in the same ISO format the placement sheet uses on create. Kept
// as UTC to stay consistent with that code path; any TZ fix belongs in
// a shared helper, not in this file alone.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Inline SVG sparkline. No chart library — readings cap out at ~30
// points for a typical drying job, well under the threshold where
// paying the bundle cost of a lib would be worth it.
//
// The y-axis auto-scales to include both the reading values and the
// dry-standard line so the dashed threshold always reads as "where we
// need to get to" relative to actual values. x-axis spreads readings
// evenly by index so gapped dates don't produce distorted spacing —
// date labels live in the history list, not the chart.
function Sparkline({
  readingsAsc,
  dryStandard,
}: {
  readingsAsc: MoisturePinReading[];
  dryStandard: number;
}) {
  const width = 256;
  const height = 56;
  const padX = 8;
  const padY = 6;

  if (readingsAsc.length === 0) return null;

  const values = readingsAsc.map((r) => Number(r.reading_value));
  // Include dryStandard in the range so the dashed line is always visible.
  const yMin = Math.min(...values, dryStandard) - 2;
  const yMax = Math.max(...values, dryStandard) + 2;
  const ySpan = Math.max(yMax - yMin, 1);

  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const xFor = (i: number) => {
    if (readingsAsc.length === 1) return padX + innerW / 2;
    return padX + (i / (readingsAsc.length - 1)) * innerW;
  };
  const yFor = (v: number) => padY + innerH - ((v - yMin) / ySpan) * innerH;

  const dryY = yFor(dryStandard);
  const linePoints = readingsAsc
    .map((r, i) => `${xFor(i)},${yFor(Number(r.reading_value))}`)
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-[56px]"
      role="img"
      aria-label={`Sparkline with ${readingsAsc.length} readings, dry standard ${dryStandard}%`}
    >
      {/* Dashed dry-standard line */}
      <line
        x1={padX}
        y1={dryY}
        x2={width - padX}
        y2={dryY}
        stroke="#16a34a"
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.55}
      />
      {/* Line through readings — only drawn when we have ≥ 2 points. */}
      {readingsAsc.length >= 2 && (
        <polyline
          points={linePoints}
          fill="none"
          stroke="#64748b"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {/* Per-reading dot, colored by its own pin-color computation. */}
      {readingsAsc.map((r, i) => {
        const color = computePinColor(Number(r.reading_value), dryStandard);
        return (
          <circle
            key={r.id}
            cx={xFor(i)}
            cy={yFor(Number(r.reading_value))}
            r={3}
            fill={COLOR_HEX[color]}
            stroke="#ffffff"
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
}

export function MoistureReadingSheet({
  open,
  jobId,
  pin,
  onClose,
}: MoistureReadingSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDragging = useRef(false);

  const today = todayIso();
  const readingsQuery = usePinReadings(jobId, pin.id);
  const createReading = useCreatePinReading(jobId, pin.id);
  const updateReading = useUpdatePinReading(jobId, pin.id);

  // Coerce reading_value to Number once up front. The MoisturePinReading
  // TS type says `number`, but at runtime the backend serializes the DB
  // NUMERIC column as a string ("7.00"). Naked >/< on strings silently
  // does lexicographic compare — "7.00" > "19.00" returns true because
  // '7' > '1' — which broke the regression check and ↑ chevron. One
  // coercion here keeps every downstream comparison honest.
  const normalizedReadings = useMemo(() => {
    const raw = readingsQuery.data ?? [];
    return raw.map((r) => ({ ...r, reading_value: Number(r.reading_value) }));
  }, [readingsQuery.data]);

  // Today's reading, if already logged. Drives prefill + overwrite flow.
  const todayReading = useMemo(() => {
    return normalizedReadings.find((r) => r.reading_date === today) ?? null;
  }, [normalizedReadings, today]);

  // Derived history state — all 3B features share one pass over readings.
  //
  //   readingsAsc:  oldest → newest. Drives sparkline and day-over-day
  //                 regression computation (each row compares to prior).
  //   readingsDesc: newest → oldest. Drives the history list UI.
  //   regressingIds: set of reading ids whose value > the previous day's.
  //                  Rendered as an amber ↑ chevron on that history row.
  //   latest / previous: most recent and second-most-recent — used by
  //                      the latest-regression banner.
  //   dryDay:       Day N (1-indexed from first reading) when the pin
  //                 first hit dry standard. null while still wet.
  const history = useMemo(() => {
    const asc = [...normalizedReadings].sort((a, b) =>
      a.reading_date.localeCompare(b.reading_date),
    );
    const desc = [...asc].reverse();
    const regressingIds = new Set<string>();
    for (let i = 1; i < asc.length; i++) {
      if (asc[i].reading_value > asc[i - 1].reading_value) {
        regressingIds.add(asc[i].id);
      }
    }
    const latest = asc[asc.length - 1] ?? null;
    const previous = asc[asc.length - 2] ?? null;
    let dryDay: number | null = null;
    if (asc.length > 0) {
      const first = asc[0];
      const firstDry = asc.find((r) => r.reading_value <= pin.dry_standard);
      if (firstDry) {
        dryDay = daysBetween(first.reading_date, firstDry.reading_date) + 1;
      }
    }
    return { asc, desc, regressingIds, latest, previous, dryDay };
  }, [normalizedReadings, pin.dry_standard]);

  const latestRegressing =
    history.latest !== null &&
    history.previous !== null &&
    history.latest.reading_value > history.previous.reading_value;

  // String state so the user can type intermediate values ("4.", "") —
  // mirrors the placement sheet's approach.
  const [readingStr, setReadingStr] = useState("");
  // Track the pin we prefilled for so reopening the sheet on a
  // different pin re-seeds the input.
  const prefillKeyRef = useRef<string>("");

  const prefillKey = `${pin.id}:${todayReading?.id ?? ""}`;
  if (prefillKey !== prefillKeyRef.current) {
    prefillKeyRef.current = prefillKey;
    setReadingStr(todayReading ? String(todayReading.reading_value) : "");
  }

  const [confirmOpen, setConfirmOpen] = useState(false);

  const readNum = Number(readingStr);
  const readValid =
    Number.isFinite(readNum) && readNum >= 0 && readNum <= 100;
  const changedFromToday =
    todayReading === null || todayReading.reading_value !== readNum;
  const canSave = readValid && readingStr !== "" && changedFromToday;
  const saving = createReading.isPending || updateReading.isPending;

  // Drag-to-dismiss on mobile — identical mechanic to placement sheet.
  const handleTouchStart = (e: React.TouchEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.touches[0].clientY;
    if (y > rect.top + 24) return;
    startYRef.current = y;
    currentYRef.current = y;
    isDragging.current = true;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current || !panelRef.current) return;
    currentYRef.current = e.touches[0].clientY;
    const delta = Math.max(0, currentYRef.current - startYRef.current);
    panelRef.current.style.transform = `translateY(${delta}px)`;
    panelRef.current.style.transition = "none";
  };
  const handleTouchEnd = () => {
    if (!isDragging.current || !panelRef.current) return;
    isDragging.current = false;
    const delta = currentYRef.current - startYRef.current;
    if (delta > 60) {
      panelRef.current.style.transition = "transform 200ms ease-out";
      panelRef.current.style.transform = "translateY(100%)";
      setTimeout(onClose, 200);
    } else {
      panelRef.current.style.transition = "transform 200ms ease-out";
      panelRef.current.style.transform = "translateY(0)";
    }
  };

  if (!open) return null;

  const runSave = () => {
    if (!readValid) return;
    if (todayReading) {
      updateReading.mutate(
        { readingId: todayReading.id, reading_value: readNum },
        {
          onSuccess: () => onClose(),
          onError: (err) => {
            console.error("moisture reading update failed", err);
          },
        },
      );
    } else {
      createReading.mutate(
        { reading_value: readNum, reading_date: today },
        {
          onSuccess: () => onClose(),
          onError: (err) => {
            console.error("moisture reading create failed", err);
          },
        },
      );
    }
  };

  const handleSave = () => {
    if (!canSave || saving) return;
    // Overwrite flow: today already has a reading AND the user typed a
    // different value. Surface the confirm modal before replacing.
    if (todayReading) {
      setConfirmOpen(true);
      return;
    }
    runSave();
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    runSave();
  };

  const dotColor = pin.color ? COLOR_BG[pin.color] : "bg-outline-variant";
  const materialLabel = MATERIAL_LABELS[pin.material] ?? pin.material;

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div
        ref={panelRef}
        className="relative bg-surface-container-lowest rounded-t-2xl sm:rounded-xl shadow-[0_-4px_24px_rgba(31,27,23,0.1)] sm:shadow-[0_8px_24px_rgba(31,27,23,0.1)] w-full sm:w-[420px] max-h-[85dvh] sm:max-h-[80vh] overflow-hidden flex flex-col"
        style={{ animation: "slideUp 0.15s ease-out" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-1.5 sm:hidden shrink-0">
          <div className="w-8 h-0.5 rounded-full bg-outline-variant/40" />
        </div>

        <div className="px-4 pt-3 pb-2 sm:px-5 sm:pt-5 sm:pb-3 flex-1 min-h-0 overflow-y-auto">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`w-2.5 h-2.5 rounded-full ${dotColor} shrink-0`}
                />
                <h3 className="text-[15px] sm:text-[16px] font-semibold text-on-surface truncate">
                  {pin.location_name}
                </h3>
              </div>
              <p className="mt-1.5 text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                {materialLabel}
                <span className="mx-1.5 opacity-50">·</span>
                <span>Dry std {pin.dry_standard}%</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 -mr-1 -mt-1 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low cursor-pointer shrink-0"
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Dry-standard-met pill — only when the pin has reached the
              dry threshold at some point. "Day N" counts from the first
              logged reading (Day 1). Positioned above the banners so the
              positive signal reads first when both are present. */}
          {history.dryDay !== null && (
            <div className="mb-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-800">
              <svg
                aria-hidden
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M5 12l5 5 9-10"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="font-[family-name:var(--font-geist-mono)] font-semibold">
                Dry on Day {history.dryDay}
              </span>
            </div>
          )}

          {/* Day-over-day regression banner — flagged when the latest
              reading is higher than the previous day. Distinct from the
              "already logged today" banner below (which is about
              overwriting today's value, not a drying trend). */}
          {latestRegressing && history.latest && history.previous && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800 flex items-start gap-2">
              <svg
                aria-hidden
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                className="mt-0.5 shrink-0"
              >
                <path
                  d="M7 14l5-5 5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>
                Reading increased to{" "}
                <span className="font-[family-name:var(--font-geist-mono)] font-semibold">
                  {history.latest.reading_value}%
                </span>{" "}
                (was {history.previous.reading_value}%).
              </span>
            </div>
          )}

          {/* "Already logged today" banner — only when today's row exists. */}
          {todayReading && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800 flex items-start gap-2">
              <svg
                aria-hidden
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                className="mt-0.5 shrink-0"
              >
                <path
                  d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>
                Already logged today at{" "}
                <span className="font-[family-name:var(--font-geist-mono)] font-semibold">
                  {todayReading.reading_value}%
                </span>
                . Saving will overwrite.
              </span>
            </div>
          )}

          {/* Today's reading input */}
          <div className="mb-4">
            <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1.5">
              Today&rsquo;s reading
            </p>
            <div className="relative">
              <input
                type="number"
                inputMode="decimal"
                value={readingStr}
                onChange={(e) => setReadingStr(e.target.value)}
                onFocus={(e) => e.target.select()}
                min={0}
                max={100}
                step={0.5}
                placeholder="Meter value"
                autoFocus={!todayReading}
                className={`w-full h-10 px-3 pr-8 rounded-lg border-2 text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] font-semibold outline-none focus:border-brand-accent ${
                  !readValid && readingStr !== ""
                    ? "border-red-400"
                    : "border-brand-accent/40"
                }`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                %
              </span>
            </div>
          </div>

          {/* History — sparkline + chronological list. Hidden entirely
              while the pin has no readings, and while the initial query
              is still loading (so we don't render a "No readings yet"
              flash before the data arrives). */}
          {readingsQuery.data !== undefined && history.asc.length > 0 && (
            <div className="mb-1">
              <div className="flex items-baseline justify-between mb-1.5">
                <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant">
                  History
                </p>
                <p className="text-[10px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant/80">
                  {history.asc.length}{" "}
                  {history.asc.length === 1 ? "reading" : "readings"}
                </p>
              </div>

              {/* Sparkline — only meaningful with 2+ points, but the
                  component also handles the single-point case as a
                  centered dot so the UI doesn't jump on the first log. */}
              <div className="rounded-lg bg-surface-container-low px-2 py-1.5 mb-2">
                <Sparkline
                  readingsAsc={history.asc}
                  dryStandard={pin.dry_standard}
                />
              </div>

              {/* Reading list — newest first. Each row: colored dot,
                  mono value, short date, optional ↑ chevron for rows
                  whose value increased vs the previous day. Read-only
                  in 3B; delete-reading UI is a separate follow-up. */}
              <ul className="divide-y divide-outline-variant/20">
                {history.desc.map((r) => {
                  const color = computePinColor(
                    Number(r.reading_value),
                    pin.dry_standard,
                  );
                  const regressed = history.regressingIds.has(r.id);
                  const isToday = r.reading_date === today;
                  return (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 py-2"
                    >
                      <span
                        aria-hidden
                        className={`w-2 h-2 rounded-full ${COLOR_BG[color]} shrink-0`}
                      />
                      <span className="text-[13px] font-[family-name:var(--font-geist-mono)] font-semibold text-on-surface w-12 tabular-nums">
                        {Number(r.reading_value)}%
                      </span>
                      {regressed && (
                        <span
                          title="Increased vs previous day"
                          className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 font-semibold font-[family-name:var(--font-geist-mono)]"
                        >
                          <svg
                            aria-hidden
                            width={10}
                            height={10}
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M12 19V5M5 12l7-7 7 7"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          up
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                        {isToday ? "Today" : formatShortDate(r.reading_date)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Sticky footer — Cancel + Save */}
        <div className="shrink-0 px-4 pt-3 pb-4 sm:px-5 sm:pt-3 sm:pb-4 border-t border-outline-variant/30 bg-surface-container-lowest">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 rounded-lg bg-surface-container-low text-[13px] font-medium text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="flex-1 h-10 rounded-lg bg-brand-accent text-on-primary text-[13px] font-semibold cursor-pointer disabled:opacity-40 active:scale-[0.98] transition-all"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Overwrite today's reading?"
        description={
          todayReading
            ? `This will replace today's ${todayReading.reading_value}% with ${readNum}%.`
            : undefined
        }
        confirmLabel="Overwrite"
        cancelLabel="Keep"
        variant="default"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />

      <style jsx>{`
        @keyframes slideUp {
          from {
            transform: translateY(16px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
