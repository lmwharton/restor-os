import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatShortDateLocal, todayLocalIso } from "../dates";

// Tests guard the exact regression we shipped a fix for: UTC-based
// "today" on a DATE column silently rolls the calendar day forward
// after ~5 PM Pacific, creating duplicate reading_dates across the
// evening → next-morning boundary.

describe("todayLocalIso", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the local wall-clock date at 8 PM US Pacific (UTC already next day)", () => {
    // 2026-04-22 20:00 local in America/Los_Angeles (UTC-7 during DST)
    // is 2026-04-23 03:00 UTC. A UTC-based "today" would return
    // "2026-04-23" — which is the bug.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 20, 0, 0)); // month is 0-indexed
    expect(todayLocalIso()).toBe("2026-04-22");
  });

  it("zero-pads single-digit months and days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 3, 12, 0, 0)); // Jan 3
    expect(todayLocalIso()).toBe("2026-01-03");
  });

  it("handles year boundaries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59)); // Dec 31 23:59 local
    expect(todayLocalIso()).toBe("2026-12-31");
  });

  it("returns a YYYY-MM-DD shape regardless of locale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 10, 30, 0));
    expect(todayLocalIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatShortDateLocal", () => {
  let originalLang: string | undefined;

  beforeEach(() => {
    // Force en-US so the short-format assertions don't fracture across
    // CI machines with different default locales.
    originalLang = process.env.LANG;
    process.env.LANG = "en-US";
  });

  afterEach(() => {
    process.env.LANG = originalLang;
  });

  it("renders a valid YYYY-MM-DD using local date components", () => {
    // Constructing via local components avoids the
    // `new Date("2026-04-22")`-is-UTC-midnight trap. In a negative
    // offset (e.g. US), that would display as "Apr 21" — the fix
    // anchors the display to the calendar day the string represents.
    const out = formatShortDateLocal("2026-04-22");
    expect(out).toContain("Apr");
    expect(out).toContain("22");
  });

  it("falls back to the raw input when the date string is malformed", () => {
    expect(formatShortDateLocal("not-a-date")).toBe("not-a-date");
    expect(formatShortDateLocal("2026-04")).toBe("2026-04");
    expect(formatShortDateLocal("")).toBe("");
  });

  it("agrees with todayLocalIso — what you write is what you render", () => {
    // Guards the symmetric write/read pattern. The same wall-clock
    // moment must produce the same calendar day on both sides.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 20, 0, 0));
    const iso = todayLocalIso();
    const rendered = formatShortDateLocal(iso);
    expect(iso).toBe("2026-04-22");
    expect(rendered).toContain("22");
    vi.useRealTimers();
  });
});
