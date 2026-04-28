import logging
import random
import re
import string
from datetime import UTC, datetime
from uuid import UUID

from api.auth.schemas import (
    ONBOARDING_STEP_ORDER,
    CompanyResponse,
    CompanyUpdate,
    JobResponse,
    OnboardingStatusResponse,
    UserResponse,
    UserUpdate,
)
from api.shared.database import get_supabase_admin_client
from api.shared.exceptions import AppException

logger = logging.getLogger(__name__)


def _slugify(name: str) -> str:
    """Convert a company name to a URL-friendly slug with a random suffix.

    Example: "DryPros LLC" -> "drypros-llc-a7k2"
    """
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s-]+", "-", slug)
    slug = slug.strip("-")
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"{slug}-{suffix}"


def _parse_company(data: dict) -> CompanyResponse:
    return CompanyResponse(
        id=data["id"],
        name=data["name"],
        slug=data["slug"],
        phone=data.get("phone"),
        email=data.get("email"),
        logo_url=data.get("logo_url"),
        address=data.get("address"),
        city=data.get("city"),
        state=data.get("state"),
        zip=data.get("zip"),
        service_area=data.get("service_area"),
        subscription_tier=data.get("subscription_tier", "free"),
        created_at=data["created_at"],
        updated_at=data["updated_at"],
    )


def _parse_user(data: dict, company: CompanyResponse | None = None) -> UserResponse:
    return UserResponse(
        id=data["id"],
        email=data["email"],
        name=data["name"],
        first_name=data.get("first_name"),
        last_name=data.get("last_name"),
        phone=data.get("phone"),
        avatar_url=data.get("avatar_url"),
        title=data.get("title"),
        role=data["role"],
        is_platform_admin=data.get("is_platform_admin", False),
        company=company,
    )


async def get_user_with_company(auth_user_id: UUID) -> UserResponse | None:
    """Look up user by auth_user_id, include company data. Returns None if not found."""
    client = await get_supabase_admin_client()

    try:
        result = await (
            client.table("users")
            .select("*, companies(*)")
            .eq("auth_user_id", str(auth_user_id))
            .is_("deleted_at", "null")
            .maybe_single()
            .execute()
        )
    except (OSError, ValueError, RuntimeError) as e:
        logger.warning("Failed to fetch user %s: %s", auth_user_id, e)
        return None

    if not result or not result.data:
        return None

    user_data = result.data
    if not user_data:
        return None

    company = None
    if user_data.get("companies"):
        company = _parse_company(user_data["companies"])

    return _parse_user(user_data, company)


