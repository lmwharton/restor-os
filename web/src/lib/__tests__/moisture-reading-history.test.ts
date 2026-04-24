import { describe, expect, it } from "vitest";
import {
  computePinColorAsOf,
  deriveReadingHistory,
  findTodayReading,
  isChangedFromToday,
  validateReadingInput,
  type NormalizedReading,
} from "../moisture-reading-history";

// ─── Test fixtures ─────────────────────────────────────────────────────
//
// Keep reading construction tight — tests are more readable when the
// factory shows just the axes that matter for that test.

function makeReading(
  overrides: Partial<NormalizedReading> & {
    id: string;
    taken_at: string;
    reading_value: number;
  },
): NormalizedReading {
  return {
    pin_id: "pin-1",
    notes: null,
    meter_photo_url: null,
    created_at: "2026-04-22T12:00:00Z",
    ...overrides,
  } as NormalizedReading;
}

// ─── deriveReadingHistory ──────────────────────────────────────────────

describe("deriveReadingHistory", () => {
  it("returns empty arrays + null latest/previous for an empty series", () => {
    const h = deriveReadingHistory([], 16);
    expect(h.asc).toEqual([]);
    expect(h.desc).toEqual([]);
    expect(h.regressingIds.size).toBe(0);
    expect(h.latest).toBeNull();
    expect(h.previous).toBeNull();
  });

  it("handles a single reading — latest set, previous null, no regression", () => {
    const r = makeReading({
      id: "r1",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 15,
    });
    const h = deriveReadingHistory([r], 16);
    expect(h.asc).toEqual([r]);
    expect(h.desc).toEqual([r]);
    expect(h.regressingIds.size).toBe(0);
    expect(h.latest).toBe(r);
    expect(h.previous).toBeNull();
  });

  it("flags the newer reading as regressing when value strictly increases", () => {
    const older = makeReading({
      id: "r1",
      taken_at: "2026-04-21T12:00:00Z",
      reading_value: 12,
    });
    const newer = makeReading({
      id: "r2",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 18,
    });
    const h = deriveReadingHistory([older, newer], 16);
    expect(h.regressingIds.has("r2")).toBe(true);
    expect(h.regressingIds.has("r1")).toBe(false);
    expect(h.latest).toBe(newer);
    expect(h.previous).toBe(older);
  });

  it("does NOT flag regression when the series is purely decreasing", () => {
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-20T12:00:00Z",
      reading_value: 25,
    });
    const r2 = makeReading({
      id: "r2",
      taken_at: "2026-04-21T12:00:00Z",
      reading_value: 18,
    });
    const r3 = makeReading({
      id: "r3",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 14,
    });
    const h = deriveReadingHistory([r1, r2, r3], 16);
    expect(h.regressingIds.size).toBe(0);
    expect(h.latest).toBe(r3);
  });

  it("treats equal consecutive values as NOT regressing (strict >, not >=)", () => {
    // The UX contract says 'equal = stable, not worse'. Pin the
    // boundary — a > flipped to >= would silently mark every
    // plateau day as a regression.
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-21T12:00:00Z",
      reading_value: 16,
    });
    const r2 = makeReading({
      id: "r2",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 16,
    });
    const h = deriveReadingHistory([r1, r2], 16);
    expect(h.regressingIds.size).toBe(0);
  });

  it("flags only the specific jumps in a mixed up/down series", () => {
    // Values: 10 → 12 (up, flag r2) → 8 (down) → 14 (up, flag r4)
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-19T12:00:00Z",
      reading_value: 10,
    });
    const r2 = makeReading({
      id: "r2",
      taken_at: "2026-04-20T12:00:00Z",
      reading_value: 12,
    });
    const r3 = makeReading({
      id: "r3",
      taken_at: "2026-04-21T12:00:00Z",
      reading_value: 8,
    });
    const r4 = makeReading({
      id: "r4",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 14,
    });
    const h = deriveReadingHistory([r1, r2, r3, r4], 16);
    expect(Array.from(h.regressingIds).sort()).toEqual(["r2", "r4"]);
  });

  it("sorts out-of-order input by taken_at ascending", () => {
    const apr22 = makeReading({
      id: "r-apr22",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 10,
    });
    const apr20 = makeReading({
      id: "r-apr20",
      taken_at: "2026-04-20T12:00:00Z",
      reading_value: 20,
    });
    const apr21 = makeReading({
      id: "r-apr21",
      taken_at: "2026-04-21T12:00:00Z",
      reading_value: 15,
    });
    const h = deriveReadingHistory([apr22, apr20, apr21], 16);
    expect(h.asc.map((r) => r.id)).toEqual([
      "r-apr20",
      "r-apr21",
      "r-apr22",
    ]);
    expect(h.desc.map((r) => r.id)).toEqual([
      "r-apr22",
      "r-apr21",
      "r-apr20",
    ]);
    expect(h.latest?.id).toBe("r-apr22");
    expect(h.previous?.id).toBe("r-apr21");
  });

  it("does not mutate its input array", () => {
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 10,
    });
    const r2 = makeReading({
      id: "r2",
      taken_at: "2026-04-20T12:00:00Z",
      reading_value: 20,
    });
    const input = [r1, r2];
    const snapshot = input.map((r) => r.id);
    deriveReadingHistory(input, 16);
    // Original order preserved — the function returns new arrays.
    expect(input.map((r) => r.id)).toEqual(snapshot);
  });

  // ─── dryMilestone (Brett §8.5) ────────────────────────────────────

  it("dryMilestone is null when the pin has never met dry standard", () => {
    // All readings above dry_standard of 16 → never dry.
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-20T12:00:00Z",
      reading_value: 30,
    });
    const r2 = makeReading({
      id: "r2",
      taken_at: "2026-04-21T12:00:00Z",
      reading_value: 22,
    });
    const h = deriveReadingHistory([r1, r2], 16);
    expect(h.dryMilestone).toBeNull();
  });

  it("dryMilestone captures the first reading to hit dry standard", () => {
    // r1 (Apr 20, 30%) wet → r2 (Apr 21, 20%) wet → r3 (Apr 22, 14%)
    // first dry. Day count starts at 1 for the first reading in the
    // series, so r3 is Day 3.
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-20T12:00:00Z",
      reading_value: 30,
    });
    const r2 = makeReading({
      id: "r2",
      taken_at: "2026-04-21T12:00:00Z",
      reading_value: 20,
    });
    const r3 = makeReading({
      id: "r3",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 14,
    });
    const h = deriveReadingHistory([r1, r2, r3], 16);
    expect(h.dryMilestone).toEqual({
      firstDryDate: "2026-04-22",
      firstDryDayNumber: 3,
      firstDryReadingId: "r3",
    });
  });

  it("dryMilestone does NOT reset when the pin regresses after dry", () => {
    // r1 dry (14 ≤ 16) → r2 regressed (18 > 16) → r3 regressed (20).
    // Brett §8.5 milestone records achievement, not current state —
    // regressions keep the ORIGINAL dry date for carrier documentation.
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-20T12:00:00Z",
      reading_value: 14,
    });
    const r2 = makeReading({
      id: "r2",
      taken_at: "2026-04-21T12:00:00Z",
      reading_value: 18,
    });
    const r3 = makeReading({
      id: "r3",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 20,
    });
    const h = deriveReadingHistory([r1, r2, r3], 16);
    expect(h.dryMilestone?.firstDryReadingId).toBe("r1");
    expect(h.dryMilestone?.firstDryDate).toBe("2026-04-20");
    expect(h.dryMilestone?.firstDryDayNumber).toBe(1);
  });

  it("treats reading = dry_standard as DRY (inclusive at boundary)", () => {
    // Matches compute_pin_color: green includes `== dry_standard`.
    // Without inclusivity a pin exactly at 16% would never be flagged dry.
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-20T12:00:00Z",
      reading_value: 16,
    });
    const h = deriveReadingHistory([r1], 16);
    expect(h.dryMilestone?.firstDryReadingId).toBe("r1");
  });

  it("handles first-reading-already-dry as Day 1", () => {
    // Occasionally the meter reads dry on initial placement (leaking
    // pipe repaired hours ago, concrete above material). Day 1 is
    // correct — count from the first reading regardless.
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 12,
    });
    const h = deriveReadingHistory([r1], 16);
    expect(h.dryMilestone?.firstDryDayNumber).toBe(1);
  });

  it("firstDryDayNumber is the SEQUENCE index, not a calendar-day delta", () => {
    // Readings on Apr 18, Apr 22, Apr 24 — tech skipped a weekend.
    // The pin dries on Apr 22 (the 2nd reading). Pre-H4 the helper
    // returned calendar-day 5 (22 − 18 + 1), which disagreed with
    // the summary table's D2 column header for the same row.
    // Post-H4 it's 2 (second in the pin's own asc array). The
    // summary-table cell computes its own label from the job-wide
    // allDates index, so the two never conflict.
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-18T12:00:00Z",
      reading_value: 30,
    });
    const r2 = makeReading({
      id: "r2",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 14,
    });
    const r3 = makeReading({
      id: "r3",
      taken_at: "2026-04-24T12:00:00Z",
      reading_value: 12,
    });
    const h = deriveReadingHistory([r1, r2, r3], 16);
    expect(h.dryMilestone?.firstDryDayNumber).toBe(2);
    expect(h.dryMilestone?.firstDryDate).toBe("2026-04-22");
    expect(h.dryMilestone?.firstDryReadingId).toBe("r2");
  });
});

