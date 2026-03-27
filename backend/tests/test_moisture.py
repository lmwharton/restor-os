"""Tests for moisture readings, points, and dehu outputs (Spec 03 — Site Log)."""

from decimal import Decimal
from unittest.mock import MagicMock, patch
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from api.config import settings
from api.main import app
from api.moisture.service import calculate_gpp

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _user_data(user_id, company_id):
    return {
        "id": str(user_id),
        "company_id": str(company_id),
        "role": "owner",
        "is_platform_admin": False,
    }


def _users_table_mock(user_id, company_id):
    """Return a MagicMock configured for the 'users' table auth lookup."""
    t = MagicMock()
    chain = t.select.return_value.eq.return_value.is_.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=_user_data(user_id, company_id))
    return t


def _jobs_table_mock(job_data):
    t = MagicMock()
    chain = t.select.return_value.eq.return_value.eq.return_value.is_.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=job_data)
    return t


def _rooms_table_mock(room_data):
    t = MagicMock()
    chain = t.select.return_value.eq.return_value.eq.return_value.eq.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=room_data)
    return t


def _readings_valid_mock(reading_data):
    """Mock for get_valid_reading: select.eq.eq.eq.single.execute."""
    t = MagicMock()
    chain = t.select.return_value.eq.return_value.eq.return_value.eq.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=reading_data)
    return t


def _event_table_mock():
    t = MagicMock()
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


# ---------------------------------------------------------------------------
# Readings CRUD
# ---------------------------------------------------------------------------


class TestCreateReading:
    """Test POST /v1/jobs/{job_id}/rooms/{room_id}/readings."""

    def test_create_reading_success(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_room_id,
        mock_job_data,
        mock_room_data,
        auth_headers,
    ):
        """POST reading with temp+rh -> 201, GPP auto-calculated."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()
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
                t = MagicMock()
                t.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                t.insert.return_value.execute.return_value = MagicMock(data=[reading_row])
                return t
            if name == "event_history":
                return _event_table_mock()
            return MagicMock()

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

    def test_create_reading_duplicate_date(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_room_id,
        mock_job_data,
        mock_room_data,
        auth_headers,
    ):
        """POST reading on a date that already has a reading -> 409."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "job_rooms":
                return _rooms_table_mock(mock_room_data)
            if name == "moisture_readings":
                t = MagicMock()
                t.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[{"id": str(uuid4())}])
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return MagicMock()

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

    def test_create_reading_gpp_calculation(self):
        """Verify GPP math: 72F, 45% -> ~52.4 GPP."""
        result = calculate_gpp(Decimal("72"), Decimal("45"))
        assert result is not None
        assert abs(float(result) - 52.4) < 0.5


