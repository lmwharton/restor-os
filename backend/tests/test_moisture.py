"""Tests for moisture readings, points, and dehu outputs (Spec 03 -- Site Log).

Covers all 11 endpoints:
- Readings: POST, GET (room), GET (job), PATCH, DELETE
- Points: POST, PATCH, DELETE
- Dehus: POST, PATCH, DELETE

Plus unit tests for GPP calculation and day_number logic.
"""

from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

from tests.conftest import AsyncSupabaseMock
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from api.config import settings
from api.main import app
from api.moisture.service import calculate_day_number, calculate_gpp

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def jwt_secret():
    return "test-secret-key-for-moisture-tests"


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
def mock_job_id():
    return uuid4()


@pytest.fixture
def mock_room_id():
    return uuid4()


@pytest.fixture
def mock_reading_id():
    return uuid4()


@pytest.fixture
def mock_point_id():
    return uuid4()


@pytest.fixture
def mock_dehu_id():
    return uuid4()


@pytest.fixture
def valid_token(mock_auth_user_id, jwt_secret):
    return jwt.encode(
        {"sub": str(mock_auth_user_id), "aud": "authenticated", "role": "authenticated"},
        jwt_secret,
        algorithm="HS256",
    )


@pytest.fixture
def auth_headers(valid_token):
    return {"Authorization": f"Bearer {valid_token}"}


@pytest.fixture
def mock_job_data(mock_job_id, mock_company_id):
    return {
        "id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "loss_date": "2026-03-20",
        "status": "active",
        "deleted_at": None,
    }


@pytest.fixture
def mock_job_data_no_loss_date(mock_job_id, mock_company_id):
    """Job without a loss_date -- day_number should be None."""
    return {
        "id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "loss_date": None,
        "status": "active",
        "deleted_at": None,
    }


@pytest.fixture
def mock_room_data(mock_room_id, mock_job_id, mock_company_id):
    return {
        "id": str(mock_room_id),
        "job_id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "name": "Living Room",
        "sort_order": 0,
    }


@pytest.fixture
def mock_reading_data(mock_reading_id, mock_job_id, mock_room_id, mock_company_id):
    return {
        "id": str(mock_reading_id),
        "job_id": str(mock_job_id),
        "room_id": str(mock_room_id),
        "company_id": str(mock_company_id),
        "reading_date": "2026-03-25",
        "day_number": 6,
        "atmospheric_temp_f": 72.0,
        "atmospheric_rh_pct": 45.0,
        "atmospheric_gpp": 52.4,
        "created_at": "2026-03-25T10:00:00Z",
        "updated_at": "2026-03-25T10:00:00Z",
    }


@pytest.fixture
def mock_point_data(mock_point_id, mock_reading_id):
    return {
        "id": str(mock_point_id),
        "reading_id": str(mock_reading_id),
        "location_name": "North Wall",
        "reading_value": 15.2,
        "meter_photo_url": None,
        "sort_order": 0,
        "created_at": "2026-03-25T10:00:00Z",
    }


@pytest.fixture
def mock_dehu_data(mock_dehu_id, mock_reading_id):
    return {
        "id": str(mock_dehu_id),
        "reading_id": str(mock_reading_id),
        "dehu_model": "DrizAir 1200",
        "rh_out_pct": 38.0,
        "temp_out_f": 95.0,
        "sort_order": 0,
        "created_at": "2026-03-25T10:00:00Z",
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _users_table_mock(user_id, company_id):
    """Return a MagicMock configured for the 'users' table auth lookup."""
    t = AsyncSupabaseMock()
    chain = t.select.return_value.eq.return_value.is_.return_value
    # Auth middleware uses .maybe_single() (commit 7423ce2).
    chain.maybe_single.return_value.execute.return_value = MagicMock(
        data={
            "id": str(user_id),
            "company_id": str(company_id),
            "role": "owner",
            "is_platform_admin": False,
        }
    )
    return t


def _jobs_table_mock(job_data):
    t = AsyncSupabaseMock()
    chain = t.select.return_value.eq.return_value.eq.return_value.is_.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=job_data)
    return t


