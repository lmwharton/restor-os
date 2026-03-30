import os
import tempfile

# Pydantic-settings loads .env from cwd at import time.
# Change cwd to a temp directory so the real .env is not discovered,
# then set required env vars explicitly for the test environment.
_original_cwd = os.getcwd()
_tmpdir = tempfile.mkdtemp()
os.chdir(_tmpdir)

os.environ["SUPABASE_URL"] = "https://test.supabase.co"
os.environ["SUPABASE_KEY"] = "test-anon-key"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-role-key"
os.environ["SUPABASE_JWT_SECRET"] = "test-jwt-secret"

from datetime import UTC, datetime, timedelta  # noqa: E402
from unittest.mock import AsyncMock, MagicMock  # noqa: E402
from uuid import uuid4  # noqa: E402

import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402

# Restore original cwd after imports
os.chdir(_original_cwd)


class AsyncSupabaseMock(MagicMock):
    """MagicMock subclass where .execute() always returns an AsyncMock.

    This allows service code like `await client.table("x").select().eq().execute()`
    to work in tests. All chained method calls return regular MagicMocks (for
    assertion/configuration), but .execute() returns a coroutine so `await` works.

    Storage methods (upload, download, create_signed_url, etc.) are also async.
    Auth admin methods (get_user_by_id) are also async.
    """

    _ASYNC_METHODS = frozenset({
        "execute",
        # Storage methods
        "upload", "download", "create_signed_url", "create_signed_urls",
        "create_signed_upload_url", "get_public_url", "remove",
        # Auth admin methods
        "get_user_by_id",
    })

    def _get_child_mock(self, /, **kw):
        """Override child mock creation to use AsyncSupabaseMock for chaining."""
        # For attributes named in _ASYNC_METHODS, return AsyncMock
        name = kw.get("name", "") or kw.get("_new_name", "")
        if name in self._ASYNC_METHODS:
            return AsyncMock(**kw)
        return super()._get_child_mock(**kw)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def jwt_secret():
    return "test-jwt-secret-for-testing"


@pytest.fixture
def mock_auth_user_id():
    return uuid4()


@pytest.fixture
def mock_user_id():
    return uuid4()


@pytest.fixture
def mock_company_id():
    return uuid4()


@pytest.fixture
def valid_token(jwt_secret, mock_auth_user_id):
    """Generate a valid Supabase-style JWT."""
    payload = {
        "sub": str(mock_auth_user_id),
        "email": "brett@drypros.com",
        "role": "authenticated",
        "iss": "https://test.supabase.co/auth/v1",
        "aud": "authenticated",
        "exp": datetime.now(UTC) + timedelta(hours=1),
        "iat": datetime.now(UTC),
    }
    return jwt.encode(payload, jwt_secret, algorithm="HS256")


@pytest.fixture
def expired_token(jwt_secret, mock_auth_user_id):
    """Generate an expired JWT."""
    payload = {
        "sub": str(mock_auth_user_id),
        "email": "brett@drypros.com",
        "role": "authenticated",
        "aud": "authenticated",
        "exp": datetime.now(UTC) - timedelta(hours=1),
        "iat": datetime.now(UTC) - timedelta(hours=2),
    }
    return jwt.encode(payload, jwt_secret, algorithm="HS256")


@pytest.fixture
def auth_headers(valid_token):
    """Standard Authorization headers for authenticated requests."""
    return {"Authorization": f"Bearer {valid_token}"}


@pytest.fixture
def mock_user_row(mock_user_id, mock_company_id):
    """Standard user row dict as returned from the users table."""
    return {
        "id": str(mock_user_id),
        "company_id": str(mock_company_id),
        "role": "owner",
        "is_platform_admin": False,
    }


def make_mock_supabase(user_row, table_handlers=None):
    """Create an AsyncSupabaseMock Supabase client with auth middleware support.

    Args:
        user_row: Dict to return for users table lookup (auth context).
                  Set to None to simulate user-not-found.
        table_handlers: Optional dict mapping table names to callables
                        that receive a fresh AsyncSupabaseMock table and configure it.
                        Tables not in this dict get a default unconfigured mock.

    Returns:
        An AsyncSupabaseMock that behaves like an async Supabase client.
        All .execute() calls return coroutines (AsyncMock).
    """
    mock_client = AsyncSupabaseMock()

    def table_side_effect(table_name):
        mock_table = AsyncSupabaseMock()
        if table_name == "users":
            # Auth middleware: select().eq().is_().single().execute().data
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = user_row
        elif table_name == "event_history":
            # log_event: insert().execute() — fire-and-forget, just succeed
            mock_table.insert.return_value.execute.return_value = MagicMock()
        elif table_handlers and table_name in table_handlers:
            table_handlers[table_name](mock_table)
        return mock_table

    mock_client.table.side_effect = table_side_effect
    return mock_client
