// Date helpers for anything in the app that treats dates as *calendar
// days* (what the tech sees on their wall clock), not as *instants*.
//
// ─── The two date worlds ─────────────────────────────────────────────
//
// 1. Calendar-day columns (PostgreSQL `DATE`). The value means "the
//    calendar day this happened on." Source of truth: the tech's local
//    wall clock. UTC is wrong here — at 8 PM on Apr 22 in US Pacific
//    the UTC clock already reads Apr 23, so a UTC-based "today" gets
//    written as tomorrow, then read back through a local parser and
//    displayed as tomorrow.
//
// 2. Instant columns (PostgreSQL `TIMESTAMPTZ`, e.g. `taken_at` on
//    `moisture_pin_readings`, `created_at`, `started_at`). These
//    represent an exact moment on a timeline. UTC ISO strings are the
//    right source (`new Date().toISOString()`).
//
//    Phase 3 Step 3 flipped `reading_date` (DATE) to `taken_at`
//    (TIMESTAMPTZ) to allow multiple readings per pin per day. When
//    comparing "is this reading from today?" or "is this reading on
//    or before Apr 22?", we must extract the *local calendar day*
//    from the timestamp — raw lexicographic compare is wrong because
//    `"2026-04-22T14:32:15Z" <= "2026-04-22"` is false. Use
//    `localDateFromTimestamp(taken_at)` to get back to the
//    wall-clock day, then compare that.
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
  // Defensive: caller occasionally passes undefined / null / "" when a
  // reading's date can't be resolved (stale cache, missing field). Return
  // empty string rather than throwing — the UI shows a blank cell, which
  // is visible enough for the tech to notice without crashing the whole
  // report. Upstream code should still filter these out when producing
  // the canonical date axis.
  //
  // Review round-1 M3: warn on every swallow so the upstream gap shows
  // up in dev tools + any error-collector wired to console.warn. Silent
  // coerce is lesson §2 — defensive guards must leave a signal behind.
  if (!iso || typeof iso !== "string") {
    if (typeof console !== "undefined") {
      console.warn(
        "formatShortDateLocal: unparseable input (expected YYYY-MM-DD string)",
        { iso },
      );
    }
    return "";
  }
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Given a TIMESTAMPTZ wire value (ISO 8601 with offset, e.g.
 * `"2026-04-22T14:32:15-07:00"`), return the calendar day as
 * `YYYY-MM-DD` in the specified IANA timezone (e.g. `"America/Denver"`),
 * or the viewer's browser-local timezone when `tz` is omitted.
 *
 * Review round-1 H2: the backend authoritative billing clock is
 * `jobs.timezone`. Surfaces that show data the carrier will see — the
 * moisture-report view, summary table, snapshot color, Day-N axis —
 * must bucket by the job's timezone so a Hawaiian job reads the same
 * Day-5 to an adjuster in Atlanta as it does to the tech on-site.
 * Callers that legitimately want viewer-local (the tech-facing reading
 * sheet, where tech + job site are co-located) can omit `tz`.
 *
 * Implementation notes: when `tz` is supplied, we use `Intl.DateTimeFormat`
 * which is the only cross-browser way to extract local-date components
 * for an arbitrary IANA zone without pulling a TZ library. The `en-CA`
 * locale is a stable trick to force `YYYY-MM-DD` output ordering. When
 * `tz` is omitted, we keep the fast path that uses the `Date` object's
 * local-accessor trio (matches `todayLocalIso` semantics exactly).
 *
 * Falls back to empty string + console.warn on unparseable input or
 * unknown TZ so the upstream gap leaves a signal in dev tools.
 */
export function localDateFromTimestamp(ts: string, tz?: string): string {
  if (!ts || typeof ts !== "string") {
    if (typeof console !== "undefined") {
      console.warn(
        "localDateFromTimestamp: unparseable input (expected TIMESTAMPTZ ISO string)",
        { ts },
      );
    }
    return "";
  }
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    if (typeof console !== "undefined") {
      console.warn(
        "localDateFromTimestamp: Date parsed as Invalid — upstream payload corrupt",
        { ts },
      );
    }
    return "";
  }
  if (tz) {
    // Intl.DateTimeFormat with `en-CA` returns `YYYY-MM-DD` without
    // per-component assembly. A bad timezone string here throws a
    // RangeError; we catch + warn rather than let the exception bubble
    // up through a React render and crash the report (matches the
    // defensive-with-signal pattern elsewhere in this module).
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn(
          "localDateFromTimestamp: invalid IANA timezone, falling back to viewer-local",
          { ts, tz, err },
        );
      }
      // Intentional fallthrough to browser-local below. Loudly-logged,
      // not silently-coerced.
    }
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
