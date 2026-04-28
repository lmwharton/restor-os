// Resolve a canvas room's corresponding backend job_rooms identity.
//
// ─── Why this exists ─────────────────────────────────────────────────
//
// A Konva canvas carries rooms that need to link to backend `job_rooms`
// rows for moisture-pin attribution, visibility filtering, and the
// pin-follow-room translation effect. Two id provenances coexist:
//
//  1. `propertyRoomId` — backfilled onto each canvas room after the
//     first save round-trip. Ground truth once set.
//  2. Name match against `propertyRooms` — a fallback for the narrow
//     window between room creation and first-save backfill, where the
//     canvas room has no propertyRoomId yet.
//
// The bug this module closes: two rooms named "Bedroom" in the same
// job (a daily residential pattern — "Bedroom 1 / Bedroom 2" in
// duplexes, ADUs, upstairs stacks) collide under naive
// `propertyRooms.find(pr => pr.room_name === room.name)` — Array.find
// returns the first match, so pins on the second "Bedroom" get
// attributed to the first one. Symptoms: pin-follow-room translates
// the wrong pins when Bedroom 2 is dragged; visibility filter hides
// pins that genuinely belong to Bedroom 2. See pr-review-lessons #5
// (HIGH) in the Phase 2 critical review.
//
// The fix: prefer `propertyRoomId` when present, only accept a
// name-match when it's unambiguous (exactly one match). When
// ambiguous, return `null` — safer than guessing wrong.

export interface CanvasRoomLike {
  propertyRoomId?: string;
  name: string;
}

export interface PropertyRoomLike {
  id: string;
  room_name: string;
}

/**
 * Return the single canonical backend id for a canvas room, or
 * `null` when it can't be resolved unambiguously.
 *
 * - If `canvasRoom.propertyRoomId` is set, it wins every time — that
 *   id was backfilled from a real save round-trip.
 * - Otherwise fall back to a name match in `propertyRooms`. Only
 *   accept the match when the name is unique in that list.
 * - Duplicate names with no `propertyRoomId` → `null`. The caller
 *   skips rather than guessing.
 */
export function resolveCanvasRoomBackendId(
  canvasRoom: CanvasRoomLike,
  propertyRooms: ReadonlyArray<PropertyRoomLike> | undefined,
): string | null {
  if (canvasRoom.propertyRoomId) return canvasRoom.propertyRoomId;
  if (!propertyRooms || propertyRooms.length === 0) return null;
  const matches = propertyRooms.filter(
    (pr) => pr.room_name === canvasRoom.name,
  );
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * Companion to :func:`resolveCanvasRoomBackendId` that returns the
 * full property-room row instead of just its id.
 *
 * Call sites that need per-row fields (e.g. ``affected`` for dim
 * logic) skip the id-then-second-find boilerplate. Generic ``T`` so
 * callers that thread extra fields through ``propertyRooms`` (beyond
 * the ``id`` / ``room_name`` required by this module) keep access
 * to those fields on the returned row.
 */
export function resolveCanvasRoomBackendRow<T extends PropertyRoomLike>(
  canvasRoom: CanvasRoomLike,
  propertyRooms: ReadonlyArray<T> | undefined,
): T | undefined {
  const id = resolveCanvasRoomBackendId(canvasRoom, propertyRooms);
  if (!id) return undefined;
  return propertyRooms?.find((pr) => pr.id === id);
}

/**
 * Return the full set of backend job_room ids that pins on this
 * canvas room might be attributed to.
 *
 * Both provenances can legitimately coexist for a single canvas
 * room: pins dropped pre-backfill carry the name-matched id; pins
 * dropped post-backfill carry the propertyRoomId. The pin-follow-room
 * translation effect needs both to track correctly.
 *
 * Same duplicate-name guard as `resolveCanvasRoomBackendId`: a
 * name match with multiple candidates contributes nothing rather
 * than risk attributing pins to the wrong sibling room.
 */
export function resolveCanvasRoomCandidateIds(
  canvasRoom: CanvasRoomLike,
  propertyRooms: ReadonlyArray<PropertyRoomLike> | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (canvasRoom.propertyRoomId) ids.add(canvasRoom.propertyRoomId);
  if (propertyRooms) {
    const matches = propertyRooms.filter(
      (pr) => pr.room_name === canvasRoom.name,
    );
    if (matches.length === 1) ids.add(matches[0].id);
  }
  return ids;
}
