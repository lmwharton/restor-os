"use client";

// Tech-facing moisture report route (Task 6 per Spec 01H Phase 2).
// Thin wrapper around <MoistureReportView> — assembles the data via
// existing hooks, wires the date-picker to the ?date query param,
// and adds a "Print / Save PDF" button + print chrome. The view
// component itself is shared with the adjuster-portal route
// (Task 7 — /shared/[token]/moisture).
//
// Why frontend-only? The existing Phase 1 report (/jobs/[id]/report)
// ships the same way — one print-friendly HTML page + window.print().
// No PDF library, no server-side rendering of Konva, no migration
// required. Matches the established pattern.

import { useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { MoistureReportView } from "@/components/moisture-report/moisture-report-view";
import { useJob, useFloorPlans } from "@/lib/hooks/use-jobs";
import { useMe } from "@/lib/hooks/use-me";
import { useMoisturePins } from "@/lib/hooks/use-moisture-pins";
import { todayLocalIso } from "@/lib/dates";
import { buildMoistureReportProps } from "@/lib/build-moisture-report-props";

export default function MoistureReportPage() {
  const rawParams = useParams();
  const params = rawParams as { id: string };
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = params.id;

  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: floorPlans } = useFloorPlans(jobId);
  const { data: pins } = useMoisturePins(jobId);
  const { data: me } = useMe();


  // Date picker state lives in the URL so the print output reflects
  // what the tech selected. Default is the tech's local today.
  const selectedDate = searchParams.get("date") ?? todayLocalIso();
  const setSelectedDate = (iso: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("date", iso);
    router.replace(`/jobs/${jobId}/moisture-report?${sp.toString()}`);
  };

  const setSelectedFloorId = (id: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("floor", id);
    router.replace(`/jobs/${jobId}/moisture-report?${sp.toString()}`);
  };

  // Build floors + readings via the shared derivation so the portal
  // and the tech view stay aligned on primary-floor resolution, pin
  // bucketing, and reading normalization. See
  // `lib/build-moisture-report-props.ts` for the full contract.
  const { floors: floorsList, readingsByPinId, orphanPins, defaultFloorId } = useMemo(
    () =>
      buildMoistureReportProps({
        pins: pins ?? [],
        floorPlans: floorPlans ?? [],
        primaryFloorId: job?.floor_plan_id ?? null,
      }),
    [pins, floorPlans, job?.floor_plan_id],
  );

  // URL `?floor=` wins, then the job's pinned floor (defaultFloorId).
  // Without the second fallback, multi-floor jobs pinned to upper
  // opened on the basement until the user manually switched.
  const selectedFloorId =
    searchParams.get("floor") ?? defaultFloorId ?? undefined;

  if (jobLoading || !job) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-container-lowest">
        <div className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant">
          Loading report…
        </div>
      </div>
    );
  }

  // Address composition — backend stores address_line1 + city + state + zip.
  const addressParts = [
    job.address_line1,
    job.city,
    job.state && job.zip ? `${job.state} ${job.zip}` : job.state || job.zip,
  ].filter(Boolean);
  const address = addressParts.length > 0 ? addressParts.join(", ") : null;

  return (
    <div className="report-root bg-white min-h-screen">
      {/* Floating toolbar — hidden in print via .no-print. Mirrors the
          Phase 1 /report page's toolbar layout so the two reports
          feel like one product. */}
      <div className="no-print sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-outline-variant/40 px-6 py-3 flex items-center gap-4">
        <button
          type="button"
          onClick={() => router.push(`/jobs/${jobId}`)}
          aria-label="Back to job"
          className="text-sm text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M19 12H5m6-6-6 6 6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {/* Label is redundant with the arrow on mobile — the
              back-arrow-as-back convention is universal. Restore on
              ≥sm where there's room for richer chrome. */}
          <span className="hidden sm:inline">Back to Job</span>
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => window.print()}
          className="px-5 py-2 bg-brand-accent text-on-primary text-sm font-semibold rounded-lg hover:bg-brand-accent/90 transition-colors cursor-pointer"
        >
          Print / Save PDF
        </button>
      </div>

      {/* Report body. `.print-section` wraps the whole view so the
          global print CSS doesn't hide the view's <header> element
          (globals.css selector: `header:not(.print-section *)`). The
          constrained max-width matches the Phase 1 /report page;
          on mobile (<sm) the padding relaxes so the canvas isn't
          clipped by US-Letter margins in a 375px viewport. */}
      <div className="print-section max-w-[8.5in] mx-auto py-6 sm:py-10 print:py-0 print:max-w-none">
        <MoistureReportView
          job={{
            job_number: (job as { job_number?: string }).job_number ?? null,
            customer_name: job.customer_name ?? null,
            address,
          }}
          company={{
            name: me?.company?.name ?? "Drying log",
            logo_url:
              (me?.company as { logo_url?: string | null } | undefined)
                ?.logo_url ?? null,
          }}
          floors={floorsList}
          readingsByPinId={readingsByPinId}
          orphanPins={orphanPins}
          selectedDate={selectedDate}
          onSelectedDateChange={setSelectedDate}
          selectedFloorId={selectedFloorId}
          onSelectedFloorChange={setSelectedFloorId}
          // Review round-1 H2 — carrier-facing surfaces bucket days by
          // the job's timezone, not the browser. Falls back to the DB
          // default if the field isn't on the payload (backward-compat
          // during the post-deploy warmup while everyone picks up the
          // new schema); after PR-D's zip resolver lands, this will
          // reflect the property's actual zone.
          jobTimezone={
            (job as { timezone?: string }).timezone
            ?? "America/New_York"
          }
        />
      </div>
    </div>
  );
}
