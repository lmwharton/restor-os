"""Integration test fixtures — hit real local Supabase.

These tests require a running local Supabase instance (supabase start).
They are skipped automatically if Supabase is not reachable.

Usage:
    pytest tests/integration/ -v
"""

import os
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio

# ---------------------------------------------------------------------------
# Local Supabase defaults (overridden by env vars if set)
# ---------------------------------------------------------------------------
LOCAL_SUPABASE_URL = os.environ.get(
    "INTEGRATION_SUPABASE_URL", "http://127.0.0.1:55321"
)
LOCAL_SUPABASE_ANON_KEY = os.environ.get(
    "INTEGRATION_SUPABASE_ANON_KEY",
    (
        "eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIs"
        "InR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODk"
        "4MjI5MDJ9.lLqu9BHi6lDkGbvnBbUkRWX5WnfpGu5whMMcv5iZ7XLNv4opRds9JXUomijmdJY_UHa_1x-"
        "5MfNGpXQZ-0_HOQ"
    ),
)
LOCAL_SUPABASE_SERVICE_ROLE_KEY = os.environ.get(
    "INTEGRATION_SUPABASE_SERVICE_ROLE_KEY",
    (
        "eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIs"
        "InR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV"
        "4cCI6MjA4OTgyMjkwMn0.2ot76c9aKbrAQzVbGSEHlM5y5ogbIGoEhv2jC7EDQn-uCsF6-igoue-uefga"
        "OSn3ueTxSYNeMnXs-4tYX9S0Jw"
    ),
)
LOCAL_SUPABASE_JWT_SECRET = os.environ.get(
    "INTEGRATION_SUPABASE_JWT_SECRET",
    "super-secret-jwt-token-with-at-least-32-characters-long",
)


def _supabase_is_reachable() -> bool:
    """Check if local Supabase is running (sync, for collection-time skip)."""
    try:
        resp = httpx.get(
            f"{LOCAL_SUPABASE_URL}/rest/v1/",
            headers={"apikey": LOCAL_SUPABASE_ANON_KEY},
            timeout=3.0,
        )
        return resp.status_code == 200
    except Exception:
        return False


# Skip the entire module if Supabase is unreachable
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _supabase_is_reachable(),
        reason="Local Supabase is not running (start with: supabase start)",
    ),
]


# ---------------------------------------------------------------------------
# Override settings BEFORE importing the app so all singletons use local DB
# ---------------------------------------------------------------------------
def _configure_env_for_local_supabase():
    """Set env vars so api.config.Settings picks up local Supabase."""
    os.environ["SUPABASE_URL"] = LOCAL_SUPABASE_URL
    os.environ["SUPABASE_KEY"] = LOCAL_SUPABASE_ANON_KEY
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = LOCAL_SUPABASE_SERVICE_ROLE_KEY
    os.environ["SUPABASE_JWT_SECRET"] = LOCAL_SUPABASE_JWT_SECRET
    os.environ["ENVIRONMENT"] = "test"


_configure_env_for_local_supabase()

# Now safe to import app modules — they will read the env vars we just set
from supabase import AsyncClient, AsyncClientOptions, acreate_client  # noqa: E402

# Reload settings so they pick up the local Supabase env vars we just set.
# The unit test conftest.py (or a previous import) may have already loaded
# Settings with fake values. Since modules use `from api.config import settings`,
# they hold a direct reference to the OLD Settings instance. We must mutate
# that same instance (or reload every module). Easiest: create a fresh Settings
# and copy its values onto the existing singleton.
import api.config  # noqa: E402

_fresh = api.config.Settings()
for field_name in type(_fresh).model_fields:
    setattr(api.config.settings, field_name, getattr(_fresh, field_name))

# Reset the singleton database clients so they get re-created with the new settings.
# Without this, cached clients from unit test imports would point at the wrong URL.
import api.shared.database as _db_mod  # noqa: E402

_db_mod._anon_client = None
_db_mod._admin_client = None
_db_mod._shared_httpx_client = None

