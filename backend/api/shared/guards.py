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


def raise_if_archived(job: dict) -> None:
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
    Includes ``property_id`` in the selected columns so callers can feed the
    returned dict into :func:`assert_job_on_floor_plan_property` without a
    second round-trip.
    """
    result = await (
        client.table("jobs")
        .select("id, status, deleted_at, company_id, property_id")
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
    raise_if_archived(result.data)
    return result.data


def assert_job_on_floor_plan_property(
    job: dict,
    floor_plan_property_id: str | UUID | None,
) -> None:
    """Enforce the invariant: a job's mutation on a floor plan must target a
    floor plan on the job's property.

    Round-1 W1 added this check inline in ``save_canvas``. Round-2 R5 caught
    two siblings (``rollback_version`` and ``cleanup_floor_plan``) that
    accepted a ``job_id`` body param but never compared the job's
    ``property_id`` against the floor plan's.

    R8 (round 2): reject ``job.property_id IS NULL`` with ``JOB_NO_PROPERTY``
    rather than silently passing. The previous "legacy accommodation" branch
    recreated W1's bypass in ``rollback_version`` / ``cleanup_floor_plan``
    once this helper became the shared path. In the current product, jobs
    are created with an address that deterministically resolves a
    ``property_id``, so a NULL here is a data-integrity alarm — fail loudly.

    The create-by-job router endpoint (``POST /jobs/{id}/floor-plans``)
    auto-links a property from the job's address on first save and never
    routes through this helper, so that recovery path is unaffected.
    """
    job_property_id = job.get("property_id")
    if job_property_id is None:
        raise AppException(
            status_code=400,
            detail=(
                "Job has no property linked. Create a floor plan first via "
                "POST /jobs/{id}/floor-plans to auto-link the property."
            ),
            error_code="JOB_NO_PROPERTY",
        )
    if floor_plan_property_id is None:
        raise AppException(
            status_code=400,
            detail="Floor plan has no property — orphaned row",
            error_code="PROPERTY_MISMATCH",
        )
    if str(job_property_id) != str(floor_plan_property_id):
        raise AppException(
            status_code=400,
            detail="Floor plan does not belong to this job's property",
            error_code="PROPERTY_MISMATCH",
        )


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
    raise_if_archived(job)
    return job
