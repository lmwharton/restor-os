"""Tests for report tracking endpoints.

Covers:
- POST /v1/jobs/{job_id}/reports  (record_report)
- GET  /v1/jobs/{job_id}/reports  (get_job_reports)

Reports table uses hard delete (no deleted_at column).
PDF generation is client-side; these endpoints track audit history only.
"""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from api.config import settings
from api.main import app
from tests.conftest import AsyncSupabaseMock, make_mock_supabase

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MOCK_NOW = "2026-03-25T10:00:00Z"


@pytest.fixture
def mock_job_id():
    return uuid4()


@pytest.fixture
def mock_report_id():
    return uuid4()


@pytest.fixture
def mock_job_row(mock_job_id, mock_company_id):
    """Job row — jobs table DOES have deleted_at; reports table does NOT."""
    return {
        "id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "status": "in_progress",
        "deleted_at": None,
    }


@pytest.fixture
def mock_report_row(mock_report_id, mock_job_id, mock_company_id):
    return {
        "id": str(mock_report_id),
        "job_id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "report_type": "full_report",
        "status": "ready",
        "generated_at": MOCK_NOW,
        "created_at": MOCK_NOW,
        "updated_at": MOCK_NOW,
    }


# ---------------------------------------------------------------------------
# Helper: patch all Supabase clients
# ---------------------------------------------------------------------------


def _patch_stack(jwt_secret, mock_client):
    """Return a context-manager stack that patches JWT secret + all Supabase clients."""
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(patch.object(settings, "supabase_jwt_secret", jwt_secret))
    stack.enter_context(
        patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client)
    )
    stack.enter_context(
        patch("api.shared.dependencies.get_authenticated_client", return_value=mock_client)
    )
    stack.enter_context(
        patch("api.reports.service.get_authenticated_client", return_value=mock_client)
    )
    stack.enter_context(
        patch("api.shared.events.get_supabase_admin_client", return_value=mock_client)
    )
    return stack


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/reports — Create report
# ---------------------------------------------------------------------------


