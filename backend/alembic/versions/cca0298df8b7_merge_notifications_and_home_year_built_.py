"""merge notifications and home_year_built heads

Revision ID: cca0298df8b7
Revises: c5e8f1a2b3d4, c7d8e9f0a1b2
Create Date: 2026-04-09 01:50:18.253318

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cca0298df8b7'
down_revision: str | None = ('c5e8f1a2b3d4', 'c7d8e9f0a1b2')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
