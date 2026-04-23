"use client";

// Reading sheet for an existing moisture pin. Opens when the tech taps a
// pin with the Pin tool while in Moisture Mode (Spec 01H Phase 2, Blocks
// 3A + 3B).
//
// Shows pin metadata + a single input for today's reading. If today's
// reading already exists, the input is prefilled and overwrites silently
// on save (the history list below makes the existing value visible).
//
// Below the input, a History section renders a clinical sparkline and
// a chronological list of prior readings (newest first). An amber banner
// flags a day-over-day regression.
//
// Each history row carries a trailing trash affordance — a single tap
// opens a ConfirmModal and the approved DELETE mutates the reading away.
// Mid-delete rows dim to 40% + stop listening so a frantic second tap
// can't stack a duplicate DELETE (mirrors the pin-delete pattern).
//
// Mobile: bottom sheet (drag-to-dismiss).
// Desktop: centered modal. Same contents either way.

import { useMemo, useRef, useState } from "react";
import {
  computePinColor,
  useCreatePinReading,
  useDeletePinReading,
  usePinReadings,
  useUpdatePinReading,
} from "@/lib/hooks/use-moisture-pins";
import type {
  MoisturePin,
  MoisturePinReading,
  MoistureMaterial,
  PinColor,
} from "@/lib/types";
import { ConfirmModal } from "@/components/confirm-modal";
import { formatShortDateLocal, todayLocalIso } from "@/lib/dates";
import {
  deriveReadingHistory,
  findTodayReading,
  isChangedFromToday,
  validateReadingInput,
} from "@/lib/moisture-reading-history";

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

interface MoistureReadingSheetProps {
  open: boolean;
  jobId: string;
  pin: MoisturePin;
  onClose: () => void;
  /** Optional — when set, the header shows an Edit affordance that
   *  calls this with the pin id so the parent can open the edit sheet
   *  (change material / dry_standard). */
  onEditRequest?: (pinId: string) => void;
  /** When true, the sheet renders as a read-only history view:
   *  the Edit chip, Save footer, and per-row trash buttons are all
   *  hidden. Used for archived jobs (status ∈ collected) so the tech
   *  can still audit historical drying data after a job has been
   *  handed to the carrier. Mirrors backend behavior — archived job
   *  reads pass, writes return 403 JOB_ARCHIVED. */
  readOnly?: boolean;
}