# Reset auth middleware caches so tests start fresh
import api.auth.middleware as _auth_mod  # noqa: E402

_auth_mod._jwks_cache = None
_auth_mod._jwks_fetched_at = 0.0
_auth_mod._jwks_httpx_client = None
_auth_mod._auth_context_cache.clear()

from api.main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Auto-reset app singletons before each test
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _reset_app_singletons():
    """Reset module-level singletons so each test gets fresh clients.

    The app's database.py and auth middleware cache httpx connections and
    Supabase clients at module level. Since pytest-asyncio creates a new
    event loop per test, those cached objects hold stale connections tied
    to the previous loop. We must clear them before each test.
    """
    _db_mod._anon_client = None
    _db_mod._admin_client = None
    _db_mod._shared_httpx_client = None
    _auth_mod._jwks_cache = None
    _auth_mod._jwks_fetched_at = 0.0
    _auth_mod._jwks_httpx_client = None
    _auth_mod._auth_context_cache.clear()
    yield
    # Post-test cleanup: clear again to avoid leaking into next test
    _db_mod._anon_client = None
    _db_mod._admin_client = None
    _db_mod._shared_httpx_client = None


# ---------------------------------------------------------------------------
# Supabase admin client (service role — bypasses RLS)
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def admin_client() -> AsyncClient:
    """Function-scoped Supabase admin client for test setup/teardown."""
    client = await acreate_client(
        LOCAL_SUPABASE_URL,
        LOCAL_SUPABASE_SERVICE_ROLE_KEY,
        options=AsyncClientOptions(postgrest_client_timeout=30),
    )
    return client


