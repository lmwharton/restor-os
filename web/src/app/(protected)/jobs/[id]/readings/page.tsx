"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowBack, Plus } from "@/components/icons";
import { useRooms, useReadings } from "@/lib/hooks/use-jobs";
import { apiPost } from "@/lib/api";
import type { MoisturePoint } from "@/lib/types";

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
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MoistureReadingsPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobId = params.id as string;

  // Room navigation
  const { data: rooms = [] } = useRooms(jobId);
  const [roomIndex, setRoomIndex] = useState(0);
  const currentRoom = rooms[roomIndex];

  // Fetch real readings for current room
  const { data: roomReadings = [] } = useReadings(jobId, currentRoom?.id ?? "");

  // Day number — use latest reading's day_number + 1, or fallback to 1
  const dayNumber = useMemo(() => {
    if (roomReadings.length === 0) return 1;
    const maxDay = Math.max(
      ...roomReadings.map((r) => r.day_number ?? 0)
    );
    return maxDay > 0 ? maxDay + 1 : 1;
  }, [roomReadings]);

  // Saving state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Atmospheric state (shared across all rooms)
  const [tempF, setTempF] = useState("72");
  const [rhPct, setRhPct] = useState("45");

  const gpp = useMemo(() => {
    const t = parseFloat(tempF);
    const r = parseFloat(rhPct);
    if (isNaN(t) || isNaN(r) || r <= 0 || r > 100) return "--";
    return calculateGPP(t, r).toFixed(1);
  }, [tempF, rhPct]);

  // ── Per-room form state ──────────────────────────────────────────
  // Track form data for ALL rooms, keyed by room ID.
  const [roomForms, setRoomForms] = useState<Record<string, RoomFormState>>({});

  // Get form state for a specific room, initializing with defaults if needed
  const getRoomForm = useCallback((roomId: string): RoomFormState => {
    return roomForms[roomId] ?? { points: defaultPoints(), dehus: defaultDehus() };
  }, [roomForms]);

  // Update form state for a specific room
  const setRoomForm = useCallback((roomId: string, updater: (prev: RoomFormState) => RoomFormState) => {
    setRoomForms((prev) => {
      const current = prev[roomId] ?? { points: defaultPoints(), dehus: defaultDehus() };
      return { ...prev, [roomId]: updater(current) };
    });
  }, []);

  // Convenience: current room's form state
  const currentRoomId = currentRoom?.id ?? "";
  const currentForm = getRoomForm(currentRoomId);
  const points = currentForm.points;
  const dehus = currentForm.dehus;

  // Update points when room readings load (pre-populate location names from latest reading)
  const latestReadingId = roomReadings.length > 0 ? roomReadings[roomReadings.length - 1].id : null;
  const prevLatestRef = useRef<string | null>(null);
  useMemo(() => {
    if (latestReadingId && latestReadingId !== prevLatestRef.current && currentRoomId) {
      prevLatestRef.current = latestReadingId;
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
            ...prev[currentRoomId],
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
  const saveRoom = useCallback(async (roomId: string, roomPoints: PointEntry[], roomDehus: DehuEntry[]) => {
    // 1. Create the reading
    const readingPayload = {
      reading_date: new Date().toISOString().slice(0, 10),
      atmospheric_temp_f: parseFloat(tempF) || undefined,
      atmospheric_rh_pct: parseFloat(rhPct) || undefined,
    };
    type ReadingResult = { id: string };
    const reading = await apiPost<ReadingResult>(
      `/v1/jobs/${jobId}/rooms/${roomId}/readings`,
      readingPayload
    );

    // 2. Create points
    for (let i = 0; i < roomPoints.length; i++) {
      const pt = roomPoints[i];
      if (!pt.location_name.trim() && !pt.reading_value.trim()) continue;
      await apiPost(`/v1/jobs/${jobId}/readings/${reading.id}/points`, {
        location_name: pt.location_name.trim() || `Point ${i + 1}`,
        reading_value: parseFloat(pt.reading_value) || 0,
        sort_order: i,
      });
    }

    // 3. Create dehus
    for (const dehu of roomDehus) {
      if (!dehu.dehu_model.trim() && !dehu.rh_out_pct.trim() && !dehu.temp_out_f.trim()) continue;
      await apiPost(`/v1/jobs/${jobId}/readings/${reading.id}/dehus`, {
        dehu_model: dehu.dehu_model.trim() || undefined,
        rh_out_pct: parseFloat(dehu.rh_out_pct) || undefined,
        temp_out_f: parseFloat(dehu.temp_out_f) || undefined,
      });
    }
  }, [jobId, tempF, rhPct]);

  // Save current room (mobile flow)
  const saveCurrentRoom = useCallback(async () => {
    if (!currentRoom) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      await saveRoom(currentRoom.id, points, dehus);
      // Invalidate React Query cache for readings
      await queryClient.invalidateQueries({ queryKey: ["readings"] });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save reading");
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [currentRoom, points, dehus, saveRoom, queryClient]);

  // Save & next room (mobile)
  const handleSaveAndNext = useCallback(async () => {
    try {
      await saveCurrentRoom();
    } catch {
      return; // error already set
    }

    if (roomIndex < rooms.length - 1) {
      setRoomIndex((prev) => prev + 1);
      // Reset atmospheric for next room
      setTempF("72");
      setRhPct("45");
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
        const form = getRoomForm(room.id);
        await saveRoom(room.id, form.points, form.dehus);
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
              Day {dayNumber} Readings
            </h1>
          </div>
          {/* Mobile: current room name */}
          <div className="text-right lg:hidden">
            <span className="text-sm font-medium text-on-surface-variant">
              {currentRoom?.room_name}
            </span>
          </div>
          {/* Desktop: Save All button */}
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={isSaving}
            className="hidden lg:flex h-10 px-6 bg-brand-accent text-on-primary font-semibold rounded-lg text-[13px] items-center gap-2 transition-all hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] cursor-pointer disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>

        {/* Room dots (mobile only) */}
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
      </header>

      {/* -- Main content -------------------------------------------- */}
      <main className="px-4 pb-20 lg:pb-8 mt-2 lg:max-w-6xl lg:mx-auto">
        {/* -- Atmospheric (shared across all rooms) -- */}
        <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-3 lg:p-5 mb-4 lg:mb-6">
          <label className="block text-[10px] lg:text-[11px] font-semibold tracking-wider uppercase text-on-surface-variant mb-2 lg:mb-3 font-[family-name:var(--font-geist-mono)]">
            Atmospheric
          </label>
          <div className="grid grid-cols-3 gap-2 lg:gap-3 lg:max-w-lg">
            {/* Temp */}
            <div className="bg-surface-container-lowest rounded-lg lg:rounded-xl p-2 lg:p-3">
              <span className="block text-[10px] lg:text-[11px] text-on-surface-variant mb-1 lg:mb-1.5 font-[family-name:var(--font-geist-mono)]">
                Temp &deg;F
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={tempF}
                onChange={(e) => setTempF(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-full h-10 lg:h-14 bg-surface-container-low rounded-lg px-2 text-base lg:text-xl font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
              />
            </div>

            {/* RH */}
            <div className="bg-surface-container-lowest rounded-lg lg:rounded-xl p-2 lg:p-3">
              <span className="block text-[10px] lg:text-[11px] text-on-surface-variant mb-1 lg:mb-1.5 font-[family-name:var(--font-geist-mono)]">
                RH %
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={rhPct}
                onChange={(e) => setRhPct(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-full h-10 lg:h-14 bg-surface-container-low rounded-lg px-2 text-base lg:text-xl font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
              />
            </div>

            {/* GPP (auto) */}
            <div className="bg-surface-container-lowest rounded-lg lg:rounded-xl p-2 lg:p-3 relative">
              <div className="flex items-center gap-1 mb-1 lg:mb-1.5">
                <span className="text-[10px] lg:text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                  GPP
                </span>
                <span className="text-[8px] lg:text-[9px] font-bold tracking-wider bg-tertiary-container/20 text-tertiary px-1 py-px rounded font-[family-name:var(--font-geist-mono)]">
                  AUTO
                </span>
              </div>
              <div className="w-full h-10 lg:h-14 bg-tertiary-container/10 rounded-lg px-2 flex items-center justify-center">
                <span className="text-base lg:text-xl font-semibold text-tertiary font-[family-name:var(--font-geist-mono)]">
                  {gpp}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* -- Empty state when no rooms ------------------------------ */}
        {rooms.length === 0 && (
          <div className="rounded-xl bg-surface-container-lowest p-6 text-center">
            <p className="text-sm text-on-surface-variant">
              Add rooms from the Property Layout section to start logging moisture readings per room.
            </p>
          </div>
        )}

        {/* -- Mobile: single room view ------------------------------ */}
        <div className="lg:hidden space-y-4">
          {/* Room title */}
          <div className="text-center">
            <h2 className="text-lg font-bold text-on-surface">
              {currentRoom?.room_name}
            </h2>
            <p className="text-[10px] text-on-surface-variant mt-0.5 font-[family-name:var(--font-geist-mono)]">
              Room {roomIndex + 1} of {rooms.length}
            </p>
          </div>

          {/* Moisture Points */}
          <section>
            <label className="block text-[11px] font-semibold tracking-wider uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
              Moisture Points
            </label>
            <div className="space-y-2">
              {points.map((point, i) => {
                const val = parseFloat(point.reading_value);
                const isWet = !isNaN(val) && val > dryStandard;

                return (
                  <div
                    key={point.id}
                    className="bg-surface-container-lowest rounded-lg p-2 flex items-center gap-2"
                  >
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-surface-container-high flex items-center justify-center">
                      <span className="text-[11px] font-bold text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                        {i + 1}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={point.location_name}
                      onChange={(e) =>
                        updatePoint(currentRoomId, point.id, "location_name", e.target.value)
                      }
                      onFocus={(e) => e.target.select()}
                      placeholder="Location..."
                      className="flex-1 h-9 bg-surface-container-low rounded-lg px-2.5 text-[13px] text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                    />
                    <div className="flex-shrink-0 relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={point.reading_value}
                        onChange={(e) =>
                          updatePoint(currentRoomId, point.id, "reading_value", e.target.value)
                        }
                        onFocus={(e) => e.target.select()}
                        placeholder="--"
                        className={`w-16 h-10 rounded-lg px-2 text-base font-bold text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow ${
                          isWet
                            ? "bg-error-container/30 text-error"
                            : "bg-surface-container-low text-on-surface"
                        }`}
                      />
                      {isWet && (
                        <span className="absolute -top-1 -right-1 text-[10px]" aria-label="Above dry standard">
                          &#x26A0;&#xFE0F;
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => addPoint(currentRoomId)}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-brand-accent font-semibold bg-brand-accent/8 active:bg-brand-accent/15 transition-colors"
            >
              <Plus size={14} />
              Add Point
            </button>
          </section>

          {/* Dehu Output */}
          <section>
            <label className="block text-[11px] font-semibold tracking-wider uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
              Dehu Output
            </label>
            <div className="space-y-2">
              {dehus.map((dehu) => (
                <div
                  key={dehu.id}
                  className="bg-surface-container-lowest rounded-lg p-2 space-y-2"
                >
                  <input
                    type="text"
                    value={dehu.dehu_model}
                    onChange={(e) =>
                      updateDehu(currentRoomId, dehu.id, "dehu_model", e.target.value)
                    }
                    onFocus={(e) => e.target.select()}
                    placeholder="Dehu model..."
                    className="w-full h-9 bg-surface-container-low rounded-lg px-2.5 text-[13px] text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="block text-[10px] text-on-surface-variant mb-1 font-[family-name:var(--font-geist-mono)]">
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
                        className="w-full h-10 bg-surface-container-low rounded-lg px-2 text-base font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                      />
                    </div>
                    <div>
                      <span className="block text-[10px] text-on-surface-variant mb-1 font-[family-name:var(--font-geist-mono)]">
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
                        className="w-full h-10 bg-surface-container-low rounded-lg px-2 text-base font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => addDehu(currentRoomId)}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-brand-accent font-semibold bg-brand-accent/8 active:bg-brand-accent/15 transition-colors"
            >
              <Plus size={14} />
              Add Dehu
            </button>
          </section>

          {/* Save CTA */}
          <div className="pt-4 flex flex-col items-center gap-1.5">
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

        {/* -- Error message ----------------------------------------- */}
        {saveError && (
          <div className="rounded-lg bg-error-container/20 border border-error/20 px-4 py-3 text-sm text-error mb-4">
            {saveError}
          </div>
        )}

        {/* -- Desktop: all rooms side-by-side ----------------------- */}
        <div className={`hidden lg:grid lg:gap-6 ${
          rooms.length === 1 ? "lg:grid-cols-1 lg:max-w-xl" : rooms.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-2 xl:grid-cols-3"
        }`}>
          {rooms.map((room) => {
            const roomDryStandard = room.dry_standard ?? 16;
            const roomForm = getRoomForm(room.id);

            return (
              <div key={room.id} className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-5 space-y-4">
                {/* Room header */}
                <div className="text-center border-b border-outline-variant/20 pb-3">
                  <h2 className="text-lg font-bold text-on-surface">
                    {room.room_name}
                  </h2>
                  <p className="text-[11px] text-on-surface-variant mt-0.5 font-[family-name:var(--font-geist-mono)]">
                    {room.length_ft && room.width_ft
                      ? `${room.length_ft} x ${room.width_ft} ft`
                      : ""}
                    {room.square_footage
                      ? ` \u00B7 ${Math.round(room.square_footage)} SF`
                      : ""}
                  </p>
                </div>

                {/* Moisture Points */}
                <section>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
                    Moisture Points
                  </label>
                  <div className="space-y-2">
                    {roomForm.points.map((point, i) => {
                      const val = parseFloat(point.reading_value);
                      const isWet = !isNaN(val) && val > roomDryStandard;
                      return (
                        <div
                          key={point.id}
                          className="flex items-center gap-2 py-1"
                        >
                          <span className="text-[11px] font-bold text-on-surface-variant font-[family-name:var(--font-geist-mono)] w-5 text-center flex-shrink-0">
                            {i + 1}
                          </span>
                          <input
                            type="text"
                            value={point.location_name}
                            onChange={(e) => updatePoint(room.id, point.id, "location_name", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="Location..."
                            className="flex-1 min-w-0 h-9 px-2.5 rounded-lg bg-surface-container-low text-[12px] text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:ring-2 focus:ring-brand-accent/30 transition-shadow"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={point.reading_value}
                            onChange={(e) => updatePoint(room.id, point.id, "reading_value", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            placeholder="--"
                            className={`w-16 h-9 rounded-lg px-2 text-base font-bold text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow ${
                              isWet
                                ? "bg-error-container/30 text-error"
                                : "bg-surface-container-low text-on-surface"
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => addPoint(room.id)}
                    className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-brand-accent bg-brand-accent/8 hover:bg-brand-accent/15 transition-colors cursor-pointer"
                  >
                    <Plus size={14} />
                    Add Point
                  </button>
                </section>

                {/* Dehu Output */}
                <section>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
                    Dehu Output
                  </label>
                  {roomForm.dehus.map((dehu) => (
                    <div key={dehu.id} className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <span className="block text-[10px] text-on-surface-variant mb-1 font-[family-name:var(--font-geist-mono)]">
                          RH Out %
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={dehu.rh_out_pct}
                          onChange={(e) => updateDehu(room.id, dehu.id, "rh_out_pct", e.target.value)}
                          onFocus={(e) => e.target.select()}
                          placeholder="--"
                          className="w-full h-9 bg-surface-container-low rounded-lg px-2 text-base font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                        />
                      </div>
                      <div>
                        <span className="block text-[10px] text-on-surface-variant mb-1 font-[family-name:var(--font-geist-mono)]">
                          Temp Out &deg;F
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={dehu.temp_out_f}
                          onChange={(e) => updateDehu(room.id, dehu.id, "temp_out_f", e.target.value)}
                          onFocus={(e) => e.target.select()}
                          placeholder="--"
                          className="w-full h-9 bg-surface-container-low rounded-lg px-2 text-base font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addDehu(room.id)}
                    className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-brand-accent bg-brand-accent/8 hover:bg-brand-accent/15 transition-colors cursor-pointer"
                  >
                    <Plus size={14} />
                    Add Dehu
                  </button>
                </section>
              </div>
            );
          })}
        </div>
      </main>

    </div>
  );
}
