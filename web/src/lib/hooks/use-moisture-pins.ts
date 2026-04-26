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
      const data = await apiGet<PaginatedResponse<MoisturePin>>(
        `/v1/jobs/${jobId}/moisture-pins`,
      );
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
    // Rollback the optimistic cache when a PATCH fails. Without this, a
    // 422 (e.g. backend bounds rejection), 403, or any network error
    // leaves the pin-follow `setQueryData` write in place and the canvas
    // renders the pin at coordinates the server never accepted. Hard
    // refresh appears to "fix" it but actually exposes the pre-existing
    // divergence: the cache was lying. Invalidating on error forces a
    // refetch so the canvas stays consistent with server truth on every
    // failed mutation, regardless of cause.
    onError: () => {
      qc.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
    },
    onSuccess: (_pin, variables) => {
      // Coord-only PATCHes (the pin-follow drag path: dragging a room
      // translates each child pin via canvas_x/canvas_y) skip the
      // moisture-pins invalidation. Three reasons:
      //
      //   1. The pin-follow effect already wrote the new positions
      //      optimistically via `setQueryData`; the PATCH succeeded,
      //      so the server agrees. There is no drift for the
      //      invalidation to repair.
      //
      //   2. The invalidation triggers a refetch. During a multi-pin
      //      drag, PATCHes fire serially via `queuePinCoordUpdate` —
      //      pin A succeeds and refetches BEFORE pin B's PATCH lands,
      //      so the refetch returns pin B at its pre-drag position.
      //      The cache snaps back to mixed pre/post-drag positions
      //      and the canvas re-renders that way. This is exactly the
      //      "some pins follow, some don't" flakiness Samhith reported.
      //
      //   3. A canvas auto-save Case-3 fork remounts KonvaFloorPlan
      //      via `key={activeFloor?.id}`. The remount re-reads pin
      //      positions from the React Query cache. If the cache was
      //      mid-refetch (or finished with a stale value), pins
      //      render at wrong positions despite the room being at the
      //      correct new spot — the visible "out-of-sync after
      //      refresh" symptom.
      //
      // The reading-history cache stays invalidated because reading
      // mutations (separate hooks) can change the latest_reading
      // embedded on a pin row.
      const isCoordOnly = Object.keys(variables).every(
        (k) => k === "pinId" || k === "canvas_x" || k === "canvas_y",
      );
      if (!isCoordOnly) {
        qc.invalidateQueries({ queryKey: ["moisture-pins", jobId] });
        qc.invalidateQueries({ queryKey: ["moisture-pin-readings", variables.pinId] });
      }
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
      const data = await apiGet<PaginatedResponse<MoisturePinReading>>(
        `/v1/jobs/${jobId}/moisture-pins/${pinId}/readings`,
      );
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
