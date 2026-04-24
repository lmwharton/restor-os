"use client";

// Moisture Report View — the shared presentation component per Brett
// §8.6. Mounted by two wrappers:
//   1. /jobs/[id]/moisture-report (Task 6) — protected, tech-facing,
//      has a Print / Save PDF button in the wrapper.
//   2. /shared/[token]/moisture (Task 7) — public adjuster portal,
//      no print chrome.
//
// This file owns the layout, header stats, date-picker wiring, canvas
// embed, and summary table. It takes normalized props — it doesn't
// care whether the data came from a protected API or a public share
// link. That's the point of the shared-view architecture from the
// §"Moisture Report View" section of the spec.

import { useMemo } from "react";

import type { FloorPlanData } from "@/components/sketch/floor-plan-tools";
import type { MoisturePin, MoisturePinReading } from "@/lib/types";
import { formatShortDateLocal, localDateFromTimestamp } from "@/lib/dates";
import { deriveReadingHistory } from "@/lib/moisture-reading-history";

import { MoistureReportCanvas } from "./moisture-report-canvas";
import { MoistureReportSummaryTable } from "./moisture-report-summary-table";

/** Canonical per-spec floor labels (matches floor-selector.tsx).
 *  Used as the display name when a floor_plans row has no
 *  `floor_name` set — the tech saw "Basement / Main / Upper / Attic"
 *  in the floor-plan toolbar, so the report uses the same. Future
 *  floor numbers fall back to "Floor N". */
const CANONICAL_FLOOR_NAMES: Record<number, string> = {
  0: "Basement",
  1: "Main",
  2: "Upper",
  3: "Attic",
};

function formatFloorName(floorNumber: number, floorName: string): string {
  // Canonical name wins when the floor_number is one of the four
  // standard slots (0–3). A stored floor_name like "Floor 1" is
  // treated as a default placeholder — the tech told us they want
  // "Basement / Main / Upper / Attic" consistently. Only respect a
  // custom floor_name for floor_numbers outside the standard range
  // (future: 4+ for roof spaces, crawl, etc.).
  const canonical = CANONICAL_FLOOR_NAMES[floorNumber];
  if (canonical) return canonical;
  if (floorName && floorName.trim()) return floorName;
  return `Floor ${floorNumber}`;
}

export interface MoistureReportFloor {
  floorPlanId: string;
  floorName: string;
  floorNumber: number;
  canvas: FloorPlanData;
  /** Pins whose room lives on this floor. Sourced by the wrapper via
   *  `job_rooms.floor_plan_id`. */
  pins: ReadonlyArray<MoisturePin>;
}

export interface MoistureReportViewProps {
  /** Minimal job data the header needs. */
  job: {
    job_number?: string | null;
    customer_name?: string | null;
    address?: string | null;
  };
  /** Company info for the header logo + name. */
  company?: {
    name: string;
    logo_url?: string | null;
  };
  /** One entry per floor that has pins. Empty array → empty-state
   *  render. Multi-floor jobs (basement / main / upper / attic) ship
   *  each floor as its own section with its own canvas snapshot;
   *  the summary table at the bottom aggregates across all floors. */
  floors: ReadonlyArray<MoistureReportFloor>;
  /** Reading history per pin, ascending by taken_at. Keyed by
   *  pin id so the summary table doesn't care which floor a pin
   *  lives on. */
  readingsByPinId: ReadonlyMap<string, ReadonlyArray<MoisturePinReading>>;
  /** YYYY-MM-DD. Must be one of the dates with a reading, or today. */
  selectedDate: string;
  /** Called when the user picks a different snapshot date. Wired by
   *  both wrappers to update the URL `?date=` query param. */
  onSelectedDateChange: (iso: string) => void;
  /** Floor plan id of the floor currently on display. When the job
   *  has multiple floors with pins, a dropdown in the header lets
   *  the tech switch; default is the first floor in `floors`. */
  selectedFloorId?: string;
  /** Called when the tech switches floors via the header picker. */
  onSelectedFloorChange?: (floorPlanId: string) => void;
  /** Optional — the generated-at timestamp shown in the header.
   *  Defaults to "now" formatted at render time. */
  generatedAt?: Date;
  /** Pins that couldn't be attributed to any current floor. Renders
   *  an "Uncategorized pins (N)" callout above the canvas so a stale
   *  data state surfaces honestly instead of being silently dropped
   *  or crammed onto the primary floor. Defaults to empty. */
  orphanPins?: ReadonlyArray<MoisturePin>;
  /** IANA timezone of the job (e.g. `"America/Denver"`), sourced from
   *  `jobs.timezone`. Review round-1 H2: anchors every local-day
   *  extraction (Day-N axis, snapshot-as-of comparisons, firstDryDate)
   *  to the job's clock so a carrier viewing the shared portal from a
   *  different TZ sees the same days as the tech on-site. Omit on
   *  tech-only surfaces where viewer and job share a clock. */
  jobTimezone?: string;
}