def _rooms_table_mock(room_data):
    """Mock for get_valid_room: select.eq.eq.eq.is_.single.execute.

    The new query uses PostgREST embedded resources (joins) so the chain
    includes .is_("jobs.deleted_at", "null") before .single().
    """
    t = AsyncSupabaseMock()
    chain = t.select.return_value.eq.return_value.eq.return_value.eq.return_value.is_.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=room_data)
    return t


def _readings_valid_mock(reading_data):
    """Mock for get_valid_reading: select.eq.eq.eq.is_.single.execute.

    The new query uses PostgREST embedded resources (joins) so the chain
    includes .is_("jobs.deleted_at", "null") before .single().
    """
    t = AsyncSupabaseMock()
    chain = t.select.return_value.eq.return_value.eq.return_value.eq.return_value.is_.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=reading_data)
    return t


def _event_table_mock():
    t = AsyncSupabaseMock()
    t.insert.return_value.execute.return_value = MagicMock(data=[{}])
    return t


def _patch_all(jwt_secret, mock_admin, mock_auth):
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(patch.object(settings, "supabase_jwt_secret", jwt_secret))
    stack.enter_context(
        patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_admin)
    )
    stack.enter_context(
        patch("api.shared.dependencies.get_authenticated_client", return_value=mock_auth)
    )
    stack.enter_context(
        patch("api.moisture.router.get_authenticated_client", return_value=mock_auth)
    )
    stack.enter_context(
        patch("api.shared.events.get_supabase_admin_client", return_value=mock_admin)
    )
    return stack


# ---------------------------------------------------------------------------
# GPP calculation unit tests
# ---------------------------------------------------------------------------


class TestGppCalculation:
    """Unit tests for the psychrometric GPP formula."""

    def test_gpp_72f_45pct(self):
        """72F, 45% RH should yield approximately 52.4 GPP."""
        result = calculate_gpp(Decimal("72"), Decimal("45"))
        assert result is not None
        assert abs(float(result) - 52.4) < 1.0

    def test_gpp_none_inputs(self):
        """GPP returns None when either input is None."""
        assert calculate_gpp(None, Decimal("45")) is None
        assert calculate_gpp(Decimal("72"), None) is None
        assert calculate_gpp(None, None) is None

    def test_gpp_zero_rh(self):
        """0% RH should yield 0 GPP."""
        result = calculate_gpp(Decimal("72"), Decimal("0"))
        assert result is not None
        assert float(result) == 0.0

    def test_gpp_100_rh(self):
        """100% RH (fully saturated) should yield a high GPP value."""
        result = calculate_gpp(Decimal("72"), Decimal("100"))
        assert result is not None
        assert float(result) > 100.0

    def test_gpp_low_temp(self):
        """32F (freezing) with 50% RH should yield a positive GPP."""
        result = calculate_gpp(Decimal("32"), Decimal("50"))
        assert result is not None
        assert float(result) > 0.0

    def test_gpp_high_temp(self):
        """120F with 50% RH -- high temp scenario."""
        result = calculate_gpp(Decimal("120"), Decimal("50"))
        assert result is not None
        assert float(result) > 100.0

    def test_gpp_returns_decimal(self):
        """Result should be a Decimal type."""
        result = calculate_gpp(Decimal("72"), Decimal("45"))
        assert isinstance(result, Decimal)

    def test_gpp_rounded_to_one_decimal(self):
        """Result should be rounded to 1 decimal place."""
        result = calculate_gpp(Decimal("72"), Decimal("45"))
        assert result is not None
        # Converting to string should have at most 1 decimal digit
        parts = str(result).split(".")
        assert len(parts) == 2
        assert len(parts[1]) <= 1


# ---------------------------------------------------------------------------
# Day Number calculation unit tests
# ---------------------------------------------------------------------------


