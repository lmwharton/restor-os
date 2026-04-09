"""Recon phases CRUD service.

Each function talks to the database via the Supabase client.
Think of this as the "business logic" layer — it validates rules
and performs the actual database operations.
"""

import asyncio
import logging
from datetime import UTC, datetime
from uuid import UUID

from api.recon_phases.schemas import PhaseCreate, PhaseReorderItem, PhaseResponse, PhaseUpdate
from api.shared.database import get_authenticated_client
from api.shared.events import log_event
from api.shared.exceptions import AppException

logger = logging.getLogger(__name__)

VALID_PHASE_STATUSES = {"pending", "in_progress", "on_hold", "complete"}


async def _validate_recon_job(client, job_id: UUID, company_id: UUID) -> None:
    """Ensure the job exists, belongs to the company, and is a reconstruction job."""
    result = await (
        client.table("jobs")
        .select("id, job_type")
        .eq("id", str(job_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .execute()
    )
    if not result.data:
        raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")
    if result.data[0]["job_type"] != "reconstruction":
        raise AppException(
            status_code=400,
            detail="Recon phases can only be added to reconstruction jobs",
            error_code="NOT_RECONSTRUCTION_JOB",
        )


def _parse_phase(data: dict) -> PhaseResponse:
    """Convert a database row into a PhaseResponse."""
    return PhaseResponse(
        id=data["id"],
        job_id=data["job_id"],
        company_id=data["company_id"],
        phase_name=data["phase_name"],
        status=data["status"],
        sort_order=data["sort_order"],
        started_at=data.get("started_at"),
        completed_at=data.get("completed_at"),
        notes=data.get("notes"),
        created_at=data["created_at"],
        updated_at=data["updated_at"],
    )


async def list_phases(
    token: str, job_id: UUID, company_id: UUID
) -> list[PhaseResponse]:
    """List all phases for a job, ordered by sort_order."""
    client = await get_authenticated_client(token)

    result = await (
        client.table("recon_phases")
        .select("*")
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .order("sort_order")
        .execute()
    )

    return [_parse_phase(row) for row in (result.data or [])]


async def create_phase(
    token: str, job_id: UUID, company_id: UUID, user_id: UUID, body: PhaseCreate
) -> PhaseResponse:
    """Create a new phase on a reconstruction job."""
    client = await get_authenticated_client(token)

    # Validate this is a reconstruction job
    await _validate_recon_job(client, job_id, company_id)

    # Auto-set timestamps based on initial status
    now = datetime.now(UTC).isoformat()
    insert_data: dict = {
        "job_id": str(job_id),
        "company_id": str(company_id),
        "phase_name": body.phase_name,
        "status": body.status,
        "sort_order": body.sort_order,
        "notes": body.notes,
    }
    if body.status == "in_progress":
        insert_data["started_at"] = now
    elif body.status == "complete":
        insert_data["started_at"] = now
        insert_data["completed_at"] = now

    result = await client.table("recon_phases").insert(insert_data).execute()

    if not result.data:
        raise AppException(
            status_code=500,
            detail="Failed to create phase",
            error_code="PHASE_CREATE_FAILED",
        )

    phase_data = result.data[0]
    await log_event(
        company_id,
        "recon_phase_created",
        job_id=job_id,
        user_id=user_id,
        event_data={"phase_name": body.phase_name},
    )
    return _parse_phase(phase_data)


async def update_phase(
    token: str, job_id: UUID, company_id: UUID, user_id: UUID,
    phase_id: UUID, body: PhaseUpdate
) -> PhaseResponse:
    """Update a phase. Auto-sets started_at/completed_at on status transitions."""
    client = await get_authenticated_client(token)
    await _validate_recon_job(client, job_id, company_id)

    updates: dict = {}
    for key, value in body.model_dump(exclude_unset=True).items():
        updates[key] = value

    if not updates:
        raise AppException(status_code=400, detail="No fields to update", error_code="NO_UPDATES")

    # Auto-set timestamps on status changes
    if "status" in updates:
        new_status = updates["status"]
        now = datetime.now(UTC).isoformat()
        if new_status == "in_progress":
            # Only set started_at if not already set in DB
            current = await (
                client.table("recon_phases")
                .select("started_at")
                .eq("id", str(phase_id))
                .single()
                .execute()
            )
            if not current.data or not current.data.get("started_at"):
                updates["started_at"] = now
        elif new_status == "complete":
            updates["completed_at"] = now
            # Only set started_at if not already set in DB (direct pending→complete)
            current = await (
                client.table("recon_phases")
                .select("started_at")
                .eq("id", str(phase_id))
                .single()
                .execute()
            )
            if not current.data or not current.data.get("started_at"):
                updates["started_at"] = now
        elif new_status == "pending":
            # Reset timestamps if going back to pending
            updates["started_at"] = None
            updates["completed_at"] = None

    result = await (
        client.table("recon_phases")
        .update(updates)
        .eq("id", str(phase_id))
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .execute()
    )

    if not result.data:
        raise AppException(
            status_code=404, detail="Phase not found", error_code="PHASE_NOT_FOUND"
        )

    event_type = "recon_phase_completed" if updates.get("status") == "complete" else "recon_phase_updated"
    await log_event(
        company_id,
        event_type,
        job_id=job_id,
        user_id=user_id,
        event_data={"phase_id": str(phase_id), "phase_name": result.data[0].get("phase_name"), "updated_fields": list(updates.keys())},
    )
    return _parse_phase(result.data[0])


async def delete_phase(
    token: str, job_id: UUID, company_id: UUID, user_id: UUID, phase_id: UUID
) -> None:
    """Delete a phase. Owner or admin only."""
    client = await get_authenticated_client(token)
    await _validate_recon_job(client, job_id, company_id)

    result = await (
        client.table("recon_phases")
        .delete()
        .eq("id", str(phase_id))
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .execute()
    )

    if not result.data:
        raise AppException(
            status_code=404, detail="Phase not found", error_code="PHASE_NOT_FOUND"
        )

    await log_event(
        company_id,
        "recon_phase_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"phase_id": str(phase_id)},
    )


async def reorder_phases(
    token: str, job_id: UUID, company_id: UUID, user_id: UUID,
    items: list[PhaseReorderItem]
) -> list[PhaseResponse]:
    """Bulk reorder phases by updating sort_order for each."""
    client = await get_authenticated_client(token)
    await _validate_recon_job(client, job_id, company_id)

    # Validate: IDs must be unique and sort_orders must be unique
    submitted_ids = [str(item.id) for item in items]
    submitted_orders = [item.sort_order for item in items]
    if len(set(submitted_ids)) != len(submitted_ids):
        raise AppException(status_code=400, detail="Duplicate phase IDs in reorder request", error_code="DUPLICATE_IDS")
    if len(set(submitted_orders)) != len(submitted_orders):
        raise AppException(status_code=400, detail="Duplicate sort_order values in reorder request", error_code="DUPLICATE_SORT_ORDER")

    # Validate submitted IDs exist for this job
    existing = await (
        client.table("recon_phases")
        .select("id")
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .execute()
    )
    existing_ids = {row["id"] for row in (existing.data or [])}
    unknown = set(submitted_ids) - existing_ids
    if unknown:
        raise AppException(status_code=400, detail=f"Unknown phase IDs: {', '.join(unknown)}", error_code="UNKNOWN_PHASE_IDS")

    await asyncio.gather(*(
        client.table("recon_phases")
        .update({"sort_order": item.sort_order})
        .eq("id", str(item.id))
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .execute()
        for item in items
    ))

    await log_event(
        company_id,
        "recon_phases_reordered",
        job_id=job_id,
        user_id=user_id,
    )

    # Return updated list
    return await list_phases(token, job_id, company_id)
