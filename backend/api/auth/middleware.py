from uuid import UUID

import httpx
import jwt
from fastapi import Request
from jwt import PyJWKSet

from api.auth.schemas import AuthContext
from api.config import settings
from api.shared.database import get_supabase_admin_client
from api.shared.exceptions import AppException

# Cache JWKS keys for ES256 verification (local Supabase uses ES256)
_jwks_cache: PyJWKSet | None = None


def _fetch_jwks() -> PyJWKSet:
    """Fetch JWKS from Supabase auth endpoint. Cached after first call."""
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
    resp = httpx.get(url, timeout=5)
    resp.raise_for_status()
    _jwks_cache = PyJWKSet.from_dict(resp.json())
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


def _decode_jwt(token: str) -> dict:
    """Decode and validate a Supabase JWT.

    Supports both:
    - HS256 (cloud Supabase — uses JWT secret)
    - ES256 (local Supabase — uses JWKS public key)
    """
    try:
        # Peek at the header to determine algorithm
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        if alg == "ES256":
            # Local Supabase: verify with JWKS public key
            jwks = _fetch_jwks()
            kid = header.get("kid")
            signing_key = jwks[kid] if kid else jwks.keys[0]
            payload = jwt.decode(
                token,
                signing_key,
                algorithms=["ES256"],
                audience="authenticated",
            )
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


async def get_auth_user_id(request: Request) -> UUID:
    """Dependency: validate JWT and return the auth user ID (sub claim).

    Does NOT require the user to exist in our users table.
    Use this for onboarding routes where the user may not have a company yet.
    """
    token = _extract_token(request)
    payload = _decode_jwt(token)

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


async def get_auth_context(request: Request) -> AuthContext:
    """Dependency: validate JWT and look up the user in our users table.

    Returns a full AuthContext with user_id, company_id, role, etc.
    Raises 401 if the user is not found (they need to complete onboarding first).
    """
    auth_user_id = await get_auth_user_id(request)

    client = get_supabase_admin_client()
    result = (
        client.table("users")
        .select("id, company_id, role, is_platform_admin")
        .eq("auth_user_id", str(auth_user_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )

    user = result.data
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

    return AuthContext(
        auth_user_id=auth_user_id,
        user_id=UUID(user["id"]),
        company_id=UUID(user["company_id"]),
        role=user["role"],
        is_platform_admin=user.get("is_platform_admin", False),
    )
