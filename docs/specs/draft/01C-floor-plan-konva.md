# Spec 01C: Floor Plan — Konva.js Rebuild

| Field | Value |
|-------|-------|
| Status | 90% implemented — remaining items below |
| Priority | High — blocking first customer demo |
| Depends on | Spec 01 (Jobs) |
| Estimate | 1 session (4-6 hours) |
| Library | react-konva (721K weekly downloads, MIT, best React integration) |
| Completed | 2026-03-31 |

## Remaining Items

- [ ] **Multi-floor save bug** — Floor 2 drawings don't save correctly. The `handleChange` callback may still reference Floor 1's data. Need to debug the activeFloorRef + save flow for non-primary floors.
- [ ] **Floor grouping on job detail** — rooms drawn on Floor 2 show as "Not on floor plan" instead of under "Floor 2". The canvas_data match may fail if Floor 2's save didn't persist.
- [ ] **Export to PNG** — button exists but not wired up. Konva has `stage.toDataURL()` for this.
- [ ] **Properties panel** — show selected element's dimensions in the sidebar (currently shows instructions only).
- [ ] **Mobile floor plan** — toolbar compact mode works, but touch drawing/zooming needs testing.
- [ ] **Code under 500 lines** — currently ~870 lines (still 63% reduction from 2326, but over target).

---

## Problem

The current floor plan sketch tool (`web/src/components/sketch/floor-plan-canvas.tsx`, 2326 lines) is a custom HTML5 Canvas implementation. Brett's feedback: "The entire thing isn't very good."

Fundamental issues:
1. **Doors/windows can't snap to rectangles** — Only snap to `walls` array, not shapes
2. **No object selection or drag** — Can't move placed elements
3. **No live measurements** — Brett's #1 requirement
4. **AI cleanup doesn't straighten lines** — Freehand only
5. **2326 lines of unmaintainable custom code**

## Brett's Requirements (March 2026)

From `docs/research/brett-prototype-sessions.md`:
- **Live measurements** as walls are being drawn (in feet)
- **Doors snap to walls** — interactive, "stick" to walls when close
- **Flip and rotate** doors and windows
- Better overall UX
- Skip LiDAR for now — make browser sketching actually good
- 80% of the value without native app dependency

## Why Konva.js (not Excalidraw)

| Factor | Excalidraw | Konva.js | Winner |
|--------|-----------|---------|--------|
| Purpose | Whiteboard/diagramming | 2D canvas library | Konva (we build exactly what we need) |
| npm downloads | 295/week (React pkg) | 721K/week | Konva |
| React integration | Good | Excellent (react-konva) | Konva |
| Snap-to-wall | No (only grid) | Build with dragBoundFunc | Konva (controllable) |
| Live measurements | Ruler overlay only | Text nodes on elements | Konva |
| Custom door/window | Library items (limited) | Full custom shapes | Konva |
| Architectural feel | Hand-drawn aesthetic | Clean/precise (what we want) | Konva |
| Mobile touch | Good | Built-in multi-touch | Tie |
| License | MIT | MIT | Tie |
| Bundle | 46.8 MB npm pkg | ~300KB | Konva |

**Decision:** Excalidraw is a whiteboard. We need a floor plan tool. Konva gives us full control to build exactly what Brett needs: clean lines, live measurements, door snapping.

---

## Solution: Konva-based Floor Plan Editor

### Architecture

```
FloorPlanEditor (page wrapper)
├── KonvaStage (react-konva Stage + Layer)
│   ├── GridLayer — background grid (20px = 1ft)
│   ├── WallsLayer — wall segments with dimension labels
│   ├── RoomsLayer — rectangles with room names + fill
│   ├── DoorsLayer — door arcs that snap to walls
│   ├── WindowsLayer — window symbols that snap to walls
│   └── SelectionLayer — handles for move/resize
├── TopToolbar — tool selector (Wall, Door, Window, Room, Select, Delete)
├── PropertiesPanel — selected element dimensions/properties (right sidebar on desktop)
└── FloorTabs — Floor 1, Floor 2 tabs (bottom)
```

### User Flow: Draw a Room

1. **Select "Room" tool** from toolbar
2. **Click and drag** on canvas → draws rectangle with live dimensions ("12.5 ft x 10 ft")
3. **Release** → rectangle created, room name dialog appears
4. **Type room name** (or select from dropdown: Kitchen, Master Bedroom, etc.)
5. **Room appears** as labeled rectangle with dimensions on each edge
6. **Room auto-links** to rooms in Property Layout section (creates room via API if new)

### User Flow: Add Walls

1. **Select "Wall" tool** from toolbar
2. **Click start point** → wall starts with live measurement showing
3. **Move mouse** → wall follows with measurement updating ("14.3 ft")
4. **Click end point** → wall placed, snaps to grid (or existing wall endpoints)
5. **Endpoints glow** when near another wall endpoint (magnetic snap within 10px)

### User Flow: Place a Door

1. **Select "Door" tool** from toolbar
2. **Hover over a wall** → wall highlights, door preview shows at cursor position
3. **Click on wall** → door placed at that position (3ft default width)
4. **Door shows arc** (swing direction) — click again to flip swing
5. **Drag door** along wall to reposition (constrained to wall segment)
6. **Select + drag handles** → resize door width

