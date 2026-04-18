"""Rooms service — CRUD operations against Supabase.

Uses authenticated client (RLS-enforced) for all operations.
Hard deletes (no deleted_at column on job_rooms).
On delete, photos get room_id=NULL (CASCADE handles moisture readings + wall_segments).
"""

import math
from decimal import Decimal
from uuid import UUID

from postgrest.exceptions import APIError

from api.rooms.schemas import RoomCreate, RoomUpdate
from api.shared.constants import CEILING_MULTIPLIERS, ROOM_TYPE_MATERIAL_DEFAULTS
from api.shared.database import get_authenticated_client
from api.shared.events import log_event
from api.shared.exceptions import AppException

VALID_WATER_CATEGORIES = {"1", "2", "3"}
VALID_WATER_CLASSES = {"1", "2", "3", "4"}


def _validate_water_fields(
    water_category: str | None,
    water_class: str | None,
) -> None:
    """Validate water category and class values."""
    if water_category is not None and water_category not in VALID_WATER_CATEGORIES:
        raise AppException(
            status_code=400,
            detail="water_category must be 1, 2, or 3",
            error_code="INVALID_WATER_CATEGORY",
        )
    if water_class is not None and water_class not in VALID_WATER_CLASSES:
        raise AppException(
            status_code=400,
            detail="water_class must be 1, 2, 3, or 4",
            error_code="INVALID_WATER_CLASS",
        )


def _calc_square_footage(
    length_ft: Decimal | None,
    width_ft: Decimal | None,
) -> Decimal | None:
    """Auto-calculate square footage from length and width."""
    if length_ft is not None and width_ft is not None:
        return length_ft * width_ft
    return None


def _serialize_decimals(data: dict) -> dict:
    """Convert Decimal values to float for JSON serialization to Supabase."""
    out = {}
    for k, v in data.items():
        if isinstance(v, Decimal):
            out[k] = float(v)
        else:
            out[k] = v
    return out


def _get_material_defaults(room_type: str | None) -> list[str]:
    """Return default material flags for a room type, or empty list."""
    if room_type and room_type in ROOM_TYPE_MATERIAL_DEFAULTS:
        return list(ROOM_TYPE_MATERIAL_DEFAULTS[room_type])
    return []


def calculate_floor_sf(
    room_polygon: list[dict] | None,
    floor_openings: list[dict] | None,
    grid_size: int = 10,
) -> float | None:
    """Calculate floor SF from polygon vertices using the shoelace formula.

    grid_size: pixels per 6 inches (10px = 6in, so 20px = 1ft).
    Returns None if no polygon is provided.
    """
    if not room_polygon or len(room_polygon) < 3:
        return None

    # Shoelace formula for polygon area in pixel² units
    points = room_polygon
    n = len(points)
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += points[i].get("x", 0) * points[j].get("y", 0)
        area -= points[j].get("x", 0) * points[i].get("y", 0)
    gross_area_px = abs(area) / 2.0

    # Convert px² to ft² (20px = 1ft, so 1ft² = 400px²)
    px_per_ft = grid_size * 2  # 10px = 6in, 20px = 1ft
    gross_sf = gross_area_px / (px_per_ft * px_per_ft)

    # Subtract floor openings (stairwells, HVAC chases)
    opening_sf = 0.0
    if floor_openings:
        for o in floor_openings:
            w = o.get("width", 0)
            h = o.get("height", 0)
            opening_sf += (w / px_per_ft) * (h / px_per_ft)

    return round(gross_sf - opening_sf, 1)


def calculate_wall_sf(
    walls: list[dict],
    height_ft: float,
    ceiling_type: str,
    openings: list[dict],
    custom_wall_sf: float | None = None,
    grid_size: int = 10,
) -> float:
    """Calculate wall SF from wall segments.

    If custom_wall_sf is set, returns it directly (tech override).
    Otherwise: perimeter LF (excl. shared walls) × height × multiplier - openings.
    """
    if custom_wall_sf is not None:
        return float(custom_wall_sf)

    px_per_ft = grid_size * 2  # 10px = 6in, 20px = 1ft

    # Perimeter LF from non-shared walls
    perimeter_lf = 0.0
    wall_ids = set()
    for w in walls:
        if w.get("shared"):
            continue
        dx = float(w.get("x2", 0)) - float(w.get("x1", 0))
        dy = float(w.get("y2", 0)) - float(w.get("y1", 0))
        length_px = math.hypot(dx, dy)
        perimeter_lf += length_px / px_per_ft
        wall_ids.add(w.get("id"))

    # Gross wall area
    gross_sf = perimeter_lf * height_ft

    # Opening deductions (only for non-shared walls)
    opening_sf = 0.0
    for o in openings:
        if o.get("wall_id") in wall_ids:
            opening_sf += float(o.get("width_ft", 0)) * float(o.get("height_ft", 0))

    net_sf = gross_sf - opening_sf
    multiplier = CEILING_MULTIPLIERS.get(ceiling_type, 1.0)
    return round(net_sf * multiplier, 1)


