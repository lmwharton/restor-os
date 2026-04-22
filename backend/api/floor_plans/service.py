"""Floor Plans service — property-scoped CRUD + job-driven versioning.

Floor plans belong to properties (not jobs). Jobs pin to specific versions.
Uses authenticated client (RLS-enforced) for all operations.
Hard deletes (no deleted_at column on floor_plans).
"""

import logging
import math
from uuid import UUID, uuid4

from postgrest.exceptions import APIError
from shapely.geometry import MultiLineString
from shapely.ops import polygonize, unary_union

from api.floor_plans.schemas import FloorPlanCreate, FloorPlanUpdate
from api.shared.constants import ARCHIVED_JOB_STATUSES
from api.shared.database import get_authenticated_client
from api.shared.events import log_event
from api.shared.exceptions import AppException
from api.shared.guards import assert_job_on_floor_plan_property, ensure_job_mutable

logger = logging.getLogger(__name__)


# Round 3 (second critical review): the old _coerce_etag + compute_etag
# helpers were consolidated into api/shared/etag.py to kill a
# sibling-miss risk (the None handling had diverged between them).
# Every etag read + compare in this module goes through that module.
from api.shared.etag import etag_from_updated_at, etags_match  # noqa: E402

# Room fill colors (semi-transparent) cycled for detected rooms
_ROOM_COLORS = [
    "rgba(232,93,38,0.1)",
    "rgba(37,99,235,0.1)",
    "rgba(22,163,74,0.1)",
    "rgba(124,58,237,0.1)",
    "rgba(8,145,178,0.1)",
]

# Snap threshold in pixels — endpoints closer than this get merged
_SNAP_THRESHOLD_PX = 20

# Angle threshold in degrees for straightening walls to H/V
_STRAIGHTEN_ANGLE_DEG = 15

# Maximum walls to process (O(n^2) snap becomes slow above this)
_MAX_WALLS = 500

# Required keys for a valid wall dict
_WALL_REQUIRED_KEYS = {"x1", "y1", "x2", "y2"}

# Canvas keys preserved through cleanup (walls/rooms/scale/offset always set explicitly)
_CANVAS_PASSTHROUGH_KEYS = {"doors", "windows", "openings", "labels", "annotations"}


def cleanup_sketch(canvas_data: dict) -> dict:
    """Clean up a hand-drawn floor plan sketch.

    Pipeline:
      1. Validate + filter wall data
      2. Straighten near-horizontal / near-vertical walls
      3. Standardize wall lengths to nearest 0.25 ft
      4. Snap nearby endpoints together and align to grid (AFTER standardize)
      5. Detect rooms via Shapely polygonize (with unary_union noding for T-junctions)
      6. Calculate room areas and bounding-box dimensions
    """
    walls = canvas_data.get("walls", [])
    scale = canvas_data.get("scale", 24)  # px per foot

    if not walls:
        return canvas_data

    # --- Step 1: Validate wall data --------------------------------------
    validated_walls = [
        wall
        for wall in walls
        if isinstance(wall, dict)
        and _WALL_REQUIRED_KEYS.issubset(wall.keys())
        and all(isinstance(wall[k], (int, float)) for k in _WALL_REQUIRED_KEYS)
    ]

    if not validated_walls:
        return canvas_data

    if len(validated_walls) > _MAX_WALLS:
        raise AppException(
            status_code=400,
            detail=f"Too many walls ({len(validated_walls)}). Maximum is {_MAX_WALLS}.",
            error_code="TOO_MANY_WALLS",
        )

    # --- Step 2: Straighten walls ----------------------------------------
    straightened = _straighten_walls(validated_walls, scale)

    # --- Step 3: Standardize lengths BEFORE snap -------------------------
    # (If we snap first then standardize, standardize moves endpoints and
    # un-snaps them. Standardize first, then snap to close gaps.)
    straightened = _standardize_lengths(straightened, scale)

    # --- Step 4: Snap endpoints within threshold (AFTER standardize) -----
    straightened = _snap_endpoints(straightened, scale)

    # --- Step 4b: Join pass — force endpoints within a tight threshold
    # to share exact coordinates (standardize can drift them apart)
    straightened = _join_endpoints(straightened)

    # --- Step 5 & 6: Detect rooms using Shapely --------------------------
    rooms = _detect_rooms(straightened, scale)

    # Preserve allowlisted canvas keys (doors, windows, openings, labels, etc.)
    result = {k: v for k, v in canvas_data.items() if k in _CANVAS_PASSTHROUGH_KEYS}
    result["walls"] = straightened
    result["rooms"] = rooms
    result["scale"] = scale
    result["offset"] = canvas_data.get("offset", {"x": 0, "y": 0})
    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _straighten_walls(walls: list[dict], scale: int) -> list[dict]:
    """Snap near-H walls to horizontal and near-V walls to vertical."""
    result = []
    for wall in walls:
        x1, y1 = wall["x1"], wall["y1"]
        x2, y2 = wall["x2"], wall["y2"]
        dx, dy = x2 - x1, y2 - y1
        angle = math.degrees(math.atan2(abs(dy), abs(dx)))

        if angle < _STRAIGHTEN_ANGLE_DEG:
            # Near horizontal — flatten y to grid-snapped average
            avg_y = round(((y1 + y2) / 2) / scale) * scale
            y1 = y2 = avg_y
        elif angle > (90 - _STRAIGHTEN_ANGLE_DEG):
            # Near vertical — flatten x to grid-snapped average
            avg_x = round(((x1 + x2) / 2) / scale) * scale
            x1 = x2 = avg_x

        result.append({**wall, "x1": x1, "y1": y1, "x2": x2, "y2": y2})
    return result


def _collect_endpoints(
    walls: list[dict],
) -> list[tuple[int, str, float, float]]:
    """Return (wall_index, "start"|"end", x, y) for every wall endpoint."""
    return [
        pt
        for i, w in enumerate(walls)
        for pt in ((i, "start", w["x1"], w["y1"]), (i, "end", w["x2"], w["y2"]))
    ]


def _cluster_endpoints(
    endpoints: list[tuple[int, str, float, float]],
    threshold: float,
) -> list[list[int]]:
    """Greedy-cluster endpoint indices whose coordinates are within threshold px."""
    used: set[int] = set()
    clusters: list[list[int]] = []
    for i in range(len(endpoints)):
        if i in used:
            continue
        cluster = [i]
        used.add(i)
        px, py = endpoints[i][2], endpoints[i][3]
        for j in range(i + 1, len(endpoints)):
            if j in used:
                continue
            qx, qy = endpoints[j][2], endpoints[j][3]
            if math.hypot(px - qx, py - qy) < threshold:
                cluster.append(j)
                used.add(j)
        clusters.append(cluster)
    return clusters


def _apply_to_walls(
    walls: list[dict],
    endpoints: list[tuple[int, str, float, float]],
    cluster: list[int],
    x: float,
    y: float,
) -> None:
    """Set all endpoints in a cluster to (x, y) on the walls list (mutates)."""
    for k in cluster:
        wall_idx, which_end, _, _ = endpoints[k]
        if which_end == "start":
            walls[wall_idx]["x1"] = x
            walls[wall_idx]["y1"] = y
        else:
            walls[wall_idx]["x2"] = x
            walls[wall_idx]["y2"] = y


def _snap_endpoints(walls: list[dict], scale: int) -> list[dict]:
    """Merge wall endpoints that are within _SNAP_THRESHOLD_PX of each other,
    then align merged positions to the nearest grid point.
    """
    endpoints = _collect_endpoints(walls)
    clusters = _cluster_endpoints(endpoints, _SNAP_THRESHOLD_PX)

    walls = [dict(w) for w in walls]  # shallow copy
    for cluster in clusters:
        avg_x = sum(endpoints[k][2] for k in cluster) / len(cluster)
        avg_y = sum(endpoints[k][3] for k in cluster) / len(cluster)
        snapped_x = round(avg_x / scale) * scale
        snapped_y = round(avg_y / scale) * scale
        _apply_to_walls(walls, endpoints, cluster, snapped_x, snapped_y)

    return walls


def _join_endpoints(walls: list[dict], threshold: float = 5.0) -> list[dict]:
    """Force-join endpoints that are nearly coincident (within threshold px).

    Unlike _snap_endpoints which grid-snaps, this picks the exact coordinate
    of the first point in each cluster so lines physically meet.
    """
    endpoints = _collect_endpoints(walls)
    clusters = _cluster_endpoints(endpoints, threshold)

    walls = [dict(w) for w in walls]
    for cluster in clusters:
        if len(cluster) < 2:
            continue
        # Use the first point's coords as the join target
        px, py = endpoints[cluster[0]][2], endpoints[cluster[0]][3]
        _apply_to_walls(walls, endpoints, cluster, px, py)

    return walls