// Inline SVG sparkline. No chart library — readings cap out at ~30
// points for a typical drying job, well under the threshold where
// paying the bundle cost of a lib would be worth it.
//
// Layout is "clinical data chart" — restrained, precise, high-density
// information without noise. Three label tiers carry the scale the
// chart used to leave implicit:
//   • Day labels (D1…DN) under each dot — anchor the x-axis so dots
//     aren't floating abstractions.
//   • "X% dry" at the right end of the dashed threshold line —
//     anchors the y-scale without a full axis.
//   • Latest-reading value floating above its dot — the one focal
//     point, color-matched to the pin so "where am I now" reads first.
//
// Y auto-scales to include both readings and the dry-standard line so
// the dashed threshold always stays in frame. X spreads evenly by
// index (not date) — date gaps live in the history list below.
function Sparkline({
  readingsAsc,
  dryStandard,
}: {
  readingsAsc: MoisturePinReading[];
  dryStandard: number;
}) {
  const width = 320;
  const height = 104;
  const padLeft = 10;
  const padRight = 36; // room for the "X% dry" tick label
  const padTop = 22;   // room for the latest-value callout above
  const padBottom = 24; // room for D1/D2… labels below

  if (readingsAsc.length === 0) return null;

  const values = readingsAsc.map((r) => Number(r.reading_value));
  const yMin = Math.min(...values, dryStandard) - 2;
  const yMax = Math.max(...values, dryStandard) + 2;
  const ySpan = Math.max(yMax - yMin, 1);

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const xFor = (i: number) => {
    if (readingsAsc.length === 1) return padLeft + innerW / 2;
    return padLeft + (i / (readingsAsc.length - 1)) * innerW;
  };
  const yFor = (v: number) => padTop + innerH - ((v - yMin) / ySpan) * innerH;

  const dryY = yFor(dryStandard);
  const linePoints = readingsAsc
    .map((r, i) => `${xFor(i)},${yFor(Number(r.reading_value))}`)
    .join(" ");

  const latestIdx = readingsAsc.length - 1;
  const latest = readingsAsc[latestIdx];
  const latestValue = Number(latest.reading_value);
  const latestColor = computePinColor(latestValue, dryStandard);
  const latestX = xFor(latestIdx);
  const latestY = yFor(latestValue);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-[104px]"
      role="img"
      aria-label={`Sparkline showing ${readingsAsc.length} reading${readingsAsc.length === 1 ? "" : "s"}, latest ${latestValue}%, dry standard ${dryStandard}%`}
    >
      {/* Dashed dry-standard line */}
      <line
        x1={padLeft}
        y1={dryY}
        x2={padLeft + innerW}
        y2={dryY}
        stroke="#16a34a"
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.55}
      />
      {/* Dry-standard inline label at the right end of the dashed line */}
      <text
        x={padLeft + innerW + 4}
        y={dryY + 3}
        fontSize={9}
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
        fill="#15803d"
        opacity={0.85}
      >
        {dryStandard}%
      </text>

      {/* Connection line through readings — only drawn when we have ≥ 2 points. */}
      {readingsAsc.length >= 2 && (
        <polyline
          points={linePoints}
          fill="none"
          stroke="#64748b"
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.75}
        />
      )}

      {/* Per-reading dot. The latest reading gets a slightly larger
          radius + thicker white stroke so the focal "you are here"
          reads first without a color change. */}
      {readingsAsc.map((r, i) => {
        const color = computePinColor(Number(r.reading_value), dryStandard);
        const isLatest = i === latestIdx;
        return (
          <circle
            key={r.id}
            cx={xFor(i)}
            cy={yFor(Number(r.reading_value))}
            r={isLatest ? 4.5 : 3}
            fill={COLOR_HEX[color]}
            stroke="#ffffff"
            strokeWidth={isLatest ? 1.5 : 1}
          />
        );
      })}

      {/* Latest-value callout — mono, color-matched to the pin, floats
          above the latest dot. Text-anchor shifts to "end" when the dot
          is too close to the right edge to center the label cleanly. */}
      <text
        x={latestX}
        y={latestY - 9}
        fontSize={11}
        fontWeight={600}
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
        fill={COLOR_HEX[latestColor]}
        textAnchor={
          latestX > padLeft + innerW - 14
            ? "end"
            : latestX < padLeft + 14
              ? "start"
              : "middle"
        }
      >
        {latestValue}%
      </text>

      {/* Day labels — D1…DN — anchor the x-axis. Rendered for every
          point; typical drying jobs run ≤10 days so spacing stays
          comfortable. At very long horizons labels may bump visually
          but the chart's trend-at-a-glance purpose still holds. */}
      {readingsAsc.map((r, i) => (
        <text
          key={`day-${r.id}`}
          x={xFor(i)}
          y={height - 6}
          fontSize={9}
          fontFamily="var(--font-geist-mono), ui-monospace, monospace"
          fill="#64748b"
          opacity={0.75}
          textAnchor="middle"
          letterSpacing="0.04em"
        >
          D{i + 1}
        </text>
      ))}
    </svg>
  );
}

