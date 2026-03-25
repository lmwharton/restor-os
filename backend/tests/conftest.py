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
from uuid import uuid4  # noqa: E402

import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402

# Restore original cwd after imports
os.chdir(_original_cwd)


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
