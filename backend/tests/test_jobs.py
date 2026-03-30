"""Tests for Jobs CRUD endpoints (Spec 01).

Covers: create, list, get, update, delete (soft-delete).
Auth: missing token, expired token, user-not-found.
Validation: invalid payloads, missing required fields, enum validation.
Edge cases: not-found, duplicate job numbers, company_id mismatch, empty updates.
"""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch
from uuid import uuid4

import jwt as pyjwt
import pytest

from api.config import settings
from tests.conftest import make_mock_supabase

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NOW_ISO = "2026-03-26T00:00:00Z"


def _job_row(
    job_id=None,
    company_id=None,
    user_id=None,
    *,
    job_number="JOB-20260326-001",
    address_line1="456 Oak Ave",
    city="Troy",
    state="MI",
    zip_code="48083",
    loss_type="water",
    status="new",
    customer_name=None,
    customer_phone=None,
    customer_email=None,
    claim_number=None,
    carrier=None,
    adjuster_name=None,
    adjuster_phone=None,
    adjuster_email=None,
    loss_category=None,
    loss_class=None,
    loss_cause=None,
    loss_date=None,
    property_id=None,
    assigned_to=None,
    notes=None,
    tech_notes=None,
    latitude=None,
    longitude=None,
):
    """Build a realistic job row dict."""
    return {
        "id": str(job_id or uuid4()),
        "company_id": str(company_id or uuid4()),
        "property_id": str(property_id) if property_id else None,
        "job_number": job_number,
        "address_line1": address_line1,
        "city": city,
        "state": state,
        "zip": zip_code,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "customer_email": customer_email,
        "claim_number": claim_number,
        "carrier": carrier,
        "adjuster_name": adjuster_name,
        "adjuster_phone": adjuster_phone,
        "adjuster_email": adjuster_email,
        "loss_type": loss_type,
        "loss_category": loss_category,
        "loss_class": loss_class,
        "loss_cause": loss_cause,
        "loss_date": loss_date,
        "status": status,
        "assigned_to": str(assigned_to) if assigned_to else None,
        "notes": notes,
        "tech_notes": tech_notes,
        "latitude": latitude,
        "longitude": longitude,
        "created_by": str(user_id or uuid4()),
        "updated_by": None,
        "created_at": NOW_ISO,
        "updated_at": NOW_ISO,
    }


def _create_body(**overrides):
    """Build a job creation request body with required fields."""
    defaults = {
        "address_line1": "456 Oak Ave",
        "loss_type": "water",
    }
    defaults.update(overrides)
    return defaults


def _counts_handler(mock_table):
    """Handler for count tables (job_rooms, photos, floor_plans, line_items)."""
    result = MagicMock()
    result.count = 0
    mock_table.select.return_value.eq.return_value.execute.return_value = result


def _patch_all(jwt_secret, mock_client, mock_admin_client=None):
    """Context manager combining all patches needed for job tests.

    Args:
        jwt_secret: JWT secret for token verification.
        mock_client: Mock for authenticated client (RLS-scoped operations).
        mock_admin_client: Mock for admin client (soft-delete).
                           If None, uses mock_client for admin patches too.
    """
    admin = mock_admin_client or mock_client

    @contextmanager
    def _ctx():
        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ),
            patch(
                "api.jobs.service.get_authenticated_client",
                return_value=mock_client,
            ),
            patch(
                "api.jobs.service.get_supabase_admin_client",
                return_value=admin,
            ),
            patch(
                "api.shared.events.get_supabase_admin_client",
                return_value=mock_client,
            ),
        ):
            yield

    return _ctx()


# ---------------------------------------------------------------------------
# Tests: Auth (shared across endpoints)
# ---------------------------------------------------------------------------


