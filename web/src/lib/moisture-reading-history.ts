// Pure derivation logic for the moisture-reading sheet's history
// panel. Extracted out of `moisture-reading-sheet.tsx` so the
// algorithm can be unit-tested without mounting the sheet or its
// TanStack Query + modal + drag stack.
//
// The component itself now consumes these from useMemo wrappers; the
// only thing that changed when moving here is the test surface. Any
// future consumer that needs "latest / previous / regression set /
// today row" against a reading series (e.g. the planned adjuster
// portal view in Phase 2 Task 7, or a PDF export path in Task 6)
// should pull from this module rather than re-deriving.

import { localDateFromTimestamp } from "./dates";
import type { MoisturePinReading, PinColor } from "./types";

/**
 * Compute a pin's color category from a reading value against its
 * dry standard. Mirrors the backend's `compute_pin_color`:
 *
 *   green  — reading ≤ dry_standard
 *   amber  — reading ≤ dry_standard + 10
 *   red    — reading > dry_standard + 10
 *
 * Lives in `lib/` (pure, no React) so any derivation module can import
 * it without pulling the React/query-client/API graph transitively.
 * The `hooks/use-moisture-pins` module re-exports this symbol for
 * back-compat with existing import paths.
 */
export function computePinColor(
  reading: number,
  dryStandard: number,
): PinColor {
  if (reading <= dryStandard) return "green";
  if (reading <= dryStandard + 10) return "amber";
  return "red";
}

/**
 * Shape of the component's input readings once `reading_value` has
 * been coerced to Number. The component does that coercion once at
 * the top of the render because the backend serializes DB NUMERIC as
 * a string ("7.00") — see `moisture-reading-sheet.tsx` for the full
 * commentary on why naked `>`/`<` on raw strings is unsafe.
 */
export type NormalizedReading = MoisturePinReading;

export interface DryMilestone {
  /** `YYYY-MM-DD` of the first reading that met dry standard. */
  firstDryDate: string;
  /** Sequence position (1-indexed) of the first-dry reading within
   *  the pin's own ascending reading array. If a pin was dry on its
   *  first reading, this is 1; the second reading is 2; etc.
   *
   *  This is a **reading-count index**, not a calendar-day delta —
   *  the summary table's D1…DN headers across the job are also
   *  sequence-indexed into the distinct reading dates, and keeping
   *  both on the same idiom means a row's Dry Date cell never shows
   *  a day number that disagrees with the column it falls under on a
   *  pin with skipped days (e.g. readings Apr 18, Apr 22, Apr 24 —
   *  a dry on Apr 22 is D2 in both views, not D5 vs D2). */
  firstDryDayNumber: number;
  /** The reading id that achieved dry standard first. */
  firstDryReadingId: string;
}

export interface ReadingHistory {
  /** Oldest → newest. Drives sparkline x-axis + day-over-day regression. */
  asc: NormalizedReading[];
  /** Newest → oldest. Drives the history list UI. */
  desc: NormalizedReading[];
  /** Reading ids whose value strictly exceeds the previous day's. */
  regressingIds: Set<string>;
  /** Most-recent reading, or null when the series is empty. */
  latest: NormalizedReading | null;
  /** Second-most-recent reading, or null with < 2 readings. */
  previous: NormalizedReading | null;
  /**
   * First-hit dry-standard milestone per Brett §8.5 — "green checkmark
   * appears when dry standard is met, with the date it was achieved."
   * Null while the pin has never hit dry standard. **Does NOT reset
   * on regression** — the milestone records that drying was achieved
   * at some point, which is the compliance-relevant fact. A pin that
   * dried and then went back above standard still reports the original
   * dry date.
   */
  dryMilestone: DryMilestone | null;
}

/**
 * Derive the full history view state from a pin's readings.
 *
 * Sort is on the `taken_at` string via `localeCompare` — safe because
 * ISO 8601 timestamps are lexicographically ordered the same as
 * chronologically (Phase 3 Step 3 replaced the prior `reading_date`
 * DATE with a TIMESTAMPTZ, so sub-day precision is preserved in the
 * sort). Regression = strictly greater than the previous reading
 * (`>`, not `≥`), matching the backend's `compute_pin_color` behavior
 * and the designed UX: "equal means stable, not worse."
 *
 * `dryStandard` is required so the helper can compute the
 * dry-milestone (Brett §8.5). Pass the pin's `dry_standard` value.
 *
 * `jobTimezone` (review round-1 H2) anchors the first-dry-date extraction
 * to the job's IANA TZ so carrier-facing output doesn't vary by viewer
 * location. Optional — when omitted, falls back to viewer-local, which is
 * correct for tech-facing surfaces (tech + job site share a clock).
 */
