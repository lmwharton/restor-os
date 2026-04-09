"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch } from "../api";

// ─── Types ───────────────────────────────────────────────────────────

export interface MeCompany {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  subscription_tier: string;
  created_at: string;
  updated_at: string;
}

export interface MeProfile {
  id: string;
  email: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  title: string | null;
  avatar_url: string | null;
  role: string;
  is_platform_admin: boolean;
  company: MeCompany;
}

// ─── Query ───────────────────────────────────────────────────────────

export function useMe() {
  return useQuery<MeProfile>({
    queryKey: ["me"],
    queryFn: () => apiGet<MeProfile>("/v1/me"),
    staleTime: 5 * 60 * 1000, // 5 min — cached across tab switches
    retry: 1,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<MeProfile>) =>
      apiPatch<MeProfile>("/v1/me", data),
    onSuccess: (updated) => {
      qc.setQueryData(["me"], (old: MeProfile | undefined) =>
        old ? { ...old, ...updated } : updated
      );
    },
  });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<MeCompany>) =>
      apiPatch<MeCompany>("/v1/me/company", data),
    onSuccess: (updated) => {
      qc.setQueryData(["me"], (old: MeProfile | undefined) =>
        old ? { ...old, company: { ...old.company, ...updated } } : old
      );
    },
  });
}
