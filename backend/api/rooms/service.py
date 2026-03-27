"""Rooms service — CRUD operations against Supabase.

Uses authenticated client (RLS-enforced) for all operations.
Hard deletes (no deleted_at column on job_rooms).
On delete, photos get room_id=NULL (CASCADE handles moisture readings).
"""

from decimal import Decimal
from uuid import UUID

from postgrest.exceptions import APIError

from api.rooms.schemas import RoomCreate, RoomUpdate
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


async def create_room(
    token: str,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: RoomCreate,
) -> dict:
    """Create a room for a job."""
    _validate_water_fields(body.water_category, body.water_class)

    client = get_authenticated_client(token)

    # If floor_plan_id is provided, verify it exists and belongs to this job
    if body.floor_plan_id:
        fp_check = (
            client.table("floor_plans")
            .select("id")
            .eq("id", str(body.floor_plan_id))
            .eq("job_id", str(job_id))
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
        result = client.table("job_rooms").insert(row).execute()
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
) -> list[dict]:
    """List all rooms for a job, ordered by sort_order then room_name."""
    client = get_authenticated_client(token)

    result = (
        client.table("job_rooms")
        .select("*")
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .order("sort_order")
        .order("room_name")
        .execute()
    )

    rooms = result.data

    # Fetch reading counts and latest dates for all rooms in one query
    if rooms:
        room_ids = [r["id"] for r in rooms]
        readings = (
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

    return rooms


async def update_room(
    token: str,
    room_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: RoomUpdate,
) -> dict:
    """Update a room. Re-calculates square_footage if dimensions change."""
    client = get_authenticated_client(token)

    # Get existing room
    existing = (
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
        fp_check = (
            client.table("floor_plans")
            .select("id")
            .eq("id", str(updates["floor_plan_id"]))
            .eq("job_id", str(job_id))
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
        result = (
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
    readings = (
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
    client = get_authenticated_client(token)

    # Verify room exists
    existing = (
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
    client.table("photos").update({"room_id": None}).eq("room_id", str(room_id)).execute()

    # Hard delete the room (CASCADE will handle moisture_readings)
    client.table("job_rooms").delete().eq("id", str(room_id)).execute()

    await log_event(
        company_id,
        "room_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"room_id": str(room_id), "room_name": room_name},
    )
