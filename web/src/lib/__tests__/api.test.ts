import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the supabase client module before importing the API module
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "../api";
import { createClient } from "@/lib/supabase/client";

const mockGetSession = vi.fn();
const mockCreateClient = vi.mocked(createClient);

// Store the original fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
  mockCreateClient.mockReturnValue({
    auth: { getSession: mockGetSession },
  } as never);

  // Default: authenticated session
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: "test-jwt-token" } },
  });

  // Replace global fetch with a mock
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

// ─── apiGet ──────────────────────────────────────────────────────────────

describe("apiGet", () => {
  it("returns parsed JSON on success", async () => {
    const data = { id: "1", name: "Test Job" };
    mockFetch(200, data);

    const result = await apiGet("/v1/jobs/1");

    expect(result).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/jobs/1"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-jwt-token",
        }),
      }),
    );
  });

  it("sets Authorization header when session exists", async () => {
    mockFetch(200, {});
    await apiGet("/v1/test");

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-jwt-token");
  });

  it("omits Authorization header when no session", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });
    mockFetch(200, {});
    await apiGet("/v1/test");

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("throws ApiError on 401 response", async () => {
    mockFetch(401, { error: "Unauthorized", error_code: "AUTH_REQUIRED" }, "Unauthorized");

    await expect(apiGet("/v1/jobs")).rejects.toThrow(ApiError);
    await expect(apiGet("/v1/jobs")).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("throws ApiError on 500 response", async () => {
    mockFetch(500, { error: "Internal Server Error", error_code: "SERVER_ERROR" }, "Internal Server Error");

    await expect(apiGet("/v1/jobs")).rejects.toThrow(ApiError);
    await expect(apiGet("/v1/jobs")).rejects.toMatchObject({
      status: 500,
    });
  });

  it("returns undefined for 204 No Content", async () => {
    const response = {
      ok: true,
      status: 204,
      statusText: "No Content",
      json: vi.fn().mockRejectedValue(new Error("no body")),
    } as unknown as Response;
    vi.mocked(globalThis.fetch).mockResolvedValue(response);

    const result = await apiGet("/v1/test");
    expect(result).toBeUndefined();
  });
});

// ─── apiPost ─────────────────────────────────────────────────────────────

describe("apiPost", () => {
  it("sends POST request with JSON body", async () => {
    const payload = { address_line1: "123 Main St" };
    const created = { id: "new-1", ...payload };
    mockFetch(201, created);

    const result = await apiPost("/v1/jobs", payload);

    expect(result).toEqual(created);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/jobs"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  });

  it("sends POST without body when body is undefined", async () => {
    mockFetch(200, { ok: true });

    await apiPost("/v1/trigger");

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(callArgs[1]?.body).toBeUndefined();
  });
});

// ─── apiPatch ────────────────────────────────────────────────────────────

describe("apiPatch", () => {
  it("sends PATCH request with JSON body", async () => {
    const update = { status: "drying" };
    mockFetch(200, { id: "1", ...update });

    const result = await apiPatch("/v1/jobs/1", update);

    expect(result).toEqual({ id: "1", ...update });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/jobs/1"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify(update),
      }),
    );
  });
});

// ─── apiDelete ───────────────────────────────────────────────────────────

describe("apiDelete", () => {
  it("sends DELETE request and resolves on success", async () => {
    mockFetch(204);

    await expect(apiDelete("/v1/jobs/1")).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/jobs/1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws ApiError on failure", async () => {
    mockFetch(404, { error: "Not found", error_code: "NOT_FOUND" }, "Not Found");

    await expect(apiDelete("/v1/jobs/999")).rejects.toThrow(ApiError);
    await expect(apiDelete("/v1/jobs/999")).rejects.toMatchObject({
      status: 404,
    });
  });
});

// ─── ApiError class ──────────────────────────────────────────────────────

describe("ApiError", () => {
  it("stores status, message, and error_code", () => {
    const err = new ApiError(422, "Validation failed", "VALIDATION_ERROR");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(422);
    expect(err.message).toBe("Validation failed");
    expect(err.error_code).toBe("VALIDATION_ERROR");
  });
});