async def get_or_create_company(
    auth_user_id: UUID,
    name: str,
    phone: str | None,
    email: str,
    user_name: str,
    avatar_url: str | None,
    *,
    address: str | None = None,
    city: str | None = None,
    state: str | None = None,
    zip_code: str | None = None,
    service_area: list[str] | None = None,
) -> tuple[CompanyResponse, UserResponse]:
    """Onboarding flow: create company + user atomically.

    Uses ``rpc_onboard_user`` (extended in Spec 01I to accept the full
    company profile) for atomic creation with an advisory lock. Falls
    back to a non-atomic path if the RPC is missing.

    Address fields and ``service_area`` are optional so existing call
    sites that pre-date Spec 01I (which collected only name + phone)
    still work — they simply pass through as NULL.
    """
    client = await get_supabase_admin_client()

    # Split name into first/last
    name_parts = user_name.strip().split(" ", 1)
    first_name = name_parts[0] if name_parts else user_name
    last_name = name_parts[1] if len(name_parts) > 1 else None

    slug = _slugify(name)

    try:
        result = await client.rpc(
            "rpc_onboard_user",
            {
                "p_auth_user_id": str(auth_user_id),
                "p_email": email,
                "p_name": user_name,
                "p_first_name": first_name,
                "p_last_name": last_name,
                "p_avatar_url": avatar_url,
                "p_company_name": name,
                "p_company_phone": phone,
                "p_company_slug": slug,
                "p_company_address": address,
                "p_company_city": city,
                "p_company_state": state,
                "p_company_zip": zip_code,
                "p_service_area": service_area,
            },
        ).execute()

        rpc_data = result.data
        if isinstance(rpc_data, list):
            rpc_data = rpc_data[0] if rpc_data else None

        if not rpc_data:
            raise AppException(
                status_code=500,
                detail="Failed to create company",
                error_code="COMPANY_CREATE_FAILED",
            )

        company = _parse_company(rpc_data["company"])
        user = _parse_user(rpc_data["user"], company)

        # Spec 01K: seed default closeout-gate settings for the brand-new
        # company so the closeout-checklist modal works on day one. Best-effort
        # — if this fails, the modal will show empty gates which is recoverable
        # via /settings/closeout, but onboarding should not fail because of it.
        try:
            await client.rpc(
                "rpc_seed_closeout_settings",
                {"p_company_id": str(company.id)},
            ).execute()
        except Exception as seed_err:
            logger.warning(
                "rpc_seed_closeout_settings failed for company %s: %s — owner can "
                "trigger reset from /settings/closeout to recover",
                company.id,
                seed_err,
            )

        return company, user

    except AppException:
        raise
    except Exception as e:
        error_msg = str(e).lower()
        is_rpc_missing = "rpc_onboard_user" in error_msg and (
            "not found" in error_msg
            or "does not exist" in error_msg
            or "could not find" in error_msg
        )
        if is_rpc_missing:
            logger.info("rpc_onboard_user not available, falling back to non-atomic path")
            return await _onboard_user_fallback(
                client,
                auth_user_id,
                name,
                phone,
                email,
                user_name,
                avatar_url,
                slug,
                first_name,
                last_name,
                address=address,
                city=city,
                state=state,
                zip_code=zip_code,
                service_area=service_area,
            )
        raise


async def _onboard_user_fallback(
    client,
    auth_user_id: UUID,
    name: str,
    phone: str | None,
    email: str,
    user_name: str,
    avatar_url: str | None,
    slug: str,
    first_name: str,
    last_name: str | None,
    *,
    address: str | None = None,
    city: str | None = None,
    state: str | None = None,
    zip_code: str | None = None,
    service_area: list[str] | None = None,
) -> tuple[CompanyResponse, UserResponse]:
    """Fallback: non-atomic onboarding when RPC is not available."""
    # Check if user already has a company
    existing = await (
        client.table("users")
        .select("*, companies(*)")
        .eq("auth_user_id", str(auth_user_id))
        .is_("deleted_at", "null")
        .maybe_single()
        .execute()
    )

    existing_data = existing.data if existing else None
    if existing_data and existing_data.get("company_id") and existing_data.get("companies"):
        company = _parse_company(existing_data["companies"])
        user = _parse_user(existing_data, company)
        return company, user

    # Create company with full profile (None values are fine — DB columns
    # are nullable except name/slug).
    company_insert: dict = {
        "name": name,
        "slug": slug,
        "phone": phone,
        "email": email,
    }
    if address is not None:
        company_insert["address"] = address
    if city is not None:
        company_insert["city"] = city
    if state is not None:
        company_insert["state"] = state
    if zip_code is not None:
        company_insert["zip"] = zip_code
    if service_area is not None:
        company_insert["service_area"] = service_area

    company_result = await client.table("companies").insert(company_insert).execute()

    if not company_result.data:
        raise AppException(
            status_code=500,
            detail="Failed to create company",
            error_code="COMPANY_CREATE_FAILED",
        )

    company_data = company_result.data[0]
    company = _parse_company(company_data)

    # Create or update user
    if existing_data:
        user_result = await (
            client.table("users")
            .update(
                {
                    "company_id": str(company.id),
                    "name": user_name,
                    "first_name": first_name,
                    "last_name": last_name,
                    "avatar_url": avatar_url,
                    "role": "owner",
                }
            )
            .eq("id", existing_data["id"])
            .execute()
        )
    else:
        user_result = await (
            client.table("users")
            .insert(
                {
                    "auth_user_id": str(auth_user_id),
                    "company_id": str(company.id),
                    "email": email,
                    "name": user_name,
                    "first_name": first_name,
                    "last_name": last_name,
                    "avatar_url": avatar_url,
                    "role": "owner",
                }
            )
            .execute()
        )

    if not user_result.data:
        raise AppException(
            status_code=500,
            detail="Failed to create user",
            error_code="USER_CREATE_FAILED",
        )

    user = _parse_user(user_result.data[0], company)
    return company, user


