"""Jobs CRUD service. All queries use the authenticated client (RLS-scoped)."""

import logging
import random
import re
import time
from datetime import UTC, date, datetime
from uuid import UUID

from postgrest.exceptions import APIError

from api.jobs.schemas import (
    JobBatchCreate,
    JobBatchResponse,
    JobBatchSummary,
    JobCreate,
    JobDetailResponse,
    JobUpdate,
    LinkedJobSummary,
)
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
    "scoping",
    "in_progress",
    "complete",
    "submitted",
    "collected",
}
VALID_SORT_FIELDS = {"created_at", "updated_at", "job_number", "customer_name"}
VALID_JOB_TYPES = {"mitigation", "reconstruction"}

# Which statuses are valid for each job type
MITIGATION_STATUSES = {
    "new",
    "contracted",
    "mitigation",
    "drying",
    "complete",
    "submitted",
    "collected",
}
RECONSTRUCTION_STATUSES = {
    "new",
    "scoping",
    "in_progress",
    "complete",
    "submitted",
    "collected",
}


EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_DIGITS_REGEX = re.compile(r"^\d{7,15}$")


def _validate_contact_fields(**kwargs: str | None) -> None:
    """Validate email and phone fields. Raises AppException on invalid values."""
    email_fields = ["customer_email", "adjuster_email"]
    phone_fields = ["customer_phone", "adjuster_phone"]

    for field in email_fields:
        val = kwargs.get(field)
        if val and not EMAIL_REGEX.match(val):
            raise AppException(
                status_code=400,
                detail=f"Invalid {field}: must be a valid email address",
                error_code="INVALID_EMAIL",
            )
    for field in phone_fields:
        val = kwargs.get(field)
        if val:
            digits = re.sub(r"[\s\-().+]", "", val)
            if not PHONE_DIGITS_REGEX.match(digits):
                raise AppException(
                    status_code=400,
                    detail=f"Invalid {field}: must contain 7-15 digits",
                    error_code="INVALID_PHONE",
                )


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


async def _generate_job_number(client, company_id: UUID, *, collision_offset: int = 0) -> str:
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
        "floor_plan_count": 0,  # reparented to property_id (Spec 01H)
        "line_item_count": 0,  # line_items table not created yet (Spec 02)
    }
    return _parse_job_detail(data, counts)


