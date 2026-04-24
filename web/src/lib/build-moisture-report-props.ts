// Shared derivation for the Moisture Report view's two mount points
// (protected tech route + public adjuster portal). Both wrappers were
// re-deriving the same `readingsByPinId` + `floorsList` memos, which
// let them drift out of sync (see H3 in the critical review round for
// Tasks 6+7 — different primary-floor resolution between the two).
//
// Keeping this file pure (no React, no hooks) so the derivation is
// unit-testable without mounting a component.

import type { FloorPlanData } from "@/components/sketch/floor-plan-tools";
import type { MoisturePin, MoisturePinReading } from "@/lib/types";
import type { MoistureReportFloor } from "@/components/moisture-report/moisture-report-view";

export interface BuildMoistureReportPropsInput {
  pins: ReadonlyArray<MoisturePin>;
  floorPlans: ReadonlyArray<{
    id: string;
    floor_number: number;
    floor_name?: string | null;
    canvas_data?: unknown;
    is_current?: boolean;
  }>;
  /** Primary floor hint. Pass the job's pinned `floor_plan_id` (from
   *  `jobs.floor_plan_id` on the protected route; from the hoisted
   *  `primary_floor_id` on the shared payload). When omitted or
   *  missing from `floorPlans`, falls back to the first `is_current`
   *  row, then to `floorPlans[0]`. */
  primaryFloorId?: string | null;
}

export interface BuildMoistureReportPropsOutput {
  floors: MoistureReportFloor[];
  readingsByPinId: Map<string, MoisturePinReading[]>;
  /** Pins that can't be confidently placed on any floor — either
   *  `floor_plan_id` is null (legacy pre-backfill row that the
   *  migration couldn't resolve, e.g. a multi-floor property with
   *  no job-pinned floor) or it points at a floor not in the
   *  current `floorPlans` list (stale row, deleted floor).
   *  Surfacing them as a separate bucket so the report can show
   *  "Uncategorized pins (N)" instead of silently dropping them or
   *  cramming them all onto the primary floor and falsely
   *  concentrating the damage picture. */
  orphanPins: MoisturePin[];
}

const DEFAULT_CANVAS: FloorPlanData = {
  gridSize: 10,
  rooms: [],
  walls: [],
  doors: [],
  windows: [],
};

export function buildMoistureReportProps({
  pins,
  floorPlans,
  primaryFloorId,
}: BuildMoistureReportPropsInput): BuildMoistureReportPropsOutput {
  // Normalize reading shape: backend serializes NUMERIC as string
  // ("7.00"); downstream math needs numbers. Also re-sort ASC by
  // taken_at — the API returns DESC for the tech UI but the
  // report's derivation (dry milestone, color-as-of) expects ASC.
  // ISO 8601 timestamps sort lexicographically the same as
  // chronologically, so localeCompare on the raw string is correct.
  const readingsByPinId = new Map<string, MoisturePinReading[]>();
  for (const pin of pins) {
    const raw = pin.readings ?? [];
    const asc = raw
      .slice()
      .sort((a, b) => a.taken_at.localeCompare(b.taken_at))
      .map((r) => ({ ...r, reading_value: Number(r.reading_value) }));
    readingsByPinId.set(pin.id, asc);
  }

  // Strict per-floor bucketing. Previously this helper had an
  // all-or-nothing fallback: if NO pin had a floor_plan_id, every
  // pin got crammed onto the resolved primary floor. Mixed cases
  // ("some pins have it, some don't") silently dropped the
  // missing-id pins. Both behaviors misrepresented multi-floor data.
  //
  // New rule: any pin with a non-null floor_plan_id matching a
  // current floor → that floor. Anything else (null id, stale id,
  // deleted floor) → orphanPins. The view renders an "Uncategorized
  // pins (N)" callout when orphanPins is non-empty so the adjuster
  // sees the gap rather than missing it. After the f1e2d3c4b5a6
  // backfill migration this should be rare (only multi-floor jobs
  // that were unpinned at room-creation time can land here).
  //
  // primaryFloorId is still resolved + threaded through (currently
  // used by the wrapper for the default floor selection in the URL
  // param) but no longer drives pin attribution.
  void primaryFloorId; // referenced for future floor-selector default

  const validFloorIds = new Set(floorPlans.map((fp) => fp.id));
  const orphanPins: MoisturePin[] = [];
  const pinsByFloorId = new Map<string, MoisturePin[]>();
  for (const pin of pins) {
    if (pin.floor_plan_id && validFloorIds.has(pin.floor_plan_id)) {
      const list = pinsByFloorId.get(pin.floor_plan_id) ?? [];
      list.push(pin);
      pinsByFloorId.set(pin.floor_plan_id, list);
    } else {
      orphanPins.push(pin);
    }
  }

  const floors: MoistureReportFloor[] = floorPlans
    .map((fp) => ({
      floorPlanId: fp.id,
      floorName: fp.floor_name ?? "",
      floorNumber: fp.floor_number,
      canvas:
        (fp.canvas_data as FloorPlanData | undefined) ?? DEFAULT_CANVAS,
      pins: pinsByFloorId.get(fp.id) ?? [],
    }))
    .sort((a, b) => a.floorNumber - b.floorNumber);

  return { floors, readingsByPinId, orphanPins };
}
