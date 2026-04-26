import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

import { useUpdateMoisturePin } from "../use-moisture-pins";
import { apiPatch } from "@/lib/api";

const mockApiPatch = vi.mocked(apiPatch);

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidateSpy, wrapper };
}

describe("useUpdateMoisturePin onError rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The structural fix from the canvas-bounds incident. Backend rejects
  // canvas_x < 0 with 422; without this rollback, the optimistic
  // setQueryData write inside konva-floor-plan's pin-follow stays in
  // the cache and the canvas keeps rendering the pin at coordinates the
  // server never accepted. Hard refresh appears to fix it but actually
  // reveals pre-existing divergence — the cache was lying.
  it("invalidates moisture-pins on PATCH failure to discard the optimistic write", async () => {
    mockApiPatch.mockRejectedValueOnce(new Error("422 canvas_x out of bounds"));
    const { invalidateSpy, wrapper } = setup();

    const { result } = renderHook(() => useUpdateMoisturePin("job-1"), {
      wrapper,
    });

    result.current.mutate({ pinId: "pin-1", canvas_x: -50, canvas_y: 100 });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["moisture-pins", "job-1"],
    });
  });

  // Sibling guarantee for commit 731c061. Coord-only PATCHes intentionally
  // skip invalidation on success so a multi-pin drag can't refetch
  // mid-flight, return mixed server state, and snap pin B back to its
  // pre-drag position. Asserting it stays skipped here so a future
  // refactor of the hook's onSuccess can't silently break the drag race
  // fix without tripping a test.
  it("does NOT invalidate on a successful coord-only PATCH", async () => {
    mockApiPatch.mockResolvedValueOnce({ id: "pin-1" } as never);
    const { invalidateSpy, wrapper } = setup();

    const { result } = renderHook(() => useUpdateMoisturePin("job-1"), {
      wrapper,
    });

    result.current.mutate({ pinId: "pin-1", canvas_x: 200, canvas_y: 300 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledForMoisturePins = invalidateSpy.mock.calls.some(
      (args) =>
        Array.isArray(args[0]?.queryKey)
        && args[0]!.queryKey[0] === "moisture-pins",
    );
    expect(calledForMoisturePins).toBe(false);
  });

  // Non-coord PATCHes (material change, location_name rename) DO invalidate
  // because the backend recomputes derived fields like dry_standard, color,
  // and last_reading_color. Same line in the hook's onSuccess.
  it("DOES invalidate on a successful non-coord PATCH", async () => {
    mockApiPatch.mockResolvedValueOnce({ id: "pin-1" } as never);
    const { invalidateSpy, wrapper } = setup();

    const { result } = renderHook(() => useUpdateMoisturePin("job-1"), {
      wrapper,
    });

    result.current.mutate({ pinId: "pin-1", material: "drywall" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["moisture-pins", "job-1"],
    });
  });
});
