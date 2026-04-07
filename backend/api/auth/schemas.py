from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class CompanyCreate(BaseModel):
    name: str
    phone: str | None = None


class CompanyUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    title: str | None = None


class CompanyResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    phone: str | None
    email: str | None
    logo_url: str | None
    address: str | None
    city: str | None
    state: str | None
    zip: str | None
    subscription_tier: str
    created_at: datetime
    updated_at: datetime


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str
    first_name: str | None
    last_name: str | None
    phone: str | None
    avatar_url: str | None
    title: str | None
    role: str
    is_platform_admin: bool
    company: CompanyResponse | None = None


class JobResponse(BaseModel):
    id: UUID
    company_id: UUID
    job_number: str
    address_line1: str
    city: str
    state: str
    zip: str
    status: str
    customer_name: str | None
    loss_type: str
    created_at: datetime
    updated_at: datetime


class AuthContext(BaseModel):
    """Injected by auth middleware into route handlers."""

    auth_user_id: UUID  # from Supabase JWT sub claim
    user_id: UUID  # our users.id
    company_id: UUID  # from users.company_id
    role: str  # owner / employee
    is_platform_admin: bool
    last_notifications_seen_at: datetime | None = None
