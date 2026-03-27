"""Tests for photos endpoints (Spec 03 — Photos)."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from api.config import settings
from api.main import app

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MOCK_NOW = "2026-03-25T12:00:00Z"


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


@pytest.fixture
def mock_photo_row(mock_photo_id, mock_job_id, mock_company_id):
    return {
        "id": str(mock_photo_id),
        "job_id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "room_id": None,
        "room_name": None,
        "storage_url": f"{mock_company_id}/{mock_job_id}/test-photo.jpg",
        "filename": "damage_photo.jpg",
        "caption": None,
        "photo_type": "damage",
        "selected_for_ai": False,
        "uploaded_at": MOCK_NOW,
    }


def _setup_mocks(jwt_secret, mock_user_row, mock_job_row):
    """Return context managers for auth + job validation."""
    mock_admin = MagicMock()
    (
        mock_admin.table.return_value.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
    ).data = mock_user_row

    mock_auth_client = MagicMock()
    (
        mock_auth_client.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
    ).data = mock_job_row

    return (
        patch.object(settings, "supabase_jwt_secret", jwt_secret),
        patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_admin),
        patch(
            "api.shared.dependencies.get_authenticated_client",
            return_value=mock_auth_client,
        ),
        patch("api.shared.events.get_supabase_admin_client", return_value=MagicMock()),
    )


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/photos/upload-url
# ---------------------------------------------------------------------------


class TestUploadUrl:
    """Test POST /v1/jobs/{job_id}/photos/upload-url."""

    def test_upload_url_success(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_company_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with valid content_type -> 200 with upload_url and storage_path."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = MagicMock()
        # photo count check
        count_result = MagicMock()
        count_result.count = 5
        count_result.data = []
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.execute.return_value
        ) = count_result

        mock_admin_storage = MagicMock()
        mock_admin_storage.storage.from_.return_value.create_signed_upload_url.return_value = {
            "signedURL": "https://storage.supabase.co/upload/signed/abc123"
        }

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
            patch(
                "api.photos.service.get_supabase_admin_client",
                return_value=mock_admin_storage,
            ),
        ):
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

    def test_upload_url_invalid_type(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with invalid content_type -> 400 INVALID_FILE_TYPE."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/upload-url",
                json={"filename": "doc.pdf", "content_type": "application/pdf"},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_FILE_TYPE"

    def test_upload_url_limit_reached(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST when 100 photos already exist -> 400 PHOTO_LIMIT_REACHED."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = MagicMock()
        count_result = MagicMock()
        count_result.count = 100
        count_result.data = []
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.execute.return_value
        ) = count_result

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/upload-url",
                json={"filename": "photo.jpg", "content_type": "image/jpeg"},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "PHOTO_LIMIT_REACHED"


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/photos/confirm
# ---------------------------------------------------------------------------


class TestConfirmPhoto:
    """Test POST /v1/jobs/{job_id}/photos/confirm."""

    def test_confirm_photo_success(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_company_id,
        mock_user_row,
        mock_job_row,
        mock_photo_row,
    ):
        """POST confirm -> 201 with photo response including signed URL."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = MagicMock()
        (mock_service_client.table.return_value.insert.return_value.execute.return_value).data = [
            mock_photo_row
        ]

        mock_admin_storage = MagicMock()
        mock_admin_storage.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.supabase.co/signed/photo.jpg"
        }

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
            patch(
                "api.photos.service.get_supabase_admin_client",
                return_value=mock_admin_storage,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/confirm",
                json={
                    "storage_path": f"{mock_company_id}/{mock_job_id}/test-photo.jpg",
                    "filename": "damage_photo.jpg",
                    "photo_type": "damage",
                },
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["photo_type"] == "damage"
            assert data["filename"] == "damage_photo.jpg"
            assert "storage_url" in data


# ---------------------------------------------------------------------------
# GET /v1/jobs/{job_id}/photos
# ---------------------------------------------------------------------------


class TestListPhotos:
    """Test GET /v1/jobs/{job_id}/photos."""

    def test_list_photos(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
        mock_photo_row,
    ):
        """GET -> 200 with items list and signed URLs."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = MagicMock()
        list_result = MagicMock()
        list_result.data = [mock_photo_row]
        list_result.count = 1
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value
        ) = list_result

        mock_admin_storage = MagicMock()
        mock_admin_storage.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.supabase.co/signed/photo.jpg"
        }

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
            patch(
                "api.photos.service.get_supabase_admin_client",
                return_value=mock_admin_storage,
            ),
        ):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/photos",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "items" in data
            assert data["total"] == 1
            assert len(data["items"]) == 1

    def test_list_photos_by_room(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_room_id,
        mock_user_row,
        mock_job_row,
        mock_photo_row,
    ):
        """GET with room_id filter -> 200, filtered photos returned."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        photo_with_room = {**mock_photo_row, "room_id": str(mock_room_id), "room_name": "Kitchen"}

        mock_service_client = MagicMock()
        list_result = MagicMock()
        list_result.data = [photo_with_room]
        list_result.count = 1
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.order.return_value.eq.return_value.range.return_value.execute.return_value
        ) = list_result

        mock_admin_storage = MagicMock()
        mock_admin_storage.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.supabase.co/signed/photo.jpg"
        }

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
            patch(
                "api.photos.service.get_supabase_admin_client",
                return_value=mock_admin_storage,
            ),
        ):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/photos?room_id={mock_room_id}",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 1
            assert data["items"][0]["room_id"] == str(mock_room_id)