class TestDayNumberCalculation:
    """Unit tests for calculate_day_number."""

    def test_loss_date_same_as_reading(self):
        """Day 1 when reading is on loss date."""
        assert calculate_day_number(date(2026, 3, 20), date(2026, 3, 20)) == 1

    def test_loss_date_5_days_before(self):
        """Day 6 when reading is 5 days after loss."""
        assert calculate_day_number(date(2026, 3, 25), date(2026, 3, 20)) == 6

    def test_loss_date_none(self):
        """None when loss_date is None."""
        assert calculate_day_number(date(2026, 3, 25), None) is None

    def test_reading_before_loss_date(self):
        """Negative/zero day numbers when reading is before loss (edge case)."""
        result = calculate_day_number(date(2026, 3, 19), date(2026, 3, 20))
        assert result == 0  # -1 + 1 = 0

    def test_one_day_after_loss(self):
        """Day 2 when reading is 1 day after loss."""
        assert calculate_day_number(date(2026, 3, 21), date(2026, 3, 20)) == 2


# ---------------------------------------------------------------------------
# Auth & Validation Tests
# ---------------------------------------------------------------------------


class TestMoistureAuth:
    """Test authentication and authorization for moisture endpoints."""

    def test_missing_auth_header(self, client, mock_job_id, mock_room_id):
        """Request without Authorization header -> 401."""
        response = client.post(
            f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
            json={"reading_date": "2026-03-25"},
        )
        assert response.status_code == 401

    def test_invalid_token(self, client, mock_job_id, mock_room_id):
        """Request with garbage token -> 401."""
        response = client.post(
            f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
            json={"reading_date": "2026-03-25"},
            headers={"Authorization": "Bearer garbage-token"},
        )
        assert response.status_code == 401

    def test_missing_bearer_prefix(self, client, mock_job_id, mock_room_id, valid_token):
        """Token without 'Bearer ' prefix -> 401."""
        response = client.post(
            f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
            json={"reading_date": "2026-03-25"},
            headers={"Authorization": valid_token},
        )
        assert response.status_code == 401


