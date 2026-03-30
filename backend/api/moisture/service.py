"""Moisture readings, points, and dehu outputs CRUD.

Auto-calculates GPP from temp+rh using psychrometric formula.
Auto-calculates day_number from job.loss_date.
"""

from datetime import date
from decimal import Decimal
from math import exp
from uuid import UUID

from supabase import AsyncClient

from api.moisture.schemas import (
    DehuOutputCreate,
    DehuOutputUpdate,
    MoisturePointCreate,
    MoisturePointUpdate,
    MoistureReadingCreate,
    MoistureReadingUpdate,
)
from api.shared.events import log_event
from api.shared.exceptions import AppException


def calculate_gpp(temp_f: Decimal | None, rh_pct: Decimal | None) -> Decimal | None:
    """Calculate Grains Per Pound from temperature (F) and relative humidity (%).

    Uses psychrometric formula:
    gpp = 621.97 * (sat_pressure * rh/100) / (1013.25 - sat_pressure * rh/100) * 7.0
    where sat_pressure = 6.112 * exp(17.67 * tc / (tc + 243.5))
    """
    if temp_f is None or rh_pct is None:
        return None

    tc = (float(temp_f) - 32) * 5 / 9  # Convert F to C
    rh = float(rh_pct)

    sat_pressure = 6.112 * exp(17.67 * tc / (tc + 243.5))
    partial_pressure = sat_pressure * rh / 100
    denominator = 1013.25 - partial_pressure

    if denominator <= 0:
        return None

    gpp = 621.97 * partial_pressure / denominator * 7.0
    return Decimal(str(round(gpp, 1)))


def calculate_day_number(reading_date: date, loss_date: date | None) -> int | None:
    """Calculate the day number from the job's loss date."""
    if loss_date is None:
        return None
    delta = reading_date - loss_date
    return delta.days + 1  # Day 1 = loss date


# --- Readings ---


async def create_reading(
    client: AsyncClient,
    job_id: UUID,
    room_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: MoistureReadingCreate,
    job_data: dict,
) -> dict:
    """Create a moisture reading for a room. Checks uniqueness on (room_id, reading_date)."""
    # Check for duplicate reading on same date + room
    existing = await (
        client.table("moisture_readings")
        .select("id")
        .eq("room_id", str(room_id))
        .eq("reading_date", body.reading_date.isoformat())
        .execute()
    )
    if existing.data:
        raise AppException(
            status_code=409,
            detail="A reading already exists for this room on this date",
            error_code="READING_EXISTS",
        )

    gpp = calculate_gpp(body.atmospheric_temp_f, body.atmospheric_rh_pct)

    loss_date_str = job_data.get("loss_date")
    loss_date = date.fromisoformat(loss_date_str) if loss_date_str else None
    day_number = calculate_day_number(body.reading_date, loss_date)

    row = {
        "job_id": str(job_id),
        "room_id": str(room_id),
        "company_id": str(company_id),
        "reading_date": body.reading_date.isoformat(),
        "day_number": day_number,
        "atmospheric_temp_f": (
            float(body.atmospheric_temp_f) if body.atmospheric_temp_f is not None else None
        ),
        "atmospheric_rh_pct": (
            float(body.atmospheric_rh_pct) if body.atmospheric_rh_pct is not None else None
        ),
        "atmospheric_gpp": float(gpp) if gpp is not None else None,
    }

    result = await client.table("moisture_readings").insert(row).execute()
    reading = result.data[0]

    # Attach empty nested arrays
    reading["points"] = []
    reading["dehus"] = []

    await log_event(
        company_id,
        "moisture_reading_created",
        job_id=job_id,
        user_id=user_id,
        event_data={"reading_id": reading["id"], "reading_date": body.reading_date.isoformat()},
    )

    return reading


async def list_room_readings(
    client: AsyncClient,
    job_id: UUID,
    room_id: UUID,
) -> dict:
    """List all readings for a specific room, ordered by reading_date ASC.

    Returns {"items": [...], "total": N}.
    """
    result = await (
        client.table("moisture_readings")
        .select("*", count="exact")
        .eq("job_id", str(job_id))
        .eq("room_id", str(room_id))
        .order("reading_date")
        .execute()
    )
    readings = result.data or []
    total = result.count if isinstance(result.count, int) else len(readings)
    items = await _attach_nested(client, readings)
    return {"items": items, "total": total}


