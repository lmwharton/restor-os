"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api";
import type {
  MoistureMaterial,
  MoisturePin,
  MoisturePinReading,
  PaginatedResponse,
} from "../types";

// ─── Pin Queries ──────────────────────────────────────────────────────

export function useMoisturePins(jobId: string) {
  return useQuery<MoisturePin[]>({
    queryKey: ["moisture-pins", jobId],
    queryFn: async () => {
      const data = await apiGet<MoisturePin[] | PaginatedResponse<MoisturePin>>(
        `/v1/jobs/${jobId}/moisture-pins`,
      );
      if (Array.isArray(data)) return data;
      return data.items ?? [];
    },
    enabled: !!jobId,
  });
}

// ─── Pin Mutations ────────────────────────────────────────────────────

export interface CreateMoisturePinBody {
  room_id: string;
  canvas_x: number;
  canvas_y: number;
  location_name: string;
  material: MoistureMaterial;
  /** Omit to use the material default from the backend DRY_STANDARDS dict. */
  dry_standard?: number;
  initial_reading: {
    reading_value: number;
    /** TIMESTAMPTZ ISO string, e.g. `new Date().toISOString()`. */
    taken_at: string;
    meter_photo_url?: string | null;
    notes?: string | null;
  };
}

export function useCreateMoisturePin(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMoisturePinBody) =>
      apiPost<MoisturePin>(`/v1/jobs/${jobId}/moisture-pins`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
    },
  });
}

export interface UpdateMoisturePinBody {
  location_name?: string;
  material?: MoistureMaterial;
  dry_standard?: number;
  canvas_x?: number;
  canvas_y?: number;
  room_id?: string;
}

export function useUpdateMoisturePin(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      pinId,
      ...body
    }: UpdateMoisturePinBody & { pinId: string }) =>
      apiPatch<MoisturePin>(`/v1/jobs/${jobId}/moisture-pins/${pinId}`, body),
    onSuccess: (_pin, { pinId }) => {
      qc.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
      qc.invalidateQueries({ queryKey: ["moisture-pin-readings", pinId] });
    },
  });
}

export function useDeleteMoisturePin(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pinId: string) =>
      apiDelete(`/v1/jobs/${jobId}/moisture-pins/${pinId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
    },
  });
}

// ─── Reading Queries ──────────────────────────────────────────────────

export function usePinReadings(jobId: string, pinId: string) {
  return useQuery<MoisturePinReading[]>({
    queryKey: ["moisture-pin-readings", pinId],
    queryFn: async () => {
      const data = await apiGet<
        MoisturePinReading[] | PaginatedResponse<MoisturePinReading>
      >(`/v1/jobs/${jobId}/moisture-pins/${pinId}/readings`);
      if (Array.isArray(data)) return data;
      return data.items ?? [];
    },
    enabled: !!jobId && !!pinId,
  });
}

// ─── Reading Mutations ────────────────────────────────────────────────

export interface CreatePinReadingBody {
  reading_value: number;
  /** TIMESTAMPTZ ISO string, e.g. `new Date().toISOString()`. */
  taken_at: string;
  meter_photo_url?: string | null;
  notes?: string | null;
}

export function useCreatePinReading(jobId: string, pinId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePinReadingBody) =>
      apiPost<MoisturePinReading>(
        `/v1/jobs/${jobId}/moisture-pins/${pinId}/readings`,
        body,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moisture-pin-readings", pinId] });
      qc.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
    },
  });
}

export interface UpdatePinReadingBody {
  reading_value?: number;
  taken_at?: string;
  meter_photo_url?: string | null;
  notes?: string | null;
}

export function useUpdatePinReading(jobId: string, pinId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      readingId,
      ...body
    }: UpdatePinReadingBody & { readingId: string }) =>
      apiPatch<MoisturePinReading>(
        `/v1/jobs/${jobId}/moisture-pins/${pinId}/readings/${readingId}`,
        body,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moisture-pin-readings", pinId] });
      qc.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
    },
  });
}

export function useDeletePinReading(jobId: string, pinId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (readingId: string) =>
      apiDelete(
        `/v1/jobs/${jobId}/moisture-pins/${pinId}/readings/${readingId}`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moisture-pin-readings", pinId] });
      qc.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
    },
  });
}

// ─── Pin color helpers (mirror of backend compute_pin_color) ──────────
//
// Mostly the backend already returns `color` on each pin in the list
// response, so components should use `pin.color` directly. These helpers
// exist for cases where we have a raw reading and need to compute color
// client-side (e.g., previewing a value in the placement card before save).

export const DRY_STANDARDS: Record<MoistureMaterial, number> = {
  drywall: 16,
  wood_subfloor: 15,
  carpet_pad: 16,
  concrete: 5,
  hardwood: 12,
  osb_plywood: 18,
  block_wall: 10,
};

// Re-exported from lib/moisture-reading-history so existing callers
// that import from `hooks/use-moisture-pins` keep working while pure
// derivation modules in lib/ can consume it without pulling the hooks
// graph (React, query client, API wrappers) into their dep tree.
export { computePinColor } from "../moisture-reading-history";
