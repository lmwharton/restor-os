"""Async Supabase client factory with connection pooling.

Patterns borrowed from ArceusX (QueuePool + per-loop caching) and ServeOS
(pool_size=30, pool_recycle=300, pool_pre_ping=True), adapted for supabase-py.

Key design decisions:
  - ONE shared httpx.AsyncClient with connection pooling (max 30 keepalive, 100 total)
  - Admin + anon clients are singletons (immutable auth state)
  - Authenticated clients are per-request (each carries a different user JWT)
    but reuse the shared httpx connection pool via AsyncClientOptions(httpx_client=...)
  - Keepalive expiry 30s aligns with Supabase pooler idle timeout
"""

import logging

import httpx
from supabase import AsyncClient, AsyncClientOptions, acreate_client

from api.config import settings

logger = logging.getLogger(__name__)

# Shared httpx async connection pool — reused across ALL supabase clients.
# This is the critical fix: without it, every acreate_client() opens new
# TCP + SSL connections that never get reused, exhausting file descriptors.
_shared_httpx_client: httpx.AsyncClient | None = None

# Module-level singletons for clients with fixed auth state
_anon_client: AsyncClient | None = None
_admin_client: AsyncClient | None = None


def _get_shared_httpx_client() -> httpx.AsyncClient:
    """Lazy-init shared httpx.AsyncClient with connection pooling."""
    global _shared_httpx_client
    if _shared_httpx_client is None:
        _shared_httpx_client = httpx.AsyncClient(
            limits=httpx.Limits(
                max_connections=100,
                max_keepalive_connections=30,
                keepalive_expiry=30.0,  # 30s, under Supabase 60s idle timeout
            ),
            timeout=httpx.Timeout(
                connect=10.0,
                read=120.0,  # match postgrest_client_timeout
                write=30.0,
                pool=30.0,   # fail fast if pool exhausted
            ),
        )
        logger.info("httpx_pool_init", extra={"extra_data": {
            "max_connections": 100, "max_keepalive": 30, "keepalive_expiry_s": 30.0,
        }})
    return _shared_httpx_client


def _make_options(**overrides) -> AsyncClientOptions:
    """Build AsyncClientOptions with shared httpx pool."""
    return AsyncClientOptions(
        httpx_client=_get_shared_httpx_client(),
        postgrest_client_timeout=120,
        **overrides,
    )


async def get_supabase_client() -> AsyncClient:
    """Supabase client using anon key, for unauthenticated operations.
    Singleton — reuses HTTP connections across requests."""
    global _anon_client
    if _anon_client is None:
        _anon_client = await acreate_client(
            settings.supabase_url,
            settings.supabase_key,
            options=_make_options(),
        )
    return _anon_client


async def get_authenticated_client(token: str) -> AsyncClient:
    """Supabase client with the user's JWT set, so RLS enforces tenant isolation.

    Per-request (each user has a different JWT), but reuses the shared httpx
    connection pool so no new TCP/SSL connections are opened.
    """
    client = await acreate_client(
        settings.supabase_url,
        settings.supabase_key,
        options=_make_options(),
    )
    # Set the JWT on the PostgREST client so RLS sees the user's claims.
    # Using postgrest.auth() rather than auth.set_session() avoids faking
    # a refresh token and triggering unnecessary auth-side state.
    client.postgrest.auth(token)
    return client


async def get_supabase_admin_client() -> AsyncClient:
    """Supabase client using service role key (bypasses RLS).
    Singleton — reuses HTTP connections across requests."""
    global _admin_client
    if _admin_client is None:
        _admin_client = await acreate_client(
            settings.supabase_url,
            settings.supabase_service_role_key.get_secret_value(),
            options=_make_options(),
        )
    return _admin_client