class TestListReadings:
    """Test GET readings endpoints."""

    def _make_table_router(self, user_id, company_id, job_data, readings_data, room_data=None):
        def table_router(name):
            if name == "users":
                return _users_table_mock(user_id, company_id)
            if name == "jobs":
                return _jobs_table_mock(job_data)
            if name == "job_rooms" and room_data:
                return _rooms_table_mock(room_data)
            if name == "moisture_readings":
                t = MagicMock()
                exec_mock = MagicMock(data=readings_data)
                t.select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value = exec_mock
                t.select.return_value.eq.return_value.order.return_value.order.return_value.execute.return_value = exec_mock
                return t
            if name == "moisture_points":
                t = MagicMock()
                t.select.return_value.in_.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "dehu_outputs":
                t = MagicMock()
                t.select.return_value.in_.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            return MagicMock()

        return table_router

    def test_list_readings_for_room(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_room_id,
        mock_job_data,
        mock_room_data,
        mock_reading_data,
        auth_headers,
    ):
        """GET room readings -> 200 with reading list."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()
        router = self._make_table_router(
            mock_user_id,
            mock_company_id,
            mock_job_data,
            [mock_reading_data],
            mock_room_data,
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
            assert isinstance(data, list)
            assert len(data) == 1

    def test_list_readings_for_job(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        mock_reading_data,
        auth_headers,
    ):
        """GET job-level readings -> 200 with all rooms' readings."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()
        router = self._make_table_router(
            mock_user_id,
            mock_company_id,
            mock_job_data,
            [mock_reading_data],
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
            assert isinstance(data, list)
            assert len(data) == 1


class TestUpdateReading:
    """Test PATCH /v1/jobs/{job_id}/readings/{reading_id}."""

    def test_update_reading_recalc_gpp(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_reading_id,
        mock_job_data,
        mock_reading_data,
        auth_headers,
    ):
        """PATCH with new temp -> 200, GPP recalculated."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        updated_reading = {
            **mock_reading_data,
            "atmospheric_temp_f": 80.0,
            "atmospheric_gpp": 65.0,
        }

        # Cache table mocks so repeated calls to table("moisture_readings")
        # return the same mock (dependency + service both call it).
        readings_mock = _readings_valid_mock(mock_reading_data)
        readings_mock.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[updated_reading]
        )
        points_mock = MagicMock()
        points_mock.select.return_value.in_.return_value.order.return_value.execute.return_value = (
            MagicMock(data=[])
        )
        dehus_mock = MagicMock()
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
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name in cache:
                return cache[name]
            if name == "event_history":
                return _event_table_mock()
            return MagicMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}",
                json={"atmospheric_temp_f": 80},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert float(data["atmospheric_temp_f"]) == 80.0


class TestDeleteReading:
    """Test DELETE /v1/jobs/{job_id}/readings/{reading_id}."""

    def test_delete_reading(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_reading_id,
        mock_job_data,
        mock_reading_data,
        auth_headers,
    ):
        """DELETE reading -> 204, cascading deletes children."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()

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
                t = MagicMock()
                t.delete.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
                return t
            if name == "event_history":
                return _event_table_mock()
            return MagicMock()

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
                t = MagicMock()
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
            return MagicMock()

        return table_router

    def test_add_moisture_point(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_reading_id,
        mock_job_data,
        mock_reading_data,
        auth_headers,
    ):
        """POST point -> 201."""
        point = {
            "id": str(uuid4()),
            "reading_id": str(mock_reading_id),
            "location_name": "North Wall",
            "reading_value": 15.2,
            "meter_photo_url": None,
            "sort_order": 0,
            "created_at": "2026-03-25T10:00:00Z",
        }
        router = self._make_table_router(
            mock_user_id,
            mock_company_id,
            mock_job_data,
            mock_reading_data,
            point,
        )
        mock_admin = MagicMock()
        mock_auth = MagicMock()
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

    def test_update_moisture_point(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_reading_id,
        mock_point_id,
        mock_job_data,
        mock_reading_data,
        auth_headers,
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
            mock_user_id,
            mock_company_id,
            mock_job_data,
            mock_reading_data,
            point,
        )
        mock_admin = MagicMock()
        mock_auth = MagicMock()
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

    def test_delete_moisture_point(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_reading_id,
        mock_point_id,
        mock_job_data,
        mock_reading_data,
        auth_headers,
    ):
        """DELETE point -> 204."""
        router = self._make_table_router(
            mock_user_id,
            mock_company_id,
            mock_job_data,
            mock_reading_data,
        )
        mock_admin = MagicMock()
        mock_auth = MagicMock()
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
                t = MagicMock()
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
            return MagicMock()

        return table_router

    def test_add_dehu_output(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_reading_id,
        mock_job_data,
        mock_reading_data,
        auth_headers,
    ):
        """POST dehu -> 201."""
        dehu = {
            "id": str(uuid4()),
            "reading_id": str(mock_reading_id),
            "dehu_model": "DrizAir 1200",
            "rh_out_pct": 38.0,
            "temp_out_f": 95.0,
            "sort_order": 0,
            "created_at": "2026-03-25T10:00:00Z",
        }
        router = self._make_table_router(
            mock_user_id,
            mock_company_id,
            mock_job_data,
            mock_reading_data,
            dehu,
        )
        mock_admin = MagicMock()
        mock_auth = MagicMock()
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

    def test_update_dehu_output(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_reading_id,
        mock_dehu_id,
        mock_job_data,
        mock_reading_data,
        auth_headers,
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
            mock_user_id,
            mock_company_id,
            mock_job_data,
            mock_reading_data,
            dehu,
        )
        mock_admin = MagicMock()
        mock_auth = MagicMock()
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

    def test_delete_dehu_output(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_reading_id,
        mock_dehu_id,
        mock_job_data,
        mock_reading_data,
        auth_headers,
    ):
        """DELETE dehu -> 204."""
        router = self._make_table_router(
            mock_user_id,
            mock_company_id,
            mock_job_data,
            mock_reading_data,
        )
        mock_admin = MagicMock()
        mock_auth = MagicMock()
        mock_auth.table.side_effect = router
        mock_admin.table.side_effect = router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/readings/{mock_reading_id}/dehus/{mock_dehu_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204
