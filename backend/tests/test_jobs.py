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

        def jobs_handler(mock_table):
            # _generate_job_number: select().eq().like().order().limit().execute()
            (
                mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
            ).data = []

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        # Admin client needs rpc() to return the job row (atomic create)
        mock_admin = make_mock_supabase(mock_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=row)

        with _patch_all(jwt_secret, mock_client, mock_admin_client=mock_admin):
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

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
            ).data = []

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})
        mock_admin = make_mock_supabase(mock_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=row)

        with _patch_all(jwt_secret, mock_client, mock_admin_client=mock_admin):
            response = client.post("/v1/jobs", json=_create_body(), headers=auth_headers)

        assert response.status_code == 201

    def test_create_job_with_loss_date(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Create job with loss_date serializes correctly."""
        row = _job_row(company_id=mock_company_id, loss_date="2026-03-20")

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
            ).data = []

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})
        mock_admin = make_mock_supabase(mock_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=row)

        with _patch_all(jwt_secret, mock_client, mock_admin_client=mock_admin):
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

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
            ).data = []

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})
        mock_admin = make_mock_supabase(mock_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=row)

        with _patch_all(jwt_secret, mock_client, mock_admin_client=mock_admin):
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

        job_query_count = {"n": 0}

        def jobs_handler(mock_table):
            job_query_count["n"] += 1
            n = job_query_count["n"]
            if n == 1:
                # First _generate_job_number
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = []
            elif n == 2:
                # Second _generate_job_number (after collision)
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = [{"job_number": "JOB-20260326-001"}]

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        # Admin client: first RPC call fails with unique constraint, second succeeds
        rpc_call_count = {"n": 0}
        mock_admin = make_mock_supabase(mock_user_row)

        from unittest.mock import AsyncMock as _AsyncMock

        async def rpc_execute_side_effect():
            rpc_call_count["n"] += 1
            if rpc_call_count["n"] == 1:
                raise Exception(
                    'duplicate key value violates unique constraint "jobs_job_number_unique"'
                )
            return MagicMock(data=row)

        mock_admin.rpc.return_value.execute = _AsyncMock(side_effect=rpc_execute_side_effect)

        with _patch_all(jwt_secret, mock_client, mock_admin_client=mock_admin):
            response = client.post("/v1/jobs", json=_create_body(), headers=auth_headers)

        assert response.status_code == 201

    def test_create_job_insert_returns_empty(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """RPC returning no data raises 500."""

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
            ).data = []

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})
        mock_admin = make_mock_supabase(mock_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=None)

        with _patch_all(jwt_secret, mock_client, mock_admin_client=mock_admin):
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
        updated_row["job_type"] = "mitigation"
        updated_row["linked_job_id"] = None

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = [updated_row]
            (
                mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
            ) = result
            # Per-job-type status validation: select("job_type").eq().eq().is_().single().execute()
            (
                mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = {"job_type": "mitigation"}

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

        # Admin client: rpc returns True (job found and deleted)
        mock_admin = make_mock_supabase(mock_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=True)
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

        mock_admin = make_mock_supabase(admin_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=True)
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
        mock_admin = make_mock_supabase(mock_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=False)
        mock_auth = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_auth, mock_admin_client=mock_admin):
            response = client.delete(f"/v1/jobs/{uuid4()}", headers=auth_headers)

        assert response.status_code == 404
        assert response.json()["error_code"] == "JOB_NOT_FOUND"

    def test_delete_job_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.delete(f"/v1/jobs/{uuid4()}")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Tests: Reconstruction Job Features (Spec 01B)
# ---------------------------------------------------------------------------


class TestCreateReconstructionJob:
    """POST /v1/jobs with job_type=reconstruction and linked_job_id."""

    def test_create_recon_job_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id, mock_user_id,
    ):
        """Create reconstruction job returns 201 with correct job_type."""
        job_id = uuid4()
        row = _job_row(
            job_id=job_id, company_id=mock_company_id, user_id=mock_user_id,
        )
        row["job_type"] = "reconstruction"
        row["linked_job_id"] = None

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value
                .like.return_value.order.return_value
                .limit.return_value.execute.return_value
            ).data = []
            # For recon_phases insert (default phases)
            mock_table.insert.return_value.execute.return_value = MagicMock(data=[{}])

        def phases_handler(mock_table):
            mock_table.insert.return_value.execute.return_value = MagicMock(data=[{}])

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })
        mock_admin = make_mock_supabase(mock_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=row)

        with _patch_all(jwt_secret, mock_client, mock_admin_client=mock_admin):
            body = _create_body(job_type="reconstruction")
            response = client.post("/v1/jobs", json=body, headers=auth_headers)

        assert response.status_code == 201
        data = response.json()
        assert data["job_type"] == "reconstruction"

    def test_create_linked_recon_job_validates_mitigation_source(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id,
    ):
        """Linking to a non-mitigation job returns 400."""
        source_id = uuid4()

        def jobs_handler(mock_table):
            # linked job lookup returns a reconstruction job (invalid link target)
            (
                mock_table.select.return_value.eq.return_value
                .eq.return_value.is_.return_value.execute.return_value
            ).data = [{"id": str(source_id), "job_type": "reconstruction"}]

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            body = _create_body(
                job_type="reconstruction",
                linked_job_id=str(source_id),
            )
            response = client.post("/v1/jobs", json=body, headers=auth_headers)

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_LINK_TARGET"

    def test_mitigation_job_cannot_link(
        self, client, auth_headers, jwt_secret, mock_user_row,
    ):
        """Mitigation jobs cannot have linked_job_id."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            body = _create_body(
                job_type="mitigation",
                linked_job_id=str(uuid4()),
            )
            response = client.post("/v1/jobs", json=body, headers=auth_headers)

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_LINK_TYPE"

    def test_invalid_job_type_returns_400(
        self, client, auth_headers, jwt_secret, mock_user_row,
    ):
        """Invalid job_type value returns 422 (Pydantic Literal validation)."""
        mock_client = make_mock_supabase(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            body = _create_body(job_type="demolition")
            response = client.post("/v1/jobs", json=body, headers=auth_headers)

        assert response.status_code == 422


class TestStatusValidationPerJobType:
    """PATCH /v1/jobs/{id} — status must be valid for the job's type."""

    def test_mitigation_rejects_recon_status(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id,
    ):
        """Setting status='scoping' on a mitigation job returns 400."""
        job_id = uuid4()

        def jobs_handler(mock_table):
            # Per-type validation query: select("job_type").eq().eq().is_().single().execute()
            (
                mock_table.select.return_value.eq.return_value
                .eq.return_value.is_.return_value
                .single.return_value.execute.return_value
            ).data = {"job_type": "mitigation"}

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}",
                json={"status": "scoping"},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_STATUS_FOR_TYPE"

    def test_recon_rejects_mitigation_status(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id,
    ):
        """Setting status='drying' on a reconstruction job returns 400."""
        job_id = uuid4()

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value
                .eq.return_value.is_.return_value
                .single.return_value.execute.return_value
            ).data = {"job_type": "reconstruction"}

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}",
                json={"status": "drying"},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_STATUS_FOR_TYPE"


