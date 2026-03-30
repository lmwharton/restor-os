"""Structured JSON logging for the Crewmatic API.

Every log line is a single JSON object, machine-parseable for Railway log
drains, Datadog, or any structured log aggregator.

Request-scoped context (request_id, company_id, user_id) is propagated via
contextvars so ALL log lines within a request automatically include them
without explicit passing.

Usage:
    from api.shared.logging import setup_logging, get_logger

    # At app startup:
    setup_logging()

    # In any module:
    logger = get_logger("api.jobs.service")
    logger.info("job_created", extra={"extra_data": {"job_id": "...", "duration_ms": 12.3}})
"""

import json
import logging
import time
from contextvars import ContextVar
from uuid import uuid4

# ---------------------------------------------------------------------------
# Context variables — set per-request, read by JSONFormatter
# ---------------------------------------------------------------------------
request_id_var: ContextVar[str] = ContextVar("request_id", default="")
company_id_var: ContextVar[str] = ContextVar("company_id", default="")
user_id_var: ContextVar[str] = ContextVar("user_id", default="")


def generate_request_id() -> str:
    """Generate a short (8-char) unique request ID."""
    return uuid4().hex[:8]


class JSONFormatter(logging.Formatter):
    """Format every log record as a single-line JSON object.

    Fields always present: ts, level, logger, msg, req_id.
    Fields conditionally present: company_id, user_id, error, error_type.
    Extra structured data merged from record.extra_data dict.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_data: dict = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "req_id": request_id_var.get(""),
        }

        # Add tenant context if set
        cid = company_id_var.get("")
        uid = user_id_var.get("")
        if cid:
            log_data["company_id"] = cid
        if uid:
            log_data["user_id"] = uid

        # Merge structured extra data (set via extra={"extra_data": {...}})
        extra_data = getattr(record, "extra_data", None)
        if extra_data and isinstance(extra_data, dict):
            log_data.update(extra_data)

        # Include exception info if present
        if record.exc_info and record.exc_info[1]:
            log_data["error"] = str(record.exc_info[1])
            log_data["error_type"] = type(record.exc_info[1]).__name__

        return json.dumps(log_data, default=str)


def setup_logging() -> None:
    """Configure root logger with JSON output to stderr.

    Call once at app startup (in main.py) before any logging happens.
    Replaces any existing handlers to avoid duplicate output.
    """
    handler = logging.StreamHandler()
    handler.setFormatter(JSONFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)

    # Silence noisy internal loggers
    logging.getLogger("uvicorn.access").disabled = True
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Convenience wrapper — just returns logging.getLogger(name).

    Exists so modules can import from one place:
        from api.shared.logging import get_logger
        logger = get_logger(__name__)
    """
    return logging.getLogger(name)
