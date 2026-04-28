"""Pricing endpoints (Spec 01I Phase 3).

POST /v1/pricing/upload                    multipart .xlsx
GET  /v1/pricing/template                  prebuilt .xlsx download
GET  /v1/pricing/error-report/{run_id}     CSV of last upload's errors
"""

from fastapi import APIRouter, Depends, Request, UploadFile
from fastapi.responses import Response

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.pricing.schemas import PricingUploadResponse
from api.pricing.service import (
    build_template_xlsx,
    errors_to_csv,
    get_error_report,
    upload_pricing_file,
)
from api.shared.dependencies import _get_token
from api.shared.exceptions import AppException
from api.shared.upload import read_upload_with_limit

router = APIRouter(tags=["pricing"])


# Excel files can be larger than image uploads; bump the cap modestly.
# 10 MB is plenty for 10k rows. read_upload_with_limit already uses the
# project default; we don't override here unless we hit a real ceiling.

ALLOWED_XLSX_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    # Some browsers send octet-stream for direct uploads — accept and let
    # the parser surface 'cannot read workbook' if the bytes are wrong.
    "application/octet-stream",
    # Older clients
    "application/vnd.ms-excel",
}


@router.post("/upload", response_model=PricingUploadResponse)
async def post_pricing_upload(
    file: UploadFile,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Validate + persist a pricing workbook.

    Behavior:
    - On parse / validation failure, returns 200 with ``items_loaded=0``,
      a populated ``errors`` list, and a ``run_id`` the client can use to
      download a CSV of the errors. (Not 4xx — the upload itself was
      well-formed; the *contents* failed validation, which is the user's
      to fix.)
    - On success, 200 with ``items_loaded > 0``, ``errors=[]``,
      ``run_id=None``.
    """
    # Reject obviously wrong content types up front. Be permissive on
    # octet-stream because some clients can't sniff.
    if file.content_type and file.content_type not in ALLOWED_XLSX_TYPES:
        raise AppException(
            status_code=400,
            detail="File must be an .xlsx workbook",
            error_code="INVALID_FILE_TYPE",
        )

    # Filename sanity check — extension is the most reliable signal.
    if file.filename and not file.filename.lower().endswith(".xlsx"):
        raise AppException(
            status_code=400,
            detail="File must have an .xlsx extension",
            error_code="INVALID_FILE_TYPE",
        )

    content = await read_upload_with_limit(file)

    token = _get_token(request)
    return await upload_pricing_file(token, ctx.company_id, content)


@router.get("/template")
async def get_pricing_template(
    _ctx: AuthContext = Depends(get_auth_context),  # auth-gate only
):
    """Return the prebuilt Tier A template workbook as a download.

    Auth-gated to match siblings; the body itself is generic.
    """
    body = build_template_xlsx()
    return Response(
        content=body,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="crewmatic-pricing-template.xlsx"'},
    )


@router.get("/error-report/{run_id}")
async def get_pricing_error_report(
    run_id: str,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Download a CSV of the errors from a recent pricing upload.

    ``run_id`` is the value returned in PricingUploadResponse.run_id when
    a previous upload failed validation. Reports are tenant-scoped: a
    user from a different company gets 404, even with a valid run_id.
    Reports expire after 1 hour.
    """
    errors = get_error_report(run_id, company_id=ctx.company_id)
    if errors is None:
        raise AppException(
            status_code=404,
            detail="Error report not found or expired",
            error_code="REPORT_NOT_FOUND",
        )
    csv_body = errors_to_csv(errors)
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="pricing-errors-{run_id}.csv"'},
    )
