"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "../api";
import type {
  JobDetail, JobCreate, Job,
  Room, Photo, PhotoType, MoistureReading, Event,
  FloorPlan, FloorPlanVersion, PaginatedResponse, ReconPhase,
  WallSegment, WallOpening,
} from "../types";
// Mock data fallback — remove when real backend is connected
import { mockJobs, mockRooms, mockPhotos, mockEvents, mockReconPhases } from "../mock-data";
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";

// ─── Job Queries ──────────────────────────────────────────────────────

export function useJobs(filters?: { status?: string; search?: string; job_type?: string }, initialData?: JobDetail[]) {
  return useQuery<JobDetail[]>({
    queryKey: ["jobs", filters],
    queryFn: async () => {
      if (USE_MOCK) return mockJobs;
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.search) params.set("search", filters.search);
      if (filters?.job_type) params.set("job_type", filters.job_type);
      params.set("limit", "100");
      const qs = params.toString();
      const data = await apiGet<JobDetail[] | PaginatedResponse<JobDetail>>(`/v1/jobs${qs ? `?${qs}` : ""}`);
      if (Array.isArray(data)) return data;
      return data.items ?? [];
    },
    initialData: USE_MOCK ? undefined : initialData,
  });
}

export function useJob(jobId: string) {
  return useQuery<JobDetail>({
    queryKey: ["jobs", jobId],
    queryFn: async () => {
      if (USE_MOCK) return mockJobs.find((j) => j.id === jobId) ?? mockJobs[0];
      return apiGet<JobDetail>(`/v1/jobs/${jobId}`);
    },
    enabled: !!jobId,
    // The job's floor_plan_version_id changes via backend side-effects (saves on
    // this job, forks from sibling jobs, auto-upgrades). Components that render
    // floor-plan thumbnails or hydration depend on this being fresh. Override
    // the global 1-minute staleTime so navigating between job pages always
    // re-reads the current pin instead of trusting a potentially-stale snapshot.
    staleTime: 0,
    refetchOnMount: "always",
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
      if (USE_MOCK) return mockRooms.filter((r) => r.job_id === jobId);
      const data = await apiGet<Room[] | PaginatedResponse<Room>>(`/v1/jobs/${jobId}/rooms`);
      if (Array.isArray(data)) return data;
      return data.items ?? [];
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
      if (USE_MOCK) return mockPhotos.filter((p) => p.job_id === jobId);
      const data = await apiGet<Photo[] | PaginatedResponse<Photo>>(`/v1/jobs/${jobId}/photos?limit=200`);
      if (Array.isArray(data)) return data;
      return data.items ?? [];
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
    mutationFn: async ({ file, room_id, room_name }: { file: File; room_id?: string; room_name?: string }) => {
      // Step 1: Get presigned URL
      const { upload_url, storage_path } = await apiPost<{
        upload_url: string;
        storage_path: string;
      }>(`/v1/jobs/${jobId}/photos/upload-url`, {
        filename: file.name,
        content_type: file.type,
      });
      // Step 2: Upload to storage
      const uploadRes = await fetch(upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadRes.ok) {
        throw new Error(`Storage upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
      }
      // Step 3: Confirm (with optional room association)
      return apiPost<Photo>(`/v1/jobs/${jobId}/photos/confirm`, {
        storage_path,
        filename: file.name,
        ...(room_id && { room_id }),
        ...(room_name && { room_name }),
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
      const data = await apiGet<MoistureReading[] | PaginatedResponse<MoistureReading>>(
        `/v1/jobs/${jobId}/rooms/${roomId}/readings`
      );
      if (Array.isArray(data)) return data;
      return data.items ?? [];
    },
    enabled: !!jobId && !!roomId,
  });
}

export function useAllReadings(jobId: string) {
  return useQuery<MoistureReading[]>({
    queryKey: ["readings", jobId, "all"],
    queryFn: async () => {
      const data = await apiGet<MoistureReading[] | PaginatedResponse<MoistureReading>>(
        `/v1/jobs/${jobId}/readings`
      );
      if (Array.isArray(data)) return data;
      return data.items ?? [];
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
      if (USE_MOCK) return mockEvents.filter((e) => e.job_id === jobId);
      const data = await apiGet<Event[] | PaginatedResponse<Event>>(`/v1/jobs/${jobId}/events`);
      if (Array.isArray(data)) return data;
      return data.items ?? [];
    },
    enabled: !!jobId,
  });
}

export function useCompanyEvents(initialData?: Event[]) {
  return useQuery<Event[]>({
    queryKey: ["events", "company"],
    queryFn: async () => {
      if (USE_MOCK) return mockEvents;
      const data = await apiGet<Event[] | PaginatedResponse<Event>>(`/v1/events?limit=20`);
      if (Array.isArray(data)) return data;
      return data.items ?? [];
    },
    initialData: USE_MOCK ? undefined : initialData,
  });
}

// ─── Recon Phase Queries ─────────────────────────────────────────────

export function useReconPhases(jobId: string) {
  return useQuery<ReconPhase[]>({
    queryKey: ["recon-phases", jobId],
    queryFn: async () => {
      if (USE_MOCK) return mockReconPhases.filter((p: ReconPhase) => p.job_id === jobId);
      const data = await apiGet<ReconPhase[] | PaginatedResponse<ReconPhase>>(`/v1/jobs/${jobId}/recon-phases`);
      if (Array.isArray(data)) return data;
      return data.items ?? [];
    },
    enabled: !!jobId,
  });
}

export function useCreateReconPhase(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { phase_name: string; sort_order: number }) =>
      apiPost<ReconPhase>(`/v1/jobs/${jobId}/recon-phases`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recon-phases", jobId] });
    },
  });
}

export function useUpdateReconPhase(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ phaseId, ...data }: { phaseId: string; status?: string; phase_name?: string; notes?: string }) =>
      apiPatch<ReconPhase>(`/v1/jobs/${jobId}/recon-phases/${phaseId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recon-phases", jobId] });
    },
  });
}

export function useDeleteReconPhase(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phaseId: string) =>
      apiDelete(`/v1/jobs/${jobId}/recon-phases/${phaseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recon-phases", jobId] });
    },
  });
}

export function useReorderReconPhases(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { id: string; sort_order: number }[]) =>
      apiPost(`/v1/jobs/${jobId}/recon-phases/reorder`, { phases: items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recon-phases", jobId] });
    },
  });
}

// ─── Floor Plan Queries + Mutations ──────────────────────────────────

export function useFloorPlans(jobId: string) {
  return useQuery<FloorPlan[]>({
    queryKey: ["floor-plans", jobId],
    queryFn: async () => {
      // Backend returns a plain array (not paginated), but handle both shapes defensively
      const data = await apiGet<FloorPlan[] | PaginatedResponse<FloorPlan>>(`/v1/jobs/${jobId}/floor-plans`);
      if (Array.isArray(data)) return data;
      return data.items ?? [];
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
    onSuccess: (updatedFloorPlan) => {
      // Optimistic cache update — use the PATCH response directly instead of re-fetching.
      // Eliminates 1 GET call per auto-save (critical on low-bandwidth cellular networks).
      qc.setQueryData<FloorPlan[]>(["floor-plans", jobId], (old) =>
        old?.map((fp) => (fp.id === updatedFloorPlan.id ? updatedFloorPlan : fp))
      );
    },
  });
}

export function useDeleteFloorPlan(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (floorPlanId: string) =>
      apiDelete(`/v1/jobs/${jobId}/floor-plans/${floorPlanId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["floor-plans", jobId] });
    },
  });
}

