"""Dashboard service — aggregates metrics from jobs and events tables."""

import logging
from datetime import UTC, datetime
from uuid import UUID

from supabase import AsyncClient

from api.dashboard.schemas import DashboardResponse, KPIs, PipelineStage, PriorityJob
from api.events.service import list_company_events
from api.jobs.lifecycle import (
    ACTIVE_LIST_STATUSES,
    JOB_STATUSES,
)

logger = logging.getLogger(__name__)

# Spec 01K — single 9-status lifecycle (mitigation + reconstruction collapsed
# onto one pipeline; job_type now drives behavior, not the status enum). Order
# matches the frontend's STAGE_ORDER in dashboard-client.tsx so the bars line
# up with the React UI without a remapping step.
PIPELINE_STAGES = list(JOB_STATUSES)

# Statuses counted as "active" KPI (open jobs that aren't terminal/archived).
# `disputed` is excluded — those jobs are stuck waiting on the carrier and
# don't represent capacity in the way "active jobs" does for the owner.
ACTIVE_STATUSES = set(ACTIVE_LIST_STATUSES) - {"disputed"}

# Statuses that surface as "priority" (need owner attention now). Leads need
# qualification, on_hold needs a decision, disputed needs a carrier reply.
PRIORITY_STATUSES = {"lead", "on_hold", "disputed"}


async def get_dashboard(
    client: AsyncClient,
    company_id: UUID,
) -> DashboardResponse:
    """Build dashboard data from jobs and events tables.

    All queries use the authenticated client so RLS enforces tenant isolation.
    """
    # 1. Fetch all non-deleted jobs (select only fields we need for aggregation)
    jobs_result = await (
        client.table("jobs")
        .select(
            "id, job_number, address_line1, city, state, status, "
            "customer_name, loss_type, job_type, created_at, updated_at"
        )
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    jobs = jobs_result.data or []

    # 2. Build pipeline counts — single 9-status lifecycle (Spec 01K).
    # mitigation + reconstruction were unified under one pipeline; job_type
    # now lives separately as a property of the job, not the stage.
    counts: dict[str, int] = {}
    for job in jobs:
        s = job.get("status", "lead")
        counts[s] = counts.get(s, 0) + 1

    pipeline = [
        PipelineStage(
            stage=stage,
            count=counts.get(stage, 0),
            total_estimate=0.0,
        )
        for stage in PIPELINE_STAGES
    ]

    # Spec 01K — single pipeline replaces the separate recon track. Field
    # stays on DashboardResponse (required by schema) but is always empty.
    reconstruction_pipeline: list[PipelineStage] = []

    # 3. Compute KPIs
    active_jobs = sum(1 for j in jobs if j.get("status") in ACTIVE_STATUSES)

    now = datetime.now(UTC)
    first_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    jobs_this_month = 0
    for j in jobs:
        created_str = j.get("created_at", "")
        if created_str:
            try:
                created = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                if created >= first_of_month:
                    jobs_this_month += 1
            except (ValueError, TypeError):
                pass

    kpis = KPIs(
        active_jobs=active_jobs,
        jobs_this_month=jobs_this_month,
        avg_days_to_complete=0.0,  # requires completion timestamps, not yet tracked
    )

    # 4. Recent events (reuse existing service)
    events_result = await list_company_events(
        client,
        company_id=company_id,
        limit=20,
        offset=0,
    )
    recent_events = events_result.get("items", [])

    # 5. Priority jobs (new or mitigation — need action)
    priority_jobs = [
        PriorityJob(
            id=j["id"],
            job_number=j["job_number"],
            address_line1=j["address_line1"],
            city=j.get("city", ""),
            state=j.get("state", ""),
            status=j["status"],
            customer_name=j.get("customer_name"),
            loss_type=j.get("loss_type", "water"),
            created_at=j["created_at"],
        )
        for j in jobs
        if j.get("status") in PRIORITY_STATUSES
    ][:10]  # cap at 10

    return DashboardResponse(
        pipeline=pipeline,
        reconstruction_pipeline=reconstruction_pipeline,
        kpis=kpis,
        recent_events=recent_events,
        priority_jobs=priority_jobs,
    )
