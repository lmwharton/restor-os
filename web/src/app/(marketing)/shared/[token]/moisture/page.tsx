"use client";

// Adjuster-portal moisture report route (Task 7 per Spec 01H Phase 2).
// Public route, no auth — relies on the share-token flow defined by
// the existing /shared/[token] page. Renders the same
// <MoistureReportView> the protected route uses, without any print
// chrome. Per Brett §8.6: "This document is available in the adjuster
// portal without requiring a PDF export."
//
// Data comes from /v1/shared/resolve (POST with token body). The
// backend gates `moisture_pins` + `floor_plan` by the link's scope —
// photos_only → empty; restoration_only + full → populated. When the
// payload has no pins we render a friendly empty state rather than
// 404ing, since the adjuster may still have been granted access but
// moisture isn't part of the scope.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { MoistureReportView } from "@/components/moisture-report/moisture-report-view";
import { todayLocalIso } from "@/lib/dates";
import { buildMoistureReportProps } from "@/lib/build-moisture-report-props";
import { API_URL } from "@/lib/api-url";
import type {
  FloorPlanData,
} from "@/components/sketch/floor-plan-tools";
import type { MoisturePin } from "@/lib/types";

interface SharedPayload {
  job: {
    job_number?: string | null;
    customer_name?: string | null;
    address_line1?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  };
  company: { name: string; logo_url?: string | null };
  moisture_pins: MoisturePin[];
  floor_plans: Array<{
    id: string;
    floor_number: number;
    floor_name: string;
    canvas_data: FloorPlanData;
    is_current: boolean;
  }>;
  rooms?: Array<{
    id: string;
    room_name: string;
    floor_plan_id?: string | null;
  }>;
  // Discriminant added in H3. `denied` = scope excludes moisture
  // (photos_only). `empty` = in-scope but no pins / no floor plans.
  // `present` = data ready to render. Old payloads without this
  // field fall back to the legacy derive-from-arrays behavior so a
  // portal deploy ahead of a backend deploy keeps working.
  moisture_access?: "denied" | "unavailable" | "empty" | "present";
  // IANA timezone of the job, hoisted to the top level of the shared
  // payload so the portal doesn't have to dig into `job` (which is
  // untyped on the wire) to find it. Review round-2 H2 fix. See
  // backend `SharedJobResponse.timezone` for the contract.
  timezone?: string;
  // Job's pinned floor_plan_id, hoisted so portal picks the same
  // primary floor as the tech view.
  primary_floor_id?: string | null;
}

