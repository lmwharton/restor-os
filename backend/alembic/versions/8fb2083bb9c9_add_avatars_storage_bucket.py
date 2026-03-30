"""add_avatars_storage_bucket

Revision ID: 8fb2083bb9c9
Revises: 4cfff0c0a251
Create Date: 2026-03-27 11:42:09.264413

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8fb2083bb9c9"
down_revision: str | None = "4cfff0c0a251"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DELETE FROM storage.buckets WHERE id = 'avatars'")
