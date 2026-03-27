"use client";

import { useQuery } from "@tanstack/react-query";
import {
  mockDashboardKPIs,
  mockPipeline,
  mockPriorityTasks,
  mockTeamMembers,
} from "../mock-data";
import type {
  DashboardKPIs,
  PipelineStageData,
  PriorityTask,
  TeamMember,
} from "../types";

const USE_MOCKS = true;

export function useDashboardKPIs() {
  return useQuery<DashboardKPIs>({
    queryKey: ["dashboard", "kpis"],
    queryFn: async () => {
      if (USE_MOCKS) return mockDashboardKPIs;
      const res = await fetch("/api/v1/dashboard/kpis");
      return res.json();
    },
  });
}

export function usePipeline() {
  return useQuery<PipelineStageData[]>({
    queryKey: ["dashboard", "pipeline"],
    queryFn: async () => {
      if (USE_MOCKS) return mockPipeline;
      const res = await fetch("/api/v1/dashboard/pipeline");
      return res.json();
    },
  });
}

export function usePriorityTasks() {
  return useQuery<PriorityTask[]>({
    queryKey: ["dashboard", "tasks"],
    queryFn: async () => {
      if (USE_MOCKS) return mockPriorityTasks;
      const res = await fetch("/api/v1/dashboard/tasks");
      return res.json();
    },
  });
}

export function useTeamMembers() {
  return useQuery<TeamMember[]>({
    queryKey: ["dashboard", "team"],
    queryFn: async () => {
      if (USE_MOCKS) return mockTeamMembers;
      const res = await fetch("/api/v1/team");
      return res.json().then((d) => d.items ?? d);
    },
  });
}
