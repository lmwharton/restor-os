import type { Metadata } from "next";
import type {
  Job,
  Room,
  Photo,
  MoistureReading,
} from "@/lib/types";

// ─── Types for the shared endpoint response ────────────────────────────

interface SharedCompany {
  name: string;
  logo_url?: string | null;
}

interface SharedJobResponse {
  job: Job;
  rooms: Room[];
  photos: Photo[];
  moisture_readings: MoistureReading[];
  company: SharedCompany;
}

// ─── Metadata ──────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Shared Job Report - Crewmatic",
  description: "View shared job details from Crewmatic",
};

// ─── Data fetching ─────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchSharedJob(token: string): Promise<SharedJobResponse | null> {
  try {
    const res = await fetch(`${API_URL}/v1/shared/${token}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ─── Helper functions ──────────────────────────────────────────────────

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    new: "New",
    contracted: "Contracted",
    mitigation: "Mitigation",
    drying: "Drying",
    completed: "Complete",
    submitted: "Submitted",
    collected: "Collected",
  };
  return map[status] ?? status;
}

function categoryLabel(cat: string | null): string {
  if (!cat) return "--";
  const map: Record<string, string> = {
    "1": "Cat 1 - Clean",
    "2": "Cat 2 - Gray",
    "3": "Cat 3 - Black",
  };
  return map[cat] ?? `Cat ${cat}`;
}

function classLabel(cls: string | null): string {
  if (!cls) return "--";
  return `Class ${cls}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "--";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Page Component ────────────────────────────────────────────────────

export default async function SharedJobPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await fetchSharedJob(token);

  if (!data) {
    return (
      <div className="min-h-dvh bg-surface flex flex-col items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-4">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-error-container/20">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                stroke="var(--error)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-on-surface">
            Link Expired or Invalid
          </h1>
          <p className="text-sm text-on-surface-variant">
            This shared link has expired or is no longer valid. Please request a new link from the contractor.
          </p>
        </div>
      </div>
    );
  }

  const { job, rooms, photos, moisture_readings, company } = data;

  return (
    <div className="min-h-dvh bg-surface">
      {/* ── Company Header ───────────────────────────────────── */}
      <header className="border-b border-outline-variant/30 bg-surface-container-lowest">
        <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 flex items-center gap-3">
          {company.logo_url ? (
            <img
              src={company.logo_url}
              alt={company.name}
              className="h-10 w-10 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-accent text-on-primary font-bold text-lg">
              {company.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-lg font-semibold text-on-surface">
              {company.name}
            </h1>
            <p className="text-xs text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
              Shared Job Report
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 space-y-8">
        {/* ── Job Overview ──────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-2xl font-semibold text-on-surface">
                {job.address_line1}
              </h2>
              <p className="text-sm text-on-surface-variant">
                {job.city}, {job.state} {job.zip}
              </p>
            </div>
            <span className="inline-flex self-start rounded-full bg-brand-accent/10 px-3 py-1 text-sm font-medium text-brand-accent">
              {statusLabel(job.status)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoCard label="Job #" value={job.job_number} />
            <InfoCard label="Loss Type" value={job.loss_type.charAt(0).toUpperCase() + job.loss_type.slice(1)} />
            <InfoCard label="Loss Date" value={formatDate(job.loss_date)} />
            <InfoCard label="Category / Class" value={`${categoryLabel(job.loss_category)} / ${classLabel(job.loss_class)}`} />
          </div>

          {job.customer_name && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <InfoCard label="Customer" value={job.customer_name} />
              {job.claim_number && <InfoCard label="Claim #" value={job.claim_number} />}
              {job.carrier && <InfoCard label="Carrier" value={job.carrier} />}
            </div>
          )}
        </section>

        {/* ── Rooms Summary ─────────────────────────────────── */}
        {rooms.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-base font-semibold text-on-surface">
              Rooms ({rooms.length})
            </h3>
            <div className="overflow-x-auto rounded-xl border border-outline-variant/30">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/20 bg-surface-container-low">
                    <th className="px-4 py-3 text-left font-semibold text-on-surface-variant text-[11px] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">Room</th>
                    <th className="px-4 py-3 text-left font-semibold text-on-surface-variant text-[11px] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">Dimensions</th>
                    <th className="px-4 py-3 text-left font-semibold text-on-surface-variant text-[11px] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">Category</th>
                    <th className="px-4 py-3 text-left font-semibold text-on-surface-variant text-[11px] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">Class</th>
                    <th className="px-4 py-3 text-right font-semibold text-on-surface-variant text-[11px] uppercase tracking-wider font-[family-name:var(--font-geist-mono)]">Equipment</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => (
                    <tr key={room.id} className="border-b border-outline-variant/10 last:border-0">
                      <td className="px-4 py-3 font-medium text-on-surface">{room.room_name}</td>
                      <td className="px-4 py-3 text-on-surface-variant font-[family-name:var(--font-geist-mono)] text-xs">
                        {room.length_ft && room.width_ft
                          ? `${room.length_ft}' x ${room.width_ft}'`
                          : "--"}
                        {room.square_footage ? ` (${room.square_footage} sqft)` : ""}
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">{categoryLabel(room.water_category)}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{classLabel(room.water_class)}</td>
                      <td className="px-4 py-3 text-right text-on-surface-variant font-[family-name:var(--font-geist-mono)] text-xs">
                        {room.equipment_air_movers > 0 ? `${room.equipment_air_movers} AM` : ""}
                        {room.equipment_air_movers > 0 && room.equipment_dehus > 0 ? " / " : ""}
                        {room.equipment_dehus > 0 ? `${room.equipment_dehus} DH` : ""}
                        {room.equipment_air_movers === 0 && room.equipment_dehus === 0 ? "--" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Photo Grid ────────────────────────────────────── */}
        {photos.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-base font-semibold text-on-surface">
              Photos ({photos.length})
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative aspect-square overflow-hidden rounded-xl bg-surface-container-high"
                >
                  <img
                    src={photo.storage_url}
                    alt={photo.caption || photo.room_name || "Job photo"}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                  />
                  {(photo.room_name || photo.caption) && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-inverse-surface/70 to-transparent px-3 py-2">
                      {photo.room_name && (
                        <p className="text-[11px] font-semibold text-inverse-on-surface">
                          {photo.room_name}
                        </p>
                      )}
                      {photo.caption && (
                        <p className="text-[10px] text-inverse-on-surface/80 truncate">
                          {photo.caption}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Moisture Readings ─────────────────────────────── */}
        {moisture_readings.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-base font-semibold text-on-surface">
              Moisture Readings ({moisture_readings.length})
            </h3>
            <div className="space-y-3">
              {moisture_readings.map((reading) => (
                <div
                  key={reading.id}
                  className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-on-surface">
                        {reading.day_number !== null ? `Day ${reading.day_number}` : "Reading"} &mdash; {formatDate(reading.reading_date)}
                      </p>
                    </div>
                    <div className="flex gap-4 text-xs font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                      {reading.atmospheric_temp_f !== null && (
                        <span>{reading.atmospheric_temp_f}F</span>
                      )}
                      {reading.atmospheric_rh_pct !== null && (
                        <span>{reading.atmospheric_rh_pct}% RH</span>
                      )}
                      {reading.atmospheric_gpp !== null && (
                        <span>{reading.atmospheric_gpp} GPP</span>
                      )}
                    </div>
                  </div>

                  {reading.points.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {reading.points.map((pt) => (
                        <div
                          key={pt.id}
                          className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2"
                        >
                          <span className="text-xs text-on-surface-variant truncate mr-2">
                            {pt.location_name}
                          </span>
                          <span className="text-sm font-semibold font-[family-name:var(--font-geist-mono)] text-on-surface tabular-nums">
                            {pt.reading_value}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {reading.dehus.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {reading.dehus.map((d) => (
                        <span
                          key={d.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-tertiary/10 px-3 py-1 text-xs text-tertiary font-[family-name:var(--font-geist-mono)]"
                        >
                          {d.dehu_model ?? "Dehu"}
                          {d.rh_out_pct !== null && ` ${d.rh_out_pct}%`}
                          {d.temp_out_f !== null && ` ${d.temp_out_f}F`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-outline-variant/20 bg-surface-container-lowest mt-8">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-on-surface-variant">
            Powered by{" "}
            <span className="font-semibold text-brand-accent">Crewmatic</span>
            {" "}&mdash; The Operating System for Restoration Contractors
          </p>
          <p className="text-[10px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant/60">
            Generated {formatDate(new Date().toISOString())}
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─── Reusable info card ────────────────────────────────────────────────

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/20 px-4 py-3">
      <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant font-semibold">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-on-surface truncate">
        {value}
      </p>
    </div>
  );
}
