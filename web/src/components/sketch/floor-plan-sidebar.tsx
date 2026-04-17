"use client";

import { Fragment } from "react";
import type { ToolType, FloorPlanData } from "./floor-plan-tools";
import { usePhotos } from "@/lib/hooks/use-jobs";
import { RoomPhotoSection } from "@/components/room-photo-section";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface FloorPlanSidebarProps {
  state: FloorPlanData;
  gridSize: number;
  tool: ToolType;
  selectedId: string | null;
  propertyRooms?: Array<{ id: string; room_name: string }>;
  jobId?: string;
}

/* ------------------------------------------------------------------ */
/*  Properties section for selected element                            */
/* ------------------------------------------------------------------ */

function PropertiesPanel({ state, gridSize, selectedId, onUpdateState }: {
  state: FloorPlanData; gridSize: number; selectedId: string;
  onUpdateState?: (next: FloorPlanData) => void;
}) {
  const gs = gridSize;
  const selRoom = state.rooms.find(r => r.id === selectedId);
  const selWall = !selRoom ? state.walls.find(w => w.id === selectedId) : null;
  const selDoor = !selRoom && !selWall ? state.doors.find(d => d.id === selectedId) : null;
  const selWindow = !selRoom && !selWall && !selDoor ? state.windows.find(w => w.id === selectedId) : null;

  const heading = <h3 className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#6b6560] font-semibold mb-3">Properties</h3>;
  const label = (text: string) => <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#8a847e] mb-0.5">{text}</p>;
  const value = (text: string, mono = true) => <p className={`text-[13px] ${mono ? "font-[family-name:var(--font-geist-mono)]" : "font-semibold"} text-[#1a1a1a]`}>{text}</p>;

  const editInput = (val: number, onChange: (v: number) => void, suffix = "ft") => (
    <div className="relative">
      <input
        type="number"
        value={val}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        min={0.5}
        max={30}
        step={0.5}
        onFocus={(e) => e.target.select()}
        className="w-full h-7 px-2 pr-5 rounded border border-[#eae6e1] text-[12px] text-[#1a1a1a] font-[family-name:var(--font-geist-mono)] outline-none focus:border-brand-accent"
      />
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-[#8a847e] font-[family-name:var(--font-geist-mono)]">{suffix}</span>
    </div>
  );

  if (selRoom) {
    const wFt = Math.round((selRoom.width / gs) * 10) / 10;
    const hFt = Math.round((selRoom.height / gs) * 10) / 10;
    return (
      <div className="mb-4">
        {heading}
        <div className="space-y-2.5">
          <div>{label("Room")}{value(selRoom.name, false)}</div>
          <div className="grid grid-cols-2 gap-2">
            <div>{label("Width")}{value(`${wFt} ft`)}</div>
            <div>{label("Length")}{value(`${hFt} ft`)}</div>
          </div>
          <div>{label("Area")}{value(`${Math.round(wFt * hFt * 10) / 10} sq ft`)}</div>
        </div>
      </div>
    );
  }
  if (selWall) {
    const lenFt = Math.round((Math.hypot(selWall.x2 - selWall.x1, selWall.y2 - selWall.y1) / gs) * 10) / 10;
    return (
      <div className="mb-4">
        {heading}
        <div className="space-y-2.5">
          <div>{label("Wall")}{value(`${lenFt} ft`)}</div>
          <div className="flex gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-[family-name:var(--font-geist-mono)] ${selWall.wallType === "exterior" ? "bg-blue-100 text-blue-600" : "bg-[#eae6e1] text-[#6b6560]"}`}>
              {selWall.wallType === "exterior" ? "Exterior" : "Interior"}
            </span>
            {selWall.affected && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-[family-name:var(--font-geist-mono)]">Affected</span>
            )}
          </div>
          {selWall.roomId && (
            <div>{label("Part of")}<p className="text-[13px] text-[#1a1a1a]">{state.rooms.find(r => r.id === selWall.roomId)?.name ?? "Room"}</p></div>
          )}
        </div>
      </div>
    );
  }
  if (selDoor) {
    const swingLabels = ["Left-Up", "Left-Down", "Right-Down", "Right-Up"];
    return (
      <div className="mb-4">
        {heading}
        <div className="space-y-2.5">
          <div>
            {label("Door Width")}
            {onUpdateState ? editInput(selDoor.width, (v) => {
              onUpdateState({ ...state, doors: state.doors.map(d => d.id === selDoor.id ? { ...d, width: v } : d) });
            }) : value(`${selDoor.width} ft`)}
          </div>
          <div>
            {label("Door Height")}
            {onUpdateState ? editInput(selDoor.height ?? 7, (v) => {
              onUpdateState({ ...state, doors: state.doors.map(d => d.id === selDoor.id ? { ...d, height: v } : d) });
            }) : value(`${selDoor.height ?? 7} ft`)}
          </div>
          <div>{label("Swing")}<p className="text-[13px] text-[#1a1a1a]">{swingLabels[typeof selDoor.swing === "number" ? selDoor.swing : 0]}</p></div>
        </div>
      </div>
    );
  }
  if (selWindow) {
    const isOpening = selWindow.id.startsWith("opening");
    return (
      <div className="mb-4">
        {heading}
        <div className="space-y-2.5">
          <div>
            {label(isOpening ? "Opening Width" : "Window Width")}
            {onUpdateState ? editInput(selWindow.width, (v) => {
              onUpdateState({ ...state, windows: state.windows.map(w => w.id === selWindow.id ? { ...w, width: v } : w) });
            }) : value(`${selWindow.width} ft`)}
          </div>
          <div>
            {label("Height")}
            {onUpdateState ? editInput(selWindow.height ?? (isOpening ? 8 : 4), (v) => {
              onUpdateState({ ...state, windows: state.windows.map(w => w.id === selWindow.id ? { ...w, height: v } : w) });
            }) : value(`${selWindow.height ?? (isOpening ? 8 : 4)} ft`)}
          </div>
          {isOpening && (
            <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-[family-name:var(--font-geist-mono)]">Missing Wall</span>
          )}
        </div>
      </div>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Tool instructions                                                  */
/* ------------------------------------------------------------------ */

function ToolInstructions({ tool }: { tool: ToolType }) {
  const instructions: Record<ToolType, React.ReactNode> = {
    room: (
      <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
        <p><span className="font-semibold text-[#1a1a1a]">Click and drag</span> to draw a room rectangle.</p>
        <p>Dimensions show live as you draw.</p>
        <p>Release to set the room, then enter a name.</p>
        <p className="text-[11px] text-[#8a847e] mt-3">Rooms auto-create walls on all 4 edges. Doors snap to these.</p>
      </div>
    ),
    trace: (
      <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
        <p><span className="font-semibold text-[#1a1a1a]">Tap each corner</span> of the room in sequence.</p>
        <p>A dashed rubber-band line previews the next edge.</p>
        <p><span className="font-semibold text-[#1a1a1a]">Tap the first corner</span> again to close the shape.</p>
        <p className="text-[11px] text-[#8a847e] mt-3">Use for L-shapes and irregular rooms. Escape to cancel.</p>
      </div>
    ),
    wall: (
      <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
        <p><span className="font-semibold text-[#1a1a1a]">Click</span> to start a wall.</p>
        <p><span className="font-semibold text-[#1a1a1a]">Click again</span> to end it.</p>
        <p>Measurements show in feet as you draw.</p>
        <p className="text-[11px] text-[#8a847e] mt-3">Endpoints snap to nearby walls automatically.</p>
      </div>
    ),
    door: (
      <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
        <p><span className="font-semibold text-[#1a1a1a]">Click on a wall</span> to place a door.</p>
        <p><span className="font-semibold text-[#1a1a1a]">Click a selected door</span> to cycle swing direction (4 positions).</p>
        <p><span className="font-semibold text-[#1a1a1a]">Drag</span> a selected door to slide it along the wall.</p>
        <p className="text-[11px] text-[#8a847e] mt-3">Switch to Select tool to move doors. Press Delete to remove.</p>
      </div>
    ),
    window: (
      <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
        <p><span className="font-semibold text-[#1a1a1a]">Click on a wall</span> to place a window.</p>
        <p><span className="font-semibold text-[#1a1a1a]">Drag</span> a selected window to slide it along the wall.</p>
        <p className="text-[11px] text-[#8a847e] mt-3">Windows show as double lines. Press Delete to remove.</p>
      </div>
    ),
    opening: (
      <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
        <p><span className="font-semibold text-[#1a1a1a]">Click on a wall</span> to mark a missing wall section.</p>
        <p><span className="font-semibold text-[#1a1a1a]">Drag</span> a selected opening to reposition.</p>
        <p className="text-[11px] text-[#8a847e] mt-3">Openings show as dashed red lines. Full wall height deducted from SF.</p>
      </div>
    ),
    select: (
      <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
        <p><span className="font-semibold text-[#1a1a1a]">Click</span> any element to select it.</p>
        <p><span className="font-semibold text-[#1a1a1a]">Drag rooms</span> to reposition.</p>
        <p><span className="font-semibold text-[#1a1a1a]">Drag doors/windows</span> along their wall.</p>
        <p><span className="font-semibold text-[#1a1a1a]">Delete or Backspace</span> removes selected.</p>
        <p className="text-[11px] text-[#8a847e] mt-3">Escape to deselect. Click door twice to flip swing.</p>
      </div>
    ),
    delete: (
      <div className="space-y-2 text-[12px] text-[#6b6560] leading-relaxed">
        <p><span className="font-semibold text-[#1a1a1a]">Click</span> any element to delete it.</p>
        <p>Deleting a room removes its walls, doors, and windows too.</p>
        <p className="text-[11px] text-[#8a847e] mt-3">Tip: use Select tool + Delete key instead for precision.</p>
      </div>
    ),
  };

  const toolNames: Record<ToolType, string> = {
    room: "Room Tool", trace: "Trace Tool", wall: "Wall Tool", door: "Door Tool",
    window: "Window Tool", opening: "Opening Tool", select: "Select Tool", delete: "Delete Tool",
  };

  return (
    <>
      <h3 className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#6b6560] font-semibold mb-3">
        {toolNames[tool]}
      </h3>
      {instructions[tool]}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Keyboard shortcuts footer                                          */
/* ------------------------------------------------------------------ */

function KeyboardShortcuts() {
  return (
    <div className="mt-auto pt-4 border-t border-[#eae6e1]">
      <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#8a847e] font-semibold mb-2">
        Keyboard
      </h4>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
        {[
          ["⌘Z", "Undo"], ["⌘⇧Z", "Redo"], ["Del", "Remove selected"],
          ["Esc", "Deselect"], ["Scroll", "Zoom in/out"],
        ].map(([key, desc]) => (
          <Fragment key={key}>
            <kbd className="px-1.5 py-0.5 rounded bg-[#eae6e1] text-[#1a1a1a] font-[family-name:var(--font-geist-mono)] text-[10px]">{key}</kbd>
            <span className="text-[#6b6560]">{desc}</span>
          </Fragment>
        ))}
      </div>
      <p className="text-[11px] text-[#8a847e] mt-2">
        Use Select tool + drag empty area to pan.
      </p>
      <h4 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#8a847e] font-semibold mb-2 mt-4">
        Floors
      </h4>
      <p className="text-[11px] text-[#8a847e]">
        <span className="font-semibold text-[#6b6560]">Double-click</span> a floor tab to rename it.
      </p>
      <p className="text-[11px] text-[#8a847e] mt-1">
        <span className="font-semibold text-[#6b6560]">Hover</span> the active tab to delete.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main sidebar                                                       */
/* ------------------------------------------------------------------ */

export function FloorPlanSidebar({ state, gridSize, tool, selectedId, propertyRooms, jobId, onEditRoom, onUpdateState }: FloorPlanSidebarProps & { onEditRoom?: () => void; onUpdateState?: (next: FloorPlanData) => void }) {
  // Fetch photos for this job (disabled when jobId is missing — enabled: !!jobId in usePhotos)
  const { data: allPhotos = [] } = usePhotos(jobId || "");

  // Match selected canvas room → property room (prefer ID, fall back to name for legacy data)
  const selectedCanvasRoom = selectedId ? state.rooms.find(r => r.id === selectedId) : null;
  const matchedPropertyRoom = selectedCanvasRoom
    ? (selectedCanvasRoom.propertyRoomId
        ? propertyRooms?.find(r => r.id === selectedCanvasRoom.propertyRoomId)
        : propertyRooms?.find(r => r.room_name === selectedCanvasRoom.name))
    : null;
  const roomPhotos = matchedPropertyRoom
    ? allPhotos.filter(p => p.room_id === matchedPropertyRoom.id)
    : [];

  return (
    <div className="hidden md:flex flex-col w-[240px] shrink-0 border-l border-[#eae6e1] bg-[#faf8f5] p-4 overflow-y-auto">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#eae6e1]">
        <div className="w-3 h-3 border border-[#eae6e1]" />
        <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-[#6b6560]">= 1 foot</span>
      </div>

      {/* Unmapped rooms from Property Layout */}
      {propertyRooms && propertyRooms.length > 0 && (() => {
        const drawnIds = new Set(state.rooms.map(r => r.propertyRoomId).filter(Boolean));
        const drawnNames = new Set(state.rooms.map(r => r.name));
        const unmapped = propertyRooms.filter(r => !drawnIds.has(r.id) && !drawnNames.has(r.room_name));
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

      {selectedId ? (
        <>
          <PropertiesPanel state={state} gridSize={gridSize} selectedId={selectedId} onUpdateState={onUpdateState} />
          {/* Edit room button — shown when a room with property match is selected */}
          {matchedPropertyRoom && onEditRoom && (
            <button
              type="button"
              onClick={onEditRoom}
              className="mt-2 mb-2 w-full h-8 rounded-lg border border-outline-variant text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-high active:scale-[0.98] cursor-pointer transition-all"
            >
              Edit Room Details
            </button>
          )}
          {/* Room photos — only when a room (not wall/door/window) is selected and has a property match */}
          {jobId && matchedPropertyRoom && (
            <div className="pt-3 border-t border-[#eae6e1]">
              <RoomPhotoSection
                jobId={jobId}
                roomId={matchedPropertyRoom.id}
                roomName={matchedPropertyRoom.room_name}
                photos={roomPhotos}
                variant="sidebar"
              />
            </div>
          )}
        </>
      ) : (
        <ToolInstructions tool={tool} />
      )}

      <KeyboardShortcuts />
    </div>
  );
}
