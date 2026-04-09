"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  useJob,
  useRooms,
  usePhotos,
  useAllReadings,
  useReconPhases,
} from "@/lib/hooks/use-jobs";
import { apiGet } from "@/lib/api";

interface ReportCompany {
  name: string;
  phone: string | null;
  email: string | null;
}

interface ReportUserProfile {
  company: ReportCompany;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtDate(d: string | null): string {
  if (!d) return "--";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function categoryLabel(c: string | null): string {
  if (!c) return "--";
  const map: Record<string, string> = {
    "1": "Cat 1 (Clean)",
    "2": "Cat 2 (Gray)",
    "3": "Cat 3 (Black)",
  };
  return map[c] ?? `Cat ${c}`;
}

function classLabel(c: string | null): string {
  if (!c) return "--";
  return `Class ${c}`;
}

function lossTypeLabel(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    new: "New",
    contracted: "Contracted",
    mitigation: "Mitigation",
    drying: "Drying",
    complete: "Complete",
    submitted: "Submitted",
    collected: "Collected",
    scoping: "Scoping",
    in_progress: "In Progress",
  };
  return map[s] ?? s;
}

/* ------------------------------------------------------------------ */
/*  Report Page                                                        */
/* ------------------------------------------------------------------ */

export default function ReportPage() {
  const rawParams = useParams();
  const params = rawParams as { id: string };
  const router = useRouter();
  const jobId = params.id;

  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: rooms } = useRooms(jobId);
  const { data: photos } = usePhotos(jobId);
  const { data: readings } = useAllReadings(jobId);
  const { data: reconPhases } = useReconPhases(jobId);
  const { data: profile } = useQuery<ReportUserProfile>({
    queryKey: ["me"],
    queryFn: () => apiGet<ReportUserProfile>("/v1/me"),
    staleTime: 5 * 60 * 1000,
  });
  const company = profile?.company;

