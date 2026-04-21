"""Service-layer access-control guards.

Plain async helpers (not FastAPI Depends) that enforce cross-cutting write
rules. The main rule here is "can this job be edited right now?" — see
ARCHIVED_JOB_STATUSES in shared.constants for the lifecycle definition.

Called at the top of every mutation on floor-plan-shaped data
(floor_plans, job_rooms, wall_segments, wall_openings) so that sibling
endpoints cannot bypass save_canvas's archive gate.
"""

from uuid import UUID

from api.shared.constants import ARCHIVED_JOB_STATUSES
from api.shared.exceptions import AppException


def _raise_if_archived(job: dict) -> None:
    if job.get("deleted_at") is not None:
        raise AppException(
            status_code=404,
            detail="Job not found",
            error_code="JOB_NOT_FOUND",
        )
    if job.get("status") in ARCHIVED_JOB_STATUSES:
        raise AppException(
            status_code=403,
            detail="Cannot modify floor plan data for an archived job",
            error_code="JOB_ARCHIVED",
        )


async def ensure_job_mutable(
    client,
    job_id: UUID,
    company_id: UUID,
) -> dict:
    """Fetch the job and raise 403 JOB_ARCHIVED if it's frozen, or 404 if gone.

    One round-trip; returns the fetched job dict so callers can reuse it.
    """
    result = await (
        client.table("jobs")
        .select("id, status, deleted_at, company_id")
        .eq("id", str(job_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Job not found",
            error_code="JOB_NOT_FOUND",
        )
    _raise_if_archived(result.data)
    return result.data


async def ensure_job_mutable_for_room(
    client,
    room_id: UUID,
    company_id: UUID,
) -> dict:
    """Fetch a room's parent job via embedded select and raise if archived.

    Used by walls/openings endpoints where the route is /rooms/{room_id}/...
    and the service never learns the job_id directly. One round-trip.
    Returns the embedded job dict.
    """
    result = await (
        client.table("job_rooms")
        .select("job_id, jobs!inner(id, status, deleted_at, company_id)")
        .eq("id", str(room_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Room not found",
            error_code="ROOM_NOT_FOUND",
        )
    job = result.data.get("jobs")
    if not job:
        raise AppException(
            status_code=404,
            detail="Job not found",
            error_code="JOB_NOT_FOUND",
        )
    _raise_if_archived(job)
    return job
