from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Spec 01I: per-user onboarding state machine. Order matters — used to
# enforce forward-only transitions in update_onboarding_step.
OnboardingStep = Literal[
    "company_profile",
    "jobs_import",
    "pricing",
    "first_job",
    "complete",
]

ONBOARDING_STEP_ORDER: tuple[str, ...] = (
    "company_profile",
    "jobs_import",
    "pricing",
    "first_job",
    "complete",
)


class CompanyCreate(BaseModel):
    """Spec 01I Screen 2: full company profile, atomically.

    Address fields and ``service_area`` were added when onboarding was
    extended past name+phone. ``rpc_onboard_user`` was widened to accept
    these in one call (no separate PATCH).

    ``owner_name`` is captured at Step 1 because email/password signups
    don't carry a name from the auth provider. Without it the backend
    falls back to email-prefix and the user's avatar shows "??". Optional
    here for back-compat with Google-OAuth callers (auth metadata still
    provides ``full_name``).
    """

    name: str
    phone: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None
    owner_name: str | None = None
    service_area: list[str] | None = None


class CompanyUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None
    service_area: list[str] | None = None


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
    service_area: list[str] | None = None
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
    role: str  # owner / tech (Spec 01I rename — was 'employee')
    is_platform_admin: bool
    last_notifications_seen_at: datetime | None = None


# ---------------------------------------------------------------------------
# Spec 01I: onboarding state endpoints
# ---------------------------------------------------------------------------


class OnboardingStatusResponse(BaseModel):
    """Server-derived onboarding status for the current user.

    Per Decision Log #5: ``has_jobs`` and ``has_pricing`` are derived from
    EXISTS queries on real tables, not client-asserted flags. Only ``step``
    and ``setup_banner_dismissed_at`` are user-asserted.

    ``show_setup_banner`` is computed server-side as:
        completed_at IS NOT NULL AND
        setup_banner_dismissed_at IS NULL AND
        NOT has_pricing
    """

    step: OnboardingStep
    completed_at: datetime | None = None
    setup_banner_dismissed_at: datetime | None = None
    has_jobs: bool
    has_pricing: bool
    has_company: bool
    show_setup_banner: bool


class OnboardingStepUpdate(BaseModel):
    """PATCH /v1/me/onboarding-step body."""

    step: OnboardingStep = Field(
        ..., description="The new onboarding step. Forward-only transitions allowed."
    )
