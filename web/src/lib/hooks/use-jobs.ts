"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "../api";
import type {
  JobDetail, JobCreate, Job,
  Room, Photo, PhotoType, MoistureReading, Event,
  FloorPlan, PaginatedResponse,
} from "../types";

// ─── Job Queries ──────────────────────────────────────────────────────

export function useJobs(filters?: { status?: string; search?: string }) {
  return useQuery<JobDetail[]>({
    queryKey: ["jobs", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.search) params.set("search", filters.search);
      params.set("limit", "100");
      const qs = params.toString();
      const data = await apiGet<PaginatedResponse<JobDetail>>(`/v1/jobs${qs ? `?${qs}` : ""}`);
      return data.items;
    },
  });
}

export function useJob(jobId: string) {
  return useQuery<JobDetail>({
    queryKey: ["jobs", jobId],
    queryFn: () => apiGet<JobDetail>(`/v1/jobs/${jobId}`),
    enabled: !!jobId,
  });
}

// ─── Job Mutations ────────────────────────────────────────────────────

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: JobCreate) => apiPost<Job>("/v1/jobs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useUpdateJob(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Job>) => apiPatch<Job>(`/v1/jobs/${jobId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["jobs", jobId] });
    },
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => apiDelete(`/v1/jobs/${jobId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

// ─── Room Queries + Mutations ─────────────────────────────────────────

export function useRooms(jobId: string) {
  return useQuery<Room[]>({
    queryKey: ["rooms", jobId],
    queryFn: async () => {
      const data = await apiGet<PaginatedResponse<Room>>(`/v1/jobs/${jobId}/rooms`);
      return data.items;
    },
    enabled: !!jobId,
  });
}

export function useCreateRoom(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Room>) => apiPost<Room>(`/v1/jobs/${jobId}/rooms`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rooms", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs", jobId] });
    },
  });
}

export function useUpdateRoom(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, ...data }: Partial<Room> & { roomId: string }) =>
      apiPatch<Room>(`/v1/jobs/${jobId}/rooms/${roomId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rooms", jobId] });
    },
  });
}

export function useDeleteRoom(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => apiDelete(`/v1/jobs/${jobId}/rooms/${roomId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rooms", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs", jobId] });
    },
  });
}

// ─── Photo Queries + Mutations ────────────────────────────────────────

export function usePhotos(jobId: string) {
  return useQuery<Photo[]>({
    queryKey: ["photos", jobId],
    queryFn: async () => {
      const data = await apiGet<PaginatedResponse<Photo>>(`/v1/jobs/${jobId}/photos?limit=200`);
      return data.items;
    },
    enabled: !!jobId,
  });
}

export function useUpdatePhoto(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ photoId, ...data }: { photoId: string; room_id?: string; room_name?: string; photo_type?: PhotoType; caption?: string; selected_for_ai?: boolean }) =>
      apiPatch<Photo>(`/v1/jobs/${jobId}/photos/${photoId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos", jobId] });
    },
  });
}

