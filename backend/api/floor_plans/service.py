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
from api.shared.guards import ensure_job_mutable

logger = logging.getLogger(__name__)

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
) -> dict:
    """Update a floor plan. Validates floor_number uniqueness if changed."""
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

    # Frozen-version guard: only is_current rows accept canvas_data / floor_number
    # changes. Non-current rows are immutable history. thumbnail_url and floor_name
    # remain editable on any row (thumbnail is a re-rendered derivative; floor_name
    # is a label, not content).
    if not existing.data.get("is_current") and (
        "canvas_data" in updates or "floor_number" in updates
    ):
        raise AppException(
            status_code=403,
            detail="Cannot modify canvas_data or floor_number on a frozen (non-current) version",
            error_code="VERSION_FROZEN",
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
        result = await (
            client.table("floor_plans")
            .update(updates)
            .eq("id", str(floor_plan_id))
            .eq("company_id", str(company_id))
            .execute()
        )
    except APIError as e:
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
    """Hard delete an ENTIRE floor (all version rows for that floor_number).

    Post-merge: the passed `floor_plan_id` is a single version row, but the
    caller's intent is to remove the whole floor from the property. We resolve
    the floor_number from that row, then delete every version for it.
    Linked job_rooms get `floor_plan_id=NULL`.
    """
    client = await get_authenticated_client(token)

    existing = await (
        client.table("floor_plans")
        .select("id, floor_number")
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

    # Collect ids of all versions for this floor to unlink job_rooms + delete.
    versions_result = await (
        client.table("floor_plans")
        .select("id")
        .eq("property_id", str(property_id))
        .eq("floor_number", floor_number)
        .execute()
    )
    version_ids = [v["id"] for v in (versions_result.data or [])]

    if version_ids:
        # Unlink rooms that reference any of those floor-plan rows
        await (
            client.table("job_rooms")
            .update({"floor_plan_id": None})
            .in_("floor_plan_id", version_ids)
            .execute()
        )
        # Hard delete all versions for this floor
        await (
            client.table("floor_plans")
            .delete()
            .in_("id", version_ids)
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
    """
    client = await get_authenticated_client(token)

    # Resolve (property_id, floor_number) for the passed floor_plan_id — these
    # are the "floor identity" fields we scope version history to post-merge.
    target_floor_result = await (
        client.table("floor_plans")
        .select("property_id, floor_number")
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

    # Fetch the job to get its current pinned version
    job_result = await (
        client.table("jobs")
        .select("id, floor_plan_id, status")
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
        update_result = await (
            client.table("floor_plans")
            .update(
                {
                    "canvas_data": canvas_data,
                    "change_summary": change_summary or pinned_version.get("change_summary"),
                }
            )
            .eq("id", pinned_version["id"])
            .eq("is_current", True)
            .execute()
        )
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
        # else: row was frozen mid-flight — fall through to Case 3 (fork)

    # Case 3: Another job's version (or a different floor), or Case 2's
    # target was frozen mid-flight — fork new version.
    # The RPC inside _create_version handles flip + insert + pin atomically (C4).
    # Sibling jobs are NOT auto-upgraded — per frozen-version semantics, every
    # job stays on the version it last saved.
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
) -> dict:
    """Rollback: create a new version from a past version's canvas_data.

    Does NOT delete versions — creates a new one with the rolled-back content.
    Floor identity (property_id, floor_number) is resolved from the passed row.
    Archived jobs cannot rollback — frozen-version semantics, mirrors save_canvas.
    """
    client = await get_authenticated_client(token)

    # Reject rollback from archived jobs — same rule as save_canvas. Without this,
    # an archived job could mint a new version + repin itself, breaking the
    # "frozen once archived" contract.
    job_result = await (
        client.table("jobs")
        .select("status")
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
    target_property_id = anchor.data["property_id"]
    target_floor_number = anchor.data["floor_number"]

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

    # Create new version from the target's canvas_data. _create_version
    # handles the is_current flip on old siblings.
    version = await _create_version(
        client=client,
        property_id=UUID(target_property_id),
        floor_number=target_floor_number,
        floor_name=None,
        company_id=company_id,
        job_id=job_id,
        user_id=user_id,
        canvas_data=target.data["canvas_data"],
        change_summary=f"Rolled back to version {version_number}",
    )
    # RPC inside _create_version pinned this job to the new version atomically (C4).

    await log_event(
        company_id,
        "floor_plan_version_rollback",
        job_id=job_id,
        user_id=user_id,
        event_data={
            "floor_plan_id": version["id"],
            "rolled_back_to": version_number,
            "new_version": version["version_number"],
        },
    )
    return version


# ---------------------------------------------------------------------------
# Versioning helpers (private)
# ---------------------------------------------------------------------------


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
    """
    try:
        result = await client.rpc(
            "save_floor_plan_version",
            {
                "p_property_id":   str(property_id),
                "p_floor_number":  floor_number,
                "p_floor_name":    floor_name,
                "p_company_id":    str(company_id),
                "p_job_id":        str(job_id),
                "p_user_id":       str(user_id),
                "p_canvas_data":   canvas_data,
                "p_change_summary": change_summary,
            },
        ).execute()
    except APIError as e:
        if getattr(e, "code", None) == "23505":
            raise AppException(
                status_code=409,
                detail="Concurrent edit on this floor, please retry",
                error_code="CONCURRENT_EDIT",
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
) -> dict:
    """Run deterministic cleanup on a floor plan sketch.

    If client_canvas_data is provided, cleans the client's unsaved sketch.
    If None, fetches the saved canvas_data from the floor plan record.
    Either way, the cleaned result is saved back to the DB.

    Returns SketchCleanupResponse with cleaned canvas_data, changes_made, event_id.
    """
    client = await get_authenticated_client(token)

    # Archive-job gate (C1) — always runs. Cleanup mutates canvas_data on
    # the is_current row, so a `collected` job's version must stay frozen.
    # job_id is required in SketchCleanupRequest; Pydantic 422's any caller
    # that omits it, so this guard has no conditional bypass.
    await ensure_job_mutable(client, job_id, company_id)

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

    # Save cleaned canvas_data back to DB
    await (
        client.table("floor_plans")
        .update({"canvas_data": cleaned})
        .eq("id", str(floor_plan_id))
        .eq("company_id", str(company_id))
        .execute()
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
