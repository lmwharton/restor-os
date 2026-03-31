# Spec 01C: Floor Plan — Excalidraw Replacement

| Field | Value |
|-------|-------|
| Status | Draft |
| Priority | High — blocking first customer demo |
| Depends on | Spec 01 (Jobs) |
| Estimate | 1 session (4-6 hours) |

---

## Problem

The current floor plan sketch tool (`web/src/components/sketch/floor-plan-canvas.tsx`, 2326 lines) is a custom HTML5 Canvas implementation with fundamental issues:

1. **Doors/windows can't attach to rectangles** — Only snap to `walls` array, not `shapes` array. Architecture flaw.
2. **No object selection or drag** — Can't select, move, or resize placed elements after drawing.
3. **AI cleanup doesn't work** — Lines don't straighten, endpoints don't join.
4. **No snap-to-grid or snap-to-edge** — Freehand drawing only.
5. **2326 lines of unmaintainable custom code** — Bug fixes require deep canvas math knowledge.

## Solution

Replace the custom canvas with **Excalidraw** (`@excalidraw/excalidraw`), an open-source whiteboard library with 90K+ GitHub stars, maintained by Meta.

### Why Excalidraw

| Need | Custom Canvas | Excalidraw |
|------|--------------|------------|
| Draw rooms (rectangles) | Yes, buggy | Built-in, polished |
| Walls (lines) | Yes | Built-in with snap |
| Doors/windows on walls | Broken | Custom elements or line tool |
| Select/move/resize | No | Built-in |
| Snap to grid | No | Built-in |
| Undo/redo | Partial | Built-in |
| Text labels | Yes | Built-in |
| Dimensions/measurements | Manual | Can overlay |
| Export to image | No | SVG/PNG built-in |
| Save/restore state | Custom JSON | `exportToJSON` / `restoreElements` |
| Mobile touch | Buggy | Polished |
| Code to maintain | 2326 lines | ~200 lines wrapper |

### What We Keep

- Floor plan page structure (`jobs/[id]/floor-plan/page.tsx`)
- API integration (save/load floor plan data via `useFloorPlans`, `useCreateFloorPlan`, `useUpdateFloorPlan`)
- Floor number selector (Floor 1, Floor 2, etc.)
- Room name assignment (link drawn rectangles to rooms from Property Layout)
- Save button + auto-save on changes

### What We Replace

- `web/src/components/sketch/floor-plan-canvas.tsx` (2326 lines) → `ExcalidrawFloorPlan` wrapper (~200 lines)
- Custom wall/door/window/shape drawing logic → Excalidraw's built-in tools
- Custom toolbar → Excalidraw's built-in UI (can be themed)

---

## Implementation Plan

### Phase 1: Install + Basic Integration

- [ ] `npm install @excalidraw/excalidraw`
- [ ] Create `web/src/components/sketch/excalidraw-floor-plan.tsx` wrapper component
- [ ] Load Excalidraw in a `'use client'` component with dynamic import (SSR-incompatible)
- [ ] Wire up save: `onChange` → debounced save to API via `useUpdateFloorPlan`
- [ ] Wire up load: `initialData` from `useFloorPlans` → `restoreElements()`
- [ ] Match brand theme: background color, grid color, element colors

### Phase 2: Floor Plan Customization

- [ ] Custom toolbar items: Wall, Door, Window presets (pre-configured line/rectangle styles)
- [ ] Room labeling: double-click rectangle → assigns room name from rooms list
- [ ] Dimension display: show measurements in feet on selected elements
- [ ] Floor selector: tabs for Floor 1, Floor 2, etc. (each saves separately)
- [ ] Export: "Export as PNG" button for reports

### Phase 3: Data Migration

- [ ] Convert existing floor plan `canvas_data` format to Excalidraw JSON format
- [ ] Migration script or lazy conversion on first load
- [ ] Delete old `floor-plan-canvas.tsx` (2326 lines)

### Phase 4: Polish

- [ ] Mobile touch optimization (Excalidraw handles this but verify)
- [ ] Keyboard shortcuts overlay (Excalidraw has built-in)
- [ ] "AI Cleanup" button: send Excalidraw elements to Claude for straightening/alignment suggestions
- [ ] Preview thumbnail on job detail page (render Excalidraw elements to SVG)

---

## Technical Notes

### Excalidraw React Usage

```tsx
'use client';

import dynamic from 'next/dynamic';

const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then(mod => mod.Excalidraw),
  { ssr: false }
);

export default function FloorPlanEditor({ initialData, onSave }) {
  return (
    <div style={{ height: '100%', width: '100%' }}>
      <Excalidraw
        initialData={initialData}
        onChange={(elements, state) => {
          // Debounced save to API
          onSave({ elements, state });
        }}
        theme="light"
        gridModeEnabled={true}
      />
    </div>
  );
}
```

### Data Format

Excalidraw stores elements as JSON:
```json
{
  "elements": [
    {
      "type": "rectangle",
      "x": 100, "y": 100,
      "width": 200, "height": 150,
      "label": { "text": "Kitchen" }
    },
    {
      "type": "line",
      "points": [[0, 0], [200, 0]],
      "x": 100, "y": 100
    }
  ],
  "appState": { "gridSize": 20 }
}
```

This maps cleanly to our `canvas_data` JSONB column. No schema migration needed — just store the Excalidraw JSON directly.

### Custom Presets for Restoration

For restoration floor plans, we can add custom tool presets:
- **Room**: Rectangle with fill, labeled
- **Wall**: Thick line (6px stroke)
- **Door**: Arc symbol (custom Excalidraw library element)
- **Window**: Double-line symbol (custom library element)
- **Equipment**: Icons for dehu, air mover, air scrubber (custom library)

Excalidraw supports custom libraries that can be loaded on init.

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Excalidraw bundle size (~500KB) | Dynamic import, only loads on floor plan page |
| Custom door/window symbols | Use Excalidraw's custom library feature |
| Existing floor plan data loss | Lazy migration on first load, keep old format as backup |
| Excalidraw API changes | Pin version, test before upgrading |
| Mobile performance | Excalidraw is battle-tested on mobile, but verify |

---

## Success Criteria

- [ ] Can draw rooms (rectangles) and label them with room names
- [ ] Can draw walls (lines) that snap to grid and endpoints
- [ ] Can place doors and windows that are selectable and movable
- [ ] Can select, move, resize, and delete any element
- [ ] Undo/redo works
- [ ] Floor plan saves to API and loads on page refresh
- [ ] Preview thumbnail shows on job detail page
- [ ] Toolbar visible at top without scrolling
- [ ] Works on desktop and mobile
- [ ] Less than 300 lines of custom code (excluding Excalidraw library)

---

## Files Changed

| Action | File | Notes |
|--------|------|-------|
| Create | `web/src/components/sketch/excalidraw-floor-plan.tsx` | ~200 line wrapper |
| Delete | `web/src/components/sketch/floor-plan-canvas.tsx` | 2326 lines removed |
| Modify | `web/src/app/(protected)/jobs/[id]/floor-plan/page.tsx` | Swap canvas component |
| Modify | `web/src/app/(protected)/jobs/[id]/page.tsx` | Update preview renderer |
| Add | `web/src/components/sketch/excalidraw-library.ts` | Custom door/window/equipment presets |