async def create_room(
    token: str,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: RoomCreate,
) -> dict:
    """Create a room for a job."""
    _validate_water_fields(body.water_category, body.water_class)

    client = await get_authenticated_client(token)

    # If floor_plan_id is provided, verify it exists and belongs to this company
    if body.floor_plan_id:
        fp_check = await (
            client.table("floor_plans")
            .select("id")
            .eq("id", str(body.floor_plan_id))
            .eq("company_id", str(company_id))
            .execute()
        )
        if not fp_check.data:
            raise AppException(
                status_code=404,
                detail="Floor plan not found",
                error_code="FLOOR_PLAN_NOT_FOUND",
            )

    square_footage = _calc_square_footage(body.length_ft, body.width_ft)

    # Auto-populate material defaults from room type if not provided
    material_flags = body.material_flags
    if not material_flags and body.room_type:
        material_flags = _get_material_defaults(body.room_type)

    row = _serialize_decimals(
        {
            "job_id": str(job_id),
            "company_id": str(company_id),
            "room_name": body.room_name,
            "floor_plan_id": str(body.floor_plan_id) if body.floor_plan_id else None,
            "length_ft": body.length_ft,
            "width_ft": body.width_ft,
            "height_ft": body.height_ft,
            "square_footage": square_footage,
            # V2 fields (Spec 01H)
            "room_type": body.room_type,
            "ceiling_type": body.ceiling_type,
            "floor_level": body.floor_level,
            "affected": body.affected,
            "material_flags": material_flags,
            "room_polygon": body.room_polygon,
            "floor_openings": body.floor_openings,
            "custom_wall_sf": body.custom_wall_sf,
            # Existing fields
            "water_category": body.water_category,
            "water_class": body.water_class,
            "dry_standard": body.dry_standard,
            "equipment_air_movers": body.equipment_air_movers,
            "equipment_dehus": body.equipment_dehus,
            "room_sketch_data": body.room_sketch_data,
            "notes": body.notes,
            "sort_order": body.sort_order,
        }
    )

    try:
        result = await client.table("job_rooms").insert(row).execute()
    except APIError as e:
        raise AppException(
            status_code=500,
            detail=f"Failed to create room: {e.message}",
            error_code="DB_ERROR",
        )

    room = result.data[0]
    # Add computed fields (no readings yet for a new room)
    room["reading_count"] = 0
    room["latest_reading_date"] = None

    await log_event(
        company_id,
        "room_created",
        job_id=job_id,
        user_id=user_id,
        event_data={"room_id": room["id"], "room_name": body.room_name},
    )

    return room


async def list_rooms(
    token: str,
    job_id: UUID,
    company_id: UUID,
) -> dict:
    """List all rooms for a job, ordered by sort_order then room_name.

    Returns {"items": [...], "total": N}.
    """
    client = await get_authenticated_client(token)

    result = await (
        client.table("job_rooms")
        .select("*", count="exact")
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .order("sort_order")
        .order("room_name")
        .execute()
    )

    rooms = result.data or []
    total = result.count if isinstance(result.count, int) else len(rooms)

    # Fetch reading counts and latest dates for all rooms in one query
    if rooms:
        room_ids = [r["id"] for r in rooms]
        readings = await (
            client.table("moisture_readings")
            .select("room_id, reading_date")
            .in_("room_id", room_ids)
            .execute()
        )

        # Aggregate per room
        counts: dict[str, int] = {}
        latest: dict[str, str] = {}
        for rd in readings.data:
            rid = rd["room_id"]
            counts[rid] = counts.get(rid, 0) + 1
            rd_date = rd.get("reading_date")
            if rd_date and (rid not in latest or rd_date > latest[rid]):
                latest[rid] = rd_date

        for room in rooms:
            room["reading_count"] = counts.get(room["id"], 0)
            room["latest_reading_date"] = latest.get(room["id"])

    return {"items": rooms, "total": total}