async def list_jobs(company_id: UUID) -> list[JobResponse]:
    """List all active jobs for a company. Returns empty list for new companies."""
    client = await get_supabase_admin_client()

    result = await (
        client.table("jobs")
        .select("*")
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )

    if not result.data:
        return []

    return [
        JobResponse(
            id=job["id"],
            company_id=job["company_id"],
            job_number=job["job_number"],
            address_line1=job["address_line1"],
            city=job["city"],
            state=job["state"],
            zip=job["zip"],
            status=job["status"],
            customer_name=job.get("customer_name"),
            loss_type=job["loss_type"],
            created_at=job["created_at"],
            updated_at=job["updated_at"],
        )
        for job in result.data
    ]


async def update_user_profile(user_id: UUID, body: UserUpdate) -> UserResponse:
    """Update user name/phone."""
    client = await get_supabase_admin_client()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise AppException(status_code=400, detail="No fields to update", error_code="NO_UPDATES")

    # Split name into first/last if name is provided (but don't overwrite explicit values)
    if "name" in updates:
        name_parts = updates["name"].strip().split(" ", 1)
        if "first_name" not in updates:
            updates["first_name"] = name_parts[0]
        if "last_name" not in updates:
            updates["last_name"] = name_parts[1] if len(name_parts) > 1 else None

    result = await client.table("users").update(updates).eq("id", str(user_id)).execute()
    if not result.data:
        raise AppException(status_code=404, detail="User not found", error_code="USER_NOT_FOUND")
    return _parse_user(result.data[0])


async def update_company(company_id: UUID, body: CompanyUpdate) -> CompanyResponse:
    """Update company name/phone."""
    client = await get_supabase_admin_client()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise AppException(status_code=400, detail="No fields to update", error_code="NO_UPDATES")

    result = await client.table("companies").update(updates).eq("id", str(company_id)).execute()
    if not result.data:
        raise AppException(
            status_code=404, detail="Company not found", error_code="COMPANY_NOT_FOUND"
        )
    return _parse_company(result.data[0])


async def update_company_logo(company_id: UUID, file, *, content: bytes | None = None) -> str:
    """Upload logo to Supabase Storage and update company.logo_url.

    If content is provided (pre-read with size validation), it is used directly.
    Otherwise falls back to reading from the file object.
    """
    client = await get_supabase_admin_client()

    if content is None:
        content = await file.read()
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "png"
    path = f"{company_id}/logo.{ext}"

    # Upload to logos bucket (upsert replaces existing)
    await client.storage.from_("logos").upload(
        path,
        content,
        file_options={"content-type": file.content_type or "image/png", "upsert": "true"},
    )

    # Get public URL
    public_url = await client.storage.from_("logos").get_public_url(path)

    # Update company record
    await (
        client.table("companies")
        .update({"logo_url": public_url})
        .eq("id", str(company_id))
        .execute()
    )

    return public_url


