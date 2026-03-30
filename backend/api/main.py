import logging
import time
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from api.auth.router import router as auth_router
from api.config import settings
from api.dashboard.router import router as dashboard_router
from api.events.router import router as events_router
from api.floor_plans.router import router as floor_plans_router
from api.jobs.router import router as jobs_router
from api.moisture.router import router as moisture_router
from api.photos.router import router as photos_router
from api.properties.router import router as properties_router
from api.reports.router import router as reports_router
from api.rooms.router import router as rooms_router
from api.shared.exceptions import AppException, app_exception_handler
from api.sharing.router import router as sharing_router

VERSION = "26.3.1"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
# Silence noisy internal loggers to keep output clean
logging.getLogger("uvicorn.access").disabled = True
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger("api")

app = FastAPI(
    title="Crewmatic API",
    description="The Operating System for Restoration Contractors",
    version=VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=3600,
)

app.add_exception_handler(AppException, app_exception_handler)


@app.middleware("http")
async def log_request_timing(request: Request, call_next):
    """Log every request with method, path, status, and duration in ms."""
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000, 1)

    status = response.status_code
    method = request.method
    path = request.url.path

    # Skip noisy OPTIONS preflight
    if method == "OPTIONS":
        return response

    # Color-code by status for terminal readability
    if status < 400:
        level = logging.INFO
    elif status < 500:
        level = logging.WARNING
    else:
        level = logging.ERROR

    logger.log(
        level,
        "%s %s → %s (%sms)",
        method,
        path,
        status,
        duration_ms,
    )
    return response


app.include_router(auth_router, prefix="/v1")
app.include_router(dashboard_router, prefix="/v1")
app.include_router(events_router, prefix="/v1")
app.include_router(floor_plans_router, prefix="/v1")
app.include_router(jobs_router, prefix="/v1")
app.include_router(moisture_router, prefix="/v1")
app.include_router(photos_router, prefix="/v1")
app.include_router(properties_router, prefix="/v1")
app.include_router(reports_router, prefix="/v1")
app.include_router(rooms_router, prefix="/v1")
app.include_router(sharing_router, prefix="/v1")


@app.get("/")
async def root():
    """API root — shows version and available endpoints."""
    return {
        "name": "Crewmatic API",
        "version": VERSION,
        "description": "The Operating System for Restoration Contractors",
        "docs": "/docs",
        "health": "/health",
        "api": "/v1",
    }


@app.get("/health")
async def health_check():
    """Public health endpoint — no auth required.
    Checks API + database connectivity. Never crashes."""
    services = {
        "api": {"status": "ok"},
        "database": {"status": "unknown"},
    }
    overall = "healthy"

    try:
        from api.shared.database import get_supabase_client

        client = await get_supabase_client()
        await client.table("companies").select("id").limit(1).execute()
        services["database"] = {"status": "connected"}
    except Exception as e:
        services["database"] = {"status": "disconnected", "error": type(e).__name__}
        overall = "degraded"

    return {
        "status": overall,
        "version": VERSION,
        "timestamp": datetime.now(UTC).isoformat(),
        "environment": settings.environment,
        "services": services,
    }
