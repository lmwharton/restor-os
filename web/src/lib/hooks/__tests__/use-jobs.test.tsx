import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock the API module
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class extends Error {
    status: number;
    error_code: string;
    constructor(s: number, m: string, c: string) {
      super(m);
      this.status = s;
      this.error_code = c;
    }
  },
}));

import { useJobs, useJob, useCreateJob } from "../use-jobs";
import { apiGet, apiPost } from "@/lib/api";
import type { JobDetail, JobCreate, PaginatedResponse } from "@/lib/types";

const mockApiGet = vi.mocked(apiGet);
const mockApiPost = vi.mocked(apiPost);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const fakeJob: JobDetail = {
  id: "job-1",
  company_id: "co-1",
  property_id: null,
  job_type: "mitigation",
  linked_job_id: null,
  linked_job_summary: null,
  job_number: "J-001",
  address_line1: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  customer_name: "John Doe",
  customer_phone: null,
  customer_email: null,
  claim_number: null,
  carrier: null,
  adjuster_name: null,
  adjuster_phone: null,
  adjuster_email: null,
  loss_type: "water",
  loss_category: null,
  loss_class: null,
  loss_cause: null,
  loss_date: null,
  home_year_built: null,
  status: "lead",
  floor_plan_id: null,
  assigned_to: null,
  notes: null,
  tech_notes: null,
  latitude: null,
  longitude: null,
  created_by: null,
  updated_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  room_count: 0,
  photo_count: 0,
  floor_plan_count: 0,
  line_item_count: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── useJobs ─────────────────────────────────────────────────────────────

describe("useJobs", () => {
  it("returns job list when API returns an array", async () => {
    mockApiGet.mockResolvedValue([fakeJob]);

    const { result } = renderHook(() => useJobs(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([fakeJob]);
  });

  it("handles paginated response format", async () => {
    const paginated: PaginatedResponse<JobDetail> = {
      items: [fakeJob],
      total: 1,
    };
    mockApiGet.mockResolvedValue(paginated);

    const { result } = renderHook(() => useJobs(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([fakeJob]);
  });

  it("passes status filter to query string", async () => {
    mockApiGet.mockResolvedValue([]);

    const { result } = renderHook(
      () => useJobs({ status: "drying" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining("status=drying"),
    );
  });

  it("passes search filter to query string", async () => {
    mockApiGet.mockResolvedValue([]);

    const { result } = renderHook(
      () => useJobs({ search: "main st" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining("search=main+st"),
    );
  });

  it("returns empty array when paginated response has no items", async () => {
    mockApiGet.mockResolvedValue({ total: 0 });

    const { result } = renderHook(() => useJobs(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ─── useJob ──────────────────────────────────────────────────────────────

describe("useJob", () => {
  it("returns a single job by ID", async () => {
    mockApiGet.mockResolvedValue(fakeJob);

    const { result } = renderHook(() => useJob("job-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(fakeJob);
    expect(mockApiGet).toHaveBeenCalledWith("/v1/jobs/job-1");
  });

  it("does not fetch when jobId is empty", async () => {
    const { result } = renderHook(() => useJob(""), {
      wrapper: createWrapper(),
    });

    // Query should remain in idle/pending state, never call the API
    expect(result.current.isFetching).toBe(false);
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});

// ─── useCreateJob ────────────────────────────────────────────────────────

describe("useCreateJob", () => {
  it("calls apiPost and returns the created job", async () => {
    const newJob: JobCreate = {
      address_line1: "456 Oak Ave",
      loss_type: "water",
      city: "Dallas",
      state: "TX",
      zip: "75201",
    };
    const created = { ...fakeJob, id: "job-new", ...newJob };
    mockApiPost.mockResolvedValue(created);

    const { result } = renderHook(() => useCreateJob(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(newJob);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(created);
    expect(mockApiPost).toHaveBeenCalledWith("/v1/jobs", newJob);
  });
});
