"use client";

import { useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowBack, Camera, Plus } from "@/components/icons";
import { mockRooms, mockReadings } from "@/lib/mock-data";
import type { MoisturePoint, DehuOutput } from "@/lib/types";

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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MoistureReadingsPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  // Room navigation
  const rooms = mockRooms;
  const [roomIndex, setRoomIndex] = useState(0);
  const currentRoom = rooms[roomIndex];

  // Day number — use latest reading's day_number + 1, or fallback to 3
  const dayNumber = useMemo(() => {
    const roomReadings = mockReadings.filter(
      (r) => r.room_id === currentRoom?.id
    );
    if (roomReadings.length === 0) return 1;
    const maxDay = Math.max(
      ...roomReadings.map((r) => r.day_number ?? 0)
    );
    return maxDay > 0 ? maxDay : 3;
  }, [currentRoom?.id]);

  // Atmospheric state
  const [tempF, setTempF] = useState("72");
  const [rhPct, setRhPct] = useState("45");

  const gpp = useMemo(() => {
    const t = parseFloat(tempF);
    const r = parseFloat(rhPct);
    if (isNaN(t) || isNaN(r) || r <= 0 || r > 100) return "--";
    return calculateGPP(t, r).toFixed(1);
  }, [tempF, rhPct]);

  // Moisture points state
  const [points, setPoints] = useState<PointEntry[]>(() => {
    // Pre-populate from the latest reading for this room
    const roomReadings = mockReadings.filter(
      (r) => r.room_id === rooms[0]?.id
    );
    const latest = roomReadings[roomReadings.length - 1];
    if (latest) {
      return latest.points.map((p: MoisturePoint) => ({
        id: p.id,
        location_name: p.location_name,
        reading_value: "",
      }));
    }
    return [
      { id: crypto.randomUUID(), location_name: "South wall base", reading_value: "" },
      { id: crypto.randomUUID(), location_name: "North wall base", reading_value: "" },
      { id: crypto.randomUUID(), location_name: "Subfloor center", reading_value: "" },
    ];
  });

  // Dehu state
  const [dehus, setDehus] = useState<DehuEntry[]>(() => {
    const roomReadings = mockReadings.filter(
      (r) => r.room_id === rooms[0]?.id
    );
    const latest = roomReadings[roomReadings.length - 1];
    if (latest && latest.dehus.length > 0) {
      return latest.dehus.map((d: DehuOutput) => ({
        id: d.id,
        dehu_model: d.dehu_model ?? "Dri-Eaz LGR 3500i",
        rh_out_pct: "",
        temp_out_f: "",
      }));
    }
    return [
      {
        id: crypto.randomUUID(),
        dehu_model: "Dri-Eaz LGR 3500i",
        rh_out_pct: "",
        temp_out_f: "",
      },
    ];
  });

  const dryStandard = currentRoom?.dry_standard ?? 16;

  // Point handlers
  const updatePoint = useCallback(
    (id: string, field: keyof PointEntry, value: string) => {
      setPoints((prev) =>
        prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
      );
    },
    []
  );

  const addPoint = useCallback(() => {
    setPoints((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        location_name: "",
        reading_value: "",
      },
    ]);
  }, []);

  // Dehu handlers
  const updateDehu = useCallback(
    (id: string, field: keyof DehuEntry, value: string) => {
      setDehus((prev) =>
        prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
      );
    },
    []
  );

  const addDehu = useCallback(() => {
    setDehus((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        dehu_model: "",
        rh_out_pct: "",
        temp_out_f: "",
      },
    ]);
  }, []);

  // Save & next room
  const handleSaveAndNext = useCallback(() => {
    if (roomIndex < rooms.length - 1) {
      setRoomIndex((prev) => prev + 1);
      // Reset form for next room
      setTempF("72");
      setRhPct("45");
      setPoints([
        { id: crypto.randomUUID(), location_name: "South wall base", reading_value: "" },
        { id: crypto.randomUUID(), location_name: "North wall base", reading_value: "" },
        { id: crypto.randomUUID(), location_name: "Subfloor center", reading_value: "" },
      ]);
      setDehus([
        {
          id: crypto.randomUUID(),
          dehu_model: "Dri-Eaz LGR 3500i",
          rh_out_pct: "",
          temp_out_f: "",
        },
      ]);
      // Scroll to top
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      // Last room — navigate back to job
      router.push(`/jobs/${jobId}`);
    }
  }, [roomIndex, rooms.length, router, jobId]);

  const isLastRoom = roomIndex === rooms.length - 1;

  // Save all rooms handler (desktop)
  const handleSaveAll = useCallback(() => {
    router.push(`/jobs/${jobId}`);
  }, [router, jobId]);

  return (
    <div className="min-h-screen bg-surface">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm px-4 pt-4 pb-3">
        <div className="flex items-center justify-between lg:max-w-5xl lg:mx-auto">
          <div className="flex items-center gap-3">
            <Link
              href={`/jobs/${jobId}`}
              className="flex items-center justify-center w-12 h-12 rounded-xl bg-surface-container-low active:bg-surface-container-high transition-colors"
              aria-label="Back to job"
            >
              <ArrowBack size={22} className="text-on-surface-variant" />
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
            className="hidden lg:flex h-10 px-6 primary-gradient text-on-primary font-semibold rounded-xl text-sm items-center transition-all hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] cursor-pointer"
          >
            Save All Rooms
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

      {/* ── Main content ───────────────────────────────────────── */}
      <main className="px-4 pb-28 lg:pb-8 mt-2 lg:max-w-5xl lg:mx-auto">
        {/* ── Atmospheric (shared across all rooms — full width on desktop) ── */}
        <section className="mb-6">
          <label className="block text-[11px] font-semibold tracking-wider uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
            Atmospheric
          </label>
          <div className="grid grid-cols-3 gap-3 lg:max-w-md">
            {/* Temp */}
            <div className="bg-surface-container-lowest rounded-xl p-3">
              <span className="block text-[11px] text-on-surface-variant mb-1.5 font-[family-name:var(--font-geist-mono)]">
                Temp &deg;F
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={tempF}
                onChange={(e) => setTempF(e.target.value)}
                className="w-full h-14 bg-surface-container-low rounded-lg px-3 text-xl font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
              />
            </div>

            {/* RH */}
            <div className="bg-surface-container-lowest rounded-xl p-3">
              <span className="block text-[11px] text-on-surface-variant mb-1.5 font-[family-name:var(--font-geist-mono)]">
                RH %
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={rhPct}
                onChange={(e) => setRhPct(e.target.value)}
                className="w-full h-14 bg-surface-container-low rounded-lg px-3 text-xl font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
              />
            </div>

            {/* GPP (auto) */}
            <div className="bg-surface-container-lowest rounded-xl p-3 relative">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                  GPP
                </span>
                <span className="text-[9px] font-bold tracking-wider bg-tertiary-container/20 text-tertiary px-1.5 py-0.5 rounded font-[family-name:var(--font-geist-mono)]">
                  AUTO
                </span>
              </div>
              <div className="w-full h-14 bg-tertiary-container/10 rounded-lg px-3 flex items-center justify-center">
                <span className="text-xl font-semibold text-tertiary font-[family-name:var(--font-geist-mono)]">
                  {gpp}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Mobile: single room view ─────────────────────────── */}
        <div className="lg:hidden space-y-6">
          {/* Room title */}
          <div className="text-center">
            <h2 className="text-2xl font-bold text-on-surface">
              {currentRoom?.room_name}
            </h2>
            <p className="text-xs text-on-surface-variant mt-1 font-[family-name:var(--font-geist-mono)]">
              Room {roomIndex + 1} of {rooms.length}
            </p>
          </div>

          {/* Moisture Points */}
          <section>
            <label className="block text-[11px] font-semibold tracking-wider uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
              Moisture Points
            </label>
            <div className="space-y-3">
              {points.map((point, i) => {
                const val = parseFloat(point.reading_value);
                const isWet = !isNaN(val) && val > dryStandard;

                return (
                  <div
                    key={point.id}
                    className="bg-surface-container-lowest rounded-xl p-3 flex items-center gap-3"
                  >
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center">
                      <span className="text-sm font-bold text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                        {i + 1}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={point.location_name}
                      onChange={(e) =>
                        updatePoint(point.id, "location_name", e.target.value)
                      }
                      placeholder="Location..."
                      className="flex-1 h-12 bg-surface-container-low rounded-lg px-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                    />
                    <div className="flex-shrink-0 relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={point.reading_value}
                        onChange={(e) =>
                          updatePoint(point.id, "reading_value", e.target.value)
                        }
                        placeholder="--"
                        className={`w-20 h-14 rounded-lg px-2 text-xl font-bold text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow ${
                          isWet
                            ? "bg-error-container/30 text-brand-accent"
                            : "bg-surface-container-low text-on-surface"
                        }`}
                      />
                      {isWet && (
                        <span className="absolute -top-1.5 -right-1.5 text-sm" aria-label="Above dry standard">
                          &#x26A0;&#xFE0F;
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="flex-shrink-0 w-12 h-12 rounded-xl bg-surface-container-low flex items-center justify-center active:bg-surface-container-high transition-colors"
                      aria-label={`Take photo of point ${i + 1}`}
                    >
                      <Camera size={20} className="text-on-surface-variant" />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={addPoint}
              className="mt-3 flex items-center gap-2 px-4 h-12 rounded-xl text-brand-accent font-semibold text-sm active:bg-brand-accent/10 transition-colors"
            >
              <Plus size={18} />
              Add Point
            </button>
          </section>

          {/* Dehu Output */}
          <section>
            <label className="block text-[11px] font-semibold tracking-wider uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
              Dehu Output
            </label>
            <div className="space-y-3">
              {dehus.map((dehu) => (
                <div
                  key={dehu.id}
                  className="bg-surface-container-lowest rounded-xl p-3 space-y-3"
                >
                  <input
                    type="text"
                    value={dehu.dehu_model}
                    onChange={(e) =>
                      updateDehu(dehu.id, "dehu_model", e.target.value)
                    }
                    placeholder="Dehu model..."
                    className="w-full h-12 bg-surface-container-low rounded-lg px-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="block text-[11px] text-on-surface-variant mb-1.5 font-[family-name:var(--font-geist-mono)]">
                        RH Out %
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={dehu.rh_out_pct}
                        onChange={(e) =>
                          updateDehu(dehu.id, "rh_out_pct", e.target.value)
                        }
                        placeholder="--"
                        className="w-full h-14 bg-surface-container-low rounded-lg px-3 text-xl font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] text-on-surface-variant mb-1.5 font-[family-name:var(--font-geist-mono)]">
                        Temp Out &deg;F
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={dehu.temp_out_f}
                        onChange={(e) =>
                          updateDehu(dehu.id, "temp_out_f", e.target.value)
                        }
                        placeholder="--"
                        className="w-full h-14 bg-surface-container-low rounded-lg px-3 text-xl font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addDehu}
              className="mt-3 flex items-center gap-2 px-4 h-12 rounded-xl text-brand-accent font-semibold text-sm active:bg-brand-accent/10 transition-colors"
            >
              <Plus size={18} />
              Add Dehu
            </button>
          </section>
        </div>

        {/* ── Desktop: all rooms side-by-side ──────────────────── */}
        <div className="hidden lg:grid lg:grid-cols-3 lg:gap-6">
          {rooms.map((room) => {
            const roomReadings = mockReadings.filter((r) => r.room_id === room.id);
            const latestMockReading = roomReadings[roomReadings.length - 1];
            const roomDryStandard = room.dry_standard ?? 16;

            return (
              <div key={room.id} className="bg-surface-container-lowest rounded-2xl p-4 space-y-4">
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
                      ? ` · ${Math.round(room.square_footage)} SF`
                      : ""}
                  </p>
                </div>

                {/* Moisture Points */}
                <section>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
                    Moisture Points
                  </label>
                  <div className="space-y-2">
                    {(latestMockReading?.points ?? []).map((point, i) => {
                      const isWet = point.reading_value > roomDryStandard;
                      return (
                        <div
                          key={point.id}
                          className="flex items-center justify-between py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-on-surface-variant font-[family-name:var(--font-geist-mono)] w-5 text-center">
                              {i + 1}
                            </span>
                            <span className="text-[12px] text-on-surface">
                              {point.location_name}
                            </span>
                          </div>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="--"
                            className={`w-16 h-10 rounded-lg px-2 text-base font-bold text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow ${
                              isWet
                                ? "bg-error-container/30 text-brand-accent"
                                : "bg-surface-container-low text-on-surface"
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={addPoint}
                    className="mt-2 text-[12px] font-semibold text-brand-accent hover:underline cursor-pointer"
                  >
                    + Add Point
                  </button>
                </section>

                {/* Dehu Output */}
                <section>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
                    Dehu Output
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="block text-[10px] text-on-surface-variant mb-1 font-[family-name:var(--font-geist-mono)]">
                        RH Out %
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
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
                        placeholder="--"
                        className="w-full h-10 bg-surface-container-low rounded-lg px-2 text-base font-semibold text-on-surface text-center font-[family-name:var(--font-geist-mono)] focus:outline-none focus:ring-2 focus:ring-brand-accent/40 transition-shadow"
                      />
                    </div>
                  </div>
                </section>
              </div>
            );
          })}
        </div>
      </main>

      {/* ── Bottom CTA (mobile only) ──────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 p-4 bg-surface/95 backdrop-blur-sm lg:hidden">
        <button
          type="button"
          onClick={handleSaveAndNext}
          className="w-full h-14 primary-gradient text-on-primary font-semibold rounded-xl text-base active:opacity-90 transition-opacity"
        >
          {isLastRoom ? "Save & Finish" : "Save & Next Room \u2192"}
        </button>
      </div>
    </div>
  );
}