async def update_user_avatar(user_id: UUID, file, *, content: bytes | None = None) -> UserResponse:
    """Upload avatar to Supabase Storage and update user.avatar_url.

    If content is provided (pre-read with size validation), it is used directly.
    Otherwise falls back to reading from the file object.
    """
    client = await get_supabase_admin_client()

    if content is None:
        content = await file.read()
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "png"
    path = f"{user_id}/avatar.{ext}"

    # Upload to avatars bucket (upsert replaces existing)
    await client.storage.from_("avatars").upload(
        path,
        content,
        file_options={"content-type": file.content_type or "image/png", "upsert": "true"},
    )

    # Get public URL
    public_url = await client.storage.from_("avatars").get_public_url(path)

    # Update user record
    result = await (
        client.table("users").update({"avatar_url": public_url}).eq("id", str(user_id)).execute()
    )
    if not result.data:
        raise AppException(status_code=404, detail="User not found", error_code="USER_NOT_FOUND")
    return _parse_user(result.data[0])


async def update_last_login(user_id: UUID) -> None:
    """Update last_login_at timestamp."""
    client = await get_supabase_admin_client()
    await (
        client.table("users")
        .update({"last_login_at": datetime.now(UTC).isoformat()})
        .eq("id", str(user_id))
        .execute()
    )


# ---------------------------------------------------------------------------
# Spec 01I: onboarding state machine
# ---------------------------------------------------------------------------


async def _exists(client, table: str, *, company_id: UUID) -> bool:
    """Return True if any row exists in ``table`` for ``company_id``.

    Uses select(...).limit(1) instead of count="exact" — cheaper and
    short-circuits at the first match. Soft-delete-aware tables filter
    deleted_at; ``scope_codes`` has no deleted_at column so we skip that
    filter for it.
    """
    query = client.table(table).select("id").eq("company_id", str(company_id)).limit(1)
    if table != "scope_codes":
        query = query.is_("deleted_at", "null")
    try:
        result = await query.execute()
    except (OSError, ValueError, RuntimeError) as e:
        logger.warning("Failed exists() on %s for company %s: %s", table, company_id, e)
        return False
    return bool(result.data)


async def get_onboarding_status(auth_user_id: UUID) -> OnboardingStatusResponse:
    """Return server-derived onboarding status for the auth user.

    Per Decision Log #5: ``has_jobs`` and ``has_pricing`` are derived from
    EXISTS queries on real tables, not from any client-asserted flag. The
    only persisted user-facing flags are ``onboarding_step`` and
    ``setup_banner_dismissed_at``.

    Lookup is by ``auth_user_id`` (not ``users.id``) because this endpoint
    is called BEFORE Step 1 of the wizard creates the ``users`` row. A
    freshly signed-up auth user has no ``users`` record yet — we return a
    sensible default (``step='company_profile'``, ``has_company=False``)
    instead of 401/404. The wizard renders Step 1 against that default.
    """
    client = await get_supabase_admin_client()

    user_result = await (
        client.table("users")
        .select(
            "id, company_id, onboarding_step, onboarding_completed_at, setup_banner_dismissed_at"
        )
        .eq("auth_user_id", str(auth_user_id))
        .is_("deleted_at", "null")
        .maybe_single()
        .execute()
    )
    user = user_result.data if user_result else None
    if not user:
        # Fresh auth user with no profile row yet — default to Step 1.
        return OnboardingStatusResponse(
            step="company_profile",
            completed_at=None,
            setup_banner_dismissed_at=None,
            has_jobs=False,
            has_pricing=False,
            has_company=False,
            show_setup_banner=False,
        )

    company_id_str = user.get("company_id")
    has_company = company_id_str is not None
    has_jobs = False
    has_pricing = False

    if has_company:
        company_id = UUID(company_id_str)
        has_jobs = await _exists(client, "jobs", company_id=company_id)
        has_pricing = await _exists(client, "scope_codes", company_id=company_id)

    completed_at_raw = user.get("onboarding_completed_at")
    completed_at = _parse_timestamptz(completed_at_raw) if completed_at_raw else None

    dismissed_raw = user.get("setup_banner_dismissed_at")
    dismissed_at = _parse_timestamptz(dismissed_raw) if dismissed_raw else None

    show_setup_banner = completed_at is not None and dismissed_at is None and not has_pricing

    return OnboardingStatusResponse(
        step=user.get("onboarding_step") or "company_profile",
        completed_at=completed_at,
        setup_banner_dismissed_at=dismissed_at,
        has_jobs=has_jobs,
        has_pricing=has_pricing,
        has_company=has_company,
        show_setup_banner=show_setup_banner,
    )


