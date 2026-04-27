/**
 * Dashboard "Complete your setup" banner.
 *
 * Reads `GET /v1/company/onboarding-status` via TanStack Query and shows
 * the banner only when `show_setup_banner === true` (server-computed —
 * see `auth/service.py:get_onboarding_status`). Two actions:
 *
 *   - [Complete Setup] → /settings/pricing
 *   - [Dismiss]        → PATCH /v1/me/dismiss-setup-banner, optimistic hide
 *
 * After team-invites moved out of scope, the only remaining optional
 * reminder is pricing.
 */
"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dismissSetupBanner,
  getOnboardingStatus,
  type OnboardingStatus,
} from "@/lib/onboarding-api";

export default function SetupBanner() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery<OnboardingStatus>({
    queryKey: ["onboarding-status"],
    queryFn: getOnboardingStatus,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const dismissMutation = useMutation({
    mutationFn: dismissSetupBanner,
    onMutate: async () => {
      // Optimistic hide — flip `show_setup_banner` to false in the cache
      // before the server confirms.
      await queryClient.cancelQueries({ queryKey: ["onboarding-status"] });
      const previous = queryClient.getQueryData<OnboardingStatus>(["onboarding-status"]);
      if (previous) {
        queryClient.setQueryData<OnboardingStatus>(["onboarding-status"], {
          ...previous,
          show_setup_banner: false,
          setup_banner_dismissed_at: new Date().toISOString(),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      // Roll back on failure — the banner reappears so the user knows the
      // dismiss didn't take.
      if (ctx?.previous) {
        queryClient.setQueryData(["onboarding-status"], ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
    },
  });

  if (!status?.show_setup_banner) return null;

  return (
    <div
      className="rounded-xl border px-4 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      style={{
        borderColor: "#fbcab5",
        backgroundColor: "#fff4ed",
      }}
      role="region"
      aria-label="Complete your Crewmatic setup"
    >
      <div className="flex items-start gap-3">
        <InfoIcon />
        <div>
          <p className="text-[13px] font-semibold" style={{ color: "#7a2c0b" }}>
            Complete your setup
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-on-surface-variant flex items-center gap-1.5">
            <span aria-hidden style={{ color: "#a63500" }}>○</span>
            Upload pricing to create estimates faster
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/settings/pricing"
          className="inline-flex h-9 items-center justify-center rounded-lg bg-brand-accent px-3.5 text-[12px] font-semibold text-white transition hover:shadow-md active:scale-[0.98]"
        >
          Complete Setup
        </Link>
        <button
          type="button"
          onClick={() => dismissMutation.mutate()}
          disabled={dismissMutation.isPending}
          className="inline-flex h-9 items-center justify-center rounded-lg border bg-white px-3 text-[12px] font-medium text-on-surface-variant transition hover:bg-surface-container-low/60 active:scale-[0.98] disabled:opacity-50"
          style={{ borderColor: "#e1bfb4" }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function InfoIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0 mt-0.5"
    >
      <circle cx="12" cy="12" r="10" stroke="#a63500" strokeWidth="1.5" />
      <path
        d="M12 8h.01M12 11v5"
        stroke="#a63500"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