export function deriveReadingHistory(
  normalized: ReadonlyArray<NormalizedReading>,
  dryStandard: number,
  jobTimezone?: string,
): ReadingHistory {
  const asc = [...normalized].sort((a, b) =>
    a.taken_at.localeCompare(b.taken_at),
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

  // First-hit dry milestone. Linear scan is fine — series is bounded
  // (~30 readings per pin in a typical drying job). First match wins;
  // regressions after this point DO NOT reset the milestone. Day
  // number is the sequence index within `asc` so it aligns with the
  // summary table's D{i+1} column headers. `firstDryDate` is the
  // local calendar day of that reading — carrier docs show a day, not
  // an instant, even though the underlying column is TIMESTAMPTZ.
  let dryMilestone: DryMilestone | null = null;
  if (asc.length > 0) {
    const firstDryIndex = asc.findIndex(
      (r) => r.reading_value <= dryStandard,
    );
    if (firstDryIndex >= 0) {
      const firstDry = asc[firstDryIndex];
      dryMilestone = {
        firstDryDate: localDateFromTimestamp(firstDry.taken_at, jobTimezone),
        firstDryDayNumber: firstDryIndex + 1,
        firstDryReadingId: firstDry.id,
      };
    }
  }

  return { asc, desc, regressingIds, latest, previous, dryMilestone };
}

/**
 * Compute the color a pin "would have been" at the close of a given
 * calendar day. Drives the user-selected date snapshot on the moisture
 * report view (Brett §8.6) — the table and the canvas overlay both
 * need to show each pin's status AS OF the picked date, not as of the
 * latest reading.
 *
 * Semantics: the pin's color on date D is determined by the LATEST
 * reading whose local calendar day is on or before D. Returns `null`
 * when no reading exists on or before D (pin didn't exist yet, or was
 * placed without a reading — renderer shows a neutral grey dot).
 *
 * `readingsAsc` must be sorted ascending by `taken_at`. Pass the `asc`
 * array from `deriveReadingHistory`. Linear scan is fine; per-pin
 * reading volume is bounded (~30).
 *
 * Phase 3 Step 3: the underlying column is TIMESTAMPTZ now, so we
 * normalize each reading's instant to the viewer's local calendar day
 * via `localDateFromTimestamp` before comparing. Raw lex compare
 * against `isoDate` (a `YYYY-MM-DD` string) would be wrong — see
 * lesson #22 in pr-review-lessons.md.
 */
export function computePinColorAsOf(
  readingsAsc: ReadonlyArray<NormalizedReading>,
  isoDate: string,
  dryStandard: number,
  jobTimezone?: string,
): PinColor | null {
  for (let i = readingsAsc.length - 1; i >= 0; i--) {
    if (localDateFromTimestamp(readingsAsc[i].taken_at, jobTimezone) <= isoDate) {
      return computePinColor(readingsAsc[i].reading_value, dryStandard);
    }
  }
  return null;
}

/**
 * Find the most-recent reading whose local calendar day matches the
 * given `YYYY-MM-DD` string. Paired with `todayLocalIso()` from
 * `@/lib/dates` — pass the two together and you get the "already
 * logged today" row the sheet uses for prefill + overwrite.
 *
 * Phase 3 Step 3: multiple readings per pin per day are now allowed
 * (post-demo re-inspection workflow). When that happens, "today's
 * reading" is the latest same-day reading — we scan the normalized
 * array from the end so we pick the newest match, assuming the caller
 * passes an ascending-sorted series (the `asc` output of
 * `deriveReadingHistory` satisfies this; the raw input usually does
 * too since the API returns DESC and most callers just reverse once).
 * If ordering isn't guaranteed at the call site, pre-sort first.
 */
export function findTodayReading(
  normalized: ReadonlyArray<NormalizedReading>,
  today: string,
  jobTimezone?: string,
): NormalizedReading | null {
  for (let i = normalized.length - 1; i >= 0; i--) {
    if (localDateFromTimestamp(normalized[i].taken_at, jobTimezone) === today) {
      return normalized[i];
    }
  }
  return null;
}

export interface ReadingInputValidation {
  /** Parsed numeric value, or null if the string can't be interpreted. */
  value: number | null;
  /** True only when the value is a finite number in `[0, 100]` and the
   *  original string is non-empty (so a bare "" is treated as invalid
   *  rather than silently coerced to 0). */
  valid: boolean;
}

/**
 * Validate + parse a raw string from the reading input.
 *
 * Component state carries the input as a string so the user can type
 * transient values like "4." or "" without React forcibly rejecting
 * them. The save button gates on the output of this helper.
 */
export function validateReadingInput(raw: string): ReadingInputValidation {
  if (raw === "") return { value: null, valid: false };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { value: null, valid: false };
  if (n < 0 || n > 100) return { value: n, valid: false };
  return { value: n, valid: true };
}

/**
 * True when the current input, if saved, would change the stored
 * today-reading. Prevents the Save button from firing a no-op
 * network round-trip when the user opens the sheet, doesn't type
 * anything, and the input is prefilled with today's existing value.
 */
export function isChangedFromToday(
  parsedValue: number | null,
  todayReading: NormalizedReading | null,
): boolean {
  if (todayReading === null) return parsedValue !== null;
  if (parsedValue === null) return false;
  return todayReading.reading_value !== parsedValue;
}
