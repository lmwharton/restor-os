"""Moisture pin endpoints — spatial drying tracker per Spec 01H Phase 2.

Pins:
- GET    /jobs/{job_id}/moisture-pins                          — list (decorated)
- POST   /jobs/{job_id}/moisture-pins                          — create + initial reading
- PATCH  /jobs/{job_id}/moisture-pins/{pin_id}                 — update metadata
- DELETE /jobs/{job_id}/moisture-pins/{pin_id}                 — delete (cascades readings)

Readings:
- GET    /jobs/{job_id}/moisture-pins/{pin_id}/readings
- POST   /jobs/{job_id}/moisture-pins/{pin_id}/readings        — 409 on duplicate date
- PATCH  /jobs/{job_id}/moisture-pins/{pin_id}/readings/{id}
- DELETE /jobs/{job_id}/moisture-pins/{pin_id}/readings/{id}
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.moisture_pins.schemas import (
    MoisturePinCreate,
    MoisturePinListResponse,
    MoisturePinReadingCreate,
    MoisturePinReadingListResponse,
    MoisturePinReadingResponse,
    MoisturePinReadingUpdate,
    MoisturePinResponse,
    MoisturePinUpdate,
)
from api.moisture_pins.service import (
    create_pin,
    create_reading,
    delete_pin,
    delete_reading,
    list_pins_by_job,
    list_readings,
    update_pin,
    update_reading,
)
from api.shared.dependencies import _get_token, get_valid_job

router = APIRouter(tags=["moisture-pins"])


# ---------------------------------------------------------------------------
# Pins
# ---------------------------------------------------------------------------


@router.get(
    "/jobs/{job_id}/moisture-pins",
    response_model=MoisturePinListResponse,
)
async def list_moisture_pins_endpoint(
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """List all moisture pins for a job, decorated with latest reading + color."""
    token = _get_token(request)
    return await list_pins_by_job(
        token,
        job_id=job["id"],
        company_id=ctx.company_id,
    )


@router.post(
    "/jobs/{job_id}/moisture-pins",
    status_code=201,
    response_model=MoisturePinResponse,
)
async def create_moisture_pin_endpoint(
    body: MoisturePinCreate,
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create a pin + its initial reading. Rejects pins outside the room polygon."""
    token = _get_token(request)
    return await create_pin(
        token,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.patch(
    "/jobs/{job_id}/moisture-pins/{pin_id}",
    response_model=MoisturePinResponse,
)
async def update_moisture_pin_endpoint(
    body: MoisturePinUpdate,
    request: Request,
    pin_id: UUID = Path(..., description="Moisture pin ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update pin metadata (material, dry_standard, location, canvas coords, room)."""
    token = _get_token(request)
    return await update_pin(
        token,
        pin_id=pin_id,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.delete(
    "/jobs/{job_id}/moisture-pins/{pin_id}",
    status_code=204,
)
async def delete_moisture_pin_endpoint(
    request: Request,
    pin_id: UUID = Path(..., description="Moisture pin ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Delete a pin. Readings cascade via FK."""
    token = _get_token(request)
    await delete_pin(
        token,
        pin_id=pin_id,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
    )


# ---------------------------------------------------------------------------
# Readings
# ---------------------------------------------------------------------------


@router.get(
    "/jobs/{job_id}/moisture-pins/{pin_id}/readings",
    response_model=MoisturePinReadingListResponse,
)
async def list_pin_readings_endpoint(
    request: Request,
    pin_id: UUID = Path(..., description="Moisture pin ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """List all readings for a pin, ascending by date (sparkline order).

    The ``job`` dependency enforces that the caller owns the URL's parent
    job; the service layer additionally asserts the pin belongs to that
    job (prevents intra-company cross-job reads). Reads are allowed on
    archived jobs — the archive guard only gates mutations.
    """
    token = _get_token(request)
    return await list_readings(token, pin_id=pin_id, job_id=job["id"])


@router.post(
    "/jobs/{job_id}/moisture-pins/{pin_id}/readings",
    status_code=201,
    response_model=MoisturePinReadingResponse,
)
async def create_pin_reading_endpoint(
    body: MoisturePinReadingCreate,
    request: Request,
    pin_id: UUID = Path(..., description="Moisture pin ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Add a new reading. Returns 409 if one already exists for this date."""
    token = _get_token(request)
    return await create_reading(
        token,
        pin_id=pin_id,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.patch(
    "/jobs/{job_id}/moisture-pins/{pin_id}/readings/{reading_id}",
    response_model=MoisturePinReadingResponse,
)
async def update_pin_reading_endpoint(
    body: MoisturePinReadingUpdate,
    request: Request,
    pin_id: UUID = Path(..., description="Moisture pin ID"),
    reading_id: UUID = Path(..., description="Reading ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Edit a reading's value, date, photo, or notes."""
    token = _get_token(request)
    return await update_reading(
        token,
        reading_id=reading_id,
        pin_id=pin_id,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.delete(
    "/jobs/{job_id}/moisture-pins/{pin_id}/readings/{reading_id}",
    status_code=204,
)
async def delete_pin_reading_endpoint(
    request: Request,
    pin_id: UUID = Path(..., description="Moisture pin ID"),
    reading_id: UUID = Path(..., description="Reading ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    token = _get_token(request)
    await delete_reading(
        token,
        reading_id=reading_id,
        pin_id=pin_id,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
    )
