"use client";

import { useMemo } from "react";
import { useJobs, useCompanyEvents } from "./use-jobs";
import type {
  JobDetail,
  PipelineStageData,
  PipelineStage,
  TeamMember,
} from "../types";
import { JOB_STATUSES } from "../types";
import { STATUS_META } from "../labels";
import { isJobArchived } from "../job-status";

// ─── Pipeline — derived from real jobs (Spec 01K) ─────────────────────
// Single 9-status lifecycle pipeline replaces the dual mit/recon rows.

const PIPELINE_ORDER: readonly PipelineStage[] = JOB_STATUSES;

export function usePipeline(initialJobs?: JobDetail[]) {
  const { data: jobs, isLoading } = useJobs(undefined, initialJobs);

  const pipeline = useMemo<PipelineStageData[]>(() => {
    const blank = PIPELINE_ORDER.map((stage) => ({
      stage,
      label: STATUS_META[stage].label,
      count: 0,
      amount: 0,
      color: STATUS_META[stage].color,
    }));
    if (!jobs) return blank;

    const counts: Record<string, number> = {};
    for (const stage of PIPELINE_ORDER) counts[stage] = 0;
    for (const job of jobs) {
      const s = job.status as PipelineStage;
      if (s in counts) counts[s]++;
    }

    return PIPELINE_ORDER.map((stage) => ({
      stage,
      label: STATUS_META[stage].label,
      count: counts[stage] || 0,
      amount: 0, // TODO: compute from line items when pricing is added
      color: STATUS_META[stage].color,
    }));
  }, [jobs]);

  return { data: pipeline, isLoading };
}

// ─── KPIs — derived from real jobs ────────────────────────────────────

export function useDashboardKPIs(initialJobs?: JobDetail[]) {
  const { data: jobs, isLoading } = useJobs(undefined, initialJobs);

  const kpis = useMemo(() => {
    if (!jobs) return null;
    const activeJobs = jobs.filter((j) => !isJobArchived(j.status)).length;
    return {
      active_jobs: activeJobs,
      active_jobs_change: 0, // TODO: compare to last week
      revenue_mtd: 0, // TODO: compute from payments
      revenue_change_pct: 0,
      outstanding_ar: 0,
      avg_days_to_pay: 0,
      avg_cycle_days: 0,
      cycle_change_days: 0,
    };
  }, [jobs]);

  return { data: kpis, isLoading };
}

// ─── Priority Tasks — derived from real jobs ──────────────────────────

export function usePriorityTasks(initialJobs?: JobDetail[]) {
  const { data: jobs, isLoading } = useJobs(undefined, initialJobs);

  const tasks = useMemo(() => {
    if (!jobs) return [];
    return jobs
      .filter((j) => !isJobArchived(j.status))
      .map((job: JobDetail) => ({
        id: job.id,
        job_id: job.id,
        address: job.address_line1,
        description: buildTaskDescription(job),
        priority: getTaskPriority(job),
      }));
  }, [jobs]);

  return { data: tasks, isLoading };
}

function buildTaskDescription(job: JobDetail): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(job.created_at).getTime()) / 86400000));
  const parts: string[] = [`Day ${days}`];
  if (job.photo_count > 0) parts.push(`${job.photo_count} photos`);
  if (job.room_count > 0) parts.push(`${job.room_count} rooms`);
  return parts.join(", ");
}

function getTaskPriority(job: JobDetail): "critical" | "warning" | "normal" | "low" {
  // Spec 01K priority mapping:
  //  lead    — needs conversion attention
  //  on_hold / disputed — needs follow-up
  //  active  — work in progress, watch it
  //  others  — low priority
  if (job.status === "lead" || job.status === "disputed") return "critical";
  if (job.status === "on_hold") return "warning";
  if (job.status === "active") return "normal";
  return "low";
}

// ─── Team — placeholder until team management is built ────────────────

export function useTeamMembers() {
  // TODO: fetch from /v1/team when endpoint exists
  const members: TeamMember[] = [];
  return { data: members, isLoading: false };
}

// ─── Company Events (for activity feed) ───────────────────────────────

export { useCompanyEvents } from "./use-jobs";
