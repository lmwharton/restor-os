"""Share links service: create, list, revoke, and resolve share tokens.

Tokens are 32-char hex strings. Only the SHA-256 hash is stored in the database.
The raw token is returned once on creation and never stored.
"""

import hashlib
import logging
import secrets
import time
from datetime import UTC, datetime, timedelta
from uuid import UUID

from postgrest.exceptions import APIError
from supabase import AsyncClient

from api.config import settings
from api.shared.database import get_supabase_admin_client
from api.shared.events import log_event
from api.shared.exceptions import AppException
from api.sharing.schemas import VALID_SCOPES, ShareLinkCreate

# PostgREST / Postgres error codes we tolerate silently on optional
# sub-queries — the cluster is misconfigured or the schema is
# pre-migration, and the caller still deserves photos + line items even
# if a moisture sub-query fails. All other APIErrors log AND re-raise
# so ops has something to chase. Don't drop one of these thinking it's
# redundant — they cover three distinct schema-cache / migration-state
# failure modes that all surface as "table or column not findable":
#
#   PGRST205 — PostgREST: "Could not find the table in the schema cache"
#              (table genuinely missing, or schema cache stale post-migration)
#   PGRST204 — PostgREST: "Could not find the column in the schema cache"
#              (column dropped, or post-rename cache miss)
#   42P01    — Postgres SQLSTATE: undefined_table (relation does not exist
#              at the database level — older migration state on this cluster)
_POSTGREST_MISSING_TABLE_CODES = {"PGRST205", "PGRST204", "42P01"}

# Public-payload allowlists for the unauthenticated adjuster portal
# (`GET /v1/shared/{token}`). Hoisted to module level so they're
# importable for unit tests — the test layer can assert PII columns
# are absent without needing the (mock) DB to honor PostgREST's
# `.select()` filtering. See `pr-review-lessons.md` lesson #35.
#
# Excluded by design:
#   * jobs: customer_phone / customer_email / claim_number (PII),
#     adjuster_* (carrier-side contact), notes / tech_notes
#     (tech-internal observations), loss_cause (free-text often
#     contains private context), home_year_built / latitude /
#     longitude (locational privacy), assigned_to / created_by /
#     updated_by (tech UUIDs — combined with multiple shares would
#     enumerate the company's roster), linked_job_id / job_type
#     (internal workflow state).
#   * job_rooms: notes (tech-internal), room_sketch_data /
#     room_polygon / floor_openings / wall_square_footage /
#     custom_wall_sf / material_flags (V2 sketch internals),
#     dry_standard / room_type / ceiling_type / floor_level /
#     affected (workflow internals), company_id / created_by /
#     updated_by (tech UUIDs).
#   * photos: company_id, filename (tech-named, can leak job-internal
#     labels), selected_for_ai (internal AI scoping flag),
#     created_by / updated_by.
#   * line_items: table doesn't exist yet (Spec 02); when it lands,
#     every column added must be intentionally adjuster-visible.
_PUBLIC_JOB_COLUMNS = (
    "id, company_id, property_id, job_number, address_line1, city, state, zip, "
    "customer_name, carrier, loss_type, loss_category, loss_class, loss_date, "
    "status, floor_plan_id, timezone, created_at, updated_at"
)
_PUBLIC_ROOM_COLUMNS = (
    "id, job_id, floor_plan_id, room_name, length_ft, width_ft, height_ft, "
    "square_footage, water_category, water_class, equipment_air_movers, "
    "equipment_dehus, sort_order, created_at, updated_at"
)
_PUBLIC_PHOTO_COLUMNS = (
    "id, job_id, room_id, room_name, storage_url, caption, photo_type, uploaded_at"
)
_PUBLIC_LINE_ITEM_COLUMNS = (
    "id, job_id, room_id, code, description, units, quantity, "
    "unit_price, total, created_at"
)

logger = logging.getLogger(__name__)


def _hash_token(token: str) -> str:
    """SHA-256 hash a share token."""
    return hashlib.sha256(token.encode()).hexdigest()


