"""Floor Plans service — CRUD operations against Supabase.

Uses authenticated client (RLS-enforced) for all operations.
Hard deletes (no deleted_at column on floor_plans).
"""

from uuid import UUID

from postgrest.exceptions import APIError

from api.floor_plans.schemas import FloorPlanCreate, FloorPlanUpdate
from api.shared.database import get_authenticated_client
from api.shared.events import log_event
from api.shared.exceptions import AppException


async def create_floor_plan(
    token: str,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: FloorPlanCreate,
) -> dict:
    """Create a floor plan. Enforces unique (job_id, floor_number)."""
    client = get_authenticated_client(token)

    # Check uniqueness of (job_id, floor_number)
    existing = (
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
        result = client.table("floor_plans").insert(row).execute()
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
) -> list[dict]:
    """List all floor plans for a job, ordered by floor_number."""
    client = get_authenticated_client(token)

    result = (
        client.table("floor_plans")
        .select("*")
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .order("floor_number")
        .execute()
    )

    return result.data


async def update_floor_plan(
    token: str,
    floor_plan_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: FloorPlanUpdate,
) -> dict:
    """Update a floor plan. Validates floor_number uniqueness if changed."""
    client = get_authenticated_client(token)

    # Get existing
    existing = (
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
        dup = (
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
        result = (
            client.table("floor_plans")
            .update(updates)
            .eq("id", str(floor_plan_id))
            .eq("company_id", str(company_id))
            .execute()
        )
    except APIError as e:
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
    client = get_authenticated_client(token)

    # Verify it exists
    existing = (
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
    client.table("job_rooms").update({"floor_plan_id": None}).eq(
        "floor_plan_id", str(floor_plan_id)
    ).execute()

    # Hard delete the floor plan
    client.table("floor_plans").delete().eq("id", str(floor_plan_id)).execute()

    await log_event(
        company_id,
        "floor_plan_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"floor_plan_id": str(floor_plan_id)},
    )
