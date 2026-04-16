"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowBack, Plus } from "@/components/icons";
import { useJob, useRooms, useReadings, useAllReadings, usePhotos } from "@/lib/hooks/use-jobs";
import { RoomPhotoSection } from "@/components/room-photo-section";
import { apiPost, apiPatch } from "@/lib/api";
import type { MoisturePoint, MoistureReading } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  GPP Calculation (psychrometric formula)                            */
/* ------------------------------------------------------------------ */

function calculateGPP(tempF: number, rh: number): number {
  const tc = (tempF - 32) * (5 / 9);
  const es = 6.112 * Math.exp((17.67 * tc) / (tc + 243.5));
  const ea = es * (rh / 100);
  const w = (621.97 * ea) / (1013.25 - ea);
  return Math.round(w * 7 * 10) / 10;
}

/* ------------------------------------------------------------------ */
/*  Types for local state                                              */
/* ------------------------------------------------------------------ */

interface PointEntry {
  id: string;
  location_name: string;
  reading_value: string;
}

interface DehuEntry {
  id: string;
  dehu_model: string;
  rh_out_pct: string;
  temp_out_f: string;
}

interface RoomFormState {
  tempF: string;
  rhPct: string;
  points: PointEntry[];
  dehus: DehuEntry[];
}

function defaultPoints(): PointEntry[] {
  return [
    { id: crypto.randomUUID(), location_name: "South wall base", reading_value: "" },
    { id: crypto.randomUUID(), location_name: "North wall base", reading_value: "" },
    { id: crypto.randomUUID(), location_name: "Subfloor center", reading_value: "" },
  ];
}