async def list_job_readings(
    client: AsyncClient,
    job_id: UUID,
) -> dict:
    """List ALL readings across all rooms for a job. Ordered by reading_date ASC, room_id.

    Returns {"items": [...], "total": N}.
    """
    result = await (
        client.table("moisture_readings")
        .select("*", count="exact")
        .eq("job_id", str(job_id))
        .order("reading_date")
        .order("room_id")
        .execute()
    )
    readings = result.data or []
    total = result.count if isinstance(result.count, int) else len(readings)
    items = await _attach_nested(client, readings)
    return {"items": items, "total": total}


async def update_reading(
    client: AsyncClient,
    reading_id: UUID,
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
    body: MoistureReadingUpdate,
    reading_data: dict,
    job_data: dict,
) -> dict:
    """Update a moisture reading. Recalculates GPP and day_number if inputs change."""
    updates: dict = {}
    data = body.model_dump(exclude_unset=True)

    if not data:
        raise AppException(status_code=400, detail="No fields to update", error_code="EMPTY_UPDATE")

    # Merge with existing values for recalculation
    temp_f = data.get("atmospheric_temp_f", reading_data.get("atmospheric_temp_f"))
    rh_pct = data.get("atmospheric_rh_pct", reading_data.get("atmospheric_rh_pct"))

    if temp_f is not None:
        temp_f = Decimal(str(temp_f))
    if rh_pct is not None:
        rh_pct = Decimal(str(rh_pct))

    if "atmospheric_temp_f" in data or "atmospheric_rh_pct" in data:
        gpp = calculate_gpp(temp_f, rh_pct)
        updates["atmospheric_gpp"] = float(gpp) if gpp is not None else None

    if "atmospheric_temp_f" in data:
        val = data["atmospheric_temp_f"]
        updates["atmospheric_temp_f"] = float(val) if val is not None else None

    if "atmospheric_rh_pct" in data:
        val = data["atmospheric_rh_pct"]
        updates["atmospheric_rh_pct"] = float(val) if val is not None else None

    if "reading_date" in data:
        updates["reading_date"] = data["reading_date"].isoformat()
        loss_date_str = job_data.get("loss_date")
        loss_date = date.fromisoformat(loss_date_str) if loss_date_str else None
        updates["day_number"] = calculate_day_number(data["reading_date"], loss_date)

        # Check uniqueness for new date
        room_id = reading_data.get("room_id")
        existing = await (
            client.table("moisture_readings")
            .select("id")
            .eq("room_id", str(room_id))
            .eq("reading_date", data["reading_date"].isoformat())
            .neq("id", str(reading_id))
            .execute()
        )
        if existing.data:
            raise AppException(
                status_code=409,
                detail="A reading already exists for this room on this date",
                error_code="READING_EXISTS",
            )

    result = await (
        client.table("moisture_readings").update(updates).eq("id", str(reading_id)).execute()
    )
    reading = result.data[0]
    readings_with_nested = await _attach_nested(client, [reading])

    await log_event(
        company_id,
        "moisture_reading_updated",
        job_id=job_id,
        user_id=user_id,
        event_data={"reading_id": str(reading_id), "fields": list(data.keys())},
    )

    return readings_with_nested[0]


async def delete_reading(
    client: AsyncClient,
    reading_id: UUID,
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
) -> None:
    """Hard-delete a moisture reading and its child points/dehus."""
    # Delete children first
    await client.table("moisture_points").delete().eq("reading_id", str(reading_id)).execute()
    await client.table("dehu_outputs").delete().eq("reading_id", str(reading_id)).execute()
    await client.table("moisture_readings").delete().eq("id", str(reading_id)).execute()

    await log_event(
        company_id,
        "moisture_reading_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"reading_id": str(reading_id)},
    )


# --- Points ---


async def create_point(
    client: AsyncClient,
    reading_id: UUID,
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
    body: MoisturePointCreate,
) -> dict:
    """Add a moisture point to a reading."""
    row = {
        "reading_id": str(reading_id),
        "location_name": body.location_name,
        "reading_value": float(body.reading_value),
        "meter_photo_url": body.meter_photo_url,
        "sort_order": body.sort_order,
    }
    result = await client.table("moisture_points").insert(row).execute()
    point = result.data[0]

    await log_event(
        company_id,
        "moisture_point_created",
        job_id=job_id,
        user_id=user_id,
        event_data={"point_id": point["id"], "reading_id": str(reading_id)},
    )

    return point