### User Flow: Place a Window

Same as door, but renders as double-line break in wall instead of arc.

---

## UI Specification

### Page Layout (Desktop)

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back    1235 Mission St    JOB-20260331-001    [Save] [Export]│
├─────────────────────────────────────────────────────────────────┤
│ [Room] [Wall] [Door] [Window] | [Select] [Delete] [Undo] [Redo]│
├──────────────────────────────────────────┬──────────────────────┤
│                                          │  PROPERTIES          │
│                                          │                      │
│           ┌──────────┐                   │  Width: 12.5 ft      │
│           │          │                   │  Height: 10.0 ft     │
│           │ Kitchen  │                   │  Area: 125 sq ft     │
│           │ 12.5x10  │                   │  Name: Kitchen       │
│           │          │                   │                      │
│           └──────────┘                   │  ──────────────────  │
│                                          │  ROOMS               │
│      CANVAS (react-konva Stage)          │  ☑ Kitchen           │
│                                          │  ☑ Master Bedroom    │
│                                          │  ☐ Hallway           │
│                                          │                      │
├──────────────────────────────────────────┴──────────────────────┤
│  [Floor 1]  [Floor 2]  [+ Add Floor]                           │
└─────────────────────────────────────────────────────────────────┘
```

### Page Layout (Mobile)

```
┌───────────────────────────────┐
│ ← Back  1235 Mission St      │
├───────────────────────────────┤
│ [Room][Wall][Door][Win]       │
│ [Select][Del][Undo][Redo]     │
├───────────────────────────────┤
│                               │
│    CANVAS (full width)        │
│    Touch: pinch zoom, drag    │
│                               │
├───────────────────────────────┤
│ [Floor 1] [Floor 2] [+]      │
│ Selected: Kitchen 12.5x10 ft │
└───────────────────────────────┘
```

### Toolbar Design

Tool buttons: 44px square, icon + label below, grouped by function.

| Group | Tools | Icon Style |
|-------|-------|-----------|
| Draw | Room, Wall | Outline rectangles/lines |
| Place | Door, Window | Architectural symbols |
| Edit | Select, Delete | Pointer, trash |
| History | Undo, Redo | Arrow curves |

Active tool: `bg-brand-accent/12 text-brand-accent` (from DESIGN.md accent #e85d26)
Inactive: `text-on-surface-variant hover:bg-surface-container-high`
Disabled: `opacity-30`

### Grid

- Grid spacing: 20px = 1 foot (configurable)
- Grid color: `#eae6e1` (border color from DESIGN.md)
- Snap: all elements snap to grid by default (hold Shift to disable)
- Scale indicator: "1 square = 1 ft" label in corner

### Element Rendering

| Element | Visual | Color | Label |
|---------|--------|-------|-------|
| Room | Filled rectangle | Fill: `#fff3ed` (accent bg), Stroke: `#e85d26` (accent) 2px | Room name centered, dimensions on edges |
| Wall | Thick line | Stroke: `#1a1a1a` (primary text) 4px | Dimension label centered above |
| Door | Arc + gap in wall | Stroke: `#1a1a1a` 2px, Arc: dashed | Width label |
| Window | Double lines in wall | Stroke: `#5b6abf` (info) 2px | Width label |
| Selected element | Blue handles | Handle fill: `#5b6abf`, stroke: white | — |

### Empty State

First time opening floor plan:

```
┌──────────────────────────────────────┐
│                                      │
│       ┌──┐                           │
│       │⊞│  Draw your first room      │
│       └──┘                           │
│                                      │
│  Select the Room tool from the       │
│  toolbar above, then click and drag  │
│  on the canvas to create a room.     │
│                                      │
│  Rooms will appear in your job's     │
│  Property Layout section.            │
│                                      │
│         [Start Drawing →]            │
│                                      │
└──────────────────────────────────────┘
```

### Interaction States

| State | What User Sees |
|-------|---------------|
| Loading | Skeleton: toolbar placeholder + gray canvas |
| Empty (no floor plan) | Empty state with instructions (above) |
| Drawing wall | Live measurement label follows cursor |
| Hovering wall with Door tool | Wall highlights, door preview at cursor |
| Element selected | Blue handles, properties panel shows details |
| Saving | "Saving..." in header, brief spinner |
| Save error | Red toast "Failed to save. Retry?" |
| Exporting | "Exporting PNG..." overlay |

---

## Data Model

### Canvas Data (stored in `floor_plans.canvas_data` JSONB)

```typescript
interface FloorPlanData {
  // No version field needed — only one format exists (Konva)
  gridSize: number;  // px per foot (default 20)
  rooms: Array<{
    id: string;
    x: number; y: number;
    width: number; height: number;  // in grid units (feet)
    name: string;
    roomId?: string;  // links to rooms table
    fill: string;
  }>;
  walls: Array<{
    id: string;
    x1: number; y1: number;
    x2: number; y2: number;
    thickness: number;
  }>;
  doors: Array<{
    id: string;
    wallId: string;
    position: number;  // 0-1 parametric position on wall
    width: number;  // in feet
    swing: "left" | "right";
  }>;
  windows: Array<{
    id: string;
    wallId: string;
    position: number;
    width: number;
  }>;
}
```

