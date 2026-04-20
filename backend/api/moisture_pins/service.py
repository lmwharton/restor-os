"""Moisture pins service — spatial, persistent drying tracker.

Key rules (from Spec 01H Phase 2):
- Pin color boundaries are 10 percentage points absolute, not relative.
  Drywall at 16% → amber at >16%, red at >26%. Not 17.6%.
- Pins must land inside a room polygon. Whitespace drops are rejected
  at the API layer (Q6 product decision).
- dry_standard is stored on the pin. DRY_STANDARDS provides the default
  at creation time; the tech can override per pin (and update later).
- One reading per pin per day, enforced by UNIQUE(pin_id, reading_date).
  POST raises 409 on conflict; the frontend detects + routes to PATCH.
"""

import logging
from decimal import Decimal
from uuid import UUID

from postgrest.exceptions import APIError

from api.moisture_pins.schemas import (
    MoisturePinCreate,
    MoisturePinReadingCreate,
    MoisturePinReadingUpdate,
    MoisturePinUpdate,
    PinColor,
)
from api.shared.database import get_authenticated_client
from api.shared.events import log_event
from api.shared.exceptions import AppException

logger = logging.getLogger(__name__)


# IICRC S500-derived default dry standards by material (percent moisture).
# Stored on the pin at creation; tech can override per pin.
DRY_STANDARDS: dict[str, Decimal] = {
    "drywall": Decimal("16.00"),
    "wood_subfloor": Decimal("15.00"),
    "carpet_pad": Decimal("16.00"),
    "concrete": Decimal("5.00"),
    "hardwood": Decimal("12.00"),
    "osb_plywood": Decimal("18.00"),
    "block_wall": Decimal("10.00"),
}

# 10 percentage points above standard is the amber/red cutoff per spec 8.4.
_RED_THRESHOLD_POINTS = Decimal("10")


# --- Pure functions (tested in isolation) -----------------------------------


def compute_pin_color(reading: Decimal, dry_standard: Decimal) -> PinColor:
    """Map a reading + dry standard to red/amber/green per spec 8.4.

    green: reading <= dry_standard
    amber: dry_standard < reading <= dry_standard + 10
    red:   reading > dry_standard + 10

    The "10" is percentage points absolute — NOT 10% of the standard.
    A drywall pin (dry_standard=16) turns red at 26.01%, not 17.6%.
    """
    if reading <= dry_standard:
        return "green"
    if reading <= dry_standard + _RED_THRESHOLD_POINTS:
        return "amber"
    return "red"


def compute_is_regressing(readings: list[dict]) -> bool:
    """True when the most recent reading is higher than the previous one.

    `readings` must be sorted DESCENDING by reading_date — index 0 is the
    latest, index 1 is the previous. With fewer than 2 readings, regression
    cannot be computed → False.
    """
    if len(readings) < 2:
        return False
    latest = Decimal(str(readings[0]["reading_value"]))
    previous = Decimal(str(readings[1]["reading_value"]))
    return latest > previous


def _point_in_polygon(point: tuple[float, float], polygon: list[dict]) -> bool:
    """Ray-casting point-in-polygon test. Mirrors the frontend helper in
    floor-plan-tools.ts:452 so placement validation agrees on both sides."""
    if len(polygon) < 3:
        return False
    x, y = point
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = float(polygon[i]["x"]), float(polygon[i]["y"])
        xj, yj = float(polygon[j]["x"]), float(polygon[j]["y"])
        intersect = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)
        if intersect:
            inside = not inside
        j = i
    return inside


def _decorate_pin(pin: dict, readings: list[dict]) -> dict:
    """Attach latest_reading, color, is_regressing, and reading_count to a
    pin dict. `readings` must be sorted DESCENDING by reading_date."""
    pin["reading_count"] = len(readings)
    if not readings:
        pin["latest_reading"] = None
        pin["color"] = None
        pin["is_regressing"] = False
        return pin
    latest = readings[0]
    pin["latest_reading"] = latest
    pin["color"] = compute_pin_color(
        Decimal(str(latest["reading_value"])),
        Decimal(str(pin["dry_standard"])),
    )
    pin["is_regressing"] = compute_is_regressing(readings)
    return pin


# --- Pin CRUD ---------------------------------------------------------------