async def update_point(
    client: AsyncClient,
    point_id: UUID,
    reading_id: UUID,
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
    body: MoisturePointUpdate,
) -> dict:
    """Update a moisture point."""
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise AppException(status_code=400, detail="No fields to update", error_code="EMPTY_UPDATE")

    # Convert Decimal to float for storage
    if "reading_value" in data and data["reading_value"] is not None:
        data["reading_value"] = float(data["reading_value"])

    result = await (
        client.table("moisture_points")
        .update(data)
        .eq("id", str(point_id))
        .eq("reading_id", str(reading_id))
        .execute()
    )
    if not result.data:
        raise AppException(status_code=404, detail="Point not found", error_code="POINT_NOT_FOUND")

    await log_event(
        company_id,
        "moisture_point_updated",
        job_id=job_id,
        user_id=user_id,
        event_data={"point_id": str(point_id), "reading_id": str(reading_id)},
    )

    return result.data[0]


async def delete_point(
    client: AsyncClient,
    point_id: UUID,
    reading_id: UUID,
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
) -> None:
    """Hard-delete a moisture point."""
    await (
        client.table("moisture_points")
        .delete()
        .eq("id", str(point_id))
        .eq("reading_id", str(reading_id))
        .execute()
    )

    await log_event(
        company_id,
        "moisture_point_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"point_id": str(point_id), "reading_id": str(reading_id)},
    )


# --- Dehus ---


async def create_dehu(
    client: AsyncClient,
    reading_id: UUID,
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
    body: DehuOutputCreate,
) -> dict:
    """Add a dehu output to a reading."""
    row = {
        "reading_id": str(reading_id),
        "dehu_model": body.dehu_model,
        "rh_out_pct": float(body.rh_out_pct) if body.rh_out_pct is not None else None,
        "temp_out_f": float(body.temp_out_f) if body.temp_out_f is not None else None,
        "sort_order": body.sort_order,
    }
    result = await client.table("dehu_outputs").insert(row).execute()
    dehu = result.data[0]

    await log_event(
        company_id,
        "dehu_output_created",
        job_id=job_id,
        user_id=user_id,
        event_data={"dehu_id": dehu["id"], "reading_id": str(reading_id)},
    )

    return dehu


async def update_dehu(
    client: AsyncClient,
    dehu_id: UUID,
    reading_id: UUID,
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
    body: DehuOutputUpdate,
) -> dict:
    """Update a dehu output."""
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise AppException(status_code=400, detail="No fields to update", error_code="EMPTY_UPDATE")

    # Convert Decimals to floats for storage
    for field in ("rh_out_pct", "temp_out_f"):
        if field in data and data[field] is not None:
            data[field] = float(data[field])

    result = await (
        client.table("dehu_outputs")
        .update(data)
        .eq("id", str(dehu_id))
        .eq("reading_id", str(reading_id))
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Dehu output not found",
            error_code="DEHU_NOT_FOUND",
        )

    await log_event(
        company_id,
        "dehu_output_updated",
        job_id=job_id,
        user_id=user_id,
        event_data={"dehu_id": str(dehu_id), "reading_id": str(reading_id)},
    )

    return result.data[0]


async def delete_dehu(
    client: AsyncClient,
    dehu_id: UUID,
    reading_id: UUID,
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
) -> None:
    """Hard-delete a dehu output."""
    await (
        client.table("dehu_outputs")
        .delete()
        .eq("id", str(dehu_id))
        .eq("reading_id", str(reading_id))
        .execute()
    )

    await log_event(
        company_id,
        "dehu_output_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"dehu_id": str(dehu_id), "reading_id": str(reading_id)},
    )


# --- Helpers ---


async def _attach_nested(client: AsyncClient, readings: list[dict]) -> list[dict]:
    """Attach points[] and dehus[] to each reading."""
    if not readings:
        return readings

    reading_ids = [r["id"] for r in readings]

    # Fetch all points for these readings
    points_result = await (
        client.table("moisture_points")
        .select("*")
        .in_("reading_id", reading_ids)
        .order("sort_order")
        .execute()
    )
    points_by_reading: dict[str, list] = {}
    for p in points_result.data or []:
        points_by_reading.setdefault(p["reading_id"], []).append(p)

    # Fetch all dehus for these readings
    dehus_result = await (
        client.table("dehu_outputs")
        .select("*")
        .in_("reading_id", reading_ids)
        .order("sort_order")
        .execute()
    )
    dehus_by_reading: dict[str, list] = {}
    for d in dehus_result.data or []:
        dehus_by_reading.setdefault(d["reading_id"], []).append(d)

    for reading in readings:
        reading["points"] = points_by_reading.get(reading["id"], [])
        reading["dehus"] = dehus_by_reading.get(reading["id"], [])

    return readings