class TestMoistureValidation:
    """Test request validation for moisture endpoints."""

    def test_invalid_reading_date_format(
        self, client, mock_job_id, mock_room_id, auth_headers, jwt_secret,
        mock_user_id, mock_company_id, mock_job_data, mock_room_data,
    ):
        """Invalid date format -> 422."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "job_rooms":
                return _rooms_table_mock(mock_room_data)
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
                json={"reading_date": "not-a-date"},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def _make_auth_router(self, user_id, company_id, job_data, room_data=None, reading_data=None):
        """Build a table router that passes auth + job/room/reading validation."""
        def table_router(name):
            if name == "users":
                return _users_table_mock(user_id, company_id)
            if name == "jobs":
                return _jobs_table_mock(job_data)
            if name == "job_rooms" and room_data:
                return _rooms_table_mock(room_data)
            if name == "moisture_readings" and reading_data:
                return _readings_valid_mock(reading_data)
            return AsyncSupabaseMock()
        return table_router

    def test_rh_above_100(
        self, client, mock_job_id, mock_room_id, auth_headers, jwt_secret,
        mock_user_id, mock_company_id, mock_job_data, mock_room_data,
    ):
        """RH > 100 -> 422 validation error."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        router = self._make_auth_router(
            mock_user_id, mock_company_id, mock_job_data, mock_room_data,
        )
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
                json={
                    "reading_date": "2026-03-25",
                    "atmospheric_rh_pct": 150,
                },
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_negative_temp(
        self, client, mock_job_id, mock_room_id, auth_headers, jwt_secret,
        mock_user_id, mock_company_id, mock_job_data, mock_room_data,
    ):
        """Negative temp -> 422 since ge=0 constraint."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        router = self._make_auth_router(
            mock_user_id, mock_company_id, mock_job_data, mock_room_data,
        )
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
                json={
                    "reading_date": "2026-03-25",
                    "atmospheric_temp_f": -10,
                },
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_point_empty_location_name(
        self, client, mock_job_id, mock_reading_id, auth_headers, jwt_secret,
        mock_user_id, mock_company_id, mock_job_data, mock_reading_data,
    ):
        """Point with empty location_name -> 422 (min_length=1)."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        router = self._make_auth_router(
            mock_user_id, mock_company_id, mock_job_data, reading_data=mock_reading_data,
        )
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/points",
                json={"location_name": "", "reading_value": 10.5},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_point_missing_location_name(
        self, client, mock_job_id, mock_reading_id, auth_headers, jwt_secret,
        mock_user_id, mock_company_id, mock_job_data, mock_reading_data,
    ):
        """Point without required location_name -> 422."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        router = self._make_auth_router(
            mock_user_id, mock_company_id, mock_job_data, reading_data=mock_reading_data,
        )
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/points",
                json={"reading_value": 10.5},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_dehu_rh_out_above_100(
        self, client, mock_job_id, mock_reading_id, auth_headers, jwt_secret,
        mock_user_id, mock_company_id, mock_job_data, mock_reading_data,
    ):
        """Dehu rh_out_pct > 100 -> 422."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        router = self._make_auth_router(
            mock_user_id, mock_company_id, mock_job_data, reading_data=mock_reading_data,
        )
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/dehus",
                json={"rh_out_pct": 110},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_dehu_negative_sort_order(
        self, client, mock_job_id, mock_reading_id, auth_headers, jwt_secret,
        mock_user_id, mock_company_id, mock_job_data, mock_reading_data,
    ):
        """Dehu sort_order < 0 -> 422 (ge=0)."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        router = self._make_auth_router(
            mock_user_id, mock_company_id, mock_job_data, reading_data=mock_reading_data,
        )
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/dehus",
                json={"sort_order": -1},
                headers=auth_headers,
            )
            assert response.status_code == 422


# ---------------------------------------------------------------------------
# Readings CRUD
# ---------------------------------------------------------------------------


class TestCreateReading:
    """Test POST /v1/jobs/{job_id}/rooms/{room_id}/readings."""

    def test_create_reading_success(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_room_id, mock_job_data, mock_room_data, auth_headers,
    ):
        """POST reading with temp+rh -> 201, GPP auto-calculated."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        reading_id = uuid4()
        now = "2026-03-25T10:00:00Z"

        reading_row = {
            "id": str(reading_id),
            "job_id": str(mock_job_id),
            "room_id": str(mock_room_id),
            "company_id": str(mock_company_id),
            "reading_date": "2026-03-25",
            "day_number": 6,
            "atmospheric_temp_f": 72.0,
            "atmospheric_rh_pct": 45.0,
            "atmospheric_gpp": 52.4,
            "created_at": now,
            "updated_at": now,
        }

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "job_rooms":
                return _rooms_table_mock(mock_room_data)
            if name == "moisture_readings":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                t.insert.return_value.execute.return_value = MagicMock(data=[reading_row])
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
                json={
                    "reading_date": "2026-03-25",
                    "atmospheric_temp_f": 72,
                    "atmospheric_rh_pct": 45,
                },
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["atmospheric_gpp"] is not None
            assert data["points"] == []
            assert data["dehus"] == []

    def test_create_reading_no_temp_rh(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_room_id, mock_job_data, mock_room_data, auth_headers,
    ):
        """POST reading without temp/rh -> 201, GPP is None."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        reading_id = uuid4()
        now = "2026-03-25T10:00:00Z"

        reading_row = {
            "id": str(reading_id),
            "job_id": str(mock_job_id),
            "room_id": str(mock_room_id),
            "company_id": str(mock_company_id),
            "reading_date": "2026-03-25",
            "day_number": 6,
            "atmospheric_temp_f": None,
            "atmospheric_rh_pct": None,
            "atmospheric_gpp": None,
            "created_at": now,
            "updated_at": now,
        }

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "job_rooms":
                return _rooms_table_mock(mock_room_data)
            if name == "moisture_readings":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                t.insert.return_value.execute.return_value = MagicMock(data=[reading_row])
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
                json={"reading_date": "2026-03-25"},
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["atmospheric_gpp"] is None
            assert data["atmospheric_temp_f"] is None
            assert data["atmospheric_rh_pct"] is None

    def test_create_reading_no_loss_date(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_room_id, mock_job_data_no_loss_date, mock_room_data,
        auth_headers,
    ):
        """POST reading when job has no loss_date -> day_number is None."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        reading_id = uuid4()
        now = "2026-03-25T10:00:00Z"

        reading_row = {
            "id": str(reading_id),
            "job_id": str(mock_job_id),
            "room_id": str(mock_room_id),
            "company_id": str(mock_company_id),
            "reading_date": "2026-03-25",
            "day_number": None,
            "atmospheric_temp_f": None,
            "atmospheric_rh_pct": None,
            "atmospheric_gpp": None,
            "created_at": now,
            "updated_at": now,
        }

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data_no_loss_date)
            if name == "job_rooms":
                return _rooms_table_mock(mock_room_data)
            if name == "moisture_readings":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                t.insert.return_value.execute.return_value = MagicMock(data=[reading_row])
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
                json={"reading_date": "2026-03-25"},
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["day_number"] is None

    def test_create_reading_duplicate_date(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_room_id, mock_job_data, mock_room_data, auth_headers,
    ):
        """POST reading on a date that already has a reading -> 409."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "job_rooms":
                return _rooms_table_mock(mock_room_data)
            if name == "moisture_readings":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[{"id": str(uuid4())}])
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
                json={"reading_date": "2026-03-25"},
                headers=auth_headers,
            )
            assert response.status_code == 409
            assert response.json()["error_code"] == "READING_EXISTS"


# ---------------------------------------------------------------------------
# List Readings
# ---------------------------------------------------------------------------


class TestListReadings:
    """Test GET readings endpoints."""

    def _make_table_router(self, user_id, company_id, job_data, readings_data,
                           room_data=None, points_data=None, dehus_data=None):
        def table_router(name):
            if name == "users":
                return _users_table_mock(user_id, company_id)
            if name == "jobs":
                return _jobs_table_mock(job_data)
            if name == "job_rooms" and room_data:
                return _rooms_table_mock(room_data)
            if name == "moisture_readings":
                t = AsyncSupabaseMock()
                exec_mock = MagicMock(data=readings_data)
                t.select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value = exec_mock
                t.select.return_value.eq.return_value.order.return_value.order.return_value.execute.return_value = exec_mock
                return t
            if name == "moisture_points":
                t = AsyncSupabaseMock()
                t.select.return_value.in_.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=points_data or [])
                )
                return t
            if name == "dehu_outputs":
                t = AsyncSupabaseMock()
                t.select.return_value.in_.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=dehus_data or [])
                )
                return t
            return AsyncSupabaseMock()

        return table_router

    def test_list_readings_for_room(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_room_id, mock_job_data, mock_room_data,
        mock_reading_data, auth_headers,
    ):
        """GET room readings -> 200 with reading list."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data,
            [mock_reading_data], mock_room_data,
        )
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}/readings",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "items" in data
            assert "total" in data
            assert len(data["items"]) == 1

    def test_list_readings_for_job(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_job_data, mock_reading_data, auth_headers,
    ):
        """GET job-level readings -> 200 with all rooms' readings."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, [mock_reading_data],
        )
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/readings",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "items" in data
            assert "total" in data
            assert len(data["items"]) == 1

    def test_list_readings_empty(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_job_data, auth_headers,
    ):
        """GET job readings when none exist -> 200 with empty list."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, [],
        )
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/readings",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["items"] == []
            assert data["total"] == 0

    def test_list_readings_with_nested_points_and_dehus(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_job_data, mock_reading_data, mock_point_data,
        mock_dehu_data, auth_headers,
    ):
        """GET readings -> 200 with nested points and dehus attached."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data,
            [mock_reading_data],
            points_data=[mock_point_data],
            dehus_data=[mock_dehu_data],
        )
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/readings",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert len(data["items"]) == 1
            assert data["total"] == 1
            assert len(data["items"][0]["points"]) == 1
            assert len(data["items"][0]["dehus"]) == 1
            assert data["items"][0]["points"][0]["location_name"] == "North Wall"
            assert data["items"][0]["dehus"][0]["dehu_model"] == "DrizAir 1200"


# ---------------------------------------------------------------------------
# Update Readings
# ---------------------------------------------------------------------------


class TestUpdateReading:
    """Test PATCH /v1/jobs/{job_id}/readings/{reading_id}."""

    def _setup(self, user_id, company_id, job_data, reading_data,
               updated_reading, jwt_secret, auth_headers, client, job_id, reading_id):
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        readings_mock = _readings_valid_mock(reading_data)
        readings_mock.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[updated_reading]
        )
        points_mock = AsyncSupabaseMock()
        points_mock.select.return_value.in_.return_value.order.return_value.execute.return_value = (
            MagicMock(data=[])
        )
        dehus_mock = AsyncSupabaseMock()
        dehus_mock.select.return_value.in_.return_value.order.return_value.execute.return_value = (
            MagicMock(data=[])
        )
        cache = {
            "moisture_readings": readings_mock,
            "moisture_points": points_mock,
            "dehu_outputs": dehus_mock,
        }

        def table_router(name):
            if name == "users":
                return _users_table_mock(user_id, company_id)
            if name == "jobs":
                return _jobs_table_mock(job_data)
            if name in cache:
                return cache[name]
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router
        return mock_admin, mock_auth

    def test_update_reading_recalc_gpp(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_job_data, mock_reading_data, auth_headers,
    ):
        """PATCH with new temp -> 200, GPP recalculated."""
        updated_reading = {**mock_reading_data, "atmospheric_temp_f": 80.0, "atmospheric_gpp": 65.0}
        mock_admin, mock_auth = self._setup(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data,
            updated_reading, jwt_secret, auth_headers, client, mock_job_id, mock_reading_id,
        )

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}",
                json={"atmospheric_temp_f": 80},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert float(data["atmospheric_temp_f"]) == 80.0

    def test_update_reading_empty_body(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_job_data, mock_reading_data, auth_headers,
    ):
        """PATCH with empty body -> 400 EMPTY_UPDATE."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        readings_mock = _readings_valid_mock(mock_reading_data)
        cache = {"moisture_readings": readings_mock}

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name in cache:
                return cache[name]
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}",
                json={},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "EMPTY_UPDATE"

    def test_update_reading_date_duplicate(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_job_data, mock_reading_data, auth_headers,
    ):
        """PATCH reading_date to an existing date for that room -> 409."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        readings_mock = _readings_valid_mock(mock_reading_data)
        # Uniqueness check returns a conflict
        readings_mock.select.return_value.eq.return_value.eq.return_value.neq.return_value.execute.return_value = (
            MagicMock(data=[{"id": str(uuid4())}])
        )

        cache = {"moisture_readings": readings_mock}

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name in cache:
                return cache[name]
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}",
                json={"reading_date": "2026-03-26"},
                headers=auth_headers,
            )
            assert response.status_code == 409
            assert response.json()["error_code"] == "READING_EXISTS"


# ---------------------------------------------------------------------------
# Delete Reading
# ---------------------------------------------------------------------------


class TestDeleteReading:
    """Test DELETE /v1/jobs/{job_id}/readings/{reading_id}."""

    def test_delete_reading(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_job_data, mock_reading_data, auth_headers,
    ):
        """DELETE reading -> 204, cascading deletes children."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "moisture_readings":
                t = _readings_valid_mock(mock_reading_data)
                t.delete.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
                return t
            if name in ("moisture_points", "dehu_outputs"):
                t = AsyncSupabaseMock()
                t.delete.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204