class TestJobsAuth:
    """Auth validation tests applying to all job endpoints."""

    def test_no_auth_header_returns_401(self, client):
        """Request without Authorization header returns 401."""
        response = client.post("/v1/jobs", json=_create_body())
        assert response.status_code == 401

    def test_expired_token_returns_401(self, client, expired_token, jwt_secret):
        """Expired JWT returns 401 AUTH_TOKEN_EXPIRED."""
        mock_client = make_mock_supabase(None)
        with _patch_all(jwt_secret, mock_client):
            response = client.get(
                "/v1/jobs",
                headers={"Authorization": f"Bearer {expired_token}"},
            )
        assert response.status_code == 401
        assert response.json()["error_code"] == "AUTH_TOKEN_EXPIRED"

    def test_invalid_token_returns_401(self, client, jwt_secret):
        """Malformed JWT returns 401."""
        mock_client = make_mock_supabase(None)
        with _patch_all(jwt_secret, mock_client):
            response = client.get(
                "/v1/jobs",
                headers={"Authorization": "Bearer not-a-valid-jwt"},
            )
        assert response.status_code == 401

    def test_user_not_found_returns_401(
        self, client, auth_headers, jwt_secret
    ):
        """Valid JWT but user not in users table returns 401."""
        mock_client = make_mock_supabase(None)  # user_row=None
        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs", headers=auth_headers)
        assert response.status_code == 401
        assert response.json()["error_code"] == "AUTH_USER_NOT_FOUND"


# ---------------------------------------------------------------------------
# Tests: Create Job
# ---------------------------------------------------------------------------


