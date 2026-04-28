// Floor plan tool definitions, types, and snap logic

export type ToolType =
  | "room"
  | "wall"
  | "door"
  | "window"
  | "opening"
  | "cutout"
  | "select"
  | "delete"
  | "trace"
  | "pin";

/** Floor opening (stairwell, HVAC shaft, elevator): a rectangular cutout
 *  inside a room that subtracts from its floor SF. Lives on the parent
 *  RoomData so SF math stays per-room. Persisted into
 *  `job_rooms.floor_openings` JSONB on save. */
export interface FloorOpeningData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Optional label for clarity in reports / the properties panel
   *  (e.g., "Stairwell", "HVAC Shaft", "Elevator"). */
  name?: string;
}

export interface RoomData {
  /** Canonical UUID. For rooms created post-fix (Spec 01H Phase 2),
   *  equal to ``propertyRoomId`` AT t=0 — same UUID, freshly drawn,
   *  about to commit. The equality is NOT a permanent invariant:
   *
   *    - Legacy rooms loaded from canvas_data predating the fix may
   *      have ``room_<timestamp>_<n>`` ids; those rooms carry their
   *      backend UUID separately in ``propertyRoomId``.
   *    - The same-name dedup branch in ``handleCreateRoom``
   *      (floor-plan/page.tsx) re-binds a freshly-drawn room's
   *      ``propertyRoomId`` to an existing same-name backend row's
   *      UUID via ``setRoomPropertyId``. After that re-bind,
   *      ``id !== propertyRoomId`` for that canvas room: ``id`` is
   *      the canvas-local identity (still the fresh ``newRoomUuid()``
   *      we minted at draw-time), ``propertyRoomId`` is the backend
   *      identity. All backend lookups (pin attribution, pin-follow,
   *      cross-floor visibility) MUST key on ``propertyRoomId``;
   *      anything keying on ``id`` for a backend lookup will silently
   *      misattribute on dedup-rebound rooms.
   *
   *  See ``newRoomUuid()`` below. */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  fill: string;
  /** Backend ``job_rooms.id`` UUID. Set at creation via
   *  ``newRoomUuid()`` for new rooms (matches ``id``); legacy rooms
   *  carry whatever value was backfilled at save time. The
   *  ``canvas-room-resolver`` no longer carries a name-match fallback
   *  — code that hits a ``RoomData`` with missing ``propertyRoomId``
   *  must log and skip rather than silently coercing to a guess
   *  (lesson #2). Stays optional on the type because hydration of
   *  pre-fix canvas_data may produce rooms without it; runtime code
   *  treats missing as "cannot resolve, skip." */
  propertyRoomId?: string;
  /** Polygon vertices in absolute canvas coordinates. When present, the room
   *  is rendered as a closed polygon and x/y/width/height are treated as the
   *  bounding box (derived). Rectangles may leave this undefined; the four
   *  corners are implied from x/y/width/height. */
  points?: Array<{ x: number; y: number }>;
  /** Rectangular cutouts in the room floor (stairwells etc.). Rendered as
   *  dashed white rectangles and subtracted from floor SF. Axis-aligned. */
  floor_openings?: FloorOpeningData[];
}

export interface WallData {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  roomId?: string;
  wallType?: "interior" | "exterior";
  affected?: boolean;
  /** Auto-set when this wall is collinear and overlapping with a wall of
   *  another room (E4 shared-wall detection). Shared walls are excluded from
   *  perimeter LF calculations and rendered with lighter line weight. */
  shared?: boolean;
  sharedWithRoomId?: string;
}

export interface DoorData {
  id: string;
  wallId: string;
  position: number; // 0-1 parametric
  width: number; // feet
  height?: number; // feet (default 7)
  swing: 0 | 1 | 2 | 3; // 4 quadrants: 0=hinge-left-swing-up, 1=hinge-left-swing-down, 2=hinge-right-swing-down, 3=hinge-right-swing-up
}

export interface WindowData {
  id: string;
  wallId: string;
  position: number;
  width: number;
  height?: number; // feet (default 4 for windows, 8 for openings)
}

