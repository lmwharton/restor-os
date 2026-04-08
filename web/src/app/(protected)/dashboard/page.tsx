import { apiGetServer } from "@/lib/api-server";
import type { JobDetail, Event, PaginatedResponse } from "@/lib/types";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  // Prefetch jobs + events in parallel on the server.
  // Falls back to empty arrays if API is unavailable (mock mode).
  let jobs: JobDetail[] = [];
  let events: Event[] = [];

  try {
    const [jobsRaw, eventsRaw] = await Promise.all([
      apiGetServer<JobDetail[] | PaginatedResponse<JobDetail>>("/v1/jobs?limit=100"),
      apiGetServer<Event[] | PaginatedResponse<Event>>("/v1/events?limit=20"),
    ]);
    jobs = Array.isArray(jobsRaw) ? jobsRaw : (jobsRaw?.items ?? []);
    events = Array.isArray(eventsRaw) ? eventsRaw : (eventsRaw?.items ?? []);
  } catch {
    // API unavailable — client-side hooks will use mock data fallback
  }

  return <DashboardClient initialJobs={jobs} initialEvents={events} />;
}
