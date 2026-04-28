// Resolve a canvas room's corresponding backend job_rooms identity.
//
// ─── Why this exists, post-Phase-2 location-split ─────────────────────
//
// A Konva canvas carries rooms that link to backend `job_rooms` rows
// for moisture-pin attribution, visibility filtering, and the
// pin-follow-room translation effect. Phase 2 location-split (Spec
// 01H, migration e2b3c4d5f6a7) eliminated the transient
// "unsaved-room" window: every canvas room owns its
// `propertyRoomId` from t=0 (generated client-side via
// `newRoomUuid()` in `floor-plan-tools.ts` and committed to backend
// idempotently by `create_room`). The previous name-match fallback
// — which guessed the backend id by matching `propertyRooms.find(pr
// => pr.room_name === room.name)` when `propertyRoomId` was missing
// — became unreachable after that change AND was the failure trigger
// for the duplicate-name bug: two "Bedroom"s with no propertyRoomId
// collided under name match, ambiguity returned null, pin-follow
// silently no-op'd on drag.
//
// This module now does pure ID lookup. If `propertyRoomId` is
// missing on a canvas room, we return `null` — a loud signal to the
// caller that the room can't be resolved (probably legacy
// canvas_data predating the fix; should be rare in practice and
// requires manual fixup or re-saving the floor plan to backfill).
//
// Lesson #2 ("never silently coerce to a default"): we explicitly do
// NOT guess via name; the caller decides what "can't resolve"
// means in its context (skip pin in render, log + continue in
// follow, etc.).

export interface CanvasRoomLike {
  /** Optional in the type because hydrating pre-Phase-2 canvas_data
   *  may produce rooms without it. New rooms always set this at
   *  creation via `newRoomUuid()`. Resolver returns null when
   *  missing rather than falling back to name-match. */
  propertyRoomId?: string;
  /** Kept on the interface for component-level display ("Bedroom"
   *  vs "Kitchen") but no longer used for backend identity
   *  resolution. */
  name: string;
}

export interface PropertyRoomLike {
  id: string;
  room_name: string;
}

/**
 * Return the canvas room's backend `job_rooms.id`, or `null` if it
 * isn't resolvable.
 */
export function resolveCanvasRoomBackendId(
  canvasRoom: CanvasRoomLike,
): string | null {
  return canvasRoom.propertyRoomId ?? null;
}

/**
 * Companion to :func:`resolveCanvasRoomBackendId` that returns the
 * full property-room row instead of just its id. Call sites that
 * need per-row fields (e.g. `affected` for dim logic) skip the
 * id-then-second-find boilerplate. Generic `T` so callers that
 * thread extra fields through `propertyRooms` keep access to those
 * fields on the returned row.
 */
export function resolveCanvasRoomBackendRow<T extends PropertyRoomLike>(
  canvasRoom: CanvasRoomLike,
  propertyRooms: ReadonlyArray<T> | undefined,
): T | undefined {
  if (!canvasRoom.propertyRoomId) return undefined;
  return propertyRooms?.find((pr) => pr.id === canvasRoom.propertyRoomId);
}

/**
 * Return the set of backend job_room ids that pins on this canvas
 * room might be attributed to.
 *
 * Pre-Phase-2 this returned both `propertyRoomId` AND a unique
 * name match (some pins were attributed via name-match before
 * propertyRoomId was backfilled). Post-fix, every pin uses
 * `propertyRoomId` exclusively, so this returns at most a one-element
 * set. Kept as a `Set<string>` for call-site signature stability.
 */
export function resolveCanvasRoomCandidateIds(
  canvasRoom: CanvasRoomLike,
): Set<string> {
  const ids = new Set<string>();
  if (canvasRoom.propertyRoomId) ids.add(canvasRoom.propertyRoomId);
  return ids;
}