def _standardize_lengths(walls: list[dict], scale: int) -> list[dict]:
    """Round each wall's length to the nearest 0.25 ft and adjust the
    second endpoint to match while preserving direction.
    """
    result = []
    for wall in walls:
        x1, y1 = wall["x1"], wall["y1"]
        x2, y2 = wall["x2"], wall["y2"]
        dx, dy = x2 - x1, y2 - y1
        length_px = math.hypot(dx, dy)

        if length_px == 0:
            result.append(wall)
            continue

        length_ft = length_px / scale
        rounded_ft = round(length_ft * 4) / 4  # nearest 0.25 ft
        if rounded_ft == 0:
            rounded_ft = 0.25  # minimum wall length

        new_length_px = rounded_ft * scale
        ratio = new_length_px / length_px
        new_x2 = x1 + dx * ratio
        new_y2 = y1 + dy * ratio

        # Grid-snap the adjusted endpoint
        new_x2 = round(new_x2 / scale) * scale
        new_y2 = round(new_y2 / scale) * scale

        result.append({**wall, "x1": x1, "y1": y1, "x2": new_x2, "y2": new_y2})
    return result


def _detect_rooms(walls: list[dict], scale: int) -> list[dict]:
    """Use Shapely polygonize to find closed regions formed by wall segments."""
    lines = [
        ((w["x1"], w["y1"]), (w["x2"], w["y2"]))
        for w in walls
        if (w["x1"], w["y1"]) != (w["x2"], w["y2"])  # skip zero-length walls
    ]

    if not lines:
        return []

    rooms: list[dict] = []
    try:
        multi_line = MultiLineString(lines)
        # unary_union nodes the lines at all intersection points (T-junctions, crossings)
        # Without this, polygonize only finds rooms from endpoint-connected walls
        noded = unary_union(multi_line)
        polygons = list(polygonize(noded))

        for i, poly in enumerate(polygons):
            vertices = [{"x": x, "y": y} for x, y in poly.exterior.coords[:-1]]
            area_px = poly.area
            area_sqft = area_px / (scale * scale)

            minx, miny, maxx, maxy = poly.bounds
            width_ft = (maxx - minx) / scale
            length_ft = (maxy - miny) / scale

            rooms.append(
                {
                    "id": f"room-{i + 1}",
                    "name": f"Room {i + 1}",
                    "vertices": vertices,
                    "color": _ROOM_COLORS[i % len(_ROOM_COLORS)],
                    "area_sqft": round(area_sqft, 1),
                    "width_ft": round(width_ft, 1),
                    "length_ft": round(length_ft, 1),
                }
            )
    except Exception:
        logger.exception("polygonize failed during sketch cleanup")

    return rooms


# ---------------------------------------------------------------------------
# CRUD — property-scoped floor plans
# ---------------------------------------------------------------------------


async def create_floor_plan(
    token: str,
    property_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: FloorPlanCreate,
    job_id: UUID | None = None,
) -> dict:
    """Create the initial floor plan (version 1) for a (property, floor).

    After the container/versions merge, a "floor plan" IS a versioned snapshot.
    The first save for a given (property_id, floor_number) becomes v1 with
    is_current=true. Subsequent saves route through `save_canvas`.

    When `job_id` is provided (typical: the by-job create endpoint), the row is
    stamped as `created_by_job_id=job_id`. The caller is responsible for pinning
    the job to this row so that the job's first content save lands on v1
    (Case 2: update in place) instead of forking v2.
    """
    client = await get_authenticated_client(token)

    existing = await (
        client.table("floor_plans")
        .select("id")
        .eq("property_id", str(property_id))
        .eq("floor_number", body.floor_number)
        .eq("is_current", True)
        .execute()
    )
    if existing.data:
        raise AppException(
            status_code=409,
            detail=f"Floor plan for floor {body.floor_number} already exists on this property",
            error_code="FLOOR_PLAN_EXISTS",
        )

    row = {
        "property_id": str(property_id),
        "company_id": str(company_id),
        "floor_number": body.floor_number,
        "floor_name": body.floor_name,
        # canvas_data is NOT NULL with a JSONB default, but the DB default only
        # applies for absent columns. Sending explicit NULL violates the
        # constraint, so coerce None → {} when the caller doesn't provide one
        # (e.g., creating an empty floor shell before the user draws anything).
        "canvas_data": body.canvas_data if body.canvas_data is not None else {},
        # Unified floor_plans schema adds version bookkeeping.
        "version_number": 1,
        "is_current": True,
        "created_by_user_id": str(user_id),
        # Stamp the creating job (if any) so save_canvas's Case 2 ownership
        # check matches on the very first content save and updates v1 in place.
        "created_by_job_id": str(job_id) if job_id else None,
    }

    try:
        result = await client.table("floor_plans").insert(row).execute()
    except APIError as e:
        # R7 (round 2): the partial unique index `idx_floor_plans_current_unique`
        # on (property_id, floor_number) WHERE is_current=true fires when two
        # concurrent creates both pass the existence check above and race to
        # INSERT. The loser hits Postgres 23505 — surface it as a retryable
        # 409 CONCURRENT_EDIT, matching _create_version's symmetric handler.
        # Otherwise the client sees a bare 500 DB_ERROR for what is actually
        # a retriable race (two tabs / double-tap / sibling job).
        if getattr(e, "code", None) == "23505":
            raise AppException(
                status_code=409,
                detail="Another writer created this floor plan concurrently — retry",
                error_code="CONCURRENT_EDIT",
            )
        raise AppException(
            status_code=500,
            detail=f"Failed to create floor plan: {e.message}",
            error_code="DB_ERROR",
        )

    floor_plan = result.data[0]

    await log_event(
        company_id,
        "floor_plan_created",
        user_id=user_id,
        event_data={
            "floor_plan_id": floor_plan["id"],
            "property_id": str(property_id),
            "floor_number": body.floor_number,
        },
    )

    return floor_plan


async def list_floor_plans_by_property(
    token: str,
    property_id: UUID,
    company_id: UUID,
) -> dict:
    """List the CURRENT floor plan for each floor at a property.

    After the container/versions merge, a "floor plan" is a versioned row.
    Listing returns one entry per floor (the is_current=true snapshot),
    preserving the API contract callers expect ("one floor_plan per floor").
    To enumerate history for a specific floor, use `list_versions`.
    """
    client = await get_authenticated_client(token)

    result = await (
        client.table("floor_plans")
        .select("*", count="exact")
        .eq("property_id", str(property_id))
        .eq("company_id", str(company_id))
        .eq("is_current", True)
        .order("floor_number")
        .execute()
    )

    items = result.data or []
    total = result.count if isinstance(result.count, int) else len(items)
    return {"items": items, "total": total}