class TestCreateJob:
    """POST /v1/jobs"""

    def test_create_job_success(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_user_row,
        mock_company_id,
        mock_user_id,
    ):
        """Create job with all fields returns 201 with auto-generated job_number."""
        job_id = uuid4()
        row = _job_row(
            job_id=job_id,
            company_id=mock_company_id,
            user_id=mock_user_id,
            customer_name="Brett Sodders",
            customer_phone="(586) 944-7700",
            loss_category="1",
            loss_class="2",
        )

        call_count = {"n": 0}

        def jobs_handler(mock_table):
            call_count["n"] += 1
            n = call_count["n"]
            if n == 1:
                # _generate_job_number: select().eq().like().order().limit().execute()
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = []
            elif n == 2:
                # insert().execute()
                mock_table.insert.return_value.execute.return_value.data = [row]

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            body = _create_body(
                customer_name="Brett Sodders",
                customer_phone="(586) 944-7700",
                loss_category="1",
                loss_class="2",
                city="Troy",
                state="MI",
                zip="48083",
            )
            response = client.post("/v1/jobs", json=body, headers=auth_headers)

        assert response.status_code == 201
        data = response.json()
        assert data["id"] == str(job_id)
        assert data["job_number"].startswith("JOB-")
        assert data["status"] == "new"
        assert data["room_count"] == 0
        assert data["photo_count"] == 0
        assert data["floor_plan_count"] == 0
        assert data["line_item_count"] == 0

    def test_create_job_minimal(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Create job with address + loss_type only returns 201."""
        row = _job_row(company_id=mock_company_id)

        call_count = {"n": 0}

        def jobs_handler(mock_table):
            call_count["n"] += 1
            if call_count["n"] == 1:
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = []
            elif call_count["n"] == 2:
                mock_table.insert.return_value.execute.return_value.data = [row]

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post("/v1/jobs", json=_create_body(), headers=auth_headers)

        assert response.status_code == 201

    def test_create_job_with_loss_date(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Create job with loss_date serializes correctly."""
        row = _job_row(company_id=mock_company_id, loss_date="2026-03-20")

        call_count = {"n": 0}

        def jobs_handler(mock_table):
            call_count["n"] += 1
            if call_count["n"] == 1:
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = []
            elif call_count["n"] == 2:
                mock_table.insert.return_value.execute.return_value.data = [row]

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            body = _create_body(loss_date="2026-03-20")
            response = client.post("/v1/jobs", json=body, headers=auth_headers)

        assert response.status_code == 201
        assert response.json()["loss_date"] == "2026-03-20"

    def test_create_job_with_property_id(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Create job with property_id links to property."""
        prop_id = uuid4()
        row = _job_row(company_id=mock_company_id, property_id=prop_id)

        call_count = {"n": 0}

        def jobs_handler(mock_table):
            call_count["n"] += 1
            if call_count["n"] == 1:
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = []
            elif call_count["n"] == 2:
                mock_table.insert.return_value.execute.return_value.data = [row]

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            body = _create_body(property_id=str(prop_id))
            response = client.post("/v1/jobs", json=body, headers=auth_headers)

        assert response.status_code == 201
        assert response.json()["property_id"] == str(prop_id)

    def test_create_job_invalid_loss_type(self, client, auth_headers, jwt_secret, mock_user_row):
        """Invalid loss_type returns 400 INVALID_LOSS_TYPE."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                "/v1/jobs",
                json=_create_body(loss_type="earthquake"),
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_LOSS_TYPE"

    def test_create_job_invalid_loss_category(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Invalid loss_category returns 400 INVALID_LOSS_CATEGORY."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                "/v1/jobs",
                json=_create_body(loss_category="5"),
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_LOSS_CATEGORY"

    def test_create_job_invalid_loss_class(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Invalid loss_class returns 400 INVALID_LOSS_CLASS."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                "/v1/jobs",
                json=_create_body(loss_class="5"),
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_LOSS_CLASS"

    def test_create_job_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.post("/v1/jobs", json=_create_body())
        assert response.status_code == 401

    def test_create_job_missing_address(self, client, auth_headers, jwt_secret, mock_user_row):
        """Missing required address_line1 returns 422."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                "/v1/jobs",
                json={"loss_type": "water"},
                headers=auth_headers,
            )

        assert response.status_code == 422

    def test_create_job_job_number_collision_retry(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Job number collision triggers retry and succeeds."""
        row = _job_row(company_id=mock_company_id, job_number="JOB-20260326-002")

        call_count = {"n": 0}

        def jobs_handler(mock_table):
            call_count["n"] += 1
            n = call_count["n"]
            if n == 1:
                # First _generate_job_number
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = []
            elif n == 2:
                # First insert fails with unique constraint violation
                mock_table.insert.return_value.execute.side_effect = Exception(
                    'duplicate key value violates unique constraint "jobs_job_number_unique"'
                )
            elif n == 3:
                # Second _generate_job_number
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = [{"job_number": "JOB-20260326-001"}]
            elif n == 4:
                # Second insert succeeds
                mock_table.insert.return_value.execute.return_value = MagicMock(data=[row])
                mock_table.insert.return_value.execute.side_effect = None

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post("/v1/jobs", json=_create_body(), headers=auth_headers)

        assert response.status_code == 201
        assert response.json()["job_number"] == "JOB-20260326-002"

    def test_create_job_insert_returns_empty(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Insert returning no data raises 500."""
        call_count = {"n": 0}

        def jobs_handler(mock_table):
            call_count["n"] += 1
            if call_count["n"] == 1:
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = []
            elif call_count["n"] == 2:
                mock_table.insert.return_value.execute.return_value.data = []

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post("/v1/jobs", json=_create_body(), headers=auth_headers)

        assert response.status_code == 500
        assert response.json()["error_code"] == "JOB_CREATE_FAILED"


# ---------------------------------------------------------------------------
# Tests: List Jobs
# ---------------------------------------------------------------------------


class TestListJobs:
    """GET /v1/jobs"""

    def test_list_jobs_empty(self, client, auth_headers, jwt_secret, mock_user_row):
        """Empty job list returns 200 with items=[] and total=0."""

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = []
            result.count = 0
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_jobs_with_results(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """List returns items with correct structure."""
        rows = [
            _job_row(company_id=mock_company_id, job_number="JOB-20260326-001"),
            _job_row(company_id=mock_company_id, job_number="JOB-20260326-002"),
        ]

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = rows
            result.count = 2
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["total"] == 2
        # Verify items have correct fields
        item = data["items"][0]
        assert "id" in item
        assert "job_number" in item
        assert "status" in item

    def test_list_jobs_with_status_filter(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Filter by status returns matching jobs."""
        rows = [_job_row(company_id=mock_company_id, status="mitigation")]

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = rows
            result.count = 1
            # With status filter: select().eq().is_().eq().order().range().execute()
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs?status=mitigation", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["total"] == 1

    def test_list_jobs_with_loss_type_filter(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Filter by loss_type returns matching jobs."""
        rows = [_job_row(company_id=mock_company_id, loss_type="fire")]

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = rows
            result.count = 1
            # With loss_type filter: select().eq().is_().eq().order().range().execute()
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs?loss_type=fire", headers=auth_headers)

        assert response.status_code == 200
        assert len(response.json()["items"]) == 1

    def test_list_jobs_with_search(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Search filter returns matching jobs."""
        rows = [_job_row(company_id=mock_company_id, customer_name="Brett")]

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = rows
            result.count = 1
            # With search (or_): select().eq().is_().or_().order().range().execute()
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.or_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs?search=Brett", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1

    def test_list_jobs_malicious_search_sanitized(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Malicious search input with PostgREST operators is sanitized."""
        rows = [_job_row(company_id=mock_company_id)]

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = rows
            result.count = 1
            # Sanitized search still uses or_ path
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.or_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            # Injection attempt: try to add extra filter clause via comma + operator
            response = client.get(
                "/v1/jobs?search=test%25,email.ilike.%25admin%25",
                headers=auth_headers,
            )

        # Should succeed (sanitized input used, not raw)
        assert response.status_code == 200

    def test_list_jobs_search_all_special_chars_skipped(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Search of only special characters returns unfiltered results (no or_ call)."""
        rows = [_job_row(company_id=mock_company_id)]

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = rows
            result.count = 1
            # No or_ in chain (search sanitizes to empty string)
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs?search=.,%25()", headers=auth_headers)

        assert response.status_code == 200

    def test_list_jobs_pagination(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Pagination params limit and offset are respected."""
        rows = [_job_row(company_id=mock_company_id)]

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = rows
            result.count = 50  # Total is more than page size
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs?limit=10&offset=20", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 50

    def test_list_jobs_sort_asc(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Sort direction asc is accepted."""
        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = []
            result.count = 0
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs?sort_by=job_number&sort_dir=asc", headers=auth_headers)

        assert response.status_code == 200

    def test_list_jobs_invalid_sort_falls_back(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Invalid sort_by falls back to created_at (no error)."""
        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = []
            result.count = 0
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs?sort_by=invalid_field", headers=auth_headers)

        assert response.status_code == 200

    def test_list_jobs_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.get("/v1/jobs")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Tests: Get Job Detail
# ---------------------------------------------------------------------------


class TestGetJob:
    """GET /v1/jobs/{job_id}"""

    def test_get_job_detail(self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id):
        """Get existing job returns 200 with computed counts."""
        job_id = uuid4()
        row = _job_row(job_id=job_id, company_id=mock_company_id)

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = row

        mock_client = make_mock_supabase(
            mock_user_row,
            {
                "jobs": jobs_handler,
                "job_rooms": _counts_handler,
                "photos": _counts_handler,
                "floor_plans": _counts_handler,
                "line_items": _counts_handler,
            },
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.get(f"/v1/jobs/{job_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(job_id)
        assert data["room_count"] == 0
        assert data["photo_count"] == 0
        assert data["floor_plan_count"] == 0
        assert data["line_item_count"] == 0

    def test_get_job_with_nonzero_counts(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Get job returns correct non-zero counts."""
        job_id = uuid4()
        row = _job_row(job_id=job_id, company_id=mock_company_id)

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = row

        def rooms_handler(mock_table):
            result = MagicMock()
            result.count = 3
            mock_table.select.return_value.eq.return_value.execute.return_value = result

        def photos_handler(mock_table):
            result = MagicMock()
            result.count = 12
            mock_table.select.return_value.eq.return_value.execute.return_value = result

        mock_client = make_mock_supabase(
            mock_user_row,
            {
                "jobs": jobs_handler,
                "job_rooms": rooms_handler,
                "photos": photos_handler,
                "floor_plans": _counts_handler,
                "line_items": _counts_handler,
            },
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.get(f"/v1/jobs/{job_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["room_count"] == 3
        assert data["photo_count"] == 12

    def test_get_job_not_found(self, client, auth_headers, jwt_secret, mock_user_row):
        """Non-existent job returns 404."""

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = None

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get(f"/v1/jobs/{uuid4()}", headers=auth_headers)

        assert response.status_code == 404
        assert response.json()["error_code"] == "JOB_NOT_FOUND"

    def test_get_job_invalid_uuid(self, client, auth_headers, jwt_secret, mock_user_row):
        """Invalid UUID format returns 422."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs/not-a-uuid", headers=auth_headers)

        assert response.status_code == 422

    def test_get_job_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.get(f"/v1/jobs/{uuid4()}")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Tests: Update Job
# ---------------------------------------------------------------------------


class TestUpdateJob:
    """PATCH /v1/jobs/{job_id}"""

    def test_update_job_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Update job fields returns 200."""
        job_id = uuid4()
        updated_row = _job_row(
            job_id=job_id,
            company_id=mock_company_id,
            customer_name="Updated Name",
        )

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = [updated_row]
            (
                mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(
            mock_user_row,
            {
                "jobs": jobs_handler,
                "job_rooms": _counts_handler,
                "photos": _counts_handler,
                "floor_plans": _counts_handler,
                "line_items": _counts_handler,
            },
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}",
                json={"customer_name": "Updated Name"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["customer_name"] == "Updated Name"

    def test_update_job_status(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Update job status returns 200."""
        job_id = uuid4()
        updated_row = _job_row(job_id=job_id, company_id=mock_company_id, status="mitigation")

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = [updated_row]
            (
                mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(
            mock_user_row,
            {
                "jobs": jobs_handler,
                "job_rooms": _counts_handler,
                "photos": _counts_handler,
                "floor_plans": _counts_handler,
                "line_items": _counts_handler,
            },
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}",
                json={"status": "mitigation"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["status"] == "mitigation"

    def test_update_job_multiple_fields(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Update multiple fields at once returns 200."""
        job_id = uuid4()
        updated_row = _job_row(
            job_id=job_id,
            company_id=mock_company_id,
            customer_name="New Name",
            carrier="State Farm",
            claim_number="CLM-123",
        )

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = [updated_row]
            (
                mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(
            mock_user_row,
            {
                "jobs": jobs_handler,
                "job_rooms": _counts_handler,
                "photos": _counts_handler,
                "floor_plans": _counts_handler,
                "line_items": _counts_handler,
            },
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}",
                json={
                    "customer_name": "New Name",
                    "carrier": "State Farm",
                    "claim_number": "CLM-123",
                },
                headers=auth_headers,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["customer_name"] == "New Name"
        assert data["carrier"] == "State Farm"
        assert data["claim_number"] == "CLM-123"

    def test_update_job_invalid_status(self, client, auth_headers, jwt_secret, mock_user_row):
        """Invalid status returns 400 INVALID_STATUS."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{uuid4()}",
                json={"status": "bogus"},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_STATUS"

    def test_update_job_invalid_loss_type(self, client, auth_headers, jwt_secret, mock_user_row):
        """Invalid loss_type on update returns 400."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{uuid4()}",
                json={"loss_type": "earthquake"},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_LOSS_TYPE"

    def test_update_job_invalid_loss_category(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Invalid loss_category on update returns 400."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{uuid4()}",
                json={"loss_category": "99"},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_LOSS_CATEGORY"

    def test_update_job_invalid_loss_class(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Invalid loss_class on update returns 400."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{uuid4()}",
                json={"loss_class": "5"},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_LOSS_CLASS"

    def test_update_job_empty_body(self, client, auth_headers, jwt_secret, mock_user_row):
        """Empty update body returns 400 NO_UPDATES."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{uuid4()}",
                json={},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "NO_UPDATES"

    def test_update_job_not_found(self, client, auth_headers, jwt_secret, mock_user_row):
        """Update non-existent job returns 404."""

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = []
            (
                mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{uuid4()}",
                json={"customer_name": "Test"},
                headers=auth_headers,
            )

        assert response.status_code == 404
        assert response.json()["error_code"] == "JOB_NOT_FOUND"

    def test_update_job_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.patch(f"/v1/jobs/{uuid4()}", json={"status": "new"})
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Tests: Delete Job (soft-delete)
# ---------------------------------------------------------------------------


class TestDeleteJob:
    """DELETE /v1/jobs/{job_id}"""

    def test_delete_job_owner(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Owner can soft-delete a job (200)."""
        job_id = uuid4()

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = [_job_row(job_id=job_id, company_id=mock_company_id)]
            (
                mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
            ) = result

        # Admin client handles the delete; auth client handles auth middleware
        mock_admin = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})
        mock_auth = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_auth, mock_admin_client=mock_admin):
            response = client.delete(f"/v1/jobs/{job_id}", headers=auth_headers)

        assert response.status_code == 200
        assert response.json()["deleted"] is True

    def test_delete_job_admin(
        self,
        client,
        jwt_secret,
        mock_auth_user_id,
        mock_user_id,
        mock_company_id,
    ):
        """Admin can soft-delete a job (200)."""
        job_id = uuid4()
        admin_user_row = {
            "id": str(mock_user_id),
            "company_id": str(mock_company_id),
            "role": "admin",
            "is_platform_admin": False,
        }

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = [_job_row(job_id=job_id, company_id=mock_company_id)]
            (
                mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
            ) = result

        mock_admin = make_mock_supabase(admin_user_row, {"jobs": jobs_handler})
        mock_auth = make_mock_supabase(admin_user_row)

        token = pyjwt.encode(
            {"sub": str(mock_auth_user_id), "aud": "authenticated", "role": "authenticated"},
            jwt_secret,
            algorithm="HS256",
        )

        with _patch_all(jwt_secret, mock_auth, mock_admin_client=mock_admin):
            response = client.delete(
                f"/v1/jobs/{job_id}",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        assert response.json()["deleted"] is True

    def test_delete_job_tech_forbidden(
        self,
        client,
        jwt_secret,
        mock_auth_user_id,
        mock_user_id,
        mock_company_id,
    ):
        """Tech (non-owner/non-admin) gets 403 FORBIDDEN."""
        tech_user_row = {
            "id": str(mock_user_id),
            "company_id": str(mock_company_id),
            "role": "tech",
            "is_platform_admin": False,
        }
        mock_client = make_mock_supabase(tech_user_row)

        token = pyjwt.encode(
            {"sub": str(mock_auth_user_id), "aud": "authenticated", "role": "authenticated"},
            jwt_secret,
            algorithm="HS256",
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.delete(
                f"/v1/jobs/{uuid4()}",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 403
        assert response.json()["error_code"] == "FORBIDDEN"

    def test_delete_job_not_found(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Delete non-existent job returns 404."""

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = []
            (
                mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
            ) = result

        mock_admin = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})
        mock_auth = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_auth, mock_admin_client=mock_admin):
            response = client.delete(f"/v1/jobs/{uuid4()}", headers=auth_headers)

        assert response.status_code == 404
        assert response.json()["error_code"] == "JOB_NOT_FOUND"

    def test_delete_job_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.delete(f"/v1/jobs/{uuid4()}")
        assert response.status_code == 401
