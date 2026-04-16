"""Walls service — CRUD for wall segments + wall openings.

Uses authenticated client (RLS-enforced). Hard deletes.
Every mutation triggers wall SF recalculation on the parent room.
"""

import logging
from decimal import Decimal
from uuid import UUID

from postgrest.exceptions import APIError

from api.rooms.service import calculate_wall_sf
from api.shared.database import get_authenticated_client
from api.shared.events import log_event
from api.shared.exceptions import AppException
from api.walls.schemas import (
    WallOpeningCreate,
    WallOpeningUpdate,
    WallSegmentCreate,
    WallSegmentUpdate,
)

logger = logging.getLogger(__name__)


def _serialize_decimals(data: dict) -> dict:
    """Convert Decimal values to float for JSON serialization to Supabase."""
    out = {}
    for k, v in data.items():
        if isinstance(v, Decimal):
            out[k] = float(v)
        else:
            out[k] = v
    return out


# ---------------------------------------------------------------------------
# Wall Segments CRUD
# ---------------------------------------------------------------------------


async def create_wall(
    token: str,
    room_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: WallSegmentCreate,
) -> dict:
    """Create a wall segment for a room."""
    client = await get_authenticated_client(token)

    row = _serialize_decimals(
        {
            "room_id": str(room_id),
            "company_id": str(company_id),
            "x1": body.x1,
            "y1": body.y1,
            "x2": body.x2,
            "y2": body.y2,
            "wall_type": body.wall_type,
            "wall_height_ft": body.wall_height_ft,
            "affected": body.affected,
            "shared": body.shared,
            "shared_with_room_id": (
                str(body.shared_with_room_id) if body.shared_with_room_id else None
            ),
            "sort_order": body.sort_order,
        }
    )

    try:
        result = await client.table("wall_segments").insert(row).execute()
    except APIError as e:
        raise AppException(
            status_code=500,
            detail=f"Failed to create wall: {e.message}",
            error_code="DB_ERROR",
        )

    wall = result.data[0]
    wall["openings"] = []  # new wall has no openings yet

    await _recalculate_room_wall_sf(client, room_id, company_id)

    await log_event(
        company_id,
        "wall_created",
        user_id=user_id,
        event_data={"wall_id": wall["id"], "room_id": str(room_id)},
    )

    return wall


async def list_walls(
    token: str,
    room_id: UUID,
    company_id: UUID,
) -> dict:
    """List all walls for a room with their openings nested.

    Returns {"items": [...], "total": N}.
    """
    client = await get_authenticated_client(token)

    # Fetch walls with embedded openings in one query
    result = await (
        client.table("wall_segments")
        .select("*, wall_openings(*)", count="exact")
        .eq("room_id", str(room_id))
        .eq("company_id", str(company_id))
        .order("sort_order")
        .execute()
    )

    items = result.data or []
    total = result.count if isinstance(result.count, int) else len(items)

    # Rename the embedded key from "wall_openings" to "openings"
    for wall in items:
        wall["openings"] = wall.pop("wall_openings", [])

    return {"items": items, "total": total}


