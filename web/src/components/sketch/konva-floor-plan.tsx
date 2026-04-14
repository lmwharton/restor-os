"use client";

import { useState, useCallback, useRef, useEffect, useMemo, useImperativeHandle, forwardRef } from "react";
import { Stage, Layer, Rect, Line, Text, Arc, Group, Circle } from "react-konva";
import type Konva from "konva";
import {
  type ToolType,
  type FloorPlanData,
  type RoomData,
  type WallData,
  emptyFloorPlan,
  uid,
  snapToGrid,
  findNearestWall,
  snapEndpoint,
  wallsForRoom,
  doorPosition,
  projectOntoWall,
} from "./floor-plan-tools";
import { FloorPlanToolbar } from "./floor-plan-toolbar";
import { FloorPlanSidebar } from "./floor-plan-sidebar";
import { FloorPlanRoomPicker } from "./floor-plan-room-picker";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface KonvaFloorPlanHandle {
  flush: () => void;
}

interface KonvaFloorPlanProps {
  initialData?: FloorPlanData | null;
  onChange?: (data: FloorPlanData) => void;
  readOnly?: boolean;
  rooms?: Array<{ id: string; room_name: string }>;
  onCreateRoom?: (name: string, dimensions?: { width: number; height: number }) => void;
  jobId?: string;
  onSelectionChange?: (info: { selectedId: string; type: "room"; name: string; widthFt: number; heightFt: number } | null) => void;
}

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
      if (undoStack.current.length > 50) undoStack.current.shift();
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
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const KonvaFloorPlan = forwardRef<KonvaFloorPlanHandle, KonvaFloorPlanProps>(function KonvaFloorPlan({ initialData, onChange, readOnly = false, rooms: propertyRooms, onCreateRoom, jobId, onSelectionChange }, ref) {
  const data = initialData ?? emptyFloorPlan();
  const { state, push, undo, redo, canUndo, canRedo } = useUndoRedo(data);
  const [tool, setTool] = useState<ToolType>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  // Notify parent of selection changes (for mobile bottom panel)
  useEffect(() => {
    if (!onSelectionChange) return;
    if (!selectedId) { onSelectionChange(null); return; }
    const room = state.rooms.find(r => r.id === selectedId);
    if (!room) { onSelectionChange(null); return; }
    const g = state.gridSize;
    onSelectionChange({
      selectedId,
      type: "room",
      name: room.name,
      widthFt: Math.round((room.width / g) * 10) / 10,
      heightFt: Math.round((room.height / g) * 10) / 10,
    });
  }, [selectedId, state.rooms, state.gridSize, onSelectionChange]);

  // Drawing state
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [wallStart, setWallStart] = useState<{ x: number; y: number } | null>(null);

  // Room naming picker
  const [pendingRoom, setPendingRoom] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Zoom/pan state
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  // Pinch-to-zoom tracking
  const lastPinchDist = useRef<number | null>(null);
  const lastPinchCenter = useRef<{ x: number; y: number } | null>(null);

  // Refs for zoom to avoid stale closures in rapid scroll events
  const stageScaleRef = useRef(stageScale);
  stageScaleRef.current = stageScale;
  const stagePosRef = useRef(stagePos);
  stagePosRef.current = stagePos;

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    const evt = e.evt;
    if (!evt.ctrlKey && !evt.metaKey) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stageScaleRef.current;
    const oldPos = stagePosRef.current;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const scaleBy = 1.08;
    const newScale = evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.3, Math.min(3, newScale));
    const mousePointTo = { x: (pointer.x - oldPos.x) / oldScale, y: (pointer.y - oldPos.y) / oldScale };
    setStageScale(clampedScale);
    setStagePos({ x: pointer.x - mousePointTo.x * clampedScale, y: pointer.y - mousePointTo.y * clampedScale });
  }, []);

  const gs = state.gridSize;

  // Auto-save debounce
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStateRef = useRef(state);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const hasPendingRef = useRef(false);
  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  useEffect(() => {
    if (state === prevStateRef.current) return;
    prevStateRef.current = state;
    if (!onChangeRef.current) return;
    hasPendingRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      hasPendingRef.current = false;
      onChangeRef.current?.(latestStateRef.current);
    }, 2000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // onChange is read via onChangeRef (not from deps) so parent re-renders don't kill the timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useImperativeHandle(ref, () => ({
    flush() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (hasPendingRef.current && onChangeRef.current) {
        hasPendingRef.current = false;
        onChangeRef.current(latestStateRef.current);
      }
    },
  }), []);

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

  /* ---------------------------------------------------------------- */
  /*  Element operations                                               */
  /* ---------------------------------------------------------------- */

  const deleteElement = useCallback((id: string) => {
    const next = { ...state, rooms: [...state.rooms], walls: [...state.walls], doors: [...state.doors], windows: [...state.windows] };
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
    const wall = next.walls.find((w) => w.id === id);
    if (wall) {
      next.walls = next.walls.filter((w) => w.id !== id);
      next.doors = next.doors.filter((d) => d.wallId !== id);
      next.windows = next.windows.filter((w) => w.wallId !== id);
      push(next);
      setSelectedId(null);
      return;
    }
    next.doors = next.doors.filter((d) => d.id !== id);
    next.windows = next.windows.filter((w) => w.id !== id);
    push(next);
    setSelectedId(null);
  }, [state, push]);

  /* ---------------------------------------------------------------- */
  /*  Keyboard shortcuts                                               */
  /* ---------------------------------------------------------------- */

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const deleteElementRef = useRef(deleteElement);
  deleteElementRef.current = deleteElement;

  useEffect(() => {
    if (readOnly) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") setPendingRoom(null);
        return;
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setDrawStart(null);
        setWallStart(null);
        setDrawCurrent(null);
        setPendingRoom(null);
        setTool("select");
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIdRef.current) deleteElementRef.current(selectedIdRef.current);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  /* ---------------------------------------------------------------- */
  /*  Mouse / touch handlers                                           */
  /* ---------------------------------------------------------------- */

  const getPos = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    return {
      x: (pos.x - stagePos.x) / stageScale,
      y: (pos.y - stagePos.y) / stageScale,
    };
  }, [stageScale, stagePos]);

  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (readOnly) return;

    // Detect two-finger touch for pinch/pan — don't start drawing
    const nativeEvt = e.evt as TouchEvent;
    if (nativeEvt.touches && nativeEvt.touches.length >= 2) {
      const t1 = nativeEvt.touches[0];
      const t2 = nativeEvt.touches[1];
      lastPinchDist.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      lastPinchCenter.current = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
      return;
    }

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
        const snapped = snapEndpoint(snapToGrid(pos.x, gs), snapToGrid(pos.y, gs), state.walls);
        const newWall: WallData = { id: uid("wall"), x1: wallStart.x, y1: wallStart.y, x2: snapped.x, y2: snapped.y, thickness: 4 };
        push({ ...state, walls: [...state.walls, newWall] });
        setWallStart(null);
        setDrawCurrent(null);
        // Auto-switch back to select so user can pan/interact
        setTool("select");
      }
    }

    if (tool === "door" || tool === "window") {
      const hit = findNearestWall(pos.x, pos.y, state.walls);
      if (hit) {
        if (tool === "door") {
          push({ ...state, doors: [...state.doors, { id: uid("door"), wallId: hit.wall.id, position: hit.t, width: 3, swing: 0 }] });
        } else {
          push({ ...state, windows: [...state.windows, { id: uid("win"), wallId: hit.wall.id, position: hit.t, width: 3 }] });
        }
        // Auto-switch back to select so user can pan/interact
        setTool("select");
      }
    }

    if (tool === "select") {
      const target = e.target;
      if (target === stageRef.current || (target.getClassName() === "Rect" && target.attrs.name === "grid-bg")) {
        setSelectedId(null);
      }
    }

    if (tool === "delete") {
      const id = e.target.attrs?.elementId;
      if (id) deleteElement(id);
    }
  }, [tool, readOnly, getPos, gs, state, push, wallStart, deleteElement]);

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Pinch-to-zoom + two-finger pan (works in readOnly too)
    const nativeEvt = e.evt as TouchEvent;
    if (nativeEvt.touches && nativeEvt.touches.length >= 2) {
      e.evt.preventDefault();
      // Cancel any in-progress drawing when second finger joins
      if (drawStart) setDrawStart(null);
      if (wallStart) setWallStart(null);

      const t1 = nativeEvt.touches[0];
      const t2 = nativeEvt.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const center = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };

      if (lastPinchDist.current !== null && lastPinchCenter.current !== null) {
        setStageScale((prev) => Math.max(0.3, Math.min(3, prev * (dist / (lastPinchDist.current ?? dist)))));
        const dx = center.x - lastPinchCenter.current.x;
        const dy = center.y - lastPinchCenter.current.y;
        setStagePos((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      }

      lastPinchDist.current = dist;
      lastPinchCenter.current = center;
      return;
    }

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

  const handleMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Reset pinch tracking
    lastPinchDist.current = null;
    lastPinchCenter.current = null;

    if (readOnly) return;
    if (tool === "room" && drawStart && drawCurrent) {
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);
      if (w >= gs && h >= gs) {
        setPendingRoom({ x, y, width: w, height: h });
      }
      setDrawStart(null);
      setDrawCurrent(null);
    }
  }, [tool, readOnly, drawStart, drawCurrent, gs]);

  const finalizePendingRoom = useCallback((name: string) => {
    if (!pendingRoom) return;
    const newRoom: RoomData = { id: uid("room"), ...pendingRoom, name, fill: "#fff3ed" };
    const roomWalls = wallsForRoom(newRoom);
    push({ ...state, rooms: [...state.rooms, newRoom], walls: [...state.walls, ...roomWalls] });
    if (onCreateRoom) {
      const widthFt = Math.round((pendingRoom.width / gs) * 10) / 10;
      const heightFt = Math.round((pendingRoom.height / gs) * 10) / 10;
      onCreateRoom(name, { width: widthFt, height: heightFt });
    }
    setPendingRoom(null);
    // Auto-switch back to select so user can pan/interact
    setTool("select");
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
    if (type === "wall") {
      const wall = state.walls.find((w) => w.id === id);
      if (!wall) return;
      // newPos is the drag offset from the Group's original position (0,0)
      const dx = snapToGrid(newPos.x, gs);
      const dy = snapToGrid(newPos.y, gs);
      if (dx === 0 && dy === 0) return;
      const updatedWall = { ...wall, x1: wall.x1 + dx, y1: wall.y1 + dy, x2: wall.x2 + dx, y2: wall.y2 + dy };
      push({ ...state, walls: state.walls.map((w) => (w.id === id ? updatedWall : w)) });
    }
  }, [state, push, gs]);

  /* ---------------------------------------------------------------- */
  /*  Auto-pan when dragging near viewport edges                       */
  /* ---------------------------------------------------------------- */

  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const node = e.target;
    // Get the node's absolute position on screen
    const absPos = node.getAbsolutePosition();
    const edgePad = 40; // px from edge to start panning
    const panSpeed = 8;
    let dx = 0, dy = 0;
    if (absPos.x < edgePad) dx = panSpeed;
    if (absPos.x > stageSize.width - edgePad) dx = -panSpeed;
    if (absPos.y < edgePad) dy = panSpeed;
    if (absPos.y > stageSize.height - edgePad) dy = -panSpeed;
    if (dx !== 0 || dy !== 0) {
      setStagePos((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    }
  }, [stageSize]);

  /* ---------------------------------------------------------------- */
  /*  Computed values                                                  */
  /* ---------------------------------------------------------------- */

  // Compute grid lines that cover the entire visible viewport (accounting for pan + zoom)
  const gridBounds = useMemo(() => {
    const s = stageScale;
    // Convert viewport corners to canvas coordinates
    const x0 = -stagePos.x / s;
    const y0 = -stagePos.y / s;
    const x1 = (stageSize.width - stagePos.x) / s;
    const y1 = (stageSize.height - stagePos.y) / s;
    // Snap to grid boundaries with padding
    const pad = gs * 2;
    return {
      left: Math.floor((x0 - pad) / gs) * gs,
      top: Math.floor((y0 - pad) / gs) * gs,
      right: Math.ceil((x1 + pad) / gs) * gs,
      bottom: Math.ceil((y1 + pad) / gs) * gs,
    };
  }, [stageSize, stageScale, stagePos, gs]);

  const gridLines = useMemo(() => {
    const { left, top, right, bottom } = gridBounds;
    const lines: Array<{ points: number[]; vertical: boolean }> = [];
    for (let x = left; x <= right; x += gs) lines.push({ points: [x, top, x, bottom], vertical: true });
    for (let y = top; y <= bottom; y += gs) lines.push({ points: [left, y, right, y], vertical: false });
    return lines;
  }, [gridBounds, gs]);

  function feetLabel(pixels: number): string {
    return `${(Math.abs(pixels) / gs).toFixed(1)} ft`;
  }

  const wallMap = useMemo(() => {
    const map = new Map<string, WallData>();
    for (const w of state.walls) map.set(w.id, w);
    return map;
  }, [state.walls]);

  const isEmpty = state.rooms.length === 0 && state.walls.length === 0;

  const handleToolChange = useCallback((t: ToolType) => {
    setTool(t);
    setSelectedId(null);
    setDrawStart(null);
    setWallStart(null);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex flex-col h-full">
      {!readOnly && (
        <FloorPlanToolbar
          tool={tool}
          onToolChange={handleToolChange}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          stageScale={stageScale}
          onZoomIn={() => setStageScale((s) => Math.min(3, s * 1.2))}
          onZoomOut={() => setStageScale((s) => Math.max(0.3, s / 1.2))}
          onFit={() => { setStageScale(1); setStagePos({ x: 0, y: 0 }); }}
          stageRef={stageRef}
        />
      )}

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

        {pendingRoom && (
          <FloorPlanRoomPicker
            existingRooms={state.rooms}
            propertyRooms={propertyRooms}
            onSelect={finalizePendingRoom}
            onCancel={() => setPendingRoom(null)}
          />
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
            if (e.target === stageRef.current) setStagePos({ x: e.target.x(), y: e.target.y() });
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
          style={{ cursor: tool === "room" || tool === "wall" ? "crosshair" : tool === "delete" ? "not-allowed" : "default" }}
        >
          {/* Grid layer — extends to fill visible viewport */}
          <Layer listening={false}>
            <Rect name="grid-bg" x={gridBounds.left} y={gridBounds.top} width={gridBounds.right - gridBounds.left} height={gridBounds.bottom - gridBounds.top} fill="#ffffff" />
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
                onDragMove={handleDragMove}
                onDragEnd={(e) => handleDragEnd("room", room.id, { x: e.target.x(), y: e.target.y() })}
                onClick={() => { if (tool === "select") setSelectedId(room.id); if (tool === "delete") deleteElement(room.id); }}
                onTap={() => { if (tool === "select") setSelectedId(room.id); if (tool === "delete") deleteElement(room.id); }}
              >
                <Rect
                  width={room.width} height={room.height}
                  fill={room.fill}
                  stroke={selectedId === room.id ? "#5b6abf" : "#e85d26"}
                  strokeWidth={selectedId === room.id ? 3 : 2}
                  elementId={room.id}
                />
                <Text x={room.width / 2} y={room.height / 2 - 8} text={room.name}
                  fontSize={13} fontFamily="var(--font-geist-mono), monospace" fill="#1a1a1a" align="center" offsetX={room.name.length * 3.5} />
                <Text x={room.width / 2} y={-14} text={feetLabel(room.width)}
                  fontSize={11} fontFamily="var(--font-geist-mono), monospace" fill="#6b6560" align="center" offsetX={feetLabel(room.width).length * 3} />
                <Text x={-14} y={room.height / 2} text={feetLabel(room.height)}
                  fontSize={11} fontFamily="var(--font-geist-mono), monospace" fill="#6b6560" rotation={-90} offsetX={feetLabel(room.height).length * 3} />
                {selectedId === room.id && (
                  <>
                    {[{ cx: 0, cy: 0 }, { cx: room.width, cy: 0 }, { cx: room.width, cy: room.height }, { cx: 0, cy: room.height }].map((h, i) => (
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
                  x={Math.min(drawStart.x, drawCurrent.x)} y={Math.min(drawStart.y, drawCurrent.y)}
                  width={Math.abs(drawCurrent.x - drawStart.x)} height={Math.abs(drawCurrent.y - drawStart.y)}
                  fill="#fff3ed" stroke="#e85d26" strokeWidth={2} dash={[6, 4]} opacity={0.7}
                />
                <Text
                  x={(drawStart.x + drawCurrent.x) / 2} y={Math.min(drawStart.y, drawCurrent.y) - 18}
                  text={`${feetLabel(drawCurrent.x - drawStart.x)} x ${feetLabel(drawCurrent.y - drawStart.y)}`}
                  fontSize={12} fontFamily="var(--font-geist-mono), monospace" fill="#e85d26" align="center" offsetX={60}
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
              const isStandalone = !wall.roomId;
              return (
                <Group
                  key={wall.id}
                  draggable={tool === "select" && !readOnly && isStandalone}
                  onDragEnd={(e) => { if (isStandalone) handleDragEnd("wall", wall.id, { x: e.target.x(), y: e.target.y() }); e.target.position({ x: 0, y: 0 }); }}
                >
                  <Line
                    points={[wall.x1, wall.y1, wall.x2, wall.y2]}
                    stroke={selectedId === wall.id ? "#5b6abf" : "#1a1a1a"}
                    strokeWidth={wall.thickness} lineCap="round" hitStrokeWidth={12}
                    elementId={wall.id}
                    onClick={() => { if (tool === "select") setSelectedId(wall.id); if (tool === "delete") deleteElement(wall.id); }}
                    onTap={() => { if (tool === "select") setSelectedId(wall.id); if (tool === "delete") deleteElement(wall.id); }}
                  />
                  {!wall.roomId && len > 30 && (
                    <Text x={midX} y={midY - 14} text={feetLabel(len)}
                      fontSize={11} fontFamily="var(--font-geist-mono), monospace" fill="#6b6560" offsetX={feetLabel(len).length * 3} />
                  )}
                </Group>
              );
            })}

            {/* Wall drawing preview */}
            {tool === "wall" && wallStart && drawCurrent && (
              <Group>
                <Line points={[wallStart.x, wallStart.y, drawCurrent.x, drawCurrent.y]} stroke="#1a1a1a" strokeWidth={4} dash={[6, 4]} opacity={0.6} />
                <Text
                  x={(wallStart.x + drawCurrent.x) / 2} y={(wallStart.y + drawCurrent.y) / 2 - 16}
                  text={feetLabel(Math.hypot(drawCurrent.x - wallStart.x, drawCurrent.y - wallStart.y))}
                  fontSize={12} fontFamily="var(--font-geist-mono), monospace" fill="#e85d26" offsetX={20}
                />
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
              const swing: 0 | 1 | 2 | 3 = typeof door.swing === "number" ? door.swing : (door.swing === "left" ? 0 : 2);
              const hingeX = (swing === 0 || swing === 1) ? -doorPx / 2 : doorPx / 2;
              const leafDir = (swing === 0 || swing === 3) ? -1 : 1;
              const isSelected = selectedId === door.id;
              const handleDoorInteract = () => {
                if (tool === "select") {
                  if (isSelected) {
                    push({ ...state, doors: state.doors.map((d) => d.id === door.id ? { ...d, swing: ((swing + 1) % 4) as 0 | 1 | 2 | 3 } : d) });
                  } else {
                    setSelectedId(door.id);
                  }
                }
                if (tool === "delete") deleteElement(door.id);
              };
              return (
                <Group
                  key={door.id} x={px} y={py} rotation={(angle * 180) / Math.PI}
                  draggable={tool === "select" && !readOnly}
                  onClick={handleDoorInteract} onTap={handleDoorInteract}
                  onDragMove={(e) => {
                    if (tool !== "select") return;
                    const t = projectOntoWall(e.target.x(), e.target.y(), wall);
                    if (t === null) return;
                    e.target.x(wall.x1 + t * (wall.x2 - wall.x1));
                    e.target.y(wall.y1 + t * (wall.y2 - wall.y1));
                  }}
                  onDragEnd={(e) => {
                    if (tool !== "select") return;
                    const t = projectOntoWall(e.target.x(), e.target.y(), wall);
                    if (t === null) return;
                    push({ ...state, doors: state.doors.map((d) => d.id === door.id ? { ...d, position: t } : d) });
                  }}
                >
                  <Rect x={-doorPx / 2 - 5} y={-doorPx - 5} width={doorPx + 10} height={doorPx * 2 + 10} fill="transparent" hitStrokeWidth={0} />
                  <Line points={[-doorPx / 2, 0, doorPx / 2, 0]} stroke="#ffffff" strokeWidth={6} />
                  <Line points={[hingeX, 0, hingeX, doorPx * 0.75 * leafDir]} stroke="#1a1a1a" strokeWidth={2.5} lineCap="round" />
                  <Arc
                    x={hingeX} y={0} innerRadius={doorPx * 0.73} outerRadius={doorPx * 0.75} angle={90}
                    rotation={swing === 0 ? -90 : swing === 1 ? 0 : swing === 2 ? 90 : 180}
                    fill="transparent" stroke="#1a1a1a" strokeWidth={1} opacity={0.5}
                  />
                  {isSelected && <Circle x={0} y={0} radius={7} fill="#5b6abf" stroke="#ffffff" strokeWidth={2.5} />}
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
                  key={win.id} x={px} y={py} rotation={(angle * 180) / Math.PI}
                  draggable={tool === "select" && !readOnly}
                  onClick={() => { if (tool === "select") setSelectedId(win.id); if (tool === "delete") deleteElement(win.id); }}
                  onTap={() => { if (tool === "select") setSelectedId(win.id); if (tool === "delete") deleteElement(win.id); }}
                  onDragMove={(e) => {
                    if (tool !== "select") return;
                    const t = projectOntoWall(e.target.x(), e.target.y(), wall);
                    if (t === null) return;
                    e.target.x(wall.x1 + t * (wall.x2 - wall.x1));
                    e.target.y(wall.y1 + t * (wall.y2 - wall.y1));
                  }}
                  onDragEnd={(e) => {
                    if (tool !== "select") return;
                    const t = projectOntoWall(e.target.x(), e.target.y(), wall);
                    if (t === null) return;
                    push({ ...state, windows: state.windows.map((w) => w.id === win.id ? { ...w, position: t } : w) });
                  }}
                >
                  <Rect x={-winPx / 2 - 5} y={-22} width={winPx + 10} height={44} fill="transparent" hitStrokeWidth={0} />
                  <Line points={[-winPx / 2, 0, winPx / 2, 0]} stroke="#ffffff" strokeWidth={6} />
                  <Line points={[-winPx / 2, -3, winPx / 2, -3]} stroke="#5b6abf" strokeWidth={2} />
                  <Line points={[-winPx / 2, 3, winPx / 2, 3]} stroke="#5b6abf" strokeWidth={2} />
                  {isSelected && <Circle x={0} y={0} radius={7} fill="#5b6abf" stroke="#ffffff" strokeWidth={2.5} />}
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>

      {!readOnly && (
        <FloorPlanSidebar
          state={state}
          gridSize={gs}
          tool={tool}
          selectedId={selectedId}
          propertyRooms={propertyRooms}
          jobId={jobId}
        />
      )}
      </div>
    </div>
  );
});

export default KonvaFloorPlan;