async def update_room(
    token: str,
    room_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: RoomUpdate,
) -> dict:
    """Update a room. Re-calculates square_footage if dimensions change."""
    client = await get_authenticated_client(token)

    # Get existing room
    existing = await (
        client.table("job_rooms")
        .select("*")
        .eq("id", str(room_id))
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not existing.data:
        raise AppException(
            status_code=404,
            detail="Room not found",
            error_code="ROOM_NOT_FOUND",
        )

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        room = existing.data
        room["reading_count"] = 0
        room["latest_reading_date"] = None
        return room

    # Validate water fields if being updated
    _validate_water_fields(
        updates.get("water_category", existing.data.get("water_category")),
        updates.get("water_class", existing.data.get("water_class")),
    )

    # If floor_plan_id is being set, verify it exists
    if "floor_plan_id" in updates and updates["floor_plan_id"] is not None:
        fp_check = await (
            client.table("floor_plans")
            .select("id")
            .eq("id", str(updates["floor_plan_id"]))
            .eq("company_id", str(company_id))
            .execute()
        )
        if not fp_check.data:
            raise AppException(
                status_code=404,
                detail="Floor plan not found",
                error_code="FLOOR_PLAN_NOT_FOUND",
            )
        updates["floor_plan_id"] = str(updates["floor_plan_id"])

    # If room_type changed to a non-null value and material_flags not explicitly
    # provided, auto-populate defaults. When room_type is cleared (set to null)
    # we DON'T wipe materials — the user may want to keep their custom flags
    # even after removing the type label.
    if (
        "room_type" in updates
        and updates["room_type"]
        and "material_flags" not in updates
    ):
        updates["material_flags"] = _get_material_defaults(updates["room_type"])

    # Re-calculate square_footage if length or width changed
    length = updates.get("length_ft", existing.data.get("length_ft"))
    width = updates.get("width_ft", existing.data.get("width_ft"))
    if length is not None and width is not None:
        length_d = Decimal(str(length)) if not isinstance(length, Decimal) else length
        width_d = Decimal(str(width)) if not isinstance(width, Decimal) else width
        updates["square_footage"] = float(length_d * width_d)
    elif "length_ft" in updates or "width_ft" in updates:
        # One dimension set to None — clear square_footage
        if length is None or width is None:
            updates["square_footage"] = None

    serialized = _serialize_decimals(updates)

    try:
        result = await (
            client.table("job_rooms")
            .update(serialized)
            .eq("id", str(room_id))
            .eq("company_id", str(company_id))
            .execute()
        )
    except APIError as e:
        raise AppException(
            status_code=500,
            detail=f"Failed to update room: {e.message}",
            error_code="DB_ERROR",
        )

    room = result.data[0]

    # Fetch reading stats for this room
    readings = await (
        client.table("moisture_readings")
        .select("reading_date")
        .eq("room_id", str(room_id))
        .execute()
    )
    room["reading_count"] = len(readings.data)
    room["latest_reading_date"] = (
        max(r["reading_date"] for r in readings.data) if readings.data else None
    )

    await log_event(
        company_id,
        "room_updated",
        job_id=job_id,
        user_id=user_id,
        event_data={"room_id": str(room_id), "updates": list(updates.keys())},
    )

    return room


async def delete_room(
    token: str,
    room_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
) -> None:
    """Hard delete a room. Photos get room_id=NULL, CASCADE handles moisture readings."""
    client = await get_authenticated_client(token)

    # Verify room exists
    existing = await (
        client.table("job_rooms")
        .select("id, room_name")
        .eq("id", str(room_id))
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not existing.data:
        raise AppException(
            status_code=404,
            detail="Room not found",
            error_code="ROOM_NOT_FOUND",
        )

    room_name = existing.data.get("room_name", "")

    # Unlink photos that reference this room
    await client.table("photos").update({"room_id": None}).eq("room_id", str(room_id)).execute()

    # Hard delete the room (CASCADE will handle moisture_readings)
    await client.table("job_rooms").delete().eq("id", str(room_id)).execute()

    await log_event(
        company_id,
        "room_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"room_id": str(room_id), "room_name": room_name},
    )
