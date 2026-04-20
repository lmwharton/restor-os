// Canvas Mode abstraction for the floor plan.
//
// The sketch canvas is a surface that serves multiple purposes across the spec.
// Sketch Mode is the original drawing UX (rooms, walls, doors, etc.). Moisture
// Mode (this phase), Equipment Mode (phase 3), and Photo Mode (phase 4) each
// layer a different interaction model on top of the same rooms + walls.
//
// CanvasMode captures the three things that change in lockstep when the user
// switches context: which tools the toolbar shows, whether the sketch layer
// should dim, and whether the mode-specific layer (pins / equipment / photos)
// is interactive. Every future mode extends this map — adding "equipment" is
// one config entry plus a new Konva layer, not a refactor.

import type { ToolType } from "./floor-plan-tools";

export type CanvasMode = "sketch" | "moisture";

export interface CanvasModeConfig {
  id: CanvasMode;
  label: string;
  /** Hex color for the active-state treatment. Brand orange for Sketch so
   *  it matches the existing primary CTA muscle memory; cyan for Moisture
   *  so "water" reads at a glance without overriding the brand. */
  accent: string;
  /** Which tools the toolbar renders in this mode. */
  tools: readonly ToolType[];
  /** When true, rooms + walls + openings render at reduced opacity so the
   *  mode-specific layer (pins) pops. */
  dimSketch: boolean;
}

export const CANVAS_MODES: Record<CanvasMode, CanvasModeConfig> = {
  sketch: {
    id: "sketch",
    label: "Sketch",
    accent: "#e85d26",
    tools: [
      "select",
      "room",
      "wall",
      "door",
      "window",
      "delete",
      "trace",
      "opening",
      "cutout",
    ],
    dimSketch: false,
  },
  moisture: {
    id: "moisture",
    label: "Moisture",
    accent: "#0891b2",
    // Moisture palette: Pin (drop) + Delete (remove pin). Select is
    // intentionally absent — tapping an existing pin opens its reading
    // sheet regardless of the active tool, and dragging repositions the
    // pin in place, so Select has no distinct role here.
    tools: ["pin", "delete"],
    dimSketch: true,
  },
};

/** Opacity applied to the sketch layer when dimSketch is true. Matches the
 *  v2 design mockup's 0.30 value (rooms become context, pins become content). */
export const DIM_SKETCH_OPACITY = 0.3;
