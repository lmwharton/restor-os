"use client";

// Summary table per Brett §8.6 — one row per moisture pin, columns for
// each day's reading (D1..DN), plus a Dry Date column capturing the
// first-hit dry milestone. This is the carrier's primary audit
// artifact; the canvas above it is the visual anchor.
//
// Day-N numbering: Day 1 = date of the FIRST reading across all pins
// on this job (not per-pin). This keeps columns aligned so adjusters
// can scan across rows to compare drying progress. Pins placed later
// show blank cells for earlier days.

import type { MoisturePin, MoisturePinReading } from "@/lib/types";
import { formatShortDateLocal, localDateFromTimestamp } from "@/lib/dates";
import { deriveReadingHistory } from "@/lib/moisture-reading-history";

const COLOR_BG: Record<"red" | "amber" | "green", string> = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
};

export interface MoistureReportSummaryTableProps {
  pins: ReadonlyArray<MoisturePin>;
  readingsByPinId: ReadonlyMap<string, ReadonlyArray<MoisturePinReading>>;
  /** IANA timezone of the job (review round-1 H2). Anchors the Day-N
   *  axis + firstDryDate computation to the job's clock so adjusters
   *  in a different TZ see the same days as the on-site tech.
   *  Omit for tech-only contexts where browser-local is correct. */
  jobTimezone?: string;
}

/** Material label lookup — same catalog as the placement / edit sheets,
 *  duplicated here to keep this table module standalone. Out of band
 *  materials fall back to the raw code string. */
const MATERIAL_LABEL: Record<string, string> = {
  drywall: "Drywall",
  wood_subfloor: "Wood subfloor",
  carpet_pad: "Carpet pad",
  concrete: "Concrete",
  hardwood: "Hardwood",
  osb_plywood: "OSB / plywood",
  block_wall: "Block wall",
};

