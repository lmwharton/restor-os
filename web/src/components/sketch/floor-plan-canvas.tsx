"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface RoomShape {
  id: string;
  name: string;
  vertices: { x: number; y: number }[];
  color: string;
}

interface Door {
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number; // in pixels (world coords)
  swing: "left" | "right";
}

interface Window_ {
  id: string;
  wallId: string;
  position: number;
  width: number;
}

interface Opening {
  id: string;
  wallId: string;
  position: number;
  width: number;
}

interface Label {
  id: string;
  x: number;
  y: number;
  text: string;
}

type ShapeKind = "rectangle" | "circle" | "line" | "triangle" | "ellipse" | "polygon";

interface Shape {
  id: string;
  kind: ShapeKind;
  // Bounding box (world coords) for rectangle/ellipse/triangle/circle
  x: number;
  y: number;
  width: number;
  height: number;
  // For polygon: vertices; for line: 2 points
  points?: { x: number; y: number }[];
  strokeColor?: string;
  fillColor?: string;
}

interface CanvasData {
  walls: Wall[];
  rooms: RoomShape[];
  doors: Door[];
  windows: Window_[];
  openings: Opening[];
  labels: Label[];
  shapes: Shape[];
  scale: number;
  offset: { x: number; y: number };
}

type Tool = "wall" | "door" | "window" | "opening" | "label" | "select" | "erase" | "undo" | "rectangle" | "circle" | "line" | "triangle" | "ellipse" | "polygon";

interface FloorPlanCanvasProps {
  canvasData?: Record<string, unknown> | null;
  onSave: (canvasData: Record<string, unknown>) => void;
  onCleanup: (canvasData: Record<string, unknown>) => Promise<Record<string, unknown>>;
  floorName: string;
  readOnly?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SNAP_DISTANCE = 20;
const WALL_STROKE = 3;
const DEFAULT_SCALE = 24; // px per foot
const DOOR_DEFAULT_WIDTH = 3 * DEFAULT_SCALE; // 3ft = 36 inches in world coords
const WINDOW_DEFAULT_WIDTH = 3 * DEFAULT_SCALE; // 3ft
const OPENING_DEFAULT_WIDTH = 4 * DEFAULT_SCALE; // 4ft

const ROOM_COLORS = [
  "rgba(232, 93, 38, 0.10)",  // orange
  "rgba(0, 98, 142, 0.10)",   // blue
  "rgba(46, 125, 50, 0.10)",  // green
  "rgba(142, 36, 170, 0.10)", // purple
  "rgba(191, 150, 0, 0.10)",  // gold
];

const COLORS = {
  grid: "#f0e6e0",
  wall: "#1f1b17",
  wallSelected: "#e85d26",
  roomLabel: "#594139",
  dimension: "#8d7168",
  activeToolHighlight: "#e85d26",
  background: "#fff8f4",
  snapIndicator: "#e85d26",
  drawPreview: "#8d7168",
  door: "#e85d26",
  window: "#00628e",
  opening: "#594139",
  label: "#594139",
  shape: "#8d7168",
  shapeFill: "rgba(232, 93, 38, 0.06)",
  shapeSelected: "#e85d26",
} as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function wallLength(w: Wall, scale: number): number {
  return distance(w.x1, w.y1, w.x2, w.y2) / scale;
}

function formatFeet(ft: number): string {
  if (ft < 0.1) return "";
  return `${ft.toFixed(1)} ft`;
}

function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(px, py, x1, y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(px, py, x1 + t * dx, y1 + t * dy);
}

/** Get the parametric t value (0-1) of the closest point on a wall segment */
function getParametricPosition(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0.1, Math.min(0.9, t)); // clamp so doors/windows aren't at wall ends
  return t;
}

/** Get world position along a wall at parametric t */
function getWallPositionAt(wall: Wall, t: number): { x: number; y: number } {
  return {
    x: wall.x1 + (wall.x2 - wall.x1) * t,
    y: wall.y1 + (wall.y2 - wall.y1) * t,
  };
}

/** Get wall direction vector (normalized) */
function getWallDirection(wall: Wall): { dx: number; dy: number } {
  const len = distance(wall.x1, wall.y1, wall.x2, wall.y2);
  if (len === 0) return { dx: 1, dy: 0 };
  return {
    dx: (wall.x2 - wall.x1) / len,
    dy: (wall.y2 - wall.y1) / len,
  };
}

function findSnapPoint(
  x: number,
  y: number,
  walls: Wall[],
  excludeWallId?: string
): { x: number; y: number; snapped: boolean } {
  let closest = { x, y, snapped: false };
  let minDist = SNAP_DISTANCE;

  for (const w of walls) {
    if (w.id === excludeWallId) continue;
    for (const pt of [
      { x: w.x1, y: w.y1 },
      { x: w.x2, y: w.y2 },
    ]) {
      const d = distance(x, y, pt.x, pt.y);
      if (d < minDist) {
        minDist = d;
        closest = { x: pt.x, y: pt.y, snapped: true };
      }
    }
  }
  return closest;
}

/** Simple cycle detection for room formation */
function detectRooms(walls: Wall[]): RoomShape[] {
  if (walls.length < 3) return [];

  // Build adjacency from endpoints (snapped within threshold)
  const THRESHOLD = 5;
  type Node = string;

  function nodeKey(x: number, y: number): Node {
    // Round to threshold grid
    const rx = Math.round(x / THRESHOLD) * THRESHOLD;
    const ry = Math.round(y / THRESHOLD) * THRESHOLD;
    return `${rx},${ry}`;
  }

  const adj = new Map<Node, Set<Node>>();
  const nodePos = new Map<Node, { x: number; y: number }>();

  function addEdge(n1: Node, p1: { x: number; y: number }, n2: Node, p2: { x: number; y: number }) {
    if (!adj.has(n1)) adj.set(n1, new Set());
    if (!adj.has(n2)) adj.set(n2, new Set());
    adj.get(n1)!.add(n2);
    adj.get(n2)!.add(n1);
    nodePos.set(n1, p1);
    nodePos.set(n2, p2);
  }

  for (const w of walls) {
    const n1 = nodeKey(w.x1, w.y1);
    const n2 = nodeKey(w.x2, w.y2);
    if (n1 !== n2) {
      addEdge(n1, { x: w.x1, y: w.y1 }, n2, { x: w.x2, y: w.y2 });
    }
  }

  // Find minimal cycles using DFS (limit to small cycles for performance)
  const rooms: RoomShape[] = [];
  const foundCycles = new Set<string>();

  function dfs(
    start: Node,
    current: Node,
    path: Node[],
    visited: Set<Node>,
    depth: number
  ) {
    if (depth > 8) return; // limit cycle length
    const neighbors = adj.get(current);
    if (!neighbors) return;

    for (const next of neighbors) {
      if (next === start && path.length >= 3) {
        // Found a cycle
        const sorted = [...path].sort().join("|");
        if (!foundCycles.has(sorted)) {
          foundCycles.add(sorted);
          const vertices = path.map((n) => nodePos.get(n)!);
          rooms.push({
            id: generateId(),
            name: `Room ${rooms.length + 1}`,
            vertices,
            color: ROOM_COLORS[rooms.length % ROOM_COLORS.length],
          });
        }
        return;
      }
      if (!visited.has(next)) {
        visited.add(next);
        path.push(next);
        dfs(start, next, path, visited, depth + 1);
        path.pop();
        visited.delete(next);
      }
    }
  }

  for (const node of adj.keys()) {
    const visited = new Set<Node>([node]);
    dfs(node, node, [node], visited, 0);
  }

  return rooms;
}

function parseCanvasData(raw: Record<string, unknown> | null | undefined): CanvasData {
  if (!raw) {
    return {
      walls: [],
      rooms: [],
      doors: [],
      windows: [],
      openings: [],
      labels: [],
      shapes: [],
      scale: DEFAULT_SCALE,
      offset: { x: 0, y: 0 },
    };
  }
  return {
    walls: (raw.walls as Wall[]) || [],
    rooms: (raw.rooms as RoomShape[]) || [],
    doors: (raw.doors as Door[]) || [],
    windows: (raw.windows as Window_[]) || [],
    openings: (raw.openings as Opening[]) || [],
    labels: (raw.labels as Label[]) || [],
    shapes: (raw.shapes as Shape[]) || [],
    scale: (raw.scale as number) || DEFAULT_SCALE,
    offset: (raw.offset as { x: number; y: number }) || { x: 0, y: 0 },
  };
}

