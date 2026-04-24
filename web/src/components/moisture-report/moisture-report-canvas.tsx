"use client";

// Read-only Konva stage for the moisture report — renders rooms + walls
// + moisture pins at their canvas coordinates, with pin colors computed
// AS OF a user-selected snapshot date (Brett §8.6). No drag, no tap
// handlers, no tool switcher — this is a static visual anchor inside
// the print/portal view.
//
// Why not reuse `KonvaFloorPlan`? Its interactive surface (dragging,
// vertex editing, mode switching, snap, undo/redo) is a lot of JS to
// ship inside a print route that only needs to paint rooms + pins.
// The duplication cost is small; the payoff is a clean print surface
// with no stray event handlers or cursor hints in the PDF output.

import { useLayoutEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Line, Text, Group, Circle } from "react-konva";

import type {
  FloorPlanData,
  RoomData,
} from "@/components/sketch/floor-plan-tools";
import type { MoisturePin, MoisturePinReading } from "@/lib/types";
import { computePinColorAsOf } from "@/lib/moisture-reading-history";
import { localDateFromTimestamp } from "@/lib/dates";

// Pin colors match the Konva layer in the main editor so the report
// visually matches what the tech sees in the field. Neutral grey is
// used for pins that have no reading on/before the snapshot date —
// the pin was placed but its first reading post-dates the snapshot,
// or the pin has no readings at all.
const PIN_COLOR_HEX: Record<"red" | "amber" | "green", string> = {
  red: "#dc2626",
  amber: "#f59e0b",
  green: "#16a34a",
};
const PIN_NO_DATA_HEX = "#9ca3af";

export interface MoistureReportCanvasProps {
  canvas: FloorPlanData;
  pins: ReadonlyArray<MoisturePin>;
  /** Map of pinId → all readings for that pin, ascending by taken_at.
   *  The canvas picks the latest reading whose local calendar day is
   *  ≤ `snapshotDate` per pin via `computePinColorAsOf`. */
  readingsByPinId: ReadonlyMap<string, ReadonlyArray<MoisturePinReading>>;
  /** YYYY-MM-DD. Drives per-pin color + the in-pin value label. */
  snapshotDate: string;
  /** IANA timezone of the job (review round-1 H2). Anchors the local-day
   *  extraction on every reading to the job's clock so pin colors on the
   *  shared portal don't vary by viewer location. Omit for tech-on-site
   *  contexts where browser-local is correct. */
  jobTimezone?: string;
}

/** Preferred aspect ratio for the plan image (4:3). Height derives
 *  from measured width so landscape floor plans fit cleanly and
 *  mobile viewports (< 760px) shrink proportionally instead of
 *  overflowing the parent container. */
const CANVAS_ASPECT = 760 / 540;
const CANVAS_MAX_WIDTH = 760;

/** Find the reading that matches `snapshotDate` (or the latest before)
 *  so we can render its VALUE inside the pin. Parallel to
 *  `computePinColorAsOf`, but returns the reading itself. */
function readingAsOf(
  readings: ReadonlyArray<MoisturePinReading>,
  snapshotDate: string,
  jobTimezone?: string,
): MoisturePinReading | null {
  for (let i = readings.length - 1; i >= 0; i--) {
    if (localDateFromTimestamp(readings[i].taken_at, jobTimezone) <= snapshotDate) {
      return readings[i];
    }
  }
  return null;
}