export function MoistureReportSummaryTable({
  pins,
  readingsByPinId,
  jobTimezone,
}: MoistureReportSummaryTableProps) {
  if (pins.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-on-surface-variant">
        No moisture pins on this job yet.
      </div>
    );
  }

  // Collect every distinct local calendar day a reading fell on across
  // all pins — that's the Day-N axis. Phase 3 Step 3 made taken_at a
  // TIMESTAMPTZ; bucket to local day so two sub-day readings on the
  // same pin collapse into one column. Sort ascending so Day 1 is the
  // earliest reading in the job, regardless of which pin took it.
  // Skip readings whose `taken_at` doesn't parse (stale cached data
  // after a field rename, empty strings from defensive helpers) — a
  // blank column header crashes formatShortDateLocal downstream.
  const allDatesSet = new Set<string>();
  for (const readings of readingsByPinId.values()) {
    for (const r of readings) {
      const localDay = localDateFromTimestamp(r.taken_at, jobTimezone);
      if (localDay) allDatesSet.add(localDay);
    }
  }
  const allDates = [...allDatesSet].sort();

  return (
    // Edge-bleed scroll container on mobile (-mx-4 + px-4) so the
    // horizontal scroll reaches the screen edge and is visually
    // obvious. On sm+ the container aligns with the rest of the
    // report. `min-w-[560px]` on the table keeps columns readable
    // and forces scroll rather than crushing them — critical for
    // 6-day jobs where we'd otherwise end up with illegible headers.
    // Print path removes min-width and overflow so the table fits
    // the page naturally.
    <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto print:overflow-visible print:mx-0 print:px-0">
      <table className="w-full min-w-[560px] sm:min-w-0 print:min-w-0 text-[11px] border-collapse font-[family-name:var(--font-geist-mono)]">
        <thead>
          <tr className="border-b-2 border-on-surface/60">
            <th className="text-left px-2 py-1.5 font-semibold text-on-surface uppercase tracking-[0.04em] whitespace-nowrap">
              Location
            </th>
            <th className="text-left px-2 py-1.5 font-semibold text-on-surface uppercase tracking-[0.04em] whitespace-nowrap">
              Material
            </th>
            <th className="text-right px-2 py-1.5 font-semibold text-on-surface uppercase tracking-[0.04em] whitespace-nowrap">
              Dry std
            </th>
            {allDates.map((d, i) => (
              <th
                key={d}
                className="text-right px-2 py-1.5 font-semibold text-on-surface whitespace-nowrap"
                title={formatShortDateLocal(d)}
              >
                <div className="uppercase tracking-[0.04em]">D{i + 1}</div>
                <div className="text-[9px] text-on-surface-variant font-normal">
                  {formatShortDateLocal(d)}
                </div>
              </th>
            ))}
            <th className="text-left px-2 py-1.5 font-semibold text-on-surface uppercase tracking-[0.04em] whitespace-nowrap">
              Dry date
            </th>
          </tr>
        </thead>
        <tbody>
          {pins.map((pin) => {
            const readings = readingsByPinId.get(pin.id) ?? [];
            const history = deriveReadingHistory(
              readings.map((r) => ({
                ...r,
                reading_value: Number(r.reading_value),
              })),
              Number(pin.dry_standard),
              jobTimezone,
            );
            // If a pin has >1 reading on the same local day (post-demo
            // re-inspection), the LATER reading wins the cell — callers
            // scan asc, so overwriting on collision keeps the latest.
            const byDate = new Map(
              history.asc.map((r) => [localDateFromTimestamp(r.taken_at, jobTimezone), r]),
            );
            const materialLabel =
              MATERIAL_LABEL[pin.material] ?? pin.material;
            return (
              <tr
                key={pin.id}
                className="border-b border-outline-variant/30 align-middle"
              >
                <td className="px-2 py-1.5 text-on-surface whitespace-nowrap">
                  {pin.location_name}
                </td>
                <td className="px-2 py-1.5 text-on-surface-variant whitespace-nowrap">
                  {materialLabel}
                </td>
                <td className="px-2 py-1.5 text-right text-on-surface tabular-nums whitespace-nowrap">
                  {Number(pin.dry_standard)}%
                </td>
                {allDates.map((d) => {
                  const reading = byDate.get(d);
                  if (!reading) {
                    // Blank cell — this pin had no reading on this day.
                    // Centered so the placeholder reads as intentional
                    // rather than drifting to the numeric column's
                    // right edge.
                    return (
                      <td
                        key={d}
                        className="px-2 py-1.5 text-center text-on-surface-variant/40"
                      >
                        —
                      </td>
                    );
                  }
                  // Per Brett §8.4 — color-code each cell by the reading's
                  // own color so adjusters can scan the trend visually.
                  const color = computeCellColor(
                    Number(reading.reading_value),
                    Number(pin.dry_standard),
                  );
                  return (
                    <td
                      key={d}
                      className="px-2 py-1.5 text-right text-on-surface tabular-nums whitespace-nowrap"
                    >
                      <span className="inline-flex items-center gap-1">
                        <span
                          aria-hidden
                          className={`w-1.5 h-1.5 rounded-full ${COLOR_BG[color]}`}
                        />
                        {Number(reading.reading_value)}%
                      </span>
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {history.dryMilestone ? (
                    // No tick — the emerald color already conveys
                    // "dry achieved." Day label joins the date as
                    // "23 Apr · D2" so the whole cell reads as one
                    // emerald phrase instead of three disconnected
                    // visual weights (tick / date / grey subscript).
                    <span className="text-emerald-800 font-medium">
                      {formatShortDateLocal(
                        history.dryMilestone.firstDryDate,
                      )}
                      {" · D"}
                      {allDates.indexOf(
                        history.dryMilestone.firstDryDate,
                      ) + 1}
                    </span>
                  ) : (
                    <span className="block text-center text-on-surface-variant/40">
                      —
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Inline cell color — duplicates the backend's compute_pin_color
 *  boundary (green ≤ std, amber ≤ std+10, red >). Kept inline because
 *  this table renders per-day per-pin and we want zero hook imports
 *  to keep the print path tree-shakeable. */
function computeCellColor(
  reading: number,
  dryStandard: number,
): "red" | "amber" | "green" {
  if (reading <= dryStandard) return "green";
  if (reading <= dryStandard + 10) return "amber";
  return "red";
}