export interface FloorPlanData {
  gridSize: number;
  rooms: RoomData[];
  walls: WallData[];
  doors: DoorData[];
  windows: WindowData[];
}

export function emptyFloorPlan(): FloorPlanData {
  return { gridSize: 10, rooms: [], walls: [], doors: [], windows: [] };
}

let _counter = 0;
export function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_counter}`;
}

/** Generate the canonical UUID for a brand-new canvas room.
 *
 *  Same value is used for BOTH ``RoomData.id`` (canvas-side identifier)
 *  AND ``RoomData.propertyRoomId`` (backend ``job_rooms.id``) — they're
 *  the same UUID from t=0, so there's no transient unsaved-room window
 *  where canvas-id and backend-id diverge. The backend ``create_room``
 *  endpoint accepts this UUID and INSERTs the row with it (idempotent
 *  on retry).
 *
 *  Why one UUID instead of two: pin attribution uses backend UUID
 *  (``moisture_pins.room_id``); canvas state uses canvas id; the
 *  ``canvas-room-resolver`` used to bridge them via name-match
 *  fallback during the unsaved-room window. With one UUID, name-match
 *  is unreachable — the resolver becomes pure ID lookup.
 *
 *  Uses ``crypto.randomUUID()`` (available in all browsers + Node 19+
 *  + every test runtime in this project). 122 bits of entropy makes
 *  collision across tenants statistically irrelevant.
 */
export function newRoomUuid(): string {
  return crypto.randomUUID();
}

export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/** Find nearest wall within `threshold` px of a point, return wall + parametric position */
export function findNearestWall(
  x: number,
  y: number,
  walls: WallData[],
  threshold = 20
): { wall: WallData; t: number; px: number; py: number } | null {
  let best: { wall: WallData; t: number; dist: number; px: number; py: number } | null = null;

  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;

    let t = ((x - w.x1) * dx + (y - w.y1) * dy) / lenSq;
    t = Math.max(0.05, Math.min(0.95, t)); // keep away from endpoints

    const px = w.x1 + t * dx;
    const py = w.y1 + t * dy;
    const dist = Math.hypot(x - px, y - py);

    if (dist < threshold && (!best || dist < best.dist)) {
      best = { wall: w, t, dist, px, py };
    }
  }

  return best ? { wall: best.wall, t: best.t, px: best.px, py: best.py } : null;
}

/** Snap endpoint magnetically to nearby wall endpoints */
export function snapEndpoint(
  x: number,
  y: number,
  walls: WallData[],
  threshold = 10,
  excludeWallId?: string
): { x: number; y: number; snapped: boolean } {
  for (const w of walls) {
    if (w.id === excludeWallId) continue;
    for (const pt of [
      { x: w.x1, y: w.y1 },
      { x: w.x2, y: w.y2 },
    ]) {
      if (Math.hypot(x - pt.x, y - pt.y) < threshold) {
        return { x: pt.x, y: pt.y, snapped: true };
      }
    }
  }
  return { x, y, snapped: false };
}

/** Create walls enclosing a room. Works for both rectangles (4 walls) and
 *  polygon rooms (N walls matching the N vertices — each edge of the polygon
 *  becomes one wall segment). */
export function wallsForRoom(room: RoomData): WallData[] {
  const pts = getRoomPoints(room);
  const base = uid("wall");
  return pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length];
    return {
      id: `${base}_${i}`,
      x1: p.x, y1: p.y,
      x2: next.x, y2: next.y,
      thickness: 4,
      roomId: room.id,
    };
  });
}

/** Get door position in canvas coordinates */
export function doorPosition(door: DoorData | WindowData, wall: WallData) {
  const px = wall.x1 + door.position * (wall.x2 - wall.x1);
  const py = wall.y1 + door.position * (wall.y2 - wall.y1);
  const angle = Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1);
  return { px, py, angle };
}

/** Project a point onto a wall segment, returning clamped parametric position */
export function projectOntoWall(mx: number, my: number, wall: WallData, margin = 0.1): number | null {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null;
  const t = ((mx - wall.x1) * dx + (my - wall.y1) * dy) / len2;
  return Math.max(margin, Math.min(1 - margin, t));
}

/* ------------------------------------------------------------------ */
/*  E3: Magnetic room-to-room snap                                     */
/* ------------------------------------------------------------------ */

/** Threshold (px) for magnetic snap during room drag. */
export const ROOM_SNAP_THRESHOLD_PX = 20;

/**
 * Compute the snapped (x, y) for a dragged room, aligning edges to nearby
 * rooms within ROOM_SNAP_THRESHOLD_PX. Checks four cases per axis:
 *   - dragged.left ↔ other.right (rooms touch side-by-side)
 *   - dragged.right ↔ other.left
 *   - dragged.left ↔ other.left (edges aligned, side-by-side)
 *   - dragged.right ↔ other.right
 * Equivalent rules for Y axis. Only runs when the other axis ranges overlap
 * — snapping to a room you're nowhere near would feel weird.
 */
export function magneticRoomSnap(
  draggedId: string,
  proposedX: number,
  proposedY: number,
  width: number,
  height: number,
  rooms: RoomData[],
): { x: number; y: number; snappedX: boolean; snappedY: boolean } {
  const T = ROOM_SNAP_THRESHOLD_PX;
  const others = rooms.filter((r) => r.id !== draggedId);
  let snapX = proposedX;
  let snapY = proposedY;
  let snappedX = false;
  let snappedY = false;

  const draggedLeft = proposedX;
  const draggedRight = proposedX + width;
  const draggedTop = proposedY;
  const draggedBottom = proposedY + height;

  for (const other of others) {
    const otherLeft = other.x;
    const otherRight = other.x + other.width;
    const otherTop = other.y;
    const otherBottom = other.y + other.height;

    // X-axis snap only when Y ranges overlap (rooms are vertically beside each other).
    // Only edge-to-edge candidates (left-to-right, right-to-left) — the
    // align-edges candidates would stick rooms sharing an X coordinate on
    // top of each other, guaranteeing overlap when yOverlap is true.
    const yOverlap = draggedBottom > otherTop && draggedTop < otherBottom;
    if (yOverlap && !snappedX) {
      const candidates: Array<[number, number]> = [
        [Math.abs(draggedLeft - otherRight), otherRight],
        [Math.abs(draggedRight - otherLeft), otherLeft - width],
      ];
      const best = candidates.reduce((min, c) => (c[0] < min[0] ? c : min));
      if (best[0] < T) {
        snapX = best[1];
        snappedX = true;
      }
    }

    // Y-axis snap only when X ranges overlap. Same edge-to-edge-only rule.
    const xOverlap = draggedRight > otherLeft && draggedLeft < otherRight;
    if (xOverlap && !snappedY) {
      const candidates: Array<[number, number]> = [
        [Math.abs(draggedTop - otherBottom), otherBottom],
        [Math.abs(draggedBottom - otherTop), otherTop - height],
      ];
      const best = candidates.reduce((min, c) => (c[0] < min[0] ? c : min));
      if (best[0] < T) {
        snapY = best[1];
        snappedY = true;
      }
    }
  }

  // Safety net: if the computed snap still overlaps any other room (e.g.
  // the dragged room is near a corner where two neighbors share edges),
  // drop the magnetic adjustment and return the un-snapped position so
  // the user's drag isn't forcibly pushed into an overlap.
  const finalLeft = snapX;
  const finalRight = snapX + width;
  const finalTop = snapY;
  const finalBottom = snapY + height;
  for (const other of others) {
    const otherLeft = other.x;
    const otherRight = other.x + other.width;
    const otherTop = other.y;
    const otherBottom = other.y + other.height;
    const overlapX = finalRight > otherLeft && finalLeft < otherRight;
    const overlapY = finalBottom > otherTop && finalTop < otherBottom;
    // Strictly overlapping area (not just touching): require positive overlap
    // in BOTH axes. Edge-to-edge contact has overlap=0 on one axis and is OK.
    const areaOverlap = (
      Math.min(finalRight, otherRight) - Math.max(finalLeft, otherLeft) > 0 &&
      Math.min(finalBottom, otherBottom) - Math.max(finalTop, otherTop) > 0
    );
    if (overlapX && overlapY && areaOverlap) {
      return { x: proposedX, y: proposedY, snappedX: false, snappedY: false };
    }
  }

  return { x: snapX, y: snapY, snappedX, snappedY };
}

/* ------------------------------------------------------------------ */
/*  E4: Shared wall auto-detection                                     */
/* ------------------------------------------------------------------ */

/**
 * For each wall attached to a room, detect if another room has a collinear,
 * overlapping wall. If yes, both walls are marked `shared=true` with a mutual
 * `sharedWithRoomId` pointer. Shared walls are counted only once in perimeter
 * LF calculations (one side bills; the other's LF is excluded).
 *
 * Returns a new walls array — call after any drag/resize that might change
 * adjacency. O(n²) over walls; fine for typical 30-50-wall floors.
 */
export function detectSharedWalls(walls: WallData[]): WallData[] {
  const EPS = 1; // coord tolerance — post-snap, walls should be pixel-exact

  return walls.map((wall) => {
    if (!wall.roomId) {
      // Standalone walls can't be shared with a room
      if (wall.shared || wall.sharedWithRoomId) {
        return { ...wall, shared: false, sharedWithRoomId: undefined };
      }
      return wall;
    }

    const isHorizontal = Math.abs(wall.y1 - wall.y2) < EPS;
    const isVertical = Math.abs(wall.x1 - wall.x2) < EPS;
    if (!isHorizontal && !isVertical) {
      // Only axis-aligned walls participate in shared detection for now
      if (wall.shared || wall.sharedWithRoomId) {
        return { ...wall, shared: false, sharedWithRoomId: undefined };
      }
      return wall;
    }

    const match = walls.find((other) => {
      if (other.id === wall.id) return false;
      if (!other.roomId) return false;
      if (other.roomId === wall.roomId) return false;

      if (isHorizontal) {
        // Must also be horizontal at same Y, with X-range overlap
        if (Math.abs(other.y1 - other.y2) >= EPS) return false;
        if (Math.abs(wall.y1 - other.y1) >= EPS) return false;
        const wMin = Math.min(wall.x1, wall.x2);
        const wMax = Math.max(wall.x1, wall.x2);
        const oMin = Math.min(other.x1, other.x2);
        const oMax = Math.max(other.x1, other.x2);
        return Math.min(wMax, oMax) - Math.max(wMin, oMin) > EPS;
      }

      // Vertical
      if (Math.abs(other.x1 - other.x2) >= EPS) return false;
      if (Math.abs(wall.x1 - other.x1) >= EPS) return false;
      const wMin = Math.min(wall.y1, wall.y2);
      const wMax = Math.max(wall.y1, wall.y2);
      const oMin = Math.min(other.y1, other.y2);
      const oMax = Math.max(other.y1, other.y2);
      return Math.min(wMax, oMax) - Math.max(wMin, oMin) > EPS;
    });

    if (match) {
      return { ...wall, shared: true, sharedWithRoomId: match.roomId };
    }
    // Clear if no longer shared (rooms moved apart)
    if (wall.shared || wall.sharedWithRoomId) {
      return { ...wall, shared: false, sharedWithRoomId: undefined };
    }
    return wall;
  });
}

export const TOOLS: Array<{ id: ToolType; label: string; icon: string; group: "draw" | "place" | "edit" }> = [
  { id: "room", label: "Room", icon: "rect", group: "draw" },
  { id: "trace", label: "Trace", icon: "trace", group: "draw" },
  { id: "wall", label: "Wall", icon: "line", group: "draw" },
  { id: "door", label: "Door", icon: "door", group: "place" },
  { id: "window", label: "Window", icon: "window", group: "place" },
  { id: "opening", label: "Opening", icon: "opening", group: "place" },
  { id: "cutout", label: "Cutout", icon: "cutout", group: "place" },
  // Pin: Moisture Mode primary action. Only surfaces when canvas is in
  // Moisture Mode (filtered via CANVAS_MODES.moisture.tools). Never shows
  // in Sketch Mode so Phase 1 users aren't confused by a tool they can't use.
  { id: "pin", label: "Pin", icon: "pin", group: "place" },
  { id: "select", label: "Select", icon: "pointer", group: "edit" },
  { id: "delete", label: "Delete", icon: "trash", group: "edit" },
];

/* ------------------------------------------------------------------ */
/*  Polygon helpers (E1 — unified rect + polygon room model)           */
/* ------------------------------------------------------------------ */

/** True when a room has `points` but those 4 vertices are still at the
 *  bbox corners — i.e. it's been converted to a polygon (so vertex-drag
 *  works) but the user hasn't actually deformed it into an L/T/U yet.
 *  These rooms should behave like rectangles for direct W × H editing. */
export function isRectangularPolygon(room: RoomData): boolean {
  if (!room.points || room.points.length !== 4) return false;
  const cornerKeys = new Set([
    `${room.x},${room.y}`,
    `${room.x + room.width},${room.y}`,
    `${room.x + room.width},${room.y + room.height}`,
    `${room.x},${room.y + room.height}`,
  ]);
  // Match by set (any permutation) — convertRoomToPolygon writes them in
  // a specific order but future flows shouldn't have to care about order.
  const pointKeys = new Set(room.points.map((p) => `${p.x},${p.y}`));
  if (pointKeys.size !== 4) return false;
  for (const key of cornerKeys) {
    if (!pointKeys.has(key)) return false;
  }
  return true;
}

/** Returns the room's vertices. For polygon rooms this is the stored points
 *  array; for rectangle rooms (no `points` set), derives the four corners. */
export function getRoomPoints(room: RoomData): Array<{ x: number; y: number }> {
  if (room.points && room.points.length >= 3) return room.points;
  return [
    { x: room.x, y: room.y },
    { x: room.x + room.width, y: room.y },
    { x: room.x + room.width, y: room.y + room.height },
    { x: room.x, y: room.y + room.height },
  ];
}

/** Shoelace formula — signed area in px². Positive if points are CCW,
 *  negative if CW. We take absolute value for SF calc. */
export function polygonArea(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Area-weighted centroid for correct label placement (especially on L-shapes
 *  where rectangular center would fall inside the notch). */
export function polygonCentroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length < 3) return { x: 0, y: 0 };
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
    a += cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) {
    // Degenerate polygon — fallback to average
    const avgX = points.reduce((s, p) => s + p.x, 0) / points.length;
    const avgY = points.reduce((s, p) => s + p.y, 0) / points.length;
    return { x: avgX, y: avgY };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Axis-aligned bounding box of a polygon. Used to keep RoomData's x/y/width/
 *  height fields in sync so existing rect-based code (thumbnails, hit testing,
 *  label sizing) keeps working even when a polygon is added. */
export function polygonBoundingBox(points: Array<{ x: number; y: number }>): {
  x: number; y: number; width: number; height: number;
} {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0].x, maxX = points[0].x;
  let minY = points[0].y, maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Returns flat [x1,y1,x2,y2,...] for Konva's Line component. */
export function polygonToKonvaPoints(points: Array<{ x: number; y: number }>): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}

/** Ray-casting point-in-polygon test. Used to determine which room (if any)
 *  a cutout placement falls inside. */
export function pointInPolygon(
  pt: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Floor area (SF) with cutouts subtracted. `gridSize` = pixels per foot.
 *  Used for Xactimate quantity accuracy — stairwells and HVAC shafts reduce
 *  the billable floor square footage. */
export function roomFloorArea(room: RoomData, gridSize: number): number {
  const pts = getRoomPoints(room);
  const areaPx = polygonArea(pts);
  const cutoutsPx = (room.floor_openings ?? []).reduce(
    (sum, o) => sum + Math.abs(o.width * o.height),
    0,
  );
  const net = Math.max(0, areaPx - cutoutsPx);
  return net / (gridSize * gridSize);
}
