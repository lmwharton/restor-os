"""Jobs CRUD service. All queries use the authenticated client (RLS-scoped)."""

import logging
import random
import time
from datetime import UTC, date, datetime
from uuid import UUID

from api.jobs.schemas import JobCreate, JobDetailResponse, JobUpdate
from api.shared.database import get_authenticated_client, get_supabase_admin_client
from api.shared.events import log_event
from api.shared.exceptions import AppException
from api.shared.sanitize import sanitize_postgrest_search

logger = logging.getLogger(__name__)

JOB_NUMBER_MAX_RETRIES = 5

VALID_LOSS_TYPES = {"water", "fire", "mold", "storm", "other"}
VALID_LOSS_CATEGORIES = {"1", "2", "3"}
VALID_LOSS_CLASSES = {"1", "2", "3", "4"}
VALID_STATUSES = {
    "new",
    "contracted",
    "mitigation",
    "drying",
    "job_complete",
    "submitted",
    "collected",
}
VALID_SORT_FIELDS = {"created_at", "updated_at", "job_number", "customer_name"}


def _validate_enums(
    loss_type: str | None = None,
    loss_category: str | None = None,
    loss_class: str | None = None,
    status: str | None = None,
) -> None:
    """Validate enum fields. Raises AppException on invalid values."""
    if loss_type is not None and loss_type not in VALID_LOSS_TYPES:
        raise AppException(
            status_code=400,
            detail=f"Invalid loss_type: must be one of {', '.join(sorted(VALID_LOSS_TYPES))}",
            error_code="INVALID_LOSS_TYPE",
        )
    if loss_category is not None and loss_category not in VALID_LOSS_CATEGORIES:
        raise AppException(
            status_code=400,
            detail="Invalid loss_category: must be 1, 2, or 3",
            error_code="INVALID_LOSS_CATEGORY",
        )
    if loss_class is not None and loss_class not in VALID_LOSS_CLASSES:
        raise AppException(
            status_code=400,
            detail="Invalid loss_class: must be 1, 2, 3, or 4",
            error_code="INVALID_LOSS_CLASS",
        )
    if status is not None and status not in VALID_STATUSES:
        raise AppException(
            status_code=400,
            detail=f"Invalid status: must be one of {', '.join(sorted(VALID_STATUSES))}",
            error_code="INVALID_STATUS",
        )


async def _generate_job_number(
    client, company_id: UUID, *, collision_offset: int = 0
) -> str:
    """Generate JOB-YYYYMMDD-XXX. Queries max existing for today.

    On retry after a unique constraint collision, pass collision_offset > 0
    to add a random bump beyond the max sequence. Each retry re-queries the
    database to see the latest committed state.
    """
    today = datetime.now(UTC).strftime("%Y%m%d")
    prefix = f"JOB-{today}-"

    result = await (
        client.table("jobs")
        .select("job_number")
        .eq("company_id", str(company_id))
        .like("job_number", f"{prefix}%")
        .order("job_number", desc=True)
        .limit(1)
        .execute()
    )

    if result.data:
        last_number = result.data[0]["job_number"]
        seq = int(last_number.split("-")[-1]) + 1
    else:
        seq = 1

    # On collision retries, bump by a random offset to avoid repeated clashes
    seq += collision_offset

    return f"{prefix}{seq:03d}"


def _extract_embedded_count(data: dict, key: str) -> int:
    """Extract count from PostgREST embedded resource format: [{"count": N}]."""
    embedded = data.get(key)
    if isinstance(embedded, list) and len(embedded) > 0:
        return embedded[0].get("count", 0)
    return 0


def _parse_job_detail_from_embedded(data: dict) -> JobDetailResponse:
    """Parse a job row with PostgREST embedded counts into JobDetailResponse."""
    counts = {
        "room_count": _extract_embedded_count(data, "job_rooms"),
        "photo_count": _extract_embedded_count(data, "photos"),
        "floor_plan_count": _extract_embedded_count(data, "floor_plans"),
        "line_item_count": 0,  # line_items table not created yet (Spec 02)
    }
    return _parse_job_detail(data, counts)