/** Check if a point is near a wall-attached element (door/window/opening) */
function hitTestWallElement(
  px: number,
  py: number,
  wall: Wall,
  position: number,
  width: number,
  threshold: number
): boolean {
  const pos = getWallPositionAt(wall, position);
  const d = distance(px, py, pos.x, pos.y);
  return d < Math.max(threshold, width / 2);
}

/** Hit test a shape: returns true if point (px,py) in world coords is near the shape */
function hitTestShape(px: number, py: number, shape: Shape, threshold: number): boolean {
  if (shape.kind === "line" && shape.points && shape.points.length >= 2) {
    return pointToSegmentDistance(px, py, shape.points[0].x, shape.points[0].y, shape.points[1].x, shape.points[1].y) < threshold;
  }
  if (shape.kind === "polygon" && shape.points && shape.points.length >= 2) {
    // Check if near any edge of the polygon
    for (let i = 0; i < shape.points.length; i++) {
      const j = (i + 1) % shape.points.length;
      if (pointToSegmentDistance(px, py, shape.points[i].x, shape.points[i].y, shape.points[j].x, shape.points[j].y) < threshold) return true;
    }
    // Also check if inside the polygon (ray casting)
    let inside = false;
    const pts = shape.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if (((pts[i].y > py) !== (pts[j].y > py)) && (px < (pts[j].x - pts[i].x) * (py - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x)) {
        inside = !inside;
      }
    }
    return inside;
  }
  // Bounding box shapes: check if point is inside or near the border
  const x1 = Math.min(shape.x, shape.x + shape.width);
  const y1 = Math.min(shape.y, shape.y + shape.height);
  const x2 = Math.max(shape.x, shape.x + shape.width);
  const y2 = Math.max(shape.y, shape.y + shape.height);
  // Inside the shape
  if (px >= x1 - threshold && px <= x2 + threshold && py >= y1 - threshold && py <= y2 + threshold) return true;
  return false;
}