async def update_wall(
    token: str,
    wall_id: UUID,
    room_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: WallSegmentUpdate,
) -> dict:
    """Update a wall segment."""
    client = await get_authenticated_client(token)

    # Verify wall exists
    existing = await (
        client.table("wall_segments")
        .select("*")
        .eq("id", str(wall_id))
        .eq("room_id", str(room_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not existing.data:
        raise AppException(
            status_code=404,
            detail="Wall not found",
            error_code="WALL_NOT_FOUND",
        )

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        existing.data["openings"] = []
        return existing.data

    # Serialize shared_with_room_id to string if present
    if "shared_with_room_id" in updates and updates["shared_with_room_id"] is not None:
        updates["shared_with_room_id"] = str(updates["shared_with_room_id"])

    serialized = _serialize_decimals(updates)

    try:
        result = await (
            client.table("wall_segments")
            .update(serialized)
            .eq("id", str(wall_id))
            .eq("company_id", str(company_id))
            .execute()
        )
    except APIError as e:
        raise AppException(
            status_code=500,
            detail=f"Failed to update wall: {e.message}",
            error_code="DB_ERROR",
        )

    wall = result.data[0]

    # Fetch openings for this wall
    openings_result = await (
        client.table("wall_openings").select("*").eq("wall_id", str(wall_id)).execute()
    )
    wall["openings"] = openings_result.data or []

    await _recalculate_room_wall_sf(client, room_id, company_id)

    await log_event(
        company_id,
        "wall_updated",
        user_id=user_id,
        event_data={
            "wall_id": str(wall_id),
            "room_id": str(room_id),
            "updates": list(updates.keys()),
        },
    )

    return wall


async def delete_wall(
    token: str,
    wall_id: UUID,
    room_id: UUID,
    company_id: UUID,
    user_id: UUID,
) -> None:
    """Delete a wall segment. CASCADE handles openings."""
    client = await get_authenticated_client(token)

    existing = await (
        client.table("wall_segments")
        .select("id")
        .eq("id", str(wall_id))
        .eq("room_id", str(room_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not existing.data:
        raise AppException(
            status_code=404,
            detail="Wall not found",
            error_code="WALL_NOT_FOUND",
        )

    await client.table("wall_segments").delete().eq("id", str(wall_id)).execute()

    await _recalculate_room_wall_sf(client, room_id, company_id)

    await log_event(
        company_id,
        "wall_deleted",
        user_id=user_id,
        event_data={"wall_id": str(wall_id), "room_id": str(room_id)},
    )


# ---------------------------------------------------------------------------
# Wall Openings CRUD
# ---------------------------------------------------------------------------


async def create_opening(
    token: str,
    wall_id: UUID,
    room_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: WallOpeningCreate,
) -> dict:
    """Create an opening (door/window/missing_wall) on a wall."""
    client = await get_authenticated_client(token)

    row = _serialize_decimals(
        {
            "wall_id": str(wall_id),
            "company_id": str(company_id),
            "opening_type": body.opening_type,
            "position": body.position,
            "width_ft": body.width_ft,
            "height_ft": body.height_ft,
            "sill_height_ft": body.sill_height_ft,
            "swing": body.swing,
        }
    )

    try:
        result = await client.table("wall_openings").insert(row).execute()
    except APIError as e:
        raise AppException(
            status_code=500,
            detail=f"Failed to create opening: {e.message}",
            error_code="DB_ERROR",
        )

    opening = result.data[0]

    await _recalculate_room_wall_sf(client, room_id, company_id)

    await log_event(
        company_id,
        "wall_opening_created",
        user_id=user_id,
        event_data={
            "opening_id": opening["id"],
            "wall_id": str(wall_id),
            "opening_type": body.opening_type,
        },
    )

    return opening


async def update_opening(
    token: str,
    opening_id: UUID,
    wall_id: UUID,
    room_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: WallOpeningUpdate,
) -> dict:
    """Update a wall opening."""
    client = await get_authenticated_client(token)

    existing = await (
        client.table("wall_openings")
        .select("*")
        .eq("id", str(opening_id))
        .eq("wall_id", str(wall_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not existing.data:
        raise AppException(
            status_code=404,
            detail="Opening not found",
            error_code="OPENING_NOT_FOUND",
        )

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return existing.data

    serialized = _serialize_decimals(updates)

    try:
        result = await (
            client.table("wall_openings")
            .update(serialized)
            .eq("id", str(opening_id))
            .eq("company_id", str(company_id))
            .execute()
        )
    except APIError as e:
        raise AppException(
            status_code=500,
            detail=f"Failed to update opening: {e.message}",
            error_code="DB_ERROR",
        )

    opening = result.data[0]

    await _recalculate_room_wall_sf(client, room_id, company_id)

    await log_event(
        company_id,
        "wall_opening_updated",
        user_id=user_id,
        event_data={
            "opening_id": str(opening_id),
            "wall_id": str(wall_id),
            "updates": list(updates.keys()),
        },
    )

    return opening


async def delete_opening(
    token: str,
    opening_id: UUID,
    wall_id: UUID,
    room_id: UUID,
    company_id: UUID,
    user_id: UUID,
) -> None:
    """Delete a wall opening."""
    client = await get_authenticated_client(token)

    existing = await (
        client.table("wall_openings")
        .select("id")
        .eq("id", str(opening_id))
        .eq("wall_id", str(wall_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not existing.data:
        raise AppException(
            status_code=404,
            detail="Opening not found",
            error_code="OPENING_NOT_FOUND",
        )

    await client.table("wall_openings").delete().eq("id", str(opening_id)).execute()

    await _recalculate_room_wall_sf(client, room_id, company_id)

    await log_event(
        company_id,
        "wall_opening_deleted",
        user_id=user_id,
        event_data={
            "opening_id": str(opening_id),
            "wall_id": str(wall_id),
            "room_id": str(room_id),
        },
    )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


async def _recalculate_room_wall_sf(
    client,
    room_id: UUID,
    company_id: UUID,
) -> None:
    """Recalculate and store wall_square_footage on the parent room.

    Called after every wall/opening mutation to keep the cached value in sync.
    """
    # Fetch room for height + ceiling type + custom override
    room_result = await (
        client.table("job_rooms")
        .select("id, height_ft, ceiling_type, custom_wall_sf")
        .eq("id", str(room_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not room_result.data:
        return

    room = room_result.data
    height_ft = float(room.get("height_ft") or 8.0)
    ceiling_type = room.get("ceiling_type") or "flat"
    custom_wall_sf = room.get("custom_wall_sf")
    if custom_wall_sf is not None:
        custom_wall_sf = float(custom_wall_sf)

    # Fetch all walls for this room
    walls_result = await (
        client.table("wall_segments")
        .select("*")
        .eq("room_id", str(room_id))
        .eq("company_id", str(company_id))
        .execute()
    )
    walls = walls_result.data or []

    # Fetch all openings for those walls
    openings = []
    if walls:
        wall_ids = [w["id"] for w in walls]
        openings_result = await (
            client.table("wall_openings").select("*").in_("wall_id", wall_ids).execute()
        )
        openings = openings_result.data or []

    # Calculate wall SF
    wall_sf = calculate_wall_sf(
        walls=walls,
        height_ft=height_ft,
        ceiling_type=ceiling_type,
        openings=openings,
        custom_wall_sf=custom_wall_sf,
    )

    # Update the room's stored wall_square_footage
    await (
        client.table("job_rooms")
        .update({"wall_square_footage": wall_sf})
        .eq("id", str(room_id))
        .eq("company_id", str(company_id))
        .execute()
    )
