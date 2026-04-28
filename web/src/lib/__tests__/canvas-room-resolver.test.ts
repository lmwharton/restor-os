import { describe, expect, it } from "vitest";
import {
  resolveCanvasRoomBackendId,
  resolveCanvasRoomBackendRow,
  resolveCanvasRoomCandidateIds,
} from "../canvas-room-resolver";

// Regression anchor for HIGH #5 in the Phase 2 critical review:
// "Bedroom 1 / Bedroom 2" collision on naive name-match. These tests
// pin the correct resolution order: propertyRoomId first, unique
// name-match second, null on ambiguity.

const bedroomA = { id: "room-a", room_name: "Bedroom" };
const bedroomB = { id: "room-b", room_name: "Bedroom" };
const kitchen = { id: "room-kitchen", room_name: "Kitchen" };

describe("resolveCanvasRoomBackendId", () => {
  it("returns propertyRoomId when the canvas room carries one", () => {
    const id = resolveCanvasRoomBackendId(
      { propertyRoomId: "backfilled-id", name: "Bedroom" },
      [bedroomA, bedroomB, kitchen],
    );
    // propertyRoomId wins even when the name would have been ambiguous.
    expect(id).toBe("backfilled-id");
  });

  it("returns the unique name match when no propertyRoomId is set", () => {
    const id = resolveCanvasRoomBackendId(
      { name: "Kitchen" },
      [bedroomA, bedroomB, kitchen],
    );
    expect(id).toBe("room-kitchen");
  });

  it("returns null when the name collides and no propertyRoomId exists", () => {
    // This is the exact regression the bug report flagged. Two
    // "Bedroom" rooms, canvas room with no backfilled id — the
    // naive `find()` would return bedroomA and attribute pins
    // wrong. The safe behavior is null.
    const id = resolveCanvasRoomBackendId(
      { name: "Bedroom" },
      [bedroomA, bedroomB, kitchen],
    );
    expect(id).toBeNull();
  });

  it("returns null when no room matches the name at all", () => {
    const id = resolveCanvasRoomBackendId(
      { name: "Garage" },
      [bedroomA, kitchen],
    );
    expect(id).toBeNull();
  });

  it("returns null when propertyRooms is empty or undefined", () => {
    expect(resolveCanvasRoomBackendId({ name: "Kitchen" }, [])).toBeNull();
    expect(resolveCanvasRoomBackendId({ name: "Kitchen" }, undefined)).toBeNull();
  });

  it("still returns propertyRoomId even when propertyRooms is undefined", () => {
    // Edge: canvas room has a backfilled id but we don't have the
    // list handy. Still correct — id alone is authoritative.
    const id = resolveCanvasRoomBackendId(
      { propertyRoomId: "backfilled-id", name: "Bedroom" },
      undefined,
    );
    expect(id).toBe("backfilled-id");
  });
});

describe("resolveCanvasRoomBackendRow", () => {
  // Row variant is used by the Moisture Mode tap-to-place resolver
  // and the Affected Mode dim lookup (both in konva-floor-plan.tsx).
  // Same guardrails as the id helper — duplicate name → undefined.
  const kitchenWithAffected = {
    id: "room-kitchen",
    room_name: "Kitchen",
    affected: true,
  };
  const bedroomA1 = { id: "room-a", room_name: "Bedroom", affected: false };
  const bedroomB1 = { id: "room-b", room_name: "Bedroom", affected: true };

  it("returns the full row preserving caller-extended fields", () => {
    // Access to `affected` from the returned row is what Affected
    // Mode's dim lookup relies on.
    const row = resolveCanvasRoomBackendRow(
      { propertyRoomId: "room-kitchen", name: "Kitchen" },
      [kitchenWithAffected, bedroomA1],
    );
    expect(row?.affected).toBe(true);
    expect(row?.id).toBe("room-kitchen");
  });

  it("returns undefined when the name collides without a propertyRoomId", () => {
    // Exact regression class the reviewer flagged at
    // konva-floor-plan.tsx:2479 — Affected Mode would pick
    // Bedroom 1's flag and paint Bedroom 2's canvas row with it.
    const row = resolveCanvasRoomBackendRow(
      { name: "Bedroom" },
      [bedroomA1, bedroomB1],
    );
    expect(row).toBeUndefined();
  });

  it("returns the unique name match when no propertyRoomId", () => {
    const row = resolveCanvasRoomBackendRow(
      { name: "Kitchen" },
      [bedroomA1, kitchenWithAffected],
    );
    expect(row?.id).toBe("room-kitchen");
  });

  it("returns undefined when propertyRooms is empty or undefined", () => {
    expect(
      resolveCanvasRoomBackendRow({ name: "Kitchen" }, []),
    ).toBeUndefined();
    expect(
      resolveCanvasRoomBackendRow({ name: "Kitchen" }, undefined),
    ).toBeUndefined();
  });
});

describe("resolveCanvasRoomCandidateIds", () => {
  it("includes propertyRoomId when set", () => {
    const ids = resolveCanvasRoomCandidateIds(
      { propertyRoomId: "backfilled-id", name: "Kitchen" },
      [kitchen],
    );
    expect(Array.from(ids).sort()).toEqual(["backfilled-id", "room-kitchen"]);
  });

  it("includes the unique name match when no propertyRoomId", () => {
    const ids = resolveCanvasRoomCandidateIds(
      { name: "Kitchen" },
      [bedroomA, kitchen],
    );
    expect(Array.from(ids)).toEqual(["room-kitchen"]);
  });

  it("skips the name match entirely when the name is ambiguous", () => {
    // Pin-follow-room translation effect MUST not include a
    // name-matched id when multiple siblings share the name —
    // otherwise dragging Bedroom 2 would translate pins on Bedroom 1.
    const ids = resolveCanvasRoomCandidateIds(
      { name: "Bedroom" },
      [bedroomA, bedroomB, kitchen],
    );
    expect(ids.size).toBe(0);
  });

  it("combines propertyRoomId with a unique name match (dual provenance)", () => {
    // Both propertyRoomId AND a differently-named canvas room that
    // happens to match uniquely — contrived but documents intent:
    // canvas room carries id X, but its name is unique in propertyRooms
    // and points at id Y. Both are legitimate candidates for pin
    // attribution across the backfill boundary.
    const ids = resolveCanvasRoomCandidateIds(
      { propertyRoomId: "pre-backfill-id", name: "Kitchen" },
      [kitchen, bedroomA],
    );
    expect(Array.from(ids).sort()).toEqual(["pre-backfill-id", "room-kitchen"]);
  });

  it("returns an empty set when nothing resolves", () => {
    const ids = resolveCanvasRoomCandidateIds(
      { name: "Garage" },
      [bedroomA, kitchen],
    );
    expect(ids.size).toBe(0);
  });
});