export function MoistureReadingSheet({
  open,
  jobId,
  pin,
  onClose,
  onEditRequest,
  readOnly = false,
}: MoistureReadingSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDragging = useRef(false);

  const today = todayLocalIso();
  const readingsQuery = usePinReadings(jobId, pin.id);
  const createReading = useCreatePinReading(jobId, pin.id);
  const updateReading = useUpdatePinReading(jobId, pin.id);
  const deleteReading = useDeletePinReading(jobId, pin.id);

  // Per-row delete state. `confirmDeleteId` drives the ConfirmModal; a
  // non-null value means the modal is open for that reading. `pendingIds`
  // tracks rows whose DELETE is mid-flight so the UI can dim them + stop
  // listening (prevents a frantic second tap from stacking a second 404
  // on the freshly-gone reading — same pattern as the pin-delete layer).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(
    () => new Set(),
  );

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
  // Pure derivation lives in `@/lib/moisture-reading-history` — this
  // component only wraps it in useMemo for stable references across
  // renders.
  const todayReading = useMemo(
    () => findTodayReading(normalizedReadings, today),
    [normalizedReadings, today],
  );

  // Derived history state — asc/desc, regressing ids, latest/previous.
  // Also lives in the shared history module so the adjuster portal
  // view (Task 7) and PDF export (Task 6) can reuse the exact same
  // algorithm without duplicating it.
  const history = useMemo(
    () => deriveReadingHistory(normalizedReadings, pin.dry_standard),
    [normalizedReadings, pin.dry_standard],
  );

  const latestRegressing =
    history.latest !== null &&
    history.previous !== null &&
    history.latest.reading_value > history.previous.reading_value;

  // String state so the user can type intermediate values ("4.", "") —
  // mirrors the placement sheet's approach.
  const [readingStr, setReadingStr] = useState("");
  // Prefill coordination for the "Today's reading" input. Two cases
  // both need to seed the field:
  //
  //   (a) Pin changed — user opened a different pin's sheet, wipe + reseed.
  //   (b) Cold open where data arrives AFTER mount — sheet opens,
  //       readingsQuery is still pending so todayReading is null at
  //       first render, input seeds to "". When the fetch settles
  //       with a today-reading present we MUST re-seed (the initial
  //       "empty" seed was wrong-until-data-arrived, not a user
  //       choice). Without this, techs saw an empty "Today's
  //       reading" input even though the pin already had a reading
  //       for today.
  //
  // The protection L3 added (background refetch can't stomp typed
  // input) is preserved via `userTypedRef` — once the tech has
  // touched the input, no further auto-seed fires for this pin.
  const prefillPinIdRef = useRef<string>("");
  const prefillReadingIdRef = useRef<string>("");
  const userTypedRef = useRef(false);

  // Pin change: full reset — including the user-typed lock, since
  // the new pin's typed-input wasn't typed for THIS pin.
  if (pin.id !== prefillPinIdRef.current) {
    userTypedRef.current = false;
  }

  const currentReadingId = todayReading?.id ?? "";
  const needsSeed =
    pin.id !== prefillPinIdRef.current
    || (currentReadingId !== prefillReadingIdRef.current
        && !userTypedRef.current);

  if (needsSeed) {
    prefillPinIdRef.current = pin.id;
    prefillReadingIdRef.current = currentReadingId;
    setReadingStr(todayReading ? String(todayReading.reading_value) : "");
  }

  const validation = validateReadingInput(readingStr);
  const readNum = validation.value ?? 0;
  const readValid = validation.valid;
  const changedFromToday = isChangedFromToday(validation.value, todayReading);
  const canSave = readValid && changedFromToday;
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
    // Readings endpoint is upsert-by-date, so overwriting today's value
    // is cheap — no ConfirmModal. The history list below the input shows
    // the existing "Today" row, and the regression banner (if the new
    // value goes up) makes the overwrite visible in context.
    runSave();
  };

  const confirmDeleteRow =
    confirmDeleteId !== null
      ? normalizedReadings.find((r) => r.id === confirmDeleteId) ?? null
      : null;

  const runDelete = (readingId: string) => {
    setPendingDeleteIds((prev) => {
      const next = new Set(prev);
      next.add(readingId);
      return next;
    });
    deleteReading.mutate(readingId, {
      onSettled: () => {
        // Drop from pending either way so a failed DELETE restores the
        // row to a tappable state (query invalidation on success already
        // removes the row from the list).
        setPendingDeleteIds((prev) => {
          const next = new Set(prev);
          next.delete(readingId);
          return next;
        });
      },
      onError: (err) => {
        console.error("moisture reading delete failed", err);
      },
    });
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
                <span>{materialLabel}</span>
                <span className="mx-1.5 opacity-50">·</span>
                <span>Dry std {pin.dry_standard}%</span>
              </p>
            </div>
            {/* Edit pill — sits in the top-right where the X close used
                to live. Cancel in the sticky footer + backdrop tap + drag-
                to-dismiss cover the close affordances, so the slot opens
                up for the primary action of this header: correcting the
                pin's material / dry_standard. */}
            {onEditRequest && !readOnly && (
              <button
                type="button"
                onClick={() => onEditRequest(pin.id)}
                aria-label="Edit pin settings"
                className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand-accent/10 text-brand-accent text-[12px] font-semibold hover:bg-brand-accent/15 active:scale-[0.98] transition-all cursor-pointer"
              >
                <svg
                  width={13}
                  height={13}
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Edit
              </button>
            )}
          </div>

          {/* Dry-standard-met milestone per Brett §8.5 — green
              checkmark chip with the date drying was achieved. Does
              NOT reset when the pin regresses after dry; compliance-
              relevant historical fact. Same datum feeds the Dry Date
              column in the moisture-report summary table. */}
          {history.dryMilestone && (
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
                Dry on Day {history.dryMilestone.firstDryDayNumber}
                {" · "}
                {formatShortDateLocal(history.dryMilestone.firstDryDate)}
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

          {/* Today's reading input — hidden in read-only mode (archived
              jobs). History list + sparkline below still render so the
              tech can audit what was logged. */}
          {!readOnly && (
            <div className="mb-4">
              <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1.5">
                Today&rsquo;s reading
              </p>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  value={readingStr}
                  onChange={(e) => {
                    // Mark that the tech has touched the input so a
                    // later background refetch doesn't overwrite
                    // their in-progress value (paired with the
                    // prefill logic above — see that comment block).
                    userTypedRef.current = true;
                    setReadingStr(e.target.value);
                  }}
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
          )}

          {/* History skeleton — occupies the same vertical space as the
              real history block so the sheet doesn't jump when the
              readings fetch settles. Only during initial load
              (`isPending`). If the pin has no readings at all, the
              skeleton unmounts cleanly and the sheet stays at its
              input-only height without flashing a "No readings yet"
              message we don't actually render. */}
          {readingsQuery.isPending && (
            <div
              className="mb-1"
              aria-busy="true"
              aria-label="Loading reading history"
            >
              <div className="flex items-baseline justify-between mb-1.5">
                <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant/60">
                  History
                </p>
              </div>
              <div className="rounded-lg bg-surface-container-low h-[116px] mb-2 animate-pulse" />
              <ul className="divide-y divide-outline-variant/20">
                {[0, 1].map((i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 py-2 animate-pulse"
                  >
                    <span
                      aria-hidden
                      className="w-2 h-2 rounded-full bg-outline-variant/40 shrink-0"
                    />
                    <span className="h-3 w-12 rounded bg-outline-variant/30" />
                    <span className="ml-auto h-3 w-12 rounded bg-outline-variant/30" />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* History — sparkline + chronological list. Hidden when the
              pin has no readings (new pin). The `isPending` branch
              above covers the first-load flash; this branch only
              renders once data has actually arrived. */}
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
                  whose value increased vs the previous day, trailing
                  trash affordance that opens a ConfirmModal. */}
              <ul className="divide-y divide-outline-variant/20">
                {history.desc.map((r) => {
                  const color = computePinColor(
                    Number(r.reading_value),
                    pin.dry_standard,
                  );
                  const regressed = history.regressingIds.has(r.id);
                  const isToday = r.reading_date === today;
                  const isDeleting = pendingDeleteIds.has(r.id);
                  // A pin must always have ≥ 1 reading — otherwise it
                  // renders on canvas as a grey "no reading yet" dot and
                  // the tech loses the pin's meaning without seeing it
                  // disappear. Block the trash on the last survivor and
                  // redirect them toward the pin-delete flow instead.
                  const isLastReading = history.asc.length === 1;
                  return (
                    <li
                      key={r.id}
                      className={`flex items-center gap-3 py-2 transition-opacity ${
                        isDeleting ? "opacity-40 pointer-events-none" : ""
                      }`}
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
                        {isToday ? "Today" : formatShortDateLocal(r.reading_date)}
                      </span>
                      {!readOnly && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(r.id)}
                        disabled={isDeleting || isLastReading}
                        aria-label={
                          isLastReading
                            ? "Last reading — delete the pin from the canvas to remove it"
                            : `Delete ${Number(r.reading_value)}% reading from ${
                                isToday
                                  ? "today"
                                  : formatShortDateLocal(r.reading_date)
                              }`
                        }
                        title={
                          isLastReading
                            ? "Last reading — delete the pin instead"
                            : undefined
                        }
                        className="shrink-0 w-7 h-7 -mr-1 flex items-center justify-center rounded-full text-on-surface-variant/40 [@media(hover:none)]:text-red-500/70 hover:text-red-600 hover:bg-red-100 active:text-red-600 active:bg-red-100 active:scale-[0.94] transition-all cursor-pointer disabled:cursor-default disabled:opacity-30 disabled:hover:text-on-surface-variant/40 disabled:hover:bg-transparent disabled:active:text-on-surface-variant/40 disabled:active:bg-transparent disabled:active:scale-100"
                      >
                        <svg
                          aria-hidden
                          width={14}
                          height={14}
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <path
                            d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Sticky footer — Cancel + Save in edit mode; single Close
            button in read-only mode (archived job). */}
        <div className="shrink-0 px-4 pt-3 pb-4 sm:px-5 sm:pt-3 sm:pb-4 border-t border-outline-variant/30 bg-surface-container-lowest">
          {readOnly ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full h-10 rounded-lg bg-surface-container-low text-[13px] font-medium text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
            >
              Close
            </button>
          ) : (
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
          )}
        </div>
      </div>

      {/* Per-reading delete confirmation. Body pulls the row's value +
          date fresh at render from `confirmDeleteRow` so the copy stays
          correct even if the underlying cache updates underneath us. */}
      <ConfirmModal
        open={confirmDeleteRow !== null}
        title="Delete reading?"
        description={
          confirmDeleteRow
            ? `The ${Number(confirmDeleteRow.reading_value)}% reading from ${
                confirmDeleteRow.reading_date === today
                  ? "today"
                  : formatShortDateLocal(confirmDeleteRow.reading_date)
              } will be removed. This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (confirmDeleteRow) runDelete(confirmDeleteRow.id);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
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
