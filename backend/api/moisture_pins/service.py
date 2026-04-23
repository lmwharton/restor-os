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
from api.shared.guards import ensure_job_mutable

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


async def _assert_pin_on_job(
    client,
    *,
    pin_id: UUID,
    job_id: UUID,
) -> dict:
    """Fetch the pin and verify it belongs to the URL's ``job_id``.

    RLS on moisture_pins scopes the fetch to the caller's company, so
    cross-company is already a 404. This guards the intra-company
    cross-job case — a tech (or a cached URL) pointing ``/jobs/A/.../pins/B_pin``
    at Pin B owned by Job B. We 404 (not 403) so the response doesn't
    leak that the pin exists under a different job in the same company.

    Read-only variant: does NOT check archive status. Mutations should
    use :func:`_assert_pin_on_job_and_mutable` instead.
    """
    pin_res = await (
        client.table("moisture_pins")
        .select("*")
        .eq("id", str(pin_id))
        .execute()
    )
    if not pin_res.data:
        raise AppException(
            status_code=404,
            detail="Pin not found",
            error_code="PIN_NOT_FOUND",
        )
    pin = pin_res.data[0]
    if str(pin.get("job_id")) != str(job_id):
        raise AppException(
            status_code=404,
            detail="Pin not found",
            error_code="PIN_NOT_FOUND",
        )
    return pin