export default function PortalMoistureReportPage() {
  const rawParams = useParams();
  const params = rawParams as { token: string };
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = params.token;

  const [payload, setPayload] = useState<SharedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<
    "share_not_found" | "scope_forbidden" | "generic" | null
  >(null);

  const selectedDate = searchParams.get("date") ?? todayLocalIso();
  const setSelectedDate = (iso: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("date", iso);
    router.replace(`/shared/${token}/moisture?${sp.toString()}`);
  };
  const setSelectedFloorId = (id: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("floor", id);
    router.replace(`/shared/${token}/moisture?${sp.toString()}`);
  };

  // Fetch the shared payload once on mount. Uses the same
  // /v1/shared/resolve endpoint as the main /shared/[token] page;
  // the scope gate on the backend decides whether moisture_pins +
  // floor_plan are populated or empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/shared/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
        });
        if (!res.ok) {
          if (cancelled) return;
          setErrorCode(res.status === 404 ? "share_not_found" : "generic");
          setLoading(false);
          return;
        }
        const data = (await res.json()) as SharedPayload;
        if (cancelled) return;
        setPayload(data);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setErrorCode("generic");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const { floors: floorsList, readingsByPinId, orphanPins, defaultFloorId } = useMemo(
    () =>
      buildMoistureReportProps({
        pins: payload?.moisture_pins ?? [],
        floorPlans: payload?.floor_plans ?? [],
        primaryFloorId: payload?.primary_floor_id ?? null,
      }),
    [payload],
  );
  const selectedFloorId =
    searchParams.get("floor") ?? defaultFloorId ?? undefined;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant">
          Loading report…
        </div>
      </div>
    );
  }

  if (errorCode || !payload) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-md text-center">
          <h1 className="text-[18px] font-semibold text-on-surface mb-2">
            {errorCode === "share_not_found"
              ? "Share link not found"
              : "Unable to load report"}
          </h1>
          <p className="text-[13px] text-on-surface-variant">
            {errorCode === "share_not_found"
              ? "This link may have been revoked or expired. Contact the sender for a new link."
              : "Try refreshing. If the problem continues, reach out to the team at Crewmatic."}
          </p>
        </div>
      </div>
    );
  }

  // Empty-state branching keyed on the server's `moisture_access`
  // discriminant rather than guessing from array lengths. Three
  // distinct cases each get their own copy:
  //   denied  — scope excludes moisture (photos_only); adjuster must
  //             ask for a broader link.
  //   empty   — scope includes moisture but nothing's been logged;
  //             tell them to check back later, not to ask for a new
  //             link (they already have the right one).
  // Legacy payload without the discriminant: default to the LEAST
  // misleading state. "empty" copy says "no readings logged yet,
  // check back" — which is honest regardless of whether the true
  // cause is scope-denial or no-data. Defaulting to "denied" would
  // wrongly tell a restoration_only adjuster on day 1 of mitigation
  // to ask for a different link they don't actually need.
  const moistureAccess =
    payload.moisture_access ??
    (payload.moisture_pins.length === 0 || payload.floor_plans.length === 0
      ? "empty"
      : "present");
  if (moistureAccess === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-md text-center">
          <h1 className="text-[18px] font-semibold text-on-surface mb-2">
            No moisture data on this share
          </h1>
          <p className="text-[13px] text-on-surface-variant">
            Moisture readings aren&rsquo;t part of this share link&rsquo;s
            scope. If you need to review drying progress, ask the sender
            for a link with restoration or full access.
          </p>
        </div>
      </div>
    );
  }
  if (moistureAccess === "unavailable") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-md text-center">
          <h1 className="text-[18px] font-semibold text-on-surface mb-2">
            Moisture data temporarily unavailable
          </h1>
          <p className="text-[13px] text-on-surface-variant">
            We couldn&rsquo;t load the moisture report for this job
            right now. Try again in a minute. If this keeps happening,
            reach out to the sender.
          </p>
        </div>
      </div>
    );
  }
  if (moistureAccess === "empty") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-md text-center">
          <h1 className="text-[18px] font-semibold text-on-surface mb-2">
            No readings logged yet
          </h1>
          <p className="text-[13px] text-on-surface-variant">
            The restoration team hasn&rsquo;t recorded any moisture
            readings for this job yet. Check back in a day or two —
            readings usually start on day one of mitigation.
          </p>
        </div>
      </div>
    );
  }

  const job = payload.job;
  const addressParts = [
    job.address_line1,
    job.city,
    job.state && job.zip ? `${job.state} ${job.zip}` : job.state || job.zip,
  ].filter(Boolean);
  const address = addressParts.length > 0 ? addressParts.join(", ") : null;

  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-[8.5in] mx-auto py-6 sm:py-10">
        <MoistureReportView
          job={{
            job_number: job.job_number ?? null,
            customer_name: job.customer_name ?? null,
            address,
          }}
          company={payload.company}
          floors={floorsList}
          readingsByPinId={readingsByPinId}
          orphanPins={orphanPins}
          selectedDate={selectedDate}
          onSelectedDateChange={setSelectedDate}
          selectedFloorId={selectedFloorId}
          onSelectedFloorChange={setSelectedFloorId}
          // Review round-2 H2 completion: sharing payload now hoists
          // `timezone` to the top level (see backend
          // SharedJobResponse.timezone). Preserved fallback to the DB
          // default so a frontend deploy ahead of a backend deploy
          // keeps rendering instead of crashing on `undefined`.
          jobTimezone={payload.timezone ?? "America/New_York"}
        />
      </div>
    </div>
  );
}
