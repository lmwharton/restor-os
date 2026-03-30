from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.properties.schemas import PropertyCreate, PropertyResponse, PropertyUpdate
from api.properties.service import (
    create_property,
    delete_property,
    get_property,
    list_properties,
    update_property,
)
from api.shared.dependencies import PaginationParams, _get_token
from api.shared.exceptions import AppException

router = APIRouter(prefix="/properties", tags=["properties"])


@router.post("", status_code=201, response_model=PropertyResponse)
async def create_property_endpoint(
    body: PropertyCreate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create a new property for the authenticated user's company."""
    token = _get_token(request)
    row = await create_property(token, ctx.company_id, ctx.user_id, body)
    return row


@router.get("")
async def list_properties_endpoint(
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    pagination: PaginationParams = Depends(),
    search: str | None = Query(None, description="Search across address fields"),
):
    """List properties for the authenticated user's company with search and pagination."""
    token = _get_token(request)
    result = await list_properties(
        token,
        ctx.company_id,
        search=search,
        limit=pagination.limit,
        offset=pagination.offset,
    )
    return result


@router.get("/{property_id}", response_model=PropertyResponse)
async def get_property_endpoint(
    property_id: UUID,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Get a single property by ID."""
    token = _get_token(request)
    row = await get_property(token, ctx.company_id, property_id)
    return row


@router.patch("/{property_id}", response_model=PropertyResponse)
async def update_property_endpoint(
    property_id: UUID,
    body: PropertyUpdate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update a property by ID."""
    token = _get_token(request)
    row = await update_property(token, ctx.company_id, ctx.user_id, property_id, body)
    return row


@router.delete("/{property_id}")
async def delete_property_endpoint(
    property_id: UUID,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Soft delete a property. Owner or admin only."""
    if ctx.role not in ("owner", "admin"):
        raise AppException(
            status_code=403,
            detail="Only owners and admins can delete properties",
            error_code="FORBIDDEN",
        )
    await delete_property(ctx.company_id, ctx.user_id, property_id)
    return {"deleted": True}