def _parse_job_detail(data: dict, counts: dict) -> JobDetailResponse:
    """Parse a job row dict into JobDetailResponse with computed counts."""
    return JobDetailResponse(
        id=data["id"],
        company_id=data["company_id"],
        property_id=data.get("property_id"),
        job_number=data["job_number"],
        address_line1=data["address_line1"],
        city=data.get("city", ""),
        state=data.get("state", ""),
        zip=data.get("zip", ""),
        customer_name=data.get("customer_name"),
        customer_phone=data.get("customer_phone"),
        customer_email=data.get("customer_email"),
        claim_number=data.get("claim_number"),
        carrier=data.get("carrier"),
        adjuster_name=data.get("adjuster_name"),
        adjuster_phone=data.get("adjuster_phone"),
        adjuster_email=data.get("adjuster_email"),
        loss_type=data["loss_type"],
        loss_category=data.get("loss_category"),
        loss_class=data.get("loss_class"),
        loss_cause=data.get("loss_cause"),
        loss_date=data.get("loss_date"),
        status=data["status"],
        assigned_to=data.get("assigned_to"),
        notes=data.get("notes"),
        tech_notes=data.get("tech_notes"),
        latitude=data.get("latitude"),
        longitude=data.get("longitude"),
        created_by=data.get("created_by"),
        updated_by=data.get("updated_by"),
        created_at=data["created_at"],
        updated_at=data["updated_at"],
        room_count=counts.get("room_count", 0),
        photo_count=counts.get("photo_count", 0),
        floor_plan_count=counts.get("floor_plan_count", 0),
        line_item_count=counts.get("line_item_count", 0),
    )


async def _get_job_counts(client, job_id: str) -> dict:
    """Query counts of related entities for a job."""
    counts: dict[str, int] = {}

    for table, key in [
        ("job_rooms", "room_count"),
        ("photos", "photo_count"),
        ("floor_plans", "floor_plan_count"),
        # ("line_items", "line_item_count"),  # Not created yet (Spec 02)
    ]:
        try:
            result = await (
                client.table(table).select("id", count="exact").eq("job_id", job_id).execute()
            )
            counts[key] = result.count if result.count is not None else 0
        except Exception:
            counts[key] = 0

    return counts


async def create_job(
    token: str,
    company_id: UUID,
    user_id: UUID,
    body: JobCreate,
) -> JobDetailResponse:
    """Create a new job with auto-generated job_number.

    Uses rpc_create_job for atomic job insert + event logging in a single
    database transaction. Falls back to separate insert + fire-and-forget
    event if the RPC is unavailable (e.g., migration not yet applied).
    """
    start = time.perf_counter()

    _validate_enums(
        loss_type=body.loss_type,
        loss_category=body.loss_category,
        loss_class=body.loss_class,
    )

    client = await get_authenticated_client(token)
    admin_client = await get_supabase_admin_client()

    # Build optional field values
    opt_property_id = str(body.property_id) if body.property_id else None
    opt_loss_date = body.loss_date.isoformat() if isinstance(body.loss_date, date) else None

    # Retry loop to handle concurrent job_number collisions.
    # Each retry re-queries for the max sequence and adds a random offset
    # to avoid repeated clashes with concurrent requests.
    job_data = None
    for attempt in range(JOB_NUMBER_MAX_RETRIES):
        collision_offset = random.randint(1, 10) if attempt > 0 else 0
        job_number = await _generate_job_number(
            client, company_id, collision_offset=collision_offset
        )

        rpc_params = {
            "p_company_id": str(company_id),
            "p_job_number": job_number,
            "p_address_line1": body.address_line1,
            "p_city": body.city,
            "p_state": body.state,
            "p_zip": body.zip,
            "p_loss_type": body.loss_type,
            "p_created_by": str(user_id),
            "p_property_id": opt_property_id,
            "p_customer_name": body.customer_name,
            "p_customer_phone": body.customer_phone,
            "p_customer_email": body.customer_email,
            "p_loss_category": body.loss_category,
            "p_loss_class": body.loss_class,
            "p_loss_cause": body.loss_cause,
            "p_loss_date": opt_loss_date,
            "p_claim_number": body.claim_number,
            "p_carrier": body.carrier,
            "p_adjuster_name": body.adjuster_name,
            "p_adjuster_phone": body.adjuster_phone,
            "p_adjuster_email": body.adjuster_email,
            "p_notes": body.notes,
            "p_tech_notes": body.tech_notes,
        }

        try:
            # Use admin client for RPC (SECURITY DEFINER function, bypasses RLS)
            result = await admin_client.rpc("rpc_create_job", rpc_params).execute()
            if not result.data:
                raise AppException(
                    status_code=500,
                    detail="Failed to create job",
                    error_code="JOB_CREATE_FAILED",
                )
            job_data = result.data
            # RPC returns JSONB; supabase-py may wrap it in a list or return dict directly
            if isinstance(job_data, list):
                job_data = job_data[0] if job_data else None
            break  # Success -- job + event created atomically
        except AppException:
            raise
        except Exception as e:
            error_msg = str(e).lower()
            is_job_number_conflict = "unique" in error_msg and "job_number" in error_msg
            # If RPC doesn't exist yet, fall back to non-atomic path
            is_rpc_missing = "rpc_create_job" in error_msg and (
                "not found" in error_msg or "does not exist" in error_msg
                or "could not find" in error_msg
            )
            if is_rpc_missing:
                logger.info("rpc_create_job not available, falling back to non-atomic path")
                job_data = await _create_job_fallback(
                    client, company_id, user_id, body, job_number
                )
                break
            if is_job_number_conflict and attempt < JOB_NUMBER_MAX_RETRIES - 1:
                logger.warning(
                    "Job number collision on attempt %d, retrying: %s",
                    attempt + 1,
                    job_number,
                )
                continue
            raise

    if job_data is None:
        raise AppException(
            status_code=500,
            detail="Failed to create job after retries",
            error_code="JOB_CREATE_FAILED",
        )

    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info("job_created", extra={"extra_data": {
        "job_id": str(job_data.get("id", "")),
        "job_number": job_data.get("job_number", ""),
        "duration_ms": duration_ms,
    }})

    # New job has zero counts
    counts = {"room_count": 0, "photo_count": 0, "floor_plan_count": 0, "line_item_count": 0}
    return _parse_job_detail(job_data, counts)


