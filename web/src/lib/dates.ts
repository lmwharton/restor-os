// Date helpers for anything in the app that treats dates as *calendar
// days* (what the tech sees on their wall clock), not as *instants*.
//
// ─── The two date worlds ─────────────────────────────────────────────
//
// 1. Calendar-day columns (PostgreSQL `DATE`, e.g. `reading_date` on
//    `moisture_pin_readings`). No timezone is stored. The value means
//    "the calendar day this happened on." Source of truth: the tech's
//    local wall clock. UTC is wrong here — at 8 PM on Apr 22 in US
//    Pacific the UTC clock already reads Apr 23, so a UTC-based
//    "today" gets written as tomorrow, then read back through a local
//    parser and displayed as tomorrow. Worse, the next morning's real
//    Apr 23 reading collides with the 8 PM entry on the
//    UNIQUE(pin_id, reading_date) constraint and silently overwrites
//    the prior one via upsert.
//
// 2. Instant columns (PostgreSQL `TIMESTAMPTZ`, e.g. `started_at`,
//    `created_at`). These represent an exact moment on a timeline.
//    UTC ISO strings are the right source (`new Date().toISOString()`).
//    Display is handled at render time by `toLocaleDateString` /
//    friends. These helpers do NOT cover that case — keep using ISO
//    directly.
//
// ─── Rule of thumb ───────────────────────────────────────────────────
//
//   Writing a `DATE` column or comparing "is this today?"
//     → todayLocalIso()
//   Rendering a `DATE` column for humans (short month + day)
//     → formatShortDateLocal(iso)
//   Working with `TIMESTAMPTZ`
//     → do NOT use this module; `new Date(iso).toLocale…()` is fine.

/**
 * Today in the tech's local timezone, formatted `YYYY-MM-DD`.
 * Use this anywhere you're writing a calendar-day value (e.g. a DATE
 * column) or comparing "is this reading from today?" Write and read
 * agree on the same wall-clock date; no UTC drift across the
 * evening → next-morning boundary.
 */
export function todayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Render a `YYYY-MM-DD` calendar-day string as a short human date
 * (e.g. "Apr 22") in the viewer's locale.
 *
 * Uses `new Date(y, m - 1, d)` so the date is constructed from local
 * components. `new Date("2026-04-22")` would be interpreted as UTC
 * midnight and render as "Apr 21" in negative UTC offsets — that's
 * the exact trap this helper avoids. Falls back to the raw input on
 * malformed strings so nothing in the UI silently shows a wrong day.
 */
export function formatShortDateLocal(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