async def list_floor_plans_by_job(
    token: str,
    job_id: UUID,
    company_id: UUID,
) -> dict:
    """Convenience: list floor plans for a job's property.

    Resolves the job's property_id, then delegates to list_floor_plans_by_property.
    Returns {"items": [...], "total": N}.
    """
    client = await get_authenticated_client(token)

    # Get job's property_id
    job_result = await (
        client.table("jobs")
        .select("property_id")
        .eq("id", str(job_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not job_result.data:
        raise AppException(
            status_code=404,
            detail="Job not found",
            error_code="JOB_NOT_FOUND",
        )

    # Job exists but has no property yet — return an empty list rather than 404.
    # Property is auto-created on first floor-plan creation (see create_floor_plan_by_job_endpoint),
    # so "no property" is a valid transitional state, not an error.
    if not job_result.data.get("property_id"):
        return {"items": [], "total": 0}

    return await list_floor_plans_by_property(
        token=token,
        property_id=UUID(job_result.data["property_id"]),
        company_id=company_id,
    )


async def update_floor_plan(
    token: str,
    floor_plan_id: UUID,
    property_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: FloorPlanUpdate,
    if_match: str | None = None,
) -> dict:
    """Update a floor plan. Validates floor_number uniqueness if changed.

    Round 3 (second critical review): accepts ``if_match`` for etag
    optimistic-concurrency protection. When supplied and not matching the
    row's current ``updated_at``, raises 412 ``VERSION_STALE``. Matches
    the save_canvas contract so every write path to floor_plans has the
    same same-row lost-update guard.
    """
    client = await get_authenticated_client(token)

    existing = await (
        client.table("floor_plans")
        .select("*")
        .eq("id", str(floor_plan_id))
        .eq("property_id", str(property_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not existing.data:
        raise AppException(
            status_code=404,
            detail="Floor plan not found",
            error_code="FLOOR_PLAN_NOT_FOUND",
        )

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return existing.data

    # W5: frozen-version guard — non-current rows are IMMUTABLE history.
    # Previously this only blocked canvas_data/floor_number and left
    # floor_name + thumbnail_url editable; a rename of v1 after v2 was
    # forked would break audit comparisons (the label diff wouldn't be
    # captured at v1's creation). Frozen means frozen across all fields.
    # If a thumbnail needs regenerating, do it via a dedicated endpoint
    # that logs the regeneration as its own event.
    if not existing.data.get("is_current") and updates:
        raise AppException(
            status_code=403,
            detail="Cannot modify a frozen (non-current) version",
            error_code="VERSION_FROZEN",
        )

    # Round-3 etag check — see save_canvas for the same pattern + rationale.
    # Runs AFTER the frozen-row guard so a caller editing a frozen version
    # with a stale etag sees VERSION_FROZEN (the actionable error) directly
    # instead of 412 first and VERSION_FROZEN only on retry.
    #
    # Post-review MEDIUM #3: the initial string compare here is a fast
    # reject with a useful error body (current_etag in extra), but the
    # actual atomicity guarantee is enforced by adding
    # .eq("updated_at", existing_updated_at) to the UPDATE below. That
    # closes the TOCTOU window — two concurrent renames read the same
    # etag, both pass the string compare, but only ONE UPDATE matches
    # the updated_at filter (trg_floor_plans_updated_at bumps it on
    # every write). The loser's .update() returns zero rows and we
    # surface 412 VERSION_STALE.
    existing_updated_at = existing.data.get("updated_at")
    if if_match is not None:
        current_etag = etag_from_updated_at(existing_updated_at)
        if not etags_match(current_etag, if_match):
            raise AppException(
                status_code=412,
                detail=(
                    "Floor plan was updated by another editor. Reload "
                    "and retry with a fresh etag."
                ),
                error_code="VERSION_STALE",
                extra={"current_etag": current_etag, "received_etag": if_match},
            )

    if "floor_number" in updates and updates["floor_number"] != existing.data["floor_number"]:
        # Post-merge: multiple rows can share (property_id, floor_number) as versions.
        # The uniqueness rule we enforce is: only one CURRENT version per floor.
        dup = await (
            client.table("floor_plans")
            .select("id")
            .eq("property_id", str(property_id))
            .eq("floor_number", updates["floor_number"])
            .eq("is_current", True)
            .neq("id", str(floor_plan_id))
            .execute()
        )
        if dup.data:
            raise AppException(
                status_code=409,
                detail=f"Floor plan for floor {updates['floor_number']} already exists",
                error_code="FLOOR_PLAN_EXISTS",
            )

    try:
        # R4 (round 2): filter on is_current=true atomically. Without this,
        # a sibling Case 3 fork between L503 and here can flip is_current=false
        # on the target row, and the UPDATE silently mutates frozen history.
        # Zero rows matched ⇒ the row was frozen mid-flight; treat as VERSION_FROZEN.
        #
        # Post-review MEDIUM #3: when the caller supplied If-Match, also
        # filter on updated_at so a concurrent rename racing with us
        # can't sneak past the compare above. trg_floor_plans_updated_at
        # bumps updated_at on every UPDATE, so the loser's filter misses
        # and we surface 412 (distinguished from VERSION_FROZEN below by
        # re-reading the row's is_current state).
        query = (
            client.table("floor_plans")
            .update(updates)
            .eq("id", str(floor_plan_id))
            .eq("company_id", str(company_id))
            .eq("is_current", True)
        )
        if if_match is not None and existing_updated_at is not None:
            query = query.eq("updated_at", existing_updated_at)
        result = await query.execute()
        if not result.data:
            # Zero rows matched — either the row was frozen (is_current
            # flipped) or a concurrent rename bumped updated_at past our
            # if_match filter. Re-read to tell them apart so the client
            # gets the right retry signal.
            post = await (
                client.table("floor_plans")
                .select("is_current, updated_at")
                .eq("id", str(floor_plan_id))
                .eq("company_id", str(company_id))
                .single()
                .execute()
            )
            if post.data and post.data.get("is_current") and if_match is not None:
                # Row still current — the updated_at filter is what kicked
                # us out, i.e. someone else wrote between our read and
                # our update. That's VERSION_STALE, not VERSION_FROZEN.
                current_etag = etag_from_updated_at(post.data.get("updated_at"))
                raise AppException(
                    status_code=412,
                    detail=(
                        "Floor plan was updated by another editor. Reload "
                        "and retry with a fresh etag."
                    ),
                    error_code="VERSION_STALE",
                    extra={"current_etag": current_etag, "received_etag": if_match},
                )
            raise AppException(
                status_code=403,
                detail="Floor plan was forked by another edit — retry against the current version",
                error_code="VERSION_FROZEN",
            )
    except APIError as e:
        err_code = getattr(e, "code", None)
        # Round-2 follow-on #4: the R4 belt-and-suspenders trigger raises
        # 55006 on any attempt to mutate a frozen row. The app-layer
        # `.eq("is_current", True)` filter above normally catches the race
        # first, but if the trigger fires (e.g., race between the filter
        # match and the write) surface it as VERSION_FROZEN so the client
        # sees a coherent retry signal instead of an opaque 500.
        if err_code == "55006":
            raise AppException(
                status_code=403,
                detail="Floor plan version is frozen — retry against the current version",
                error_code="VERSION_FROZEN",
            )
        logger.error(
            "Floor plan update failed: %s (code=%s, details=%s)",
            e.message,
            e.code,
            e.details,
        )
        raise AppException(
            status_code=500,
            detail=f"Failed to update floor plan: {e.message}",
            error_code="DB_ERROR",
        )

    floor_plan = result.data[0]

    await log_event(
        company_id,
        "floor_plan_updated",
        user_id=user_id,
        event_data={"floor_plan_id": str(floor_plan_id), "updates": list(updates.keys())},
    )

    return floor_plan


async def delete_floor_plan(
    token: str,
    floor_plan_id: UUID,
    property_id: UUID,
    company_id: UUID,
    user_id: UUID,
) -> None:
    """Hard delete a single floor plan version row.

    W4 fix: this endpoint targets one row by id (per the URL shape
    /properties/{id}/floor-plans/{fp_id}) and deletes only that row.
    Previously it wiped every version for the whole floor — a caller
    expecting "roll back one bad version" lost all of history. To
    delete a whole floor, use DELETE /properties/{id} to cascade via
    the property FK, or delete each version one by one.

    Guardrails:
    - 409 VERSIONS_EXIST if other versions exist on the same floor —
      the caller has to be explicit about which one they want gone.
    - Linked job_rooms get floor_plan_id=NULL via the ON DELETE SET
      NULL FK (no manual unlink needed).
    """
    client = await get_authenticated_client(token)

    existing = await (
        client.table("floor_plans")
        .select("id, floor_number, is_current")
        .eq("id", str(floor_plan_id))
        .eq("property_id", str(property_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not existing.data:
        raise AppException(
            status_code=404,
            detail="Floor plan not found",
            error_code="FLOOR_PLAN_NOT_FOUND",
        )
    floor_number = existing.data["floor_number"]

    # W4: if other versions exist on this floor, refuse the delete. Forces
    # the caller to either delete the whole property (cascade) or pick one
    # row at a time — no accidental history wipe.
    siblings = await (
        client.table("floor_plans")
        .select("id", count="exact")
        .eq("property_id", str(property_id))
        .eq("floor_number", floor_number)
        .neq("id", str(floor_plan_id))
        .execute()
    )
    sibling_count = siblings.count if isinstance(siblings.count, int) else len(siblings.data or [])
    if sibling_count > 0:
        raise AppException(
            status_code=409,
            detail=(
                f"Cannot delete this floor plan: {sibling_count} other version(s) "
                "exist on the same floor. Delete the whole property to cascade, "
                "or remove other versions first."
            ),
            error_code="VERSIONS_EXIST",
        )

    # Unlink rooms that reference this specific row (FK would SET NULL
    # on delete anyway, but doing it explicitly keeps the intent clear).
    await (
        client.table("job_rooms")
        .update({"floor_plan_id": None})
        .eq("floor_plan_id", str(floor_plan_id))
        .execute()
    )

    # Hard delete just this one row.
    await (
        client.table("floor_plans")
        .delete()
        .eq("id", str(floor_plan_id))
        .execute()
    )

    await log_event(
        company_id,
        "floor_plan_deleted",
        user_id=user_id,
        event_data={"floor_plan_id": str(floor_plan_id), "property_id": str(property_id)},
    )


# ---------------------------------------------------------------------------
# Versioning — job-driven floor plan versions
# ---------------------------------------------------------------------------


async def save_canvas(
    token: str,
    floor_plan_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    canvas_data: dict,
    change_summary: str | None = None,
    if_match: str | None = None,
) -> dict:
    """Save canvas changes for a job. Implements the versioning state machine:

    1. No pin → create v1, pin this job.
    2. Pin is owned by this job AND points at this floor AND is still is_current
       → update in place.
    3. Otherwise → fork a new version (inherits content from current), pin this
       job. Sibling jobs keep their own pins (no auto-upgrade) — frozen-version
       semantics: a job's pin only moves when that job itself saves.

    After the container/versions merge, `floor_plan_id` is a row in the unified
    floor_plans table (i.e., a specific version). We resolve its property_id +
    floor_number to scope fork/current-flip operations to the right floor.

    Round 3: optimistic-concurrency guard via ``if_match``. When present,
    compares to the target row's ``updated_at`` (the row's etag). Mismatch
    → 412 ``VERSION_STALE`` with the current etag in the error detail so
    the client can fetch-and-merge without guessing. When absent (older
    client / pre-rollout), the check is skipped for backward compat.
    """
    client = await get_authenticated_client(token)

    # Resolve (property_id, floor_number, updated_at) for the passed
    # floor_plan_id — we need updated_at too so we can enforce the
    # round-3 If-Match etag check. Single round-trip either way.
    target_floor_result = await (
        client.table("floor_plans")
        .select("property_id, floor_number, updated_at")
        .eq("id", str(floor_plan_id))
        .single()
        .execute()
    )
    if not target_floor_result.data:
        raise AppException(
            status_code=404,
            detail="Floor plan not found",
            error_code="FLOOR_PLAN_NOT_FOUND",
        )
    target_property_id = target_floor_result.data["property_id"]
    target_floor_number = target_floor_result.data["floor_number"]
    target_updated_at = target_floor_result.data.get("updated_at")

    # Fetch the job to get its current pinned version + property_id.
    # property_id is used to enforce W1: the passed floor_plan_id must live
    # on the job's own property. Without this check, a same-company tech
    # could pin their job to another property's floor plan by passing a
    # foreign floor_plan_id — RLS allows it but the invariant "a job's
    # floor plan lives on its property" is structurally broken.
    job_result = await (
        client.table("jobs")
        .select("id, floor_plan_id, status, property_id")
        .eq("id", str(job_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not job_result.data:
        raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")

    job = job_result.data

    # Archived jobs cannot save
    if job.get("status") in ARCHIVED_JOB_STATUSES:
        raise AppException(
            status_code=403,
            detail="Cannot edit floor plan for an archived job",
            error_code="JOB_ARCHIVED",
        )

    # W1 / R5: property cross-check via shared helper. Legacy rows with
    # property_id=NULL skip this (handled by create_floor_plan_by_job_endpoint's
    # auto-link path and by R8's tightening of save_canvas itself).
    assert_job_on_floor_plan_property(job, target_property_id)

    # Round 3 (post-review) — etag / If-Match optimistic-concurrency guard.
    # Runs AFTER domain guards (archive, property cross-check) so a caller
    # with a stale etag AND an archived-job / cross-property request sees
    # the actionable JOB_ARCHIVED / PROPERTY_MISMATCH first instead of a
    # shadow 412 that disappears on reload. Matching the row's real state
    # is only meaningful once the request is otherwise eligible.
    #
    # Round 6 (Lakshman P1 blocker #2 / lessons-doc pattern #24): the `*`
    # wildcard is a creation-flow opt-out that the permissive
    # `require_if_match` helper passes through literally. It's ONLY
    # legitimate when the target row has no current version yet
    # (target_updated_at IS NULL). Accepting `*` on a row that already
    # has a current_version was the round-5 bypass: the endpoint layer
    # declared "this route supports creation" and the service honored
    # None-means-skip without verifying the request is actually a
    # creation. The proxy doesn't hold — endpoint capability is not a
    # request-level assertion. Discriminate here, at the service, where
    # target_updated_at is known.
    if if_match == "*":
        # Round-6 follow-up (user-flagged escape-hatch closure): reject
        # `*` uniformly on save_canvas — target_updated_at is guaranteed
        # NOT NULL at the PG schema level
        # (`e1a7c9b30201_spec01h_merge_floor_plans_versions.py:238`
        # declares `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` +
        # trg_floor_plans_updated_at refreshes on every write). If we
        # reach save_canvas with if_match="*", it can only mean the
        # caller had no prior etag to assert — and since every
        # floor_plans row has updated_at set, there's no legitimate
        # "creation opt-out" scenario left for this endpoint. Accepting
        # `*` with NULL updated_at as a fallthrough would be a
        # second-layer escape hatch against the NOT NULL + trigger
        # invariant: if either breaks (accidental migration, direct DB
        # seed, rollback leaves the trigger off), the fallthrough
        # silently skips concurrency enforcement. Uniformly rejecting
        # removes that escape hatch. Behavior is identical to the
        # prior "if target_updated_at is not None" branch in the
        # architecturally-reachable case; strictly safer in the
        # unreachable-but-possible one. Schema invariant pinned by
        # TestRound5EtagContractInvariants::test_floor_plans_updated_at_is_not_null.
        raise AppException(
            status_code=412,
            detail=(
                "If-Match: * is not a valid precondition for this "
                "endpoint. Every floor plan row carries a concrete "
                "updated_at (schema-level NOT NULL); fetch the row's "
                "etag and retry with If-Match set to that value."
            ),
            error_code="WILDCARD_ON_EXISTING",
            extra={
                "current_etag": (
                    etag_from_updated_at(target_updated_at)
                    if target_updated_at is not None
                    else None
                )
            },
        )
    elif if_match is not None and target_updated_at is not None:
        current_etag = etag_from_updated_at(target_updated_at)
        # etags_match parses both sides, so microsecond precision / timezone
        # formatting drift (".000000+00:00" vs "+00:00") doesn't cause
        # spurious 412s. Falls back to string equality if either side isn't
        # parseable, covering hand-crafted inputs.
        if not etags_match(current_etag, if_match):
            raise AppException(
                status_code=412,
                detail=(
                    "Floor plan was updated by another editor. Reload the "
                    "page to see the latest state, then re-apply your edits."
                ),
                error_code="VERSION_STALE",
                extra={"current_etag": current_etag, "received_etag": if_match},
            )

    # R19 (round 2): capture a server-side snapshot of relational floor-plan
    # state (wall_segments, wall_openings, job_rooms.room_polygon,
    # job_rooms.floor_openings) so rollback_version can restore full fidelity.
    # The snapshot is stored inside canvas_data under `_relational_snapshot`
    # — additive, no schema change. Read the authoritative DB state here so
    # we capture what's really persisted (not whatever the frontend blob
    # claims). Room IDs come from canvas_data.rooms[].propertyRoomId.
    canvas_data = await _enrich_canvas_with_relational_snapshot(
        client, canvas_data, company_id,
    )

    # F7 (round-2 follow-on): post-enrichment size check. The W6 validator
    # enforces the incoming cap (500KB) at the router; enrichment adds the
    # snapshot server-side. Reject here if the enriched payload exceeds the
    # DB-row ceiling so "stored canvas_data ≤ MAX_STORED_CANVAS_DATA_BYTES"
    # stays an honest invariant. Pathological case (near-500KB incoming +
    # very complex floor plan) is rare; we surface it as 413 so the client
    # can split the save rather than silently oversize the row.
    import json as _json

    from api.floor_plans.schemas import MAX_STORED_CANVAS_DATA_BYTES

    _enriched_size = len(_json.dumps(canvas_data, separators=(",", ":")))
    if _enriched_size > MAX_STORED_CANVAS_DATA_BYTES:
        raise AppException(
            status_code=413,
            detail=(
                f"canvas_data after relational-snapshot enrichment is "
                f"{_enriched_size} bytes (max {MAX_STORED_CANVAS_DATA_BYTES}). "
                f"Reduce room / wall / opening count or simplify the canvas."
            ),
            error_code="CANVAS_TOO_LARGE",
        )

    # Round-5 INV-2: when the caller supplied a real If-Match (not the
    # creation marker "*", which is filtered out earlier when present),
    # thread target_updated_at down into the version-creating RPC as
    # p_expected_updated_at. The RPC's flip UPDATE carries that value
    # as an atomic AND filter — a concurrent Case 3 fork landing between
    # our Python etag check and the RPC call leaves zero rows to flip,
    # the RPC raises 55006, and _create_version surfaces 412 VERSION_STALE.
    # When if_match is None (no guard) OR target_updated_at is missing
    # (shouldn't happen, defensive), pass None and let the RPC fall back
    # to its backward-compat path.
    expected_for_rpc: str | None = (
        target_updated_at if if_match is not None and target_updated_at is not None else None
    )

    pinned_version_id = job.get("floor_plan_id")

    # Case 1: No pinned version — create version 1
    # RPC inside _create_version handles the pin atomically (C4).
    if not pinned_version_id:
        version = await _create_version(
            client=client,
            property_id=UUID(target_property_id),
            floor_number=target_floor_number,
            floor_name=None,  # inherits from any existing version of this floor
            company_id=company_id,
            job_id=job_id,
            user_id=user_id,
            canvas_data=canvas_data,
            change_summary=change_summary or "Initial floor plan version",
            expected_updated_at=expected_for_rpc,
        )

        await log_event(
            company_id,
            "floor_plan_version_created",
            job_id=job_id,
            user_id=user_id,
            event_data={
                "floor_plan_id": version["id"],
                "version_number": version["version_number"],
            },
        )
        return version

    # Fetch the pinned version
    pinned = await (
        client.table("floor_plans")
        .select("*")
        .eq("id", pinned_version_id)
        .single()
        .execute()
    )
    if not pinned.data:
        raise AppException(
            status_code=404,
            detail="Pinned version not found",
            error_code="VERSION_NOT_FOUND",
        )

    pinned_version = pinned.data

    # Case 2: Job owns the pinned version AND the pin is for THIS floor AND
    # the pinned row is STILL the current row (no newer version has superseded
    # it). All three conditions must hold to update in place.
    #
    # Immutability rule: once a version has been forked from (is_current=false),
    # it is frozen forever. Even its original creator can't modify it anymore —
    # they have to fork a new version on top. This is stricter than the
    # previous "same job + same floor" check, which would let mitigation keep
    # editing v1 after recon forked v2. Now v1 is truly permanent history
    # regardless of mitigation's job status or how many times mitigation saves.
    pinned_same_floor = (
        str(pinned_version.get("property_id")) == target_property_id
        and pinned_version.get("floor_number") == target_floor_number
    )
    pinned_still_current = bool(pinned_version.get("is_current"))
    if (
        pinned_version.get("created_by_job_id") == str(job_id)
        and pinned_same_floor
        and pinned_still_current
    ):
        # C3 fix: the memory-level `pinned_still_current` read above is
        # TOCTOU-racy — between that read and this UPDATE, a sibling job's
        # Case 3 fork can flip is_current=false on this row, turning it into
        # frozen history. Filtering the UPDATE on .eq("is_current", True)
        # lets Postgres enforce the check atomically. If zero rows match,
        # the pin is no longer current: fall through to Case 3 and fork a
        # new version on top of whoever just became current.
        #
        # Round-4 follow-through (sibling-miss of the cleanup fix): when
        # If-Match was supplied, also filter on updated_at so two concurrent
        # Case-2 saves on the same pinned row can't both win. Without this,
        # both pass the etag compare above (both saw T1), both land on
        # is_current=True, and the second UPDATE silently overwrites the
        # first — same shape we closed in cleanup_floor_plan and
        # update_floor_plan. target_updated_at is the value the client's
        # If-Match vouched for, so trailing writers whose view is stale
        # miss the filter and we disambiguate STALE vs FROZEN on zero rows.
        update_query = (
            client.table("floor_plans")
            .update(
                {
                    "canvas_data": canvas_data,
                    "change_summary": change_summary or pinned_version.get("change_summary"),
                }
            )
            .eq("id", pinned_version["id"])
            .eq("is_current", True)
        )
        if if_match is not None and target_updated_at is not None:
            update_query = update_query.eq("updated_at", target_updated_at)
        update_result = await update_query.execute()
        if update_result.data:
            # Re-fetch to return updated data
            updated = await (
                client.table("floor_plans")
                .select("*")
                .eq("id", pinned_version["id"])
                .single()
                .execute()
            )

            await log_event(
                company_id,
                "floor_plan_version_updated",
                job_id=job_id,
                user_id=user_id,
                event_data={
                    "floor_plan_id": pinned_version["id"],
                    "version_number": pinned_version["version_number"],
                },
            )
            return updated.data
        # Zero rows matched. Two possibilities:
        #   (a) is_current flipped to false — row was frozen mid-flight.
        #       Existing behavior: fall through to Case 3 and fork on top
        #       of whoever just became current. Client's canvas is
        #       preserved as a new version; nothing silently overwritten.
        #   (b) if_match was supplied and updated_at changed — a concurrent
        #       Case-2 save committed between our etag check and this
        #       UPDATE. Row is still current, just stale. Forking here
        #       would still preserve both canvases via versioning, but the
        #       client vouched for a specific updated_at via If-Match and
        #       deserves a 412 so their UI can reload + merge explicitly
        #       instead of silently creating a fork.
        # Re-read is_current to tell them apart; only raise STALE when
        # if_match was supplied AND the row is still current.
        if if_match is not None:
            post = await (
                client.table("floor_plans")
                .select("is_current, updated_at")
                .eq("id", pinned_version["id"])
                .single()
                .execute()
            )
            if post.data and post.data.get("is_current"):
                current_etag = etag_from_updated_at(post.data.get("updated_at"))
                raise AppException(
                    status_code=412,
                    detail=(
                        "Floor plan was updated by another editor. Reload "
                        "the page to see the latest state, then re-apply "
                        "your edits."
                    ),
                    error_code="VERSION_STALE",
                    extra={"current_etag": current_etag, "received_etag": if_match},
                )
        # else (or is_current=False): row was frozen mid-flight — fall
        # through to Case 3 (fork). Client's canvas becomes the new
        # version; the prior current row retains the other writer's work.

    # Case 3: Another job's version (or a different floor), or Case 2's
    # target was frozen mid-flight — fork new version.
    # The RPC inside _create_version handles flip + insert + pin atomically (C4).
    # Sibling jobs are NOT auto-upgraded — per frozen-version semantics, every
    # job stays on the version it last saved.
    #
    # Round-5 INV-2: pass expected_for_rpc (target_updated_at captured above)
    # so the RPC's flip UPDATE enforces the etag atomically. A concurrent
    # Case-3 fork that moved the current row past target_updated_at between
    # our etag check and this call surfaces as 412 VERSION_STALE instead of
    # silently demoting the other writer's fresh work to frozen history.
    version = await _create_version(
        client=client,
        property_id=UUID(target_property_id),
        floor_number=target_floor_number,
        floor_name=None,
        company_id=company_id,
        job_id=job_id,
        user_id=user_id,
        canvas_data=canvas_data,
        change_summary=change_summary or "Floor plan edited by new job",
        expected_updated_at=expected_for_rpc,
    )

    await log_event(
        company_id,
        "floor_plan_version_forked",
        job_id=job_id,
        user_id=user_id,
        event_data={
            "floor_plan_id": str(floor_plan_id),
            "from_version": pinned_version["version_number"],
            "new_version": version["version_number"],
        },
    )
    return version


async def list_versions(
    token: str,
    floor_plan_id: UUID,
    company_id: UUID,
) -> dict:
    """List all version snapshots for the floor that `floor_plan_id` belongs to,
    newest first. Scopes by (property_id, floor_number) resolved from the row.

    Returns {"items": [...], "total": N}.
    """
    client = await get_authenticated_client(token)

    # Resolve the floor identity from the passed row.
    anchor = await (
        client.table("floor_plans")
        .select("property_id, floor_number")
        .eq("id", str(floor_plan_id))
        .single()
        .execute()
    )
    if not anchor.data:
        return {"items": [], "total": 0}

    result = await (
        client.table("floor_plans")
        .select("*", count="exact")
        .eq("property_id", anchor.data["property_id"])
        .eq("floor_number", anchor.data["floor_number"])
        .eq("company_id", str(company_id))
        .order("version_number", desc=True)
        .execute()
    )

    items = result.data or []
    total = result.count if isinstance(result.count, int) else len(items)
    return {"items": items, "total": total}


async def get_version(
    token: str,
    floor_plan_id: UUID,
    version_number: int,
    company_id: UUID,
) -> dict:
    """Get a specific version by (this floor's property + floor_number, version_number)."""
    client = await get_authenticated_client(token)

    anchor = await (
        client.table("floor_plans")
        .select("property_id, floor_number")
        .eq("id", str(floor_plan_id))
        .single()
        .execute()
    )
    if not anchor.data:
        raise AppException(
            status_code=404,
            detail="Floor plan not found",
            error_code="FLOOR_PLAN_NOT_FOUND",
        )

    result = await (
        client.table("floor_plans")
        .select("*")
        .eq("property_id", anchor.data["property_id"])
        .eq("floor_number", anchor.data["floor_number"])
        .eq("version_number", version_number)
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail=f"Version {version_number} not found",
            error_code="VERSION_NOT_FOUND",
        )
    return result.data


async def rollback_version(
    token: str,
    floor_plan_id: UUID,
    version_number: int,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    if_match: str | None = None,
) -> dict:
    """Rollback: create a new version from a past version's canvas_data.

    Does NOT delete versions — creates a new one with the rolled-back content.
    Floor identity (property_id, floor_number) is resolved from the passed row.
    Archived jobs cannot rollback — frozen-version semantics, mirrors save_canvas.

    Round 3 (second critical review): accepts ``if_match`` so rollback is
    etag-protected. Rollback creates a new version from an old snapshot,
    which is a mutation of the floor-plan family state; without etag
    protection, a concurrent save + rollback can produce unexpected
    version layering. Matches the save_canvas contract.

    Round-5 (Lakshman P3 #5 closure): the ``if_match`` value is now
    threaded into ``rollback_floor_plan_version_atomic`` as
    ``p_expected_updated_at`` (migration c9d0e1f2a3b4). The inner
    ``save_floor_plan_version`` enforces it atomically on the flip —
    a concurrent save between our Python check and the RPC call moves
    the current row's updated_at past what we vouched for, the RPC
    raises 55006, we surface 412 VERSION_STALE. Symmetric with
    ``save_canvas`` Case 3 under round-5. Earlier rounds left this as
    a "fast-reject UX affordance" with a rationale about no data loss
    (history preserved) — Lakshman accepted that for rollback as P3
    (rare UX flow) but we close it uniformly now so the etag contract
    holds across every write path.
    """
    client = await get_authenticated_client(token)

    # Reject rollback from archived jobs — same rule as save_canvas. Without this,
    # an archived job could mint a new version + repin itself, breaking the
    # "frozen once archived" contract. property_id is selected so R5's
    # assert_job_on_floor_plan_property check runs with no extra round-trip.
    job_result = await (
        client.table("jobs")
        .select("status, property_id")
        .eq("id", str(job_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not job_result.data:
        raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")
    if job_result.data.get("status") in ARCHIVED_JOB_STATUSES:
        raise AppException(
            status_code=403,
            detail="Cannot rollback floor plan for an archived job",
            error_code="JOB_ARCHIVED",
        )

    anchor = await (
        client.table("floor_plans")
        .select("property_id, floor_number, updated_at")
        .eq("id", str(floor_plan_id))
        .single()
        .execute()
    )
    if not anchor.data:
        raise AppException(
            status_code=404,
            detail="Floor plan not found",
            error_code="FLOOR_PLAN_NOT_FOUND",
        )
    target_property_id = anchor.data["property_id"]
    target_floor_number = anchor.data["floor_number"]

    # R5 (round 2): the job's property must own the floor plan being rolled
    # back. Without this, a same-company user with a job on property A could
    # rollback any floor plan on property B they can read. Mirrors the W1
    # check in save_canvas and the RPC-level guard from R3.
    assert_job_on_floor_plan_property(job_result.data, target_property_id)

    # Fetch the target version to rollback to
    target = await (
        client.table("floor_plans")
        .select("*")
        .eq("property_id", target_property_id)
        .eq("floor_number", target_floor_number)
        .eq("version_number", version_number)
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not target.data:
        raise AppException(
            status_code=404,
            detail=f"Version {version_number} not found",
            error_code="VERSION_NOT_FOUND",
        )

    # Round-3 etag check (post-review: moved after domain guards). Rollback
    # creates a new is_current row from a historic snapshot, shifting job
    # pins. Runs AFTER archive, property cross-check, and target-version
    # lookup so a stale caller asking to rollback to a non-existent version
    # sees VERSION_NOT_FOUND directly instead of 412 → reload → 404.
    if if_match is not None:
        current_etag = etag_from_updated_at(anchor.data.get("updated_at"))
        if not etags_match(current_etag, if_match):
            raise AppException(
                status_code=412,
                detail=(
                    "Floor plan was updated by another editor. Reload "
                    "and reconfirm the rollback target."
                ),
                error_code="VERSION_STALE",
                extra={"current_etag": current_etag, "received_etag": if_match},
            )

    # F1 (round-2 follow-on): atomic rollback via a single plpgsql wrapper.
    # The wrapper RPC runs save_floor_plan_version + restore_floor_plan_relational_snapshot
    # inside ONE plpgsql function → ONE implicit transaction. If the restore
    # raises, Postgres rolls back the save too — no partial state.
    #
    # Previously this was two separate .rpc() calls at the Python layer;
    # a failure in restore left the new version row + job repin committed
    # while walls/openings still held pre-rollback state. That regressed
    # the C4 atomicity intent one layer up.
    #
    # Round-5 INV-2 (Lakshman P3 #5): thread the anchor's updated_at into
    # the RPC as p_expected_updated_at. The wrapper forwards to
    # save_floor_plan_version which enforces atomically on the flip. A
    # concurrent save that commits between our Python etag check above
    # and this RPC call moves the current row's updated_at past what we
    # vouched for — the RPC raises 55006, which we map to 412 below
    # (same semantic as save_canvas Case 3 under round-5).
    rpc_args: dict = {
        "p_target_floor_plan_id": str(target.data["id"]),
        "p_job_id": str(job_id),
        "p_user_id": str(user_id),
        "p_change_summary": f"Rolled back to version {version_number}",
    }
    anchor_updated_at = anchor.data.get("updated_at")
    if if_match is not None and anchor_updated_at is not None:
        rpc_args["p_expected_updated_at"] = anchor_updated_at

    try:
        rpc_result = await client.rpc(
            "rollback_floor_plan_version_atomic",
            rpc_args,
        ).execute()
    except APIError as e:
        err_code = getattr(e, "code", None)
        if err_code == "55006":
            # Round-5 L2: 55006 sources in the rollback path, explicitly
            # enumerated so future readers don't have to chase:
            #   (a) round-5 atomic etag check inside save_floor_plan_version
            #       (wrapper's inner call) — fires when p_expected_updated_at
            #       doesn't match the current row's updated_at. This is the
            #       round-5 P1 #1 closure and the common case when if_match
            #       was supplied.
            #   (b) R4 frozen-mutation trigger (d8e9f0a1b2c3) — fires when
            #       any UPDATE targets a row with OLD.is_current=false.
            #       Can only fire in rollback if restore_floor_plan_relational_
            #       snapshot touches a frozen row; the wrapper's flip itself
            #       targets is_current=true only, so this path is indirect.
            #   (c) Future plpgsql raises that pick 55006 (the class-55 slot
            #       for "invalid_prerequisite_state"). If you add one, update
            #       this comment AND ensure the if_match disambiguator below
            #       still holds.
            # Disambiguator: etag supplied → (a) dominates → 412 VERSION_STALE.
            # No etag supplied → (b) or (c) → 403 VERSION_FROZEN.
            if if_match is not None:
                raise AppException(
                    status_code=412,
                    detail=(
                        "Floor plan was updated by another editor between "
                        "your read and this rollback. Reload and reconfirm "
                        "the rollback target."
                    ),
                    error_code="VERSION_STALE",
                    extra={"received_etag": if_match},
                )
            # No etag supplied but 55006 fired — must be the pre-round-5
            # frozen-row trigger path. Surface as FROZEN for backward compat.
            raise AppException(
                status_code=403,
                detail="Floor plan version is frozen — retry against the current version",
                error_code="VERSION_FROZEN",
            )
        if err_code == "42501":
            raise AppException(
                status_code=403,
                detail="Cannot rollback: job is archived, has no property, "
                       "or the target version is on a different property.",
                error_code="ROLLBACK_FORBIDDEN",
            )
        if err_code == "P0002":
            raise AppException(
                status_code=404,
                detail="Rollback target or job not accessible.",
                error_code="ROLLBACK_NOT_FOUND",
            )
        if err_code == "23505":
            raise AppException(
                status_code=409,
                detail="Concurrent edit on this floor, please retry",
                error_code="CONCURRENT_EDIT",
            )
        logger.error(
            "Atomic rollback RPC failed: target=%s job=%s error=%s code=%s",
            target.data["id"], job_id, e.message, err_code,
        )
        raise AppException(
            status_code=500,
            detail=f"Rollback failed: {e.message}",
            error_code="ROLLBACK_FAILED",
        )

    payload = rpc_result.data
    if isinstance(payload, list):
        payload = payload[0] if payload else None
    if not payload or "version" not in payload:
        raise AppException(
            status_code=500,
            detail="Rollback RPC returned empty result",
            error_code="DB_ERROR",
        )
    version = payload["version"]
    restore_summary = payload.get("restore")

    # Surface legacy-version rollbacks (no _relational_snapshot on the
    # target) as a warning so operators can see which jobs had canvas-only
    # rollbacks vs. full-fidelity restores.
    if isinstance(restore_summary, dict) and not restore_summary.get("restored"):
        logger.warning(
            "Rollback relational-restore skipped (legacy snapshot): "
            "floor_plan_id=%s target_version=%s reason=%s",
            version["id"], version_number, restore_summary.get("reason"),
        )

    # F3: surface any rooms the restore couldn't reach (deleted / foreign)
    # so data-integrity issues are visible rather than silent.
    if isinstance(restore_summary, dict):
        skipped = restore_summary.get("skipped_rooms") or []
        if skipped:
            logger.warning(
                "Rollback skipped rooms (deleted or outside tenant scope): "
                "floor_plan_id=%s target_version=%s skipped_room_ids=%s",
                version["id"], version_number, skipped,
            )

    await log_event(
        company_id,
        "floor_plan_version_rollback",
        job_id=job_id,
        user_id=user_id,
        event_data={
            "floor_plan_id": version["id"],
            "rolled_back_to": version_number,
            "new_version": version["version_number"],
            "relational_restore": restore_summary,
        },
    )
    return version


# ---------------------------------------------------------------------------
# Versioning helpers (private)
# ---------------------------------------------------------------------------


# R19 (round 2) snapshot format version. Bumped when the on-disk shape of
# canvas_data._relational_snapshot changes in an incompatible way so the
# restore RPC can refuse to apply a mismatched version.
_RELATIONAL_SNAPSHOT_VERSION = 1


async def _enrich_canvas_with_relational_snapshot(
    client,
    canvas_data: dict,
    company_id: UUID,
) -> dict:
    """Attach ``_relational_snapshot`` to canvas_data capturing the current
    server-side state of wall_segments, wall_openings, and the JSONB fields
    on job_rooms (``room_polygon``, ``floor_openings``).

    Rooms in scope come from ``canvas_data["rooms"][*]["propertyRoomId"]`` —
    the frontend already stamps those with the backend ``job_rooms.id``. If
    a room has no ``propertyRoomId`` (e.g., drawn but never saved against
    the backend), it is skipped; the snapshot captures only rows that
    actually exist on the server.

    Returns a new dict — does not mutate the caller's canvas_data.
    """
    # F4 (round-2 follow-on): refuse to silently coerce a non-dict. The only
    # caller path is save_canvas, which receives canvas_data typed as dict
    # through FloorPlanSaveRequest (Pydantic-validated at the router). A
    # non-dict reaching here is a programmer error, not user input — fail
    # loudly so it surfaces in logs instead of quietly writing an empty
    # version and losing the user's edit.
    if not isinstance(canvas_data, dict):
        raise AppException(
            status_code=500,
            detail=(
                f"canvas_data must be a dict at this layer, got "
                f"{type(canvas_data).__name__}"
            ),
            error_code="INVALID_CANVAS_DATA",
        )
    # Defensive copy so the caller's dict isn't mutated.
    enriched = dict(canvas_data)

    rooms = enriched.get("rooms") or []
    room_ids: list[str] = []
    for r in rooms:
        if not isinstance(r, dict):
            continue
        pid = r.get("propertyRoomId") or r.get("property_room_id")
        if pid:
            room_ids.append(str(pid))

    if not room_ids:
        # Nothing to snapshot — record an empty snapshot so restore can
        # distinguish "explicitly empty" from "legacy / missing".
        enriched["_relational_snapshot"] = {
            "version": _RELATIONAL_SNAPSHOT_VERSION,
            "rooms": [],
        }
        return enriched

    # Room-level JSONB columns.
    rooms_result = await (
        client.table("job_rooms")
        .select("id, room_polygon, floor_openings")
        .in_("id", room_ids)
        .eq("company_id", str(company_id))
        .execute()
    )
    room_rows = rooms_result.data or []
    room_by_id: dict[str, dict] = {str(r["id"]): r for r in room_rows}

    # Walls for those rooms.
    walls_result = await (
        client.table("wall_segments")
        .select(
            "id, room_id, x1, y1, x2, y2, wall_type, wall_height_ft, "
            "affected, shared, shared_with_room_id, sort_order",
        )
        .in_("room_id", room_ids)
        .eq("company_id", str(company_id))
        .execute()
    )
    walls = walls_result.data or []
    wall_ids = [str(w["id"]) for w in walls]

    # Openings for those walls (nested inside their parent wall's snapshot).
    openings_by_wall: dict[str, list[dict]] = {}
    if wall_ids:
        openings_result = await (
            client.table("wall_openings")
            .select(
                "wall_id, opening_type, position, width_ft, height_ft, "
                "sill_height_ft, swing",
            )
            .in_("wall_id", wall_ids)
            .eq("company_id", str(company_id))
            .execute()
        )
        for op_row in openings_result.data or []:
            openings_by_wall.setdefault(str(op_row["wall_id"]), []).append({
                "opening_type": op_row.get("opening_type"),
                "position": op_row.get("position"),
                "width_ft": op_row.get("width_ft"),
                "height_ft": op_row.get("height_ft"),
                "sill_height_ft": op_row.get("sill_height_ft"),
                "swing": op_row.get("swing"),
            })

    # Build per-room snapshot entries.
    walls_by_room: dict[str, list[dict]] = {}
    for w in walls:
        room_id = str(w["room_id"])
        walls_by_room.setdefault(room_id, []).append({
            "x1": w.get("x1"),
            "y1": w.get("y1"),
            "x2": w.get("x2"),
            "y2": w.get("y2"),
            "wall_type": w.get("wall_type"),
            "wall_height_ft": w.get("wall_height_ft"),
            "affected": w.get("affected"),
            "shared": w.get("shared"),
            "shared_with_room_id": w.get("shared_with_room_id"),
            "sort_order": w.get("sort_order"),
            "_openings": openings_by_wall.get(str(w["id"]), []),
        })

    snapshot_rooms: list[dict] = []
    for rid in room_ids:
        room = room_by_id.get(rid)
        if not room:
            continue
        snapshot_rooms.append({
            "id": rid,
            "room_polygon": room.get("room_polygon"),
            "floor_openings": room.get("floor_openings"),
            "walls": walls_by_room.get(rid, []),
        })

    enriched["_relational_snapshot"] = {
        "version": _RELATIONAL_SNAPSHOT_VERSION,
        "rooms": snapshot_rooms,
    }
    return enriched


async def _create_version(
    client,
    property_id: UUID,
    floor_number: int,
    floor_name: str | None,
    company_id: UUID,
    job_id: UUID,
    user_id: UUID,
    canvas_data: dict,
    change_summary: str,
    expected_updated_at: str | None = None,
) -> dict:
    """Create a new floor plan version AND pin the creating job to it.

    C4 fix: delegates to the `save_floor_plan_version` plpgsql RPC so the
    flip + insert + pin sequence runs as one transaction. Previously these
    were three separate client calls; any failure between insert and pin
    left the job pointing at the old (frozen) row, and the next save on
    that job would fork another version, orphaning the one we just wrote.
    The RPC rolls back all three writes atomically on any error.

    C2 fix preserved: the RPC raises Postgres 23505 if the partial unique
    index on (property, floor) WHERE is_current=true is violated by a
    concurrent writer. We convert to 409 CONCURRENT_EDIT so the client
    retries; the retry re-enters save_canvas, sees the winner's row as
    current, and takes Case 3 (fork) cleanly on top of it.

    Round-5 (INV-2): ``expected_updated_at`` is forwarded to the RPC's
    ``p_expected_updated_at`` param (migration c9d0e1f2a3b4). When
    non-None, the RPC's flip UPDATE carries an atomic
    ``AND updated_at = p_expected_updated_at`` filter — a concurrent
    writer landing between the Python etag check and this RPC call
    leaves zero rows to flip, the RPC raises SQLSTATE ``55006``, and we
    map that to ``412 VERSION_STALE`` below. When None, the original
    behavior (no etag enforcement) holds — used for first-save-on-floor
    creation paths where no prior etag exists.
    """
    rpc_args = {
        "p_property_id":   str(property_id),
        "p_floor_number":  floor_number,
        "p_floor_name":    floor_name,
        "p_company_id":    str(company_id),
        "p_job_id":        str(job_id),
        "p_user_id":       str(user_id),
        "p_canvas_data":   canvas_data,
        "p_change_summary": change_summary,
    }
    if expected_updated_at is not None:
        # Only include the new param when the caller actually has an etag
        # to assert. Omitting preserves the pre-round-5 no-enforcement
        # behavior via the RPC's DEFAULT NULL and keeps older rollbacks /
        # first-saves working unchanged.
        rpc_args["p_expected_updated_at"] = expected_updated_at

    try:
        result = await client.rpc(
            "save_floor_plan_version",
            rpc_args,
        ).execute()
    except APIError as e:
        err_code = getattr(e, "code", None)
        if err_code == "23505":
            # C2 — concurrent writer won the partial-unique-index race.
            raise AppException(
                status_code=409,
                detail="Concurrent edit on this floor, please retry",
                error_code="CONCURRENT_EDIT",
            )
        if err_code == "55006":
            # d8e9f0a1b2c3 frozen-mutation trigger OR round-5 etag-stale
            # RPC raise (c9d0e1f2a3b4). The two share SQLSTATE by design —
            # both mean "row is not in the prerequisite state the caller
            # expected." When the caller supplied an expected_updated_at,
            # this is almost certainly the etag path; map to VERSION_STALE
            # so the client surfaces the stale-conflict banner. When no
            # etag was supplied, the only 55006 source is the frozen-row
            # trigger — map to VERSION_FROZEN (legacy code path).
            if expected_updated_at is not None:
                raise AppException(
                    status_code=412,
                    detail=(
                        "Floor plan was updated by another editor. Reload "
                        "the page to see the latest state, then re-apply "
                        "your edits."
                    ),
                    error_code="VERSION_STALE",
                    extra={"received_etag": expected_updated_at},
                )
            raise AppException(
                status_code=403,
                detail="Floor plan version is frozen — retry against the current version",
                error_code="VERSION_FROZEN",
            )
        if err_code == "42501":
            # R3 — RPC's JWT-derived company check rejected the caller.
            # Fires when the client-supplied p_company_id doesn't match the
            # company resolved from the JWT (cross-tenant attempt) or when
            # the JWT has no company at all.
            raise AppException(
                status_code=403,
                detail="Company mismatch for this floor plan",
                error_code="COMPANY_MISMATCH",
            )
        if err_code == "P0002":
            # R3 — property/job ownership check failed. Either the property
            # doesn't belong to the caller's company, or the job doesn't
            # live on that property. We don't 404 on bare "not found"
            # because we don't want to leak existence across tenants.
            raise AppException(
                status_code=400,
                detail="Floor plan does not belong to this job's property",
                error_code="PROPERTY_MISMATCH",
            )
        raise AppException(
            status_code=500,
            detail=f"Failed to create version: {e.message}",
            error_code="DB_ERROR",
        )

    data = result.data
    # supabase-py returns JSONB scalar directly as dict, or list-wrapped
    # depending on version; normalize.
    if isinstance(data, list):
        data = data[0] if data else None
    if not data:
        raise AppException(
            status_code=500,
            detail="RPC returned empty result",
            error_code="DB_ERROR",
        )
    return data


# ---------------------------------------------------------------------------
# Sketch cleanup (deterministic, no AI)
# ---------------------------------------------------------------------------


async def cleanup_floor_plan(
    token: str,
    floor_plan_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    client_canvas_data: dict | None = None,
    if_match: str | None = None,
) -> dict:
    """Run deterministic cleanup on a floor plan sketch.

    If client_canvas_data is provided, cleans the client's unsaved sketch.
    If None, fetches the saved canvas_data from the floor plan record.
    Either way, the cleaned result is saved back to the DB.

    Round 3 (second critical review): accepts ``if_match`` so cleanup is
    etag-protected too. Without this, Tech A's mid-edit work could be
    silently wiped by Tech B clicking "Cleanup" from a stale view.
    Matches the save_canvas contract.

    Returns SketchCleanupResponse with cleaned canvas_data, changes_made, event_id.
    """
    client = await get_authenticated_client(token)

    # Archive-job gate (C1) — always runs. Cleanup mutates canvas_data on
    # the is_current row, so a `collected` job's version must stay frozen.
    # job_id is required in SketchCleanupRequest; Pydantic 422's any caller
    # that omits it, so this guard has no conditional bypass. The returned
    # row carries property_id for the R5 cross-property check below.
    job = await ensure_job_mutable(client, job_id, company_id)

    # Fetch floor plan (verify ownership)
    result = await (
        client.table("floor_plans")
        .select("*")
        .eq("id", str(floor_plan_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Floor plan not found",
            error_code="FLOOR_PLAN_NOT_FOUND",
        )

    # R5 (round 2): the job's property must own this floor plan. Without
    # this, a same-company user whose job is on property A could trigger
    # cleanup (a canvas mutation) on any floor plan on property B they
    # can read. Mirrors the W1 check in save_canvas and the RPC-level
    # guard from R3.
    assert_job_on_floor_plan_property(job, result.data.get("property_id"))

    # Frozen-version guard — matches the rule in `update_floor_plan` and
    # `save_canvas` Case 2. Cleanup writes the cleaned canvas back to the
    # row (line below), which would silently mutate a frozen snapshot and
    # break the audit guarantee. Non-current rows are immutable history.
    if not result.data.get("is_current"):
        raise AppException(
            status_code=403,
            detail="Cannot run cleanup on a frozen (non-current) version",
            error_code="VERSION_FROZEN",
        )

    # Round-3 etag check (post-review: moved after domain guards).
    # Cleanup writes canvas_data back to the row — if another editor
    # (save_canvas, rollback, update) wrote since the cleanup-initiator's
    # last read, their cleaned blob would overwrite that work silently.
    # Runs AFTER archive + property + frozen-row guards so a stale caller
    # trying to clean a frozen version sees VERSION_FROZEN directly instead
    # of 412 → reload → 403. Reject with 412 so the client reloads + retries.
    #
    # Post-review round 4 (sibling-miss on MEDIUM #3 fix): the compare
    # below is a fast reject with a useful error body, but the actual
    # atomicity guarantee is enforced by adding
    # .eq("updated_at", existing_updated_at) to the UPDATE below. Without
    # that, a concurrent save committing between this check and the UPDATE
    # wins the race — none of (id, company_id, is_current=True) change
    # across a Case-2 save, so the cleanup UPDATE lands and overwrites
    # silently. trg_floor_plans_updated_at bumps updated_at on every
    # write, so the loser's filter misses and we surface 412 VERSION_STALE.
    # Same pattern as update_floor_plan.
    existing_updated_at = result.data.get("updated_at")
    if if_match is not None:
        current_etag = etag_from_updated_at(existing_updated_at)
        if not etags_match(current_etag, if_match):
            raise AppException(
                status_code=412,
                detail=(
                    "Floor plan was updated by another editor. Reload and "
                    "re-run cleanup on the fresh canvas."
                ),
                error_code="VERSION_STALE",
                extra={"current_etag": current_etag, "received_etag": if_match},
            )

    # Use client-supplied canvas_data (unsaved edits) or fall back to saved version
    canvas_data = client_canvas_data or result.data.get("canvas_data")
    if not canvas_data or not canvas_data.get("walls"):
        raise AppException(
            status_code=400,
            detail="Floor plan has no sketch to clean up",
            error_code="NO_SKETCH_DATA",
        )

    # Track what changed for the response
    original_walls = canvas_data.get("walls", [])
    original_wall_count = len(original_walls)

    # Run deterministic cleanup
    cleaned = cleanup_sketch(canvas_data)

    # Build changes_made list
    changes_made = []
    cleaned_walls = cleaned.get("walls", [])
    if len(cleaned_walls) != original_wall_count:
        changes_made.append(f"Wall count: {original_wall_count} -> {len(cleaned_walls)}")

    cleaned_rooms = cleaned.get("rooms", [])
    if cleaned_rooms:
        room_names = [r.get("name", f"Room {i + 1}") for i, r in enumerate(cleaned_rooms)]
        changes_made.append(f"Detected {len(cleaned_rooms)} room(s): {', '.join(room_names)}")

    coord_keys = ("x1", "y1", "x2", "y2")
    for w_orig, w_clean in zip(original_walls, cleaned_walls):
        if any(w_orig.get(k) != w_clean.get(k) for k in coord_keys):
            changes_made.append(f"Adjusted wall {w_clean.get('id', '?')}")

    if not changes_made:
        changes_made.append("Sketch already clean -- no changes needed")

    # R4 (round 2): filter on is_current=true atomically so a sibling Case 3
    # fork between L1199 and this UPDATE can't flip the row to frozen and let
    # us write the cleaned canvas into a historical snapshot. Zero rows
    # matched ⇒ the target was forked mid-flight — raise VERSION_FROZEN so the
    # client re-reads the current version and retries cleanup against it.
    #
    # Round-2 follow-on #4: also wrap in try/except so the frozen-mutation
    # trigger's 55006 (raised if the write slips past the app-level filter
    # in a rare race) surfaces as VERSION_FROZEN too, not an opaque 500.
    #
    # Post-review round 4: when the caller supplied If-Match, also filter
    # on updated_at so a concurrent save racing with us can't sneak past
    # the compare above. trg_floor_plans_updated_at bumps updated_at on
    # every UPDATE, so the loser's filter misses and we surface 412
    # VERSION_STALE (distinguished from VERSION_FROZEN by a post-UPDATE
    # re-read of is_current).
    try:
        query = (
            client.table("floor_plans")
            .update({"canvas_data": cleaned})
            .eq("id", str(floor_plan_id))
            .eq("company_id", str(company_id))
            .eq("is_current", True)
        )
        if if_match is not None and existing_updated_at is not None:
            query = query.eq("updated_at", existing_updated_at)
        cleaned_update = await query.execute()
    except APIError as e:
        if getattr(e, "code", None) == "55006":
            raise AppException(
                status_code=403,
                detail="Floor plan version is frozen — retry against the current version",
                error_code="VERSION_FROZEN",
            )
        logger.error(
            "Cleanup UPDATE failed: %s (code=%s)", e.message, getattr(e, "code", None),
        )
        raise AppException(
            status_code=500,
            detail=f"Cleanup write failed: {e.message}",
            error_code="DB_ERROR",
        )
    if not cleaned_update.data:
        # Zero rows matched — either the row was frozen (is_current flipped
        # by a Case-3 fork) or a concurrent save bumped updated_at past
        # our if_match filter. Re-read to tell them apart so the client
        # gets the right retry signal. Same pattern as update_floor_plan.
        post = await (
            client.table("floor_plans")
            .select("is_current, updated_at")
            .eq("id", str(floor_plan_id))
            .eq("company_id", str(company_id))
            .single()
            .execute()
        )
        if post.data and post.data.get("is_current") and if_match is not None:
            current_etag = etag_from_updated_at(post.data.get("updated_at"))
            raise AppException(
                status_code=412,
                detail=(
                    "Floor plan was updated by another editor. Reload and "
                    "re-run cleanup on the fresh canvas."
                ),
                error_code="VERSION_STALE",
                extra={"current_etag": current_etag, "received_etag": if_match},
            )
        raise AppException(
            status_code=403,
            detail=(
                "Floor plan was forked by another edit during cleanup — "
                "retry against the current version"
            ),
            error_code="VERSION_FROZEN",
        )

    # Log event
    await log_event(
        company_id,
        "sketch_cleanup",
        job_id=job_id,
        user_id=user_id,
        event_data={
            "floor_plan_id": str(floor_plan_id),
            "changes_count": len(changes_made),
            "rooms_detected": len(cleaned_rooms),
        },
    )

    return {
        "canvas_data": cleaned,
        "changes_made": changes_made,
        "event_id": uuid4(),
    }