async def create_share_link(
    client: AsyncClient,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: ShareLinkCreate,
) -> dict:
    """Create a share link with a random token. Returns the raw token (shown once).

    Uses rpc_create_share_link for atomic insert + event logging.
    Falls back to non-atomic path if RPC is not available.
    """
    start = time.perf_counter()

    if body.scope not in VALID_SCOPES:
        raise AppException(
            status_code=400,
            detail=f"Invalid scope. Must be one of: {', '.join(sorted(VALID_SCOPES))}",
            error_code="INVALID_SCOPE",
        )

    raw_token = secrets.token_hex(16)  # 32-char hex
    token_hash = _hash_token(raw_token)
    expires_at = datetime.now(UTC) + timedelta(days=body.expires_days)

    admin = await get_supabase_admin_client()
    try:
        result = await admin.rpc(
            "rpc_create_share_link",
            {
                "p_job_id": str(job_id),
                "p_company_id": str(company_id),
                "p_created_by": str(user_id),
                "p_token_hash": token_hash,
                "p_scope": body.scope,
                "p_expires_at": expires_at.isoformat(),
            },
        ).execute()

        link_data = result.data
        if isinstance(link_data, list):
            link_data = link_data[0] if link_data else {}
        link = link_data if isinstance(link_data, dict) else {}
    except Exception as e:
        error_msg = str(e).lower()
        is_rpc_missing = "rpc_create_share_link" in error_msg and (
            "not found" in error_msg
            or "does not exist" in error_msg
            or "could not find" in error_msg
        )
        if is_rpc_missing:
            logger.info("rpc_create_share_link not available, falling back to non-atomic path")
            link = await _create_share_link_fallback(
                client, job_id, company_id, user_id, body, token_hash, expires_at
            )
        else:
            raise

    # Build the public share URL
    base_url = getattr(settings, "frontend_url", "https://crewmaticai.vercel.app")
    share_url = f"{base_url}/shared/{raw_token}"

    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info(
        "share_link_created",
        extra={
            "extra_data": {
                "job_id": str(job_id),
                "scope": body.scope,
                "expires_days": body.expires_days,
                "duration_ms": duration_ms,
            }
        },
    )

    return {
        "share_url": share_url,
        "share_token": raw_token,
        "expires_at": link.get("expires_at", expires_at.isoformat()),
    }


async def _create_share_link_fallback(
    client: AsyncClient,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: ShareLinkCreate,
    token_hash: str,
    expires_at: datetime,
) -> dict:
    """Fallback: non-atomic share link creation when RPC is not available.

    Audit-trail caveat: ``log_event`` is intentionally fire-and-forget
    (``api/shared/events.py`` swallows on failure to avoid taking the
    primary operation down with it). On the atomic path
    (``rpc_create_share_link``) the audit row is inserted inside the
    same SECURITY DEFINER function as the share-link row, so they
    succeed-or-fail together. Here they don't — if ``log_event``
    fails after the insert lands, the share link exists with no audit
    record. We surface a loud warning so ops can correlate it after
    the fact, but we deliberately don't roll the insert back: a
    missing audit row is preferable to a dropped share link the user
    has already seen the URL for. This branch only fires on
    pre-migration deploy states (RPC not installed yet), so the
    window is narrow.
    """
    row = {
        "job_id": str(job_id),
        "company_id": str(company_id),
        "created_by": str(user_id),
        "token_hash": token_hash,
        "scope": body.scope,
        "expires_at": expires_at.isoformat(),
    }
    result = await client.table("share_links").insert(row).execute()
    link = result.data[0]

    logger.warning(
        "share_link_created_via_fallback_path",
        extra={
            "extra_data": {
                "link_id": link["id"],
                "job_id": str(job_id),
                "scope": body.scope,
                "reason": "rpc_create_share_link not installed; audit "
                "trail is best-effort on this path",
            }
        },
    )

    await log_event(
        company_id,
        "share_link_created",
        job_id=job_id,
        user_id=user_id,
        event_data={"link_id": link["id"], "scope": body.scope, "expires_days": body.expires_days},
    )

    return link


