"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Stage, Layer, Rect, Line, Text, Arc, Group, Circle } from "react-konva";
import type Konva from "konva";
import {
  type ToolType,
  type FloorPlanData,
  type RoomData,
  type WallData,
  type DoorData,
  type WindowData,
  emptyFloorPlan,
  uid,
  snapToGrid,
  findNearestWall,
  snapEndpoint,
  wallsForRoom,
  doorPosition,
  TOOLS,
  projectOntoWall,
} from "./floor-plan-tools";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface KonvaFloorPlanProps {
  initialData?: FloorPlanData | null;
  onChange?: (data: FloorPlanData) => void;
  readOnly?: boolean;
  rooms?: Array<{ id: string; room_name: string }>;
  onCreateRoom?: (name: string, dimensions?: { width: number; height: number }) => void;
}

/* Common room presets for quick selection */
const ROOM_PRESETS = ["Kitchen", "Living Room", "Master Bedroom", "Bedroom", "Bathroom", "Hallway", "Garage", "Office", "Dining Room", "Laundry"];

/* ------------------------------------------------------------------ */
/*  Undo/redo                                                          */
/* ------------------------------------------------------------------ */

function useUndoRedo(initial: FloorPlanData) {
  const [state, setState] = useState(initial);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const undoStack = useRef<FloorPlanData[]>([]);
  const redoStack = useRef<FloorPlanData[]>([]);

  const push = useCallback((next: FloorPlanData) => {
    setState((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      setUndoCount(undoStack.current.length);
      setRedoCount(0);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setState((prev) => {
      const last = undoStack.current.pop();
      if (!last) return prev;
      redoStack.current.push(prev);
      setUndoCount(undoStack.current.length);
      setRedoCount(redoStack.current.length);
      return last;
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      const next = redoStack.current.pop();
      if (!next) return prev;
      undoStack.current.push(prev);
      setUndoCount(undoStack.current.length);
      setRedoCount(redoStack.current.length);
      return next;
    });
  }, []);

  return { state, push, undo, redo, canUndo: undoCount > 0, canRedo: redoCount > 0 };
}

/* ------------------------------------------------------------------ */
/*  Tool Icons (inline SVG paths)                                      */
/* ------------------------------------------------------------------ */

function ToolIcon({ type }: { type: string }) {
  const s = 18;
  switch (type) {
    case "rect":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "line":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M4 20L20 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "door":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M4 20V4h2v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M6 4a14 14 0 0 1 10 10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
        </svg>
      );
    case "window":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="4" y="6" width="16" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
          <line x1="12" y1="6" x2="12" y2="18" stroke="currentColor" strokeWidth="1.5" />
          <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "pointer":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M5 3l14 10-6 1-3 6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      );
    case "trash":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function KonvaFloorPlan({ initialData, onChange, readOnly = false, rooms: propertyRooms, onCreateRoom }: KonvaFloorPlanProps) {
  const data = initialData ?? emptyFloorPlan();
  const { state, push, undo, redo, canUndo, canRedo } = useUndoRedo(data);
  const [tool, setTool] = useState<ToolType>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  // Drawing state
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [wallStart, setWallStart] = useState<{ x: number; y: number } | null>(null);

  // Room naming picker
  const [pendingRoom, setPendingRoom] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [customRoomName, setCustomRoomName] = useState("");

  // Zoom/pan state
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const scaleBy = 1.08;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.3, Math.min(3, newScale));
    const mousePointTo = { x: (pointer.x - stagePos.x) / oldScale, y: (pointer.y - stagePos.y) / oldScale };
    setStageScale(clampedScale);
    setStagePos({ x: pointer.x - mousePointTo.x * clampedScale, y: pointer.y - mousePointTo.y * clampedScale });
  }, [stageScale, stagePos]);

  const gs = state.gridSize;

  // Auto-save debounce
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStateRef = useRef(state);

  useEffect(() => {
    if (state === prevStateRef.current) return;
    prevStateRef.current = state;
    if (!onChange) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(state), 2000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [state, onChange]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (readOnly) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setSelectedId(null); setDrawStart(null); setWallStart(null); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) deleteElement(selectedId);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, readOnly]);

  /* ---------------------------------------------------------------- */
  /*  Element operations                                               */
  /* ---------------------------------------------------------------- */

  const deleteElement = useCallback((id: string) => {
    const next = { ...state, rooms: [...state.rooms], walls: [...state.walls], doors: [...state.doors], windows: [...state.windows] };

    // Delete room + its walls
    const room = next.rooms.find((r) => r.id === id);
    if (room) {
      next.rooms = next.rooms.filter((r) => r.id !== id);
      const roomWallIds = next.walls.filter((w) => w.roomId === id).map((w) => w.id);
      next.walls = next.walls.filter((w) => w.roomId !== id);
      next.doors = next.doors.filter((d) => !roomWallIds.includes(d.wallId));
      next.windows = next.windows.filter((w) => !roomWallIds.includes(w.wallId));
      push(next);
      setSelectedId(null);
      return;
    }

    // Delete wall + attached doors/windows
    const wall = next.walls.find((w) => w.id === id);
    if (wall) {
      next.walls = next.walls.filter((w) => w.id !== id);
      next.doors = next.doors.filter((d) => d.wallId !== id);
      next.windows = next.windows.filter((w) => w.wallId !== id);
      push(next);
      setSelectedId(null);
      return;
    }

    // Delete door or window
    next.doors = next.doors.filter((d) => d.id !== id);
    next.windows = next.windows.filter((w) => w.id !== id);
    push(next);
    setSelectedId(null);
  }, [state, push]);

  /* ---------------------------------------------------------------- */
  /*  Mouse handlers                                                   */
  /* ---------------------------------------------------------------- */

  const getPos = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    // Convert screen coords to canvas coords (account for zoom/pan)
    return {
      x: (pos.x - stagePos.x) / stageScale,
      y: (pos.y - stagePos.y) / stageScale,
    };
  }, [stageScale, stagePos]);

  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (readOnly) return;
    const pos = getPos();

    if (tool === "room") {
      setDrawStart({ x: snapToGrid(pos.x, gs), y: snapToGrid(pos.y, gs) });
      setDrawCurrent({ x: snapToGrid(pos.x, gs), y: snapToGrid(pos.y, gs) });
    }

    if (tool === "wall") {
      if (!wallStart) {
        const snapped = snapEndpoint(snapToGrid(pos.x, gs), snapToGrid(pos.y, gs), state.walls);
        setWallStart({ x: snapped.x, y: snapped.y });
        setDrawCurrent({ x: snapped.x, y: snapped.y });
      } else {
        // Place wall
        const snapped = snapEndpoint(snapToGrid(pos.x, gs), snapToGrid(pos.y, gs), state.walls);
        const newWall: WallData = {
          id: uid("wall"),
          x1: wallStart.x, y1: wallStart.y,
          x2: snapped.x, y2: snapped.y,
          thickness: 4,
        };
        push({ ...state, walls: [...state.walls, newWall] });
        setWallStart(null);
        setDrawCurrent(null);
      }
    }

    if (tool === "door" || tool === "window") {
      const hit = findNearestWall(pos.x, pos.y, state.walls);
      if (hit) {
        if (tool === "door") {
          const newDoor: DoorData = { id: uid("door"), wallId: hit.wall.id, position: hit.t, width: 3, swing: 0 };
          push({ ...state, doors: [...state.doors, newDoor] });
        } else {
          const newWindow: WindowData = { id: uid("win"), wallId: hit.wall.id, position: hit.t, width: 3 };
          push({ ...state, windows: [...state.windows, newWindow] });
        }
      }
    }

    if (tool === "select") {
      // Clicking on empty space deselects
      const target = e.target;
      if (target === stageRef.current || target.getClassName() === "Rect" && target.attrs.name === "grid-bg") {
        setSelectedId(null);
      }
    }

    if (tool === "delete") {
      const target = e.target;
      const id = target.attrs?.elementId;
      if (id) deleteElement(id);
    }
  }, [tool, readOnly, getPos, gs, state, push, wallStart, deleteElement]);

  const handleMouseMove = useCallback(() => {
    if (readOnly) return;
    const pos = getPos();

    if (tool === "room" && drawStart) {
      setDrawCurrent({ x: snapToGrid(pos.x, gs), y: snapToGrid(pos.y, gs) });
    }
    if (tool === "wall" && wallStart) {
      const snapped = snapEndpoint(snapToGrid(pos.x, gs), snapToGrid(pos.y, gs), state.walls);
      setDrawCurrent({ x: snapped.x, y: snapped.y });
    }
  }, [tool, readOnly, getPos, gs, drawStart, wallStart, state.walls]);

  const handleMouseUp = useCallback(() => {
    if (readOnly) return;

    if (tool === "room" && drawStart && drawCurrent) {
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);

      if (w >= gs && h >= gs) {
        setPendingRoom({ x, y, width: w, height: h });
        setCustomRoomName("");
      }
      setDrawStart(null);
      setDrawCurrent(null);
    }
  }, [tool, readOnly, drawStart, drawCurrent, gs, state, push]);

  const finalizePendingRoom = useCallback((name: string) => {
    if (!pendingRoom) return;
    const newRoom: RoomData = { id: uid("room"), ...pendingRoom, name, fill: "#fff3ed" };
    const roomWalls = wallsForRoom(newRoom);
    push({
      ...state,
      rooms: [...state.rooms, newRoom],
      walls: [...state.walls, ...roomWalls],
    });
    // Also create room in Property Layout if callback provided
    if (onCreateRoom) {
      const widthFt = Math.round((pendingRoom.width / gs) * 10) / 10;
      const heightFt = Math.round((pendingRoom.height / gs) * 10) / 10;
      onCreateRoom(name, { width: widthFt, height: heightFt });
    }
    setPendingRoom(null);
    setCustomRoomName("");
  }, [pendingRoom, state, push, onCreateRoom, gs]);

  /* ---------------------------------------------------------------- */
  /*  Drag handlers for select tool                                    */
  /* ---------------------------------------------------------------- */

  const handleDragEnd = useCallback((type: "room" | "wall", id: string, newPos: { x: number; y: number }) => {
    if (type === "room") {
      const sx = snapToGrid(newPos.x, gs);
      const sy = snapToGrid(newPos.y, gs);
      const room = state.rooms.find((r) => r.id === id);
      if (!room) return;
      const dx = sx - room.x;
      const dy = sy - room.y;
      const updatedRoom = { ...room, x: sx, y: sy };
      const updatedWalls = state.walls.map((w) =>
        w.roomId === id ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy } : w
      );
      push({ ...state, rooms: state.rooms.map((r) => (r.id === id ? updatedRoom : r)), walls: updatedWalls });
    }
  }, [state, push, gs]);

  /* ---------------------------------------------------------------- */
  /*  Grid lines                                                       */
  /* ---------------------------------------------------------------- */

  const gridLines = useMemo(() => {
    const lines: Array<{ points: number[]; vertical: boolean }> = [];
    for (let x = 0; x <= stageSize.width; x += gs) {
      lines.push({ points: [x, 0, x, stageSize.height], vertical: true });
    }
    for (let y = 0; y <= stageSize.height; y += gs) {
      lines.push({ points: [0, y, stageSize.width, y], vertical: false });
    }
    return lines;
  }, [stageSize, gs]);

  /* ---------------------------------------------------------------- */
  /*  Helper: dimension label                                          */
  /* ---------------------------------------------------------------- */

  function feetLabel(pixels: number): string {
    return `${(Math.abs(pixels) / gs).toFixed(1)} ft`;
  }

  /* ---------------------------------------------------------------- */
  /*  Computed: is empty                                                */
  /* ---------------------------------------------------------------- */

  const wallMap = useMemo(() => {
    const map = new Map<string, WallData>();
    for (const w of state.walls) map.set(w.id, w);
    return map;
  }, [state.walls]);

  const isEmpty = state.rooms.length === 0 && state.walls.length === 0;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center gap-1 px-3 py-2 border-b border-[#eae6e1] bg-[#faf8f5] flex-wrap">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTool(t.id); setSelectedId(null); setDrawStart(null); setWallStart(null); }}
              aria-label={t.label}
              className={`flex flex-col items-center justify-center w-[44px] h-[44px] rounded-lg text-[10px] font-medium transition-all cursor-pointer ${
                tool === t.id
                  ? "bg-[#e85d26]/12 text-[#e85d26]"
                  : "text-[#6b6560] hover:bg-[#eae6e1]"
              }`}
            >
              <ToolIcon type={t.icon} />
              <span className="mt-0.5">{t.label}</span>
            </button>
          ))}
          <div className="w-px h-8 bg-[#eae6e1] mx-1" />
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            aria-label="Undo"
            className="flex flex-col items-center justify-center w-[44px] h-[44px] rounded-lg text-[10px] font-medium text-[#6b6560] hover:bg-[#eae6e1] disabled:opacity-30 cursor-pointer"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><path d="M3 10h14a4 4 0 0 1 0 8H10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 6L3 10l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="mt-0.5">Undo</span>
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            aria-label="Redo"
            className="flex flex-col items-center justify-center w-[44px] h-[44px] rounded-lg text-[10px] font-medium text-[#6b6560] hover:bg-[#eae6e1] disabled:opacity-30 cursor-pointer"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><path d="M21 10H7a4 4 0 0 0 0 8h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M17 6l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="mt-0.5">Redo</span>
          </button>
          <div className="w-px h-8 bg-[#eae6e1] mx-1" />
          <button
            type="button"
            onClick={() => setStageScale((s) => Math.min(3, s * 1.2))}
            aria-label="Zoom in"
            className="flex flex-col items-center justify-center w-[44px] h-[44px] rounded-lg text-[10px] font-medium text-[#6b6560] hover:bg-[#eae6e1] cursor-pointer"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M21 21l-4-4M8 11h6M11 8v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <span className="mt-0.5">Zoom+</span>
          </button>
          <button
            type="button"
            onClick={() => setStageScale((s) => Math.max(0.3, s / 1.2))}
            aria-label="Zoom out"
            className="flex flex-col items-center justify-center w-[44px] h-[44px] rounded-lg text-[10px] font-medium text-[#6b6560] hover:bg-[#eae6e1] cursor-pointer"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M21 21l-4-4M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <span className="mt-0.5">Zoom-</span>
          </button>
          <button
            type="button"
            onClick={() => { setStageScale(1); setStagePos({ x: 0, y: 0 }); }}
            aria-label="Reset view"
            className="flex flex-col items-center justify-center w-[44px] h-[44px] rounded-lg text-[10px] font-medium text-[#6b6560] hover:bg-[#eae6e1] cursor-pointer"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M9 3v18M3 9h18" stroke="currentColor" strokeWidth="1" opacity="0.3" /></svg>
            <span className="mt-0.5">Fit</span>
          </button>
          <span className="text-[10px] text-[#8a847e] font-[family-name:var(--font-geist-mono)] ml-1">{Math.round(stageScale * 100)}%</span>
        </div>
      )}

      {/* Canvas + Instructions */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
      <div ref={containerRef} className="flex-1 min-h-0 min-w-0 relative bg-white overflow-hidden border border-[#eae6e1] rounded-sm">
        {isEmpty && !drawStart && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="flex flex-col items-center gap-3 text-center px-6">
              <div className="w-12 h-12 rounded-xl bg-[#fff3ed] flex items-center justify-center">
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="#e85d26" strokeWidth="2" />
                  <path d="M12 8v8M8 12h8" stroke="#e85d26" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-[14px] font-semibold text-[#1a1a1a]">Draw your first room</p>
              <p className="text-[12px] text-[#6b6560] max-w-[240px]">
                Select the Room tool from the toolbar above, then click and drag on the canvas to create a room.
              </p>
            </div>
          </div>
        )}

        {/* Room name picker overlay */}
        {pendingRoom && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20">
            <div className="bg-white rounded-xl shadow-lg p-4 w-[280px] max-h-[400px] overflow-y-auto">
              <h3 className="text-[13px] font-semibold text-[#1a1a1a] mb-3">Name this room</h3>

              {/* Existing Property Layout rooms (not yet drawn) */}
              {propertyRooms && propertyRooms.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#8a847e] mb-1.5">From Property Layout</p>
                  <div className="flex flex-wrap gap-1.5">
                    {propertyRooms
                      .filter((r) => !state.rooms.some((sr) => sr.name === r.room_name))
                      .map((r) => (
                        <button key={r.id} type="button" onClick={() => finalizePendingRoom(r.room_name)}
                          className="px-3 py-1.5 rounded-full bg-[#fff3ed] text-[#e85d26] text-[12px] font-medium hover:bg-[#e85d26] hover:text-white transition-colors cursor-pointer">
                          {r.room_name}
                        </button>
                      ))}
                    {propertyRooms.filter((r) => !state.rooms.some((sr) => sr.name === r.room_name)).length === 0 && (
                      <p className="text-[11px] text-[#8a847e]">All rooms already drawn</p>
                    )}
                  </div>
                </div>
              )}

              {/* Preset room names */}
              <div className="mb-3">
                <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#8a847e] mb-1.5">Quick pick</p>
                <div className="flex flex-wrap gap-1.5">
                  {ROOM_PRESETS
                    .filter((name) => !state.rooms.some((r) => r.name === name))
                    .slice(0, 6)
                    .map((name) => (
                      <button key={name} type="button" onClick={() => finalizePendingRoom(name)}
                        className="px-3 py-1.5 rounded-full border border-[#eae6e1] text-[#1a1a1a] text-[12px] font-medium hover:bg-[#eae6e1] transition-colors cursor-pointer">
                        {name}
                      </button>
                    ))}
                </div>
              </div>

              {/* Custom name input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customRoomName}
                  onChange={(e) => setCustomRoomName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && customRoomName.trim()) finalizePendingRoom(customRoomName.trim()); }}
                  placeholder="Custom name..."
                  autoFocus
                  className="flex-1 h-8 px-3 rounded-lg border border-[#eae6e1] text-[13px] text-[#1a1a1a] outline-none focus:border-[#e85d26]"
                />
                <button type="button" onClick={() => { if (customRoomName.trim()) finalizePendingRoom(customRoomName.trim()); }}
                  disabled={!customRoomName.trim()}
                  className="h-8 px-3 rounded-lg bg-[#e85d26] text-white text-[12px] font-semibold cursor-pointer disabled:opacity-40 hover:opacity-90 transition-opacity">
                  Add
                </button>
              </div>

              <button type="button" onClick={() => { setPendingRoom(null); setCustomRoomName(""); }}
                className="mt-2 text-[11px] text-[#8a847e] hover:text-[#1a1a1a] cursor-pointer transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          draggable={tool === "select" && !selectedId}
          onDragEnd={(e) => {
            if (e.target === stageRef.current) {
              setStagePos({ x: e.target.x(), y: e.target.y() });
            }
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
          style={{ cursor: tool === "select" && !selectedId ? "grab" : tool === "room" ? "crosshair" : tool === "wall" ? "crosshair" : tool === "delete" ? "not-allowed" : "default" }}
        >
          {/* Grid layer */}
          <Layer listening={false}>
            <Rect name="grid-bg" x={0} y={0} width={stageSize.width} height={stageSize.height} fill="#ffffff" />
            {gridLines.map((line, i) => (
              <Line key={i} points={line.points} stroke="#eae6e1" strokeWidth={1} />
            ))}
          </Layer>

          {/* Rooms layer */}
          <Layer>
            {state.rooms.map((room) => (
              <Group
                key={room.id}
                x={room.x}
                y={room.y}
                draggable={tool === "select" && !readOnly}
                onDragEnd={(e) => handleDragEnd("room", room.id, { x: e.target.x(), y: e.target.y() })}
                onClick={() => { if (tool === "select") setSelectedId(room.id); if (tool === "delete") deleteElement(room.id); }}
                onTap={() => { if (tool === "select") setSelectedId(room.id); if (tool === "delete") deleteElement(room.id); }}
              >
                <Rect
                  width={room.width}
                  height={room.height}
                  fill={room.fill}
                  stroke={selectedId === room.id ? "#5b6abf" : "#e85d26"}
                  strokeWidth={selectedId === room.id ? 3 : 2}
                  elementId={room.id}
                />
                {/* Room name */}
                <Text
                  x={room.width / 2}
                  y={room.height / 2 - 8}
                  text={room.name}
                  fontSize={13}
                  fontFamily="var(--font-geist-mono), monospace"
                  fill="#1a1a1a"
                  align="center"
                  offsetX={room.name.length * 3.5}
                />
                {/* Dimension labels */}
                <Text
                  x={room.width / 2}
                  y={-14}
                  text={feetLabel(room.width)}
                  fontSize={11}
                  fontFamily="var(--font-geist-mono), monospace"
                  fill="#6b6560"
                  align="center"
                  offsetX={feetLabel(room.width).length * 3}
                />
                {/* Height dimension on left edge */}
                <Text
                  x={-14}
                  y={room.height / 2}
                  text={feetLabel(room.height)}
                  fontSize={11}
                  fontFamily="var(--font-geist-mono), monospace"
                  fill="#6b6560"
                  rotation={-90}
                  offsetX={feetLabel(room.height).length * 3}
                />
                {/* Selection handles */}
                {selectedId === room.id && (
                  <>
                    {[
                      { cx: 0, cy: 0 },
                      { cx: room.width, cy: 0 },
                      { cx: room.width, cy: room.height },
                      { cx: 0, cy: room.height },
                    ].map((h, i) => (
                      <Circle key={i} x={h.cx} y={h.cy} radius={5} fill="#5b6abf" stroke="#ffffff" strokeWidth={2} />
                    ))}
                  </>
                )}
              </Group>
            ))}

            {/* Drawing preview for room */}
            {tool === "room" && drawStart && drawCurrent && (
              <Group>
                <Rect
                  x={Math.min(drawStart.x, drawCurrent.x)}
                  y={Math.min(drawStart.y, drawCurrent.y)}
                  width={Math.abs(drawCurrent.x - drawStart.x)}
                  height={Math.abs(drawCurrent.y - drawStart.y)}
                  fill="#fff3ed"
                  stroke="#e85d26"
                  strokeWidth={2}
                  dash={[6, 4]}
                  opacity={0.7}
                />
                <Text
                  x={(drawStart.x + drawCurrent.x) / 2}
                  y={Math.min(drawStart.y, drawCurrent.y) - 18}
                  text={`${feetLabel(drawCurrent.x - drawStart.x)} x ${feetLabel(drawCurrent.y - drawStart.y)}`}
                  fontSize={12}
                  fontFamily="var(--font-geist-mono), monospace"
                  fill="#e85d26"
                  align="center"
                  offsetX={60}
                />
              </Group>
            )}
          </Layer>

          {/* Walls layer */}
          <Layer>
            {state.walls.map((wall) => {
              const len = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
              const midX = (wall.x1 + wall.x2) / 2;
              const midY = (wall.y1 + wall.y2) / 2;
              return (
                <Group key={wall.id}>
                  <Line
                    points={[wall.x1, wall.y1, wall.x2, wall.y2]}
                    stroke={selectedId === wall.id ? "#5b6abf" : "#1a1a1a"}
                    strokeWidth={wall.thickness}
                    lineCap="round"
                    hitStrokeWidth={12}
                    elementId={wall.id}
                    onClick={() => { if (tool === "select") setSelectedId(wall.id); if (tool === "delete") deleteElement(wall.id); }}
                    onTap={() => { if (tool === "select") setSelectedId(wall.id); if (tool === "delete") deleteElement(wall.id); }}
                  />
                  {/* Dimension label (only for standalone walls, not room walls) */}
                  {!wall.roomId && len > 30 && (
                    <Text
                      x={midX}
                      y={midY - 14}
                      text={feetLabel(len)}
                      fontSize={11}
                      fontFamily="var(--font-geist-mono), monospace"
                      fill="#6b6560"
                      offsetX={feetLabel(len).length * 3}
                    />
                  )}
                </Group>
              );
            })}

            {/* Wall drawing preview */}
            {tool === "wall" && wallStart && drawCurrent && (
              <Group>
                <Line
                  points={[wallStart.x, wallStart.y, drawCurrent.x, drawCurrent.y]}
                  stroke="#1a1a1a"
                  strokeWidth={4}
                  dash={[6, 4]}
                  opacity={0.6}
                />
                <Text
                  x={(wallStart.x + drawCurrent.x) / 2}
                  y={(wallStart.y + drawCurrent.y) / 2 - 16}
                  text={feetLabel(Math.hypot(drawCurrent.x - wallStart.x, drawCurrent.y - wallStart.y))}
                  fontSize={12}
                  fontFamily="var(--font-geist-mono), monospace"
                  fill="#e85d26"
                  offsetX={20}
                />
                {/* Snap indicator */}
                <Circle x={wallStart.x} y={wallStart.y} radius={4} fill="#e85d26" />
              </Group>
            )}
          </Layer>

          {/* Doors & Windows layer */}
          <Layer>
            {state.doors.map((door) => {
              const wall = wallMap.get(door.wallId);
              if (!wall) return null;
              const { px, py, angle } = doorPosition(door, wall);
              const doorPx = door.width * gs;
              // Normalize legacy string values to numeric swing
              const swing: 0 | 1 | 2 | 3 = typeof door.swing === "number" ? door.swing : (door.swing === "left" ? 0 : 2);
              // Quadrant: 0=hinge-left/up, 1=hinge-left/down, 2=hinge-right/down, 3=hinge-right/up
              const hingeX = (swing === 0 || swing === 1) ? -doorPx / 2 : doorPx / 2;
              const leafDir = (swing === 0 || swing === 3) ? -1 : 1; // -1=up (negative Y), 1=down (positive Y)
              const isSelected = selectedId === door.id;
              const handleDoorInteract = () => {
                if (tool === "select") {
                  if (isSelected) {
                    const updated = state.doors.map((d) =>
                      d.id === door.id ? { ...d, swing: ((swing + 1) % 4) as 0 | 1 | 2 | 3 } : d
                    );
                    push({ ...state, doors: updated });
                  } else {
                    setSelectedId(door.id);
                  }
                }
                if (tool === "delete") deleteElement(door.id);
              };
              return (
                <Group
                  key={door.id}
                  x={px}
                  y={py}
                  rotation={(angle * 180) / Math.PI}
                  draggable={tool === "select" && !readOnly}
                  onClick={handleDoorInteract}
                  onTap={handleDoorInteract}
                  onDragMove={(e) => {
                    if (tool !== "select") return;
                    const node = e.target;
                    const t = projectOntoWall(node.x(), node.y(), wall);
                    if (t === null) return;
                    node.x(wall.x1 + t * (wall.x2 - wall.x1));
                    node.y(wall.y1 + t * (wall.y2 - wall.y1));
                  }}
                  onDragEnd={(e) => {
                    if (tool !== "select") return;
                    const t = projectOntoWall(e.target.x(), e.target.y(), wall);
                    if (t === null) return;
                    const updated = state.doors.map((d) =>
                      d.id === door.id ? { ...d, position: t } : d
                    );
                    push({ ...state, doors: updated });
                  }}
                >
                  {/* Invisible hit area for easier clicking */}
                  <Rect
                    x={-doorPx / 2 - 5}
                    y={-doorPx - 5}
                    width={doorPx + 10}
                    height={doorPx * 2 + 10}
                    fill="transparent"
                    hitStrokeWidth={0}
                  />
                  {/* Gap in wall */}
                  <Line points={[-doorPx / 2, 0, doorPx / 2, 0]} stroke="#ffffff" strokeWidth={6} />
                  {/* Door leaf line — from hinge point perpendicular to the wall */}
                  <Line points={[hingeX, 0, hingeX, doorPx * 0.7 * leafDir]} stroke="#1a1a1a" strokeWidth={2} />
                  {/* Swing arc — quarter circle showing door sweep */}
                  <Arc
                    x={hingeX}
                    y={0}
                    innerRadius={doorPx * 0.7 - 1}
                    outerRadius={doorPx * 0.7}
                    angle={90}
                    rotation={
                      swing === 0 ? -90   // hinge-left, swing up: arc from -Y toward +X
                        : swing === 1 ? 0    // hinge-left, swing down: arc from +X toward +Y
                        : swing === 2 ? 90   // hinge-right, swing down: arc from +Y toward -X
                        : 180                 // hinge-right, swing up: arc from -X toward -Y
                    }
                    fill="transparent"
                    stroke="#1a1a1a"
                    strokeWidth={1}
                    dash={[3, 2]}
                  />
                  {isSelected && (
                    <Circle x={0} y={0} radius={7} fill="#5b6abf" stroke="#ffffff" strokeWidth={2.5} />
                  )}
                </Group>
              );
            })}

            {state.windows.map((win) => {
              const wall = wallMap.get(win.wallId);
              if (!wall) return null;
              const { px, py, angle } = doorPosition(win, wall);
              const winPx = win.width * gs;
              const isSelected = selectedId === win.id;
              return (
                <Group
                  key={win.id}
                  x={px}
                  y={py}
                  rotation={(angle * 180) / Math.PI}
                  draggable={tool === "select" && !readOnly}
                  onClick={() => { if (tool === "select") setSelectedId(win.id); if (tool === "delete") deleteElement(win.id); }}
                  onTap={() => { if (tool === "select") setSelectedId(win.id); if (tool === "delete") deleteElement(win.id); }}
                  onDragMove={(e) => {
                    if (tool !== "select") return;
                    const node = e.target;
                    const t = projectOntoWall(node.x(), node.y(), wall);
                    if (t === null) return;
                    node.x(wall.x1 + t * (wall.x2 - wall.x1));
                    node.y(wall.y1 + t * (wall.y2 - wall.y1));
                  }}
                  onDragEnd={(e) => {
                    if (tool !== "select") return;
                    const t = projectOntoWall(e.target.x(), e.target.y(), wall);
                    if (t === null) return;
                    const updated = state.windows.map((w) =>
                      w.id === win.id ? { ...w, position: t } : w
                    );
                    push({ ...state, windows: updated });
                  }}
                >
                  {/* Invisible hit area for easier clicking (44px minimum touch target) */}
                  <Rect
                    x={-winPx / 2 - 5}
                    y={-22}
                    width={winPx + 10}
                    height={44}
                    fill="transparent"
                    hitStrokeWidth={0}
                  />
                  {/* Gap in wall */}
                  <Line points={[-winPx / 2, 0, winPx / 2, 0]} stroke="#ffffff" strokeWidth={6} />
                  {/* Double line for window */}
                  <Line points={[-winPx / 2, -3, winPx / 2, -3]} stroke="#5b6abf" strokeWidth={2} />
                  <Line points={[-winPx / 2, 3, winPx / 2, 3]} stroke="#5b6abf" strokeWidth={2} />
                  {isSelected && (
                    <Circle x={0} y={0} radius={7} fill="#5b6abf" stroke="#ffffff" strokeWidth={2.5} />
                  )}
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>

      {/* Instructions Panel — desktop only */}
      {!readOnly && (
        <div className="hidden md:flex flex-col w-[240px] shrink-0 border-l border-[#eae6e1] bg-[#faf8f5] p-4 overflow-y-auto">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#eae6e1]">
            <div className="w-3 h-3 border border-[#eae6e1]" />
            <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-[#6b6560]">= 1 foot</span>
          </div>

          {/* Unmapped rooms from Property Layout */}
          {propertyRooms && propertyRooms.length > 0 && (() => {
            const drawnNames = new Set(state.rooms.map(r => r.name));
            const unmapped = propertyRooms.filter(r => !drawnNames.has(r.room_name));
            if (unmapped.length === 0) return null;
            return (
              <div className="mb-3 pb-3 border-b border-[#eae6e1]">
                <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#8a847e] mb-1.5">Not yet drawn</p>
                <div className="flex flex-wrap gap-1">
                  {unmapped.map(r => (
                    <span key={r.id} className="px-2 py-0.5 rounded-full bg-[#fff3ed] text-[#e85d26] text-[11px] font-medium">
                      {r.room_name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          <h3 className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#6b6560] font-semibold mb-3">
            {tool === "room" ? "Room Tool" : tool === "wall" ? "Wall Tool" : tool === "door" ? "Door Tool" : tool === "window" ? "Window Tool" : tool === "select" ? "Select Tool" : tool === "delete" ? "Delete Tool" : "How to Use"}
          </h3>

          {tool === "room" && (
            <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
              <p><span className="font-semibold text-[#1a1a1a]">Click and drag</span> to draw a room rectangle.</p>
              <p>Dimensions show live as you draw.</p>
              <p>Release to set the room, then enter a name.</p>
              <p className="text-[11px] text-[#8a847e] mt-3">Rooms auto-create walls on all 4 edges. Doors snap to these.</p>
            </div>
          )}

          {tool === "wall" && (
            <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
              <p><span className="font-semibold text-[#1a1a1a]">Click</span> to start a wall.</p>
              <p><span className="font-semibold text-[#1a1a1a]">Click again</span> to end it.</p>
              <p>Measurements show in feet as you draw.</p>
              <p className="text-[11px] text-[#8a847e] mt-3">Endpoints snap to nearby walls automatically.</p>
            </div>
          )}

          {tool === "door" && (
            <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
              <p><span className="font-semibold text-[#1a1a1a]">Click on a wall</span> to place a door.</p>
              <p><span className="font-semibold text-[#1a1a1a]">Click a selected door</span> to cycle swing direction (4 positions).</p>
              <p><span className="font-semibold text-[#1a1a1a]">Drag</span> a selected door to slide it along the wall.</p>
              <p className="text-[11px] text-[#8a847e] mt-3">Switch to Select tool to move doors. Press Delete to remove.</p>
            </div>
          )}

          {tool === "window" && (
            <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
              <p><span className="font-semibold text-[#1a1a1a]">Click on a wall</span> to place a window.</p>
              <p><span className="font-semibold text-[#1a1a1a]">Drag</span> a selected window to slide it along the wall.</p>
              <p className="text-[11px] text-[#8a847e] mt-3">Windows show as double lines. Press Delete to remove.</p>
            </div>
          )}

          {tool === "select" && (
            <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
              <p><span className="font-semibold text-[#1a1a1a]">Click</span> any element to select it.</p>
              <p><span className="font-semibold text-[#1a1a1a]">Drag rooms</span> to reposition.</p>
              <p><span className="font-semibold text-[#1a1a1a]">Drag doors/windows</span> along their wall.</p>
              <p><span className="font-semibold text-[#1a1a1a]">Delete or Backspace</span> removes selected.</p>
              <p className="text-[11px] text-[#8a847e] mt-3">Escape to deselect. Click door twice to flip swing.</p>
            </div>
          )}

          {tool === "delete" && (
            <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
              <p><span className="font-semibold text-[#1a1a1a]">Click</span> any element to delete it.</p>
              <p>Deleting a room removes its walls, doors, and windows too.</p>
              <p className="text-[11px] text-[#8a847e] mt-3">Tip: use Select tool + Delete key instead for precision.</p>
            </div>
          )}

          <div className="mt-auto pt-4 border-t border-[#eae6e1]">
            <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#8a847e] font-semibold mb-2">
              Keyboard
            </h4>
            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
              <kbd className="px-1.5 py-0.5 rounded bg-[#eae6e1] text-[#1a1a1a] font-[family-name:var(--font-geist-mono)] text-[10px]">⌘Z</kbd>
              <span className="text-[#6b6560]">Undo</span>
              <kbd className="px-1.5 py-0.5 rounded bg-[#eae6e1] text-[#1a1a1a] font-[family-name:var(--font-geist-mono)] text-[10px]">⌘⇧Z</kbd>
              <span className="text-[#6b6560]">Redo</span>
              <kbd className="px-1.5 py-0.5 rounded bg-[#eae6e1] text-[#1a1a1a] font-[family-name:var(--font-geist-mono)] text-[10px]">Del</kbd>
              <span className="text-[#6b6560]">Remove selected</span>
              <kbd className="px-1.5 py-0.5 rounded bg-[#eae6e1] text-[#1a1a1a] font-[family-name:var(--font-geist-mono)] text-[10px]">Esc</kbd>
              <span className="text-[#6b6560]">Deselect</span>
              <kbd className="px-1.5 py-0.5 rounded bg-[#eae6e1] text-[#1a1a1a] font-[family-name:var(--font-geist-mono)] text-[10px]">Scroll</kbd>
              <span className="text-[#6b6560]">Zoom in/out</span>
            </div>
            <p className="text-[11px] text-[#8a847e] mt-2">
              Use Select tool + drag empty area to pan.
            </p>
          </div>

        </div>
      )}
      </div>
    </div>
  );
}