export function MoistureReportCanvas({
  canvas,
  pins,
  readingsByPinId,
  snapshotDate,
  jobTimezone,
}: MoistureReportCanvasProps) {
  // Responsive sizing: on mobile the parent container is narrower
  // than CANVAS_MAX_WIDTH, so we measure the container and let the
  // stage shrink to fit. Height always derives from width via
  // CANVAS_ASPECT so a shrinking canvas stays proportional.
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Initial measurement before any paint so we don't render at
    // a wrong size on first frame.
    setMeasuredWidth(Math.min(el.clientWidth, CANVAS_MAX_WIDTH));
    // Track resizes — viewport orientation flip, parent reflow,
    // print-preview. Guard the API in case an older browser or
    // jsdom runs this (test harness mocks react-konva so the stage
    // never lays out, but the effect still fires).
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMeasuredWidth(
          Math.min(entry.contentRect.width, CANVAS_MAX_WIDTH),
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveWidth = measuredWidth ?? CANVAS_MAX_WIDTH;
  const effectiveHeight = Math.round(effectiveWidth / CANVAS_ASPECT);

  const rooms = canvas.rooms ?? [];

  // Fit-to-box: compute bounds of all rooms + a small padding, then
  // uniform-scale the stage so the whole floor plan fits inside the
  // print-friendly box. Without this, mid-canvas sketches would be
  // drawn at actual coordinates and the print would often be blank
  // (rooms far off-screen).
  const bounds = computeBounds(rooms);
  const scale = bounds
    ? Math.min(
        (effectiveWidth - 40) / Math.max(bounds.w, 1),
        (effectiveHeight - 40) / Math.max(bounds.h, 1),
      )
    : 1;
  const offsetX = bounds ? 20 - bounds.x * scale : 0;
  const offsetY = bounds ? 20 - bounds.y * scale : 0;

  return (
    <div
      ref={containerRef}
      className="w-full max-w-[760px] bg-surface-container-lowest rounded-xl border border-outline-variant/20"
      style={{ height: effectiveHeight }}
    >
      <Stage
        width={effectiveWidth}
        height={effectiveHeight}
        scaleX={scale}
        scaleY={scale}
        x={offsetX}
        y={offsetY}
      >
        {/* Rooms layer — rects for rectangular rooms, closed polylines
            for L/T/U/traced shapes. No walls, openings, or cutouts
            rendered — the carrier needs spatial context for the pins,
            not a construction drawing. */}
        <Layer listening={false}>
          {rooms.map((room) => {
            const isPolygon = !!room.points && room.points.length >= 3;
            const fill = room.fill || "#faf7f2";
            const stroke = "#d9d4cd";
            if (isPolygon) {
              return (
                <Line
                  key={room.id}
                  points={room.points!.flatMap((p) => [p.x, p.y])}
                  closed
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={1.5 / scale}
                  perfectDrawEnabled={false}
                />
              );
            }
            return (
              <Rect
                key={room.id}
                x={room.x}
                y={room.y}
                width={room.width}
                height={room.height}
                fill={fill}
                stroke={stroke}
                strokeWidth={1.5 / scale}
                perfectDrawEnabled={false}
              />
            );
          })}
          {/* Room name labels — centered, small. Keeps the floor plan
              navigable without wall-level detail. */}
          {rooms.map((room) => {
            const cx = room.points && room.points.length >= 3
              ? polygonCentroid(room.points).x
              : room.x + room.width / 2;
            const cy = room.points && room.points.length >= 3
              ? polygonCentroid(room.points).y
              : room.y + room.height / 2;
            return (
              <Text
                key={`label-${room.id}`}
                x={cx - 60}
                y={cy - 8}
                width={120}
                align="center"
                text={room.name}
                fontSize={12 / scale}
                fill="#6b6560"
                listening={false}
              />
            );
          })}
        </Layer>

        {/* Pins layer — drawn atop rooms. Colors come from the snapshot
            date, not the backend's latest-reading `pin.color` field.
            Pins whose first reading is AFTER the snapshot date are
            hidden entirely — they didn't exist on the floor yet on
            that day, so showing them as neutral grey would misrepresent
            historical state. Brett §8.6: the snapshot is what the
            floor plan looked like at close of that day. */}
        {(() => {
          // Responsive pin sizing: on narrow canvases (mobile) the
          // fit-to-box scale shrinks room drawings, which also
          // shrinks the 13-unit pin radius visually (visual-px =
          // 13/scale × scale = 13). Technically correct, but 26px
          // diameter on a 320px mobile viewport feels huge. Cap
          // visual pin diameter smaller on mobile.
          const isNarrow = effectiveWidth < 500;
          const pinRadius = (isNarrow ? 9 : 13) / scale;
          const pinStroke = (isNarrow ? 1.5 : 2) / scale;
          const pinFontSize = (isNarrow ? 8 : 10) / scale;
          const textOffsetX = (isNarrow ? -10 : -14) / scale;
          const textOffsetY = (isNarrow ? -4 : -5) / scale;
          const textWidth = (isNarrow ? 20 : 28) / scale;
          return (
            <Layer listening={false}>
              {pins.map((pin) => {
                const readings = readingsByPinId.get(pin.id) ?? [];
                // Skip pins created after the snapshot date — the
                // earliest reading's local calendar day is the pin's
                // "born on" proxy (pins always ship with an initial
                // reading per the atomic create RPC).
                const earliestDate = readings.length
                  ? localDateFromTimestamp(readings[0].taken_at, jobTimezone)
                  : null;
                if (earliestDate && earliestDate > snapshotDate) return null;

                const color = computePinColorAsOf(
                  readings,
                  snapshotDate,
                  Number(pin.dry_standard),
                  jobTimezone,
                );
                const fill = color ? PIN_COLOR_HEX[color] : PIN_NO_DATA_HEX;
                const reading = readingAsOf(readings, snapshotDate, jobTimezone);
                const valueText = reading
                  ? String(Math.round(Number(reading.reading_value)))
                  : "—";
                const x = Number(pin.canvas_x);
                const y = Number(pin.canvas_y);
                return (
                  <Group key={pin.id} x={x} y={y}>
                    <Circle
                      radius={pinRadius}
                      fill={fill}
                      stroke="#ffffff"
                      strokeWidth={pinStroke}
                      perfectDrawEnabled={false}
                    />
                    <Text
                      x={textOffsetX}
                      y={textOffsetY}
                      width={textWidth}
                      align="center"
                      text={valueText}
                      fontSize={pinFontSize}
                      fontStyle="bold"
                      fill="#ffffff"
                      listening={false}
                    />
                  </Group>
                );
              })}
            </Layer>
          );
        })()}
      </Stage>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function computeBounds(
  rooms: ReadonlyArray<RoomData>,
): { x: number; y: number; w: number; h: number } | null {
  if (rooms.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rooms) {
    if (r.points && r.points.length >= 3) {
      for (const p of r.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    } else {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function polygonCentroid(
  points: ReadonlyArray<{ x: number; y: number }>,
): { x: number; y: number } {
  // Average of vertices — good enough for label placement. True
  // polygon centroid would be marginally better for concave shapes
  // but the tradeoff isn't worth the extra math for a static label.
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}