const SHAPE_TOOLS: Tool[] = ["rectangle", "circle", "line", "triangle", "ellipse", "polygon"];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function FloorPlanCanvas({
  canvasData: initialData,
  onSave,
  onCleanup,
  floorName,
  readOnly = false,
}: FloorPlanCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // State
  const [walls, setWalls] = useState<Wall[]>(() => parseCanvasData(initialData).walls);
  const [rooms, setRooms] = useState<RoomShape[]>(() => parseCanvasData(initialData).rooms);
  const [doors, setDoors] = useState<Door[]>(() => parseCanvasData(initialData).doors);
  const [windows, setWindows] = useState<Window_[]>(() => parseCanvasData(initialData).windows);
  const [openings, setOpenings] = useState<Opening[]>(() => parseCanvasData(initialData).openings);
  const [labels, setLabels] = useState<Label[]>(() => parseCanvasData(initialData).labels);
  const [shapes, setShapes] = useState<Shape[]>(() => parseCanvasData(initialData).shapes);
  const [scale, setScale] = useState(() => parseCanvasData(initialData).scale);
  const [offset, setOffset] = useState(() => parseCanvasData(initialData).offset);
  const [tool, setTool] = useState<Tool>("wall");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<CanvasData[]>([]);
  const [isCleaning, setIsCleaning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [toolCategory, setToolCategory] = useState<"structure" | "shapes" | "annotate" | "actions">("structure");

  // Label editing state
  const [editingLabel, setEditingLabel] = useState<{ id: string; x: number; y: number; text: string } | null>(null);
  const [labelInputPos, setLabelInputPos] = useState<{ x: number; y: number } | null>(null);

  // Room name editing state
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingRoomName, setEditingRoomName] = useState("");
  const [roomNameInputPos, setRoomNameInputPos] = useState<{ x: number; y: number } | null>(null);

  // Custom room names (persisted)
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});

  // Drawing state refs (not in React state to avoid re-renders during draw)
  const drawingRef = useRef<{
    isDrawing: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    snappedStart: boolean;
  }>({
    isDrawing: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    snappedStart: false,
  });

  // Pan state
  const panRef = useRef<{
    isPanning: boolean;
    lastX: number;
    lastY: number;
    pointerCount: number;
    pointers: Map<number, { x: number; y: number }>;
    initialPinchDistance: number | null;
    initialScale: number;
  }>({
    isPanning: false,
    lastX: 0,
    lastY: 0,
    pointerCount: 0,
    pointers: new Map(),
    initialPinchDistance: null,
    initialScale: DEFAULT_SCALE,
  });

  // Select/drag state
  const dragRef = useRef<{
    isDragging: boolean;
    wallId: string | null;
    dragEndpoint: "start" | "end" | "whole" | null;
    offsetX: number;
    offsetY: number;
    // For dragging labels
    labelId: string | null;
    labelOffsetX: number;
    labelOffsetY: number;
  }>({
    isDragging: false,
    wallId: null,
    dragEndpoint: null,
    offsetX: 0,
    offsetY: 0,
    labelId: null,
    labelOffsetX: 0,
    labelOffsetY: 0,
  });

  // Shape drawing state
  const shapeDrawRef = useRef<{
    isDrawing: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    polygonPoints: { x: number; y: number }[];
    isPolygonStarted: boolean;
  }>({
    isDrawing: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    polygonPoints: [],
    isPolygonStarted: false,
  });

  // Selected shape for select tool
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);

  /* ---------------------------------------------------------------- */
  /*  Canvas-to-world coordinate transforms                            */
  /* ---------------------------------------------------------------- */

  const canvasToWorld = useCallback(
    (cx: number, cy: number) => ({
      x: (cx - offset.x) / (scale / DEFAULT_SCALE),
      y: (cy - offset.y) / (scale / DEFAULT_SCALE),
    }),
    [offset, scale]
  );

  const worldToCanvas = useCallback(
    (wx: number, wy: number) => ({
      x: wx * (scale / DEFAULT_SCALE) + offset.x,
      y: wy * (scale / DEFAULT_SCALE) + offset.y,
    }),
    [offset, scale]
  );

  /* ---------------------------------------------------------------- */
  /*  Serialize current state                                          */
  /* ---------------------------------------------------------------- */

  const getCurrentData = useCallback((): CanvasData => {
    return { walls, rooms, doors, windows, openings, labels, shapes, scale, offset };
  }, [walls, rooms, doors, windows, openings, labels, shapes, scale, offset]);

  /* ---------------------------------------------------------------- */
  /*  Save undo snapshot                                               */
  /* ---------------------------------------------------------------- */

  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [
      ...prev,
      { walls, rooms, doors, windows, openings, labels, shapes, scale, offset },
    ]);
  }, [walls, rooms, doors, windows, openings, labels, shapes, scale, offset]);

  /* ---------------------------------------------------------------- */
  /*  Render loop                                                      */
  /* ---------------------------------------------------------------- */

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    const ratio = scale / DEFAULT_SCALE;

    // Clear
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    // Grid
    const gridSpacing = scale;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    const startX = offset.x % gridSpacing;
    const startY = offset.y % gridSpacing;
    ctx.beginPath();
    for (let x = startX; x < width; x += gridSpacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = startY; y < height; y += gridSpacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Rooms (filled polygons)
    for (const room of rooms) {
      if (room.vertices.length < 3) continue;
      ctx.beginPath();
      const first = worldToCanvas(room.vertices[0].x, room.vertices[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < room.vertices.length; i++) {
        const pt = worldToCanvas(room.vertices[i].x, room.vertices[i].y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fillStyle = room.color;
      ctx.fill();

      // Room label
      const cx =
        room.vertices.reduce((sum, v) => sum + v.x, 0) / room.vertices.length;
      const cy =
        room.vertices.reduce((sum, v) => sum + v.y, 0) / room.vertices.length;
      const labelPos = worldToCanvas(cx, cy);
      ctx.fillStyle = COLORS.roomLabel;
      ctx.font = `600 13px var(--font-geist-sans), sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const displayName = roomNames[room.id] || room.name;
      ctx.fillText(displayName, labelPos.x, labelPos.y);
    }

    // Build a set of wall segments that need to be broken by doors/windows/openings
    // We'll collect break info per wall, then draw walls with gaps
    const wallBreaks = new Map<string, { t: number; halfWidth: number; type: "door" | "window" | "opening"; element: Door | Window_ | Opening }[]>();

    for (const door of doors) {
      if (!wallBreaks.has(door.wallId)) wallBreaks.set(door.wallId, []);
      const wall = walls.find((w) => w.id === door.wallId);
      if (!wall) continue;
      const wallLen = distance(wall.x1, wall.y1, wall.x2, wall.y2);
      const halfW = wallLen > 0 ? (door.width / 2) / wallLen : 0;
      wallBreaks.get(door.wallId)!.push({ t: door.position, halfWidth: halfW, type: "door", element: door });
    }

    for (const win of windows) {
      if (!wallBreaks.has(win.wallId)) wallBreaks.set(win.wallId, []);
      const wall = walls.find((w) => w.id === win.wallId);
      if (!wall) continue;
      const wallLen = distance(wall.x1, wall.y1, wall.x2, wall.y2);
      const halfW = wallLen > 0 ? (win.width / 2) / wallLen : 0;
      wallBreaks.get(win.wallId)!.push({ t: win.position, halfWidth: halfW, type: "window", element: win });
    }

    for (const op of openings) {
      if (!wallBreaks.has(op.wallId)) wallBreaks.set(op.wallId, []);
      const wall = walls.find((w) => w.id === op.wallId);
      if (!wall) continue;
      const wallLen = distance(wall.x1, wall.y1, wall.x2, wall.y2);
      const halfW = wallLen > 0 ? (op.width / 2) / wallLen : 0;
      wallBreaks.get(op.wallId)!.push({ t: op.position, halfWidth: halfW, type: "opening", element: op });
    }

    // Walls - draw with gaps for doors/windows/openings
    for (const wall of walls) {
      const p1 = worldToCanvas(wall.x1, wall.y1);
      const p2 = worldToCanvas(wall.x2, wall.y2);
      const isSelected = wall.id === selectedWallId;
      const strokeColor = isSelected ? COLORS.wallSelected : COLORS.wall;

      const breaks = wallBreaks.get(wall.id);
      if (breaks && breaks.length > 0) {
        // Sort breaks by position
        const sortedBreaks = [...breaks].sort((a, b) => a.t - b.t);

        // Draw wall segments between breaks
        let currentT = 0;
        for (const brk of sortedBreaks) {
          const segStart = currentT;
          const segEnd = Math.max(segStart, brk.t - brk.halfWidth);

          if (segEnd > segStart + 0.001) {
            const s1 = worldToCanvas(
              wall.x1 + (wall.x2 - wall.x1) * segStart,
              wall.y1 + (wall.y2 - wall.y1) * segStart
            );
            const s2 = worldToCanvas(
              wall.x1 + (wall.x2 - wall.x1) * segEnd,
              wall.y1 + (wall.y2 - wall.y1) * segEnd
            );
            ctx.beginPath();
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = WALL_STROKE * ratio;
            ctx.lineCap = "round";
            ctx.stroke();
          }

          currentT = Math.min(1, brk.t + brk.halfWidth);
        }

        // Draw remaining segment after last break
        if (currentT < 1 - 0.001) {
          const s1 = worldToCanvas(
            wall.x1 + (wall.x2 - wall.x1) * currentT,
            wall.y1 + (wall.y2 - wall.y1) * currentT
          );
          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = WALL_STROKE * ratio;
          ctx.lineCap = "round";
          ctx.stroke();
        }
      } else {
        // No breaks, draw full wall
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = WALL_STROKE * ratio;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      // Dimension label
      const len = wallLength(wall, DEFAULT_SCALE);
      const label = formatFeet(len);
      if (label) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        // Offset label above the wall
        const labelOffsetX = -Math.sin(angle) * 14;
        const labelOffsetY = Math.cos(angle) * 14;

        ctx.save();
        ctx.fillStyle = COLORS.dimension;
        ctx.font = `11px var(--font-geist-mono), monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, mx + labelOffsetX, my - labelOffsetY);
        ctx.restore();
      }

      // Endpoints (small circles) when selected
      if (isSelected) {
        for (const pt of [p1, p2]) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = COLORS.wallSelected;
          ctx.fill();
        }
      }
    }

    // Draw doors
    for (const door of doors) {
      const wall = walls.find((w) => w.id === door.wallId);
      if (!wall) continue;

      const dir = getWallDirection(wall);
      const pos = getWallPositionAt(wall, door.position);
      const halfGap = (door.width / 2);

      // Gap edge positions in world coords
      const gapStart = {
        x: pos.x - dir.dx * halfGap,
        y: pos.y - dir.dy * halfGap,
      };
      const gapEnd = {
        x: pos.x + dir.dx * halfGap,
        y: pos.y + dir.dy * halfGap,
      };

      const gapStartCanvas = worldToCanvas(gapStart.x, gapStart.y);
      const gapEndCanvas = worldToCanvas(gapEnd.x, gapEnd.y);

      // Draw arc swing indicator
      const arcRadius = door.width * ratio;
      const pivotCanvas = door.swing === "left" ? gapStartCanvas : gapEndCanvas;

      // Calculate arc angles
      const wallAngle = Math.atan2(dir.dy, dir.dx);
      let arcStart: number;
      let arcEnd: number;

      if (door.swing === "left") {
        // Arc from the gap start, sweeping perpendicular
        arcStart = wallAngle;
        arcEnd = wallAngle - Math.PI / 2;
      } else {
        // Arc from the gap end, sweeping perpendicular
        arcStart = wallAngle + Math.PI;
        arcEnd = wallAngle + Math.PI + Math.PI / 2;
      }

      ctx.beginPath();
      ctx.arc(pivotCanvas.x, pivotCanvas.y, arcRadius, arcStart, arcEnd, door.swing === "left");
      ctx.strokeStyle = COLORS.door;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw the door line (from pivot to end of arc)
      const doorLineEndX = pivotCanvas.x + Math.cos(arcEnd) * arcRadius;
      const doorLineEndY = pivotCanvas.y + Math.sin(arcEnd) * arcRadius;
      ctx.beginPath();
      ctx.moveTo(pivotCanvas.x, pivotCanvas.y);
      ctx.lineTo(doorLineEndX, doorLineEndY);
      ctx.strokeStyle = COLORS.door;
      ctx.lineWidth = 2 * ratio;
      ctx.stroke();

      // Small dots at gap edges
      for (const gp of [gapStartCanvas, gapEndCanvas]) {
        ctx.beginPath();
        ctx.arc(gp.x, gp.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.door;
        ctx.fill();
      }
    }

    // Draw windows
    for (const win of windows) {
      const wall = walls.find((w) => w.id === win.wallId);
      if (!wall) continue;

      const dir = getWallDirection(wall);
      const pos = getWallPositionAt(wall, win.position);
      const halfGap = win.width / 2;

      // Gap edge positions
      const gapStart = {
        x: pos.x - dir.dx * halfGap,
        y: pos.y - dir.dy * halfGap,
      };
      const gapEnd = {
        x: pos.x + dir.dx * halfGap,
        y: pos.y + dir.dy * halfGap,
      };

      const gapStartCanvas = worldToCanvas(gapStart.x, gapStart.y);
      const gapEndCanvas = worldToCanvas(gapEnd.x, gapEnd.y);

      // Normal perpendicular to wall
      const nx = -dir.dy;
      const ny = dir.dx;
      const perpOffset = 4 * ratio; // distance of parallel lines from wall center

      // Draw two parallel lines perpendicular spread across the gap
      for (const sign of [-1, 1]) {
        const offsetX = nx * perpOffset * sign;
        const offsetY = ny * perpOffset * sign;

        const lineStart = {
          x: gapStartCanvas.x + offsetX,
          y: gapStartCanvas.y + offsetY,
        };
        const lineEnd = {
          x: gapEndCanvas.x + offsetX,
          y: gapEndCanvas.y + offsetY,
        };

        ctx.beginPath();
        ctx.moveTo(lineStart.x, lineStart.y);
        ctx.lineTo(lineEnd.x, lineEnd.y);
        ctx.strokeStyle = COLORS.window;
        ctx.lineWidth = 2 * ratio;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    // Draw openings (just gaps - the wall drawing already handles them)
    // We draw small tick marks at the gap edges for visual clarity
    for (const op of openings) {
      const wall = walls.find((w) => w.id === op.wallId);
      if (!wall) continue;

      const dir = getWallDirection(wall);
      const pos = getWallPositionAt(wall, op.position);
      const halfGap = op.width / 2;

      const gapStart = {
        x: pos.x - dir.dx * halfGap,
        y: pos.y - dir.dy * halfGap,
      };
      const gapEnd = {
        x: pos.x + dir.dx * halfGap,
        y: pos.y + dir.dy * halfGap,
      };

      const gapStartCanvas = worldToCanvas(gapStart.x, gapStart.y);
      const gapEndCanvas = worldToCanvas(gapEnd.x, gapEnd.y);

      // Normal perpendicular to wall
      const nx = -dir.dy;
      const ny = dir.dx;
      const tickLen = 6 * ratio;

      // Small perpendicular ticks at gap edges
      for (const gp of [gapStartCanvas, gapEndCanvas]) {
        ctx.beginPath();
        ctx.moveTo(gp.x - nx * tickLen, gp.y - ny * tickLen);
        ctx.lineTo(gp.x + nx * tickLen, gp.y + ny * tickLen);
        ctx.strokeStyle = COLORS.opening;
        ctx.lineWidth = 1.5;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    // Draw labels
    for (const lbl of labels) {
      const canvasPos = worldToCanvas(lbl.x, lbl.y);
      ctx.fillStyle = COLORS.label;
      ctx.font = `500 14px var(--font-geist-sans), sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lbl.text, canvasPos.x, canvasPos.y);
    }

    // Draw shapes
    for (const shape of shapes) {
      const isSelected = shape.id === selectedShapeId;
      const stroke = isSelected ? COLORS.shapeSelected : (shape.strokeColor || COLORS.shape);
      const fill = shape.fillColor || COLORS.shapeFill;

      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5 * ratio;
      ctx.fillStyle = fill;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (shape.kind === "rectangle") {
        const tl = worldToCanvas(shape.x, shape.y);
        const br = worldToCanvas(shape.x + shape.width, shape.y + shape.height);
        const w = br.x - tl.x;
        const h = br.y - tl.y;
        ctx.fillRect(tl.x, tl.y, w, h);
        ctx.strokeRect(tl.x, tl.y, w, h);
      } else if (shape.kind === "circle") {
        const cx = shape.x + shape.width / 2;
        const cy = shape.y + shape.height / 2;
        const center = worldToCanvas(cx, cy);
        const r = Math.abs(shape.width / 2) * ratio;
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (shape.kind === "ellipse") {
        const cx = shape.x + shape.width / 2;
        const cy = shape.y + shape.height / 2;
        const center = worldToCanvas(cx, cy);
        const rx = Math.abs(shape.width / 2) * ratio;
        const ry = Math.abs(shape.height / 2) * ratio;
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, rx || 1, ry || 1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (shape.kind === "triangle") {
        // Equilateral-ish triangle inscribed in bounding box
        const tl = worldToCanvas(shape.x, shape.y);
        const br = worldToCanvas(shape.x + shape.width, shape.y + shape.height);
        const topMid = { x: (tl.x + br.x) / 2, y: tl.y };
        const botLeft = { x: tl.x, y: br.y };
        const botRight = { x: br.x, y: br.y };
        ctx.beginPath();
        ctx.moveTo(topMid.x, topMid.y);
        ctx.lineTo(botRight.x, botRight.y);
        ctx.lineTo(botLeft.x, botLeft.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (shape.kind === "line" && shape.points && shape.points.length >= 2) {
        const p1 = worldToCanvas(shape.points[0].x, shape.points[0].y);
        const p2 = worldToCanvas(shape.points[1].x, shape.points[1].y);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      } else if (shape.kind === "polygon" && shape.points && shape.points.length >= 2) {
        ctx.beginPath();
        const first = worldToCanvas(shape.points[0].x, shape.points[0].y);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < shape.points.length; i++) {
          const pt = worldToCanvas(shape.points[i].x, shape.points[i].y);
          ctx.lineTo(pt.x, pt.y);
        }
        if (shape.points.length >= 3) {
          ctx.closePath();
          ctx.fill();
        }
        ctx.stroke();
      }

      // Selection handles
      if (isSelected) {
        if (shape.kind === "line" && shape.points && shape.points.length >= 2) {
          for (const pt of shape.points) {
            const cp = worldToCanvas(pt.x, pt.y);
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.shapeSelected;
            ctx.fill();
          }
        } else if (shape.kind === "polygon" && shape.points) {
          for (const pt of shape.points) {
            const cp = worldToCanvas(pt.x, pt.y);
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.shapeSelected;
            ctx.fill();
          }
        } else {
          // Draw corner handles for bounding-box shapes
          const corners = [
            { x: shape.x, y: shape.y },
            { x: shape.x + shape.width, y: shape.y },
            { x: shape.x + shape.width, y: shape.y + shape.height },
            { x: shape.x, y: shape.y + shape.height },
          ];
          for (const c of corners) {
            const cp = worldToCanvas(c.x, c.y);
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.shapeSelected;
            ctx.fill();
          }
        }
      }

      ctx.restore();
    }

    // Shape drawing preview
    const sd = shapeDrawRef.current;
    if (sd.isDrawing && !sd.isPolygonStarted) {
      const stroke = COLORS.shape;
      const fill = COLORS.shapeFill;
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5 * ratio;
      ctx.fillStyle = fill;
      ctx.setLineDash([6, 4]);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const activeTool = tool;
      if (activeTool === "rectangle") {
        const tl = worldToCanvas(Math.min(sd.startX, sd.currentX), Math.min(sd.startY, sd.currentY));
        const br = worldToCanvas(Math.max(sd.startX, sd.currentX), Math.max(sd.startY, sd.currentY));
        ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      } else if (activeTool === "circle") {
        const cx = (sd.startX + sd.currentX) / 2;
        const cy = (sd.startY + sd.currentY) / 2;
        const center = worldToCanvas(cx, cy);
        const r = Math.abs(sd.currentX - sd.startX) / 2 * ratio;
        ctx.beginPath();
        ctx.arc(center.x, center.y, r || 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (activeTool === "ellipse") {
        const cx = (sd.startX + sd.currentX) / 2;
        const cy = (sd.startY + sd.currentY) / 2;
        const center = worldToCanvas(cx, cy);
        const rx = Math.abs(sd.currentX - sd.startX) / 2 * ratio;
        const ry = Math.abs(sd.currentY - sd.startY) / 2 * ratio;
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, rx || 1, ry || 1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (activeTool === "triangle") {
        const minX = Math.min(sd.startX, sd.currentX);
        const minY = Math.min(sd.startY, sd.currentY);
        const maxX = Math.max(sd.startX, sd.currentX);
        const maxY = Math.max(sd.startY, sd.currentY);
        const tl = worldToCanvas(minX, minY);
        const br = worldToCanvas(maxX, maxY);
        const topMid = { x: (tl.x + br.x) / 2, y: tl.y };
        ctx.beginPath();
        ctx.moveTo(topMid.x, topMid.y);
        ctx.lineTo(br.x, br.y);
        ctx.lineTo(tl.x, br.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (activeTool === "line") {
        const p1 = worldToCanvas(sd.startX, sd.startY);
        const p2 = worldToCanvas(sd.currentX, sd.currentY);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Polygon drawing preview (in-progress vertices)
    if (sd.isPolygonStarted && sd.polygonPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = COLORS.shape;
      ctx.lineWidth = 1.5 * ratio;
      ctx.fillStyle = COLORS.shapeFill;
      ctx.setLineDash([6, 4]);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      const first = worldToCanvas(sd.polygonPoints[0].x, sd.polygonPoints[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < sd.polygonPoints.length; i++) {
        const pt = worldToCanvas(sd.polygonPoints[i].x, sd.polygonPoints[i].y);
        ctx.lineTo(pt.x, pt.y);
      }
      // Line to current mouse position
      const cur = worldToCanvas(sd.currentX, sd.currentY);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw vertex dots
      for (const pt of sd.polygonPoints) {
        const cp = worldToCanvas(pt.x, pt.y);
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.shape;
        ctx.fill();
      }

      // Highlight first point when close (to indicate close-ability)
      if (sd.polygonPoints.length >= 3) {
        const d0 = distance(sd.currentX, sd.currentY, sd.polygonPoints[0].x, sd.polygonPoints[0].y);
        if (d0 < 15) {
          const fp = worldToCanvas(sd.polygonPoints[0].x, sd.polygonPoints[0].y);
          ctx.beginPath();
          ctx.arc(fp.x, fp.y, 8, 0, Math.PI * 2);
          ctx.strokeStyle = COLORS.shapeSelected;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    // Drawing preview line
    const d = drawingRef.current;
    if (d.isDrawing) {
      const pp1 = worldToCanvas(d.startX, d.startY);
      const pp2 = worldToCanvas(d.currentX, d.currentY);
      ctx.beginPath();
      ctx.moveTo(pp1.x, pp1.y);
      ctx.lineTo(pp2.x, pp2.y);
      ctx.strokeStyle = COLORS.drawPreview;
      ctx.lineWidth = WALL_STROKE * ratio;
      ctx.lineCap = "round";
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Snap indicator
      const snap = findSnapPoint(d.currentX, d.currentY, walls);
      if (snap.snapped) {
        const sp = worldToCanvas(snap.x, snap.y);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.snapIndicator;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, [walls, rooms, doors, windows, openings, labels, shapes, scale, offset, selectedWallId, selectedShapeId, worldToCanvas, roomNames, tool]);

  /* ---------------------------------------------------------------- */
  /*  Resize observer                                                  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      render();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    return () => observer.disconnect();
  }, [render]);

  // Re-render on state changes
  useEffect(() => {
    render();
  }, [render]);

  // Recalculate rooms when walls change
  useEffect(() => {
    const detected = detectRooms(walls);
    setRooms(detected);
  }, [walls]);

  // Sync mobile category tab with active tool
  useEffect(() => {
    if (["wall", "door", "window", "opening"].includes(tool)) setToolCategory("structure");
    else if (SHAPE_TOOLS.includes(tool)) setToolCategory("shapes");
    else if (tool === "label") setToolCategory("annotate");
    else if (["select", "erase"].includes(tool)) setToolCategory("actions");
  }, [tool]);

  /* ---------------------------------------------------------------- */
  /*  Pointer event handlers                                           */
  /* ---------------------------------------------------------------- */

  const getPointerPos = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      return canvasToWorld(cx, cy);
    },
    [canvasToWorld]
  );

  /** Get canvas pixel position from pointer event */
  const getCanvasPixelPos = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (readOnly) return;

      const pan = panRef.current;
      pan.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pan.pointerCount = pan.pointers.size;

      // Two-finger pan/zoom
      if (pan.pointerCount >= 2) {
        drawingRef.current.isDrawing = false;
        pan.isPanning = true;
        const pts = Array.from(pan.pointers.values());
        pan.initialPinchDistance = distance(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
        pan.initialScale = scale;
        pan.lastX = (pts[0].x + pts[1].x) / 2;
        pan.lastY = (pts[0].y + pts[1].y) / 2;
        return;
      }

      const pos = getPointerPos(e);
      const canvasPixel = getCanvasPixelPos(e);

      if (tool === "wall") {
        const snap = findSnapPoint(pos.x, pos.y, walls);
        const ref = drawingRef.current;
        ref.isDrawing = true;
        ref.startX = snap.x;
        ref.startY = snap.y;
        ref.currentX = snap.x;
        ref.currentY = snap.y;
        ref.snappedStart = snap.snapped;
      } else if (tool === "door" || tool === "window" || tool === "opening") {
        // Find closest wall to place element on
        let closestWall: Wall | null = null;
        let closestDist = 20;
        for (const w of walls) {
          const d = pointToSegmentDistance(pos.x, pos.y, w.x1, w.y1, w.x2, w.y2);
          if (d < closestDist) {
            closestDist = d;
            closestWall = w;
          }
        }

        if (closestWall) {
          // Check if we're tapping an existing element of same type to toggle/flip
          if (tool === "door") {
            const existingDoor = doors.find((d) => {
              const wall = walls.find((w) => w.id === d.wallId);
              if (!wall) return false;
              return hitTestWallElement(pos.x, pos.y, wall, d.position, d.width, 15);
            });
            if (existingDoor) {
              // Flip swing direction
              setDoors((prev) =>
                prev.map((d) =>
                  d.id === existingDoor.id
                    ? { ...d, swing: d.swing === "left" ? "right" : "left" }
                    : d
                )
              );
              return;
            }
          }

          const t = getParametricPosition(
            pos.x, pos.y,
            closestWall.x1, closestWall.y1,
            closestWall.x2, closestWall.y2
          );

          pushUndo();

          if (tool === "door") {
            setDoors((prev) => [
              ...prev,
              {
                id: generateId(),
                wallId: closestWall!.id,
                position: t,
                width: DOOR_DEFAULT_WIDTH,
                swing: "left",
              },
            ]);
          } else if (tool === "window") {
            setWindows((prev) => [
              ...prev,
              {
                id: generateId(),
                wallId: closestWall!.id,
                position: t,
                width: WINDOW_DEFAULT_WIDTH,
              },
            ]);
          } else if (tool === "opening") {
            setOpenings((prev) => [
              ...prev,
              {
                id: generateId(),
                wallId: closestWall!.id,
                position: t,
                width: OPENING_DEFAULT_WIDTH,
              },
            ]);
          }
        }
      } else if (tool === "label") {
        // Place a new label or edit existing one
        const existingLabel = labels.find((lbl) => {
          return distance(pos.x, pos.y, lbl.x, lbl.y) < 20;
        });

        if (existingLabel) {
          // Edit existing label
          const canvasPos = worldToCanvas(existingLabel.x, existingLabel.y);
          setEditingLabel(existingLabel);
          setLabelInputPos({ x: canvasPos.x, y: canvasPos.y });
        } else {
          // New label
          setEditingLabel({ id: generateId(), x: pos.x, y: pos.y, text: "" });
          setLabelInputPos({ x: canvasPixel.x, y: canvasPixel.y });
        }
      } else if (tool === "select") {
        // Check if tapping on a room label to edit name
        for (const room of rooms) {
          if (room.vertices.length < 3) continue;
          const cx = room.vertices.reduce((sum, v) => sum + v.x, 0) / room.vertices.length;
          const cy = room.vertices.reduce((sum, v) => sum + v.y, 0) / room.vertices.length;
          if (distance(pos.x, pos.y, cx, cy) < 20) {
            const canvasPos = worldToCanvas(cx, cy);
            setEditingRoomId(room.id);
            setEditingRoomName(roomNames[room.id] || room.name);
            setRoomNameInputPos({ x: canvasPos.x, y: canvasPos.y });
            return;
          }
        }

        // Check if tapping on a label to drag it
        for (const lbl of labels) {
          if (distance(pos.x, pos.y, lbl.x, lbl.y) < 20) {
            const drag = dragRef.current;
            drag.isDragging = true;
            drag.labelId = lbl.id;
            drag.labelOffsetX = pos.x - lbl.x;
            drag.labelOffsetY = pos.y - lbl.y;
            setSelectedShapeId(null);
            return;
          }
        }

        // Check if tapping on a shape to select/drag it
        for (const shape of [...shapes].reverse()) {
          if (hitTestShape(pos.x, pos.y, shape, 15)) {
            setSelectedShapeId(shape.id);
            setSelectedWallId(null);
            const drag = dragRef.current;
            drag.isDragging = true;
            drag.wallId = null;
            drag.labelId = null;
            // Store shape drag offset
            drag.offsetX = pos.x - shape.x;
            drag.offsetY = pos.y - shape.y;
            return;
          }
        }

        // Find closest wall
        let closestId: string | null = null;
        let closestDist = 15;
        for (const w of walls) {
          const d = pointToSegmentDistance(pos.x, pos.y, w.x1, w.y1, w.x2, w.y2);
          if (d < closestDist) {
            closestDist = d;
            closestId = w.id;
          }
        }
        setSelectedWallId(closestId);
        setSelectedShapeId(null);

        if (closestId) {
          const wall = walls.find((w) => w.id === closestId)!;
          // Check if near an endpoint
          const dStart = distance(pos.x, pos.y, wall.x1, wall.y1);
          const dEnd = distance(pos.x, pos.y, wall.x2, wall.y2);
          const drag = dragRef.current;
          drag.isDragging = true;
          drag.wallId = closestId;

          if (dStart < 15) {
            drag.dragEndpoint = "start";
            drag.offsetX = 0;
            drag.offsetY = 0;
          } else if (dEnd < 15) {
            drag.dragEndpoint = "end";
            drag.offsetX = 0;
            drag.offsetY = 0;
          } else {
            drag.dragEndpoint = "whole";
            drag.offsetX = pos.x - wall.x1;
            drag.offsetY = pos.y - wall.y1;
          }
        }
      } else if (tool === "erase") {
        // Check shapes first
        for (const shape of [...shapes].reverse()) {
          if (hitTestShape(pos.x, pos.y, shape, 15)) {
            pushUndo();
            setShapes((prev) => prev.filter((s) => s.id !== shape.id));
            return;
          }
        }

        // Check doors
        for (const door of doors) {
          const wall = walls.find((w) => w.id === door.wallId);
          if (!wall) continue;
          if (hitTestWallElement(pos.x, pos.y, wall, door.position, door.width, 15)) {
            pushUndo();
            setDoors((prev) => prev.filter((d) => d.id !== door.id));
            return;
          }
        }

        // Check windows
        for (const win of windows) {
          const wall = walls.find((w) => w.id === win.wallId);
          if (!wall) continue;
          if (hitTestWallElement(pos.x, pos.y, wall, win.position, win.width, 15)) {
            pushUndo();
            setWindows((prev) => prev.filter((w) => w.id !== win.id));
            return;
          }
        }

        // Check openings
        for (const op of openings) {
          const wall = walls.find((w) => w.id === op.wallId);
          if (!wall) continue;
          if (hitTestWallElement(pos.x, pos.y, wall, op.position, op.width, 15)) {
            pushUndo();
            setOpenings((prev) => prev.filter((o) => o.id !== op.id));
            return;
          }
        }

        // Check labels
        for (const lbl of labels) {
          if (distance(pos.x, pos.y, lbl.x, lbl.y) < 20) {
            pushUndo();
            setLabels((prev) => prev.filter((l) => l.id !== lbl.id));
            return;
          }
        }

        // Check walls (and delete attached elements)
        let closestId: string | null = null;
        let closestDist = 15;
        for (const w of walls) {
          const d = pointToSegmentDistance(pos.x, pos.y, w.x1, w.y1, w.x2, w.y2);
          if (d < closestDist) {
            closestDist = d;
            closestId = w.id;
          }
        }
        if (closestId) {
          pushUndo();
          setWalls((prev) => prev.filter((w) => w.id !== closestId));
          // Cascade delete attached elements
          setDoors((prev) => prev.filter((d) => d.wallId !== closestId));
          setWindows((prev) => prev.filter((w) => w.wallId !== closestId));
          setOpenings((prev) => prev.filter((o) => o.wallId !== closestId));
        }
      } else if (tool === "polygon") {
        // Polygon: click to add vertex, close when near first point
        const sd = shapeDrawRef.current;
        if (!sd.isPolygonStarted) {
          // Start a new polygon
          sd.isPolygonStarted = true;
          sd.polygonPoints = [{ x: pos.x, y: pos.y }];
          sd.currentX = pos.x;
          sd.currentY = pos.y;
          render();
        } else {
          // Check if close to first point to finish
          if (sd.polygonPoints.length >= 3 && distance(pos.x, pos.y, sd.polygonPoints[0].x, sd.polygonPoints[0].y) < 15) {
            // Close the polygon
            pushUndo();
            const pts = [...sd.polygonPoints];
            // Compute bounding box
            const xs = pts.map((p) => p.x);
            const ys = pts.map((p) => p.y);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);
            setShapes((prev) => [
              ...prev,
              {
                id: generateId(),
                kind: "polygon",
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                points: pts,
              },
            ]);
            sd.isPolygonStarted = false;
            sd.polygonPoints = [];
            render();
          } else {
            // Add vertex
            sd.polygonPoints.push({ x: pos.x, y: pos.y });
            render();
          }
        }
      } else if (tool === "rectangle" || tool === "circle" || tool === "line" || tool === "triangle" || tool === "ellipse") {
        // Start shape drawing (rectangle, circle, line, triangle, ellipse)
        const sd = shapeDrawRef.current;
        sd.isDrawing = true;
        sd.startX = pos.x;
        sd.startY = pos.y;
        sd.currentX = pos.x;
        sd.currentY = pos.y;
      }
    },
    [readOnly, tool, walls, doors, windows, openings, labels, shapes, rooms, roomNames, scale, getPointerPos, getCanvasPixelPos, worldToCanvas, pushUndo, render]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (readOnly) return;

      const pan = panRef.current;
      pan.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Pinch zoom/pan
      if (pan.isPanning && pan.pointerCount >= 2) {
        const pts = Array.from(pan.pointers.values());
        if (pts.length >= 2) {
          const currentDist = distance(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
          if (pan.initialPinchDistance) {
            const ratio = currentDist / pan.initialPinchDistance;
            const newScale = Math.max(8, Math.min(96, pan.initialScale * ratio));
            setScale(newScale);
          }
          const midX = (pts[0].x + pts[1].x) / 2;
          const midY = (pts[0].y + pts[1].y) / 2;
          const dx = midX - pan.lastX;
          const dy = midY - pan.lastY;
          setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
          pan.lastX = midX;
          pan.lastY = midY;
        }
        return;
      }

      const pos = getPointerPos(e);

      if (tool === "wall" && drawingRef.current.isDrawing) {
        const snap = findSnapPoint(pos.x, pos.y, walls);
        drawingRef.current.currentX = snap.x;
        drawingRef.current.currentY = snap.y;
        render();
      } else if ((tool === "rectangle" || tool === "circle" || tool === "line" || tool === "triangle" || tool === "ellipse") && shapeDrawRef.current.isDrawing) {
        shapeDrawRef.current.currentX = pos.x;
        shapeDrawRef.current.currentY = pos.y;
        render();
      } else if (tool === "polygon" && shapeDrawRef.current.isPolygonStarted) {
        shapeDrawRef.current.currentX = pos.x;
        shapeDrawRef.current.currentY = pos.y;
        render();
      } else if (tool === "select" && dragRef.current.isDragging) {
        const drag = dragRef.current;

        // Dragging a label
        if (drag.labelId) {
          setLabels((prev) =>
            prev.map((lbl) =>
              lbl.id === drag.labelId
                ? { ...lbl, x: pos.x - drag.labelOffsetX, y: pos.y - drag.labelOffsetY }
                : lbl
            )
          );
          return;
        }

        // Dragging a shape
        if (selectedShapeId && !drag.wallId && !drag.labelId) {
          const dx = pos.x - drag.offsetX;
          const dy = pos.y - drag.offsetY;
          setShapes((prev) =>
            prev.map((s) => {
              if (s.id !== selectedShapeId) return s;
              const deltaX = dx - s.x;
              const deltaY = dy - s.y;
              const updated = { ...s, x: dx, y: dy };
              // Also shift points for polygon/line
              if (s.points) {
                updated.points = s.points.map((p) => ({ x: p.x + deltaX, y: p.y + deltaY }));
              }
              return updated;
            })
          );
          return;
        }

        // Dragging a wall
        if (!drag.wallId) return;

        setWalls((prev) =>
          prev.map((w) => {
            if (w.id !== drag.wallId) return w;
            const snap = findSnapPoint(pos.x, pos.y, walls, w.id);
            if (drag.dragEndpoint === "start") {
              return { ...w, x1: snap.x, y1: snap.y };
            } else if (drag.dragEndpoint === "end") {
              return { ...w, x2: snap.x, y2: snap.y };
            } else {
              const dx = w.x2 - w.x1;
              const dy = w.y2 - w.y1;
              const nx = pos.x - drag.offsetX;
              const ny = pos.y - drag.offsetY;
              return { ...w, x1: nx, y1: ny, x2: nx + dx, y2: ny + dy };
            }
          })
        );
      }
    },
    [readOnly, tool, walls, selectedShapeId, getPointerPos, render]
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const pan = panRef.current;
      pan.pointers.delete(e.pointerId);
      pan.pointerCount = pan.pointers.size;

      if (pan.pointerCount < 2) {
        pan.isPanning = false;
        pan.initialPinchDistance = null;
      }

      if (tool === "wall" && drawingRef.current.isDrawing) {
        const d = drawingRef.current;
        d.isDrawing = false;
        const len = distance(d.startX, d.startY, d.currentX, d.currentY);
        if (len > 5) {
          pushUndo();
          setWalls((prev) => [
            ...prev,
            {
              id: generateId(),
              x1: d.startX,
              y1: d.startY,
              x2: d.currentX,
              y2: d.currentY,
            },
          ]);
        }
        render();
      }

      // Finalize shape drawing (not polygon - that uses click-to-add)
      if ((tool === "rectangle" || tool === "circle" || tool === "line" || tool === "triangle" || tool === "ellipse") && shapeDrawRef.current.isDrawing) {
        const sd = shapeDrawRef.current;
        sd.isDrawing = false;
        const len = distance(sd.startX, sd.startY, sd.currentX, sd.currentY);
        if (len > 5) {
          pushUndo();
          if (tool === "line") {
            setShapes((prev) => [
              ...prev,
              {
                id: generateId(),
                kind: "line",
                x: Math.min(sd.startX, sd.currentX),
                y: Math.min(sd.startY, sd.currentY),
                width: Math.abs(sd.currentX - sd.startX),
                height: Math.abs(sd.currentY - sd.startY),
                points: [
                  { x: sd.startX, y: sd.startY },
                  { x: sd.currentX, y: sd.currentY },
                ],
              },
            ]);
          } else {
            const x = Math.min(sd.startX, sd.currentX);
            const y = Math.min(sd.startY, sd.currentY);
            const w = Math.abs(sd.currentX - sd.startX);
            const h = Math.abs(sd.currentY - sd.startY);
            setShapes((prev) => [
              ...prev,
              {
                id: generateId(),
                kind: tool as ShapeKind,
                x,
                y,
                width: tool === "circle" ? Math.max(w, h) : w,
                height: tool === "circle" ? Math.max(w, h) : h,
              },
            ]);
          }
        }
        render();
      }

      if (tool === "select") {
        dragRef.current.isDragging = false;
        dragRef.current.wallId = null;
        dragRef.current.labelId = null;
        dragRef.current.offsetX = 0;
        dragRef.current.offsetY = 0;
      }
    },
    [tool, render, pushUndo]
  );

  /* ---------------------------------------------------------------- */
  /*  Wheel zoom                                                       */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
      const newScale = Math.max(8, Math.min(96, scale * zoomFactor));
      const scaleRatio = newScale / scale;

      setOffset((prev) => ({
        x: mx - (mx - prev.x) * scaleRatio,
        y: my - (my - prev.y) * scaleRatio,
      }));
      setScale(newScale);
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [scale]);

  /* ---------------------------------------------------------------- */
  /*  Actions                                                          */
  /* ---------------------------------------------------------------- */

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setWalls(prev.walls);
    setDoors(prev.doors);
    setWindows(prev.windows);
    setOpenings(prev.openings);
    setLabels(prev.labels);
    setShapes(prev.shapes);
  }, [undoStack]);

  const handleClearAll = useCallback(() => {
    if (walls.length === 0 && doors.length === 0 && windows.length === 0 && openings.length === 0 && labels.length === 0 && shapes.length === 0) return;
    pushUndo();
    setWalls([]);
    setDoors([]);
    setWindows([]);
    setOpenings([]);
    setLabels([]);
    setShapes([]);
    setSelectedWallId(null);
    setSelectedShapeId(null);
  }, [walls, doors, windows, openings, labels, shapes, pushUndo]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      onSave(getCurrentData() as unknown as Record<string, unknown>);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1500);
    } finally {
      setSaving(false);
    }
  }, [onSave, getCurrentData]);

  const handleCleanup = useCallback(async () => {
    setIsCleaning(true);
    try {
      const result = await onCleanup(
        getCurrentData() as unknown as Record<string, unknown>
      );
      const cleaned = parseCanvasData(result);
      pushUndo();
      setWalls(cleaned.walls);
      setDoors(cleaned.doors);
      setWindows(cleaned.windows);
      setOpenings(cleaned.openings);
      setLabels(cleaned.labels);
      // Preserve shapes — cleanup API only returns walls/rooms/scale/offset,
      // so cleaned.shapes would be empty. Keep user-drawn shapes intact.
      setScale(cleaned.scale);
      setOffset(cleaned.offset);
    } catch {
      // Cleanup failed -- keep current state
    } finally {
      setIsCleaning(false);
    }
  }, [onCleanup, getCurrentData, pushUndo]);

  /** Submit label text (new or edit) */
  const handleLabelSubmit = useCallback(
    (text: string) => {
      if (!editingLabel) return;
      const trimmed = text.trim();
      if (trimmed) {
        const exists = labels.find((l) => l.id === editingLabel.id);
        if (exists) {
          // Edit existing
          setLabels((prev) =>
            prev.map((l) => (l.id === editingLabel.id ? { ...l, text: trimmed } : l))
          );
        } else {
          // New label
          pushUndo();
          setLabels((prev) => [
            ...prev,
            { id: editingLabel.id, x: editingLabel.x, y: editingLabel.y, text: trimmed },
          ]);
        }
      }
      setEditingLabel(null);
      setLabelInputPos(null);
    },
    [editingLabel, labels, pushUndo]
  );

  /** Submit room name edit */
  const handleRoomNameSubmit = useCallback(
    (name: string) => {
      if (!editingRoomId) return;
      const trimmed = name.trim();
      if (trimmed) {
        setRoomNames((prev) => ({ ...prev, [editingRoomId]: trimmed }));
      }
      setEditingRoomId(null);
      setEditingRoomName("");
      setRoomNameInputPos(null);
    },
    [editingRoomId]
  );

  /* ---------------------------------------------------------------- */
  /*  Toolbar                                                          */
  /* ---------------------------------------------------------------- */

  const tools: { id: Tool | "clear" | "divider"; label: string; icon: React.ReactNode }[] = [
    // Structural tools
    {
      id: "wall",
      label: "Wall",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M4 20L20 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: "door",
      label: "Door",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M3 21V3h7v18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10 3a11 11 0 010 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2.5" />
          <circle cx="8" cy="12" r="1" fill="currentColor" />
        </svg>
      ),
    },
    {
      id: "window",
      label: "Window",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <rect x="4" y="5" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="1.5" />
          <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
    },
    {
      id: "opening",
      label: "Opening",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M4 4v16M20 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 3" />
        </svg>
      ),
    },
    // Divider
    { id: "divider" as Tool | "clear" | "divider", label: "", icon: null },
    // Shape tools
    {
      id: "rectangle",
      label: "Rect",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <rect x="4" y="6" width="16" height="12" rx="1" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ),
    },
    {
      id: "circle",
      label: "Circle",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ),
    },
    {
      id: "triangle",
      label: "Tri",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M12 4L21 20H3L12 4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: "ellipse",
      label: "Ellipse",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <ellipse cx="12" cy="12" rx="9" ry="6" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ),
    },
    {
      id: "line",
      label: "Line",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M5 19L19 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: "polygon",
      label: "Poly",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M12 3L20 9L18 18H6L4 9L12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      ),
    },
    // Divider
    { id: "divider" as Tool | "clear" | "divider", label: "", icon: null },
    // Annotation
    {
      id: "label",
      label: "Label",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M5 7V5h14v2M12 5v14M9 19h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    // Divider
    { id: "divider" as Tool | "clear" | "divider", label: "", icon: null },
    // Actions
    {
      id: "select",
      label: "Select",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M5 3l14 9-7 1.5L10 21z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: "erase",
      label: "Erase",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M19 20H5M18 8l-8 8-4-4 8-8 4 4z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: "undo",
      label: "Undo",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M3 10h12a5 5 0 010 10H9M3 10l4-4M3 10l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: "clear",
      label: "Clear",
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M3 6h18M8 6V4h8v2M5 6v14h14V6M10 10v8M14 10v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  const elementCount = doors.length + windows.length + openings.length + labels.length + shapes.length;

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Top bar */}
      <div className="relative flex items-center justify-between px-2 py-2 sm:px-4 sm:py-3 border-b border-outline-variant/40 bg-surface-container-low">
        {/* Save */}
        <button
          type="button"
          onClick={handleSave}
          disabled={readOnly || saving}
          className="flex items-center gap-1 sm:gap-1.5 px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-[12px] sm:text-[13px] font-semibold transition-all duration-200 bg-on-surface text-surface hover:bg-on-surface/90 disabled:opacity-40 cursor-pointer"
        >
          {saving ? (
            <span className="animate-spin w-4 h-4 border-2 border-surface border-t-transparent rounded-full" />
          ) : (
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" stroke="currentColor" strokeWidth="1.8" />
              <path d="M17 21v-8H7v8M7 3v5h8" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          )}
          <span className="hidden sm:inline">{saveFlash ? "Saved" : "Save"}</span>
        </button>

        {/* Floor name */}
        <span className="absolute left-1/2 -translate-x-1/2 text-[11px] sm:text-[13px] font-semibold text-on-surface-variant font-[family-name:var(--font-geist-mono)] tracking-wide uppercase">
          {floorName}
        </span>

        {/* AI Cleanup */}
        {!readOnly && (
          <button
            type="button"
            onClick={handleCleanup}
            disabled={isCleaning || walls.length === 0}
            className="flex items-center gap-1 sm:gap-1.5 px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-[12px] sm:text-[13px] font-semibold transition-all duration-200 bg-brand-accent text-white hover:bg-brand-accent/90 disabled:opacity-40 cursor-pointer"
          >
            {isCleaning ? (
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M19 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            )}
            <span className="hidden sm:inline">{isCleaning ? "Cleaning..." : "Clean Up"}</span>
          </button>
        )}
      </div>

      {/* Toolbar — mobile: two-row with category tabs; desktop: single scrollable row */}
      {!readOnly && (
        <div className="border-b border-outline-variant/40 bg-surface-container-low">
          {/* Mobile: category tabs + tool row */}
          <div className="sm:hidden">
            {/* Category tabs */}
            <div className="flex border-b border-outline-variant/20">
              {(["structure", "shapes", "annotate", "actions"] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setToolCategory(cat)}
                  className={`
                    flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors cursor-pointer
                    font-[family-name:var(--font-geist-mono)]
                    ${toolCategory === cat
                      ? "text-brand-accent border-b-2 border-brand-accent"
                      : "text-on-surface-variant/60"
                    }
                  `}
                >
                  {cat === "structure" ? "Build" : cat === "shapes" ? "Shapes" : cat === "annotate" ? "Note" : "Edit"}
                </button>
              ))}
            </div>
            {/* Tools for selected category */}
            <div className="flex items-center justify-center gap-1 px-1 py-1.5 overflow-x-auto scrollbar-none">
              {tools
                .filter((t) => {
                  if (t.id === "divider") return false;
                  if (toolCategory === "structure") return ["wall", "door", "window", "opening"].includes(t.id);
                  if (toolCategory === "shapes") return ["rectangle", "circle", "triangle", "ellipse", "line", "polygon"].includes(t.id);
                  if (toolCategory === "annotate") return t.id === "label";
                  if (toolCategory === "actions") return ["select", "erase", "undo", "clear"].includes(t.id);
                  return false;
                })
                .map((t) => {
                  const isActive = t.id === tool;
                  const isClear = t.id === "clear";
                  const isUndo = t.id === "undo";
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        if (isClear) {
                          handleClearAll();
                        } else if (isUndo) {
                          handleUndo();
                        } else {
                          setTool(t.id as Tool);
                          if (t.id !== "polygon") {
                            shapeDrawRef.current.isPolygonStarted = false;
                            shapeDrawRef.current.polygonPoints = [];
                          }
                        }
                      }}
                      disabled={
                        (isUndo && undoStack.length === 0) ||
                        (isClear && walls.length === 0 && doors.length === 0 && windows.length === 0 && openings.length === 0 && labels.length === 0 && shapes.length === 0)
                      }
                      className={`
                        flex flex-col items-center justify-center gap-0.5 min-w-[48px] h-[48px] rounded-xl text-[10px] font-medium transition-all duration-150 cursor-pointer shrink-0
                        font-[family-name:var(--font-geist-mono)]
                        ${isActive ? "bg-brand-accent/12 text-brand-accent" : "text-on-surface-variant hover:bg-surface-container-high"}
                        disabled:opacity-30 disabled:cursor-not-allowed
                      `}
                      title={t.label}
                    >
                      {t.icon}
                      <span className="leading-none">{t.label}</span>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Desktop: single scrollable row */}
          <div className="hidden sm:flex items-center gap-1 px-2 py-2.5 overflow-x-auto scrollbar-none">
            <div className="flex items-center gap-1 mx-auto">
              {tools.map((t, idx) => {
                if (t.id === "divider") {
                  return (
                    <div
                      key={`divider-${idx}`}
                      className="w-px h-7 bg-outline-variant/40 mx-1 shrink-0"
                    />
                  );
                }

                const isActive = t.id === tool;
                const isClear = t.id === "clear";
                const isUndo = t.id === "undo";

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (isClear) {
                        handleClearAll();
                      } else if (isUndo) {
                        handleUndo();
                      } else {
                        setTool(t.id as Tool);
                        if (t.id !== "polygon") {
                          shapeDrawRef.current.isPolygonStarted = false;
                          shapeDrawRef.current.polygonPoints = [];
                        }
                      }
                    }}
                    disabled={
                      (isUndo && undoStack.length === 0) ||
                      (isClear && walls.length === 0 && doors.length === 0 && windows.length === 0 && openings.length === 0 && labels.length === 0 && shapes.length === 0)
                    }
                    className={`
                      flex flex-col items-center justify-center gap-0.5 min-w-[44px] h-[44px] rounded-xl text-[10px] font-medium transition-all duration-150 cursor-pointer shrink-0
                      font-[family-name:var(--font-geist-mono)]
                      ${isActive ? "bg-brand-accent/12 text-brand-accent" : "text-on-surface-variant hover:bg-surface-container-high"}
                      disabled:opacity-30 disabled:cursor-not-allowed
                    `}
                    title={t.label}
                  >
                    {t.icon}
                    <span className="leading-none">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden touch-none">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair"
          style={{
            cursor:
              tool === "select"
                ? "default"
                : tool === "erase"
                ? "pointer"
                : tool === "label"
                ? "text"
                : tool === "door" || tool === "window" || tool === "opening"
                ? "copy"
                : SHAPE_TOOLS.includes(tool)
                ? "crosshair"
                : "crosshair",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        {/* Counts indicator */}
        <div className="absolute top-2 sm:top-3 left-1/2 -translate-x-1/2 bg-inverse-surface/80 text-inverse-on-surface px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-[family-name:var(--font-geist-mono)] backdrop-blur-sm pointer-events-none whitespace-nowrap">
          {walls.length}W &middot; {rooms.length}R
          {elementCount > 0 && (
            <>
              {" "}&middot; {elementCount}E
            </>
          )}
        </div>

        {/* Label text input overlay */}
        {editingLabel && labelInputPos && (
          <div
            className="absolute z-10"
            style={{
              left: labelInputPos.x - 80,
              top: labelInputPos.y - 18,
            }}
          >
            <input
              type="text"
              autoFocus
              defaultValue={editingLabel.text}
              placeholder="Label text..."
              className="w-40 px-2 py-1 text-[13px] rounded-md border border-outline-variant bg-surface text-on-surface shadow-lg font-[family-name:var(--font-geist-sans)] focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleLabelSubmit((e.target as HTMLInputElement).value);
                } else if (e.key === "Escape") {
                  setEditingLabel(null);
                  setLabelInputPos(null);
                }
              }}
              onBlur={(e) => handleLabelSubmit(e.target.value)}
            />
          </div>
        )}

        {/* Room name edit overlay */}
        {editingRoomId && roomNameInputPos && (
          <div
            className="absolute z-10"
            style={{
              left: roomNameInputPos.x - 60,
              top: roomNameInputPos.y - 18,
            }}
          >
            <input
              type="text"
              autoFocus
              defaultValue={editingRoomName}
              placeholder="Room name..."
              className="w-32 px-2 py-1 text-[13px] rounded-md border border-outline-variant bg-surface text-on-surface shadow-lg font-[family-name:var(--font-geist-sans)] focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRoomNameSubmit((e.target as HTMLInputElement).value);
                } else if (e.key === "Escape") {
                  setEditingRoomId(null);
                  setRoomNameInputPos(null);
                }
              }}
              onBlur={(e) => handleRoomNameSubmit(e.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