def _parse_timestamptz(raw: str) -> datetime:
    """Best-effort ISO-8601 parser. Supabase returns 'Z' suffix or +00:00."""
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


async def update_onboarding_step(auth_user_id: UUID, step: str) -> OnboardingStatusResponse:
    """Set the user's onboarding step. Forward-only (or same step).

    Lookup is by ``auth_user_id`` (matches ``get_onboarding_status``) so the
    response builder at the end resolves the same row we just wrote. Using
    ``users.id`` here while ``get_onboarding_status`` looks up by
    ``auth_user_id`` would silently fall through to the "fresh signup"
    branch and return the wrong shape (caught by code review).

    Decision Log #5: clients may advance the cursor (next-step skip) but
    cannot rewind. ``step == 'complete'`` also stamps
    ``onboarding_completed_at = now()``.

    Validates ``step`` against the canonical list. Returns the refreshed
    onboarding status (server-derived ``has_*`` flags included so the
    client doesn't need a follow-up GET).
    """
    if step not in ONBOARDING_STEP_ORDER:
        raise AppException(
            status_code=400,
            detail=(f"Invalid onboarding step: must be one of {', '.join(ONBOARDING_STEP_ORDER)}"),
            error_code="INVALID_ONBOARDING_STEP",
        )

    client = await get_supabase_admin_client()

    current = await (
        client.table("users")
        .select("id, onboarding_step, onboarding_completed_at")
        .eq("auth_user_id", str(auth_user_id))
        .is_("deleted_at", "null")
        .maybe_single()
        .execute()
    )
    if not current or not current.data:
        raise AppException(
            status_code=404,
            detail="User not found",
            error_code="USER_NOT_FOUND",
        )

    current_step = current.data.get("onboarding_step") or "company_profile"
    try:
        current_idx = ONBOARDING_STEP_ORDER.index(current_step)
    except ValueError:
        # Unknown step in DB — treat as the start so any forward move is allowed.
        current_idx = 0
    new_idx = ONBOARDING_STEP_ORDER.index(step)

    if new_idx < current_idx:
        raise AppException(
            status_code=400,
            detail=(
                f"Cannot move backwards from '{current_step}' to '{step}'. "
                "Onboarding transitions are forward-only."
            ),
            error_code="ONBOARDING_BACKWARD_TRANSITION",
        )

    updates: dict = {"onboarding_step": step}
    if step == "complete" and not current.data.get("onboarding_completed_at"):
        updates["onboarding_completed_at"] = datetime.now(UTC).isoformat()

    update_result = await (
        client.table("users").update(updates).eq("auth_user_id", str(auth_user_id)).execute()
    )
    if not update_result.data:
        raise AppException(
            status_code=404,
            detail="User not found",
            error_code="USER_NOT_FOUND",
        )

    return await get_onboarding_status(auth_user_id)


async def dismiss_setup_banner(auth_user_id: UUID) -> OnboardingStatusResponse:
    """Mark the dashboard setup banner dismissed for this user.

    Lookup keyed by ``auth_user_id`` for consistency with
    ``get_onboarding_status`` (see note in ``update_onboarding_step``).
    Per Decision Log #9: dismiss state is per-user, server-side. Survives
    device switches.
    """
    client = await get_supabase_admin_client()

    update_result = await (
        client.table("users")
        .update({"setup_banner_dismissed_at": datetime.now(UTC).isoformat()})
        .eq("auth_user_id", str(auth_user_id))
        .is_("deleted_at", "null")
        .execute()
    )
    if not update_result.data:
        raise AppException(
            status_code=404,
            detail="User not found",
            error_code="USER_NOT_FOUND",
        )

    return await get_onboarding_status(auth_user_id)