async def list_share_links(
    client: AsyncClient,
    job_id: UUID,
) -> dict:
    """List all share links for a job (including revoked, for audit trail).

    Returns {"items": [...], "total": N}.
    """
    result = await (
        client.table("share_links")
        .select("id, scope, expires_at, revoked_at, created_at", count="exact")
        .eq("job_id", str(job_id))
        .order("created_at", desc=True)
        .execute()
    )
    items = result.data or []
    total = result.count if isinstance(result.count, int) else len(items)
    return {"items": items, "total": total}


async def revoke_share_link(
    client: AsyncClient,
    job_id: UUID,
    link_id: UUID,
    company_id: UUID,
    user_id: UUID,
) -> None:
    """Revoke a share link by setting revoked_at."""
    result = await (
        client.table("share_links")
        .update({"revoked_at": datetime.now(UTC).isoformat()})
        .eq("id", str(link_id))
        .eq("job_id", str(job_id))
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Share link not found",
            error_code="SHARE_LINK_NOT_FOUND",
        )

    await log_event(
        company_id,
        "share_link_revoked",
        job_id=job_id,
        user_id=user_id,
        event_data={"link_id": str(link_id)},
    )


async def get_shared_job(token: str) -> dict:
    """Resolve a share token and return scoped job data.

    Uses admin client because this is a public (no-auth) endpoint.
    Validates the token is not expired or revoked.
    """
    start = time.perf_counter()
    token_hash = _hash_token(token)
    admin = await get_supabase_admin_client()

    # Look up the share link by token hash
    result = await (
        admin.table("share_links").select("*").eq("token_hash", token_hash).single().execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Share link not found",
            error_code="SHARE_NOT_FOUND",
        )

    link = result.data

    # Check revoked
    if link.get("revoked_at"):
        raise AppException(
            status_code=403,
            detail="This share link has been revoked",
            error_code="SHARE_REVOKED",
        )

    # Check expired
    expires_at = datetime.fromisoformat(link["expires_at"].replace("Z", "+00:00"))
    if expires_at < datetime.now(UTC):
        raise AppException(
            status_code=403,
            detail="This share link has expired",
            error_code="SHARE_EXPIRED",
        )

    job_id = link["job_id"]
    company_id = link["company_id"]
    scope = link.get("scope", "full")

    # Fetch job — explicit allowlist instead of `SELECT *` + pop
    # blacklist. The allowlist constants live at module level (see top
    # of file) so test code can assert PII columns are excluded.
    job_result = await (
        admin.table("jobs").select(_PUBLIC_JOB_COLUMNS).eq("id", job_id).single().execute()
    )
    if not job_result.data:
        raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")

    job = job_result.data

    rooms_result = await (
        admin.table("job_rooms")
        .select(_PUBLIC_ROOM_COLUMNS)
        .eq("job_id", job_id)
        .order("sort_order")
        .execute()
    )
    rooms = rooms_result.data or []

    photos_result = await (
        admin.table("photos")
        .select(_PUBLIC_PHOTO_COLUMNS)
        .eq("job_id", job_id)
        .order("uploaded_at")
        .execute()
    )
    photos = photos_result.data or []
    storage_paths = [p["storage_url"] for p in photos if p.get("storage_url")]
    if storage_paths:
        signed_results = await admin.storage.from_("photos").create_signed_urls(storage_paths, 3600)
        url_map = {
            item.get("path", ""): item.get("signedURL") or item.get("signedUrl") or ""
            for item in signed_results
        }
    else:
        url_map = {}
    for photo in photos:
        photo["signed_url"] = url_map.get(photo.get("storage_url", ""), "")

    # Moisture pins + readings. Scope-gated so `photos_only` stays lean.
    # Spec 01H Phase 2C (Brett §8.6): the adjuster portal renders a
    # moisture report showing every pin's full reading history on a
    # user-selected date; shipping both pins and their readings in the
    # shared payload lets the portal route render without any
    # follow-up queries.
    moisture_pins: list[dict] = []
    floor_plans: list[dict] = []
    # Track when a moisture-scope query hit a tolerated "table missing"
    # code — lets us surface "temporarily unavailable" to the adjuster
    # instead of the generic "no readings logged yet" empty state, and
    # gives ops a specific signal to chase.
    moisture_unavailable = False
    if scope in ("full", "restoration_only"):
        try:
            # Allowlist on the readings embed — `notes` (tech-authored,
            # 2000 chars) and `recorded_by` (tech UUID) shouldn't ride
            # to adjusters. Combined with `jobs.created_by` /
            # `assigned_to` across multiple shares, recorded_by could
            # enumerate the tech roster. Pin columns stay on `*` since
            # MoisturePin's user-facing fields (location_name,
            # canvas_x/y, material, dry_standard) are all spec'd as
            # adjuster-visible; `created_by` on pins is the same risk
            # but the portal's report header references it nowhere
            # currently — flag for follow-up if it surfaces.
            pins_result = await (
                admin.table("moisture_pins")
                .select(
                    "*, "
                    "readings:moisture_pin_readings("
                    "id, pin_id, reading_value, taken_at, meter_photo_url, created_at"
                    "), "
                    "room:job_rooms!room_id(floor_plan_id)",
                )
                .eq("job_id", job_id)
                .eq("company_id", company_id)
                .order("created_at", desc=False)
                .order(
                    "taken_at",
                    desc=True,
                    foreign_table="readings",
                )
                .limit(500, foreign_table="readings")
                .execute()
            )
            # Flatten the room embed into a scalar `floor_plan_id` on
            # each pin so the portal wrapper can filter without a
            # secondary join. Same shape as list_pins_by_job.
            moisture_pins = []
            for pin in pins_result.data or []:
                room_embed = pin.pop("room", None)
                if isinstance(room_embed, list):
                    room_embed = room_embed[0] if room_embed else None
                pin["floor_plan_id"] = (
                    room_embed.get("floor_plan_id")
                    if room_embed
                    else None
                )
                moisture_pins.append(pin)
        except APIError as e:
            # Pre-Phase-2 DBs lack moisture_pins; tolerate that but log
            # every failure so an empty moisture_pins[] in a supposedly
            # in-scope share is attributable (pr-review-lessons #2).
            if getattr(e, "code", None) in _POSTGREST_MISSING_TABLE_CODES:
                logger.warning(
                    "shared_resolve: moisture_pins table missing "
                    "(job_id=%s scope=%s code=%s) — returning empty",
                    job_id,
                    scope,
                    getattr(e, "code", None),
                )
                moisture_unavailable = True
            else:
                logger.exception(
                    "shared_resolve: moisture_pins query failed "
                    "(job_id=%s scope=%s)",
                    job_id,
                    scope,
                )
                raise

        # ALL current floor plans for the job's property — the portal's
        # moisture report needs every floor the job touches, not just
        # the single row pinned via jobs.floor_plan_id. Multi-floor
        # jobs (basement / main / upper / attic) ship pins across
        # floors; rendering only one floor drops the rest silently.
        # Scope by property_id so sibling jobs on the same property
        # don't leak their floors into this report.
        prop_id = job.get("property_id")
        if prop_id:
            try:
                # Defense-in-depth: property_id is already tenant-scoped
                # (properties belong to exactly one company), but the
                # admin client bypasses RLS, so adding company_id guards
                # against a future data-ops bug where a property gets
                # re-parented. Not currently exploitable; cheap to add.
                fps_res = await (
                    admin.table("floor_plans")
                    .select(
                        "id, floor_number, floor_name, canvas_data, "
                        "is_current, property_id",
                    )
                    .eq("property_id", prop_id)
                    .eq("company_id", company_id)
                    .eq("is_current", True)
                    .order("floor_number", desc=False)
                    .execute()
                )
                floor_plans = fps_res.data or []
            except APIError as e:
                if getattr(e, "code", None) in _POSTGREST_MISSING_TABLE_CODES:
                    logger.warning(
                        "shared_resolve: floor_plans table missing "
                        "(job_id=%s scope=%s code=%s) — returning empty",
                        job_id,
                        scope,
                        getattr(e, "code", None),
                    )
                    moisture_unavailable = True
                else:
                    logger.exception(
                        "shared_resolve: floor_plans query failed "
                        "(job_id=%s scope=%s)",
                        job_id,
                        scope,
                    )
                    raise

    # Fetch line items (if they exist). Same narrowed-except shape as
    # the moisture_pins + floor_plans blocks above — tolerate the
    # "table missing" PGRST codes silently (for pre-Phase-N DBs), but
    # log + re-raise anything else so an empty `line_items` is never
    # attributable-to-nothing. Previously this was a bare `except
    # Exception: pass` — siblings of the H2 fix landed but this one
    # was missed, flagged in review round 2.
    # line_items allowlist hoisted to module level. Pre-Spec-02 the
    # table doesn't exist and this query falls through to the
    # PGRST205-tolerated branch; the explicit column list documents
    # the public contract for Spec 02 to honor.
    line_items: list[dict] = []
    if scope in ("full", "restoration_only"):
        try:
            items_result = await (
                admin.table("line_items")
                .select(_PUBLIC_LINE_ITEM_COLUMNS)
                .eq("job_id", job_id)
                .execute()
            )
            line_items = items_result.data or []
        except APIError as e:
            if getattr(e, "code", None) in _POSTGREST_MISSING_TABLE_CODES:
                logger.warning(
                    "shared_resolve: line_items table missing "
                    "(job_id=%s scope=%s code=%s) — returning empty",
                    job_id,
                    scope,
                    getattr(e, "code", None),
                )
            else:
                logger.exception(
                    "shared_resolve: line_items query failed "
                    "(job_id=%s scope=%s)",
                    job_id,
                    scope,
                )
                raise

    # Fetch company info (public fields only)
    company_result = await (
        admin.table("companies")
        .select("name, phone, logo_url")
        .eq("id", company_id)
        .single()
        .execute()
    )
    company = company_result.data or {}

    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info(
        "share_link_resolved",
        extra={
            "extra_data": {
                "job_id": job_id,
                "scope": scope,
                "photo_count": len(photos),
                "duration_ms": duration_ms,
            }
        },
    )

    # Moisture-access discriminant — collapses four distinct "empty"
    # states into one value the portal can branch on. Previously the
    # portal saw moisture_pins=[] and guessed; now it knows which of
    # {scope-denied, backend-unavailable, not-yet-logged, present}
    # applies so the empty-state copy can match the cause.
    if scope not in ("full", "restoration_only"):
        moisture_access = "denied"
    elif moisture_unavailable:
        moisture_access = "unavailable"
    elif not floor_plans or not moisture_pins:
        moisture_access = "empty"
    else:
        moisture_access = "present"

    return {
        "job": job,
        "rooms": rooms,
        "photos": photos,
        "line_items": line_items,
        "moisture_pins": moisture_pins,
        "floor_plans": floor_plans,
        "company": company,
        "moisture_access": moisture_access,
        # Scope-gated alongside moisture_pins + floor_plans. A
        # photos_only adjuster shouldn't see the moisture primary
        # floor pointer even though a UUID is opaque — the field
        # semantically belongs to the restoration scope.
        "primary_floor_id": (
            job.get("floor_plan_id")
            if scope in ("full", "restoration_only")
            else None
        ),
        # Round-2 H2 — hoist the job's IANA timezone to the response top
        # level so the adjuster portal can bucket days in the job's TZ
        # instead of the viewer's browser TZ. NOT scope-gated — timezone
        # is operational metadata, not customer-sensitive. Default
        # matches jobs.timezone's DB default for the unusual case where
        # an older row is missing the column.
        "timezone": job.get("timezone") or "America/New_York",
    }
