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
  magneticRoomSnap,
  detectSharedWalls,
  polygonCentroid,
  polygonBoundingBox,
  polygonToKonvaPoints,
} from "./floor-plan-tools";
import { FloorPlanToolbar } from "./floor-plan-toolbar";
import { FloorPlanSidebar } from "./floor-plan-sidebar";
import { RoomConfirmationCard, type RoomConfirmationData } from "./room-confirmation-card";
import { WallContextMenu } from "./wall-context-menu";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface KonvaFloorPlanHandle {
  flush: () => void;
  clearSelection: () => void;
  /** Gate 4: Convert a rectangle room into a polygon room in place (adds the
   *  4 corners to `points`). Once converted, the room renders with vertex
   *  drag handles instead of corner resize handles. No-op if already a polygon. */
  convertRoomToPolygon: (roomId: string) => void;
  /** Read the canvas's latest in-memory state without going through the debounce
   *  or onChange callback. Used during forced remounts (e.g. auto-Main create)
   *  to capture the user's pending edits before the unmount kills the timer. */
  getCurrentState: () => FloorPlanData;
}

interface KonvaFloorPlanProps {
  initialData?: FloorPlanData | null;
  onChange?: (data: FloorPlanData) => void;
  readOnly?: boolean;
  rooms?: Array<{ id: string; room_name: string; affected?: boolean }>;
  onCreateRoom?: (
    name: string,
    dimensions?: { width: number; height: number },
    metadata?: {
      roomType?: string | null;
      ceilingHeight?: number;
      ceilingType?: string;
      floorLevel?: string | null;
      materialFlags?: string[];
      affected?: boolean;
    },
  ) => void;
  jobId?: string;
  onSelectionChange?: (info: { selectedId: string; type: "room"; name: string; widthFt: number; heightFt: number; propertyRoomId?: string; isPolygon?: boolean } | null) => void;
  onEditRoom?: () => void;
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
/*  Mobile Opening Editor (swipe-to-close bottom sheet)                */
/* ------------------------------------------------------------------ */

function MobileOpeningEditor({ type, isOpening, width, height, onWidthChange, onHeightChange, onClose }: {
  type: string;
  isOpening: boolean;
  width: number;
  height: number;
  onWidthChange: (v: number) => void;
  onHeightChange: (v: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  const dragging = useRef(false);
  const [widthStr, setWidthStr] = useState(String(width));
  const [heightStr, setHeightStr] = useState(String(height));

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.touches[0].clientY > rect.top + 40) return;
    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    dragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging.current || !panelRef.current) return;
    currentY.current = e.touches[0].clientY;
    const delta = Math.max(0, currentY.current - startY.current);
    panelRef.current.style.transform = `translateY(${delta}px)`;
    panelRef.current.style.transition = "none";
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!dragging.current || !panelRef.current) return;
    dragging.current = false;
    if (currentY.current - startY.current > 60) {
      panelRef.current.style.transition = "transform 200ms ease-out";
      panelRef.current.style.transform = "translateY(100%)";
      setTimeout(onClose, 200);
    } else {
      panelRef.current.style.transition = "transform 150ms ease-out";
      panelRef.current.style.transform = "translateY(0)";
    }
  }, [onClose]);

  return (
    <div className="md:hidden fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/10" onClick={onClose} />
      <div
        ref={panelRef}
        className="absolute left-0 right-0 bottom-0 bg-surface-container-lowest rounded-t-2xl shadow-[0_-4px_20px_rgba(31,27,23,0.12)] pb-[env(safe-area-inset-bottom)]"
        style={{ transform: "translateY(0)", transition: "transform 200ms ease-out" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-outline-variant/40" />
        </div>
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-[14px] font-semibold text-on-surface">{type}</h3>
            {isOpening && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-[family-name:var(--font-geist-mono)]">Missing Wall</span>
            )}
          </div>
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1">Width (ft)</p>
              <input
                type="text"
                inputMode="decimal"
                value={widthStr}
                placeholder={String(width)}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  setWidthStr(e.target.value);
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) onWidthChange(v);
                }}
                className="w-full h-9 px-3 rounded-lg border border-outline-variant text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] outline-none focus:border-brand-accent"
              />
            </div>
            <div className="flex-1">
              <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1">Height (ft)</p>
              <input
                type="text"
                inputMode="decimal"
                value={heightStr}
                placeholder={String(height)}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  setHeightStr(e.target.value);
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) onHeightChange(v);
                }}
                className="w-full h-9 px-3 rounded-lg border border-outline-variant text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] outline-none focus:border-brand-accent"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full h-10 rounded-full bg-brand-accent text-on-primary text-[13px] font-semibold cursor-pointer active:scale-[0.98] transition-all"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const KonvaFloorPlan = forwardRef<KonvaFloorPlanHandle, KonvaFloorPlanProps>(function KonvaFloorPlan({ initialData, onChange, readOnly = false, rooms: propertyRooms, onCreateRoom, jobId, onSelectionChange, onEditRoom }, ref) {
  // Merge defaults UNDER initialData so a partial canvas_data (e.g. an empty
  // {} from a freshly-created floor shell) still gets walls/rooms/doors/windows
  // arrays. Without this, state.walls is undefined and every iteration crashes.
  const data: FloorPlanData = { ...emptyFloorPlan(), ...(initialData ?? {}) };
  const { state, push, undo, redo, canUndo, canRedo } = useUndoRedo(data);
  const [tool, setTool] = useState<ToolType>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wallContextMenu, setWallContextMenu] = useState<{ wallId: string; x: number; y: number } | null>(null);
  // Affected Mode overlay — when on, rooms/walls NOT flagged as "affected" fade
  // to ~25% so the mitigation scope stands out visually. Purely a rendering
  // toggle; doesn't change any data.
  const [affectedOverlay, setAffectedOverlay] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  // Close wall context menu when selection changes away from that wall
  useEffect(() => {
    if (wallContextMenu && selectedId !== wallContextMenu.wallId) {
      setWallContextMenu(null);
    }
  }, [selectedId, wallContextMenu]);

  // Notify parent of selection changes (for mobile bottom panel). MUST fire
  // ONLY when selectedId actually changes — NOT on state.rooms updates, NOT
  // on callback reference changes. Every vertex drag updates state.rooms AND
  // (via invalidateQueries cascade) causes the parent's handleSelectionChange
  // useCallback to get a new reference. If either is in deps, the effect
  // re-fires, re-opens the MobileRoomPanel that the user dismissed via
  // "Reshape", and drops the edit panel over the canvas mid-drag.
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    const cb = onSelectionChangeRef.current;
    if (!cb) return;
    if (!selectedId) { cb(null); return; }
    const s = latestStateRef.current;
    const room = s.rooms.find((r) => r.id === selectedId);
    if (!room) { cb(null); return; }
    const g = s.gridSize;
    cb({
      selectedId,
      type: "room",
      name: room.name,
      widthFt: Math.round((room.width / g) * 10) / 10,
      heightFt: Math.round((room.height / g) * 10) / 10,
      propertyRoomId: room.propertyRoomId,
      isPolygon: !!room.points && room.points.length >= 3,
    });
  }, [selectedId]);

  // Drawing state
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [wallStart, setWallStart] = useState<{ x: number; y: number } | null>(null);
  // E6 trace tool: vertex list for the in-progress polygon. Tapping close to
  // the first point (when >= 3 vertices exist) closes the polygon and opens
  // the room confirmation card. Escape cancels.
  const [traceVertices, setTraceVertices] = useState<Array<{ x: number; y: number }>>([]);
  const TRACE_CLOSE_THRESHOLD_PX = 15;
  // Gate 4: tracks which vertex is currently being grabbed, for visual feedback
  // (larger, orange, deeper shadow while dragged — makes the interaction legible).
  const [activeVertex, setActiveVertex] = useState<{ roomId: string; index: number } | null>(null);
  // Gate 4 live preview: during a vertex drag, these coords override the stored
  // vertex position so the polygon fill + walls visually follow the finger
  // instead of staying static until drag end. Commits to state on drag end.
  const [vertexDragPreview, setVertexDragPreview] = useState<{ roomId: string; index: number; x: number; y: number } | null>(null);

  // Room naming picker
  const [pendingRoom, setPendingRoom] = useState<{
    x: number; y: number; width: number; height: number;
    /** If present, the pending room is a polygon (from the trace tool).
     *  Otherwise it's a rectangle drawn via click-drag. */
    points?: Array<{ x: number; y: number }>;
  } | null>(null);

  // Zoom/pan state
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  // Long-press resize mode for mobile
  const [resizeActive, setResizeActive] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up long-press timer on unmount
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

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

  // Gate 4 live preview: derive "display" rooms + walls that reflect an
  // in-progress vertex drag. If no drag is active, these are identity passthroughs.
  const displayRooms = useMemo(() => {
    if (!vertexDragPreview) return state.rooms;
    return state.rooms.map((r) => {
      if (r.id !== vertexDragPreview.roomId || !r.points) return r;
      const newPoints = r.points.map((p, idx) =>
        idx === vertexDragPreview.index ? { x: vertexDragPreview.x, y: vertexDragPreview.y } : p,
      );
      const bb = polygonBoundingBox(newPoints);
      return { ...r, points: newPoints, x: bb.x, y: bb.y, width: bb.width, height: bb.height };
    });
  }, [state.rooms, vertexDragPreview]);

  const displayWalls = useMemo(() => {
    if (!vertexDragPreview) return state.walls;
    const room = state.rooms.find((r) => r.id === vertexDragPreview.roomId);
    if (!room || !room.points) return state.walls;
    const oldV = room.points[vertexDragPreview.index];
    if (!oldV) return state.walls;
    const newV = { x: vertexDragPreview.x, y: vertexDragPreview.y };
    return state.walls.map((w) => {
      if (w.roomId !== vertexDragPreview.roomId) return w;
      let changed = w;
      if (Math.abs(w.x1 - oldV.x) < 0.5 && Math.abs(w.y1 - oldV.y) < 0.5) {
        changed = { ...changed, x1: newV.x, y1: newV.y };
      }
      if (Math.abs(w.x2 - oldV.x) < 0.5 && Math.abs(w.y2 - oldV.y) < 0.5) {
        changed = { ...changed, x2: newV.x, y2: newV.y };
      }
      return changed;
    });
  }, [state.walls, state.rooms, vertexDragPreview]);

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
    // eslint-disable-next-line no-console
    console.log("[autosave] state changed, debounce started", { rooms: state.rooms.length, walls: state.walls.length });
    saveTimer.current = setTimeout(() => {
      hasPendingRef.current = false;
      // eslint-disable-next-line no-console
      console.log("[autosave] 2s timer fired, calling onChange");
      onChangeRef.current?.(latestStateRef.current);
    }, 2000);
    return () => {
      if (saveTimer.current) {
        // eslint-disable-next-line no-console
        console.log("[autosave] cleanup ran, clearing pending timer");
        clearTimeout(saveTimer.current);
      }
    };
    // onChange is read via onChangeRef (not from deps) so parent re-renders don't kill the timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const pushRef = useRef(push);
  pushRef.current = push;

  useImperativeHandle(ref, () => ({
    flush() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      // ALWAYS fire onChange (not just when hasPending). User clicked Save —
      // they want to save NOW, regardless of whether the debounce thinks
      // there are pending changes. Idempotent on the backend (Case 2 update
      // in place) so re-firing doesn't break anything.
      if (onChangeRef.current) {
        // eslint-disable-next-line no-console
        console.log("[autosave] flush() called → forcing save", { hadPending: hasPendingRef.current, rooms: latestStateRef.current.rooms.length });
        hasPendingRef.current = false;
        onChangeRef.current(latestStateRef.current);
      }
    },
    getCurrentState() {
      return latestStateRef.current;
    },
    clearSelection() {
      setSelectedId(null);
      setWallContextMenu(null);
    },
    convertRoomToPolygon(roomId: string) {
      const s = latestStateRef.current;
      const room = s.rooms.find((r) => r.id === roomId);
      if (!room) return;
      if (room.points && room.points.length >= 3) return; // already a polygon
      // 4 corners of the bounding rectangle, CCW starting top-left.
      const points = [
        { x: room.x, y: room.y },
        { x: room.x + room.width, y: room.y },
        { x: room.x + room.width, y: room.y + room.height },
        { x: room.x, y: room.y + room.height },
      ];
      const updated: RoomData = { ...room, points };
      pushRef.current({
        ...s,
        rooms: s.rooms.map((r) => (r.id === roomId ? updated : r)),
      });
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
        setTraceVertices([]);
        setTool("select");
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIdRef.current) deleteElementRef.current(selectedIdRef.current);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      // Arrow keys move selected element (1ft per press, Shift = 0.5ft)
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && selectedIdRef.current) {
        e.preventDefault();
        const step = e.shiftKey ? gs / 2 : gs;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        moveSelectedRef.current(dx, dy);
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

    // Close wall context menu on any canvas interaction
    setWallContextMenu(null);

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

    if (tool === "trace") {
      const snapX = snapToGrid(pos.x, gs);
      const snapY = snapToGrid(pos.y, gs);
      // If 3+ vertices down and this tap is close to the start vertex → close polygon.
      if (traceVertices.length >= 3) {
        const first = traceVertices[0];
        if (Math.hypot(snapX - first.x, snapY - first.y) < TRACE_CLOSE_THRESHOLD_PX) {
          const bb = polygonBoundingBox(traceVertices);
          setPendingRoom({ x: bb.x, y: bb.y, width: bb.width, height: bb.height, points: traceVertices });
          setTraceVertices([]);
          return;
        }
      }
      setTraceVertices((prev) => [...prev, { x: snapX, y: snapY }]);
      return;
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

    if (tool === "door" || tool === "window" || tool === "opening") {
      const hit = findNearestWall(pos.x, pos.y, state.walls);
      if (hit) {
        if (tool === "door") {
          const newId = uid("door");
          push({ ...state, doors: [...state.doors, { id: newId, wallId: hit.wall.id, position: hit.t, width: 3, swing: 0 }] });
          setSelectedId(newId);
        } else if (tool === "opening") {
          const newId = uid("opening");
          push({ ...state, windows: [...state.windows, { id: newId, wallId: hit.wall.id, position: hit.t, width: 4 }] });
          setSelectedId(newId);
        } else {
          const newId = uid("win");
          push({ ...state, windows: [...state.windows, { id: newId, wallId: hit.wall.id, position: hit.t, width: 3 }] });
          setSelectedId(newId);
        }
        setTool("select");
      }
    }

    if (tool === "select") {
      const target = e.target;
      if (target === stageRef.current || (target.getClassName() === "Rect" && target.attrs.name === "grid-bg")) {
        setSelectedId(null);
        setResizeActive(false);
      }
    }

    if (tool === "delete") {
      const id = e.target.attrs?.elementId;
      if (id) deleteElement(id);
    }
  }, [tool, readOnly, getPos, gs, state, push, wallStart, traceVertices, deleteElement]);

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
    // E6: track cursor during trace so the rubber-band segment + close-snap
    // affordance (the big ring on the first vertex when cursor is close) stay live.
    if (tool === "trace" && traceVertices.length > 0) {
      setDrawCurrent({ x: snapToGrid(pos.x, gs), y: snapToGrid(pos.y, gs) });
    }
  }, [tool, readOnly, getPos, gs, drawStart, wallStart, traceVertices.length, state.walls]);

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

  const finalizePendingRoom = useCallback((data: RoomConfirmationData) => {
    if (!pendingRoom) return;
    // eslint-disable-next-line no-console
    console.log("[autosave] finalizePendingRoom CALLED", { name: data.name });
    const newRoom: RoomData = {
      id: uid("room"),
      x: pendingRoom.x,
      y: pendingRoom.y,
      width: pendingRoom.width,
      height: pendingRoom.height,
      // Preserve polygon points for traced rooms so they render as polygons
      // rather than rectangles (E1 unified model).
      points: pendingRoom.points,
      name: data.name,
      fill: data.affected ? "#fee2e2" : "#fff3ed",
      propertyRoomId: data.propertyRoomId,
    };
    const roomWalls = wallsForRoom(newRoom);
    // New room may instantly be adjacent to an existing room — run shared-wall
    // detection on the merged list so shared edges get flagged from the start.
    const allWalls = detectSharedWalls([...state.walls, ...roomWalls]);
    const newState = { ...state, rooms: [...state.rooms, newRoom], walls: allWalls };
    // Pre-emptively mark prevStateRef as the new state. Without this, the
    // useEffect[state] would see the post-push state as "changed" and start
    // a fresh 2s debounce timer, causing a duplicate POST after our immediate
    // save below. Setting prevStateRef now makes the effect bail on its
    // `state === prevStateRef.current` reference check.
    prevStateRef.current = newState;
    push(newState);
    if (onCreateRoom) {
      const widthFt = Math.round((pendingRoom.width / gs) * 10) / 10;
      const heightFt = Math.round((pendingRoom.height / gs) * 10) / 10;
      // Pass the form's full metadata so the backend room row gets the user's
      // chosen floor_level / room_type / ceiling / etc. Without this, the form
      // collects everything but only name + dimensions reach the database.
      onCreateRoom(data.name, { width: widthFt, height: heightFt }, {
        roomType: data.roomType,
        ceilingHeight: data.ceilingHeight,
        ceilingType: data.ceilingType,
        floorLevel: data.floorLevel,
        materialFlags: data.materialFlags,
        affected: data.affected,
      });
    }
    // Force-save immediately — confirming a room is a discrete user action,
    // not a free-form canvas tweak. Cancel any pending debounce timer so it
    // can't double-fire later.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (onChangeRef.current) {
      // eslint-disable-next-line no-console
      console.log("[autosave] finalizePendingRoom → calling onChange immediately", { rooms: newState.rooms.length });
      onChangeRef.current(newState);
      hasPendingRef.current = false;
    } else {
      // eslint-disable-next-line no-console
      console.warn("[autosave] finalizePendingRoom: onChangeRef is null, save will not fire!");
    }
    setPendingRoom(null);
    setTool("select");
  }, [pendingRoom, state, push, onCreateRoom, gs]);

  /* ---------------------------------------------------------------- */
  /*  Drag handlers for select tool                                    */
  /* ---------------------------------------------------------------- */

  const handleDragEnd = useCallback((type: "room" | "wall", id: string, newPos: { x: number; y: number }) => {
    if (type === "room") {
      const room = state.rooms.find((r) => r.id === id);
      if (!room) return;
      const isPolygon = !!room.points && room.points.length >= 3;

      // For polygon rooms the Group starts at (0,0) with absolute points,
      // so e.target.x()/y() IS the delta. Snap that delta to grid.
      // For rect rooms the Group starts at (room.x, room.y), so newPos is
      // the absolute new position and delta = snapped - original.
      let dx: number, dy: number;
      if (isPolygon) {
        dx = snapToGrid(newPos.x, gs);
        dy = snapToGrid(newPos.y, gs);
      } else {
        const gridX = snapToGrid(newPos.x, gs);
        const gridY = snapToGrid(newPos.y, gs);
        const snapped = magneticRoomSnap(id, gridX, gridY, room.width, room.height, state.rooms);
        dx = snapped.x - room.x;
        dy = snapped.y - room.y;
      }

      // Build updated room: translate bbox and, for polygons, the points array.
      const updatedRoom: RoomData = {
        ...room,
        x: room.x + dx,
        y: room.y + dy,
        points: isPolygon ? room.points!.map((p) => ({ x: p.x + dx, y: p.y + dy })) : room.points,
      };
      const shiftedWalls = state.walls.map((w) =>
        w.roomId === id ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy } : w
      );
      // Re-run shared-wall detection so adjacent edges get re-flagged.
      const updatedWalls = detectSharedWalls(shiftedWalls);
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
  /*  Room resize via corner handles                                   */
  /* ---------------------------------------------------------------- */

  const handleCornerDragEnd = useCallback((roomId: string, cornerIdx: number, newX: number, newY: number) => {
    const room = state.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const sx = snapToGrid(newX, gs);
    const sy = snapToGrid(newY, gs);
    const minSize = gs; // minimum 1 foot

    let x = room.x, y = room.y, w = room.width, h = room.height;
    // cornerIdx: 0=topLeft, 1=topRight, 2=bottomRight, 3=bottomLeft
    if (cornerIdx === 0) { // top-left: move origin, adjust size
      w = room.x + room.width - sx;
      h = room.y + room.height - sy;
      x = sx; y = sy;
    } else if (cornerIdx === 1) { // top-right: adjust width + move top
      w = sx - room.x;
      h = room.y + room.height - sy;
      y = sy;
    } else if (cornerIdx === 2) { // bottom-right: adjust width + height
      w = sx - room.x;
      h = sy - room.y;
    } else { // bottom-left: move left, adjust height
      w = room.x + room.width - sx;
      h = sy - room.y;
      x = sx;
    }
    if (w < minSize || h < minSize) return; // reject too-small

    const updatedRoom = { ...room, x, y, width: w, height: h };
    // Rebuild walls for this room
    const newWalls = state.walls.filter((wr) => wr.roomId !== roomId);
    newWalls.push(...wallsForRoom(updatedRoom));
    push({ ...state, rooms: state.rooms.map((r) => r.id === roomId ? updatedRoom : r), walls: newWalls });
  }, [state, push, gs]);

  /**
   * E2/E6 Gate 4: Polygon vertex editing. When user drags a single vertex
   * handle on a selected polygon room, only THAT vertex moves and the two
   * walls adjacent to it (wall[i-1] and wall[i]) get their coords updated in
   * place — same wall IDs. This preserves any doors / windows / openings
   * attached to those walls via wallId (their parametric position along the
   * wall still lands on the wall, just at the new length).
   */
  const handleVertexDragEnd = useCallback((roomId: string, vertexIdx: number, newX: number, newY: number) => {
    const room = state.rooms.find((r) => r.id === roomId);
    if (!room || !room.points || room.points.length < 3) return;
    if (vertexIdx < 0 || vertexIdx >= room.points.length) return;

    const sx = snapToGrid(newX, gs);
    const sy = snapToGrid(newY, gs);
    const oldVertex = room.points[vertexIdx];
    if (Math.abs(oldVertex.x - sx) < 0.5 && Math.abs(oldVertex.y - sy) < 0.5) return;

    // Updated polygon points
    const newPoints = room.points.map((p, i) => (i === vertexIdx ? { x: sx, y: sy } : p));
    const bb = polygonBoundingBox(newPoints);
    const updatedRoom: RoomData = {
      ...room,
      points: newPoints,
      x: bb.x, y: bb.y, width: bb.width, height: bb.height,
    };

    // Update the two walls touching this vertex — same IDs, only endpoints
    // shift. Doors/windows/openings keep their parametric position and ride
    // along. Match walls by endpoint coords (walls belonging to this room).
    const updatedWalls = state.walls.map((w) => {
      if (w.roomId !== roomId) return w;
      let changed = w;
      if (Math.abs(w.x1 - oldVertex.x) < 0.5 && Math.abs(w.y1 - oldVertex.y) < 0.5) {
        changed = { ...changed, x1: sx, y1: sy };
      }
      if (Math.abs(w.x2 - oldVertex.x) < 0.5 && Math.abs(w.y2 - oldVertex.y) < 0.5) {
        changed = { ...changed, x2: sx, y2: sy };
      }
      return changed;
    });

    // Re-run shared detection since geometry changed
    const finalWalls = detectSharedWalls(updatedWalls);
    push({ ...state, rooms: state.rooms.map((r) => (r.id === roomId ? updatedRoom : r)), walls: finalWalls });
  }, [state, push, gs]);

  /** Insert a vertex on a polygon edge — enables L-shape creation. Finds
   *  which edge the tap lands on (closest edge within tolerance) and inserts
   *  a new vertex there. The adjacent wall is split into two walls (new IDs).
   *  Call when the user taps on an edge of a SELECTED polygon. */
  const handleInsertVertex = useCallback((roomId: string, tapX: number, tapY: number) => {
    const room = state.rooms.find((r) => r.id === roomId);
    if (!room || !room.points || room.points.length < 3) return;

    // Find the closest edge to the tap — project the tap onto each edge and
    // pick the segment with the smallest perpendicular distance.
    let bestEdgeIdx = -1;
    let bestDist = Infinity;
    let bestProj: { x: number; y: number } | null = null;
    for (let i = 0; i < room.points.length; i++) {
      const a = room.points[i];
      const b = room.points[(i + 1) % room.points.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0.05, Math.min(0.95, ((tapX - a.x) * dx + (tapY - a.y) * dy) / len2));
      const px = a.x + t * dx, py = a.y + t * dy;
      const d = Math.hypot(tapX - px, tapY - py);
      if (d < bestDist) {
        bestDist = d;
        bestEdgeIdx = i;
        bestProj = { x: px, y: py };
      }
    }
    // Only insert if the tap is reasonably close to an edge (20px tolerance)
    if (bestEdgeIdx < 0 || !bestProj || bestDist > 20) return;

    // Don't insert if the tap is close to an existing vertex — the user is
    // probably trying to GRAB the vertex, not add a new one next to it.
    // (Happens on web mostly, where taps near the handle miss the handle's
    // hit area and fall on the wall instead.)
    const VERTEX_GUARD_PX = 18;
    const tooCloseToExisting = room.points.some(
      (p) => Math.hypot(p.x - bestProj!.x, p.y - bestProj!.y) < VERTEX_GUARD_PX,
    );
    if (tooCloseToExisting) return;

    // Snap the insertion point to the grid
    const insertX = snapToGrid(bestProj.x, gs);
    const insertY = snapToGrid(bestProj.y, gs);

    // Insert the new vertex after bestEdgeIdx
    const newPoints = [...room.points];
    newPoints.splice(bestEdgeIdx + 1, 0, { x: insertX, y: insertY });

    const bb = polygonBoundingBox(newPoints);
    const updatedRoom: RoomData = {
      ...room,
      points: newPoints,
      x: bb.x, y: bb.y, width: bb.width, height: bb.height,
    };

    // Walls need regenerating — structure has changed (1 new edge on each
    // side of the inserted vertex, so old wall splits into 2). Regenerate
    // all walls for this room. Doors/windows/openings attached to the OLD
    // wall would need reattachment — for simplicity, dropped for now; user
    // can re-add. (Rare case: usually L-shapes are drawn before placing openings.)
    const otherWalls = state.walls.filter((w) => w.roomId !== roomId);
    const newRoomWalls = wallsForRoom(updatedRoom);
    const finalWalls = detectSharedWalls([...otherWalls, ...newRoomWalls]);

    push({
      ...state,
      rooms: state.rooms.map((r) => (r.id === roomId ? updatedRoom : r)),
      walls: finalWalls,
    });
  }, [state, push, gs]);

  /** Explicitly close the in-progress trace and hand off to RoomConfirmationCard.
   *  Gives the user a tap-able "Done" button alternative to precisely hitting
   *  the first vertex — mobile-first UX. */
  const handleFinishTrace = useCallback(() => {
    if (traceVertices.length < 3) return;
    const bb = polygonBoundingBox(traceVertices);
    setPendingRoom({ x: bb.x, y: bb.y, width: bb.width, height: bb.height, points: traceVertices });
    setTraceVertices([]);
  }, [traceVertices]);

  /* ---------------------------------------------------------------- */
  /*  Arrow key movement for selected element                          */
  /* ---------------------------------------------------------------- */

  const moveSelectedRef = useRef((dx: number, dy: number) => {
    const id = selectedIdRef.current;
    if (!id) return;
    const room = state.rooms.find((r) => r.id === id);
    if (room) {
      const updatedRoom = { ...room, x: room.x + dx, y: room.y + dy };
      const updatedWalls = state.walls.map((w) =>
        w.roomId === id ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy } : w
      );
      push({ ...state, rooms: state.rooms.map((r) => r.id === id ? updatedRoom : r), walls: updatedWalls });
      return;
    }
    const wall = state.walls.find((w) => w.id === id && !w.roomId);
    if (wall) {
      push({ ...state, walls: state.walls.map((w) => w.id === id ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy } : w) });
    }
  });
  moveSelectedRef.current = (dx: number, dy: number) => {
    const id = selectedIdRef.current;
    if (!id) return;
    const room = state.rooms.find((r) => r.id === id);
    if (room) {
      const updatedRoom = { ...room, x: room.x + dx, y: room.y + dy };
      const updatedWalls = state.walls.map((w) =>
        w.roomId === id ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy } : w
      );
      push({ ...state, rooms: state.rooms.map((r) => r.id === id ? updatedRoom : r), walls: updatedWalls });
      return;
    }
    const wall = state.walls.find((w) => w.id === id && !w.roomId);
    if (wall) {
      push({ ...state, walls: state.walls.map((w) => w.id === id ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy } : w) });
    }
  };

  /* ---------------------------------------------------------------- */
  /*  Computed values                                                  */
  /* ---------------------------------------------------------------- */

  // Quantize stagePos to grid-cell boundaries so the grid memo only recomputes
  // when pan crosses a cell — cheap re-renders, stable visual.
  const qx = Math.round(stagePos.x / gs);
  const qy = Math.round(stagePos.y / gs);
  const gridBounds = useMemo(() => {
    const s = stageScale;
    const x0 = -stagePos.x / s;
    const y0 = -stagePos.y / s;
    const x1 = (stageSize.width - stagePos.x) / s;
    const y1 = (stageSize.height - stagePos.y) / s;
    // Generous pad so fast pans stay inside pre-rendered bounds until the
    // next quantized memo invalidation catches up.
    const pad = gs * 20;
    return {
      left: Math.floor((x0 - pad) / gs) * gs,
      top: Math.floor((y0 - pad) / gs) * gs,
      right: Math.ceil((x1 + pad) / gs) * gs,
      bottom: Math.ceil((y1 + pad) / gs) * gs,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageSize, stageScale, qx, qy, gs]);

  const gridLines = useMemo(() => {
    const { left, top, right, bottom } = gridBounds;
    const lines: Array<{ points: number[] }> = [];
    for (let x = left; x <= right; x += gs) lines.push({ points: [x, top, x, bottom] });
    for (let y = top; y <= bottom; y += gs) lines.push({ points: [left, y, right, y] });
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
          affectedOverlay={affectedOverlay}
          onToggleAffectedOverlay={() => setAffectedOverlay((v) => !v)}
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
          <RoomConfirmationCard
            existingRooms={state.rooms}
            propertyRooms={propertyRooms}
            onConfirm={finalizePendingRoom}
            onCancel={() => {
              setPendingRoom(null);
              // Revert to select tool so the user isn't stuck in Room/Trace
              // mode after backing out — matches the behavior on Confirm.
              setTool("select");
            }}
          />
        )}

        {/* Trace-mode floating status bar — visible whenever Trace tool is
            active. Pill-shaped, fits on one line; status + actions all inline. */}
        {tool === "trace" && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1a1a1a]/90 text-white text-[12px] font-[family-name:var(--font-geist-mono)] shadow-lg pointer-events-auto whitespace-nowrap max-w-[calc(100vw-24px)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#e85d26] animate-pulse shrink-0" />
            <span className="font-medium">
              {traceVertices.length === 0
                ? "Tap corners in order"
                : `${traceVertices.length} ${traceVertices.length === 1 ? "corner" : "corners"}`}
            </span>
            {traceVertices.length >= 1 && (
              <button
                type="button"
                onClick={() => setTraceVertices([])}
                className="px-2 py-0.5 rounded-full text-[11px] text-white/70 hover:text-white hover:bg-white/10 active:scale-95 cursor-pointer transition-all shrink-0"
              >
                Clear
              </button>
            )}
            {traceVertices.length >= 3 && (
              <button
                type="button"
                onClick={handleFinishTrace}
                className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#e85d26] text-white hover:bg-[#d14d1a] active:scale-95 cursor-pointer transition-all shrink-0"
              >
                Done
              </button>
            )}
          </div>
        )}

        {wallContextMenu && (() => {
          const wall = state.walls.find(w => w.id === wallContextMenu.wallId);
          if (!wall) return null;
          // Clamp menu into container so it doesn't overflow on mobile/right-edge walls
          const MENU_W = 160;
          const MENU_H = 240;
          const PAD = 8;
          const clampedX = Math.max(PAD, Math.min(wallContextMenu.x, stageSize.width - MENU_W - PAD));
          const clampedY = Math.max(PAD, Math.min(wallContextMenu.y, stageSize.height - MENU_H - PAD));
          return (
            <WallContextMenu
              wall={wall}
              position={{ x: clampedX, y: clampedY }}
              wallType={wall.wallType ?? "interior"}
              affected={wall.affected ?? false}
              hasOpening={state.windows.some(w => w.wallId === wall.id && w.id.startsWith("opening"))}
              onAddDoor={() => {
                const newDoor = { id: uid("door"), wallId: wall.id, position: 0.5, width: 3, swing: 0 as const };
                push({ ...state, doors: [...state.doors, newDoor] });
                setSelectedId(newDoor.id);
              }}
              onAddWindow={() => {
                const newWindow = { id: uid("win"), wallId: wall.id, position: 0.5, width: 3 };
                push({ ...state, windows: [...state.windows, newWindow] });
                setSelectedId(newWindow.id);
              }}
              onAddOpening={() => {
                const newWindow = { id: uid("opening"), wallId: wall.id, position: 0.5, width: 4 };
                push({ ...state, windows: [...state.windows, newWindow] });
                setSelectedId(newWindow.id);
              }}
              onToggleType={() => {
                const newType = wall.wallType === "exterior" ? "interior" : "exterior";
                push({
                  ...state,
                  walls: state.walls.map(w =>
                    w.id === wall.id ? { ...w, wallType: newType } : w
                  ),
                });
              }}
              onToggleAffected={() => {
                push({
                  ...state,
                  walls: state.walls.map(w =>
                    w.id === wall.id ? { ...w, affected: !w.affected } : w
                  ),
                });
              }}
              onClose={() => setWallContextMenu(null)}
            />
          );
        })()}

        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          draggable={tool === "select" && !selectedId}
          onDragMove={(e) => {
            // Keep stagePos in sync during drag so gridBounds re-memoizes on
            // each cell crossing (qx/qy). Without this, the grid lags the pan
            // and white edges show until release.
            if (e.target === stageRef.current) setStagePos({ x: e.target.x(), y: e.target.y() });
          }}
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
          style={{ cursor: tool === "room" || tool === "wall" || tool === "trace" ? "crosshair" : tool === "door" || tool === "window" || tool === "opening" ? "crosshair" : tool === "delete" ? "not-allowed" : "default" }}
        >
          {/* Grid layer — lines rendered over pre-padded bounds. Bounds only
              re-memoize when pan crosses a cell (qx/qy quantization). */}
          <Layer listening={false}>
            <Rect
              name="grid-bg"
              x={gridBounds.left}
              y={gridBounds.top}
              width={gridBounds.right - gridBounds.left}
              height={gridBounds.bottom - gridBounds.top}
              fill="#ffffff"
            />
            {gridLines.map((line, i) => (
              <Line key={i} points={line.points} stroke="#eae6e1" strokeWidth={1} listening={false} perfectDrawEnabled={false} />
            ))}
          </Layer>

          {/* Rooms layer */}
          <Layer>
            {displayRooms.map((room) => {
              // Affected Mode: non-affected rooms fade so mitigation scope stands out.
              // `affected` lives on the per-job room (job_rooms.affected), not on
              // the canvas room, so we look it up via propertyRoomId → propertyRooms.
              const linkedPropertyRoom = room.propertyRoomId
                ? propertyRooms?.find((r) => r.id === room.propertyRoomId)
                : propertyRooms?.find((r) => r.room_name === room.name);
              const isAffected = !!linkedPropertyRoom?.affected;
              const isDimmed = affectedOverlay && !isAffected;
              const isPolygon = !!room.points && room.points.length >= 3;
              return (
              <Group
                key={room.id}
                // Polygon rooms store absolute points and sit at group-origin (0,0).
                // Rect rooms use group origin = (room.x, room.y) with local 0..width/height.
                x={isPolygon ? 0 : room.x}
                y={isPolygon ? 0 : room.y}
                opacity={isDimmed ? 0.25 : 1}
                draggable={tool === "select" && !readOnly}
                onDragMove={handleDragMove}
                onDragEnd={(e) => handleDragEnd("room", room.id, { x: e.target.x(), y: e.target.y() })}
                // Tap toggles selection: tapping an already-selected room
                // deselects it (hides vertex handles, closes mobile panel).
                onClick={() => {
                  if (tool === "select") setSelectedId((cur) => (cur === room.id ? null : room.id));
                  if (tool === "delete") deleteElement(room.id);
                }}
                onTap={() => {
                  if (tool === "select") setSelectedId((cur) => (cur === room.id ? null : room.id));
                  if (tool === "delete") deleteElement(room.id);
                }}
              >
                {isPolygon ? (
                  <Line
                    points={polygonToKonvaPoints(room.points!)}
                    closed
                    fill={room.fill}
                    stroke={selectedId === room.id ? "#5b6abf" : "#e85d26"}
                    strokeWidth={selectedId === room.id ? 3 : 2}
                    elementId={room.id}
                    // Tap on edge of a selected polygon → insert a vertex there.
                    // Enables L-shape creation: user taps the long edge to add
                    // a kink, then drags the new vertex to carve a notch.
                    onClick={(e) => {
                      if (readOnly || tool !== "select") return;
                      if (selectedId !== room.id) return; // only insert on selected
                      const stage = e.target.getStage();
                      const pos = stage?.getPointerPosition();
                      if (!pos) return;
                      const sPos = {
                        x: (pos.x - stagePos.x) / stageScale,
                        y: (pos.y - stagePos.y) / stageScale,
                      };
                      handleInsertVertex(room.id, sPos.x, sPos.y);
                    }}
                    onTap={(e) => {
                      if (readOnly || tool !== "select") return;
                      if (selectedId !== room.id) return;
                      const stage = e.target.getStage();
                      const pos = stage?.getPointerPosition();
                      if (!pos) return;
                      const sPos = {
                        x: (pos.x - stagePos.x) / stageScale,
                        y: (pos.y - stagePos.y) / stageScale,
                      };
                      handleInsertVertex(room.id, sPos.x, sPos.y);
                    }}
                  />
                ) : (
                  <Rect
                    width={room.width} height={room.height}
                    fill={room.fill}
                    stroke={selectedId === room.id ? "#5b6abf" : "#e85d26"}
                    strokeWidth={selectedId === room.id ? 3 : 2}
                    elementId={room.id}
                  />
                )}
                {(() => {
                  // Auto-fit label:
                  //   1. Scale font from 13 → 6 to fit the room width (aggressive shrink
                  //      to keep the full name readable in narrow rooms like "Basement" in 3ft).
                  //   2. If it still overflows at 6px, truncate + always show ellipsis
                  //      so a single-char fallback never masquerades as a complete label.
                  const CHAR_W = 7; // approx mono-font char width at fontSize 13
                  const PAD = 8;
                  const MIN_FS = 6;
                  const avail = Math.max(0, room.width - PAD);
                  const natW = room.name.length * CHAR_W;
                  let label = room.name;
                  let fitSize = 13;
                  if (natW > avail) {
                    const scaled = Math.floor(13 * avail / natW);
                    if (scaled >= MIN_FS) {
                      fitSize = scaled;
                    } else {
                      fitSize = MIN_FS;
                      const charWAtMin = CHAR_W * (MIN_FS / 13);
                      // Reserve 1 char for the ellipsis
                      const maxChars = Math.max(1, Math.floor(avail / charWAtMin) - 1);
                      if (maxChars < room.name.length) {
                        label = room.name.slice(0, maxChars) + "…";
                      }
                    }
                  }
                  const labelWpx = label.length * CHAR_W * (fitSize / 13);
                  // Polygon rooms: Group is at (0,0) and points are absolute, so
                  // the label position is the absolute centroid. Rect rooms: Group
                  // is at (room.x, room.y) and we position the label at the local
                  // center.
                  const labelX = isPolygon
                    ? polygonCentroid(room.points!).x
                    : room.width / 2;
                  const labelY = isPolygon
                    ? polygonCentroid(room.points!).y - fitSize / 2
                    : room.height / 2 - fitSize / 2;
                  return (
                    <Text x={labelX} y={labelY} text={label}
                      fontSize={fitSize} fontFamily="var(--font-geist-mono), monospace" fill="#1a1a1a" align="center" offsetX={labelWpx / 2} />
                  );
                })()}
                {/* Dimension labels. Rect rooms: Group sits at (room.x, room.y),
                    so local (width/2, -14) lands above the top edge correctly.
                    Polygon rooms: Group is at (0, 0) with absolute points, so we
                    need to offset by bbox origin to land above the shape. */}
                <Text
                  x={isPolygon ? room.x + room.width / 2 : room.width / 2}
                  y={isPolygon ? room.y - 14 : -14}
                  text={feetLabel(room.width)}
                  fontSize={11} fontFamily="var(--font-geist-mono), monospace" fill="#6b6560" align="center" offsetX={feetLabel(room.width).length * 3}
                />
                <Text
                  x={isPolygon ? room.x - 14 : -14}
                  y={isPolygon ? room.y + room.height / 2 : room.height / 2}
                  text={feetLabel(room.height)}
                  fontSize={11} fontFamily="var(--font-geist-mono), monospace" fill="#6b6560" rotation={-90} offsetX={feetLabel(room.height).length * 3}
                />
                {selectedId === room.id && !isPolygon && (
                  <>
                    {[{ cx: 0, cy: 0 }, { cx: room.width, cy: 0 }, { cx: room.width, cy: room.height }, { cx: 0, cy: room.height }].map((h, i) => (
                      <Circle
                        key={i}
                        x={h.cx}
                        y={h.cy}
                        radius={resizeActive ? 12 : 7}
                        fill={resizeActive ? "#e85d26" : "#5b6abf"}
                        stroke="#ffffff"
                        strokeWidth={2}
                        draggable={!readOnly}
                        hitStrokeWidth={resizeActive ? 20 : 10}
                        onTouchStart={() => {
                          // Start long-press timer — 500ms hold activates resize mode
                          if (longPressTimer.current) clearTimeout(longPressTimer.current);
                          longPressTimer.current = setTimeout(() => {
                            setResizeActive(true);
                          }, 500);
                        }}
                        onTouchEnd={() => {
                          if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
                        }}
                        onTouchMove={() => {
                          // Cancel long-press if finger moves (user is scrolling, not pressing)
                          if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
                        }}
                        onDragStart={(e) => {
                          e.cancelBubble = true;
                          // On touch devices, only allow drag when resize mode is active (long-press)
                          const nativeEvt = e.evt;
                          if (nativeEvt instanceof TouchEvent && !resizeActive) {
                            e.target.stopDrag();
                            return;
                          }
                        }}
                        onDragMove={(e) => {
                          e.cancelBubble = true;
                        }}
                        onDragEnd={(e) => {
                          e.cancelBubble = true;
                          const newX = room.x + e.target.x();
                          const newY = room.y + e.target.y();
                          e.target.x(h.cx);
                          e.target.y(h.cy);
                          handleCornerDragEnd(room.id, i, newX, newY);
                          setResizeActive(false);
                        }}
                        onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = i === 0 || i === 2 ? "nwse-resize" : "nesw-resize"; }}
                        onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = "default"; }}
                      />
                    ))}
                  </>
                )}

                {/* Gate 4: Polygon vertex edit handles. Visible when a polygon
                    room is selected. Big hit targets + cancelBubble on all
                    pointer events so touches don't bubble to the room Group
                    (which is draggable) and the whole polygon doesn't move by
                    accident when you're trying to grab a single vertex. */}
                {selectedId === room.id && isPolygon && !readOnly && room.points!.map((v, i) => {
                  const isActive = activeVertex?.roomId === room.id && activeVertex.index === i;
                  return (
                    <Group key={`v-${i}`}>
                      {/* Outer halo when active — big faint ring so the user
                          knows exactly which vertex they're holding */}
                      {isActive && (
                        <Circle
                          x={v.x}
                          y={v.y}
                          radius={26}
                          fill="#e85d26"
                          opacity={0.18}
                          listening={false}
                        />
                      )}
                      <Circle
                        x={v.x}
                        y={v.y}
                        radius={isActive ? 15 : 12}
                        fill={isActive ? "#e85d26" : "#5b6abf"}
                        stroke="#ffffff"
                        strokeWidth={isActive ? 3 : 2.5}
                        shadowColor="#1a1a1a"
                        shadowBlur={isActive ? 10 : 3}
                        shadowOpacity={isActive ? 0.4 : 0.2}
                        draggable
                        hitStrokeWidth={32}
                        onMouseDown={(e) => {
                          e.cancelBubble = true;
                          setActiveVertex({ roomId: room.id, index: i });
                        }}
                        onTouchStart={(e) => {
                          e.cancelBubble = true;
                          setActiveVertex({ roomId: room.id, index: i });
                        }}
                        onClick={(e) => { e.cancelBubble = true; }}
                        onTap={(e) => { e.cancelBubble = true; }}
                        onDragStart={(e) => {
                          e.cancelBubble = true;
                          // Ensure the active flag is set at drag start (desktop
                          // where pointerdown → drag start can skip mousedown).
                          setActiveVertex({ roomId: room.id, index: i });
                          setVertexDragPreview({ roomId: room.id, index: i, x: e.target.x(), y: e.target.y() });
                        }}
                        onDragMove={(e) => {
                          e.cancelBubble = true;
                          // Live preview — polygon fill + walls follow the finger
                          // instead of staying static until the release.
                          setVertexDragPreview({ roomId: room.id, index: i, x: e.target.x(), y: e.target.y() });
                        }}
                        onDragEnd={(e) => {
                          e.cancelBubble = true;
                          handleVertexDragEnd(room.id, i, e.target.x(), e.target.y());
                          // Keep the active state visible briefly after release
                          // so the user can see the final snapped position.
                          setTimeout(() => {
                            setActiveVertex(null);
                            setVertexDragPreview(null);
                          }, 250);
                        }}
                        onMouseEnter={(e) => { e.target.getStage()!.container().style.cursor = "move"; }}
                        onMouseLeave={(e) => { e.target.getStage()!.container().style.cursor = "default"; }}
                      />
                    </Group>
                  );
                })}
              </Group>
              );
            })}

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

            {/* E6 trace tool preview: chunky, clearly visible vertex dots +
                solid edges between them + a dashed rubber-band to the cursor.
                The first vertex has an inviting "close target" ring once 3+
                points are placed, AND the user can tap it directly even
                without a rubber-band. Numbered labels help on longer paths. */}
            {tool === "trace" && traceVertices.length > 0 && (
              <Group listening={false}>
                {/* Edges between placed vertices (solid) */}
                {traceVertices.length >= 2 && (
                  <Line
                    points={polygonToKonvaPoints(traceVertices)}
                    stroke="#e85d26"
                    strokeWidth={3}
                    lineCap="round"
                  />
                )}
                {/* Closing edge preview: dashed line from the LAST vertex back
                    to the FIRST, shown once 3+ corners are placed. Lets the
                    user see the final polygon shape BEFORE tapping Done — so
                    they can judge whether to add/remove vertices. */}
                {traceVertices.length >= 3 && (
                  <Line
                    points={[
                      traceVertices[traceVertices.length - 1].x,
                      traceVertices[traceVertices.length - 1].y,
                      traceVertices[0].x,
                      traceVertices[0].y,
                    ]}
                    stroke="#e85d26"
                    strokeWidth={2}
                    dash={[8, 6]}
                    opacity={0.45}
                  />
                )}
                {/* Rubber-band from last vertex to cursor — desktop hover only */}
                {drawCurrent && (
                  <Line
                    points={[
                      traceVertices[traceVertices.length - 1].x,
                      traceVertices[traceVertices.length - 1].y,
                      drawCurrent.x,
                      drawCurrent.y,
                    ]}
                    stroke="#e85d26"
                    strokeWidth={2}
                    dash={[6, 4]}
                    opacity={0.6}
                  />
                )}
                {/* Vertex dots — bigger + bolder so each placement reads clearly */}
                {traceVertices.map((v, i) => {
                  const isFirst = i === 0;
                  const canClose = isFirst && traceVertices.length >= 3;
                  const closable =
                    canClose &&
                    drawCurrent &&
                    Math.hypot(drawCurrent.x - v.x, drawCurrent.y - v.y) < TRACE_CLOSE_THRESHOLD_PX;
                  return (
                    <Group key={i}>
                      {/* Pulse halo on the first vertex when it's closable — makes
                          it obvious where to tap to finish the shape */}
                      {canClose && (
                        <Circle
                          x={v.x}
                          y={v.y}
                          radius={closable ? 20 : 14}
                          fill="#e85d26"
                          opacity={closable ? 0.3 : 0.15}
                        />
                      )}
                      <Circle
                        x={v.x}
                        y={v.y}
                        radius={isFirst ? 9 : 7}
                        fill={isFirst ? "#ffffff" : "#e85d26"}
                        stroke="#e85d26"
                        strokeWidth={isFirst ? 3 : 0}
                        shadowColor="#1a1a1a"
                        shadowBlur={3}
                        shadowOpacity={0.25}
                      />
                      {/* Vertex number label — small, monospace, offset so it
                          doesn't block the dot. Helps user track their path. */}
                      <Text
                        x={v.x + 10}
                        y={v.y - 14}
                        text={String(i + 1)}
                        fontSize={11}
                        fontFamily="var(--font-geist-mono), monospace"
                        fill="#e85d26"
                        fontStyle="bold"
                      />
                    </Group>
                  );
                })}
              </Group>
            )}
          </Layer>

          {/* Walls layer */}
          <Layer>
            {displayWalls.map((wall) => {
              const len = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
              const midX = (wall.x1 + wall.x2) / 2;
              const midY = (wall.y1 + wall.y2) / 2;
              const isStandalone = !wall.roomId;
              // Affected Mode: non-affected walls fade to 25% opacity
              const isDimmed = affectedOverlay && !wall.affected;
              return (
                <Group
                  key={wall.id}
                  opacity={isDimmed ? 0.25 : 1}
                  draggable={tool === "select" && !readOnly && isStandalone}
                  onDragEnd={(e) => { if (isStandalone) handleDragEnd("wall", wall.id, { x: e.target.x(), y: e.target.y() }); e.target.position({ x: 0, y: 0 }); }}
                >
                  <Line
                    points={[wall.x1, wall.y1, wall.x2, wall.y2]}
                    stroke={
                      selectedId === wall.id ? "#5b6abf"
                        : wall.affected ? "#ba1a1a"
                        : wall.wallType === "exterior" ? "#2563eb"
                        : wall.shared ? "#8a847e"      // shared walls: muted gray (once, not twice)
                        : "#1a1a1a"
                    }
                    // Shared walls render at 60% thickness — visual hint that
                    // two rooms share this edge and it's only counted once in LF.
                    strokeWidth={
                      wall.shared
                        ? Math.max(1, Math.round(wall.thickness * 0.6))
                        : wall.wallType === "exterior" ? wall.thickness + 2 : wall.thickness
                    }
                    lineCap="round" hitStrokeWidth={12}
                    elementId={wall.id}
                    onClick={(e) => {
                      if (readOnly) return;
                      if (tool === "delete") { deleteElement(wall.id); return; }
                      if (tool !== "select") return;
                      // When a polygon room is currently selected AND the tapped
                      // wall belongs to it, interpret this as "insert a vertex
                      // on this edge" (Gate 4 L-shape creation flow). Otherwise
                      // open the regular wall context menu (Add Door/Window/etc).
                      const parentRoom = wall.roomId ? state.rooms.find((r) => r.id === wall.roomId) : null;
                      const isPolygonOfSelected =
                        !!parentRoom &&
                        parentRoom.id === selectedId &&
                        !!parentRoom.points &&
                        parentRoom.points.length >= 3;
                      const stage = e.target.getStage();
                      const pos = stage?.getPointerPosition();
                      if (isPolygonOfSelected && pos) {
                        const sPos = { x: (pos.x - stagePos.x) / stageScale, y: (pos.y - stagePos.y) / stageScale };
                        handleInsertVertex(parentRoom!.id, sPos.x, sPos.y);
                        return;
                      }
                      setSelectedId(wall.id);
                      if (pos) setWallContextMenu({ wallId: wall.id, x: pos.x, y: pos.y });
                    }}
                    onTap={(e) => {
                      if (readOnly) return;
                      if (tool === "delete") { deleteElement(wall.id); return; }
                      if (tool !== "select") return;
                      const parentRoom = wall.roomId ? state.rooms.find((r) => r.id === wall.roomId) : null;
                      const isPolygonOfSelected =
                        !!parentRoom &&
                        parentRoom.id === selectedId &&
                        !!parentRoom.points &&
                        parentRoom.points.length >= 3;
                      const stage = e.target.getStage();
                      const pos = stage?.getPointerPosition();
                      if (isPolygonOfSelected && pos) {
                        const sPos = { x: (pos.x - stagePos.x) / stageScale, y: (pos.y - stagePos.y) / stageScale };
                        handleInsertVertex(parentRoom!.id, sPos.x, sPos.y);
                        return;
                      }
                      setSelectedId(wall.id);
                      if (pos) setWallContextMenu({ wallId: wall.id, x: pos.x, y: pos.y });
                    }}
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
              const isOpening = win.id.startsWith("opening");
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
                  {isOpening ? (
                    <>
                      {/* Missing wall — white gap with dashed red outline */}
                      <Line points={[-winPx / 2, 0, winPx / 2, 0]} stroke="#ffffff" strokeWidth={8} />
                      <Line points={[-winPx / 2, 0, winPx / 2, 0]} stroke="#ba1a1a" strokeWidth={2} dash={[6, 4]} />
                    </>
                  ) : (
                    <>
                      {/* Window — white gap with double blue lines */}
                      <Line points={[-winPx / 2, 0, winPx / 2, 0]} stroke="#ffffff" strokeWidth={6} />
                      <Line points={[-winPx / 2, -3, winPx / 2, -3]} stroke="#5b6abf" strokeWidth={2} />
                      <Line points={[-winPx / 2, 3, winPx / 2, 3]} stroke="#5b6abf" strokeWidth={2} />
                    </>
                  )}
                  {isSelected && <Circle x={0} y={0} radius={7} fill={isOpening ? "#ba1a1a" : "#5b6abf"} stroke="#ffffff" strokeWidth={2.5} />}
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>

      {/* Mobile opening editor — bottom sheet with swipe-to-close */}
      {selectedId && !readOnly && (() => {
        const selDoor = state.doors.find(d => d.id === selectedId);
        const selWindow = state.windows.find(w => w.id === selectedId);
        if (!selDoor && !selWindow) return null;
        const isOpening = selWindow?.id.startsWith("opening");
        const elementType = selDoor ? "Door" : isOpening ? "Opening" : "Window";

        return (
          <MobileOpeningEditor
            type={elementType}
            isOpening={!!isOpening}
            width={selDoor?.width ?? selWindow?.width ?? 3}
            height={selDoor?.height ?? selWindow?.height ?? (selDoor ? 7 : isOpening ? 8 : 4)}
            onWidthChange={(v) => {
              if (selDoor) push({ ...state, doors: state.doors.map(d => d.id === selectedId ? { ...d, width: v } : d) });
              if (selWindow) push({ ...state, windows: state.windows.map(w => w.id === selectedId ? { ...w, width: v } : w) });
            }}
            onHeightChange={(v) => {
              if (selDoor) push({ ...state, doors: state.doors.map(d => d.id === selectedId ? { ...d, height: v } : d) });
              if (selWindow) push({ ...state, windows: state.windows.map(w => w.id === selectedId ? { ...w, height: v } : w) });
            }}
            onClose={() => setSelectedId(null)}
          />
        );
      })()}

      {!readOnly && (
        <FloorPlanSidebar
          state={state}
          gridSize={gs}
          tool={tool}
          selectedId={selectedId}
          propertyRooms={propertyRooms}
          jobId={jobId}
          onEditRoom={onEditRoom}
          onUpdateState={push}
        />
      )}
      </div>
    </div>
  );
});

export default KonvaFloorPlan;
