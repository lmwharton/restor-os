import { apiGetServer } from "@/lib/api-server";
import type { JobDetail, Event, PaginatedResponse } from "@/lib/types";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  // Prefetch jobs + events in parallel on the server.
  // This eliminates the client-side waterfall — hooks get initialData instantly.
  const [jobsRaw, eventsRaw] = await Promise.all([
    apiGetServer<JobDetail[] | PaginatedResponse<JobDetail>>("/v1/jobs?limit=100"),
    apiGetServer<Event[] | PaginatedResponse<Event>>("/v1/events?limit=20"),
  ]);

  const jobs = Array.isArray(jobsRaw) ? jobsRaw : (jobsRaw?.items ?? []);
  const events = Array.isArray(eventsRaw) ? eventsRaw : (eventsRaw?.items ?? []);

  return <DashboardClient initialJobs={jobs} initialEvents={events} />;
}