async def _create_job_fallback(
    client,
    company_id: UUID,
    user_id: UUID,
    body: JobCreate,
    job_number: str,
) -> dict:
    """Fallback: non-atomic job creation when RPC is not available."""
    insert_data: dict = {
        "company_id": str(company_id),
        "job_number": job_number,
        "address_line1": body.address_line1,
        "city": body.city,
        "state": body.state,
        "zip": body.zip,
        "loss_type": body.loss_type,
        "status": "new",
        "created_by": str(user_id),
    }

    optional_fields = [
        "property_id", "customer_name", "customer_phone", "customer_email",
        "loss_category", "loss_class", "loss_cause", "loss_date",
        "claim_number", "carrier", "adjuster_name", "adjuster_phone",
        "adjuster_email", "notes", "tech_notes",
    ]
    for field in optional_fields:
        value = getattr(body, field)
        if value is not None:
            if field == "property_id":
                insert_data[field] = str(value)
            elif field == "loss_date" and isinstance(value, date):
                insert_data[field] = value.isoformat()
            else:
                insert_data[field] = value

    result = await client.table("jobs").insert(insert_data).execute()
    if not result.data:
        raise AppException(
            status_code=500,
            detail="Failed to create job",
            error_code="JOB_CREATE_FAILED",
        )

    job_data = result.data[0]
    await log_event(
        company_id,
        "job_created",
        job_id=job_data["id"],
        user_id=user_id,
        event_data={"job_number": job_number},
    )
    return job_data


