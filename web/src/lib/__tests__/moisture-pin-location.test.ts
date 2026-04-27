import { describe, expect, it } from "vitest";

import { formatPinLocation } from "../moisture-pin-location";
import type { MoisturePin, WallSegment } from "../types";

function pin(
  partial: Pick<MoisturePin, "surface" | "position" | "wall_segment_id">,
): Pick<MoisturePin, "surface" | "position" | "wall_segment_id"> {
  return partial;
}

function wall(id: string, x1: number, y1: number, x2: number, y2: number): WallSegment {
  return {
    id,
    room_id: "room-1",
    company_id: "co-1",
    x1,
    y1,
    x2,
    y2,
    wall_type: "interior",
    wall_height_ft: 8,
    affected: false,
    shared: false,
    shared_with_room_id: null,
    sort_order: 0,
    openings: [],
    created_at: "",
    updated_at: "",
  };
}

describe("formatPinLocation", () => {
  describe("floor", () => {
    it("renders Floor + Position + Room when both are present", () => {
      expect(
        formatPinLocation(
          pin({ surface: "floor", position: "C", wall_segment_id: null }),
          { roomName: "Kitchen" },
        ),
      ).toBe("Floor, Center, Kitchen");
    });

    it("maps each position word", () => {
      const cases: Array<[MoisturePin["position"], string]> = [
        ["NW", "Floor, Northwest, Kitchen"],
        ["NE", "Floor, Northeast, Kitchen"],
        ["SW", "Floor, Southwest, Kitchen"],
        ["SE", "Floor, Southeast, Kitchen"],
      ];
      for (const [position, expected] of cases) {
        expect(
          formatPinLocation(
            pin({ surface: "floor", position, wall_segment_id: null }),
            { roomName: "Kitchen" },
          ),
        ).toBe(expected);
      }
    });

  });

  describe("ceiling", () => {
    it("renders Ceiling + Position + Room (position always present)", () => {
      // Regression pin — earlier the placement sheet force-nulled
      // position for non-floor surfaces and the helper ignored ceiling
      // position entirely. Both fixed; migration e3c4d5f6a7b8 then
      // tightened the column to NOT NULL so this is the only ceiling
      // case the helper needs to handle.
      expect(
        formatPinLocation(
          pin({ surface: "ceiling", position: "NE", wall_segment_id: null }),
          { roomName: "Kitchen" },
        ),
      ).toBe("Ceiling, Northeast, Kitchen");
    });
  });

  describe("wall", () => {
    it("renders bare Wall + Room when no segment is picked (draft state)", () => {
      // Lesson #2 cousin: wall pin without segment is a valid intermediate
      // state before the picker UI lands. Display must not say `undefined`.
      expect(
        formatPinLocation(
          pin({ surface: "wall", position: "C", wall_segment_id: null }),
          { roomName: "Living Room" },
        ),
      ).toBe("Wall, Living Room");
    });

    it("renders bare Wall when segment id refers to a wall not in the loaded set", () => {
      // Stale cache / room data not loaded — must not crash.
      expect(
        formatPinLocation(
          pin({ surface: "wall", position: "C", wall_segment_id: "missing" }),
          { roomName: "Kitchen", walls: [wall("other", 0, 0, 10, 0)] },
        ),
      ).toBe("Wall, Kitchen");
    });

    // Square room with centroid at (5, 5): pick a horizontal top wall (y=0)
    // and verify the compass derivation reads as "North" — y < centroid.y
    // is north in screen coords (canvas y grows down).
    it("derives directional label from wall midpoint vs centroid", () => {
      const walls = [
        wall("top", 0, 0, 10, 0), // midpoint (5, 0) — north of centroid (5,5)
        wall("right", 10, 0, 10, 10), // east
        wall("bottom", 0, 10, 10, 10), // south
        wall("left", 0, 0, 0, 10), // west
      ];
      expect(
        formatPinLocation(
          pin({ surface: "wall", position: "C", wall_segment_id: "top" }),
          { roomName: "Kitchen", walls },
        ),
      ).toBe("North wall, Kitchen");

      expect(
        formatPinLocation(
          pin({ surface: "wall", position: "C", wall_segment_id: "right" }),
          { roomName: "Kitchen", walls },
        ),
      ).toBe("East wall, Kitchen");

      expect(
        formatPinLocation(
          pin({ surface: "wall", position: "C", wall_segment_id: "bottom" }),
          { roomName: "Kitchen", walls },
        ),
      ).toBe("South wall, Kitchen");

      expect(
        formatPinLocation(
          pin({ surface: "wall", position: "C", wall_segment_id: "left" }),
          { roomName: "Kitchen", walls },
        ),
      ).toBe("West wall, Kitchen");
    });

    it("works on a non-rectangular polygon (L-shape, 6 walls)", () => {
      // L-shape walls — centroid lands inside the L, not at a vertex.
      // Just verify each wall resolves to A direction (not the bare
      // fallback) — exact compass octants for diagonals depend on
      // geometry but every wall should produce some compass label.
      const walls = [
        wall("a", 0, 0, 10, 0),
        wall("b", 10, 0, 10, 4),
        wall("c", 10, 4, 6, 4),
        wall("d", 6, 4, 6, 10),
        wall("e", 6, 10, 0, 10),
        wall("f", 0, 10, 0, 0),
      ];
      for (const w of walls) {
        const out = formatPinLocation(
          pin({ surface: "wall", position: "C", wall_segment_id: w.id }),
          { roomName: "L-Shape", walls },
        );
        expect(out).toMatch(
          /^(North|South|East|West|Northeast|Northwest|Southeast|Southwest) wall, L-Shape$/,
        );
      }
    });
  });

  describe("room name fallbacks", () => {
    it("renders 'Unknown room' when roomName is missing", () => {
      expect(
        formatPinLocation(
          pin({ surface: "floor", position: "C", wall_segment_id: null }),
          {},
        ),
      ).toBe("Floor, Center, Unknown room");
    });

    it("trims and falls back when roomName is whitespace", () => {
      expect(
        formatPinLocation(
          pin({ surface: "ceiling", position: "C", wall_segment_id: null }),
          { roomName: "   " },
        ),
      ).toBe("Ceiling, Center, Unknown room");
    });
  });
});
