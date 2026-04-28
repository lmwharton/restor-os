"""Tests for photos endpoints (Spec 03 -- Photos).

Covers:
- POST /v1/jobs/{job_id}/photos/upload-url
- POST /v1/jobs/{job_id}/photos/confirm
- GET  /v1/jobs/{job_id}/photos  (flat + grouped + filters)
- PATCH /v1/jobs/{job_id}/photos/{photo_id}
- DELETE /v1/jobs/{job_id}/photos/{photo_id}
- POST /v1/jobs/{job_id}/photos/bulk-select
- POST /v1/jobs/{job_id}/photos/bulk-tag
"""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from tests.conftest import AsyncSupabaseMock
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from api.config import settings
from api.main import app

# ---------------------------------------------------------------------------
# Constants & helpers
# ---------------------------------------------------------------------------

MOCK_NOW = "2026-03-25T12:00:00Z"


def _photo_row(
    photo_id=None,
    job_id=None,
    company_id=None,
    *,
    room_id=None,
    room_name=None,
    storage_url=None,
    filename="damage_photo.jpg",
    caption=None,
    photo_type="damage",
    selected_for_ai=False,
    uploaded_at=MOCK_NOW,
):
    """Build a realistic photo row dict."""
    _job_id = job_id or uuid4()
    _company_id = company_id or uuid4()
    _photo_id = photo_id or uuid4()
    return {
        "id": str(_photo_id),
        "job_id": str(_job_id),
        "company_id": str(_company_id),
        "room_id": str(room_id) if room_id else None,
        "room_name": room_name,
        "storage_url": storage_url or f"{_company_id}/{_job_id}/{_photo_id}.jpg",
        "filename": filename,
        "caption": caption,
        "photo_type": photo_type,
        "selected_for_ai": selected_for_ai,
        "uploaded_at": uploaded_at,
    }


def _make_mock_client(user_row, table_handlers=None):
    """Create a mock Supabase client with auth + table routing.

    Args:
        user_row: User row for auth middleware lookup.
        table_handlers: Dict of {table_name: callable(mock_table, call_num)}
    """
    mock_client = AsyncSupabaseMock()
    call_counts: dict[str, int] = {}

    def table_side_effect(table_name):
        mock_table = AsyncSupabaseMock()
        call_counts.setdefault(table_name, 0)
        call_counts[table_name] += 1

        if table_name == "users":
            # Auth middleware uses .maybe_single() (commit 7423ce2).
            (
                mock_table.select.return_value
                .eq.return_value
                .is_.return_value
                .maybe_single.return_value
                .execute.return_value
            ).data = user_row
        elif table_name == "event_history":
            mock_table.insert.return_value.execute.return_value = AsyncSupabaseMock()
        elif table_handlers and table_name in table_handlers:
            table_handlers[table_name](mock_table, call_counts[table_name])
        return mock_table

    mock_client.table.side_effect = table_side_effect
    return mock_client


def _patch_all(jwt_secret, mock_client, *, admin_storage=None):
    """Context manager combining all patches needed for photo tests.

    Parameters
    ----------
    jwt_secret : str
        The JWT secret for token validation.
    mock_client : MagicMock
        The unified mock Supabase client (handles auth, jobs, photos tables).
    admin_storage : MagicMock | None
        Optional separate admin mock for storage operations. If None, a
        default mock is created that returns plausible signed URLs.
    """
    if admin_storage is None:
        admin_storage = AsyncSupabaseMock()
        # Default signed URL generation
        admin_storage.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.supabase.co/signed/photo.jpg"
        }
        admin_storage.storage.from_.return_value.create_signed_urls.return_value = []

    @contextmanager
    def _ctx():
        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ),
            patch(
                "api.shared.dependencies.get_authenticated_client",
                return_value=mock_client,
            ),
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_client,
            ),
            patch(
                "api.photos.service.get_supabase_admin_client",
                return_value=admin_storage,
            ),
            patch(
                "api.shared.events.get_supabase_admin_client",
                return_value=mock_client,
            ),
        ):
            yield

    return _ctx()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def jwt_secret():
    return "test-secret-for-photos"


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
def mock_photo_id():
    return uuid4()


@pytest.fixture
def mock_room_id():
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
def mock_job_row(mock_job_id, mock_company_id):
    return {
        "id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "status": "in_progress",
        "deleted_at": None,
    }


