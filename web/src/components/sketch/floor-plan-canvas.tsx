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

interface CanvasData {
  walls: Wall[];
  rooms: RoomShape[];
  scale: number;
  offset: { x: number; y: number };
}

type Tool = "wall" | "select" | "erase" | "undo";

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
    return { walls: [], rooms: [], scale: DEFAULT_SCALE, offset: { x: 0, y: 0 } };
  }
  return {
    walls: (raw.walls as Wall[]) || [],
    rooms: (raw.rooms as RoomShape[]) || [],
    scale: (raw.scale as number) || DEFAULT_SCALE,
    offset: (raw.offset as { x: number; y: number }) || { x: 0, y: 0 },
  };
}

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
  const [scale, setScale] = useState(() => parseCanvasData(initialData).scale);
  const [offset, setOffset] = useState(() => parseCanvasData(initialData).offset);
  const [tool, setTool] = useState<Tool>("wall");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<Wall[][]>([]);
  const [isCleaning, setIsCleaning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);

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
  }>({
    isDragging: false,
    wallId: null,
    dragEndpoint: null,
    offsetX: 0,
    offsetY: 0,
  });

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
    return { walls, rooms, scale, offset };
  }, [walls, rooms, scale, offset]);

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
      ctx.fillText(room.name, labelPos.x, labelPos.y);
    }

    // Walls
    for (const wall of walls) {
      const p1 = worldToCanvas(wall.x1, wall.y1);
      const p2 = worldToCanvas(wall.x2, wall.y2);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle =
        wall.id === selectedWallId ? COLORS.wallSelected : COLORS.wall;
      ctx.lineWidth = WALL_STROKE * ratio;
      ctx.lineCap = "round";
      ctx.stroke();

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

      // Endpoints (small circles)
      if (wall.id === selectedWallId) {
        for (const pt of [p1, p2]) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = COLORS.wallSelected;
          ctx.fill();
        }
      }
    }

    // Drawing preview line
    const d = drawingRef.current;
    if (d.isDrawing) {
      const p1 = worldToCanvas(d.startX, d.startY);
      const p2 = worldToCanvas(d.currentX, d.currentY);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
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
  }, [walls, rooms, scale, offset, selectedWallId, worldToCanvas]);

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

      if (tool === "wall") {
        const snap = findSnapPoint(pos.x, pos.y, walls);
        const ref = drawingRef.current;
        ref.isDrawing = true;
        ref.startX = snap.x;
        ref.startY = snap.y;
        ref.currentX = snap.x;
        ref.currentY = snap.y;
        ref.snappedStart = snap.snapped;
      } else if (tool === "select") {
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
          setUndoStack((prev) => [...prev, walls]);
          setWalls((prev) => prev.filter((w) => w.id !== closestId));
        }
      }
    },
    [readOnly, tool, walls, scale, getPointerPos]
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
      } else if (tool === "select" && dragRef.current.isDragging) {
        const drag = dragRef.current;
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
    [readOnly, tool, walls, getPointerPos, render]
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
          setUndoStack((prev) => [...prev, walls]);
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

      if (tool === "select") {
        dragRef.current.isDragging = false;
        dragRef.current.wallId = null;
      }
    },
    [tool, walls, render]
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
    setWalls(prev);
  }, [undoStack]);

  const handleClearAll = useCallback(() => {
    if (walls.length === 0) return;
    setUndoStack((prev) => [...prev, walls]);
    setWalls([]);
    setSelectedWallId(null);
  }, [walls]);

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
      setUndoStack((prev) => [...prev, walls]);
      setWalls(cleaned.walls);
      setScale(cleaned.scale);
      setOffset(cleaned.offset);
    } catch {
      // Cleanup failed — keep current state
    } finally {
      setIsCleaning(false);
    }
  }, [onCleanup, getCurrentData, walls]);

  /* ---------------------------------------------------------------- */
  /*  Toolbar                                                          */
  /* ---------------------------------------------------------------- */

  const tools: { id: Tool | "clear"; label: string; icon: React.ReactNode }[] = [
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

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Top bar */}
      <div className="relative flex items-center justify-between px-4 py-3 border-b border-outline-variant/40 bg-surface-container-low">
        {/* Save */}
        <button
          type="button"
          onClick={handleSave}
          disabled={readOnly || saving}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-all duration-200 bg-on-surface text-surface hover:bg-on-surface/90 disabled:opacity-40 cursor-pointer"
        >
          {saving ? (
            <span className="animate-spin w-4 h-4 border-2 border-surface border-t-transparent rounded-full" />
          ) : (
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" stroke="currentColor" strokeWidth="1.8" />
              <path d="M17 21v-8H7v8M7 3v5h8" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          )}
          {saveFlash ? "Saved" : "Save"}
        </button>

        {/* Floor name */}
        <span className="absolute left-1/2 -translate-x-1/2 text-[13px] font-semibold text-on-surface-variant font-[family-name:var(--font-geist-mono)] tracking-wide uppercase">
          {floorName}
        </span>

        {/* AI Cleanup */}
        {!readOnly && (
          <button
            type="button"
            onClick={handleCleanup}
            disabled={isCleaning || walls.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-all duration-200 bg-brand-accent text-white hover:bg-brand-accent/90 disabled:opacity-40 cursor-pointer"
          >
            {isCleaning ? (
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M19 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
            )}
            {isCleaning ? "Cleaning..." : "Clean Up"}
          </button>
        )}
      </div>

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
                : "crosshair",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        {/* Wall count indicator */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-inverse-surface/80 text-inverse-on-surface px-3 py-1 rounded-full text-[11px] font-[family-name:var(--font-geist-mono)] backdrop-blur-sm pointer-events-none">
          {walls.length} wall{walls.length !== 1 ? "s" : ""} &middot;{" "}
          {rooms.length} room{rooms.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center justify-center gap-1 px-3 py-2.5 border-t border-outline-variant/40 bg-surface-container-low">
          {tools.map((t) => {
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
                  }
                }}
                disabled={
                  (isUndo && undoStack.length === 0) ||
                  (isClear && walls.length === 0)
                }
                className={`
                  flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-[48px] rounded-xl text-[11px] font-medium transition-all duration-150 cursor-pointer
                  ${
                    isActive
                      ? "bg-brand-accent/12 text-brand-accent"
                      : "text-on-surface-variant hover:bg-surface-container-high"
                  }
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
      )}
    </div>
  );
}
