/**
 * Display helper for moisture pin locations after the Phase 2 location
 * split (migration `e2b3c4d5f6a7`). Replaces the old denormalized
 * `pin.location_name` string with a derived label composed from the
 * structured fields (`surface`, `position`, `wall_segment_id`) plus the
 * host room's name and walls.
 *
 * Single source of truth: every consumer (canvas pin label, edit sheet
 * header, reading sheet header, moisture report summary table, public
 * adjuster portal) calls this. When wall labels graduate from "directional
 * compass" to user-friendly names, this is the only file that changes.
 *
 * Output shape, by surface:
 *   floor   → "Floor, Center, Kitchen"           (position always present)
 *   wall    + segment → "North wall, Kitchen"    (compass-derived)
 *   wall    no segment → "Wall, Kitchen"         (draft state — picker pending)
 *   ceiling → "Ceiling, Northeast, Kitchen"      (position always present)
 *
 * Position is required on the type (DB NOT NULL after migration
 * e3c4d5f6a7b8) so floor + ceiling always carry a position word. Wall
 * keeps the compass-derived label since the wall_segment_id picker is
 * the meaningful disambiguator for that surface — position on a wall
 * pin still rides in the data but the label deliberately doesn't show
 * it twice.
 *
 * Wall direction is derived from geometry — wall midpoint relative to
 * room centroid via arctan2, bucketed into 8 compass directions. This
 * is meaningful regardless of polygon shape (rectangle, L-shape,
 * pentagon all work) because every wall has stable midpoint coords on
 * the canvas.
 *
 * Defensive on inputs: any missing piece falls back gracefully so a
 * stale cache or partial fixture doesn't render `undefined, undefined`
 * in the UI.
 */

import type { MoisturePin, MoisturePosition } from "./types";

/** Minimal wall shape this helper needs. Both backend `WallLike` and
 *  canvas `WallData` satisfy it — keeps the helper agnostic to the
 *  caller's wall source (relational rows vs. JSONB-derived canvas data). */
export interface WallLike {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const POSITION_LABEL: Record<MoisturePosition, string> = {
  C: "Center",
  NW: "Northwest",
  NE: "Northeast",
  SW: "Southwest",
  SE: "Southeast",
};

/** Eight-point compass bucketed from arctan2 (radians). Order matters —
 *  N is centered on -π/2 because canvas y grows downward (screen coords),
 *  so a wall midpoint with y < centroid.y reads as "north." */
const COMPASS_LABELS = [
  "East",
  "Southeast",
  "South",
  "Southwest",
  "West",
  "Northwest",
  "North",
  "Northeast",
] as const;

/** Optional polygon vertex shape passed by callers that have access to
 *  the room's outline. When absent, walls' own midpoints are used as an
 *  approximation of the centroid (works fine for convex shapes). */
export interface RoomPolygonVertex {
  x: number;
  y: number;
}

/**
 * Derive the compass label for a wall from its midpoint relative to
 * the room centroid.
 *
 * Returns `null` when geometry can't be computed (no centroid resolvable
 * from the inputs) — caller renders the un-directioned fallback.
 */
function compassLabelForWall(
  wall: Pick<WallLike, "x1" | "y1" | "x2" | "y2">,
  centroid: RoomPolygonVertex | null,
): string | null {
  if (!centroid) return null;
  const midX = (wall.x1 + wall.x2) / 2;
  const midY = (wall.y1 + wall.y2) / 2;
  const dx = midX - centroid.x;
  const dy = midY - centroid.y;
  if (dx === 0 && dy === 0) return null;
  // arctan2 returns radians in (-π, π]. Normalize to [0, 2π) then bucket
  // into 8 octants of π/4 each. We rotate by π/8 first so each octant
  // straddles the cardinal direction (N covers -π/2 ± π/8, etc.).
  const angle = Math.atan2(dy, dx);
  const normalized = (angle + Math.PI * 2 + Math.PI / 8) % (Math.PI * 2);
  const idx = Math.floor(normalized / (Math.PI / 4));
  return COMPASS_LABELS[idx] ?? null;
}

function centroidFromPolygon(
  polygon: RoomPolygonVertex[] | null | undefined,
): RoomPolygonVertex | null {
  if (!polygon || polygon.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const v of polygon) {
    sx += v.x;
    sy += v.y;
  }
  return { x: sx / polygon.length, y: sy / polygon.length };
}

function centroidFromWalls(
  walls: WallLike[] | null | undefined,
): RoomPolygonVertex | null {
  if (!walls || walls.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (const w of walls) {
    sx += (w.x1 + w.x2) / 2;
    sy += (w.y1 + w.y2) / 2;
    count += 1;
  }
  if (count === 0) return null;
  return { x: sx / count, y: sy / count };
}

export interface FormatPinLocationContext {
  /** Display name of the host room. Falls back to "Unknown room" when missing. */
  roomName?: string | null;
  /** All walls in the host room — looked up by id when surface=wall and
   *  pin.wall_segment_id is set. Order/count irrelevant; works for any
   *  polygon shape. */
  walls?: WallLike[] | null;
  /** Optional polygon outline of the room. When provided, used for the
   *  compass-direction centroid; otherwise centroid is approximated from
   *  wall midpoints. Both produce sensible results; the polygon is
   *  slightly more accurate for non-convex shapes (L-shape, T-shape). */
  roomPolygon?: RoomPolygonVertex[] | null;
}

/**
 * Compose a human-readable location string for a moisture pin.
 *
 * Pure function — no React, no formatting locale, no exceptions. Safe to
 * call from snapshot tests, server components, or storybook fixtures.
 */
export function formatPinLocation(
  pin: Pick<MoisturePin, "surface" | "position" | "wall_segment_id">,
  context: FormatPinLocationContext = {},
): string {
  const room = context.roomName?.trim() || "Unknown room";

  switch (pin.surface) {
    case "floor":
      return `Floor, ${POSITION_LABEL[pin.position]}, ${room}`;
    case "ceiling":
      // Same 5-value position enum as floor — the tech picks one
      // quadrant on the placement sheet. NOT NULL on the column means
      // we always have a value to render.
      return `Ceiling, ${POSITION_LABEL[pin.position]}, ${room}`;
    case "wall": {
      // Draft state (no segment picked yet — picker UX hasn't shipped):
      // render bare "Wall, Room" so the tech still sees the room.
      if (!pin.wall_segment_id) return `Wall, ${room}`;
      const wall = context.walls?.find((w) => w.id === pin.wall_segment_id);
      if (!wall) {
        // Wall reference exists but the wall itself isn't in the loaded
        // room (room data lagged behind, or wall was deleted). Fall back
        // to the un-directioned label rather than rendering "undefined."
        return `Wall, ${room}`;
      }
      const centroid =
        centroidFromPolygon(context.roomPolygon) ?? centroidFromWalls(context.walls);
      const compass = compassLabelForWall(wall, centroid);
      return compass ? `${compass} wall, ${room}` : `Wall, ${room}`;
    }
    default:
      // Defensive: should be unreachable thanks to the MoistureSurface
      // type, but a stale cached pin shape (e.g., from a downgrade
      // window) shouldn't crash the render.
      return room;
  }
}
