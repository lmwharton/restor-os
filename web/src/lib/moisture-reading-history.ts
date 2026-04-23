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

import type { MoisturePinReading } from "./types";

/**
 * Shape of the component's input readings once `reading_value` has
 * been coerced to Number. The component does that coercion once at
 * the top of the render because the backend serializes DB NUMERIC as
 * a string ("7.00") — see `moisture-reading-sheet.tsx` for the full
 * commentary on why naked `>`/`<` on raw strings is unsafe.
 */
export type NormalizedReading = MoisturePinReading;

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
}

/**
 * Derive the full history view state from a pin's readings.
 *
 * Sort is on the `reading_date` string via `localeCompare` — safe
 * because `reading_date` is `YYYY-MM-DD` from a Postgres DATE column,
 * which is lexicographically ordered the same as chronologically.
 * Regression = strictly greater than the previous day (`>`, not `≥`),
 * matching the backend's `compute_pin_color` behavior and the
 * designed UX: "equal means stable, not worse."
 */
export function deriveReadingHistory(
  normalized: ReadonlyArray<NormalizedReading>,
): ReadingHistory {
  const asc = [...normalized].sort((a, b) =>
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
  return { asc, desc, regressingIds, latest, previous };
}

/**
 * Find the reading whose `reading_date` matches the given local-day
 * string (`YYYY-MM-DD`). Paired with `todayLocalIso()` from
 * `@/lib/dates` — pass the two together and you get the "already
 * logged today" row the sheet uses for prefill + overwrite.
 */
export function findTodayReading(
  normalized: ReadonlyArray<NormalizedReading>,
  today: string,
): NormalizedReading | null {
  return normalized.find((r) => r.reading_date === today) ?? null;
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