export function useDeletePhoto(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => apiDelete(`/v1/jobs/${jobId}/photos/${photoId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs", jobId] });
    },
  });
}

// ─── Photo Upload ────────────────────────────────────────────────────

export function useUploadPhoto(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      // Step 1: Get presigned URL
      const { upload_url, storage_path } = await apiPost<{
        upload_url: string;
        storage_path: string;
      }>(`/v1/jobs/${jobId}/photos/upload-url`, {
        filename: file.name,
        content_type: file.type,
      });
      // Step 2: Upload to storage
      await fetch(upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      // Step 3: Confirm
      return apiPost<Photo>(`/v1/jobs/${jobId}/photos/confirm`, {
        storage_path,
        filename: file.name,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs", jobId] });
    },
  });
}

// ─── Share Link ──────────────────────────────────────────────────────

export function useCreateShareLink(jobId: string) {
  return useMutation({
    mutationFn: (data: { scope?: string; expires_days?: number }) =>
      apiPost<{ share_url: string; share_token: string; expires_at: string }>(
        `/v1/jobs/${jobId}/share`,
        data
      ),
  });
}

// ─── Moisture Reading Queries + Mutations ─────────────────────────────

export function useReadings(jobId: string, roomId: string) {
  return useQuery<MoistureReading[]>({
    queryKey: ["readings", jobId, roomId],
    queryFn: async () => {
      const data = await apiGet<PaginatedResponse<MoistureReading>>(
        `/v1/jobs/${jobId}/rooms/${roomId}/readings`
      );
      return data.items;
    },
    enabled: !!jobId && !!roomId,
  });
}

export function useAllReadings(jobId: string) {
  return useQuery<MoistureReading[]>({
    queryKey: ["readings", jobId, "all"],
    queryFn: async () => {
      const data = await apiGet<PaginatedResponse<MoistureReading>>(
        `/v1/jobs/${jobId}/readings`
      );
      return data.items;
    },
    enabled: !!jobId,
  });
}

export function useCreateReading(jobId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { reading_date: string; atmospheric_temp_f?: number; atmospheric_rh_pct?: number }) =>
      apiPost<MoistureReading>(`/v1/jobs/${jobId}/rooms/${roomId}/readings`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["readings", jobId] });
    },
  });
}

export function useCreatePoint(jobId: string, readingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { location_name: string; reading_value: number; sort_order?: number }) =>
      apiPost(`/v1/jobs/${jobId}/readings/${readingId}/points`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["readings", jobId] });
    },
  });
}

export function useCreateDehu(jobId: string, readingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { dehu_model?: string; rh_out_pct?: number; temp_out_f?: number }) =>
      apiPost(`/v1/jobs/${jobId}/readings/${readingId}/dehus`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["readings", jobId] });
    },
  });
}

// ─── Event Queries ────────────────────────────────────────────────────

export function useJobEvents(jobId: string) {
  return useQuery<Event[]>({
    queryKey: ["events", jobId],
    queryFn: async () => {
      const data = await apiGet<PaginatedResponse<Event>>(`/v1/jobs/${jobId}/events`);
      return data.items;
    },
    enabled: !!jobId,
  });
}

export function useCompanyEvents() {
  return useQuery<Event[]>({
    queryKey: ["events", "company"],
    queryFn: async () => {
      const data = await apiGet<PaginatedResponse<Event>>(`/v1/events?limit=20`);
      return data.items;
    },
  });
}

// ─── Floor Plan Queries + Mutations ──────────────────────────────────

export function useFloorPlans(jobId: string) {
  return useQuery<FloorPlan[]>({
    queryKey: ["floor-plans", jobId],
    queryFn: async () => {
      const data = await apiGet<PaginatedResponse<FloorPlan>>(`/v1/jobs/${jobId}/floor-plans`);
      return data.items;
    },
    enabled: !!jobId,
  });
}

export function useCreateFloorPlan(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { floor_number?: number; floor_name?: string; canvas_data?: Record<string, unknown> }) =>
      apiPost<FloorPlan>(`/v1/jobs/${jobId}/floor-plans`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["floor-plans", jobId] });
      qc.invalidateQueries({ queryKey: ["jobs", jobId] });
    },
  });
}

export function useUpdateFloorPlan(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ floorPlanId, ...data }: { floorPlanId: string; canvas_data?: Record<string, unknown>; floor_name?: string }) =>
      apiPatch<FloorPlan>(`/v1/jobs/${jobId}/floor-plans/${floorPlanId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["floor-plans", jobId] });
    },
  });
}

export function useCleanupSketch(jobId: string, floorPlanId: string) {
  return useMutation({
    mutationFn: (canvasData: Record<string, unknown>) =>
      apiPost<{ canvas_data: Record<string, unknown> }>(
        `/v1/jobs/${jobId}/floor-plans/${floorPlanId}/ai-cleanup`,
        { canvas_data: canvasData }
      ),
  });
}
