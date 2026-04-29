"use client";

/**
 * Spec 01K — Closeout gate + settings hooks.
 *
 * Backend endpoints (CREW-55 Phase 3, shipped together with this UI):
 *   GET    /v1/jobs/{job_id}/closeout-gates?target=completed
 *   GET    /v1/companies/{company_id}/closeout-settings
 *   PATCH  /v1/companies/{company_id}/closeout-settings/{id}
 *   POST   /v1/companies/{company_id}/closeout-settings/reset?job_type=mitigation
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "../api";
import type { JobStatus, JobType } from "../types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type GateLevel = "warn" | "acknowledge" | "hard_block";

/** A single closeout-gate evaluation result for a job. */
export interface CloseoutGate {
  /** Stable identifier — e.g. "contract_signed", "all_rooms_at_dry_standard". */
  item_key: string;
  /** Human-readable gate label. */
  label: string;
  /** Optional supporting detail (counts, room names, dates). */
  detail?: string | null;
  /** "ok" — gate passed. "warn" / "acknowledge" / "hard_block" — failure modes. */
  status: "ok" | "warn" | "acknowledge" | "hard_block";
}

export interface CloseoutGatesResponse {
  job_id: string;
  target_status: JobStatus;
  gates: CloseoutGate[];
}

/** A single row in the closeout-settings admin grid. */
export interface CloseoutSetting {
  id: string;
  company_id: string;
  job_type: JobType | "fire_smoke" | "remodel";
  item_key: string;
  /** Human-readable label for display in admin UI. Mirror of gate label. */
  label?: string;
  gate_level: GateLevel;
}

/** "Close Anyway" reason options for acknowledge-level gate overrides. */
export const CLOSE_ANYWAY_REASONS: { value: string; label: string }[] = [
  { value: "early_completion",  label: "Customer requested early completion" },
  { value: "scope_transferred", label: "Scope transferred to another job" },
  { value: "partial_work",      label: "Job cancelled / partial work" },
  { value: "override_logged",   label: "Dry standard override already logged" },
  { value: "other",             label: "Other (free text)" },
];

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

export function useCloseoutGates(jobId: string, targetStatus: JobStatus, enabled = true) {
  return useQuery<CloseoutGatesResponse>({
    queryKey: ["closeout-gates", jobId, targetStatus],
    enabled: enabled && !!jobId,
    queryFn: () =>
      apiGet<CloseoutGatesResponse>(
        `/v1/jobs/${jobId}/closeout-gates?target=${targetStatus}`,
      ),
  });
}

export function useCloseoutSettings(companyId: string | undefined) {
  return useQuery<CloseoutSetting[]>({
    queryKey: ["closeout-settings", companyId],
    enabled: !!companyId,
    queryFn: () =>
      apiGet<CloseoutSetting[]>(`/v1/companies/${companyId}/closeout-settings`),
  });
}

export function useUpdateCloseoutSetting(companyId: string) {
  const qc = useQueryClient();
  return useMutation<CloseoutSetting, Error, { id: string; gate_level: GateLevel }>({
    mutationFn: ({ id, gate_level }) =>
      apiPatch<CloseoutSetting>(
        `/v1/companies/${companyId}/closeout-settings/${id}`,
        { gate_level },
      ),
    onSuccess: (updated) => {
      qc.setQueryData<CloseoutSetting[]>(["closeout-settings", companyId], (prev) =>
        prev?.map((s) => (s.id === updated.id ? updated : s)),
      );
    },
  });
}

export function useResetCloseoutSettings(companyId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, { job_type: CloseoutSetting["job_type"] }>({
    mutationFn: async ({ job_type }) => {
      await apiPost<void>(
        `/v1/companies/${companyId}/closeout-settings/reset?job_type=${job_type}`,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["closeout-settings", companyId] });
    },
  });
}
