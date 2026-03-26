from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.auth.router import router as auth_router
from api.config import settings
from api.shared.exceptions import AppException, app_exception_handler

app = FastAPI(
    title="Crewmatic API",
    description="The Operating System for Restoration Contractors",
    version="26.3.1",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AppException, app_exception_handler)

app.include_router(auth_router, prefix="/v1")


@app.get("/")
async def root():
    """API root — shows version and available endpoints."""
    return {
        "name": "Crewmatic API",
        "version": "26.3.1",
        "description": "The Operating System for Restoration Contractors",
        "docs": "/docs" if settings.debug else "Docs disabled in production. Set DEBUG=true to enable.",
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

        client = get_supabase_client()
        client.table("companies").select("id").limit(1).execute()
        services["database"] = {"status": "connected"}
    except Exception as e:
        services["database"] = {"status": "disconnected", "error": type(e).__name__}
        overall = "degraded"

    return {
        "status": overall,
        "version": "26.3.1",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "environment": settings.environment,
        "services": services,
    }
