"""Reports service: create report records, list, and generate download URLs.

Actual PDF generation is TODO — this creates the record with status=generating
and will be connected to a background task later.
"""

from uuid import UUID

from supabase import Client

from api.reports.schemas import VALID_REPORT_TYPES, ReportCreate
from api.shared.database import get_supabase_admin_client
from api.shared.events import log_event
from api.shared.exceptions import AppException


async def create_report(
    client: Client,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: ReportCreate,
) -> dict:
    """Create a report record with status=generating.

    TODO: trigger actual PDF generation via background task.
    """
    if body.report_type not in VALID_REPORT_TYPES:
        raise AppException(
            status_code=400,
            detail=f"Invalid report_type. Must be one of: {', '.join(sorted(VALID_REPORT_TYPES))}",
            error_code="INVALID_REPORT_TYPE",
        )

    row = {
        "job_id": str(job_id),
        "company_id": str(company_id),
        "report_type": body.report_type,
        "status": "generating",
        "storage_url": None,
        "generated_at": None,
    }
    result = client.table("reports").insert(row).execute()
    report = result.data[0]

    await log_event(
        company_id,
        "report_created",
        job_id=job_id,
        user_id=user_id,
        event_data={"report_id": report["id"], "report_type": body.report_type},
    )

    return report


async def list_reports(
    client: Client,
    job_id: UUID,
) -> list[dict]:
    """List all reports for a job, ordered by created_at DESC."""
    result = (
        client.table("reports")
        .select("*")
        .eq("job_id", str(job_id))
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


async def get_download_url(
    client: Client,
    job_id: UUID,
    report_id: UUID,
) -> str:
    """Get a signed download URL for a ready report.

    Generates a 15-minute signed URL from Supabase Storage.
    """
    result = (
        client.table("reports")
        .select("*")
        .eq("id", str(report_id))
        .eq("job_id", str(job_id))
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Report not found",
            error_code="REPORT_NOT_FOUND",
        )

    report = result.data
    if report["status"] != "ready":
        raise AppException(
            status_code=400,
            detail="Report is not ready for download",
            error_code="REPORT_NOT_READY",
        )

    storage_url = report.get("storage_url")
    if not storage_url:
        raise AppException(
            status_code=400,
            detail="Report has no storage URL",
            error_code="REPORT_NOT_READY",
        )

    # Generate a signed URL (15 min = 900 seconds) using admin client
    # storage_url format: "reports/{company_id}/{report_id}.pdf"
    admin = get_supabase_admin_client()
    signed = admin.storage.from_("reports").create_signed_url(storage_url, 900)
    return signed.get("signedURL", signed.get("signedUrl", ""))
