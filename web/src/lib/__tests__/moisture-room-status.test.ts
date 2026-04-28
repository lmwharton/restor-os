import { describe, it, expect } from "vitest";
import { deriveRoomStatus, ROOM_STATUS_COPY } from "../moisture-room-status";
import type { MoisturePin } from "../types";

type PinStub = Pick<MoisturePin, "room_id" | "color">;

const ROOM = "room-A";
const OTHER = "room-B";

function pin(color: PinStub["color"], room_id: string | null = ROOM): PinStub {
  return { room_id, color };
}

describe("deriveRoomStatus", () => {
  it("returns 'empty' when no pins are in the room", () => {
    expect(deriveRoomStatus([], ROOM)).toBe("empty");
    expect(deriveRoomStatus([pin("green", OTHER)], ROOM)).toBe("empty");
  });

  it("returns 'dry' when every pin in the room is green", () => {
    expect(deriveRoomStatus([pin("green"), pin("green")], ROOM)).toBe("dry");
  });

  it("returns 'drying' when at least one pin is amber and none are red", () => {
    expect(deriveRoomStatus([pin("green"), pin("amber")], ROOM)).toBe("drying");
    expect(deriveRoomStatus([pin("amber")], ROOM)).toBe("drying");
  });

  it("returns 'drying' when a pin has null color (placed, no reading yet)", () => {
    expect(deriveRoomStatus([pin("green"), pin(null)], ROOM)).toBe("drying");
    expect(deriveRoomStatus([pin(null)], ROOM)).toBe("drying");
  });

  it("returns 'wet' whenever any pin is red, even if others are green", () => {
    expect(deriveRoomStatus([pin("red")], ROOM)).toBe("wet");
    expect(deriveRoomStatus([pin("green"), pin("red"), pin("green")], ROOM)).toBe("wet");
    expect(deriveRoomStatus([pin("amber"), pin("red")], ROOM)).toBe("wet");
    expect(deriveRoomStatus([pin("red"), pin(null)], ROOM)).toBe("wet");
  });

  it("ignores pins belonging to other rooms", () => {
    expect(
      deriveRoomStatus(
        [pin("red", OTHER), pin("green"), pin("green")],
        ROOM,
      ),
    ).toBe("dry");
  });
});

describe("ROOM_STATUS_COPY", () => {
  it("maps every status to a label and a hex color", () => {
    for (const key of ["dry", "drying", "wet", "empty"] as const) {
      const copy = ROOM_STATUS_COPY[key];
      expect(copy.label).toBeTruthy();
      expect(copy.colorHex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