async def create_pin(
    token: str,
    *,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: MoisturePinCreate,
) -> dict:
    """Create a pin + its initial reading. Validates that the canvas
    coordinate falls inside the specified room's polygon (Q6 rule).
    Returns the decorated pin response."""
    client = await get_authenticated_client(token)

    # Validate room belongs to this job. RLS scopes to company; we still
    # assert job_id to prevent cross-job pin placement.
    room_res = await (
        client.table("job_rooms")
        .select("id, room_polygon")
        .eq("id", str(body.room_id))
        .eq("job_id", str(job_id))
        .single()
        .execute()
    )
    if not room_res.data:
        raise AppException(
            status_code=404,
            detail="Room not found in this job",
            error_code="ROOM_NOT_FOUND",
        )

    # Point-in-polygon validation. If the room has no polygon stored
    # (legacy rect-only rooms), skip the check — there's nothing to test
    # against and a false rejection would be worse than a permissive pass.
    polygon = room_res.data.get("room_polygon") or []
    if len(polygon) >= 3 and not _point_in_polygon(
        (float(body.canvas_x), float(body.canvas_y)), polygon
    ):
        raise AppException(
            status_code=400,
            detail="Pin must be placed inside the selected room",
            error_code="PIN_OUTSIDE_ROOM",
        )

    # Resolve dry standard: explicit value wins, else material default.
    dry_standard = body.dry_standard
    if dry_standard is None:
        dry_standard = DRY_STANDARDS.get(body.material)
        if dry_standard is None:
            raise AppException(
                status_code=400,
                detail=f"No default dry standard for material: {body.material}",
                error_code="INVALID_MATERIAL",
            )

    # Insert the pin first — readings FK-depend on it.
    try:
        pin_res = await (
            client.table("moisture_pins")
            .insert(
                {
                    "job_id": str(job_id),
                    "room_id": str(body.room_id),
                    "company_id": str(company_id),
                    "canvas_x": float(body.canvas_x),
                    "canvas_y": float(body.canvas_y),
                    "location_name": body.location_name,
                    "material": body.material,
                    "dry_standard": float(dry_standard),
                    "created_by": str(user_id),
                }
            )
            .execute()
        )
    except APIError as e:
        raise AppException(
            status_code=500,
            detail=f"Failed to create pin: {e.message}",
            error_code="DB_ERROR",
        ) from e

    pin = pin_res.data[0]

    # Insert the initial reading.
    try:
        reading_res = await (
            client.table("moisture_pin_readings")
            .insert(
                {
                    "pin_id": pin["id"],
                    "company_id": str(company_id),
                    "reading_value": float(body.initial_reading.reading_value),
                    "reading_date": body.initial_reading.reading_date.isoformat(),
                    "recorded_by": str(user_id),
                    "meter_photo_url": body.initial_reading.meter_photo_url,
                    "notes": body.initial_reading.notes,
                }
            )
            .execute()
        )
    except APIError as e:
        # Roll back the pin — no orphaned pin without a reading.
        await client.table("moisture_pins").delete().eq("id", pin["id"]).execute()
        raise AppException(
            status_code=500,
            detail=f"Failed to create initial reading: {e.message}",
            error_code="DB_ERROR",
        ) from e

    readings = reading_res.data or []

    await log_event(
        company_id,
        "moisture_pin_created",
        job_id=job_id,
        user_id=user_id,
        event_data={"pin_id": pin["id"], "material": body.material},
    )

    return _decorate_pin(pin, readings)


async def list_pins_by_job(
    token: str,
    *,
    job_id: UUID,
    company_id: UUID,
) -> dict:
    """List all pins for a job, decorated with latest reading + color.

    Single PostgREST call embeds readings; we sort + decorate in Python.
    Per-job pin volume is bounded (~15–50 typical), so this is cheap.
    """
    client = await get_authenticated_client(token)

    pins_res = await (
        client.table("moisture_pins")
        .select("*, readings:moisture_pin_readings(*)")
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .order("created_at", desc=False)
        .execute()
    )

    items = []
    for pin in pins_res.data or []:
        readings = pin.pop("readings", []) or []
        readings.sort(key=lambda r: r["reading_date"], reverse=True)
        items.append(_decorate_pin(pin, readings))

    return {"items": items, "total": len(items)}