class TestCreateReport:
    """Test POST /v1/jobs/{job_id}/reports."""

    def test_create_full_report_success(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        mock_job_row,
        mock_report_row,
        auth_headers,
    ):
        """POST with report_type=full_report returns 201 with status=ready."""

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def _reports_handler(t):
            t.insert.return_value.execute.return_value = MagicMock(data=[mock_report_row])

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={
                "jobs": _jobs_handler,
                "reports": _reports_handler,
            },
        )

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.post(
                f"/v1/jobs/{mock_job_id}/reports",
                json={"report_type": "full_report"},
                headers=auth_headers,
            )

        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "ready"
        assert data["report_type"] == "full_report"
        assert data["job_id"] == str(mock_job_id)

    def test_create_restoration_invoice_success(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        mock_company_id,
        mock_job_row,
        mock_report_id,
        auth_headers,
    ):
        """POST with report_type=restoration_invoice returns 201."""
        invoice_row = {
            "id": str(mock_report_id),
            "job_id": str(mock_job_id),
            "company_id": str(mock_company_id),
            "report_type": "restoration_invoice",
            "status": "ready",
            "generated_at": MOCK_NOW,
            "created_at": MOCK_NOW,
            "updated_at": MOCK_NOW,
        }

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def _reports_handler(t):
            t.insert.return_value.execute.return_value = MagicMock(data=[invoice_row])

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={
                "jobs": _jobs_handler,
                "reports": _reports_handler,
            },
        )

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.post(
                f"/v1/jobs/{mock_job_id}/reports",
                json={"report_type": "restoration_invoice"},
                headers=auth_headers,
            )

        assert resp.status_code == 201
        assert resp.json()["report_type"] == "restoration_invoice"

    def test_create_report_default_type(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        mock_job_row,
        mock_report_row,
        auth_headers,
    ):
        """POST with empty body uses default report_type=full_report."""

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def _reports_handler(t):
            t.insert.return_value.execute.return_value = MagicMock(data=[mock_report_row])

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={
                "jobs": _jobs_handler,
                "reports": _reports_handler,
            },
        )

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.post(
                f"/v1/jobs/{mock_job_id}/reports",
                json={},
                headers=auth_headers,
            )

        assert resp.status_code == 201
        assert resp.json()["report_type"] == "full_report"

    def test_create_report_invalid_type_returns_400(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        mock_job_row,
        auth_headers,
    ):
        """POST with an unknown report_type returns 400 INVALID_REPORT_TYPE."""

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={"jobs": _jobs_handler},
        )

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.post(
                f"/v1/jobs/{mock_job_id}/reports",
                json={"report_type": "bogus_type"},
                headers=auth_headers,
            )

        assert resp.status_code == 400
        body = resp.json()
        assert body["error_code"] == "INVALID_REPORT_TYPE"
        assert "full_report" in body["error"]
        assert "restoration_invoice" in body["error"]

    def test_create_report_no_auth_returns_401(self, client, mock_job_id):
        """POST without Authorization header returns 401."""
        resp = client.post(
            f"/v1/jobs/{mock_job_id}/reports",
            json={"report_type": "full_report"},
        )
        assert resp.status_code == 401

    def test_create_report_expired_token_returns_401(
        self, client, jwt_secret, mock_job_id, expired_token
    ):
        """POST with expired JWT returns 401."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            resp = client.post(
                f"/v1/jobs/{mock_job_id}/reports",
                json={"report_type": "full_report"},
                headers={"Authorization": f"Bearer {expired_token}"},
            )
        assert resp.status_code == 401

    def test_create_report_job_not_found_returns_404(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        auth_headers,
    ):
        """POST for a non-existent job returns 404."""

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = None

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={"jobs": _jobs_handler},
        )

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.post(
                f"/v1/jobs/{mock_job_id}/reports",
                json={"report_type": "full_report"},
                headers=auth_headers,
            )

        assert resp.status_code == 404
        assert resp.json()["error_code"] == "JOB_NOT_FOUND"

    def test_create_report_user_not_found_returns_401(
        self,
        client,
        jwt_secret,
        mock_job_id,
        auth_headers,
    ):
        """POST when user is not in users table returns 401."""
        mock_sb = make_mock_supabase(user_row=None)

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.post(
                f"/v1/jobs/{mock_job_id}/reports",
                json={"report_type": "full_report"},
                headers=auth_headers,
            )

        assert resp.status_code == 401

    def test_create_report_logs_event(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        mock_job_row,
        mock_report_row,
        auth_headers,
    ):
        """POST should fire a report_generated event via log_event."""

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def _reports_handler(t):
            t.insert.return_value.execute.return_value = MagicMock(data=[mock_report_row])

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={
                "jobs": _jobs_handler,
                "reports": _reports_handler,
            },
        )

        with _patch_stack(jwt_secret, mock_sb), patch(
            "api.reports.service.log_event"
        ) as mock_log:
            resp = client.post(
                f"/v1/jobs/{mock_job_id}/reports",
                json={"report_type": "full_report"},
                headers=auth_headers,
            )

        assert resp.status_code == 201
        # Verify log_event was awaited with correct args
        mock_log.assert_awaited_once()
        call_kwargs = mock_log.call_args
        assert call_kwargs[1]["event_data"]["report_type"] == "full_report"

    def test_create_report_invalid_job_id_format_returns_422(
        self, client, jwt_secret, mock_user_row, auth_headers
    ):
        """POST with a non-UUID job_id returns 422 validation error."""
        mock_sb = make_mock_supabase(mock_user_row)

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.post(
                "/v1/jobs/not-a-uuid/reports",
                json={"report_type": "full_report"},
                headers=auth_headers,
            )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /v1/jobs/{job_id}/reports — List reports
# ---------------------------------------------------------------------------


class TestListReports:
    """Test GET /v1/jobs/{job_id}/reports."""

    def test_list_reports_returns_list(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        mock_job_row,
        mock_report_row,
        auth_headers,
    ):
        """GET returns 200 with a list of report records."""

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def _reports_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .order.return_value
                .execute.return_value
            ).data = [mock_report_row]

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={
                "jobs": _jobs_handler,
                "reports": _reports_handler,
            },
        )

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/reports",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert len(data["items"]) == 1
        assert data["items"][0]["id"] == str(mock_report_row["id"])
        assert data["items"][0]["status"] == "ready"

    def test_list_reports_empty(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        mock_job_row,
        auth_headers,
    ):
        """GET returns 200 with empty list when no reports exist."""

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def _reports_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .order.return_value
                .execute.return_value
            ).data = []

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={
                "jobs": _jobs_handler,
                "reports": _reports_handler,
            },
        )

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/reports",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_reports_multiple(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        mock_company_id,
        mock_job_row,
        auth_headers,
    ):
        """GET returns multiple reports in the list."""
        reports = [
            {
                "id": str(uuid4()),
                "job_id": str(mock_job_id),
                "company_id": str(mock_company_id),
                "report_type": "full_report",
                "status": "ready",
                "generated_at": MOCK_NOW,
                "created_at": MOCK_NOW,
                "updated_at": MOCK_NOW,
            },
            {
                "id": str(uuid4()),
                "job_id": str(mock_job_id),
                "company_id": str(mock_company_id),
                "report_type": "restoration_invoice",
                "status": "ready",
                "generated_at": "2026-03-26T10:00:00Z",
                "created_at": "2026-03-26T10:00:00Z",
                "updated_at": "2026-03-26T10:00:00Z",
            },
        ]

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def _reports_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .order.return_value
                .execute.return_value
            ).data = reports

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={
                "jobs": _jobs_handler,
                "reports": _reports_handler,
            },
        )

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/reports",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["total"] == 2
        types = {r["report_type"] for r in data["items"]}
        assert types == {"full_report", "restoration_invoice"}

    def test_list_reports_no_auth_returns_401(self, client, mock_job_id):
        """GET without Authorization header returns 401."""
        resp = client.get(f"/v1/jobs/{mock_job_id}/reports")
        assert resp.status_code == 401

    def test_list_reports_expired_token_returns_401(
        self, client, jwt_secret, mock_job_id, expired_token
    ):
        """GET with expired JWT returns 401."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/reports",
                headers={"Authorization": f"Bearer {expired_token}"},
            )
        assert resp.status_code == 401

    def test_list_reports_job_not_found_returns_404(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        auth_headers,
    ):
        """GET for a non-existent job returns 404."""

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = None

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={"jobs": _jobs_handler},
        )

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/reports",
                headers=auth_headers,
            )

        assert resp.status_code == 404
        assert resp.json()["error_code"] == "JOB_NOT_FOUND"

    def test_list_reports_null_data_returns_empty_list(
        self,
        client,
        jwt_secret,
        mock_user_row,
        mock_job_id,
        mock_job_row,
        auth_headers,
    ):
        """GET with None result.data returns empty list (service handles 'or []')."""

        def _jobs_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .eq.return_value
                .is_.return_value
                .single.return_value
                .execute.return_value
            ).data = mock_job_row

        def _reports_handler(t):
            (
                t.select.return_value
                .eq.return_value
                .order.return_value
                .execute.return_value
            ).data = None

        mock_sb = make_mock_supabase(
            mock_user_row,
            table_handlers={
                "jobs": _jobs_handler,
                "reports": _reports_handler,
            },
        )

        with _patch_stack(jwt_secret, mock_sb):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/reports",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0


