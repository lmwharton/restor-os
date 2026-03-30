"""Moisture readings, points, and dehu outputs endpoints.

11 endpoints total:
- POST/GET readings under /jobs/{job_id}/rooms/{room_id}/readings
- GET all readings: /jobs/{job_id}/readings
- PATCH/DELETE reading
- POST/PATCH/DELETE points under /jobs/{job_id}/readings/{reading_id}/points
- POST/PATCH/DELETE dehus under /jobs/{job_id}/readings/{reading_id}/dehus
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.moisture.schemas import (
    DehuOutputCreate,
    DehuOutputResponse,
    DehuOutputUpdate,
    MoisturePointCreate,
    MoisturePointResponse,
    MoisturePointUpdate,
    MoistureReadingCreate,
    MoistureReadingListResponse,
    MoistureReadingResponse,
    MoistureReadingUpdate,
)
from api.moisture.service import (
    create_dehu,
    create_point,
    create_reading,
    delete_dehu,
    delete_point,
    delete_reading,
    list_job_readings,
    list_room_readings,
    update_dehu,
    update_point,
    update_reading,
)
from api.shared.database import get_authenticated_client
from api.shared.dependencies import _get_token, get_valid_job, get_valid_reading, get_valid_room

router = APIRouter(tags=["moisture"])


# --- Readings ---


@router.post(
    "/jobs/{job_id}/rooms/{room_id}/readings",
    response_model=MoistureReadingResponse,
    status_code=201,
)
async def create_moisture_reading(
    body: MoistureReadingCreate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
    room: dict = Depends(get_valid_room),
):
    """Create a moisture reading for a room."""
    client = await get_authenticated_client(_get_token(request))
    return await create_reading(
        client,
        job_id=UUID(job["id"]),
        room_id=UUID(room["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
        job_data=job,
    )


@router.get(
    "/jobs/{job_id}/rooms/{room_id}/readings",
    response_model=MoistureReadingListResponse,
)
async def list_room_moisture_readings(
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
    room: dict = Depends(get_valid_room),
):
    """List all moisture readings for a specific room."""
    client = await get_authenticated_client(_get_token(request))
    return await list_room_readings(client, job_id=UUID(job["id"]), room_id=UUID(room["id"]))


@router.get(
    "/jobs/{job_id}/readings",
    response_model=MoistureReadingListResponse,
)
async def list_all_job_readings(
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
):
    """List ALL moisture readings across all rooms for a job."""
    client = await get_authenticated_client(_get_token(request))
    return await list_job_readings(client, job_id=UUID(job["id"]))


@router.patch(
    "/jobs/{job_id}/readings/{reading_id}",
    response_model=MoistureReadingResponse,
)
async def update_moisture_reading(
    body: MoistureReadingUpdate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
    reading: dict = Depends(get_valid_reading),
):
    """Update a moisture reading."""
    client = await get_authenticated_client(_get_token(request))
    return await update_reading(
        client,
        reading_id=UUID(reading["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        job_id=UUID(job["id"]),
        body=body,
        reading_data=reading,
        job_data=job,
    )


@router.delete(
    "/jobs/{job_id}/readings/{reading_id}",
    status_code=204,
)
async def delete_moisture_reading(
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
    reading: dict = Depends(get_valid_reading),
):
    """Delete a moisture reading and all its points and dehus."""
    client = await get_authenticated_client(_get_token(request))
    await delete_reading(
        client,
        reading_id=UUID(reading["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        job_id=UUID(job["id"]),
    )


# --- Points ---


@router.post(
    "/jobs/{job_id}/readings/{reading_id}/points",
    response_model=MoisturePointResponse,
    status_code=201,
)
async def add_moisture_point(
    body: MoisturePointCreate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
    reading: dict = Depends(get_valid_reading),
):
    """Add a moisture measurement point to a reading."""
    client = await get_authenticated_client(_get_token(request))
    return await create_point(
        client,
        reading_id=UUID(reading["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        job_id=UUID(job["id"]),
        body=body,
    )


@router.patch(
    "/jobs/{job_id}/readings/{reading_id}/points/{point_id}",
    response_model=MoisturePointResponse,
)
async def update_moisture_point(
    body: MoisturePointUpdate,
    request: Request,
    point_id: UUID = Path(..., description="Point ID"),
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
    reading: dict = Depends(get_valid_reading),
):
    """Update a moisture measurement point."""
    client = await get_authenticated_client(_get_token(request))
    return await update_point(
        client,
        point_id=point_id,
        reading_id=UUID(reading["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        job_id=UUID(job["id"]),
        body=body,
    )


@router.delete(
    "/jobs/{job_id}/readings/{reading_id}/points/{point_id}",
    status_code=204,
)
async def delete_moisture_point(
    request: Request,
    point_id: UUID = Path(..., description="Point ID"),
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
    reading: dict = Depends(get_valid_reading),
):
    """Delete a moisture measurement point."""
    client = await get_authenticated_client(_get_token(request))
    await delete_point(
        client,
        point_id=point_id,
        reading_id=UUID(reading["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        job_id=UUID(job["id"]),
    )


# --- Dehus ---


@router.post(
    "/jobs/{job_id}/readings/{reading_id}/dehus",
    response_model=DehuOutputResponse,
    status_code=201,
)
async def add_dehu_output(
    body: DehuOutputCreate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
    reading: dict = Depends(get_valid_reading),
):
    """Add a dehumidifier output reading."""
    client = await get_authenticated_client(_get_token(request))
    return await create_dehu(
        client,
        reading_id=UUID(reading["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        job_id=UUID(job["id"]),
        body=body,
    )


@router.patch(
    "/jobs/{job_id}/readings/{reading_id}/dehus/{dehu_id}",
    response_model=DehuOutputResponse,
)
async def update_dehu_output(
    body: DehuOutputUpdate,
    request: Request,
    dehu_id: UUID = Path(..., description="Dehu output ID"),
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
    reading: dict = Depends(get_valid_reading),
):
    """Update a dehumidifier output reading."""
    client = await get_authenticated_client(_get_token(request))
    return await update_dehu(
        client,
        dehu_id=dehu_id,
        reading_id=UUID(reading["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        job_id=UUID(job["id"]),
        body=body,
    )


@router.delete(
    "/jobs/{job_id}/readings/{reading_id}/dehus/{dehu_id}",
    status_code=204,
)
async def delete_dehu_output(
    request: Request,
    dehu_id: UUID = Path(..., description="Dehu output ID"),
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
    reading: dict = Depends(get_valid_reading),
):
    """Delete a dehumidifier output reading."""
    client = await get_authenticated_client(_get_token(request))
    await delete_dehu(
        client,
        dehu_id=dehu_id,
        reading_id=UUID(reading["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        job_id=UUID(job["id"]),
    )