export function MoistureReportView({
  job,
  company,
  floors,
  readingsByPinId,
  selectedDate,
  onSelectedDateChange,
  selectedFloorId,
  onSelectedFloorChange,
  generatedAt,
  orphanPins = [],
  jobTimezone,
}: MoistureReportViewProps) {
  // Resolve which floor the canvas shows. If the caller didn't thread
  // `selectedFloorId` (single-floor jobs, or wrapper hasn't wired the
  // URL param yet), fall back to the first floor. If the id doesn't
  // match any floor in the list (stale URL state), fall back too.
  const selectedFloor = useMemo(() => {
    if (floors.length === 0) return null;
    if (selectedFloorId) {
      const hit = floors.find((f) => f.floorPlanId === selectedFloorId);
      if (hit) return hit;
    }
    return floors[0];
  }, [floors, selectedFloorId]);

  // Pins that existed on or before the selected snapshot date. Uses
  // each pin's earliest reading's local calendar day as a "born on"
  // proxy (every pin ships with an initial reading per the atomic
  // create RPC). Phase 3 Step 3: taken_at is TIMESTAMPTZ, so we
  // extract the local day before comparing against the snapshot date
  // (a YYYY-MM-DD string). Drives the canvas, reading log, AND rollup.
  const visiblePins = useMemo(() => {
    if (!selectedFloor) return [];
    return selectedFloor.pins.filter((pin) => {
      const readings = readingsByPinId.get(pin.id) ?? [];
      if (readings.length === 0) {
        // No readings yet — pin hasn't existed at any point. Hide
        // rather than render as a stale grey dot.
        return false;
      }
      return localDateFromTimestamp(readings[0].taken_at, jobTimezone) <= selectedDate;
    });
  }, [selectedFloor, readingsByPinId, selectedDate]);

  // Orphan pins filtered by the same snapshot-date rule as visiblePins.
  // The canvas can't render them (no floor to render onto) but the
  // reading log includes them so the data is preserved end-to-end —
  // the "Uncategorized pins (N)" callout above the canvas is the
  // pointer that tells the adjuster where they went.
  const visibleOrphanPins = useMemo(() => {
    return orphanPins.filter((pin) => {
      const readings = readingsByPinId.get(pin.id) ?? [];
      if (readings.length === 0) return false;
      return localDateFromTimestamp(readings[0].taken_at, jobTimezone) <= selectedDate;
    });
  }, [orphanPins, readingsByPinId, selectedDate]);

  // Date picker options come from the SELECTED FLOOR's pins only —
  // all dates, including ones before/after snapshot. Scoping per-floor
  // matches the "no floors should collide" rule governing the canvas
  // + reading log. The visible-on-snapshot filter does NOT narrow the
  // picker: users still need to scroll to a date where pins existed,
  // which requires those dates to appear as options.
  const allDates = useMemo(() => {
    if (!selectedFloor) return [];
    const set = new Set<string>();
    for (const pin of selectedFloor.pins) {
      const readings = readingsByPinId.get(pin.id);
      if (!readings) continue;
      for (const r of readings) {
        const localDay = localDateFromTimestamp(r.taken_at, jobTimezone);
        if (localDay) set.add(localDay);
      }
    }
    return [...set].sort();
  }, [selectedFloor, readingsByPinId]);

  // Rollup strip: count pins that existed on the snapshot date AND
  // had achieved dry standard by it. Total is the count of pins that
  // existed — so a pin added "today" doesn't inflate the denominator
  // on yesterday's snapshot.
  const rollup = useMemo(() => {
    let dry = 0;
    for (const pin of visiblePins) {
      const readings = readingsByPinId.get(pin.id) ?? [];
      const normalized = readings.map((r) => ({
        ...r,
        reading_value: Number(r.reading_value),
      }));
      const history = deriveReadingHistory(
        normalized,
        Number(pin.dry_standard),
        jobTimezone,
      );
      if (
        history.dryMilestone
        && history.dryMilestone.firstDryDate <= selectedDate
      ) {
        dry += 1;
      }
    }
    return { dry, total: visiblePins.length };
  }, [visiblePins, readingsByPinId, selectedDate]);

  const generatedLabel = (generatedAt ?? new Date()).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric", year: "numeric" },
  );

  return (
    <div className="bg-surface-container-lowest text-on-surface print:bg-white">
      {/* Header — company + job ID + address + snapshot date picker +
          summary rollup. Matches the Phase 1 /report look: serif for
          customer name, mono micro-caps for labels. */}
      <header className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-outline-variant/40 print:px-0 print:pt-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {company?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.logo_url}
                alt={company.name}
                className="h-8 w-auto"
              />
            )}
            <div>
              <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.12em] text-on-surface-variant">
                Moisture report
              </p>
              <h1 className="text-[20px] font-semibold text-on-surface leading-tight">
                {company?.name ?? "Drying log"}
              </h1>
            </div>
          </div>
          <dl className="mt-3 text-[11px] font-[family-name:var(--font-geist-mono)] grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {job.job_number && (
              <>
                <dt className="uppercase tracking-[0.08em] text-on-surface-variant">
                  Job
                </dt>
                <dd className="text-on-surface">{job.job_number}</dd>
              </>
            )}
            {job.customer_name && (
              <>
                <dt className="uppercase tracking-[0.08em] text-on-surface-variant">
                  Customer
                </dt>
                <dd className="text-on-surface">{job.customer_name}</dd>
              </>
            )}
            {job.address && (
              <>
                <dt className="uppercase tracking-[0.08em] text-on-surface-variant">
                  Property
                </dt>
                <dd className="text-on-surface">{job.address}</dd>
              </>
            )}
            <dt className="uppercase tracking-[0.08em] text-on-surface-variant">
              Generated
            </dt>
            <dd className="text-on-surface">{generatedLabel}</dd>
          </dl>
        </div>

        {/* Right-side: floor picker (multi-floor only) + date picker
            + rollup. On mobile, stacks vertically as full-width
            controls with the label ABOVE the select (labels beside
            looked staggered on narrow screens). On sm+, returns to
            the compact right-aligned inline layout. */}
        <div className="flex flex-col items-stretch sm:items-end gap-2 w-full sm:w-auto sm:shrink-0">
          {floors.length > 1 && onSelectedFloorChange ? (
            <label className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-[11px] font-[family-name:var(--font-geist-mono)]">
              <span className="uppercase tracking-[0.08em] text-on-surface-variant">
                Floor
              </span>
              <select
                value={selectedFloor?.floorPlanId ?? ""}
                onChange={(e) => onSelectedFloorChange(e.target.value)}
                className="w-full sm:w-auto h-9 sm:h-8 px-3 sm:px-2 pr-8 sm:pr-6 rounded-lg bg-surface-container-low text-[13px] sm:text-[11px] text-on-surface font-[family-name:var(--font-geist-mono)] outline-none focus:ring-2 focus:ring-brand-accent cursor-pointer print:appearance-none print:bg-transparent print:border print:border-outline-variant"
              >
                {floors.map((f) => (
                  <option key={f.floorPlanId} value={f.floorPlanId}>
                    {formatFloorName(f.floorNumber, f.floorName)} ·{" "}
                    {f.pins.length} pin{f.pins.length === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
          ) : floors.length === 1 && selectedFloor ? (
            // Single-floor: render the label as a static span rather
            // than a disabled-grey select. The greyed control reads
            // as "broken" to some users; a span reads as info.
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-[11px] font-[family-name:var(--font-geist-mono)]">
              <span className="uppercase tracking-[0.08em] text-on-surface-variant">
                Floor
              </span>
              <span className="text-[13px] sm:text-[11px] text-on-surface">
                {formatFloorName(
                  selectedFloor.floorNumber,
                  selectedFloor.floorName,
                )}{" "}
                · {selectedFloor.pins.length} pin
                {selectedFloor.pins.length === 1 ? "" : "s"}
              </span>
            </div>
          ) : null}
          <label className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-[11px] font-[family-name:var(--font-geist-mono)]">
            <span className="uppercase tracking-[0.08em] text-on-surface-variant">
              Snapshot
            </span>
            <select
              value={selectedDate}
              onChange={(e) => onSelectedDateChange(e.target.value)}
              // Disabled when there are no reading dates — the
              // select has nothing useful to pick from, and the
              // disabled style makes it obvious this is data-driven
              // (readings will populate the picker).
              disabled={allDates.length === 0}
              className="w-full sm:w-auto h-9 sm:h-8 px-3 sm:px-2 pr-8 sm:pr-6 rounded-lg bg-surface-container-low text-[13px] sm:text-[11px] text-on-surface font-[family-name:var(--font-geist-mono)] outline-none focus:ring-2 focus:ring-brand-accent cursor-pointer disabled:cursor-default disabled:opacity-70 print:appearance-none print:bg-transparent print:border print:border-outline-variant"
            >
              {allDates.length === 0 ? (
                <option value={selectedDate}>
                  {formatShortDateLocal(selectedDate)}
                </option>
              ) : (
                allDates.map((d, i) => (
                  <option key={d} value={d}>
                    D{i + 1} · {formatShortDateLocal(d)}
                  </option>
                ))
              )}
            </select>
          </label>
          <div className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
            <span className="font-semibold text-emerald-800">
              {rollup.dry}
            </span>
            {" of "}
            <span className="font-semibold text-on-surface">
              {rollup.total}
            </span>
            {" "}pins dry as of {formatShortDateLocal(selectedDate)}
          </div>
        </div>
      </header>

      {/* Empty-state short-circuit — one message, one surface. If
          there are no floors-with-pins, the canvas AND the reading
          log are both skipped. Previously the view's floor-empty
          branch AND the summary table's own "no pins" row both
          rendered, which showed the same message twice. */}
      {floors.length === 0 || !selectedFloor ? (
        <section className="px-6 py-8 text-center print:px-0">
          <p className="text-[13px] text-on-surface-variant">
            This job doesn&rsquo;t have any floor plans yet. Draw rooms
            on the floor plan first to start logging moisture readings.
          </p>
        </section>
      ) : (
        <>
          {/* Canvas for the selected floor. User switches floors via
              the header dropdown; pins are pre-filtered per floor by
              the wrapper using the server-provided floor_plan_id on
              each pin. An empty-pin floor still renders its canvas
              (shows the rooms, no overlay) so the tech sees the
              layout and can confirm no readings are expected here. */}
          {orphanPins.length > 0 && (
            // Surfaced honestly so the adjuster sees the gap. These
            // are pins from rooms whose floor_plan_id never got
            // backfilled (multi-floor property, unpinned job at
            // creation time). We don't guess which floor they belong
            // to — guessing would misrepresent the damage layout.
            <section className="mx-4 sm:mx-6 mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200/60 text-[11px] font-[family-name:var(--font-geist-mono)] text-amber-900 print:bg-transparent print:border-amber-400">
              <span className="font-semibold uppercase tracking-[0.06em]">
                Uncategorized pins ({orphanPins.length})
              </span>
              {" — "}
              <span>
                placement floor unknown. These readings are still in
                the reading log but don&rsquo;t appear on any canvas.
              </span>
            </section>
          )}
          <section className="px-4 sm:px-6 py-5 print:px-0 print:py-3 print:break-inside-avoid">
            <div className="flex justify-center">
              <MoistureReportCanvas
                canvas={selectedFloor.canvas}
                pins={visiblePins}
                readingsByPinId={readingsByPinId}
                snapshotDate={selectedDate}
                jobTimezone={jobTimezone}
              />
            </div>
            {selectedFloor.pins.length === 0 && (
              <p className="mt-3 text-center text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                No moisture pins on this floor.
              </p>
            )}
            {selectedFloor.pins.length > 0 && visiblePins.length === 0 && (
              <p className="mt-3 text-center text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                No pins existed on this floor as of{" "}
                {formatShortDateLocal(selectedDate)}. Pick a later
                snapshot to see drying progress.
              </p>
            )}
          </section>

          {/* Reading log — pins that existed on the snapshot date,
              for the active floor PLUS any orphan pins (uncategorized).
              Including orphans here keeps the carrier-facing data
              complete even when canvas attribution is broken upstream;
              the callout above flags the gap so the omission isn't
              silent. Switching the date reloads the log alongside the
              canvas so both surfaces agree. */}
          {(visiblePins.length > 0 || visibleOrphanPins.length > 0) && (
            <section className="px-4 sm:px-6 pb-6 print:px-0 print:pb-0">
              <h2 className="mb-2 text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.12em] text-on-surface-variant">
                Reading log ·{" "}
                {formatFloorName(
                  selectedFloor.floorNumber,
                  selectedFloor.floorName,
                )}
                {visibleOrphanPins.length > 0 && (
                  <span className="text-amber-700">
                    {" + "}
                    {visibleOrphanPins.length} uncategorized
                  </span>
                )}
              </h2>
              <MoistureReportSummaryTable
                pins={[...visiblePins, ...visibleOrphanPins]}
                readingsByPinId={readingsByPinId}
                jobTimezone={jobTimezone}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
