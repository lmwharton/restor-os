import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the server supabase client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Mock the client-side api module so ApiError is available to api-server
vi.mock("@/lib/api", async () => {
  class ApiError extends Error {
    status: number;
    error_code: string;
    constructor(status: number, message: string, error_code: string) {
      super(message);
      this.status = status;
      this.error_code = error_code;
    }
  }
  return { ApiError };
});

import { apiGetServer } from "../api-server";
import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api";

const mockGetSession = vi.fn();
const mockCreateClient = vi.mocked(createClient);

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mockCreateClient.mockResolvedValue({
    auth: { getSession: mockGetSession },
  } as never);

  mockGetSession.mockResolvedValue({
    data: { session: { access_token: "server-jwt-token" } },
  });

  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(status: number, body?: unknown, statusText = "OK") {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
  vi.mocked(globalThis.fetch).mockResolvedValue(response);
  return response;
}

describe("apiGetServer", () => {
  it("returns parsed JSON on successful response", async () => {
    const data = [{ id: "1", job_number: "J-001" }];
    mockFetch(200, data);

    const result = await apiGetServer("/v1/jobs");

    expect(result).toEqual(data);
  });

  it("includes Authorization header from server session", async () => {
    mockFetch(200, []);

    await apiGetServer("/v1/jobs");

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer server-jwt-token");
  });

  it("throws ApiError on 500 response instead of returning empty array", async () => {
    mockFetch(500, { error: "Internal Server Error", error_code: "SERVER_ERROR" }, "Internal Server Error");

    await expect(apiGetServer("/v1/jobs")).rejects.toThrow(ApiError);
    await expect(apiGetServer("/v1/jobs")).rejects.toMatchObject({
      status: 500,
    });
  });

  it("throws ApiError on 401 response", async () => {
    mockFetch(401, { error: "Unauthorized", error_code: "AUTH_REQUIRED" }, "Unauthorized");

    await expect(apiGetServer("/v1/protected")).rejects.toThrow(ApiError);
    await expect(apiGetServer("/v1/protected")).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("throws ApiError on 404 response", async () => {
    mockFetch(404, { error: "Not found", error_code: "NOT_FOUND" }, "Not Found");

    await expect(apiGetServer("/v1/jobs/missing")).rejects.toThrow(ApiError);
  });

  it("returns undefined for 204 No Content", async () => {
    const response = {
      ok: true,
      status: 204,
      statusText: "No Content",
      json: vi.fn().mockRejectedValue(new Error("no body")),
    } as unknown as Response;
    vi.mocked(globalThis.fetch).mockResolvedValue(response);

    const result = await apiGetServer("/v1/test");
    expect(result).toBeUndefined();
  });
});