export function useCleanupSketch(floorPlanId: string) {
  return useMutation({
    mutationFn: (canvasData: Record<string, unknown>) =>
      apiPost<{ canvas_data: Record<string, unknown> }>(
        `/v1/floor-plans/${floorPlanId}/cleanup`,
        { canvas_data: canvasData }
      ),
  });
}

// ─── Floor Plan Version Queries + Mutations ─────────────────────────

export function useFloorPlanVersions(floorPlanId: string) {
  return useQuery<FloorPlanVersion[]>({
    queryKey: ["floor-plan-versions", floorPlanId],
    queryFn: async () => {
      const data = await apiGet<FloorPlanVersion[] | PaginatedResponse<FloorPlanVersion>>(
        `/v1/floor-plans/${floorPlanId}/versions`
      );
      if (Array.isArray(data)) return data;
      return data.items ?? [];
    },
    enabled: !!floorPlanId,
  });
}

export function useSaveCanvas(floorPlanId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { job_id: string; canvas_data: Record<string, unknown>; change_summary?: string }) =>
      apiPost<FloorPlanVersion>(`/v1/floor-plans/${floorPlanId}/versions`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["floor-plan-versions", floorPlanId] });
    },
  });
}

// ─── Wall Queries + Mutations ───────────────────────────────────────

export function useWalls(roomId: string) {
  return useQuery<WallSegment[]>({
    queryKey: ["walls", roomId],
    queryFn: async () => {
      const data = await apiGet<WallSegment[] | PaginatedResponse<WallSegment>>(
        `/v1/rooms/${roomId}/walls`
      );
      if (Array.isArray(data)) return data;
      return data.items ?? [];
    },
    enabled: !!roomId,
  });
}

export function useCreateWall(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      x1: number; y1: number; x2: number; y2: number;
      wall_type?: string; affected?: boolean; shared?: boolean;
      shared_with_room_id?: string; sort_order?: number;
    }) => apiPost<WallSegment>(`/v1/rooms/${roomId}/walls`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["walls", roomId] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
    },
  });
}

export function useUpdateWall(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ wallId, ...data }: { wallId: string } & Partial<WallSegment>) =>
      apiPatch<WallSegment>(`/v1/rooms/${roomId}/walls/${wallId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["walls", roomId] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
    },
  });
}

export function useDeleteWall(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (wallId: string) =>
      apiDelete(`/v1/rooms/${roomId}/walls/${wallId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["walls", roomId] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
    },
  });
}

export function useCreateOpening(roomId: string, wallId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      opening_type: string; position: number;
      width_ft: number; height_ft: number;
      sill_height_ft?: number; swing?: number;
    }) => apiPost<WallOpening>(`/v1/rooms/${roomId}/walls/${wallId}/openings`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["walls", roomId] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
    },
  });
}

export function useUpdateOpening(roomId: string, wallId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ openingId, ...data }: { openingId: string } & Partial<WallOpening>) =>
      apiPatch<WallOpening>(`/v1/rooms/${roomId}/walls/${wallId}/openings/${openingId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["walls", roomId] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
    },
  });
}

export function useDeleteOpening(roomId: string, wallId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (openingId: string) =>
      apiDelete(`/v1/rooms/${roomId}/walls/${wallId}/openings/${openingId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["walls", roomId] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
    },
  });
}