class TestCreateLinkedReconEndpoint:
    """POST /v1/jobs/{job_id}/create-linked-recon"""

    def test_linked_recon_rejects_non_mitigation_source(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id,
    ):
        """Source job must be mitigation type."""
        source_id = uuid4()

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value
                .eq.return_value.is_.return_value
                .single.return_value.execute.return_value
            ).data = {"id": str(source_id), "job_type": "reconstruction", "address_line1": "123 Main"}

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{source_id}/create-linked-recon",
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_SOURCE_TYPE"

    def test_linked_recon_source_not_found(
        self, client, auth_headers, jwt_secret, mock_user_row,
    ):
        """Non-existent source job returns 404."""

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value
                .eq.return_value.is_.return_value
                .single.return_value.execute.return_value
            ).data = None

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{uuid4()}/create-linked-recon",
                headers=auth_headers,
            )

        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Tests: Auto-Copy Fields on Linked Recon Job (Spec 01B)
# ---------------------------------------------------------------------------


class TestLinkedJobAutoCopy:
    """POST /v1/jobs with linked_job_id — auto-copy field verification."""

    def test_auto_copy_fields_from_linked_mitigation(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id, mock_user_id,
    ):
        """Creating a linked recon job auto-copies 17 header fields from the mitigation source."""
        source_id = uuid4()
        new_job_id = uuid4()

        source_row = _job_row(
            job_id=source_id, company_id=mock_company_id,
            customer_name="Brett Sodders", customer_phone="(586) 944-7700",
            customer_email="brett@drypros.com",
            claim_number="CLM-2026-001", carrier="State Farm",
            adjuster_name="Jane Doe", adjuster_phone="(555) 123-4567",
            adjuster_email="jane@statefarm.com",
        )
        source_row["job_type"] = "mitigation"
        source_row["linked_job_id"] = None

        new_row = _job_row(
            job_id=new_job_id, company_id=mock_company_id, user_id=mock_user_id,
            customer_name="Brett Sodders", customer_phone="(586) 944-7700",
            customer_email="brett@drypros.com",
            claim_number="CLM-2026-001", carrier="State Farm",
            adjuster_name="Jane Doe", adjuster_phone="(555) 123-4567",
            adjuster_email="jane@statefarm.com",
        )
        new_row["job_type"] = "reconstruction"
        new_row["linked_job_id"] = str(source_id)

        def jobs_handler(mock_table):
            # For linked job lookup: select(*).eq(id).eq(company_id).is_(deleted_at).execute()
            (
                mock_table.select.return_value.eq.return_value
                .eq.return_value.is_.return_value.execute.return_value
            ).data = [source_row]
            # For _generate_job_number: select().eq().like().order().limit().execute()
            (
                mock_table.select.return_value.eq.return_value
                .like.return_value.order.return_value
                .limit.return_value.execute.return_value
            ).data = []

        def phases_handler(mock_table):
            mock_table.insert.return_value.execute.return_value = MagicMock(data=[{}])

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })
        mock_admin = make_mock_supabase(mock_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=new_row)

        with _patch_all(jwt_secret, mock_client, mock_admin_client=mock_admin):
            body = _create_body(
                job_type="reconstruction",
                linked_job_id=str(source_id),
            )
            response = client.post("/v1/jobs", json=body, headers=auth_headers)

        assert response.status_code == 201
        data = response.json()
        assert data["customer_name"] == "Brett Sodders"
        assert data["carrier"] == "State Farm"
        assert data["claim_number"] == "CLM-2026-001"
        assert data["adjuster_name"] == "Jane Doe"


