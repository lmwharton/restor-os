import random
import re
import string
from datetime import UTC, datetime
from uuid import UUID

from api.auth.schemas import CompanyResponse, JobResponse, UserResponse
from api.shared.database import get_supabase_admin_client
from api.shared.exceptions import AppException


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
        role=data["role"],
        is_platform_admin=data.get("is_platform_admin", False),
        company=company,
    )


async def get_user_with_company(auth_user_id: UUID) -> UserResponse | None:
    """Look up user by auth_user_id, include company data. Returns None if not found."""
    client = get_supabase_admin_client()

    result = (
        client.table("users")
        .select("*, companies(*)")
        .eq("auth_user_id", str(auth_user_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )

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
) -> tuple[CompanyResponse, UserResponse]:
    """Onboarding flow: create company + user atomically.

    1. Check if user already exists with a company -- return existing if so.
    2. Generate slug from company name.
    3. Insert company row.
    4. Insert user row (auth_user_id, company_id, email, name, avatar_url, role='owner').
    5. Return both.

    Uses get_supabase_admin_client() (service_role, bypasses RLS).
    """
    client = get_supabase_admin_client()

    # Check if user already has a company
    existing = (
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

    # Create company
    slug = _slugify(name)
    company_result = (
        client.table("companies")
        .insert(
            {
                "name": name,
                "slug": slug,
                "phone": phone,
                "email": email,
            }
        )
        .execute()
    )

    if not company_result.data:
        raise AppException(
            status_code=500,
            detail="Failed to create company",
            error_code="COMPANY_CREATE_FAILED",
        )

    company_data = company_result.data[0]
    company = _parse_company(company_data)

    # Split name into first/last
    name_parts = user_name.strip().split(" ", 1)
    first_name = name_parts[0] if name_parts else user_name
    last_name = name_parts[1] if len(name_parts) > 1 else None

    # Create or update user
    if existing_data:
        # User exists but has no company -- update them
        user_result = (
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
        # Create new user
        user_result = (
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
    client = get_supabase_admin_client()

    result = (
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


async def update_last_login(user_id: UUID) -> None:
    """Update last_login_at timestamp."""
    client = get_supabase_admin_client()
    client.table("users").update({"last_login_at": datetime.now(UTC).isoformat()}).eq(
        "id", str(user_id)
    ).execute()