### No Migration — Clean Slate

We're pre-launch. No migration code, no version checks, no if-else. Delete old `floor-plan-canvas.tsx`, wipe any existing floor plan data in dev/staging, and only support the Konva format. One format, zero dead code.

---

## Implementation Plan

### Phase 1: Core Canvas (~2 hours)

- [ ] `npm install react-konva konva`
- [ ] Create `web/src/components/sketch/konva-floor-plan.tsx`
- [ ] Stage with grid layer (20px/ft)
- [ ] Room tool: click-drag to create rectangle, live dimensions
- [ ] Room name dialog on creation
- [ ] Select tool: click to select, drag handles to resize
- [ ] Delete tool: click element to remove
- [ ] Undo/redo stack
- [ ] Save to API (debounced onChange)
- [ ] Load from API (restore elements)

### Phase 2: Walls + Doors (~2 hours)

- [ ] Wall tool: click-click to draw wall segments with snap
- [ ] Live measurement display while drawing
- [ ] Magnetic endpoint snapping (glow when near)
- [ ] Door tool: hover wall → preview, click → place
- [ ] Door swing arc rendering
- [ ] Click door to flip swing direction
- [ ] Drag door along wall to reposition
- [ ] Window tool: same snap behavior as door

### Phase 3: Integration + Polish (~1 hour)

- [ ] Wire up to floor plan page (replace old canvas import)
- [ ] Floor selector tabs
- [ ] Export to PNG button
- [ ] Properties panel (selected element dimensions)
- [ ] Auto-link rooms to Property Layout (create room via API)
- [ ] Preview thumbnail for job detail page
- [ ] Delete old `floor-plan-canvas.tsx`

---

## Responsive Behavior

| Breakpoint | Layout | Properties Panel | Floor Tabs |
|-----------|--------|-----------------|------------|
| Desktop (lg+) | Canvas + right sidebar | Right sidebar, always visible | Bottom bar |
| Tablet (md) | Full-width canvas | Bottom sheet on select | Bottom bar |
| Mobile (sm) | Full-width canvas, 2-row toolbar | Bottom sheet on select | Bottom bar |

Touch gestures (all breakpoints):
- **Pinch**: zoom in/out
- **Two-finger drag**: pan canvas
- **Single finger**: draw/interact (based on tool)
- **Long press**: select element
- **Double tap**: edit room name

---

## Accessibility

- All toolbar buttons have `aria-label`
- Tab key cycles through toolbar
- Arrow keys move selected element (1ft per press, Shift = 0.1ft)
- Escape deselects
- Delete key removes selected element
- Screen reader: "Room: Kitchen, 12.5 by 10 feet, at position 5, 3"

---

## Files Changed

| Action | File | Notes |
|--------|------|-------|
| Create | `web/src/components/sketch/konva-floor-plan.tsx` | ~400 lines, core editor |
| Create | `web/src/components/sketch/floor-plan-tools.ts` | Tool definitions, snap logic |
| Create | `web/src/components/sketch/floor-plan-shapes.tsx` | Room, Wall, Door, Window components |
| Delete | `web/src/components/sketch/floor-plan-canvas.tsx` | 2326 lines removed |
| Modify | `web/src/app/(protected)/jobs/[id]/floor-plan/page.tsx` | Swap canvas component |
| Modify | `web/src/app/(protected)/jobs/[id]/page.tsx` | Update preview renderer |

---

## Success Criteria

- [ ] Brett can draw a room, label it, and see dimensions
- [ ] Brett can draw walls with live measurements in feet
- [ ] Brett can place a door on a wall and it snaps correctly
- [ ] Brett can flip a door's swing direction with one click
- [ ] Brett can select any element and move/resize it
- [ ] Floor plan saves and loads correctly
- [ ] Works on desktop and mobile
- [ ] Toolbar is visible at top without scrolling
- [ ] Less than 500 lines of custom code (vs 2326 today)

---

## Eng Review Decisions

**Room edges = walls.** Drawing a room rectangle automatically creates 4 wall segments. Doors snap to room edges directly. One action, not two. This is the key architectural decision.

**React state drives Konva (controlled).** All elements in useState, Konva renders from state. For <100 elements this is fine and keeps things React-idiomatic.

**Auto-save: 2-second debounce** with "saving..." indicator. No manual save button needed.

**No migration.** Pre-launch, clean slate. Delete old canvas code, wipe dev data, only support Konva format. Zero dead code.

## NOT in scope

- LiDAR integration (Brett: "skip for now")
- Equipment icons on floor plan (Spec 04)
- 3D view (overkill for water jobs)
- AI cleanup/straightening (defer until Konva base is solid)
- Multi-user collaboration

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 0 issues, 1 key decision (room=walls) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 5/10 → 8/10, library changed to Konva |

**VERDICT:** ENG + DESIGN CLEARED — ready to implement
