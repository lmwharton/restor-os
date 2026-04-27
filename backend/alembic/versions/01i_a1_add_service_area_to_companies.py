"""Spec 01I (Onboarding): add service_area TEXT[] column to companies.

Per the onboarding flow's Company Profile screen (Screen 2), the company
captures a list of service-area names (e.g., counties or named regions) at
creation time. Address columns (address/city/state/zip) already exist on
companies from Spec 00 bootstrap; only service_area is missing.

Revision ID: 01i_a1_service_area
Revises: c9d0e1f2a3b4
Create Date: 2026-04-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "01i_a1_service_area"
down_revision: str | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS service_area TEXT[]")


def downgrade() -> None:
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS service_area")