# ---------------------------------------------------------------------------
# PATCH /v1/jobs/{job_id}/photos/{photo_id}
# ---------------------------------------------------------------------------


class TestUpdatePhoto:
    """Test PATCH /v1/jobs/{job_id}/photos/{photo_id}."""

    def test_update_photo_metadata(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_photo_id,
        mock_user_row,
        mock_job_row,
        mock_photo_row,
    ):
        """PATCH caption + photo_type -> 200 with updated fields."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        updated_row = {
            **mock_photo_row,
            "caption": "Water damage in corner",
            "photo_type": "before",
        }

        mock_service_client = MagicMock()
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [updated_row]

        mock_admin_storage = MagicMock()
        mock_admin_storage.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.supabase.co/signed/photo.jpg"
        }

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
            patch(
                "api.photos.service.get_supabase_admin_client",
                return_value=mock_admin_storage,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                json={"caption": "Water damage in corner", "photo_type": "before"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["caption"] == "Water damage in corner"
            assert data["photo_type"] == "before"

    def test_update_photo_room_resolves_name(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_photo_id,
        mock_room_id,
        mock_user_row,
        mock_job_row,
        mock_photo_row,
    ):
        """PATCH with room_id but no room_name -> auto-resolves room_name from DB."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        updated_row = {
            **mock_photo_row,
            "room_id": str(mock_room_id),
            "room_name": "Kitchen",
        }

        mock_service_client = MagicMock()
        # room name lookup
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {"room_name": "Kitchen"}
        # update result
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [updated_row]

        mock_admin_storage = MagicMock()
        mock_admin_storage.storage.from_.return_value.create_signed_url.return_value = {
            "signedURL": "https://storage.supabase.co/signed/photo.jpg"
        }

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
            patch(
                "api.photos.service.get_supabase_admin_client",
                return_value=mock_admin_storage,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                json={"room_id": str(mock_room_id)},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["room_id"] == str(mock_room_id)
            assert data["room_name"] == "Kitchen"


# ---------------------------------------------------------------------------
# DELETE /v1/jobs/{job_id}/photos/{photo_id}
# ---------------------------------------------------------------------------


class TestDeletePhoto:
    """Test DELETE /v1/jobs/{job_id}/photos/{photo_id}."""

    def test_delete_photo(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_photo_id,
        mock_company_id,
        mock_user_row,
        mock_job_row,
        mock_photo_row,
    ):
        """DELETE existing photo -> 204, removes from storage + DB."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = MagicMock()
        # fetch photo for storage_url
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {
            "id": str(mock_photo_id),
            "storage_url": f"{mock_company_id}/{mock_job_id}/test.jpg",
        }
        # delete
        (
            mock_service_client.table.return_value.delete.return_value.eq.return_value.execute.return_value
        ).data = []

        mock_admin_storage = MagicMock()

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
            patch(
                "api.photos.service.get_supabase_admin_client",
                return_value=mock_admin_storage,
            ),
        ):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/photos/{mock_photo_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/photos/bulk-select
# ---------------------------------------------------------------------------


class TestBulkSelect:
    """Test POST /v1/jobs/{job_id}/photos/bulk-select."""

    def test_bulk_select(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST bulk-select -> 200 with updated count."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        photo_id_1 = uuid4()
        photo_id_2 = uuid4()

        mock_service_client = MagicMock()
        (
            mock_service_client.table.return_value.update.return_value.in_.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [
            {"id": str(photo_id_1), "selected_for_ai": True},
            {"id": str(photo_id_2), "selected_for_ai": True},
        ]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/bulk-select",
                json={
                    "photo_ids": [str(photo_id_1), str(photo_id_2)],
                    "selected_for_ai": True,
                },
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["updated"] == 2


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/photos/bulk-tag
# ---------------------------------------------------------------------------


class TestBulkTag:
    """Test POST /v1/jobs/{job_id}/photos/bulk-tag."""

    def test_bulk_tag(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_room_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST bulk-tag -> 200 with updated count."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        photo_id_1 = uuid4()

        mock_service_client = MagicMock()
        # room names lookup
        (
            mock_service_client.table.return_value.select.return_value.in_.return_value.eq.return_value.execute.return_value
        ).data = [{"id": str(mock_room_id), "room_name": "Kitchen"}]
        # individual photo update
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [{"id": str(photo_id_1)}]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.photos.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/photos/bulk-tag",
                json={
                    "assignments": [
                        {"photo_id": str(photo_id_1), "room_id": str(mock_room_id)},
                    ]
                },
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["updated"] == 1
