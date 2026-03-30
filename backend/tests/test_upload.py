"""Tests for upload utilities (chunked file reading with size enforcement)."""

from unittest.mock import AsyncMock

import pytest

from api.shared.exceptions import AppException
from api.shared.upload import read_upload_with_limit


@pytest.fixture
def make_upload_file():
    """Factory for mock UploadFile objects with given content."""

    def _make(content: bytes):
        mock_file = AsyncMock()
        offset = 0

        async def mock_read(size=-1):
            nonlocal offset
            if size == -1:
                chunk = content[offset:]
                offset = len(content)
            else:
                chunk = content[offset : offset + size]
                offset += len(chunk)
            return chunk

        mock_file.read = mock_read
        return mock_file

    return _make


class TestReadUploadWithLimit:
    """Tests for read_upload_with_limit."""

    @pytest.mark.asyncio
    async def test_reads_small_file(self, make_upload_file):
        """Small file is read completely."""
        content = b"hello world"
        result = await read_upload_with_limit(make_upload_file(content))
        assert result == content

    @pytest.mark.asyncio
    async def test_reads_empty_file(self, make_upload_file):
        """Empty file returns empty bytes."""
        result = await read_upload_with_limit(make_upload_file(b""))
        assert result == b""

    @pytest.mark.asyncio
    async def test_rejects_oversized_file(self, make_upload_file):
        """File exceeding limit raises AppException with 413."""
        content = b"x" * (100 + 1)  # 101 bytes, limit 100
        with pytest.raises(AppException) as exc_info:
            await read_upload_with_limit(make_upload_file(content), max_size=100)
        assert exc_info.value.status_code == 413
        assert exc_info.value.error_code == "FILE_TOO_LARGE"

    @pytest.mark.asyncio
    async def test_reads_file_at_exact_limit(self, make_upload_file):
        """File exactly at limit is accepted."""
        content = b"x" * 100
        result = await read_upload_with_limit(make_upload_file(content), max_size=100)
        assert result == content

    @pytest.mark.asyncio
    async def test_reads_large_file_in_chunks(self, make_upload_file):
        """Large file (but under limit) is reassembled correctly from chunks."""
        # 50KB file, well under 2MB default limit
        content = b"a" * 50_000
        result = await read_upload_with_limit(make_upload_file(content))
        assert len(result) == 50_000
        assert result == content