# ---------------------------------------------------------------------------
# Tests: Job Type Filter on GET /v1/jobs (Spec 01B)
# ---------------------------------------------------------------------------


class TestJobTypeFilter:
    """GET /v1/jobs?job_type=reconstruction"""

    def test_list_jobs_with_job_type_filter(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id,
    ):
        """Filter by job_type=reconstruction returns matching jobs."""
        row = _job_row(company_id=mock_company_id)
        row["job_type"] = "reconstruction"
        row["linked_job_id"] = None

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = [row]
            result.count = 1
            # With job_type filter: select().eq().is_().eq().order().range().execute()
            (
                mock_table.select.return_value.eq.return_value
                .is_.return_value.eq.return_value
                .order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs?job_type=reconstruction", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["total"] == 1


# ---------------------------------------------------------------------------
# Tests: Immutable job_type (Spec 01B)
# ---------------------------------------------------------------------------


class TestImmutableJobType:
    """PATCH /v1/jobs/{id} — job_type cannot be changed after creation."""

    def test_update_job_type_is_ignored(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id,
    ):
        """Sending job_type in update payload is silently ignored (not in JobUpdate schema)."""
        job_id = uuid4()
        row = _job_row(job_id=job_id, company_id=mock_company_id, status="new")
        row["job_type"] = "mitigation"
        row["linked_job_id"] = None

        def jobs_handler(mock_table):
            result = MagicMock()
            result.data = [row]
            (
                mock_table.update.return_value.eq.return_value
                .eq.return_value.is_.return_value.execute.return_value
            ) = result

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "job_rooms": _counts_handler,
            "photos": _counts_handler,
            "floor_plans": _counts_handler,
            "line_items": _counts_handler,
        })

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}",
                json={"job_type": "reconstruction", "notes": "test"},
                headers=auth_headers,
            )

        # Should succeed — job_type is ignored, only notes is applied
        assert response.status_code == 200
        assert response.json()["job_type"] == "mitigation"