# ---------------------------------------------------------------------------
# HTTPX async client for hitting the FastAPI app directly (no network)
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def api_client():
    """HTTPX async client wired to the FastAPI app via ASGITransport."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
        timeout=30.0,
    ) as client:
        yield client


# ---------------------------------------------------------------------------
# Raw HTTP helpers for Supabase Auth admin API
# ---------------------------------------------------------------------------
# We use raw httpx instead of supabase-py's auth client because the
# supabase-py auth client creates internal httpx pools tied to the event loop.
# Since pytest-asyncio creates a new loop per test, those pools become stale
# and cause "Event loop is closed" errors on subsequent tests.

_AUTH_ADMIN_HEADERS = {
    "apikey": LOCAL_SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {LOCAL_SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}
_AUTH_BASE = f"{LOCAL_SUPABASE_URL}/auth/v1"


async def _create_auth_user(
    http: httpx.AsyncClient, email: str, password: str, full_name: str
) -> str:
    """Create a user via Supabase Auth admin API. Returns the user ID."""
    resp = await http.post(
        f"{_AUTH_BASE}/admin/users",
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": full_name},
        },
        headers=_AUTH_ADMIN_HEADERS,
    )
    assert resp.status_code == 200, f"Create auth user failed: {resp.status_code} {resp.text}"
    return resp.json()["id"]


async def _sign_in(http: httpx.AsyncClient, email: str, password: str) -> str:
    """Sign in via Supabase Auth. Returns an access_token (JWT)."""
    resp = await http.post(
        f"{_AUTH_BASE}/token?grant_type=password",
        json={"email": email, "password": password},
        headers={"apikey": LOCAL_SUPABASE_ANON_KEY, "Content-Type": "application/json"},
    )
    assert resp.status_code == 200, f"Sign-in failed: {resp.status_code} {resp.text}"
    return resp.json()["access_token"]


async def _delete_auth_user(http: httpx.AsyncClient, user_id: str) -> None:
    """Delete a user via Supabase Auth admin API. Best-effort."""
    await http.delete(
        f"{_AUTH_BASE}/admin/users/{user_id}",
        headers=_AUTH_ADMIN_HEADERS,
    )


# ---------------------------------------------------------------------------
# Test user + company creation via Supabase Auth admin API
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def test_user(admin_client: AsyncClient):
    """Create a test auth user in Supabase Auth, yield info, then clean up.

    Returns a dict with:
        auth_user_id, email, password, access_token
    """
    unique = uuid4().hex[:8]
    email = f"test-{unique}@crewmatic-integration.test"
    password = f"TestPass!{unique}"

    http = httpx.AsyncClient(timeout=10.0)
    try:
        auth_user_id = await _create_auth_user(
            http, email, password, f"Test User {unique}"
        )
        access_token = await _sign_in(http, email, password)
    finally:
        await http.aclose()

    user_info = {
        "auth_user_id": auth_user_id,
        "email": email,
        "password": password,
        "access_token": access_token,
    }

    yield user_info

    # Teardown: delete auth user
    http = httpx.AsyncClient(timeout=10.0)
    try:
        await _delete_auth_user(http, auth_user_id)
    except Exception:
        pass
    finally:
        await http.aclose()


@pytest_asyncio.fixture
async def auth_headers(test_user: dict) -> dict:
    """Authorization headers with a real JWT for the test user."""
    return {"Authorization": f"Bearer {test_user['access_token']}"}


@pytest_asyncio.fixture
async def onboarded_user(api_client: httpx.AsyncClient, test_user: dict, admin_client: AsyncClient):
    """Create a test user AND onboard them (company + user record in DB).

    Returns a dict with:
        auth_user_id, email, access_token, user_id, company_id, headers
    """
    headers = {"Authorization": f"Bearer {test_user['access_token']}"}
    unique = uuid4().hex[:6]

    # POST /v1/company to trigger onboarding
    resp = await api_client.post(
        "/v1/company",
        json={"name": f"Integration Test Co {unique}", "phone": "555-0100"},
        headers=headers,
    )
    assert resp.status_code == 201, f"Onboarding failed: {resp.status_code} {resp.text}"

    data = resp.json()
    company = data["company"]
    user = data["user"]

    result = {
        **test_user,
        "user_id": user["id"],
        "company_id": company["id"],
        "company_name": company["name"],
        "headers": headers,
    }

    yield result

    # Teardown: soft-delete user + company records via admin client
    try:
        await (
            admin_client.table("users")
            .delete()
            .eq("auth_user_id", str(test_user["auth_user_id"]))
            .execute()
        )
    except Exception:
        pass
    try:
        await (
            admin_client.table("companies")
            .delete()
            .eq("id", str(company["id"]))
            .execute()
        )
    except Exception:
        pass


@pytest_asyncio.fixture
async def second_onboarded_user(
    api_client: httpx.AsyncClient, admin_client: AsyncClient
):
    """Create a SECOND onboarded user for cross-tenant isolation tests.

    Fully independent from the first test_user fixture.
    """
    unique = uuid4().hex[:8]
    email = f"test2-{unique}@crewmatic-integration.test"
    password = f"TestPass2!{unique}"

    async with httpx.AsyncClient(timeout=10.0) as http:
        auth_user_id = await _create_auth_user(
            http, email, password, f"Second User {unique}"
        )
        access_token = await _sign_in(http, email, password)

    headers = {"Authorization": f"Bearer {access_token}"}

    # Onboard
    resp = await api_client.post(
        "/v1/company",
        json={"name": f"Rival Co {unique}", "phone": "555-0200"},
        headers=headers,
    )
    assert resp.status_code == 201, f"Second onboarding failed: {resp.status_code} {resp.text}"

    data = resp.json()

    result = {
        "auth_user_id": auth_user_id,
        "email": email,
        "access_token": access_token,
        "user_id": data["user"]["id"],
        "company_id": data["company"]["id"],
        "headers": headers,
    }

    yield result

    # Teardown
    async with httpx.AsyncClient(timeout=10.0) as http:
        try:
            await _delete_auth_user(http, auth_user_id)
        except Exception:
            pass
    try:
        await (
            admin_client.table("users")
            .delete()
            .eq("auth_user_id", str(auth_user_id))
            .execute()
        )
    except Exception:
        pass
    try:
        await (
            admin_client.table("companies")
            .delete()
            .eq("id", str(data["company"]["id"]))
            .execute()
        )
    except Exception:
        pass
