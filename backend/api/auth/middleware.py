import time
from uuid import UUID

import httpx
import jwt
from fastapi import Request
from jwt import PyJWKSet

from api.auth.schemas import AuthContext
from api.config import settings
from api.shared.database import get_supabase_admin_client
from api.shared.exceptions import AppException
from api.shared.logging import company_id_var, user_id_var

# ---------------------------------------------------------------------------
# JWKS cache with TTL (Issue 3)
# ---------------------------------------------------------------------------
_JWKS_TTL_SECONDS = 300  # 5 minutes

_jwks_cache: PyJWKSet | None = None
_jwks_fetched_at: float = 0.0

# Shared async httpx client for JWKS fetches (lightweight, separate from Supabase pool)
_jwks_httpx_client: httpx.AsyncClient | None = None


def _get_jwks_httpx_client() -> httpx.AsyncClient:
    """Lazy-init a lightweight async httpx client for JWKS fetches."""
    global _jwks_httpx_client
    if _jwks_httpx_client is None:
        _jwks_httpx_client = httpx.AsyncClient(timeout=httpx.Timeout(5.0))
    return _jwks_httpx_client


async def _fetch_jwks(force: bool = False) -> PyJWKSet:
    """Fetch JWKS from Supabase auth endpoint. Cached for 5 minutes."""
    global _jwks_cache, _jwks_fetched_at

    now = time.monotonic()
    if not force and _jwks_cache is not None and (now - _jwks_fetched_at) < _JWKS_TTL_SECONDS:
        return _jwks_cache

    url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
    client = _get_jwks_httpx_client()
    resp = await client.get(url)
    resp.raise_for_status()
    _jwks_cache = PyJWKSet.from_dict(resp.json())
    _jwks_fetched_at = now
    return _jwks_cache


def _extract_token(request: Request) -> str:
    """Extract Bearer token from Authorization header."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise AppException(
            status_code=401,
            detail="Missing or invalid Authorization header",
            error_code="AUTH_MISSING_TOKEN",
        )
    return auth_header[7:]


async def _decode_jwt(token: str) -> dict:
    """Decode and validate a Supabase JWT.

    Supports both:
    - HS256 (cloud Supabase — uses JWT secret)
    - ES256 (local Supabase — uses JWKS public key)

    For ES256, if verification fails with cached keys we retry once with
    freshly fetched keys (handles Supabase key rotation).
    """
    try:
        # Peek at the header to determine algorithm
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        if alg == "ES256":
            # Local Supabase: verify with JWKS public key
            try:
                payload = await _verify_es256(token, header, force_refresh=False)
            except jwt.InvalidTokenError:
                # Keys may have rotated — retry with fresh JWKS once
                payload = await _verify_es256(token, header, force_refresh=True)
        else:
            # Cloud Supabase: verify with shared secret (HS256)
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        return payload
    except jwt.ExpiredSignatureError:
        raise AppException(
            status_code=401,
            detail="Token has expired",
            error_code="AUTH_TOKEN_EXPIRED",
        )
    except jwt.InvalidTokenError:
        raise AppException(
            status_code=401,
            detail="Invalid token",
            error_code="AUTH_TOKEN_INVALID",
        )


async def _verify_es256(token: str, header: dict, *, force_refresh: bool) -> dict:
    """Verify an ES256 JWT using JWKS keys."""
    jwks = await _fetch_jwks(force=force_refresh)
    kid = header.get("kid")
    signing_key = jwks[kid] if kid else jwks.keys[0]
    return jwt.decode(
        token,
        signing_key,
        algorithms=["ES256"],
        audience="authenticated",
    )


async def get_auth_user_id(request: Request) -> UUID:
    """Dependency: validate JWT and return the auth user ID (sub claim).

    Does NOT require the user to exist in our users table.
    Use this for onboarding routes where the user may not have a company yet.
    """
    token = _extract_token(request)
    payload = await _decode_jwt(token)

    sub = payload.get("sub")
    if not sub:
        raise AppException(
            status_code=401,
            detail="Token missing sub claim",
            error_code="AUTH_TOKEN_INVALID",
        )

    try:
        return UUID(sub)
    except ValueError:
        raise AppException(
            status_code=401,
            detail="Invalid sub claim in token",
            error_code="AUTH_TOKEN_INVALID",
        )


# ---------------------------------------------------------------------------
# Auth context cache (Issue 4) — avoids DB lookup on every request
# ---------------------------------------------------------------------------
_AUTH_CONTEXT_TTL_SECONDS = 60

# keyed by auth_user_id (UUID) -> (AuthContext, timestamp)
_auth_context_cache: dict[UUID, tuple[AuthContext, float]] = {}


def _get_cached_auth_context(auth_user_id: UUID) -> AuthContext | None:
    """Return cached AuthContext if still valid, else None."""
    entry = _auth_context_cache.get(auth_user_id)
    if entry is None:
        return None
    ctx, fetched_at = entry
    if (time.monotonic() - fetched_at) >= _AUTH_CONTEXT_TTL_SECONDS:
        del _auth_context_cache[auth_user_id]
        return None
    return ctx


def _set_cached_auth_context(auth_user_id: UUID, ctx: AuthContext) -> None:
    """Store AuthContext in the TTL cache."""
    _auth_context_cache[auth_user_id] = (ctx, time.monotonic())


async def get_auth_context(request: Request) -> AuthContext:
    """Dependency: validate JWT and look up the user in our users table.

    Returns a full AuthContext with user_id, company_id, role, etc.
    Raises 401 if the user is not found (they need to complete onboarding first).

    Results are cached in-memory for 60 seconds to avoid a DB roundtrip on
    every request.
    """
    auth_user_id = await get_auth_user_id(request)

    # Check cache first
    cached = _get_cached_auth_context(auth_user_id)
    if cached is not None:
        return cached

    client = await get_supabase_admin_client()
    result = await (
        client.table("users")
        .select("id, company_id, role, is_platform_admin, last_notifications_seen_at")
        .eq("auth_user_id", str(auth_user_id))
        .is_("deleted_at", "null")
        .maybe_single()
        .execute()
    )

    user = result.data if result else None
    if not user:
        raise AppException(
            status_code=401,
            detail="User not found. Complete onboarding first.",
            error_code="AUTH_USER_NOT_FOUND",
        )

    if not user.get("company_id"):
        raise AppException(
            status_code=401,
            detail="User has no company. Complete onboarding first.",
            error_code="AUTH_NO_COMPANY",
        )

    # Parse last_notifications_seen_at if present
    last_seen_raw = user.get("last_notifications_seen_at")
    last_seen = None
    if last_seen_raw:
        from datetime import datetime, UTC
        last_seen = datetime.fromisoformat(last_seen_raw.replace("Z", "+00:00"))

    ctx = AuthContext(
        auth_user_id=auth_user_id,
        user_id=UUID(user["id"]),
        company_id=UUID(user["company_id"]),
        role=user["role"],
        is_platform_admin=user.get("is_platform_admin", False),
        last_notifications_seen_at=last_seen,
    )
    _set_cached_auth_context(auth_user_id, ctx)

    # Set context vars so all subsequent log lines include tenant info
    company_id_var.set(str(ctx.company_id))
    user_id_var.set(str(ctx.user_id))

    return ctx
