"""Upload utilities: chunked file reading with size enforcement.

UploadFile.size may be None for chunked/streaming uploads, so we read
the file in chunks and enforce the limit on actual bytes read.
"""

from fastapi import UploadFile

from api.shared.exceptions import AppException

MAX_UPLOAD_SIZE = 2 * 1024 * 1024  # 2 MB
CHUNK_SIZE = 8192  # 8 KB


async def read_upload_with_limit(
    file: UploadFile,
    max_size: int = MAX_UPLOAD_SIZE,
) -> bytes:
    """Read an uploaded file in chunks, enforcing a size limit.

    Raises AppException(413) if the file exceeds max_size bytes.
    Returns the full file content as bytes.
    """
    chunks: list[bytes] = []
    total = 0

    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size:
            raise AppException(
                status_code=413,
                detail=f"File too large (max {max_size // (1024 * 1024)}MB)",
                error_code="FILE_TOO_LARGE",
            )
        chunks.append(chunk)

    return b"".join(chunks)
