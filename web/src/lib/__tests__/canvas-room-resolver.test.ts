import { describe, expect, it } from "vitest";
import {
  resolveCanvasRoomBackendId,
  resolveCanvasRoomBackendRow,
  resolveCanvasRoomCandidateIds,
} from "../canvas-room-resolver";

// Phase 2 location-split fix (Spec 01H): name-match fallback removed
// from the resolver — every canvas room owns its propertyRoomId from
// t=0 (generated client-side via `newRoomUuid()`), so attribution is
// pure ID lookup. These tests pin the post-fix contract:
//
//   - propertyRoomId set → return it.
//   - propertyRoomId missing → return null (no name guess).
//
// The duplicate-name regression that originally drove this module
// (HIGH #5 — "Bedroom 1 / Bedroom 2" collision under naive
// `propertyRooms.find(pr => pr.room_name === room.name)`) is now
// architecturally impossible: each canvas room has a unique UUID,
// so even two "Bedroom"s have distinct propertyRoomIds.

describe("resolveCanvasRoomBackendId", () => {
  it("returns propertyRoomId when the canvas room carries one", () => {
    const id = resolveCanvasRoomBackendId({ propertyRoomId: "backfilled-id", name: "Bedroom" });
    expect(id).toBe("backfilled-id");
  });

  it("returns null when propertyRoomId is missing — name is no longer used", () => {
    // Pre-fix: this test asserted name-match returned room-kitchen.
    // Post-fix: name match is gone. A canvas room without
    // propertyRoomId is unresolvable — caller logs and skips
    // (lesson #2 — never silently coerce to a default).
    const id = resolveCanvasRoomBackendId({ name: "Kitchen" });
    expect(id).toBeNull();
  });

  it("returns null when the canvas room has no propertyRoomId regardless of name uniqueness", () => {
    // Sibling test to the above — Garage exists nowhere, propertyRoomId
    // missing, return null. Same rule as the unique-name case; the
    // resolver never consults names anymore.
    const id = resolveCanvasRoomBackendId({ name: "Garage" });
    expect(id).toBeNull();
  });
});

describe("resolveCanvasRoomBackendRow", () => {
  // Row variant is used by Affected Mode dim lookup. Same post-fix
  // contract — propertyRoomId-keyed lookup; no name fallback.
  const kitchenWithAffected = {
    id: "room-kitchen",
    room_name: "Kitchen",
    affected: true,
  };
  const bedroomA1 = { id: "room-a", room_name: "Bedroom", affected: false };
  const bedroomB1 = { id: "room-b", room_name: "Bedroom", affected: true };

  it("returns the full row preserving caller-extended fields when propertyRoomId matches", () => {
    const row = resolveCanvasRoomBackendRow(
      { propertyRoomId: "room-kitchen", name: "Kitchen" },
      [kitchenWithAffected, bedroomA1],
    );
    expect(row?.affected).toBe(true);
    expect(row?.id).toBe("room-kitchen");
  });

  it("returns undefined when propertyRoomId is missing — name no longer consulted", () => {
    // Pre-fix: returned undefined because of duplicate-name guard.
    // Post-fix: returns undefined because we don't try name-match
    // at all. Same outcome, simpler code path.
    const row = resolveCanvasRoomBackendRow(
      { name: "Bedroom" },
      [bedroomA1, bedroomB1],
    );
    expect(row).toBeUndefined();
  });

  it("returns undefined for unique name with no propertyRoomId", () => {
    // Pre-fix: returned the unique name match. Post-fix: returns
    // undefined — the resolver never consults names.
    const row = resolveCanvasRoomBackendRow(
      { name: "Kitchen" },
      [bedroomA1, kitchenWithAffected],
    );
    expect(row).toBeUndefined();
  });

  it("returns undefined when propertyRoomId references a row not in the list", () => {
    // Caller has a stale propertyRoomId; row is gone from the list.
    // Resolver returns undefined — caller decides whether this is a
    // recoverable state.
    const row = resolveCanvasRoomBackendRow(
      { propertyRoomId: "stale-id", name: "Kitchen" },
      [bedroomA1, kitchenWithAffected],
    );
    expect(row).toBeUndefined();
  });

  it("returns undefined when propertyRooms is empty or undefined", () => {
    expect(
      resolveCanvasRoomBackendRow(
        { propertyRoomId: "any", name: "Kitchen" },
        [],
      ),
    ).toBeUndefined();
    expect(
      resolveCanvasRoomBackendRow(
        { propertyRoomId: "any", name: "Kitchen" },
        undefined,
      ),
    ).toBeUndefined();
  });
});

describe("resolveCanvasRoomCandidateIds", () => {
  it("returns a one-element set with propertyRoomId when set", () => {
    // Pre-fix: returned a 2-element set (propertyRoomId + name match)
    // for the dual-provenance case. Post-fix: at most one element —
    // propertyRoomId is the only attribution path.
    const ids = resolveCanvasRoomCandidateIds({ propertyRoomId: "backfilled-id", name: "Kitchen" });
    expect(Array.from(ids)).toEqual(["backfilled-id"]);
  });

  it("returns an empty set when propertyRoomId is missing — no name fallback", () => {
    // Pin-follow-room and pin visibility filter both call this. An
    // empty set means "no pins translate / no pins visible for this
    // canvas room." Caller logs the unresolvable state at higher
    // severity than silent-skip would.
    const ids = resolveCanvasRoomCandidateIds({ name: "Bedroom" });
    expect(ids.size).toBe(0);
  });

  it("returns empty set for unique name without propertyRoomId", () => {
    // Pre-fix: returned the unique name match. Post-fix: empty.
    const ids = resolveCanvasRoomCandidateIds({ name: "Kitchen" });
    expect(ids.size).toBe(0);
  });

  it("returns empty when nothing resolves", () => {
    const ids = resolveCanvasRoomCandidateIds({ name: "Garage" });
    expect(ids.size).toBe(0);
  });
});