# ---------------------------------------------------------------------------
# Points CRUD
# ---------------------------------------------------------------------------


class TestMoisturePoints:
    """Test POST/PATCH/DELETE for moisture points."""

    def _make_table_router(self, user_id, company_id, job_data, reading_data, point_response=None):
        def table_router(name):
            if name == "users":
                return _users_table_mock(user_id, company_id)
            if name == "jobs":
                return _jobs_table_mock(job_data)
            if name == "moisture_readings":
                return _readings_valid_mock(reading_data)
            if name == "moisture_points":
                t = AsyncSupabaseMock()
                if point_response is not None:
                    t.insert.return_value.execute.return_value = MagicMock(data=[point_response])
                    t.update.return_value.eq.return_value.eq.return_value.execute.return_value = (
                        MagicMock(data=[point_response])
                    )
                t.delete.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        return table_router

    def test_add_moisture_point(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_job_data, mock_reading_data,
        mock_point_data, auth_headers,
    ):
        """POST point -> 201."""
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data, mock_point_data,
        )
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/points",
                json={"location_name": "North Wall", "reading_value": 15.2},
                headers=auth_headers,
            )
            assert response.status_code == 201
            assert response.json()["location_name"] == "North Wall"

    def test_add_point_with_photo_url(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_job_data, mock_reading_data, auth_headers,
    ):
        """POST point with meter_photo_url -> 201."""
        point = {
            "id": str(uuid4()),
            "reading_id": str(mock_reading_id),
            "location_name": "Baseboard",
            "reading_value": 22.5,
            "meter_photo_url": "https://storage.example.com/photo.jpg",
            "sort_order": 1,
            "created_at": "2026-03-25T10:00:00Z",
        }
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data, point,
        )
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/points",
                json={
                    "location_name": "Baseboard",
                    "reading_value": 22.5,
                    "meter_photo_url": "https://storage.example.com/photo.jpg",
                    "sort_order": 1,
                },
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["meter_photo_url"] == "https://storage.example.com/photo.jpg"
            assert data["sort_order"] == 1

    def test_update_moisture_point(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_point_id, mock_job_data,
        mock_reading_data, auth_headers,
    ):
        """PATCH point -> 200."""
        point = {
            "id": str(mock_point_id),
            "reading_id": str(mock_reading_id),
            "location_name": "South Wall",
            "reading_value": 20.0,
            "meter_photo_url": None,
            "sort_order": 0,
            "created_at": "2026-03-25T10:00:00Z",
        }
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data, point,
        )
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/points/{mock_point_id}",
                json={"location_name": "South Wall", "reading_value": 20.0},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["location_name"] == "South Wall"

    def test_update_point_empty_body(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_point_id, mock_job_data,
        mock_reading_data, auth_headers,
    ):
        """PATCH point with empty body -> 400 EMPTY_UPDATE."""
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data,
        )
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/points/{mock_point_id}",
                json={},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "EMPTY_UPDATE"

    def test_update_point_not_found(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_point_id, mock_job_data,
        mock_reading_data, auth_headers,
    ):
        """PATCH point that doesn't exist -> 404 POINT_NOT_FOUND."""

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "moisture_readings":
                return _readings_valid_mock(mock_reading_data)
            if name == "moisture_points":
                t = AsyncSupabaseMock()
                # Update returns empty data (point not found)
                t.update.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/points/{mock_point_id}",
                json={"reading_value": 99.9},
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "POINT_NOT_FOUND"

    def test_delete_moisture_point(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_point_id, mock_job_data,
        mock_reading_data, auth_headers,
    ):
        """DELETE point -> 204."""
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data,
        )
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/points/{mock_point_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204


# ---------------------------------------------------------------------------
# Dehu Outputs CRUD
# ---------------------------------------------------------------------------


class TestDehuOutputs:
    """Test POST/PATCH/DELETE for dehu outputs."""

    def _make_table_router(self, user_id, company_id, job_data, reading_data, dehu_response=None):
        def table_router(name):
            if name == "users":
                return _users_table_mock(user_id, company_id)
            if name == "jobs":
                return _jobs_table_mock(job_data)
            if name == "moisture_readings":
                return _readings_valid_mock(reading_data)
            if name == "dehu_outputs":
                t = AsyncSupabaseMock()
                if dehu_response is not None:
                    t.insert.return_value.execute.return_value = MagicMock(data=[dehu_response])
                    t.update.return_value.eq.return_value.eq.return_value.execute.return_value = (
                        MagicMock(data=[dehu_response])
                    )
                t.delete.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        return table_router

    def test_add_dehu_output(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_job_data, mock_reading_data,
        mock_dehu_data, auth_headers,
    ):
        """POST dehu -> 201."""
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data, mock_dehu_data,
        )
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/dehus",
                json={"dehu_model": "DrizAir 1200", "rh_out_pct": 38, "temp_out_f": 95},
                headers=auth_headers,
            )
            assert response.status_code == 201
            assert response.json()["dehu_model"] == "DrizAir 1200"

    def test_add_dehu_minimal(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_job_data, mock_reading_data, auth_headers,
    ):
        """POST dehu with only sort_order (all optional fields) -> 201."""
        dehu = {
            "id": str(uuid4()),
            "reading_id": str(mock_reading_id),
            "dehu_model": None,
            "rh_out_pct": None,
            "temp_out_f": None,
            "sort_order": 0,
            "created_at": "2026-03-25T10:00:00Z",
        }
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data, dehu,
        )
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/dehus",
                json={},
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["dehu_model"] is None
            assert data["rh_out_pct"] is None

    def test_update_dehu_output(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_dehu_id, mock_job_data,
        mock_reading_data, auth_headers,
    ):
        """PATCH dehu -> 200."""
        dehu = {
            "id": str(mock_dehu_id),
            "reading_id": str(mock_reading_id),
            "dehu_model": "Phoenix R200",
            "rh_out_pct": 35.0,
            "temp_out_f": 90.0,
            "sort_order": 0,
            "created_at": "2026-03-25T10:00:00Z",
        }
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data, dehu,
        )
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/dehus/{mock_dehu_id}",
                json={"dehu_model": "Phoenix R200"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["dehu_model"] == "Phoenix R200"

    def test_update_dehu_empty_body(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_dehu_id, mock_job_data,
        mock_reading_data, auth_headers,
    ):
        """PATCH dehu with empty body -> 400 EMPTY_UPDATE."""
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data,
        )
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/dehus/{mock_dehu_id}",
                json={},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "EMPTY_UPDATE"

    def test_update_dehu_not_found(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_dehu_id, mock_job_data,
        mock_reading_data, auth_headers,
    ):
        """PATCH dehu that doesn't exist -> 404 DEHU_NOT_FOUND."""

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "moisture_readings":
                return _readings_valid_mock(mock_reading_data)
            if name == "dehu_outputs":
                t = AsyncSupabaseMock()
                t.update.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/dehus/{mock_dehu_id}",
                json={"rh_out_pct": 50},
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "DEHU_NOT_FOUND"

    def test_delete_dehu_output(
        self, client, jwt_secret, mock_user_id, mock_company_id,
        mock_job_id, mock_reading_id, mock_dehu_id, mock_job_data,
        mock_reading_data, auth_headers,
    ):
        """DELETE dehu -> 204."""
        router = self._make_table_router(
            mock_user_id, mock_company_id, mock_job_data, mock_reading_data,
        )
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/dehus/{mock_dehu_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204


# ---------------------------------------------------------------------------
# No deleted_at references in moisture module (these tables use hard delete)
# ---------------------------------------------------------------------------


class TestNoSoftDelete:
    """Verify that moisture module uses hard delete, not soft delete.

    moisture_readings, moisture_points, and dehu_outputs tables do NOT
    have a deleted_at column. The service should never reference it.
    """

    def test_service_has_no_deleted_at_references(self):
        """The moisture service source should not contain 'deleted_at'."""
        import inspect
        import api.moisture.service as svc

        source = inspect.getsource(svc)
        assert "deleted_at" not in source, (
            "moisture service references deleted_at but these tables use hard delete"
        )

    def test_schemas_have_no_deleted_at_references(self):
        """The moisture schemas source should not contain 'deleted_at'."""
        import inspect
        import api.moisture.schemas as sch

        source = inspect.getsource(sch)
        assert "deleted_at" not in source, (
            "moisture schemas references deleted_at but these tables use hard delete"
        )

    def test_router_has_no_deleted_at_references(self):
        """The moisture router source should not contain 'deleted_at'."""
        from pathlib import Path

        router_path = Path(__file__).parent.parent / "api" / "moisture" / "router.py"
        source = router_path.read_text()
        assert "deleted_at" not in source, (
            "moisture router references deleted_at but these tables use hard delete"
        )