@pytest.fixture
def mock_user_row(mock_user_id, mock_auth_user_id, mock_company_id):
    return {
        "id": str(mock_user_id),
        "auth_user_id": str(mock_auth_user_id),
        "company_id": str(mock_company_id),
        "role": "owner",
        "is_platform_admin": False,
    }


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/photos/upload-url
# ---------------------------------------------------------------------------


class TestUploadUrl:
    """Test POST /v1/jobs/{job_id}/photos/upload-url."""

    def test_upload_url_success_jpeg(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_company_id,
        mock_user_row, mock_job_row,
    ):
        """Valid JPEG upload request returns 200 with upload_url and .jpg path."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            # photo count check
            count_result = AsyncSupabaseMock()
            count_result.count = 5
            count_result.data = []
            (
                mock_table.select.return_value
                .eq.return_value
                .execute.return_value
            ) = count_result

        admin_storage = AsyncSupabaseMock()
        admin_storage.storage.from_.return_value.create_signed_upload_url.return_value = {
            "signedURL": "https://storage.supabase.co/upload/signed/abc123"
        }

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client, admin_storage=admin_storage):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/upload-url",
                json={"filename": "damage.jpg", "content_type": "image/jpeg"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "upload_url" in data
            assert "storage_path" in data
            assert data["storage_path"].endswith(".jpg")
            assert str(mock_company_id) in data["storage_path"]

    def test_upload_url_success_png(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_company_id,
        mock_user_row, mock_job_row,
    ):
        """Valid PNG upload request returns 200 with .png path."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            count_result = AsyncSupabaseMock()
            count_result.count = 0
            count_result.data = []
            (
                mock_table.select.return_value
                .eq.return_value
                .execute.return_value
            ) = count_result

        admin_storage = AsyncSupabaseMock()
        admin_storage.storage.from_.return_value.create_signed_upload_url.return_value = {
            "signedURL": "https://storage.supabase.co/upload/signed/abc123"
        }

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client, admin_storage=admin_storage):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/upload-url",
                json={"filename": "damage.png", "content_type": "image/png"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["storage_path"].endswith(".png")

    def test_upload_url_invalid_content_type(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_user_row, mock_job_row,
    ):
        """Invalid content_type (application/pdf) returns 400 INVALID_FILE_TYPE."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/upload-url",
                json={"filename": "doc.pdf", "content_type": "application/pdf"},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_FILE_TYPE"

    def test_upload_url_limit_reached(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_user_row, mock_job_row,
    ):
        """When 100 photos already exist, returns 400 PHOTO_LIMIT_REACHED."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            count_result = AsyncSupabaseMock()
            count_result.count = 100
            count_result.data = []
            (
                mock_table.select.return_value
                .eq.return_value
                .execute.return_value
            ) = count_result

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/upload-url",
                json={"filename": "photo.jpg", "content_type": "image/jpeg"},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "PHOTO_LIMIT_REACHED"

    def test_upload_url_no_auth(self, client, mock_job_id):
        """Missing Authorization header returns 401."""
        response = client.post(
            f"/v1/jobs/{mock_job_id}/photos/upload-url",
            json={"filename": "damage.jpg", "content_type": "image/jpeg"},
        )
        assert response.status_code == 401

    def test_upload_url_missing_filename(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_user_row, mock_job_row,
    ):
        """Missing required filename field returns 422."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/upload-url",
                json={"content_type": "image/jpeg"},
                headers=auth_headers,
            )
            assert response.status_code == 422


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/photos/confirm
# ---------------------------------------------------------------------------


class TestConfirmPhoto:
    """Test POST /v1/jobs/{job_id}/photos/confirm."""

    def test_confirm_photo_success(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_company_id,
        mock_user_row, mock_job_row,
    ):
        """Confirm photo upload returns 201 with photo response."""
        photo_id = uuid4()
        row = _photo_row(
            photo_id=photo_id, job_id=mock_job_id, company_id=mock_company_id,
        )

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            mock_table.insert.return_value.execute.return_value.data = [row]

        admin_storage = AsyncSupabaseMock()
        admin_storage.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.supabase.co/signed/photo.jpg"
        }
        # Resize: download returns bytes, but we mock _resize_photo at service level
        admin_storage.storage.from_.return_value.download.side_effect = Exception("skip resize")

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client, admin_storage=admin_storage):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/confirm",
                json={
                    "storage_path": f"{mock_company_id}/{mock_job_id}/test.jpg",
                    "filename": "damage_photo.jpg",
                    "photo_type": "damage",
                },
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["id"] == str(photo_id)
            assert data["photo_type"] == "damage"
            assert data["filename"] == "damage_photo.jpg"
            assert data["selected_for_ai"] is False
            assert "storage_url" in data

    def test_confirm_photo_with_room(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_company_id,
        mock_room_id, mock_user_row, mock_job_row,
    ):
        """Confirm with room_id and room_name populates room fields."""
        row = _photo_row(
            job_id=mock_job_id, company_id=mock_company_id,
            room_id=mock_room_id, room_name="Kitchen",
        )

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            mock_table.insert.return_value.execute.return_value.data = [row]

        admin_storage = AsyncSupabaseMock()
        admin_storage.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.supabase.co/signed/photo.jpg"
        }
        admin_storage.storage.from_.return_value.download.side_effect = Exception("skip resize")

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client, admin_storage=admin_storage):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/confirm",
                json={
                    "storage_path": f"{mock_company_id}/{mock_job_id}/test.jpg",
                    "filename": "kitchen_damage.jpg",
                    "photo_type": "damage",
                    "room_id": str(mock_room_id),
                    "room_name": "Kitchen",
                },
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["room_id"] == str(mock_room_id)
            assert data["room_name"] == "Kitchen"

    def test_confirm_photo_invalid_type(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_company_id,
        mock_user_row, mock_job_row,
    ):
        """Confirm with invalid photo_type returns 400 INVALID_PHOTO_TYPE."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/confirm",
                json={
                    "storage_path": f"{mock_company_id}/{mock_job_id}/test.jpg",
                    "filename": "photo.jpg",
                    "photo_type": "selfie",
                },
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_PHOTO_TYPE"

    def test_confirm_photo_insert_fails(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_company_id,
        mock_user_row, mock_job_row,
    ):
        """When DB insert returns no data, returns 500 PHOTO_CREATE_FAILED."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            mock_table.insert.return_value.execute.return_value.data = []

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/confirm",
                json={
                    "storage_path": f"{mock_company_id}/{mock_job_id}/test.jpg",
                    "photo_type": "damage",
                },
                headers=auth_headers,
            )
            assert response.status_code == 500
            assert response.json()["error_code"] == "PHOTO_CREATE_FAILED"

    @pytest.mark.parametrize(
        "photo_type",
        ["damage", "equipment", "protection", "containment", "moisture_reading", "before", "after"],
    )
    def test_confirm_all_valid_photo_types(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_company_id,
        mock_user_row, mock_job_row, photo_type,
    ):
        """All 7 valid photo_type values are accepted."""
        row = _photo_row(
            job_id=mock_job_id, company_id=mock_company_id, photo_type=photo_type,
        )

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            mock_table.insert.return_value.execute.return_value.data = [row]

        admin_storage = AsyncSupabaseMock()
        admin_storage.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.supabase.co/signed/photo.jpg"
        }
        admin_storage.storage.from_.return_value.download.side_effect = Exception("skip")

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client, admin_storage=admin_storage):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/confirm",
                json={
                    "storage_path": f"{mock_company_id}/{mock_job_id}/test.jpg",
                    "photo_type": photo_type,
                },
                headers=auth_headers,
            )
            assert response.status_code == 201
            assert response.json()["photo_type"] == photo_type


# ---------------------------------------------------------------------------
# GET /v1/jobs/{job_id}/photos
# ---------------------------------------------------------------------------


class TestListPhotos:
    """Test GET /v1/jobs/{job_id}/photos."""

    def test_list_photos_flat(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_company_id,
        mock_user_row, mock_job_row,
    ):
        """GET without group_by returns flat items list with signed URLs."""
        row = _photo_row(job_id=mock_job_id, company_id=mock_company_id)
        storage_path = row["storage_url"]

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            list_result = AsyncSupabaseMock()
            list_result.data = [row]
            list_result.count = 1
            (
                mock_table.select.return_value
                .eq.return_value
                .order.return_value
                .range.return_value
                .execute.return_value
            ) = list_result

        admin_storage = AsyncSupabaseMock()
        admin_storage.storage.from_.return_value.create_signed_urls.return_value = [
            {"path": storage_path, "signedURL": "https://storage.supabase.co/signed/photo.jpg"}
        ]

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client, admin_storage=admin_storage):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/photos",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "items" in data
            assert data["total"] == 1
            assert len(data["items"]) == 1
            assert data["items"][0]["filename"] == "damage_photo.jpg"

    def test_list_photos_empty(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_user_row, mock_job_row,
    ):
        """GET on job with no photos returns empty items and total=0."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            list_result = AsyncSupabaseMock()
            list_result.data = []
            list_result.count = 0
            (
                mock_table.select.return_value
                .eq.return_value
                .order.return_value
                .range.return_value
                .execute.return_value
            ) = list_result

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/photos",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["items"] == []
            assert data["total"] == 0

    def test_list_photos_grouped_by_room(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_company_id,
        mock_room_id, mock_user_row, mock_job_row,
    ):
        """GET with group_by=room returns grouped response."""
        row_with_room = _photo_row(
            job_id=mock_job_id, company_id=mock_company_id,
            room_id=mock_room_id, room_name="Kitchen",
        )
        row_no_room = _photo_row(
            job_id=mock_job_id, company_id=mock_company_id,
            filename="hallway.jpg",
        )

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            # group_by=room skips .range() — calls .execute() directly after .order()
            list_result = AsyncSupabaseMock()
            list_result.data = [row_with_room, row_no_room]
            list_result.count = 2
            (
                mock_table.select.return_value
                .eq.return_value
                .order.return_value
                .execute.return_value
            ) = list_result

        admin_storage = AsyncSupabaseMock()
        admin_storage.storage.from_.return_value.create_signed_urls.return_value = [
            {"path": row_with_room["storage_url"], "signedURL": "https://signed/1.jpg"},
            {"path": row_no_room["storage_url"], "signedURL": "https://signed/2.jpg"},
        ]

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client, admin_storage=admin_storage):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/photos?group_by=room",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "groups" in data
            assert data["total"] == 2
            # Two groups: one for the room, one for unassigned (room_id=None)
            assert len(data["groups"]) == 2

    def test_list_photos_filter_by_room(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_company_id,
        mock_room_id, mock_user_row, mock_job_row,
    ):
        """GET with room_id filter returns only matching photos."""
        row = _photo_row(
            job_id=mock_job_id, company_id=mock_company_id,
            room_id=mock_room_id, room_name="Kitchen",
        )

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            list_result = AsyncSupabaseMock()
            list_result.data = [row]
            list_result.count = 1
            # With room_id filter: .eq().order().eq().range().execute()
            (
                mock_table.select.return_value
                .eq.return_value
                .order.return_value
                .eq.return_value
                .range.return_value
                .execute.return_value
            ) = list_result

        admin_storage = AsyncSupabaseMock()
        admin_storage.storage.from_.return_value.create_signed_urls.return_value = [
            {"path": row["storage_url"], "signedURL": "https://signed/1.jpg"}
        ]

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client, admin_storage=admin_storage):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/photos?room_id={mock_room_id}",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 1
            assert data["items"][0]["room_id"] == str(mock_room_id)

    def test_list_photos_filter_invalid_photo_type(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_user_row, mock_job_row,
    ):
        """GET with invalid photo_type filter returns 400."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/photos?photo_type=selfie",
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_PHOTO_TYPE"

    def test_list_photos_no_auth(self, client, mock_job_id):
        """GET without auth returns 401."""
        response = client.get(f"/v1/jobs/{mock_job_id}/photos")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# PATCH /v1/jobs/{job_id}/photos/{photo_id}
# ---------------------------------------------------------------------------


class TestUpdatePhoto:
    """Test PATCH /v1/jobs/{job_id}/photos/{photo_id}."""

    def test_update_photo_caption(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_photo_id,
        mock_company_id, mock_user_row, mock_job_row,
    ):
        """PATCH caption returns 200 with updated caption."""
        updated_row = _photo_row(
            photo_id=mock_photo_id, job_id=mock_job_id, company_id=mock_company_id,
            caption="Water damage in corner",
        )

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            (
                mock_table.update.return_value
                .eq.return_value
                .eq.return_value
                .eq.return_value
                .execute.return_value
            ).data = [updated_row]

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                json={"caption": "Water damage in corner"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["caption"] == "Water damage in corner"

    def test_update_photo_type(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_photo_id,
        mock_company_id, mock_user_row, mock_job_row,
    ):
        """PATCH photo_type to 'before' returns 200."""
        updated_row = _photo_row(
            photo_id=mock_photo_id, job_id=mock_job_id, company_id=mock_company_id,
            photo_type="before",
        )

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            (
                mock_table.update.return_value
                .eq.return_value
                .eq.return_value
                .eq.return_value
                .execute.return_value
            ).data = [updated_row]

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                json={"photo_type": "before"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["photo_type"] == "before"

    def test_update_photo_selected_for_ai(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_photo_id,
        mock_company_id, mock_user_row, mock_job_row,
    ):
        """PATCH selected_for_ai=true returns 200."""
        updated_row = _photo_row(
            photo_id=mock_photo_id, job_id=mock_job_id, company_id=mock_company_id,
            selected_for_ai=True,
        )

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            (
                mock_table.update.return_value
                .eq.return_value
                .eq.return_value
                .eq.return_value
                .execute.return_value
            ).data = [updated_row]

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                json={"selected_for_ai": True},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["selected_for_ai"] is True

    def test_update_photo_room_auto_resolves_name(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_photo_id,
        mock_company_id, mock_room_id, mock_user_row, mock_job_row,
    ):
        """PATCH with room_id only auto-resolves room_name from job_rooms."""
        updated_row = _photo_row(
            photo_id=mock_photo_id, job_id=mock_job_id, company_id=mock_company_id,
            room_id=mock_room_id, room_name="Kitchen",
        )

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            # update_photo calls client.table("photos") for update
            (
                mock_table.update.return_value
                .eq.return_value
                .eq.return_value
                .eq.return_value
                .execute.return_value
            ).data = [updated_row]

        def job_rooms_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .single.return_value
                .execute.return_value
            ).data = {"room_name": "Kitchen"}

        mock_client = _make_mock_client(
            mock_user_row,
            {"jobs": jobs_handler, "photos": photos_handler, "job_rooms": job_rooms_handler},
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                json={"room_id": str(mock_room_id)},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["room_id"] == str(mock_room_id)
            assert data["room_name"] == "Kitchen"

    def test_update_photo_invalid_type(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_photo_id,
        mock_user_row, mock_job_row,
    ):
        """PATCH with invalid photo_type returns 400."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                json={"photo_type": "panorama"},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_PHOTO_TYPE"

    def test_update_photo_empty_body(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_photo_id,
        mock_user_row, mock_job_row,
    ):
        """PATCH with all-null fields returns 400 NO_UPDATE_FIELDS."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                json={},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "NO_UPDATE_FIELDS"

    def test_update_photo_not_found(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_photo_id,
        mock_user_row, mock_job_row,
    ):
        """PATCH on non-existent photo returns 404."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            (
                mock_table.update.return_value
                .eq.return_value
                .eq.return_value
                .eq.return_value
                .execute.return_value
            ).data = []

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                json={"caption": "test"},
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "PHOTO_NOT_FOUND"