# ---------------------------------------------------------------------------
# Service-level unit tests
# ---------------------------------------------------------------------------


class TestReportService:
    """Direct unit tests for reports service functions."""

    @pytest.mark.asyncio
    async def test_create_report_inserts_correct_row(self, mock_company_id, mock_user_id):
        """create_report passes correct fields to Supabase insert."""
        from api.reports.schemas import ReportCreate

        job_id = uuid4()
        report_id = uuid4()
        return_row = {
            "id": str(report_id),
            "job_id": str(job_id),
            "company_id": str(mock_company_id),
            "report_type": "full_report",
            "status": "ready",
            "generated_at": MOCK_NOW,
            "created_at": MOCK_NOW,
            "updated_at": MOCK_NOW,
        }

        mock_client = AsyncSupabaseMock()
        reports_table = AsyncSupabaseMock()
        reports_table.insert.return_value.execute.return_value = MagicMock(data=[return_row])

        event_table = AsyncSupabaseMock()
        event_table.insert.return_value.execute.return_value = AsyncSupabaseMock()

        def table_router(name):
            if name == "reports":
                return reports_table
            if name == "event_history":
                return event_table
            return AsyncSupabaseMock()

        mock_client.table.side_effect = table_router

        with (
            patch("api.reports.service.get_authenticated_client", return_value=mock_client),
            patch("api.shared.events.get_supabase_admin_client", return_value=mock_client),
        ):
            from api.reports.service import create_report

            result = await create_report(
                job_id=job_id,
                company_id=mock_company_id,
                user_id=mock_user_id,
                token="fake-token",
                body=ReportCreate(report_type="full_report"),
            )

        assert result["id"] == str(report_id)
        assert result["status"] == "ready"

        # Verify insert was called with correct fields
        insert_call = reports_table.insert.call_args
        inserted_row = insert_call[0][0]
        assert inserted_row["job_id"] == str(job_id)
        assert inserted_row["company_id"] == str(mock_company_id)
        assert inserted_row["report_type"] == "full_report"
        assert inserted_row["status"] == "ready"
        assert "generated_at" in inserted_row

    @pytest.mark.asyncio
    async def test_create_report_rejects_invalid_type(self, mock_company_id, mock_user_id):
        """create_report raises AppException for invalid report_type."""
        from api.reports.schemas import ReportCreate
        from api.shared.exceptions import AppException

        with pytest.raises(AppException) as exc_info:
            from api.reports.service import create_report

            await create_report(
                job_id=uuid4(),
                company_id=mock_company_id,
                user_id=mock_user_id,
                token="fake-token",
                body=ReportCreate(report_type="nonexistent"),
            )

        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "INVALID_REPORT_TYPE"

    @pytest.mark.asyncio
    async def test_list_reports_orders_by_created_at_desc(self):
        """list_reports calls .order('created_at', desc=True)."""
        mock_client = AsyncSupabaseMock()
        reports_table = AsyncSupabaseMock()
        order_mock = AsyncSupabaseMock()
        order_mock.execute.return_value = MagicMock(data=[])

        reports_table.select.return_value.eq.return_value.order.return_value = order_mock
        mock_client.table.return_value = reports_table

        with patch("api.reports.service.get_authenticated_client", return_value=mock_client):
            from api.reports.service import list_reports

            result = await list_reports(job_id=uuid4(), token="fake-token")

        assert result == {"items": [], "total": 0}
        # Verify ordering
        reports_table.select.return_value.eq.return_value.order.assert_called_once_with(
            "created_at", desc=True
        )