// ─── findTodayReading ──────────────────────────────────────────────────

describe("findTodayReading", () => {
  it("returns the reading whose date matches today", () => {
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-21T12:00:00Z",
      reading_value: 12,
    });
    const r2 = makeReading({
      id: "r2",
      taken_at: "2026-04-22T12:00:00Z",
      reading_value: 18,
    });
    expect(findTodayReading([r1, r2], "2026-04-22")).toBe(r2);
  });

  it("returns null when no reading matches today", () => {
    const r1 = makeReading({
      id: "r1",
      taken_at: "2026-04-21T12:00:00Z",
      reading_value: 12,
    });
    expect(findTodayReading([r1], "2026-04-22")).toBeNull();
  });

  it("returns null on an empty series", () => {
    expect(findTodayReading([], "2026-04-22")).toBeNull();
  });
});

// ─── validateReadingInput ──────────────────────────────────────────────

describe("validateReadingInput", () => {
  it("rejects the empty string (not silently coerced to 0)", () => {
    const v = validateReadingInput("");
    expect(v.valid).toBe(false);
    expect(v.value).toBeNull();
  });

  it("rejects non-numeric text", () => {
    const v = validateReadingInput("abc");
    expect(v.valid).toBe(false);
    expect(v.value).toBeNull();
  });

  it("rejects negative values", () => {
    const v = validateReadingInput("-5");
    expect(v.valid).toBe(false);
    expect(v.value).toBe(-5);
  });

  it("rejects values > 100", () => {
    const v = validateReadingInput("150");
    expect(v.valid).toBe(false);
    expect(v.value).toBe(150);
  });

  it("accepts decimal values in range", () => {
    const v = validateReadingInput("18.5");
    expect(v.valid).toBe(true);
    expect(v.value).toBe(18.5);
  });

  it("accepts 0 and 100 as valid boundaries", () => {
    expect(validateReadingInput("0")).toEqual({ value: 0, valid: true });
    expect(validateReadingInput("100")).toEqual({ value: 100, valid: true });
  });
});