# ---------------------------------------------------------------------------
# DELETE /v1/jobs/{job_id}/photos/{photo_id}
# ---------------------------------------------------------------------------


class TestDeletePhoto:
    """Test DELETE /v1/jobs/{job_id}/photos/{photo_id}."""

    def test_delete_photo_success(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_photo_id,
        mock_company_id, mock_user_row, mock_job_row,
    ):
        """DELETE existing photo returns 204, removes from storage + hard-deletes DB record."""
        storage_path = f"{mock_company_id}/{mock_job_id}/test.jpg"

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            if call_num == 1:
                # fetch photo
                (
                    mock_table.select.return_value
                    .eq.return_value
                    .eq.return_value
                    .eq.return_value
                    .single.return_value
                    .execute.return_value
                ).data = {"id": str(mock_photo_id), "storage_url": storage_path}
            elif call_num == 2:
                # hard delete
                (
                    mock_table.delete.return_value
                    .eq.return_value
                    .execute.return_value
                ).data = []

        admin_storage = AsyncSupabaseMock()

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client, admin_storage=admin_storage):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204

            # Verify storage removal was called
            admin_storage.storage.from_.return_value.remove.assert_called_once_with(
                [storage_path]
            )

    def test_delete_photo_not_found(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_photo_id,
        mock_user_row, mock_job_row,
    ):
        """DELETE non-existent photo returns 404."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .eq.return_value
                .single.return_value
                .execute.return_value
            ).data = None

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "PHOTO_NOT_FOUND"

    def test_delete_photo_storage_failure_still_deletes_db(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_photo_id,
        mock_company_id, mock_user_row, mock_job_row,
    ):
        """Storage removal failure is best-effort; DB record is still deleted."""
        storage_path = f"{mock_company_id}/{mock_job_id}/test.jpg"

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            if call_num == 1:
                (
                    mock_table.select.return_value
                    .eq.return_value
                    .eq.return_value
                    .eq.return_value
                    .single.return_value
                    .execute.return_value
                ).data = {"id": str(mock_photo_id), "storage_url": storage_path}
            elif call_num == 2:
                (
                    mock_table.delete.return_value
                    .eq.return_value
                    .execute.return_value
                ).data = []

        admin_storage = AsyncSupabaseMock()
        admin_storage.storage.from_.return_value.remove.side_effect = Exception("Storage error")

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client, admin_storage=admin_storage):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                headers=auth_headers,
            )
            # Should still succeed despite storage failure
            assert response.status_code == 204

    def test_delete_photo_no_auth(self, client, mock_job_id, mock_photo_id):
        """DELETE without auth returns 401."""
        response = client.delete(f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/photos/bulk-select
# ---------------------------------------------------------------------------


class TestBulkSelect:
    """Test POST /v1/jobs/{job_id}/photos/bulk-select."""

    def test_bulk_select_success(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_user_row, mock_job_row,
    ):
        """Bulk select 2 photos returns updated=2."""
        photo_id_1 = uuid4()
        photo_id_2 = uuid4()

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            (
                mock_table.update.return_value
                .in_.return_value
                .eq.return_value
                .eq.return_value
                .execute.return_value
            ).data = [
                {"id": str(photo_id_1), "selected_for_ai": True},
                {"id": str(photo_id_2), "selected_for_ai": True},
            ]

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/bulk-select",
                json={
                    "photo_ids": [str(photo_id_1), str(photo_id_2)],
                    "selected_for_ai": True,
                },
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["updated"] == 2

    def test_bulk_select_deselect(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_user_row, mock_job_row,
    ):
        """Bulk deselect (selected_for_ai=false) returns updated count."""
        photo_id = uuid4()

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def photos_handler(mock_table, call_num):
            (
                mock_table.update.return_value
                .in_.return_value
                .eq.return_value
                .eq.return_value
                .execute.return_value
            ).data = [{"id": str(photo_id), "selected_for_ai": False}]

        mock_client = _make_mock_client(
            mock_user_row, {"jobs": jobs_handler, "photos": photos_handler}
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/bulk-select",
                json={
                    "photo_ids": [str(photo_id)],
                    "selected_for_ai": False,
                },
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["updated"] == 1

    def test_bulk_select_empty_ids(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_user_row, mock_job_row,
    ):
        """Bulk select with empty photo_ids list returns 422 (min_length=1)."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/bulk-select",
                json={"photo_ids": [], "selected_for_ai": True},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_bulk_select_no_auth(self, client, mock_job_id):
        """Bulk select without auth returns 401."""
        response = client.post(
            f"/v1/jobs/{mock_job_id}/photos/bulk-select",
            json={"photo_ids": [str(uuid4())], "selected_for_ai": True},
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/photos/bulk-tag
# ---------------------------------------------------------------------------


class TestBulkTag:
    """Test POST /v1/jobs/{job_id}/photos/bulk-tag."""

    def test_bulk_tag_success(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_room_id, mock_user_row, mock_job_row,
    ):
        """Bulk tag 1 photo to a room returns updated=1."""
        photo_id = uuid4()

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def job_rooms_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .in_.return_value
                .eq.return_value
                .execute.return_value
            ).data = [{"id": str(mock_room_id), "room_name": "Kitchen"}]

        def photos_handler(mock_table, call_num):
            (
                mock_table.update.return_value
                .eq.return_value
                .eq.return_value
                .eq.return_value
                .execute.return_value
            ).data = [{"id": str(photo_id)}]

        mock_client = _make_mock_client(
            mock_user_row,
            {"jobs": jobs_handler, "job_rooms": job_rooms_handler, "photos": photos_handler},
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/bulk-tag",
                json={
                    "assignments": [
                        {"photo_id": str(photo_id), "room_id": str(mock_room_id)},
                    ]
                },
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["updated"] == 1

    def test_bulk_tag_multiple_assignments(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_room_id, mock_user_row, mock_job_row,
    ):
        """Bulk tag multiple photos to rooms."""
        photo_id_1 = uuid4()
        photo_id_2 = uuid4()
        room_id_2 = uuid4()

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def job_rooms_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .in_.return_value
                .eq.return_value
                .execute.return_value
            ).data = [
                {"id": str(mock_room_id), "room_name": "Kitchen"},
                {"id": str(room_id_2), "room_name": "Bathroom"},
            ]

        def photos_handler(mock_table, call_num):
            (
                mock_table.update.return_value
                .eq.return_value
                .eq.return_value
                .eq.return_value
                .execute.return_value
            ).data = [{"id": str(photo_id_1 if call_num == 1 else photo_id_2)}]

        mock_client = _make_mock_client(
            mock_user_row,
            {"jobs": jobs_handler, "job_rooms": job_rooms_handler, "photos": photos_handler},
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/bulk-tag",
                json={
                    "assignments": [
                        {"photo_id": str(photo_id_1), "room_id": str(mock_room_id)},
                        {"photo_id": str(photo_id_2), "room_id": str(room_id_2)},
                    ]
                },
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["updated"] == 2

    def test_bulk_tag_empty_assignments(
        self, client, auth_headers, jwt_secret, mock_job_id,
        mock_user_row, mock_job_row,
    ):
        """Bulk tag with empty assignments list returns 422 (min_length=1)."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/bulk-tag",
                json={"assignments": []},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_bulk_tag_no_auth(self, client, mock_job_id):
        """Bulk tag without auth returns 401."""
        response = client.post(
            f"/v1/jobs/{mock_job_id}/photos/bulk-tag",
            json={
                "assignments": [
                    {"photo_id": str(uuid4()), "room_id": str(uuid4())},
                ]
            },
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Service-level unit tests (no HTTP layer)
# ---------------------------------------------------------------------------


class TestServiceHelpers:
    """Unit tests for service helper functions."""

    def test_validate_photo_type_valid(self):
        from api.photos.service import _validate_photo_type
        # Should not raise for valid types
        for pt in ["damage", "equipment", "protection", "containment",
                    "moisture_reading", "before", "after"]:
            _validate_photo_type(pt)  # no exception = pass

    def test_validate_photo_type_invalid(self):
        from api.photos.service import _validate_photo_type
        from api.shared.exceptions import AppException

        with pytest.raises(AppException) as exc_info:
            _validate_photo_type("selfie")
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "INVALID_PHOTO_TYPE"

    def test_validate_content_type_valid(self):
        from api.photos.service import _validate_content_type
        _validate_content_type("image/jpeg")
        _validate_content_type("image/png")

    def test_validate_content_type_invalid(self):
        from api.photos.service import _validate_content_type
        from api.shared.exceptions import AppException

        with pytest.raises(AppException) as exc_info:
            _validate_content_type("image/gif")
        assert exc_info.value.error_code == "INVALID_FILE_TYPE"

    def test_file_extension(self):
        from api.photos.service import _file_extension
        assert _file_extension("image/jpeg") == "jpg"
        assert _file_extension("image/png") == "png"

    def test_build_photo_response(self):
        from api.photos.service import _build_photo_response
        row = _photo_row()
        result = _build_photo_response(row, "https://signed/url.jpg")
        assert result.storage_url == "https://signed/url.jpg"
        assert result.photo_type == "damage"
        assert result.selected_for_ai is False

    async def test_get_signed_url_dict_response(self):
        from api.photos.service import _get_signed_url
        admin = AsyncSupabaseMock()
        admin.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://signed/url.jpg"
        }
        result = await _get_signed_url("path/to/photo.jpg", admin=admin)
        assert result == "https://signed/url.jpg"

    async def test_get_signed_url_snake_case_response(self):
        from api.photos.service import _get_signed_url
        admin = AsyncSupabaseMock()
        admin.storage.from_.return_value.create_signed_url.return_value = {
            "signed_url": "https://signed/url2.jpg"
        }
        result = await _get_signed_url("path/to/photo.jpg", admin=admin)
        assert result == "https://signed/url2.jpg"

    async def test_get_signed_url_fallback_empty(self):
        from api.photos.service import _get_signed_url
        admin = AsyncSupabaseMock()
        admin.storage.from_.return_value.create_signed_url.return_value = {}
        result = await _get_signed_url("path/to/photo.jpg", admin=admin)
        assert result == ""

    async def test_get_signed_urls_batch_empty(self):
        from api.photos.service import _get_signed_urls_batch
        result = await _get_signed_urls_batch([])
        assert result == {}
