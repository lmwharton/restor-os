"use client";

import { useEffect, useState, useCallback } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const POLL_INTERVAL = 60_000; // 60 seconds

interface ServiceStatus {
  status: string;
  error?: string;
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  timestamp: string;
  environment: string;
  services: Record<string, ServiceStatus>;
}

interface HealthState {
  status: "healthy" | "degraded" | "unhealthy" | "loading" | "unreachable";
  text: string;
  services: Record<string, ServiceStatus>;
}

export function useHealthStatus(): HealthState {
  const [state, setState] = useState<HealthState>({
    status: "loading",
    text: "Checking...",
    services: {},
  });

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: HealthResponse = await res.json();

      const text =
        data.status === "healthy"
          ? "All Systems Operational"
          : data.status === "degraded"
            ? "Degraded"
            : "Unhealthy";

      setState({ status: data.status, text, services: data.services });
    } catch {
      setState({
        status: "unreachable",
        text: "API Unreachable",
        services: { api: { status: "unreachable" } },
      });
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [check]);

  return state;
}
