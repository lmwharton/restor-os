"""Floor Plans service — CRUD operations against Supabase.

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
from api.shared.database import get_authenticated_client
from api.shared.events import log_event
from api.shared.exceptions import AppException

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


async def create_floor_plan(
    token: str,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: FloorPlanCreate,
) -> dict:
    """Create a floor plan. Enforces unique (job_id, floor_number)."""
    client = await get_authenticated_client(token)

    # Check uniqueness of (job_id, floor_number)
    existing = await (
        client.table("floor_plans")
        .select("id")
        .eq("job_id", str(job_id))
        .eq("floor_number", body.floor_number)
        .execute()
    )
    if existing.data:
        raise AppException(
            status_code=409,
            detail=f"Floor plan for floor {body.floor_number} already exists on this job",
            error_code="FLOOR_PLAN_EXISTS",
        )

    row = {
        "job_id": str(job_id),
        "company_id": str(company_id),
        "floor_number": body.floor_number,
        "floor_name": body.floor_name,
        "canvas_data": body.canvas_data,
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
        job_id=job_id,
        user_id=user_id,
        event_data={"floor_plan_id": floor_plan["id"], "floor_number": body.floor_number},
    )

    return floor_plan


async def list_floor_plans(
    token: str,
    job_id: UUID,
    company_id: UUID,
) -> dict:
    """List all floor plans for a job, ordered by floor_number.

    Returns {"items": [...], "total": N}.
    """
    client = await get_authenticated_client(token)

    result = await (
        client.table("floor_plans")
        .select("*", count="exact")
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .order("floor_number")
        .execute()
    )

    items = result.data or []
    total = result.count if isinstance(result.count, int) else len(items)
    return {"items": items, "total": total}


async def update_floor_plan(
    token: str,
    floor_plan_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: FloorPlanUpdate,
) -> dict:
    """Update a floor plan. Validates floor_number uniqueness if changed."""
    client = await get_authenticated_client(token)

    # Get existing
    existing = await (
        client.table("floor_plans")
        .select("*")
        .eq("id", str(floor_plan_id))
        .eq("job_id", str(job_id))
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

    # If floor_number is being changed, check uniqueness
    if "floor_number" in updates and updates["floor_number"] != existing.data["floor_number"]:
        dup = await (
            client.table("floor_plans")
            .select("id")
            .eq("job_id", str(job_id))
            .eq("floor_number", updates["floor_number"])
            .neq("id", str(floor_plan_id))
            .execute()
        )
        if dup.data:
            raise AppException(
                status_code=409,
                detail=f"Floor plan for floor {updates['floor_number']} already exists on this job",
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
            e.message, e.code, e.details,
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
        job_id=job_id,
        user_id=user_id,
        event_data={"floor_plan_id": str(floor_plan_id), "updates": list(updates.keys())},
    )

    return floor_plan


async def delete_floor_plan(
    token: str,
    floor_plan_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
) -> None:
    """Hard delete a floor plan. Sets floor_plan_id=NULL on linked job_rooms."""
    client = await get_authenticated_client(token)

    # Verify it exists
    existing = await (
        client.table("floor_plans")
        .select("id")
        .eq("id", str(floor_plan_id))
        .eq("job_id", str(job_id))
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

    # Unlink rooms that reference this floor plan
    await client.table("job_rooms").update({"floor_plan_id": None}).eq(
        "floor_plan_id", str(floor_plan_id)
    ).execute()

    # Hard delete the floor plan
    await client.table("floor_plans").delete().eq("id", str(floor_plan_id)).execute()

    await log_event(
        company_id,
        "floor_plan_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"floor_plan_id": str(floor_plan_id)},
    )


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

    # Fetch floor plan (always needed to verify ownership + for saving back)
    result = await (
        client.table("floor_plans")
        .select("*")
        .eq("id", str(floor_plan_id))
        .eq("job_id", str(job_id))
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

    # Save cleaned canvas_data back to DB (with company_id for defense-in-depth)
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

    # Return response matching SketchCleanupResponse schema
    # TODO: return real event_id when log_ai_event() is implemented (Spec 02)
    return {
        "canvas_data": cleaned,
        "changes_made": changes_made,
        "event_id": uuid4(),  # placeholder until log_ai_event()
    }