async def _validate_pin_placement(
    client,
    *,
    room_id: UUID,
    job_id: UUID,
    canvas_x: float,
    canvas_y: float,
) -> None:
    """Enforce the two create-time invariants: the room belongs to the
    target job, and the ``(canvas_x, canvas_y)`` point falls inside the
    room polygon (Q6 rule — "no whitespace drops").

    Called on every path that could land a pin at new coordinates or on
    a different room: ``create_pin`` (always) and ``update_pin`` when
    ``canvas_x`` / ``canvas_y`` / ``room_id`` are in the patch. Without
    this helper ``update_pin`` silently accepted drag-to-move drops
    past walls, orphaning pins outside any room polygon where the
    canvas visibility filter then hides them — classic
    pr-review-lessons #3 "sibling-miss within your own PR."

    Legacy rect-only rooms with no ``room_polygon`` stored skip the
    point-in-polygon check (matches ``create_pin``'s prior behavior —
    false rejection on legacy rows would be worse than a permissive
    pass for pins they've already accepted).
    """
    room_res = await (
        client.table("job_rooms")
        .select("id, room_polygon")
        .eq("id", str(room_id))
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
    polygon = room_res.data.get("room_polygon") or []
    if len(polygon) >= 3 and not _point_in_polygon(
        (float(canvas_x), float(canvas_y)), polygon
    ):
        raise AppException(
            status_code=400,
            detail="Pin must be placed inside the selected room",
            error_code="PIN_OUTSIDE_ROOM",
        )


async def _assert_pin_on_job_and_mutable(
    client,
    *,
    pin_id: UUID,
    job_id: UUID,
    company_id: UUID,
) -> dict:
    """Mutate-path equivalent of :func:`_assert_pin_on_job`.

    Two guards in one: the pin→job cross-check (see above) plus the
    archive-status check on the pin's parent job via
    :func:`api.shared.guards.ensure_job_mutable`. The two are combined
    because fixing archive-guard without the cross-check leaves a hole
    (URL can target an unarchived Job A while the pin actually lives
    on archived Job B; Job A's archive state is not the one that
    matters). Every mutating endpoint on this module goes through
    this function before touching the data.
    """
    pin = await _assert_pin_on_job(client, pin_id=pin_id, job_id=job_id)
    await ensure_job_mutable(client, job_id, company_id)
    return pin


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

    # Archive guard: mitigation jobs rolled to collected / handed to the
    # carrier are frozen for all pin + reading writes. UI also blocks
    # Moisture Mode when archived, but a stale tab or a direct API
    # caller would otherwise slip through here. Same shape as the
    # Phase 1 R6 guard on walls/rooms.
    await ensure_job_mutable(client, job_id, company_id)

    # Room-membership + point-in-polygon in one helper; same rules now
    # apply in update_pin when coords / room change.
    await _validate_pin_placement(
        client,
        room_id=body.room_id,
        job_id=job_id,
        canvas_x=float(body.canvas_x),
        canvas_y=float(body.canvas_y),
    )

    # Resolve dry standard: explicit value wins, else material default.
    # ``MoistureMaterial`` is a Pydantic Literal over the DRY_STANDARDS
    # keys, so the subscript is safe — an unknown material would have
    # already 422'd at the schema boundary.
    dry_standard = (
        body.dry_standard
        if body.dry_standard is not None
        else DRY_STANDARDS[body.material]
    )

    # Atomic pin + initial-reading INSERT via SECURITY DEFINER RPC
    # (migration e1f2a3b4c5d6). The prior Python-side two-step had a
    # silent-failure window: if the reading INSERT raised AND the
    # compensating pin DELETE also raised, an orphan pin survived
    # with no readings and rendered on canvas as a grey "no reading
    # yet" dot. Function-level transaction rolls BOTH back on any
    # failure inside the function — pr-review-lessons #4.
    try:
        rpc_res = await client.rpc(
            "create_moisture_pin_with_reading",
            {
                "p_job_id": str(job_id),
                "p_room_id": str(body.room_id),
                "p_company_id": str(company_id),
                "p_canvas_x": float(body.canvas_x),
                "p_canvas_y": float(body.canvas_y),
                "p_location_name": body.location_name,
                "p_material": body.material,
                "p_dry_standard": float(dry_standard),
                "p_created_by": str(user_id),
                "p_reading_value": float(body.initial_reading.reading_value),
                "p_reading_date": body.initial_reading.reading_date.isoformat(),
                "p_meter_photo_url": body.initial_reading.meter_photo_url,
                "p_notes": body.initial_reading.notes,
            },
        ).execute()
    except APIError as e:
        # Unique violation on (pin_id, reading_date) is impossible on
        # a brand-new pin, so any 23505 here is a schema-level
        # integrity issue worth bubbling. All other failures are
        # already rolled back atomically inside the RPC.
        raise AppException(
            status_code=500,
            detail=f"Failed to create pin: {e.message}",
            error_code="DB_ERROR",
        ) from e

    # RPC returns {"pin": {...}, "reading": {...}}. Unwrap.
    payload = rpc_res.data or {}
    pin = payload.get("pin")
    reading = payload.get("reading")
    if not pin or not reading:
        raise AppException(
            status_code=500,
            detail="RPC returned incomplete payload",
            error_code="DB_ERROR",
        )
    readings = [reading]

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

    Single PostgREST call embeds readings pre-sorted desc by
    reading_date. Per-job pin volume is bounded (~15–50 typical),
    but pushing the sort into the embed avoids a fragile Python-side
    lexicographic compare that works for DATE strings but would
    silently break if ``reading_date`` ever shifts to TIMESTAMPTZ.
    """
    client = await get_authenticated_client(token)

    pins_res = await (
        client.table("moisture_pins")
        .select(
            "*, readings:moisture_pin_readings(*, order(reading_date.desc))",
        )
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .order("created_at", desc=False)
        .execute()
    )

    items = []
    for pin in pins_res.data or []:
        readings = pin.pop("readings", []) or []
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

    # Cross-check pin belongs to URL job + archive-guard the parent job.
    # Guards both the cross-job URL swap and the stale-tab-on-archived-job
    # flow. 404 on mismatch (don't leak the real parent). Returns the
    # pin dict so downstream validation can merge the patch against
    # existing values without a second fetch.
    existing_pin = await _assert_pin_on_job_and_mutable(
        client, pin_id=pin_id, job_id=job_id, company_id=company_id,
    )

    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}

    # Mirror create_pin's material → dry_standard default when the
    # caller sends a new material without an explicit dry_standard
    # override. Frontend edit sheet normally sends both together; this
    # guards API callers who PATCH material alone from silently
    # inheriting a dry_standard that belongs to a different material.
    if "material" in updates and "dry_standard" not in updates:
        updates["dry_standard"] = DRY_STANDARDS[updates["material"]]

    for key in ("canvas_x", "canvas_y", "dry_standard"):
        if key in updates:
            updates[key] = float(updates[key])
    if "room_id" in updates:
        updates["room_id"] = str(updates["room_id"])

    # If any of canvas coords / room_id are changing, re-run the
    # create-time room-membership + point-in-polygon invariant.
    # Otherwise drag-to-move + room-swap bypass the Q6 rule silently.
    # Merge the patch against the existing pin's values so a partial
    # patch (e.g. only canvas_x) still validates against current y/room.
    if any(k in updates for k in ("canvas_x", "canvas_y", "room_id")):
        target_room_id = UUID(updates.get("room_id", str(existing_pin["room_id"])))
        target_x = updates.get("canvas_x", float(existing_pin["canvas_x"]))
        target_y = updates.get("canvas_y", float(existing_pin["canvas_y"]))
        await _validate_pin_placement(
            client,
            room_id=target_room_id,
            job_id=job_id,
            canvas_x=target_x,
            canvas_y=target_y,
        )

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

    # Cross-check + archive guard before the destructive DELETE.
    await _assert_pin_on_job_and_mutable(
        client, pin_id=pin_id, job_id=job_id, company_id=company_id,
    )

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


async def list_readings(
    token: str,
    *,
    pin_id: UUID,
    job_id: UUID,
) -> dict:
    """List all readings for a pin, ascending by date (sparkline order).

    Read-only: returns data even on archived jobs. The cross-check
    still fires so a same-company caller can't read another job's
    readings via a URL swap (intra-company cross-job leak).
    """
    client = await get_authenticated_client(token)

    await _assert_pin_on_job(client, pin_id=pin_id, job_id=job_id)

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
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: MoisturePinReadingCreate,
) -> dict:
    """Create a new reading. Raises 409 on UNIQUE(pin_id, reading_date)
    conflict — the frontend detects collisions before posting, but this
    is the database-level safety net."""
    client = await get_authenticated_client(token)

    # Cross-check pin→job + archive guard before the write.
    await _assert_pin_on_job_and_mutable(
        client, pin_id=pin_id, job_id=job_id, company_id=company_id,
    )

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
    job_id: UUID,
    company_id: UUID,
    body: MoisturePinReadingUpdate,
) -> dict:
    """Update a reading's value / date / photo / notes."""
    client = await get_authenticated_client(token)

    await _assert_pin_on_job_and_mutable(
        client, pin_id=pin_id, job_id=job_id, company_id=company_id,
    )

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
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
) -> None:
    client = await get_authenticated_client(token)

    await _assert_pin_on_job_and_mutable(
        client, pin_id=pin_id, job_id=job_id, company_id=company_id,
    )

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

    # Audit trail parity with create_pin / update_pin / delete_pin /
    # create_reading / update_reading. Without this, reading deletions
    # leave no timeline entry and no compliance record — the review
    # flagged the gap as an observability bug.
    await log_event(
        company_id,
        "moisture_reading_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"reading_id": str(reading_id), "pin_id": str(pin_id)},
    )