function defaultDehus(): DehuEntry[] {
  return [
    {
      id: crypto.randomUUID(),
      dehu_model: "Dri-Eaz LGR 3500i",
      rh_out_pct: "",
      temp_out_f: "",
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Helper: format date as "Apr 8"                                     */
/* ------------------------------------------------------------------ */

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ */
/*  History: group readings by day_number                              */
/* ------------------------------------------------------------------ */

interface DayGroup {
  dayNumber: number;
  date: string; // reading_date from first reading in group
  atmospheric: { temp: number | null; rh: number | null; gpp: number | null };
  rooms: {
    roomId: string;
    roomName: string;
    atmospheric: { temp: number | null; rh: number | null; gpp: number | null };
    points: MoisturePoint[];
    dehus: MoistureReading["dehus"];
  }[];
}

function groupReadingsByDay(
  readings: MoistureReading[],
  roomMap: Record<string, string>
): DayGroup[] {
  const map = new Map<number, DayGroup>();

  for (const r of readings) {
    const day = r.day_number ?? 1;
    if (!map.has(day)) {
      map.set(day, {
        dayNumber: day,
        date: r.reading_date,
        atmospheric: {
          temp: r.atmospheric_temp_f,
          rh: r.atmospheric_rh_pct,
          gpp: r.atmospheric_gpp,
        },
        rooms: [],
      });
    }
    const group = map.get(day)!;
    group.rooms.push({
      roomId: r.room_id,
      roomName: roomMap[r.room_id] ?? "Unknown Room",
      atmospheric: {
        temp: r.atmospheric_temp_f,
        rh: r.atmospheric_rh_pct,
        gpp: r.atmospheric_gpp,
      },
      points: r.points ?? [],
      dehus: r.dehus ?? [],
    });
  }

  return Array.from(map.values()).sort((a, b) => a.dayNumber - b.dayNumber);
}

/* ------------------------------------------------------------------ */
/*  ReadingHistory — collapsible past-day cards                        */
/* ------------------------------------------------------------------ */

function ReadingHistory({
  dayGroups,
  dryStandardMap,
}: {
  dayGroups: DayGroup[];
  dryStandardMap: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  if (dayGroups.length === 0) return null;

  return (
    <section className="mb-6 space-y-3">
      <h2 className="text-[10px] lg:text-[11px] font-semibold tracking-wider uppercase text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
        Past Readings
      </h2>
      {dayGroups.map((group) => {
        const isOpen = expanded[group.dayNumber] ?? false;
        return (
          <div
            key={group.dayNumber}
            className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] overflow-hidden"
          >
            {/* Collapse header */}
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => ({
                  ...prev,
                  [group.dayNumber]: !prev[group.dayNumber],
                }))
              }
              className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-container-low/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-on-surface">
                  Day {group.dayNumber}
                </span>
                <span className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                  {shortDate(group.date)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {/* Atmospheric summary */}
                <span className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                  {group.atmospheric.temp != null ? `${group.atmospheric.temp}°F` : ""}
                  {group.atmospheric.rh != null ? ` / ${group.atmospheric.rh}%` : ""}
                  {group.atmospheric.gpp != null ? ` / ${group.atmospheric.gpp} GPP` : ""}
                </span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  className={`text-on-surface-variant transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                >
                  <path
                    d="M4 6L8 10L12 6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </button>

            {/* Expanded content */}
            {isOpen && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-outline-variant/10">
                {/* Per-room data — table layout */}
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-outline-variant/15">
                        <th className="text-left text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/60 pb-1.5 pr-3">Room</th>
                        <th className="text-right text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/60 pb-1.5 px-2">Temp</th>
                        <th className="text-right text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/60 pb-1.5 px-2">RH%</th>
                        <th className="text-right text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/60 pb-1.5 px-2">GPP</th>
                        {group.rooms.some((rm) => rm.points.length > 0) && (
                          <th className="text-left text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/60 pb-1.5 pl-4">Points</th>
                        )}
                        {group.rooms.some((rm) => rm.dehus.length > 0) && (
                          <th className="text-left text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant/60 pb-1.5 pl-4">Dehu</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rooms.map((room, ri) => {
                        const dryStd = dryStandardMap[room.roomId] ?? 16;
                        return (
                          <tr key={ri} className="border-b border-outline-variant/10 last:border-0">
                            <td className="py-2 pr-3 font-semibold text-on-surface align-top">{room.roomName}</td>
                            <td className="py-2 px-2 text-right font-[family-name:var(--font-geist-mono)] text-on-surface-variant align-top">
                              {room.atmospheric?.temp != null ? `${room.atmospheric.temp}°F` : "--"}
                            </td>
                            <td className="py-2 px-2 text-right font-[family-name:var(--font-geist-mono)] text-on-surface-variant align-top">
                              {room.atmospheric?.rh != null ? `${room.atmospheric.rh}%` : "--"}
                            </td>
                            <td className="py-2 px-2 text-right font-[family-name:var(--font-geist-mono)] text-on-surface-variant align-top">
                              {room.atmospheric?.gpp != null ? room.atmospheric.gpp : "--"}
                            </td>
                            {group.rooms.some((rm) => rm.points.length > 0) && (
                              <td className="py-2 pl-4 align-top">
                                {room.points.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {room.points.map((pt) => {
                                      const isWet = pt.reading_value > dryStd;
                                      return (
                                        <div key={pt.id} className="flex items-center gap-2">
                                          <span className="text-on-surface-variant truncate max-w-[120px]">{pt.location_name}</span>
                                          <span className={`font-semibold font-[family-name:var(--font-geist-mono)] ${isWet ? "text-orange-500" : "text-on-surface"}`}>
                                            {pt.reading_value}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-on-surface-variant/40">--</span>
                                )}
                              </td>
                            )}
                            {group.rooms.some((rm) => rm.dehus.length > 0) && (
                              <td className="py-2 pl-4 align-top">
                                {room.dehus.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {room.dehus.map((d, di) => (
                                      <div key={di} className="text-on-surface-variant">
                                        {d.dehu_model && <span className="font-medium text-on-surface">{d.dehu_model}</span>}
                                        {(d.rh_out_pct != null || d.temp_out_f != null) && (
                                          <span className="font-[family-name:var(--font-geist-mono)] ml-1">
                                            {d.rh_out_pct != null ? `${d.rh_out_pct}%` : "--"}
                                            {" / "}
                                            {d.temp_out_f != null ? `${d.temp_out_f}°F` : "--"}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-on-surface-variant/40">--</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Wet indicator legend                                               */
/* ------------------------------------------------------------------ */

function WetLegend() {
  return (
    <div className="flex items-center gap-1.5 mt-1 mb-2">
      <span className="w-2 h-2 rounded-full bg-orange-500 inline-block flex-shrink-0" />
      <span className="text-[10px] text-on-surface-variant">Above dry standard</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MoistureReadingsPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobId = params.id as string;

  // Job + room data
  const { data: job } = useJob(jobId);
  const { data: rooms = [] } = useRooms(jobId);
  const { data: allPhotos = [] } = usePhotos(jobId);
  const [roomIndex, setRoomIndex] = useState(0);
  const currentRoom = rooms[roomIndex];

  // Fetch real readings for current room (for pre-populating point locations)
  const { data: roomReadings = [] } = useReadings(jobId, currentRoom?.id ?? "");

  // Fetch ALL readings for history display
  const { data: allReadings = [] } = useAllReadings(jobId);

  // Build room ID → name map
  const roomMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of rooms) m[r.id] = r.room_name;
    return m;
  }, [rooms]);

  // Build room ID → dry_standard map
  const dryStandardMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rooms) m[r.id] = r.dry_standard ?? 16;
    return m;
  }, [rooms]);

  // Day number — calculated from loss_date, or from existing reading count
  const dayNumber = useMemo(() => {
    if (allReadings.length === 0) {
      // No readings yet — use loss_date if available, otherwise Day 1
      if (job?.loss_date) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const lossDate = new Date(job.loss_date + "T00:00:00");
        const diffMs = today.getTime() - lossDate.getTime();
        return Math.max(1, Math.floor(diffMs / 86_400_000) + 1);
      }
      return 1;
    }

    // Count distinct calendar days from readings (UTC-consistent to avoid timezone drift)
    const readingDays = new Set<string>();
    for (const r of allReadings) {
      const d = r.reading_date || r.created_at;
      if (d) {
        const dt = new Date(d);
        readingDays.add(`${dt.getUTCFullYear()}-${dt.getUTCMonth()}-${dt.getUTCDate()}`);
      }
    }

    // Check if any reading was saved today (UTC)
    const today = new Date();
    const todayKey = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;
    const hasReadingsToday = readingDays.has(todayKey);

    // Day number = number of distinct days with readings + 1 if today is new
    if (hasReadingsToday) {
      return readingDays.size;
    }
    return readingDays.size + 1;
  }, [job?.loss_date, allReadings]);

  // Today's date string (local timezone, not UTC)
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  // Group past readings by day — show all saved days including current
  const dayGroups = useMemo(() => {
    const pastReadings = allReadings.filter((r) => (r.day_number ?? 1) <= dayNumber);
    return groupReadingsByDay(pastReadings, roomMap);
  }, [allReadings, roomMap, dayNumber]);

  // Rooms that have a reading for the current day_number
  const roomsWithCurrentDayReading = useMemo(() => {
    const set = new Set<string>();
    for (const r of allReadings) {
      if ((r.day_number ?? 1) === dayNumber) set.add(r.room_id);
    }
    return set;
  }, [allReadings, dayNumber]);

  const roomsNeedingEntry = useMemo(
    () => rooms.filter((r) => !roomsWithCurrentDayReading.has(r.id)),
    [rooms, roomsWithCurrentDayReading]
  );

  const allRoomsLoggedToday = rooms.length > 0 && roomsNeedingEntry.length === 0;

  // Build per-room form data from current day's readings (full pre-population),
  // falling back to most-recent reading for atmospheric only
  const perRoomInitialForms = useMemo(() => {
    const m: Record<string, RoomFormState> = {};

    // First pass: build from current day's readings (full data)
    for (const r of allReadings) {
      if ((r.day_number ?? 1) === dayNumber) {
        m[r.room_id] = {
          tempF: r.atmospheric_temp_f != null ? String(r.atmospheric_temp_f) : "",
          rhPct: r.atmospheric_rh_pct != null ? String(r.atmospheric_rh_pct) : "",
          points: r.points && r.points.length > 0
            ? r.points.map((p) => ({
                id: crypto.randomUUID(),
                location_name: p.location_name,
                reading_value: p.reading_value != null ? String(p.reading_value) : "",
              }))
            : defaultPoints(),
          dehus: r.dehus && r.dehus.length > 0
            ? r.dehus.map((d) => ({
                id: crypto.randomUUID(),
                dehu_model: d.dehu_model ?? "",
                rh_out_pct: d.rh_out_pct != null ? String(d.rh_out_pct) : "",
                temp_out_f: d.temp_out_f != null ? String(d.temp_out_f) : "",
              }))
            : defaultDehus(),
        };
      }
    }

    // Second pass: for rooms without current day's reading, only copy point location names
    const sorted = [...allReadings].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    for (const r of sorted) {
      if (m[r.room_id]) continue;
      m[r.room_id] = {
        tempF: "",
        rhPct: "",
        points: r.points && r.points.length > 0
          ? r.points.map((p) => ({
              id: crypto.randomUUID(),
              location_name: p.location_name,
              reading_value: "",
            }))
          : defaultPoints(),
        dehus: defaultDehus(),
      };
    }
    return m;
  }, [allReadings]);

  // Day started state — explicit action to begin logging a new day
  const hasReadingsToday = roomsWithCurrentDayReading.size > 0;
  const [dayStarted, setDayStarted] = useState(false);
  const showEntryForm = hasReadingsToday || dayStarted;

  // Saving state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Per-room form state ──────────────────────────────────────────
  // Track form data for ALL rooms, keyed by room ID.
  const [roomForms, setRoomForms] = useState<Record<string, RoomFormState>>({});

  // Initialize per-room form state from existing readings once data loads
  const [formsInitialized, setFormsInitialized] = useState(false);
  useMemo(() => {
    if (formsInitialized) return;
    const entries = Object.entries(perRoomInitialForms);
    if (entries.length === 0) return;
    setRoomForms((prev) => {
      const next = { ...prev };
      for (const [roomId, formData] of entries) {
        if (!next[roomId]) {
          next[roomId] = formData;
        }
      }
      return next;
    });
    setFormsInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perRoomInitialForms]);

  // Get form state for a specific room, initializing with defaults if needed
  const getRoomForm = useCallback((roomId: string): RoomFormState => {
    return roomForms[roomId] ?? { tempF: "", rhPct: "", points: defaultPoints(), dehus: defaultDehus() };
  }, [roomForms]);

  // Per-room GPP calculator
  const getRoomGPP = useCallback((roomId: string): string => {
    const form = getRoomForm(roomId);
    const t = parseFloat(form.tempF);
    const r = parseFloat(form.rhPct);
    if (isNaN(t) || isNaN(r) || r <= 0 || r > 100) return "--";
    return calculateGPP(t, r).toFixed(1);
  }, [getRoomForm]);

  // Update form state for a specific room
  const setRoomForm = useCallback((roomId: string, updater: (prev: RoomFormState) => RoomFormState) => {
    setRoomForms((prev) => {
      const current = prev[roomId] ?? { tempF: "", rhPct: "", points: defaultPoints(), dehus: defaultDehus() };
      return { ...prev, [roomId]: updater(current) };
    });
  }, []);

  // Convenience: current room's form state
  const currentRoomId = currentRoom?.id ?? "";
  const currentForm = getRoomForm(currentRoomId);
  const points = currentForm.points;
  const dehus = currentForm.dehus;

  // Pre-populate point location names from latest reading when switching rooms
  // (only for rooms that DON'T already have today's reading pre-filled)
  const latestReadingId = roomReadings.length > 0 ? roomReadings[roomReadings.length - 1].id : null;
  const prevLatestRef = useRef<string | null>(null);
  useMemo(() => {
    if (latestReadingId && latestReadingId !== prevLatestRef.current && currentRoomId) {
      prevLatestRef.current = latestReadingId;
      // Skip if this room already has form data initialized (from today's reading)
      if (roomForms[currentRoomId]) return;
      const latest = roomReadings[roomReadings.length - 1];
      if (latest.points.length > 0) {
        const newPoints = latest.points.map((p: MoisturePoint) => ({
          id: crypto.randomUUID(),
          location_name: p.location_name,
          reading_value: "",
        }));
        setRoomForms((prev) => ({
          ...prev,
          [currentRoomId]: {
            tempF: prev[currentRoomId]?.tempF ?? "",
            rhPct: prev[currentRoomId]?.rhPct ?? "",
            points: newPoints,
            dehus: prev[currentRoomId]?.dehus ?? defaultDehus(),
          },
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestReadingId, currentRoomId]);

  const dryStandard = currentRoom?.dry_standard ?? 16;

  // Point handlers (operate on current room)
  const updatePoint = useCallback(
    (roomId: string, pointId: string, field: keyof PointEntry, value: string) => {
      setRoomForm(roomId, (form) => ({
        ...form,
        points: form.points.map((p) => (p.id === pointId ? { ...p, [field]: value } : p)),
      }));
    },
    [setRoomForm]
  );

  const addPoint = useCallback((roomId: string) => {
    setRoomForm(roomId, (form) => ({
      ...form,
      points: [
        ...form.points,
        { id: crypto.randomUUID(), location_name: "", reading_value: "" },
      ],
    }));
  }, [setRoomForm]);

  // Dehu handlers (operate on specific room)
  const updateDehu = useCallback(
    (roomId: string, dehuId: string, field: keyof DehuEntry, value: string) => {
      setRoomForm(roomId, (form) => ({
        ...form,
        dehus: form.dehus.map((d) => (d.id === dehuId ? { ...d, [field]: value } : d)),
      }));
    },
    [setRoomForm]
  );

  const addDehu = useCallback((roomId: string) => {
    setRoomForm(roomId, (form) => ({
      ...form,
      dehus: [
        ...form.dehus,
        { id: crypto.randomUUID(), dehu_model: "", rh_out_pct: "", temp_out_f: "" },
      ],
    }));
  }, [setRoomForm]);

  // Helper to save a single room's reading via API
  const saveRoom = useCallback(async (roomId: string, roomForm: RoomFormState) => {
    // Check if a reading already exists for this room on the current day
    const existingReading = allReadings.find(
      (r) => r.room_id === roomId && (r.day_number ?? 1) === dayNumber
    );

    type ReadingResult = { id: string };
    let readingId: string;

    if (existingReading) {
      // Update existing reading
      await apiPatch(`/v1/jobs/${jobId}/readings/${existingReading.id}`, {
        atmospheric_temp_f: parseFloat(roomForm.tempF) || undefined,
        atmospheric_rh_pct: parseFloat(roomForm.rhPct) || undefined,
      });
      readingId = existingReading.id;
    } else {
      // Create new reading
      const reading = await apiPost<ReadingResult>(
        `/v1/jobs/${jobId}/rooms/${roomId}/readings`,
        {
          reading_date: todayStr,
          atmospheric_temp_f: parseFloat(roomForm.tempF) || undefined,
          atmospheric_rh_pct: parseFloat(roomForm.rhPct) || undefined,
        }
      );
      readingId = reading.id;
    }

    // 2. Create points (only for new entries — skip if values are empty)
    for (let i = 0; i < roomForm.points.length; i++) {
      const pt = roomForm.points[i];
      if (!pt.location_name.trim() && !pt.reading_value.trim()) continue;
      await apiPost(`/v1/jobs/${jobId}/readings/${readingId}/points`, {
        location_name: pt.location_name.trim() || `Point ${i + 1}`,
        reading_value: parseFloat(pt.reading_value) || 0,
        sort_order: i,
      });
    }

    // 3. Create dehus
    for (const dehu of roomForm.dehus) {
      if (!dehu.dehu_model.trim() && !dehu.rh_out_pct.trim() && !dehu.temp_out_f.trim()) continue;
      await apiPost(`/v1/jobs/${jobId}/readings/${readingId}/dehus`, {
        dehu_model: dehu.dehu_model.trim() || undefined,
        rh_out_pct: parseFloat(dehu.rh_out_pct) || undefined,
        temp_out_f: parseFloat(dehu.temp_out_f) || undefined,
      });
    }
  }, [jobId, allReadings, dayNumber, todayStr]);

  // Save current room (mobile flow)
  const saveCurrentRoom = useCallback(async () => {
    if (!currentRoom) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      await saveRoom(currentRoom.id, getRoomForm(currentRoom.id));
      // Invalidate React Query cache for readings
      await queryClient.invalidateQueries({ queryKey: ["readings"] });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save reading");
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [currentRoom, getRoomForm, saveRoom, queryClient]);

  // Save & next room (mobile)
  const handleSaveAndNext = useCallback(async () => {
    try {
      await saveCurrentRoom();
    } catch {
      return; // error already set
    }

    if (roomIndex < rooms.length - 1) {
      setRoomIndex((prev) => prev + 1);
      setSaveError(null);
      // Scroll to top
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      // Last room — navigate back to job
      router.push(`/jobs/${jobId}`);
    }
  }, [roomIndex, rooms.length, router, jobId, saveCurrentRoom]);

  const isLastRoom = roomIndex === rooms.length - 1;

  // Save all rooms handler (desktop) — iterates ALL rooms
  const handleSaveAll = useCallback(async () => {
    if (rooms.length === 0) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      for (const room of rooms) {
        await saveRoom(room.id, getRoomForm(room.id));
      }
      // Invalidate React Query cache for readings
      await queryClient.invalidateQueries({ queryKey: ["readings"] });
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save readings");
    } finally {
      setIsSaving(false);
    }
  }, [rooms, getRoomForm, saveRoom, queryClient, router, jobId]);

  return (
    <div className="min-h-screen bg-surface">
      {/* -- Header -------------------------------------------------- */}
      <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm px-4 pt-4 pb-3">
        <div className="flex items-center justify-between lg:max-w-6xl lg:mx-auto">
          <div className="flex items-center gap-3">
            <Link
              href={`/jobs/${jobId}`}
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-container-low active:bg-surface-container-high transition-colors"
              aria-label="Back to job"
            >
              <ArrowBack size={20} className="text-on-surface-variant" />
            </Link>
            <h1 className="text-lg font-semibold text-on-surface">
              Moisture Readings
            </h1>
          </div>
          {/* spacer for mobile */}
          <div className="lg:hidden" />
          {/* Desktop: Save All button — only when form is active */}
          {showEntryForm && (
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={isSaving}
              className="hidden lg:flex h-10 px-6 bg-brand-accent text-on-primary font-semibold rounded-lg text-[13px] items-center gap-2 transition-all hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] cursor-pointer disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          )}
        </div>

        {/* Room dots (mobile only) — only when form is active */}
        {showEntryForm && (
          <div className="flex items-center justify-center gap-2 mt-3 lg:hidden">
            {rooms.map((room, i) => (
              <button
                key={room.id}
                onClick={() => setRoomIndex(i)}
                className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                  i === roomIndex
                    ? "bg-brand-accent w-6"
                    : "bg-surface-dim"
                }`}
                aria-label={`Go to ${room.room_name}`}
              />
            ))}
          </div>
        )}
      </header>

      {/* -- Main content -------------------------------------------- */}
      <main className="px-4 pb-20 lg:pb-8 mt-2 lg:max-w-6xl lg:mx-auto">

        {/* -- Reading History ---------------------------------------- */}
        <ReadingHistory dayGroups={dayGroups} dryStandardMap={dryStandardMap} />

        {/* -- Empty state when no rooms ------------------------------ */}
        {rooms.length === 0 && (
          <div className="rounded-xl bg-surface-container-lowest p-6 text-center">
            <p className="text-sm text-on-surface-variant">
              Add rooms from the Property Layout section to start logging moisture readings per room.
            </p>
          </div>
        )}

        {/* -- Start Day N prompt (when no readings for today yet) ---- */}
        {rooms.length > 0 && !showEntryForm && (
          <div className="rounded-xl bg-surface-container-lowest shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold text-on-surface">
                  Day {dayNumber}
                </h2>
                <p className="text-[12px] text-on-surface-variant mt-0.5 font-[family-name:var(--font-geist-mono)]">
                  {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {rooms.length} room{rooms.length !== 1 ? "s" : ""} to log
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDayStarted(true)}
                className="h-9 px-5 rounded-lg text-[13px] font-semibold text-on-primary bg-brand-accent hover:shadow-lg active:scale-[0.98] transition-all cursor-pointer"
              >
                Start Day {dayNumber}
              </button>
            </div>
          </div>
        )}

        {/* -- Day heading (when form is active) ---------------------- */}
        {rooms.length > 0 && showEntryForm && (
          <div className="hidden lg:flex items-center mb-3">
            <h2 className="text-[13px] font-semibold text-on-surface">
              Day {dayNumber}
            </h2>
            <span className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)] ml-2">
              {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })} · auto-saves
            </span>
          </div>
        )}

        {/* -- Mobile: single room view ------------------------------ */}
        {currentRoom && showEntryForm && (
        <div className="lg:hidden space-y-4">
          {/* Room title + count */}
          <div className="text-center pb-1.5 border-b border-outline-variant/20">
            <h2 className="text-[15px] font-bold text-on-surface">{currentRoom.room_name}</h2>
            <p className="text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
              {roomIndex + 1} of {rooms.length}
            </p>
          </div>

          {/* Atmospheric (per room) */}
          <section>
            <label className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant mb-1.5 font-[family-name:var(--font-geist-mono)]">
              Atmospheric
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <span className="block text-[9px] text-on-surface-variant mb-0.5 font-[family-name:var(--font-geist-mono)]">
                  Temp &deg;F
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={currentForm.tempF}
                  onChange={(e) => setRoomForm(currentRoomId, (f) => ({ ...f, tempF: e.target.value }))}
                  onFocus={(e) => e.target.select()}
                  placeholder="--"
                  className="w-full h-8 bg-surface-container-low rounded-lg px-2 text-sm font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow placeholder:text-on-surface-variant/30"
                />
              </div>
              <div>
                <span className="block text-[9px] text-on-surface-variant mb-0.5 font-[family-name:var(--font-geist-mono)]">
                  RH %
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={currentForm.rhPct}
                  onChange={(e) => setRoomForm(currentRoomId, (f) => ({ ...f, rhPct: e.target.value }))}
                  onFocus={(e) => e.target.select()}
                  placeholder="--"
                  className="w-full h-8 bg-surface-container-low rounded-lg px-2 text-sm font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow placeholder:text-on-surface-variant/30"
                />
              </div>
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-[9px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                    GPP
                  </span>
                  <span className="text-[7px] font-bold tracking-wider bg-tertiary-container/20 text-tertiary px-1 py-px rounded font-[family-name:var(--font-geist-mono)]">
                    AUTO
                  </span>
                </div>
                <div className="w-full h-8 bg-tertiary-container/10 rounded-lg px-2 flex items-center justify-center">
                  <span className="text-sm font-semibold text-tertiary font-[family-name:var(--font-geist-mono)]">
                    {getRoomGPP(currentRoomId)}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Moisture Points */}
          <section>
            <label className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant mb-0 font-[family-name:var(--font-geist-mono)]">
              Moisture Points
            </label>
            <WetLegend />
            <div className="space-y-1">
              {points.map((point, i) => {
                const val = parseFloat(point.reading_value);
                const isWet = !isNaN(val) && val > dryStandard;

                return (
                  <div
                    key={point.id}
                    className="flex items-center gap-1.5"
                  >
                    <span className="flex-shrink-0 w-5 text-[10px] font-bold text-on-surface-variant font-[family-name:var(--font-geist-mono)] text-center">
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={point.location_name}
                      onChange={(e) =>
                        updatePoint(currentRoomId, point.id, "location_name", e.target.value)
                      }
                      onFocus={(e) => e.target.select()}
                      placeholder="Location..."
                      className="flex-1 h-8 bg-surface-container-low rounded-lg px-2 text-[12px] text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={point.reading_value}
                      onChange={(e) =>
                        updatePoint(currentRoomId, point.id, "reading_value", e.target.value)
                      }
                      onFocus={(e) => e.target.select()}
                      placeholder="--"
                      className={`flex-shrink-0 w-14 h-8 rounded-lg px-1.5 text-sm font-bold text-center font-[family-name:var(--font-geist-mono)] bg-surface-container-low focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow ${isWet ? "text-orange-500" : "text-on-surface"}`}
                    />
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => addPoint(currentRoomId)}
              className="mt-1.5 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-brand-accent font-semibold bg-brand-accent/8 active:bg-brand-accent/15 transition-colors"
            >
              <Plus size={12} />
              Add Point
            </button>
          </section>

          {/* Room Photos */}
          <section>
            <RoomPhotoSection
              jobId={jobId}
              roomId={currentRoomId}
              roomName={currentRoom.room_name}
              photos={allPhotos.filter(p => p.room_id === currentRoomId)}
              variant="card"
              directUpload
            />
          </section>

          {/* Dehu Output */}
          <section>
            <label className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant mb-1.5 font-[family-name:var(--font-geist-mono)]">
              Dehu Output
            </label>
            <div className="space-y-1.5">
              {dehus.map((dehu) => (
                <div
                  key={dehu.id}
                  className="space-y-1.5"
                >
                  <input
                    type="text"
                    value={dehu.dehu_model}
                    onChange={(e) =>
                      updateDehu(currentRoomId, dehu.id, "dehu_model", e.target.value)
                    }
                    onFocus={(e) => e.target.select()}
                    placeholder="Dehu model..."
                    className="w-full h-8 bg-surface-container-low rounded-lg px-2 text-[12px] text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <span className="block text-[9px] text-on-surface-variant mb-0.5 font-[family-name:var(--font-geist-mono)]">
                        RH Out %
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={dehu.rh_out_pct}
                        onChange={(e) =>
                          updateDehu(currentRoomId, dehu.id, "rh_out_pct", e.target.value)
                        }
                        onFocus={(e) => e.target.select()}
                        placeholder="--"
                        className="w-full h-8 bg-surface-container-low rounded-lg px-2 text-sm font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                      />
                    </div>
                    <div>
                      <span className="block text-[9px] text-on-surface-variant mb-0.5 font-[family-name:var(--font-geist-mono)]">
                        Temp Out &deg;F
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={dehu.temp_out_f}
                        onChange={(e) =>
                          updateDehu(currentRoomId, dehu.id, "temp_out_f", e.target.value)
                        }
                        onFocus={(e) => e.target.select()}
                        placeholder="--"
                        className="w-full h-8 bg-surface-container-low rounded-lg px-2 text-sm font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => addDehu(currentRoomId)}
              className="mt-1.5 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-brand-accent font-semibold bg-brand-accent/8 active:bg-brand-accent/15 transition-colors"
            >
              <Plus size={12} />
              Add Dehu
            </button>
          </section>

          {/* Save CTA */}
          <div className="pt-4 pb-2 flex flex-col items-center gap-1.5 border-t border-outline-variant/20">
            {saveError && (
              <p className="text-[12px] text-error text-center">{saveError}</p>
            )}
            <button
              type="button"
              onClick={handleSaveAndNext}
              disabled={isSaving}
              className="h-10 px-8 bg-brand-accent text-on-primary font-semibold rounded-full text-[13px] active:scale-[0.97] transition-all disabled:opacity-50"
            >
              {isSaving ? "Saving..." : isLastRoom ? "Save & Finish" : "Save & Next Room \u2192"}
            </button>
          </div>
        </div>
        )}

        {/* -- Error message ----------------------------------------- */}
        {saveError && (
          <div className="rounded-lg bg-error-container/20 border border-error/20 px-4 py-3 text-sm text-error mb-4">
            {saveError}
          </div>
        )}

        {/* -- Desktop: per-room cards --------------------------------- */}
        {rooms.length > 0 && showEntryForm && (
        <div className={`hidden lg:grid lg:gap-6 ${
          rooms.length === 1 ? "lg:grid-cols-1 lg:max-w-xl" : rooms.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-2 xl:grid-cols-3"
        }`}>
          {rooms.map((room) => {
            const roomDryStandard = room.dry_standard ?? 16;
            const roomForm = getRoomForm(room.id);

            return (
              <div key={room.id} className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4 space-y-3">
                {/* Room header */}
                <div className="text-center border-b border-outline-variant/20 pb-2">
                  <h2 className="text-[15px] font-bold text-on-surface">
                    {room.room_name}
                  </h2>
                  <p className="text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                    {room.length_ft && room.width_ft
                      ? `${room.length_ft} x ${room.width_ft} ft`
                      : ""}
                    {room.square_footage
                      ? ` \u00B7 ${Math.round(room.square_footage)} SF`
                      : ""}
                  </p>
                </div>

                {/* Atmospheric (per room) */}
                <section>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant mb-1.5 font-[family-name:var(--font-geist-mono)]">
                    Atmospheric
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <span className="block text-[9px] text-on-surface-variant mb-0.5 font-[family-name:var(--font-geist-mono)]">
                        Temp &deg;F
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={roomForm.tempF}
                        onChange={(e) => setRoomForm(room.id, (f) => ({ ...f, tempF: e.target.value }))}
                        onFocus={(e) => e.target.select()}
                        placeholder="--"
                        className="w-full h-8 bg-surface-container-low rounded-lg px-2 text-sm font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow placeholder:text-on-surface-variant/30"
                      />
                    </div>
                    <div>
                      <span className="block text-[9px] text-on-surface-variant mb-0.5 font-[family-name:var(--font-geist-mono)]">
                        RH %
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={roomForm.rhPct}
                        onChange={(e) => setRoomForm(room.id, (f) => ({ ...f, rhPct: e.target.value }))}
                        onFocus={(e) => e.target.select()}
                        placeholder="--"
                        className="w-full h-8 bg-surface-container-low rounded-lg px-2 text-sm font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow placeholder:text-on-surface-variant/30"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-[9px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                          GPP
                        </span>
                        <span className="text-[7px] font-bold tracking-wider bg-tertiary-container/20 text-tertiary px-1 py-px rounded font-[family-name:var(--font-geist-mono)]">
                          AUTO
                        </span>
                      </div>
                      <div className="w-full h-8 bg-tertiary-container/10 rounded-lg px-2 flex items-center justify-center">
                        <span className="text-sm font-semibold text-tertiary font-[family-name:var(--font-geist-mono)]">
                          {getRoomGPP(room.id)}
                        </span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Moisture Points */}
                <section>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant mb-0 font-[family-name:var(--font-geist-mono)]">
                    Moisture Points
                  </label>
                  <WetLegend />
                  <div className="space-y-1">
                    {roomForm.points.map((point, i) => {
                      const val = parseFloat(point.reading_value);
                      const isWet = !isNaN(val) && val > roomDryStandard;
                      return (
                        <div
                          key={point.id}
                          className="flex items-center gap-1.5"
                        >
                          <span className="text-[10px] font-bold text-on-surface-variant font-[family-name:var(--font-geist-mono)] w-5 text-center flex-shrink-0">
                            {i + 1}
                          </span>
                          <input
                            type="text"
                            value={point.location_name}
                            onChange={(e) => updatePoint(room.id, point.id, "location_name", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="Location..."
                            className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-surface-container-low text-[12px] text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:ring-2 focus:ring-brand-accent/30 transition-shadow"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={point.reading_value}
                            onChange={(e) => updatePoint(room.id, point.id, "reading_value", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="--"
                            className={`flex-shrink-0 w-14 h-8 rounded-lg px-1.5 text-sm font-bold text-center font-[family-name:var(--font-geist-mono)] bg-surface-container-low focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow ${isWet ? "text-orange-500" : "text-on-surface"}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => addPoint(room.id)}
                    className="mt-1.5 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-brand-accent bg-brand-accent/8 hover:bg-brand-accent/15 transition-colors cursor-pointer"
                  >
                    <Plus size={12} />
                    Add Point
                  </button>
                </section>

                {/* Room Photos */}
                <section>
                  <RoomPhotoSection
                    jobId={jobId}
                    roomId={room.id}
                    roomName={room.room_name}
                    photos={allPhotos.filter(p => p.room_id === room.id)}
                    variant="card"
                    directUpload
                  />
                </section>

                {/* Dehu Output */}
                <section>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant mb-1.5 font-[family-name:var(--font-geist-mono)]">
                    Dehu Output
                  </label>
                  <div className="space-y-1">
                    {roomForm.dehus.map((dehu) => (
                      <div key={dehu.id} className="flex items-end gap-1.5">
                        <div className="flex-1 min-w-0">
                          <span className="block text-[9px] text-on-surface-variant mb-0.5 font-[family-name:var(--font-geist-mono)]">Model</span>
                          <input
                            type="text"
                            value={dehu.dehu_model}
                            onChange={(e) => updateDehu(room.id, dehu.id, "dehu_model", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="Dehu model..."
                            className="w-full h-8 bg-surface-container-low rounded-lg px-2 text-[12px] text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:ring-2 focus:ring-brand-accent/30 transition-shadow"
                          />
                        </div>
                        <div className="w-20 flex-shrink-0">
                          <span className="block text-[9px] text-on-surface-variant mb-0.5 font-[family-name:var(--font-geist-mono)]">RH Out %</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={dehu.rh_out_pct}
                            onChange={(e) => updateDehu(room.id, dehu.id, "rh_out_pct", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="--"
                            className="w-full h-8 bg-surface-container-low rounded-lg px-1.5 text-sm font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                          />
                        </div>
                        <div className="w-20 flex-shrink-0">
                          <span className="block text-[9px] text-on-surface-variant mb-0.5 font-[family-name:var(--font-geist-mono)]">Temp &deg;F</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={dehu.temp_out_f}
                            onChange={(e) => updateDehu(room.id, dehu.id, "temp_out_f", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="--"
                            className="w-full h-8 bg-surface-container-low rounded-lg px-1.5 text-sm font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => addDehu(room.id)}
                    className="mt-1.5 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-brand-accent bg-brand-accent/8 hover:bg-brand-accent/15 transition-colors cursor-pointer"
                  >
                    <Plus size={12} />
                    Add Dehu
                  </button>
                </section>
              </div>
            );
          })}
        </div>
        )}
      </main>

    </div>
  );
}
