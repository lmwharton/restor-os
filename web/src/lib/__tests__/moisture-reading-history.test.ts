import { describe, expect, it } from "vitest";
import {
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
    reading_date: string;
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
    const h = deriveReadingHistory([]);
    expect(h.asc).toEqual([]);
    expect(h.desc).toEqual([]);
    expect(h.regressingIds.size).toBe(0);
    expect(h.latest).toBeNull();
    expect(h.previous).toBeNull();
  });

  it("handles a single reading — latest set, previous null, no regression", () => {
    const r = makeReading({
      id: "r1",
      reading_date: "2026-04-22",
      reading_value: 15,
    });
    const h = deriveReadingHistory([r]);
    expect(h.asc).toEqual([r]);
    expect(h.desc).toEqual([r]);
    expect(h.regressingIds.size).toBe(0);
    expect(h.latest).toBe(r);
    expect(h.previous).toBeNull();
  });

  it("flags the newer reading as regressing when value strictly increases", () => {
    const older = makeReading({
      id: "r1",
      reading_date: "2026-04-21",
      reading_value: 12,
    });
    const newer = makeReading({
      id: "r2",
      reading_date: "2026-04-22",
      reading_value: 18,
    });
    const h = deriveReadingHistory([older, newer]);
    expect(h.regressingIds.has("r2")).toBe(true);
    expect(h.regressingIds.has("r1")).toBe(false);
    expect(h.latest).toBe(newer);
    expect(h.previous).toBe(older);
  });

  it("does NOT flag regression when the series is purely decreasing", () => {
    const r1 = makeReading({
      id: "r1",
      reading_date: "2026-04-20",
      reading_value: 25,
    });
    const r2 = makeReading({
      id: "r2",
      reading_date: "2026-04-21",
      reading_value: 18,
    });
    const r3 = makeReading({
      id: "r3",
      reading_date: "2026-04-22",
      reading_value: 14,
    });
    const h = deriveReadingHistory([r1, r2, r3]);
    expect(h.regressingIds.size).toBe(0);
    expect(h.latest).toBe(r3);
  });

  it("treats equal consecutive values as NOT regressing (strict >, not >=)", () => {
    // The UX contract says 'equal = stable, not worse'. Pin the
    // boundary — a > flipped to >= would silently mark every
    // plateau day as a regression.
    const r1 = makeReading({
      id: "r1",
      reading_date: "2026-04-21",
      reading_value: 16,
    });
    const r2 = makeReading({
      id: "r2",
      reading_date: "2026-04-22",
      reading_value: 16,
    });
    const h = deriveReadingHistory([r1, r2]);
    expect(h.regressingIds.size).toBe(0);
  });

  it("flags only the specific jumps in a mixed up/down series", () => {
    // Values: 10 → 12 (up, flag r2) → 8 (down) → 14 (up, flag r4)
    const r1 = makeReading({
      id: "r1",
      reading_date: "2026-04-19",
      reading_value: 10,
    });
    const r2 = makeReading({
      id: "r2",
      reading_date: "2026-04-20",
      reading_value: 12,
    });
    const r3 = makeReading({
      id: "r3",
      reading_date: "2026-04-21",
      reading_value: 8,
    });
    const r4 = makeReading({
      id: "r4",
      reading_date: "2026-04-22",
      reading_value: 14,
    });
    const h = deriveReadingHistory([r1, r2, r3, r4]);
    expect(Array.from(h.regressingIds).sort()).toEqual(["r2", "r4"]);
  });

  it("sorts out-of-order input by reading_date ascending", () => {
    const apr22 = makeReading({
      id: "r-apr22",
      reading_date: "2026-04-22",
      reading_value: 10,
    });
    const apr20 = makeReading({
      id: "r-apr20",
      reading_date: "2026-04-20",
      reading_value: 20,
    });
    const apr21 = makeReading({
      id: "r-apr21",
      reading_date: "2026-04-21",
      reading_value: 15,
    });
    const h = deriveReadingHistory([apr22, apr20, apr21]);
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
      reading_date: "2026-04-22",
      reading_value: 10,
    });
    const r2 = makeReading({
      id: "r2",
      reading_date: "2026-04-20",
      reading_value: 20,
    });
    const input = [r1, r2];
    const snapshot = input.map((r) => r.id);
    deriveReadingHistory(input);
    // Original order preserved — the function returns new arrays.
    expect(input.map((r) => r.id)).toEqual(snapshot);
  });
});

// ─── findTodayReading ──────────────────────────────────────────────────

describe("findTodayReading", () => {
  it("returns the reading whose date matches today", () => {
    const r1 = makeReading({
      id: "r1",
      reading_date: "2026-04-21",
      reading_value: 12,
    });
    const r2 = makeReading({
      id: "r2",
      reading_date: "2026-04-22",
      reading_value: 18,
    });
    expect(findTodayReading([r1, r2], "2026-04-22")).toBe(r2);
  });

  it("returns null when no reading matches today", () => {
    const r1 = makeReading({
      id: "r1",
      reading_date: "2026-04-21",
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
    reading_date: "2026-04-22",
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