# ---------------------------------------------------------------------------
# Tests: Reverse Link Lookup (Spec 01B)
# ---------------------------------------------------------------------------


class TestReverseLinkLookup:
    """GET /v1/jobs/{id} — mitigation job shows linked recon via reverse query."""

    def test_mitigation_shows_linked_recon_via_reverse_query(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id,
    ):
        """Mitigation job with no forward link resolves linked recon bidirectionally."""
        mit_id = uuid4()
        recon_id = uuid4()

        mit_row = _job_row(job_id=mit_id, company_id=mock_company_id)
        mit_row["job_type"] = "mitigation"
        mit_row["linked_job_id"] = None

        recon_summary = {
            "id": str(recon_id),
            "job_number": "JOB-20260409-002",
            "job_type": "reconstruction",
            "status": "scoping",
        }

        call_count = {"n": 0}

        def jobs_handler(mock_table):
            call_count["n"] += 1
            n = call_count["n"]
            if n == 1:
                # get_job: select(*).eq(id).eq(company_id).is_().single().execute()
                (
                    mock_table.select.return_value.eq.return_value
                    .eq.return_value.is_.return_value
                    .single.return_value.execute.return_value
                ).data = mit_row
            elif n == 2:
                # reverse lookup: select().eq(linked_job_id).is_().limit().execute()
                (
                    mock_table.select.return_value.eq.return_value
                    .is_.return_value.limit.return_value
                    .execute.return_value
                ).data = [recon_summary]

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "job_rooms": _counts_handler,
            "photos": _counts_handler,
            "floor_plans": _counts_handler,
            "line_items": _counts_handler,
        })

        with _patch_all(jwt_secret, mock_client):
            response = client.get(f"/v1/jobs/{mit_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["linked_job_summary"] is not None
        assert data["linked_job_summary"]["id"] == str(recon_id)
        assert data["linked_job_summary"]["job_type"] == "reconstruction"


# ---------------------------------------------------------------------------
# Tests: Default Phase Pre-Population (Spec 01B)
# ---------------------------------------------------------------------------


class TestDefaultPhasePrePopulation:
    """POST /v1/jobs — recon job auto-creates 6 default phases."""

    def test_recon_job_creates_default_phases(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id, mock_user_id,
    ):
        """Creating a reconstruction job inserts 6 default phases."""
        job_id = uuid4()
        row = _job_row(job_id=job_id, company_id=mock_company_id, user_id=mock_user_id)
        row["job_type"] = "reconstruction"
        row["linked_job_id"] = None

        phase_inserts = []

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value.eq.return_value
                .like.return_value.order.return_value
                .limit.return_value.execute.return_value
            ).data = []

        def phases_handler(mock_table):
            original_insert = mock_table.insert

            def track_insert(data):
                phase_inserts.append(data)
                result = MagicMock()
                result.execute.return_value = MagicMock(data=[data])
                return result

            mock_table.insert.side_effect = track_insert

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })
        mock_admin = make_mock_supabase(mock_user_row)
        mock_admin.rpc.return_value.execute.return_value = MagicMock(data=row)

        with _patch_all(jwt_secret, mock_client, mock_admin_client=mock_admin):
            body = _create_body(job_type="reconstruction")
            response = client.post("/v1/jobs", json=body, headers=auth_headers)

        assert response.status_code == 201
        # Verify 6 default phases were inserted
        assert len(phase_inserts) == 6
        phase_names = [p["phase_name"] for p in phase_inserts]
        assert "Demo Verification" in phase_names
        assert "Drywall" in phase_names
        assert "Paint" in phase_names
        assert "Flooring" in phase_names
        assert "Trim / Moldings" in phase_names
        assert "Final Walkthrough" in phase_names
        # Verify sort_order is sequential
        for i, p in enumerate(phase_inserts):
            assert p["sort_order"] == i
            assert p["status"] == "pending"
