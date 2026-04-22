from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class AppException(Exception):
    def __init__(
        self,
        status_code: int,
        detail: str,
        error_code: str | None = None,
        *,
        extra: dict[str, Any] | None = None,
    ):
        """Structured application error that FastAPI converts into a JSON response.

        ``extra`` is merged into the JSON body verbatim — use it to attach
        machine-readable context (e.g., ``current_etag`` on a 412
        VERSION_STALE so the client can reload to that version without
        another round-trip). Keys with ``None`` values are dropped so the
        wire shape stays clean.
        """
        self.status_code = status_code
        self.detail = detail
        self.error_code = error_code
        self.extra = extra or {}


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    body: dict[str, Any] = {"error": exc.detail, "error_code": exc.error_code}
    if exc.extra:
        for k, v in exc.extra.items():
            if v is not None:
                body[k] = v
    return JSONResponse(status_code=exc.status_code, content=body)
