from uuid import UUID

from fastapi import APIRouter, Depends, UploadFile

from api.auth.middleware import get_auth_context, get_auth_user_id
from api.auth.schemas import AuthContext, CompanyCreate, CompanyUpdate, UserUpdate
from api.auth.service import (
    get_or_create_company,
    get_user_with_company,
    update_company,
    update_company_logo,
    update_last_login,
    update_user_profile,
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


@router.patch("/me")
async def patch_me(body: UserUpdate, ctx: AuthContext = Depends(get_auth_context)):
    """Update current user's profile (name, phone)."""
    user = await update_user_profile(ctx.user_id, body)
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


@router.patch("/company")
async def patch_company(body: CompanyUpdate, ctx: AuthContext = Depends(get_auth_context)):
    """Update company details (name, phone). Owner only."""
    if ctx.role != "owner":
        raise AppException(status_code=403, detail="Only owners can update company", error_code="FORBIDDEN")
    company = await update_company(ctx.company_id, body)
    return company


@router.post("/company/logo")
async def upload_company_logo(file: UploadFile, ctx: AuthContext = Depends(get_auth_context)):
    """Upload company logo. Replaces existing logo. Owner only."""
    if ctx.role != "owner":
        raise AppException(status_code=403, detail="Only owners can update logo", error_code="FORBIDDEN")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise AppException(status_code=400, detail="File must be an image", error_code="INVALID_FILE_TYPE")

    if file.size and file.size > 2 * 1024 * 1024:
        raise AppException(status_code=400, detail="File too large (max 2MB)", error_code="FILE_TOO_LARGE")

    logo_url = await update_company_logo(ctx.company_id, file)
    return {"logo_url": logo_url}


# GET /v1/jobs endpoint moved to api/jobs/router.py (Spec 01).
# The list_jobs function remains in auth/service.py temporarily until the jobs module is built.
