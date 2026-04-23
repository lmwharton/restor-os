"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMoisturePins } from "@/lib/hooks/use-moisture-pins";
import { useRooms } from "@/lib/hooks/use-jobs";
import {
  deriveRoomStatus,
  ROOM_STATUS_COPY,
  type RoomDryStatus,
} from "@/lib/moisture-room-status";

interface RoomRow {
  id: string;
  name: string;
  status: RoomDryStatus;
  pinCount: number;
}

export function DryingProgressCard({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { data: pins } = useMoisturePins(jobId);
  const { data: rooms } = useRooms(jobId);

  const rows: RoomRow[] = useMemo(() => {
    if (!rooms || !pins) return [];
    return rooms.map((r) => ({
      id: r.id,
      name: r.room_name,
      status: deriveRoomStatus(pins, r.id),
      pinCount: pins.filter((p) => p.room_id === r.id).length,
    }));
  }, [rooms, pins]);

  const pinnedRows = rows.filter((r) => r.status !== "empty");
  if (pinnedRows.length === 0) return null;

  const dryCount = pinnedRows.filter((r) => r.status === "dry").length;

  return (
    <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-5">
      <header className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-semibold text-on-surface">
          Drying Progress
        </h3>
        <span className="text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant tabular-nums">
          {dryCount} of {pinnedRows.length} rooms dry
        </span>
      </header>
      <ul className="divide-y divide-outline-variant/40">
        {pinnedRows.map((row) => {
          const copy = ROOM_STATUS_COPY[row.status];
          return (
            <li
              key={row.id}
              className="flex items-center justify-between py-2.5"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: copy.colorHex }}
                  aria-hidden
                />
                <span className="text-[13px] font-medium text-on-surface truncate">
                  {row.name}
                </span>
              </div>
              <div className="flex items-center gap-4 shrink-0 text-[12px] text-on-surface-variant tabular-nums">
                <span
                  className="font-medium"
                  style={
                    row.status !== "empty"
                      ? { color: copy.colorHex }
                      : undefined
                  }
                >
                  {copy.label}
                </span>
                <span className="w-12 text-right">
                  {row.pinCount === 0
                    ? "—"
                    : `${row.pinCount} pin${row.pinCount === 1 ? "" : "s"}`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => router.push(`/jobs/${jobId}/floor-plan?mode=moisture`)}
        className="mt-4 text-[11px] font-[family-name:var(--font-geist-mono)] font-semibold text-brand-accent hover:underline cursor-pointer uppercase tracking-[0.06em]"
      >
        View Floor Plan →
      </button>
    </section>
  );
}