def _parse_job_detail(
    data: dict, counts: dict, linked_job_summary: LinkedJobSummary | None = None
) -> JobDetailResponse:
    """Parse a job row dict into JobDetailResponse with computed counts."""
    return JobDetailResponse(
        id=data["id"],
        company_id=data["company_id"],
        property_id=data.get("property_id"),
        job_type=data.get("job_type", "mitigation"),
        linked_job_id=data.get("linked_job_id"),
        linked_job_summary=linked_job_summary,
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
        home_year_built=data.get("home_year_built"),
        status=data["status"],
        floor_plan_id=data.get("floor_plan_id"),
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


async def _get_linked_job_summary(client, linked_job_id: str | None) -> LinkedJobSummary | None:
    """Fetch a minimal summary of the linked job (if any)."""
    if not linked_job_id:
        return None
    try:
        result = await (
            client.table("jobs")
            .select("id, job_number, job_type, status")
            .eq("id", linked_job_id)
            .is_("deleted_at", "null")
            .single()
            .execute()
        )
        if result.data:
            return LinkedJobSummary(**result.data)
    except Exception as e:
        logger.warning("Failed to fetch linked job %s: %s", linked_job_id, e)
    return None


async def _get_job_counts(client, job_id: str) -> dict:
    """Query counts of related entities for a job."""
    counts: dict[str, int] = {"floor_plan_count": 0, "line_item_count": 0}

    for table, key in [
        ("job_rooms", "room_count"),
        ("photos", "photo_count"),
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

    # Validate job_type
    if body.job_type not in VALID_JOB_TYPES:
        raise AppException(
            status_code=400,
            detail=f"Invalid job_type: must be one of {', '.join(sorted(VALID_JOB_TYPES))}",
            error_code="INVALID_JOB_TYPE",
        )

    client = await get_authenticated_client(token)
    admin_client = await get_supabase_admin_client()

    # Validate linked_job_id if provided and auto-copy fields
    linked_job_data: dict | None = None
    if body.linked_job_id:
        if body.job_type != "reconstruction":
            raise AppException(
                status_code=400,
                detail="Only reconstruction jobs can link to another job",
                error_code="INVALID_LINK_TYPE",
            )
        linked_result = await (
            client.table("jobs")
            .select("*")
            .eq("id", str(body.linked_job_id))
            .eq("company_id", str(company_id))
            .is_("deleted_at", "null")
            .execute()
        )
        if not linked_result.data:
            raise AppException(
                status_code=400,
                detail="Linked job not found in your company",
                error_code="LINKED_JOB_NOT_FOUND",
            )
        linked_job_data = linked_result.data[0]
        if linked_job_data.get("job_type") != "mitigation":
            raise AppException(
                status_code=400,
                detail="Can only link to a mitigation job",
                error_code="INVALID_LINK_TARGET",
            )

    # Auto-copy fields from linked job (only override fields the caller didn't explicitly set)
    if linked_job_data:
        COPY_FIELDS = [
            "claim_number",
            "carrier",
            "adjuster_name",
            "adjuster_phone",
            "adjuster_email",
            "customer_name",
            "customer_phone",
            "customer_email",
            "address_line1",
            "city",
            "state",
            "zip",
            "latitude",
            "longitude",
            "property_id",
            "loss_type",
            "loss_date",
        ]
        explicitly_set = body.model_fields_set
        for field in COPY_FIELDS:
            if field not in explicitly_set:
                linked_val = linked_job_data.get(field)
                if linked_val is not None:
                    # Parse date strings from PostgREST into Python date objects
                    if field == "loss_date" and isinstance(linked_val, str):
                        from datetime import date as date_type

                        try:
                            linked_val = date_type.fromisoformat(linked_val)
                        except ValueError:
                            linked_val = None
                    if linked_val is not None:
                        object.__setattr__(body, field, linked_val)

    # Validate AFTER auto-copy so copied fields are also validated
    _validate_enums(
        loss_type=body.loss_type,
        loss_category=body.loss_category,
        loss_class=body.loss_class,
    )
    _validate_contact_fields(
        customer_email=body.customer_email,
        customer_phone=body.customer_phone,
        adjuster_email=body.adjuster_email,
        adjuster_phone=body.adjuster_phone,
    )

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
            "p_job_type": body.job_type,
            "p_created_by": str(user_id),
            "p_property_id": opt_property_id,
            "p_linked_job_id": str(body.linked_job_id) if body.linked_job_id else None,
            "p_customer_name": body.customer_name,
            "p_customer_phone": body.customer_phone,
            "p_customer_email": body.customer_email,
            "p_loss_category": body.loss_category,
            "p_loss_class": body.loss_class,
            "p_loss_cause": body.loss_cause,
            "p_loss_date": opt_loss_date,
            "p_home_year_built": body.home_year_built,
            "p_claim_number": body.claim_number,
            "p_carrier": body.carrier,
            "p_adjuster_name": body.adjuster_name,
            "p_adjuster_phone": body.adjuster_phone,
            "p_adjuster_email": body.adjuster_email,
            "p_latitude": body.latitude,
            "p_longitude": body.longitude,
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
                "not found" in error_msg
                or "does not exist" in error_msg
                or "could not find" in error_msg
            )
            if is_rpc_missing:
                logger.info("rpc_create_job not available, falling back to non-atomic path")
                job_data = await _create_job_fallback(client, company_id, user_id, body, job_number)
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
    logger.info(
        "job_created",
        extra={
            "extra_data": {
                "job_id": str(job_data.get("id", "")),
                "job_number": job_data.get("job_number", ""),
                "duration_ms": duration_ms,
            }
        },
    )

    # Log job_linked event on both jobs if linked
    new_job_id = job_data.get("id")
    if body.linked_job_id and new_job_id:
        event_data = {
            "linked_job_id": str(body.linked_job_id),
            "new_job_id": str(new_job_id),
        }
        await log_event(
            company_id,
            "job_linked",
            job_id=UUID(str(new_job_id)),
            user_id=user_id,
            event_data=event_data,
        )
        await log_event(
            company_id,
            "job_linked",
            job_id=body.linked_job_id,
            user_id=user_id,
            event_data=event_data,
        )

    # Pre-populate default phases for reconstruction jobs (batch insert)
    if body.job_type == "reconstruction" and new_job_id:
        DEFAULT_RECON_PHASES = [
            "Demo Verification",
            "Drywall",
            "Paint",
            "Flooring",
            "Trim / Moldings",
            "Final Walkthrough",
        ]
        phase_rows = [
            {
                "job_id": str(new_job_id),
                "company_id": str(company_id),
                "phase_name": name,
                "sort_order": i,
                "status": "pending",
            }
            for i, name in enumerate(DEFAULT_RECON_PHASES)
        ]
        try:
            await client.table("recon_phases").insert(phase_rows).execute()
        except Exception as e:
            logger.error("Failed to insert default phases for job %s: %s", new_job_id, e)

    # Copy rooms from the linked job so the new job inherits its room list (and
    # matching floor-plan geometry via the property's current floor plan version).
    # Moisture readings, photos, equipment logs stay with the original job — only
    # the room definitions are cloned.
    room_count = 0
    if body.linked_job_id and new_job_id:
        copied = await _copy_rooms_from_linked_job(
            client=client,
            source_job_id=body.linked_job_id,
            new_job_id=UUID(str(new_job_id)),
            company_id=company_id,
        )
        room_count = copied

        # Inherit the parent's floor plan pin so the new recon job opens straight
        # to mitigation's current floor (no null floor_plan_id state, no UI
        # fallback). Recon's first canvas save will hit save_canvas Case 3
        # (pinned version is owned by mitigation, not recon) and correctly fork
        # a new version — the pre-pin doesn't change versioning, only the
        # initial UX so the floor selector shows mitigation's v1 immediately.
        parent_pin = linked_job_data.get("floor_plan_id") if linked_job_data else None
        if parent_pin:
            try:
                await (
                    client.table("jobs")
                    .update({"floor_plan_id": parent_pin})
                    .eq("id", str(new_job_id))
                    .execute()
                )
                # Reflect the pin in job_data so the response payload isn't null.
                job_data["floor_plan_id"] = parent_pin
            except APIError as e:
                # Non-fatal: the recon job is created and rooms are copied. Worst
                # case the user opens the floor plan with floor_plan_id=NULL and
                # their first save hits Case 1 (no pin) → forks v2 against
                # mitigation's existing v1 — same end state, just one extra step.
                logger.warning(
                    "Failed to inherit floor_plan_id from linked job %s to new job %s: %s",
                    body.linked_job_id,
                    new_job_id,
                    e.message,
                )

    counts = {
        "room_count": room_count,
        "photo_count": 0,
        "floor_plan_count": 0,
        "line_item_count": 0,
    }
    return _parse_job_detail(job_data, counts)


async def _copy_rooms_from_linked_job(
    client,
    source_job_id: UUID,
    new_job_id: UUID,
    company_id: UUID,
) -> int:
    """Copy each job_rooms row from source_job to new_job. Returns count copied.

    This is a workaround for the fact that the current schema crams two concerns
    into one table: the building's physical rooms (property-level reality) and
    each job's scope on those rooms (per-job state). A future refactor should
    split these into `property_rooms` (name, geometry, room_type, ceiling,
    floor_level, polygon) and `job_rooms` (water_category, equipment counts,
    affected, material_flags, notes, moisture_readings link).

    Until that split lands, we clone only the STRUCTURAL fields from the linked
    job. Per-job scope fields (water category, equipment, damage notes) must
    NOT carry over — the new job starts fresh on its own scope decisions.
    Moisture readings, equipment logs, and photos are per-job entities anyway
    (separate tables with job_id FK) and stay with the original job.
    """
    # Property-level fields only — the building's physical reality, safe to copy.
    # Intentionally excludes: water_category, water_class, dry_standard,
    # equipment_air_movers, equipment_dehus, affected, material_flags, notes,
    # room_sketch_data — those are mitigation's scope, not reconstruction's.
    #
    # C6 fix: `floor_plan_id` is also excluded. Post-container/versions merge,
    # that id points at a specific version row. If we copied it here, recon's
    # rooms would start life pinned to mitigation's frozen v1 — then recon's
    # first save_canvas would fork v2 and move the JOB's pin to v2, while the
    # rooms keep pointing at v1. The ROOM↔FLOOR-PLAN linkage would be desynced
    # from the JOB↔FLOOR-PLAN pin forever. Leaving it NULL lets recon's first
    # save use the normal versioning flow to link its rooms to the right row.
    COPY_FIELDS = [
        "room_name",
        "length_ft",
        "width_ft",
        "height_ft",
        "square_footage",
        "room_type",
        "ceiling_type",
        "floor_level",
        "room_polygon",
        "floor_openings",
        "custom_wall_sf",
        "sort_order",
    ]

    # W7: only return 0 for "source has no rooms" (legitimate). Fetch or
    # copy failures re-raise as AppException so the caller can distinguish
    # "nothing to copy" from "copy crashed." Previously both paths returned
    # 0 and the caller treated a broken recon-link as a silent no-op.
    try:
        source_rooms = await (
            client.table("job_rooms")
            .select(",".join(COPY_FIELDS))
            .eq("job_id", str(source_job_id))
            .eq("company_id", str(company_id))
            .execute()
        )
    except APIError as e:
        logger.error("Failed to fetch rooms from linked job %s: %s", source_job_id, e)
        raise AppException(
            status_code=500,
            detail=f"Failed to fetch source rooms: {e.message}",
            error_code="LINKED_ROOMS_FETCH_FAILED",
        )

    if not source_rooms.data:
        return 0

    new_rows = [
        {**row, "job_id": str(new_job_id), "company_id": str(company_id)}
        for row in source_rooms.data
    ]

    try:
        await client.table("job_rooms").insert(new_rows).execute()
        return len(new_rows)
    except APIError as e:
        logger.error(
            "Failed to copy %d rooms from %s to %s: %s",
            len(new_rows),
            source_job_id,
            new_job_id,
            e,
        )
        raise AppException(
            status_code=500,
            detail=f"Failed to copy rooms from linked job: {e.message}",
            error_code="LINKED_ROOMS_COPY_FAILED",
        )


async def create_linked_recon(
    token: str, company_id: UUID, user_id: UUID, source_job_id: UUID
) -> JobDetailResponse:
    """Convenience: create a reconstruction job linked to a mitigation job.

    Validates the source is a mitigation job, then delegates to create_job
    with linked_job_id set — which handles auto-copy, phases, and events.
    """
    client = await get_authenticated_client(token)
    result = await (
        client.table("jobs")
        .select("id, job_type, address_line1")
        .eq("id", str(source_job_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404, detail="Source job not found", error_code="JOB_NOT_FOUND"
        )
    if result.data.get("job_type") != "mitigation":
        raise AppException(
            status_code=400,
            detail="Can only create linked reconstruction from a mitigation job",
            error_code="INVALID_SOURCE_TYPE",
        )

    body = JobCreate(
        address_line1=result.data["address_line1"],
        job_type="reconstruction",
        linked_job_id=source_job_id,
    )
    return await create_job(token, company_id, user_id, body)


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
        "job_type": body.job_type,
        "status": "new",
        "created_by": str(user_id),
    }

    if body.linked_job_id:
        insert_data["linked_job_id"] = str(body.linked_job_id)

    optional_fields = [
        "property_id",
        "customer_name",
        "customer_phone",
        "customer_email",
        "loss_category",
        "loss_class",
        "loss_cause",
        "loss_date",
        "home_year_built",
        "claim_number",
        "carrier",
        "adjuster_name",
        "adjuster_phone",
        "adjuster_email",
        "latitude",
        "longitude",
        "notes",
        "tech_notes",
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
    job_type: str | None = None,
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
    # floor_plans no longer has job_id FK (reparented to property_id in Spec 01H)
    # Count floor plans via property_id join instead
    select_str = "*, job_rooms(count), photos(count)"

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
    if job_type:
        query = query.eq("job_type", job_type)
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
    """Get a single job with computed counts and linked job summary."""
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
    linked_summary = await _get_linked_job_summary(client, result.data.get("linked_job_id"))

    # Bidirectional resolution: if this is a mitigation job with no forward link,
    # check if any reconstruction job links TO this job
    if not linked_summary and result.data.get("job_type") == "mitigation":
        try:
            reverse = await (
                client.table("jobs")
                .select("id, job_number, job_type, status")
                .eq("linked_job_id", str(job_id))
                .is_("deleted_at", "null")
                .limit(1)
                .execute()
            )
            if reverse.data:
                linked_summary = LinkedJobSummary(**reverse.data[0])
        except Exception as e:
            logger.warning("Failed reverse link lookup for job %s: %s", job_id, e)

    return _parse_job_detail(result.data, counts, linked_summary)


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
    _validate_contact_fields(
        customer_email=updates.get("customer_email"),
        customer_phone=updates.get("customer_phone"),
        adjuster_email=updates.get("adjuster_email"),
        adjuster_phone=updates.get("adjuster_phone"),
    )

    updates["updated_by"] = str(user_id)

    client = await get_authenticated_client(token)

    # Validate status against job type if status is being changed
    if "status" in updates:
        current = await (
            client.table("jobs")
            .select("job_type")
            .eq("id", str(job_id))
            .eq("company_id", str(company_id))
            .is_("deleted_at", "null")
            .single()
            .execute()
        )
        if current.data:
            jtype = current.data.get("job_type", "mitigation")
            allowed = MITIGATION_STATUSES if jtype == "mitigation" else RECONSTRUCTION_STATUSES
            if updates["status"] not in allowed:
                raise AppException(
                    status_code=400,
                    detail=f"Status '{updates['status']}' is not valid for {jtype} jobs",
                    error_code="INVALID_STATUS_FOR_TYPE",
                )

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
            raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")
    except AppException:
        raise
    except Exception as e:
        error_msg = str(e).lower()
        is_rpc_missing = "rpc_delete_job" in error_msg and (
            "not found" in error_msg
            or "does not exist" in error_msg
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


# ---------------------------------------------------------------------------
# Spec 01I: POST /v1/jobs/batch — atomic Quick Add Active Jobs
# ---------------------------------------------------------------------------

# UI-label → backend-enum map. The Quick Add dropdown shows contractor
# friendly labels; the DB already migrated past 'needs_scope/scoped/submitted'
# to the 7-stage pipeline, so map onto those equivalents.
#
# Spec 01I § "Job status mapping":
#   Lead       -> new       (default if omitted)
#   Scoped     -> mitigation (matches the 49e2a91b6ebb migration's mapping)
#   Submitted  -> submitted
#
# Pass-through is also accepted: if the caller sends an enum value that's
# already in VALID_STATUSES, we trust it.
_UI_STATUS_LABEL_TO_ENUM: dict[str, str] = {
    "lead": "new",
    "scoped": "mitigation",
    "submitted": "submitted",
}


def _normalize_batch_status(raw: str | None) -> str:
    """Translate UI labels and enum values into the backend status enum.

    Returns 'new' when ``raw`` is None / empty (the SQL default). Raises
    AppException(400) on an unrecognized value rather than silently
    coercing.
    """
    if raw is None:
        return "new"
    s = str(raw).strip()
    if not s:
        return "new"
    lowered = s.lower()
    if lowered in _UI_STATUS_LABEL_TO_ENUM:
        return _UI_STATUS_LABEL_TO_ENUM[lowered]
    if s in VALID_STATUSES:
        return s
    raise AppException(
        status_code=400,
        detail=(
            f"Invalid status '{raw}'. Use a UI label "
            f"({', '.join(sorted(_UI_STATUS_LABEL_TO_ENUM))}) or an enum value "
            f"({', '.join(sorted(VALID_STATUSES))})."
        ),
        error_code="INVALID_STATUS",
    )


async def create_jobs_batch(
    company_id: UUID,
    user_id: UUID,
    body: JobBatchCreate,
) -> JobBatchResponse:
    """Create up to 10 jobs atomically (Spec 01I Quick Add Active Jobs).

    Delegates to ``rpc_create_jobs_batch`` (migration 01i_a6_jobs_batch),
    which executes the whole batch in one plpgsql transaction. If any
    row violates a constraint, all rows roll back — that's the spec's
    "all-or-nothing" guarantee.

    Pre-RPC validation here keeps the SQL function focused on the atomic
    write. Status normalization, loss-type validation, and contact-field
    validation are done in Python so the user gets a clean 400 instead
    of an opaque 23514.
    """
    # Validate + normalize each item up front. Cheap, fail-fast, and
    # keeps the error response shape consistent with POST /v1/jobs.
    payload: list[dict] = []
    for idx, item in enumerate(body.jobs):
        # Enum + contact validation matches the single-create path so
        # batch and one-by-one share their failure surface.
        _validate_enums(loss_type=item.loss_type)
        _validate_contact_fields(customer_phone=item.customer_phone)

        if item.job_type not in VALID_JOB_TYPES:
            raise AppException(
                status_code=400,
                detail=(
                    f"jobs[{idx}].job_type: must be one of {', '.join(sorted(VALID_JOB_TYPES))}"
                ),
                error_code="INVALID_JOB_TYPE",
            )

        normalized_status = _normalize_batch_status(item.status)

        payload.append(
            {
                "address_line1": item.address_line1,
                "city": item.city or "",
                "state": item.state or "",
                "zip": item.zip or "",
                "customer_name": item.customer_name,
                "customer_phone": item.customer_phone,
                "loss_type": item.loss_type,
                "job_type": item.job_type,
                "status": normalized_status,
            }
        )

    admin_client = await get_supabase_admin_client()

    try:
        result = await admin_client.rpc(
            "rpc_create_jobs_batch",
            {
                "p_company_id": str(company_id),
                "p_user_id": str(user_id),
                "p_jobs": payload,
            },
        ).execute()
    except AppException:
        raise
    except Exception as e:
        # Pre-launch: surface the SQL error so the spec author can
        # diagnose. Once stable we'll narrow this to mapped error codes.
        logger.error("rpc_create_jobs_batch failed: %s", e)
        raise AppException(
            status_code=500,
            detail=f"Batch create failed: {e}",
            error_code="JOB_BATCH_CREATE_FAILED",
        )

    rpc_data = result.data
    if isinstance(rpc_data, list):
        rpc_data = rpc_data[0] if rpc_data else None
    if not isinstance(rpc_data, dict) or "jobs" not in rpc_data:
        raise AppException(
            status_code=500,
            detail="Batch RPC returned unexpected payload",
            error_code="JOB_BATCH_BAD_RESPONSE",
        )

    summaries = [
        JobBatchSummary(job_id=UUID(row["job_id"]), job_number=row["job_number"])
        for row in rpc_data.get("jobs", [])
    ]
    return JobBatchResponse(created=int(rpc_data.get("created", len(summaries))), jobs=summaries)
