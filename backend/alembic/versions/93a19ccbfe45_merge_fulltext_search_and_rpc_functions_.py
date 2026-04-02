"""merge fulltext_search and rpc_functions heads

Revision ID: 93a19ccbfe45
Revises: a1b2c3d4e5f6, b3f1a2c4d5e6
Create Date: 2026-04-01 23:37:42.701044

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '93a19ccbfe45'
down_revision: str | None = ('a1b2c3d4e5f6', 'b3f1a2c4d5e6')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