async def list_jobs(
    token: str,
    company_id: UUID,
    *,
    status: str | None = None,
    loss_type: str | None = None,
    search: str | None = None,
    limit: int = 20,
    offset: int = 0,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
) -> tuple[list[JobDetailResponse], int]:
    """List jobs with filtering, search, pagination, and sorting."""
    if sort_by not in VALID_SORT_FIELDS:
        sort_by = "created_at"
    desc = sort_dir.lower() != "asc"

    client = await get_authenticated_client(token)

    # Use PostgREST embedded counts to get photo/room/floor_plan/line_item
    # counts in a single query (no N+1).
    select_str = "*, job_rooms(count), photos(count), floor_plans(count)"

    query = (
        client.table("jobs")
        .select(select_str, count="exact")
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
    )

    if status:
        query = query.eq("status", status)
    if loss_type:
        query = query.eq("loss_type", loss_type)
    if search:
        safe_search = sanitize_postgrest_search(search)
        if safe_search:
            query = query.or_(
                f"address_line1.ilike.%{safe_search}%,"
                f"customer_name.ilike.%{safe_search}%,"
                f"job_number.ilike.%{safe_search}%,"
                f"city.ilike.%{safe_search}%,"
                f"carrier.ilike.%{safe_search}%,"
                f"claim_number.ilike.%{safe_search}%"
            )

    query = query.order(sort_by, desc=desc).range(offset, offset + limit - 1)
    result = await query.execute()

    total = result.count if result.count is not None else 0
    items = [_parse_job_detail_from_embedded(row) for row in (result.data or [])]

    return items, total


async def get_job(token: str, company_id: UUID, job_id: UUID) -> JobDetailResponse:
    """Get a single job with computed counts."""
    client = await get_authenticated_client(token)

    result = await (
        client.table("jobs")
        .select("*")
        .eq("id", str(job_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )

    if not result.data:
        raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")

    counts = await _get_job_counts(client, str(job_id))
    return _parse_job_detail(result.data, counts)


async def update_job(
    token: str,
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
    body: JobUpdate,
) -> JobDetailResponse:
    """Update a job. Only sends changed fields."""
    updates: dict = {}
    for key, value in body.model_dump(exclude_unset=True).items():
        if key == "property_id" and value is not None:
            updates[key] = str(value)
        elif key == "loss_date" and isinstance(value, date):
            updates[key] = value.isoformat()
        else:
            updates[key] = value

    if not updates:
        raise AppException(status_code=400, detail="No fields to update", error_code="NO_UPDATES")

    # Validate enum fields if present
    _validate_enums(
        loss_type=updates.get("loss_type"),
        loss_category=updates.get("loss_category"),
        loss_class=updates.get("loss_class"),
        status=updates.get("status"),
    )

    updates["updated_by"] = str(user_id)

    client = await get_authenticated_client(token)

    result = await (
        client.table("jobs")
        .update(updates)
        .eq("id", str(job_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .execute()
    )

    if not result.data:
        raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")

    job_data = result.data[0]

    await log_event(
        company_id,
        "job_updated",
        job_id=job_id,
        user_id=user_id,
        event_data={"updated_fields": list(updates.keys())},
    )

    counts = await _get_job_counts(client, str(job_id))
    return _parse_job_detail(job_data, counts)


async def delete_job(
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
) -> None:
    """Soft delete a job by setting deleted_at.

    Uses rpc_delete_job for atomic soft-delete + event logging.
    Falls back to non-atomic path if RPC is not available.
    """
    client = await get_supabase_admin_client()

    try:
        result = await client.rpc(
            "rpc_delete_job",
            {
                "p_job_id": str(job_id),
                "p_company_id": str(company_id),
                "p_user_id": str(user_id),
            },
        ).execute()

        # RPC returns boolean; supabase-py may wrap in a list
        rpc_result = result.data
        if isinstance(rpc_result, list):
            rpc_result = rpc_result[0] if rpc_result else False
        if not rpc_result:
            raise AppException(
                status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND"
            )
    except AppException:
        raise
    except Exception as e:
        error_msg = str(e).lower()
        is_rpc_missing = "rpc_delete_job" in error_msg and (
            "not found" in error_msg or "does not exist" in error_msg
            or "could not find" in error_msg
        )
        if is_rpc_missing:
            logger.info("rpc_delete_job not available, falling back to non-atomic path")
            await _delete_job_fallback(client, company_id, user_id, job_id)
        else:
            raise


async def _delete_job_fallback(
    client,
    company_id: UUID,
    user_id: UUID,
    job_id: UUID,
) -> None:
    """Fallback: non-atomic delete when RPC is not available."""
    now = datetime.now(UTC).isoformat()
    result = await (
        client.table("jobs")
        .update({"deleted_at": now, "updated_by": str(user_id)})
        .eq("id", str(job_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .execute()
    )

    if not result.data:
        raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")

    await log_event(
        company_id,
        "job_deleted",
        job_id=job_id,
        user_id=user_id,
    )
