// Floor plan tool definitions, types, and snap logic

export type ToolType = "room" | "wall" | "door" | "window" | "select" | "delete";

export interface RoomData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  fill: string;
  propertyRoomId?: string; // links to property_rooms.id — avoids name-based matching
}

export interface WallData {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  roomId?: string;
}

export interface DoorData {
  id: string;
  wallId: string;
  position: number; // 0-1 parametric
  width: number; // feet
  swing: 0 | 1 | 2 | 3; // 4 quadrants: 0=hinge-left-swing-up, 1=hinge-left-swing-down, 2=hinge-right-swing-down, 3=hinge-right-swing-up
}

export interface WindowData {
  id: string;
  wallId: string;
  position: number;
  width: number;
}

export interface FloorPlanData {
  gridSize: number;
  rooms: RoomData[];
  walls: WallData[];
  doors: DoorData[];
  windows: WindowData[];
}

export function emptyFloorPlan(): FloorPlanData {
  return { gridSize: 20, rooms: [], walls: [], doors: [], windows: [] };
}

let _counter = 0;
export function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_counter}`;
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

/** Create 4 walls for a room rectangle */
export function wallsForRoom(room: RoomData): WallData[] {
  const { x, y, width, height, id } = room;
  const base = uid("wall");
  return [
    { id: `${base}_t`, x1: x, y1: y, x2: x + width, y2: y, thickness: 4, roomId: id },
    { id: `${base}_r`, x1: x + width, y1: y, x2: x + width, y2: y + height, thickness: 4, roomId: id },
    { id: `${base}_b`, x1: x + width, y1: y + height, x2: x, y2: y + height, thickness: 4, roomId: id },
    { id: `${base}_l`, x1: x, y1: y + height, x2: x, y2: y, thickness: 4, roomId: id },
  ];
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

export const TOOLS: Array<{ id: ToolType; label: string; icon: string; group: "draw" | "place" | "edit" }> = [
  { id: "room", label: "Room", icon: "rect", group: "draw" },
  { id: "wall", label: "Wall", icon: "line", group: "draw" },
  { id: "door", label: "Door", icon: "door", group: "place" },
  { id: "window", label: "Window", icon: "window", group: "place" },
  { id: "select", label: "Select", icon: "pointer", group: "edit" },
  { id: "delete", label: "Delete", icon: "trash", group: "edit" },
];
