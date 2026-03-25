from uuid import UUID

from fastapi import APIRouter, Depends

from api.auth.middleware import get_auth_context, get_auth_user_id
from api.auth.schemas import AuthContext, CompanyCreate
from api.auth.service import (
    get_or_create_company,
    get_user_with_company,
    list_jobs,
    update_last_login,
)
from api.shared.exceptions import AppException

router = APIRouter(tags=["auth"])


@router.get("/me")
async def get_me(ctx: AuthContext = Depends(get_auth_context)):
    """Get current user profile with company."""
    user = await get_user_with_company(ctx.auth_user_id)
    if not user:
        raise AppException(
            status_code=404,
            detail="User not found",
            error_code="USER_NOT_FOUND",
        )

    # Fire-and-forget last login update
    await update_last_login(ctx.user_id)

    return user


@router.get("/company")
async def get_company(auth_user_id: UUID = Depends(get_auth_user_id)):
    """Get current user's company. Returns 404 if no company (triggers onboarding)."""
    user = await get_user_with_company(auth_user_id)

    if not user or not user.company:
        raise AppException(
            status_code=404,
            detail="No company found. Complete onboarding.",
            error_code="COMPANY_NOT_FOUND",
        )

    return user.company


@router.post("/company", status_code=201)
async def create_company(body: CompanyCreate, auth_user_id: UUID = Depends(get_auth_user_id)):
    """Create company + user during onboarding. Returns existing if already created."""
    # We need the user's email from the Supabase auth token.
    # Since get_auth_user_id only returns the UUID, we fetch from Supabase auth.
    from api.shared.database import get_supabase_admin_client

    client = get_supabase_admin_client()
    auth_response = client.auth.admin.get_user_by_id(str(auth_user_id))

    if not auth_response or not auth_response.user:
        raise AppException(
            status_code=401,
            detail="Auth user not found in Supabase",
            error_code="AUTH_USER_NOT_FOUND",
        )

    auth_user = auth_response.user
    email = auth_user.email or ""
    user_name = (auth_user.user_metadata or {}).get("full_name", email.split("@")[0])
    avatar_url = (auth_user.user_metadata or {}).get("avatar_url")

    company, user = await get_or_create_company(
        auth_user_id=auth_user_id,
        name=body.name,
        phone=body.phone,
        email=email,
        user_name=user_name,
        avatar_url=avatar_url,
    )

    return {"company": company, "user": user}


@router.get("/jobs")
async def list_company_jobs(ctx: AuthContext = Depends(get_auth_context)):
    """List jobs for current company. Returns empty list for new companies."""
    jobs = await list_jobs(ctx.company_id)
    return {"jobs": jobs}
