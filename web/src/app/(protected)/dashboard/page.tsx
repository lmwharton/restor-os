import { redirect } from "next/navigation";
import { apiGetServer } from "@/lib/api-server";
import { ApiError } from "@/lib/api";
import type { JobDetail, Event, PaginatedResponse } from "@/lib/types";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  // Prefetch jobs + events in parallel on the server.
  // This eliminates the client-side waterfall — hooks get initialData instantly.
  // If the user has no company (401), redirect to onboarding instead of crashing.
  let jobs: JobDetail[] = [];
  let events: Event[] = [];

  try {
    const [jobsRaw, eventsRaw] = await Promise.all([
      apiGetServer<JobDetail[] | PaginatedResponse<JobDetail>>("/v1/jobs?limit=100"),
      apiGetServer<Event[] | PaginatedResponse<Event>>("/v1/events?limit=20"),
    ]);

    jobs = Array.isArray(jobsRaw) ? jobsRaw : (jobsRaw?.items ?? []);
    events = Array.isArray(eventsRaw) ? eventsRaw : (eventsRaw?.items ?? []);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      redirect("/onboarding");
    }
    // For other errors (500, network), render with empty data rather than crash
  }

  return <DashboardClient initialJobs={jobs} initialEvents={events} />;
}