async def update_pin(
    token: str,
    *,
    pin_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: MoisturePinUpdate,
) -> dict:
    """Update pin metadata (location, material, dry_standard, canvas coords,
    room). Returns the decorated pin."""
    client = await get_authenticated_client(token)

    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    for key in ("canvas_x", "canvas_y", "dry_standard"):
        if key in updates:
            updates[key] = float(updates[key])
    if "room_id" in updates:
        updates["room_id"] = str(updates["room_id"])

    if updates:
        pin_res = await (
            client.table("moisture_pins")
            .update(updates)
            .eq("id", str(pin_id))
            .eq("job_id", str(job_id))
            .execute()
        )
        if not pin_res.data:
            raise AppException(
                status_code=404,
                detail="Pin not found",
                error_code="PIN_NOT_FOUND",
            )
        pin = pin_res.data[0]
    else:
        pin_res = await (
            client.table("moisture_pins")
            .select("*")
            .eq("id", str(pin_id))
            .eq("job_id", str(job_id))
            .single()
            .execute()
        )
        if not pin_res.data:
            raise AppException(
                status_code=404,
                detail="Pin not found",
                error_code="PIN_NOT_FOUND",
            )
        pin = pin_res.data

    readings_res = await (
        client.table("moisture_pin_readings")
        .select("*")
        .eq("pin_id", str(pin_id))
        .order("reading_date", desc=True)
        .execute()
    )
    readings = readings_res.data or []

    await log_event(
        company_id,
        "moisture_pin_updated",
        job_id=job_id,
        user_id=user_id,
        event_data={"pin_id": str(pin_id), "fields": list(updates.keys())},
    )

    return _decorate_pin(pin, readings)


async def delete_pin(
    token: str,
    *,
    pin_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
) -> None:
    """Delete a pin. Readings cascade-delete via FK."""
    client = await get_authenticated_client(token)

    res = await (
        client.table("moisture_pins")
        .delete()
        .eq("id", str(pin_id))
        .eq("job_id", str(job_id))
        .execute()
    )
    if not res.data:
        raise AppException(
            status_code=404,
            detail="Pin not found",
            error_code="PIN_NOT_FOUND",
        )

    await log_event(
        company_id,
        "moisture_pin_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"pin_id": str(pin_id)},
    )


# --- Reading CRUD -----------------------------------------------------------


async def list_readings(token: str, *, pin_id: UUID) -> dict:
    """List all readings for a pin, ascending by date (sparkline order)."""
    client = await get_authenticated_client(token)

    res = await (
        client.table("moisture_pin_readings")
        .select("*")
        .eq("pin_id", str(pin_id))
        .order("reading_date", desc=False)
        .execute()
    )
    return {"items": res.data or [], "total": len(res.data or [])}


async def create_reading(
    token: str,
    *,
    pin_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: MoisturePinReadingCreate,
) -> dict:
    """Create a new reading. Raises 409 on UNIQUE(pin_id, reading_date)
    conflict — the frontend detects collisions before posting, but this
    is the database-level safety net."""
    client = await get_authenticated_client(token)

    try:
        res = await (
            client.table("moisture_pin_readings")
            .insert(
                {
                    "pin_id": str(pin_id),
                    "company_id": str(company_id),
                    "reading_value": float(body.reading_value),
                    "reading_date": body.reading_date.isoformat(),
                    "recorded_by": str(user_id),
                    "meter_photo_url": body.meter_photo_url,
                    "notes": body.notes,
                }
            )
            .execute()
        )
    except APIError as e:
        if getattr(e, "code", None) == "23505":
            raise AppException(
                status_code=409,
                detail="A reading already exists for this pin on this date",
                error_code="READING_ALREADY_EXISTS",
            ) from e
        raise

    return res.data[0]


async def update_reading(
    token: str,
    *,
    reading_id: UUID,
    pin_id: UUID,
    body: MoisturePinReadingUpdate,
) -> dict:
    """Update a reading's value / date / photo / notes."""
    client = await get_authenticated_client(token)

    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "reading_value" in updates:
        updates["reading_value"] = float(updates["reading_value"])
    if "reading_date" in updates:
        updates["reading_date"] = updates["reading_date"].isoformat()

    if not updates:
        res = await (
            client.table("moisture_pin_readings")
            .select("*")
            .eq("id", str(reading_id))
            .eq("pin_id", str(pin_id))
            .single()
            .execute()
        )
        if not res.data:
            raise AppException(
                status_code=404,
                detail="Reading not found",
                error_code="READING_NOT_FOUND",
            )
        return res.data

    res = await (
        client.table("moisture_pin_readings")
        .update(updates)
        .eq("id", str(reading_id))
        .eq("pin_id", str(pin_id))
        .execute()
    )
    if not res.data:
        raise AppException(
            status_code=404,
            detail="Reading not found",
            error_code="READING_NOT_FOUND",
        )
    return res.data[0]


async def delete_reading(
    token: str,
    *,
    reading_id: UUID,
    pin_id: UUID,
) -> None:
    client = await get_authenticated_client(token)
    res = await (
        client.table("moisture_pin_readings")
        .delete()
        .eq("id", str(reading_id))
        .eq("pin_id", str(pin_id))
        .execute()
    )
    if not res.data:
        raise AppException(
            status_code=404,
            detail="Reading not found",
            error_code="READING_NOT_FOUND",
        )
