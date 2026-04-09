"""add_logos_storage_bucket

Revision ID: e62979fbcd17
Revises: cca0298df8b7
Create Date: 2026-04-09 17:33:39.647989

"""
from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e62979fbcd17'
down_revision: str | None = 'cca0298df8b7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('logos', 'logos', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DELETE FROM storage.buckets WHERE id = 'logos'")