// ─── isChangedFromToday ────────────────────────────────────────────────

describe("isChangedFromToday", () => {
  const existing = makeReading({
    id: "today",
    taken_at: "2026-04-22T12:00:00Z",
    reading_value: 16,
  });

  it("returns true when there is no today row and the parsed value is valid", () => {
    expect(isChangedFromToday(14, null)).toBe(true);
  });

  it("returns false when there is no today row and nothing has been typed", () => {
    expect(isChangedFromToday(null, null)).toBe(false);
  });

  it("returns false when the typed value equals today's stored value", () => {
    expect(isChangedFromToday(16, existing)).toBe(false);
  });

  it("returns true when the typed value differs from today's stored value", () => {
    expect(isChangedFromToday(14, existing)).toBe(true);
  });

  it("returns false while the input is being cleared (null value)", () => {
    // Covers the transient "user cleared the prefilled input and
    // hasn't typed anything yet" state — Save should stay disabled,
    // not fire a zero-valued update.
    expect(isChangedFromToday(null, existing)).toBe(false);
  });
});

// ─── computePinColorAsOf (Brett §8.6 date snapshot) ────────────────────

describe("computePinColorAsOf", () => {
  const r1 = makeReading({
    id: "r1",
    taken_at: "2026-04-20T12:00:00Z",
    reading_value: 30, // red (30 > 16 + 10)
  });
  const r2 = makeReading({
    id: "r2",
    taken_at: "2026-04-22T12:00:00Z",
    reading_value: 18, // amber (16 < 18 ≤ 26)
  });
  const r3 = makeReading({
    id: "r3",
    taken_at: "2026-04-24T12:00:00Z",
    reading_value: 14, // green (14 ≤ 16)
  });
  const series = [r1, r2, r3];

  it("returns null when the date is before the first reading", () => {
    // Pin didn't exist yet on that date — the report renderer
    // shows this as a neutral grey dot.
    expect(computePinColorAsOf(series, "2026-04-19", 16)).toBeNull();
  });

  it("returns null for an empty reading series", () => {
    expect(computePinColorAsOf([], "2026-04-22", 16)).toBeNull();
  });

  it("uses the reading on the exact matching date", () => {
    // Apr 22 snapshot: r2 is the latest ≤ Apr 22 → amber.
    expect(computePinColorAsOf(series, "2026-04-22", 16)).toBe("amber");
  });

  it("uses the latest reading ≤ the snapshot date when no exact match", () => {
    // Apr 23 falls between r2 (Apr 22, amber) and r3 (Apr 24, green).
    // The snapshot on Apr 23 reflects r2 — Brett §8.6: "what was true
    // at close of that day." r3 hadn't been taken yet.
    expect(computePinColorAsOf(series, "2026-04-23", 16)).toBe("amber");
  });

  it("uses the latest reading when the snapshot date is after all readings", () => {
    // Apr 28 is after r3. r3 is still the latest ≤ Apr 28 → green.
    expect(computePinColorAsOf(series, "2026-04-28", 16)).toBe("green");
  });

  it("respects the pin's dry_standard (boundary check)", () => {
    // Same series, different dry_standard. At dry_standard=5 (concrete):
    //   r3.reading_value=14 → red (14 > 5 + 10 = 15 is false, so amber).
    //   Actually: 14 ≤ 5 + 10 = 15, so amber.
    // At dry_standard=12 (hardwood): r3.reading_value=14 → amber.
    expect(computePinColorAsOf(series, "2026-04-24", 5)).toBe("amber");
    expect(computePinColorAsOf(series, "2026-04-24", 12)).toBe("amber");
  });
});
