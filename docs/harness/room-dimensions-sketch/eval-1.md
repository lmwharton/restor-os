# Evaluation #1 — Room Dimensions & Sketch

## Scores
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Design Quality | 6/9 | Clean layout, consistent with brand accent #e85d26. Grid is subtle. But rooms lack dimension labels on all 4 edges (only width shown on top). Room names centered correctly. Instructions panel works. |
| Craft | 5/9 | Dimension labels only show width, not height. Kitchen room exists in Property Layout but has no dimensions (not synced). Door arc rendering is rough (dashed line). No visual distinction between rooms in preview thumbnail. Spacing between rooms in sketch is arbitrary. |
| Functionality | 6/9 | Room drawing works. Door placement works. Zoom/pan works. Dimension sync works for rooms created after the fix. Kitchen (pre-existing) still shows no dimensions. Undo/redo works. Room name picker works. |

## 3 Things Wrong (mandatory)
1. **Kitchen has no dimensions** — it was created before the dimension sync fix. Drawing a Kitchen room on the sketch doesn't update the existing Kitchen room in Property Layout because the name matching happens only during `onCreateRoom`, not during auto-save sync. The auto-save sync should have caught it, but Kitchen may not have a matching drawn rectangle on the canvas.
2. **Room dimension labels only show width** — the top edge shows "7.0 ft" or "29.0 ft" but the side edges don't show height measurements. Contractors need both dimensions visible on the sketch.
3. **Activity timeline floods with "room updated"** — when dimension sync runs on save, it fires updateRoom for every room, creating duplicate "room updated" events even when dimensions haven't changed.

## Issues Found
1. Kitchen dimensions not synced — likely no drawn rectangle named "Kitchen" on the canvas (mismatch between Property Layout rooms and drawn rooms)
2. Room height dimension labels missing on sketch (only width shown on top edge)
3. Activity timeline spam from repeated room updates
4. Door arc rendering could be cleaner (thicker line for door leaf, smoother arc)
5. Property Layout preview (thumbnail) doesn't show room names inside rectangles
6. "No dimensions" for Kitchen is confusing — should allow clicking to enter manually

## Spec Checklist (from 01C)
- [x] Brett can draw a room, label it, and see dimensions
- [ ] Brett can draw walls with live measurements in feet — PARTIAL: only width label shown, not height
- [x] Brett can place a door on a wall and it snaps correctly
- [x] Brett can flip a door's swing direction with one click
- [x] Brett can select any element and move/resize it
- [x] Floor plan saves and loads correctly
- [ ] Works on desktop and mobile — NOT TESTED on mobile yet
- [x] Toolbar is visible at top without scrolling

## Verdict: ITERATE