# ---------------------------------------------------------------------------
# Schema validation tests
# ---------------------------------------------------------------------------


class TestReportSchemas:
    """Test Pydantic schema validation."""

    def test_report_create_default_type(self):
        from api.reports.schemas import ReportCreate

        body = ReportCreate()
        assert body.report_type == "full_report"

    def test_report_create_explicit_type(self):
        from api.reports.schemas import ReportCreate

        body = ReportCreate(report_type="restoration_invoice")
        assert body.report_type == "restoration_invoice"

    def test_report_create_allows_arbitrary_string(self):
        """Schema accepts any string; validation happens in service layer."""
        from api.reports.schemas import ReportCreate

        body = ReportCreate(report_type="anything")
        assert body.report_type == "anything"

    def test_valid_report_types_set(self):
        from api.reports.schemas import VALID_REPORT_TYPES

        assert VALID_REPORT_TYPES == {"full_report", "restoration_invoice"}

    def test_report_response_requires_all_fields(self):
        from api.reports.schemas import ReportResponse

        data = {
            "id": str(uuid4()),
            "job_id": str(uuid4()),
            "company_id": str(uuid4()),
            "report_type": "full_report",
            "status": "ready",
            "generated_at": MOCK_NOW,
            "created_at": MOCK_NOW,
            "updated_at": MOCK_NOW,
        }
        resp = ReportResponse(**data)
        assert resp.status == "ready"

    def test_report_response_generated_at_nullable(self):
        from api.reports.schemas import ReportResponse

        data = {
            "id": str(uuid4()),
            "job_id": str(uuid4()),
            "company_id": str(uuid4()),
            "report_type": "full_report",
            "status": "ready",
            "generated_at": None,
            "created_at": MOCK_NOW,
            "updated_at": MOCK_NOW,
        }
        resp = ReportResponse(**data)
        assert resp.generated_at is None