  if (jobLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-on-surface-variant border-t-primary rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-on-surface-variant">Loading report...</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <p className="text-on-surface-variant">Job not found.</p>
      </div>
    );
  }

  const generatedDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const roomList = rooms ?? [];
  const photoList = photos ?? [];
  const readingList = readings ?? [];

  /* Build a room name lookup */
  const roomNameMap = new Map<string, string>();
  for (const r of roomList) {
    roomNameMap.set(r.id, r.room_name);
  }

  /* Sort readings by date, then room */
  const sortedReadings = [...readingList].sort((a, b) => {
    const dateCompare = new Date(a.reading_date).getTime() - new Date(b.reading_date).getTime();
    if (dateCompare !== 0) return dateCompare;
    return (roomNameMap.get(a.room_id) ?? "").localeCompare(roomNameMap.get(b.room_id) ?? "");
  });

  return (
    <div className="report-root bg-white min-h-screen">
      {/* ── Floating toolbar (hidden in print) ── */}
      <div className="no-print sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-surface-dim px-6 py-3 flex items-center gap-4">
        <button
          type="button"
          onClick={() => router.push(`/jobs/${jobId}`)}
          className="text-sm text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M19 12H5m6-6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Job
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => window.print()}
          className="px-5 py-2 bg-primary text-on-primary text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors cursor-pointer"
        >
          Print / Save PDF
        </button>
      </div>

      {/* ── Report Content ── */}
      <div className="max-w-[8.5in] mx-auto px-[0.75in] py-10 print:px-0 print:py-0 print:max-w-none">

        {/* ── HEADER ── */}
        <header className="print-section mb-8 pb-6 border-b-2 border-neutral-900">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[28px] font-extrabold tracking-tight text-neutral-900 leading-tight">
                {job.customer_name || job.address_line1}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide ${
                  job.job_type === "reconstruction"
                    ? "bg-[#fff3ed] text-[#e85d26]"
                    : "bg-[#eff6ff] text-[#3b82f6]"
                }`}>
                  {job.job_type === "reconstruction" ? "Reconstruction" : "Mitigation"}
                </span>
                <p className="text-[13px] text-neutral-500 font-medium tracking-wide uppercase">
                  {job.job_type === "reconstruction" ? "Report" : "Scope Report"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[15px] font-bold text-neutral-900">{company?.name ?? "Your Company"}</p>
              {company?.phone && <p className="text-[12px] text-neutral-500">{company.phone}</p>}
              {company?.email && <p className="text-[12px] text-neutral-500">{company.email}</p>}
            </div>
          </div>
          <p className="text-[11px] text-neutral-400 mt-4">
            Report generated {generatedDate}
          </p>
        </header>

        {/* ── JOB INFORMATION ── */}
        <section className="print-section mb-8">
          <h2 className="report-section-title">Job Information</h2>

          <p className="text-[18px] font-bold text-neutral-900 mb-3">
            {job.address_line1}{job.city ? `, ${job.city}` : ""}{job.state ? `, ${job.state}` : ""} {job.zip ?? ""}
          </p>

          <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-[13px]">
            <InfoRow label="Job #" value={job.job_number} />
            <InfoRow label="Status" value={statusLabel(job.status)} />
            <InfoRow label="Loss Type" value={lossTypeLabel(job.loss_type)} />
            <InfoRow label="Loss Date" value={fmtDate(job.loss_date)} />
            {job.job_type === "mitigation" && (
              <>
                <InfoRow label="Category" value={categoryLabel(job.loss_category)} />
                <InfoRow label="Class" value={classLabel(job.loss_class)} />
              </>
            )}
            {job.loss_cause && <InfoRow label="Cause" value={job.loss_cause} />}
          </div>

          {/* Customer */}
          {(job.customer_name || job.customer_phone || job.customer_email) && (
            <div className="mt-4 pt-3 border-t border-neutral-200">
              <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">Customer</p>
              <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-[13px]">
                {job.customer_name && <InfoRow label="Name" value={job.customer_name} />}
                {job.customer_phone && <InfoRow label="Phone" value={job.customer_phone} />}
                {job.customer_email && <InfoRow label="Email" value={job.customer_email} />}
              </div>
            </div>
          )}

          {/* Insurance */}
          {(job.carrier || job.claim_number || job.adjuster_name) && (
            <div className="mt-4 pt-3 border-t border-neutral-200">
              <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2">Insurance</p>
              <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-[13px]">
                {job.carrier && <InfoRow label="Carrier" value={job.carrier} />}
                {job.claim_number && <InfoRow label="Claim #" value={job.claim_number} />}
                {job.adjuster_name && <InfoRow label="Adjuster" value={job.adjuster_name} />}
                {job.adjuster_phone && <InfoRow label="Adjuster Phone" value={job.adjuster_phone} />}
                {job.adjuster_email && <InfoRow label="Adjuster Email" value={job.adjuster_email} />}
              </div>
            </div>
          )}
          {/* Linked mitigation job reference */}
          {job.job_type === "reconstruction" && job.linked_job_summary && (
            <div className="mt-4 pt-3 border-t border-neutral-200">
              <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">Linked Mitigation Job</p>
              <p className="text-[13px] text-neutral-800 font-medium">{job.linked_job_summary.job_number}</p>
            </div>
          )}
        </section>

        {/* ── RECONSTRUCTION PHASES ── */}
        {job.job_type === "reconstruction" && reconPhases && reconPhases.length > 0 && (
          <section className="print-section mb-8">
            <h2 className="report-section-title">Reconstruction Phases</h2>
            <table className="report-table w-full">
              <thead>
                <tr>
                  <th className="text-left">Phase</th>
                  <th className="text-center">Status</th>
                  <th className="text-left">Started</th>
                  <th className="text-left">Completed</th>
                  <th className="text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {[...reconPhases].sort((a, b) => a.sort_order - b.sort_order).map((phase) => (
                  <tr key={phase.id}>
                    <td className="font-medium">{phase.phase_name}</td>
                    <td className="text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                        phase.status === "complete" ? "bg-emerald-50 text-emerald-700" :
                        phase.status === "in_progress" ? "bg-blue-50 text-blue-700" :
                        phase.status === "on_hold" ? "bg-amber-50 text-amber-700" :
                        "bg-neutral-100 text-neutral-500"
                      }`}>
                        {phase.status === "complete" ? "Complete" :
                         phase.status === "in_progress" ? "In Progress" :
                         phase.status === "on_hold" ? "On Hold" : "Pending"}
                      </span>
                    </td>
                    <td>{phase.started_at ? fmtDate(phase.started_at) : "--"}</td>
                    <td>{phase.completed_at ? fmtDate(phase.completed_at) : "--"}</td>
                    <td className="text-[11px] text-neutral-600">{phase.notes ?? "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-neutral-400 mt-2">
              {reconPhases.filter((p) => p.status === "complete").length} of {reconPhases.length} phases complete
            </p>
          </section>
        )}

        {/* ── PROPERTY LAYOUT / ROOMS ── */}
        {roomList.length > 0 && (
          <section className="print-section mb-8">
            <h2 className="report-section-title">Property Layout</h2>
            <table className="report-table w-full">
              <thead>
                <tr>
                  <th className="text-left">Room</th>
                  <th className="text-left">Dimensions</th>
                  <th className="text-right">SF</th>
                  {job.job_type === "mitigation" && (
                    <>
                      <th className="text-center">Category</th>
                      <th className="text-center">Class</th>
                      <th className="text-right">Air Movers</th>
                      <th className="text-right">Dehus</th>
                    </>
                  )}
                  {job.job_type === "reconstruction" && (
                    <th className="text-left">Notes</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {roomList.map((room) => (
                  <tr key={room.id}>
                    <td className="font-medium">{room.room_name}</td>
                    <td>
                      {room.length_ft && room.width_ft
                        ? `${room.length_ft}' x ${room.width_ft}'${room.height_ft ? ` x ${room.height_ft}'` : ""}`
                        : "--"}
                    </td>
                    <td className="text-right">{room.square_footage ?? "--"}</td>
                    {job.job_type === "mitigation" && (
                      <>
                        <td className="text-center">{room.water_category ?? "--"}</td>
                        <td className="text-center">{room.water_class ?? "--"}</td>
                        <td className="text-right">{room.equipment_air_movers}</td>
                        <td className="text-right">{room.equipment_dehus}</td>
                      </>
                    )}
                    {job.job_type === "reconstruction" && (
                      <td className="text-[11px] text-neutral-600">{room.notes ?? "--"}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-neutral-400 mt-2">
              {roomList.length} room{roomList.length !== 1 ? "s" : ""} documented
            </p>
          </section>
        )}

        {/* ── PHOTOS ── */}
        {photoList.length > 0 && (
          <section className="mb-8">
            <h2 className="report-section-title">Photo Documentation</h2>
            <div className="print-photos grid grid-cols-4 gap-3">
              {photoList.map((photo) => (
                <div key={photo.id} className="print-section">
                  <div className="aspect-[4/3] bg-neutral-100 rounded overflow-hidden print:rounded-none">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.storage_url}
                      alt={photo.caption ?? photo.filename ?? "Job photo"}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <p className="text-[10px] text-neutral-600 mt-1 leading-tight">
                    {photo.caption ?? photo.filename ?? ""}
                    {photo.room_name && (
                      <span className="text-neutral-400"> -- {photo.room_name}</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-neutral-400 mt-3">
              {photoList.length} photo{photoList.length !== 1 ? "s" : ""} attached
            </p>
          </section>
        )}

        {/* ── MOISTURE READING LOG (mitigation only) ── */}
        {job.job_type === "mitigation" && sortedReadings.length > 0 && (
          <section className="print-section mb-8">
            <h2 className="report-section-title">Moisture Reading Log</h2>
            <table className="report-table w-full">
              <thead>
                <tr>
                  <th className="text-left">Date</th>
                  <th className="text-center">Day #</th>
                  <th className="text-left">Room</th>
                  <th className="text-right">Temp (F)</th>
                  <th className="text-right">RH %</th>
                  <th className="text-right">GPP</th>
                  <th className="text-left">Points</th>
                </tr>
              </thead>
              <tbody>
                {sortedReadings.map((reading) => (
                  <tr key={reading.id}>
                    <td>{fmtDate(reading.reading_date)}</td>
                    <td className="text-center">{reading.day_number ?? "--"}</td>
                    <td>{roomNameMap.get(reading.room_id) ?? "--"}</td>
                    <td className="text-right">{reading.atmospheric_temp_f ?? "--"}</td>
                    <td className="text-right">{reading.atmospheric_rh_pct ?? "--"}</td>
                    <td className="text-right">{reading.atmospheric_gpp ?? "--"}</td>
                    <td className="text-[11px]">
                      {reading.points.length > 0
                        ? reading.points.map((p) => `${p.location_name}: ${p.reading_value}`).join(", ")
                        : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ── TECH NOTES ── */}
        {job.tech_notes && (
          <section className="print-section mb-8">
            <h2 className="report-section-title">Tech Notes</h2>
            <div className="text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap">
              {job.tech_notes}
            </div>
          </section>
        )}

        {/* ── NOTES ── */}
        {job.notes && (
          <section className="print-section mb-8">
            <h2 className="report-section-title">Notes</h2>
            <div className="text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap">
              {job.notes}
            </div>
          </section>
        )}

        {/* ── FOOTER ── */}
        <footer className="mt-12 pt-4 border-t border-neutral-200 text-center">
          <p className="text-[11px] text-neutral-400">
            Generated by Crewmatic &middot; {generatedDate}
          </p>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-neutral-400 min-w-[100px]">{label}</span>
      <span className="text-neutral-800 font-medium">{value}</span>
    </div>
  );
}
