"""Properties CRUD service. All queries use authenticated client (RLS-enforced)."""

from uuid import UUID

from api.properties.schemas import PropertyCreate, PropertyUpdate
from api.shared.database import get_authenticated_client
from api.shared.events import log_event
from api.shared.exceptions import AppException


def _build_usps_standardized(
    address_line1: str,
    address_line2: str | None,
    city: str,
    state: str,
    zip_code: str,
) -> str:
    """Generate a normalized address string for uniqueness checks.

    Lowercases, strips whitespace, and joins non-empty parts with a single space.
    """
    parts = [
        address_line1.strip().lower(),
        (address_line2 or "").strip().lower(),
        city.strip().lower(),
        state.strip().lower(),
        zip_code.strip().lower(),
    ]
    return " ".join(p for p in parts if p)


async def create_property(
    token: str,
    company_id: UUID,
    user_id: UUID,
    body: PropertyCreate,
) -> dict:
    """Create a new property. Checks uniqueness on (company_id, usps_standardized)."""
    client = get_authenticated_client(token)

    usps = _build_usps_standardized(
        body.address_line1, body.address_line2, body.city, body.state, body.zip
    )

    # Check for duplicate address within the company
    existing = (
        client.table("properties")
        .select("id")
        .eq("company_id", str(company_id))
        .eq("usps_standardized", usps)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if existing.data:
        raise AppException(
            status_code=400,
            detail="Property at this address already exists",
            error_code="PROPERTY_DUPLICATE",
        )

    insert_data = {
        "company_id": str(company_id),
        "address_line1": body.address_line1,
        "address_line2": body.address_line2,
        "city": body.city,
        "state": body.state,
        "zip": body.zip,
        "latitude": body.latitude,
        "longitude": body.longitude,
        "usps_standardized": usps,
        "year_built": body.year_built,
        "property_type": body.property_type,
        "total_sqft": body.total_sqft,
    }

    result = client.table("properties").insert(insert_data).execute()
    row = result.data[0]

    await log_event(
        company_id,
        "property_created",
        user_id=user_id,
        event_data={"property_id": row["id"], "address": usps},
    )

    return row


async def list_properties(
    token: str,
    company_id: UUID,
    *,
    search: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """List properties for a company with optional search and pagination.

    Returns {"items": [...], "total": N}.
    """
    client = get_authenticated_client(token)

    query = (
        client.table("properties")
        .select("*", count="exact")
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
    )

    if search:
        # ilike search across address fields
        search_pattern = f"%{search}%"
        query = query.or_(
            f"address_line1.ilike.{search_pattern},"
            f"city.ilike.{search_pattern},"
            f"state.ilike.{search_pattern},"
            f"zip.ilike.{search_pattern}"
        )

    query = query.range(offset, offset + limit - 1)
    result = query.execute()

    return {"items": result.data, "total": result.count or 0}


async def get_property(
    token: str,
    company_id: UUID,
    property_id: UUID,
) -> dict:
    """Get a single property by ID. Must belong to the company."""
    client = get_authenticated_client(token)

    result = (
        client.table("properties")
        .select("*")
        .eq("id", str(property_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )

    if not result.data:
        raise AppException(
            status_code=404,
            detail="Property not found",
            error_code="PROPERTY_NOT_FOUND",
        )

    return result.data


async def update_property(
    token: str,
    company_id: UUID,
    user_id: UUID,
    property_id: UUID,
    body: PropertyUpdate,
) -> dict:
    """Update a property. Recalculates usps_standardized if address fields change."""
    client = get_authenticated_client(token)

    # Fetch current property to merge address fields for usps recalculation
    current = (
        client.table("properties")
        .select("*")
        .eq("id", str(property_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not current.data:
        raise AppException(
            status_code=404,
            detail="Property not found",
            error_code="PROPERTY_NOT_FOUND",
        )

    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        return current.data

    # Recalculate usps_standardized if any address field changed
    address_fields = {"address_line1", "address_line2", "city", "state", "zip"}
    if address_fields & update_data.keys():
        merged = {**current.data, **update_data}
        new_usps = _build_usps_standardized(
            merged["address_line1"],
            merged.get("address_line2"),
            merged["city"],
            merged["state"],
            merged["zip"],
        )

        # Check uniqueness if address actually changed
        if new_usps != current.data.get("usps_standardized"):
            dup = (
                client.table("properties")
                .select("id")
                .eq("company_id", str(company_id))
                .eq("usps_standardized", new_usps)
                .is_("deleted_at", "null")
                .neq("id", str(property_id))
                .limit(1)
                .execute()
            )
            if dup.data:
                raise AppException(
                    status_code=400,
                    detail="Property at this address already exists",
                    error_code="PROPERTY_DUPLICATE",
                )

            update_data["usps_standardized"] = new_usps

    result = (
        client.table("properties")
        .update(update_data)
        .eq("id", str(property_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )

    await log_event(
        company_id,
        "property_updated",
        user_id=user_id,
        event_data={
            "property_id": str(property_id),
            "fields": list(update_data.keys()),
        },
    )

    return result.data
