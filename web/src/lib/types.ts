// Crewmatic TypeScript types — matches docs/api-reference.md Pydantic schemas exactly

// ─── Shared ───────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

// ─── Enums ────────────────────────────────────────────────────────────
export type LossType = "water" | "fire" | "mold" | "storm" | "other";
export type WaterCategory = "1" | "2" | "3";
export type WaterClass = "1" | "2" | "3" | "4";
export type JobType = "mitigation" | "reconstruction";
export type JobStatus =
  | "new" | "contracted" | "mitigation" | "drying" | "complete" | "submitted" | "collected"  // mitigation
  | "scoping" | "in_progress";  // reconstruction-only
// Note: "new", "complete", "submitted", "collected" are shared across both pipelines
export type ReconPhaseStatus = "pending" | "in_progress" | "on_hold" | "complete";
export type PhotoType = "damage" | "equipment" | "protection" | "containment" | "moisture_reading" | "before" | "after";
export type ReportType = "full_report" | "mitigation_invoice" | "reconstruction_report";
export type ReportStatus = "draft" | "generating" | "ready" | "failed";
export type ShareScope = "full" | "restoration_only" | "photos_only";

// ─── Pipeline stages (for dashboard) ─────────────────────────────────
export type MitigationPipelineStage = "new" | "contracted" | "mitigation" | "drying" | "complete" | "submitted" | "collected";
export type ReconPipelineStage = "new" | "scoping" | "in_progress" | "complete" | "submitted" | "collected";
export type PipelineStage = MitigationPipelineStage | ReconPipelineStage;

// ─── Properties ───────────────────────────────────────────────────────
export interface Property {
  id: string;
  company_id: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
  usps_standardized: string | null;
  year_built: number | null;
  property_type: string | null;
  total_sqft: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Jobs ─────────────────────────────────────────────────────────────
// ─── Reconstruction Phases ───────────────────────────────────────────
export interface ReconPhase {
  id: string;
  job_id: string;
  company_id: string;
  phase_name: string;
  status: ReconPhaseStatus;
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinkedJobSummary {
  id: string;
  job_number: string;
  job_type: JobType;
  status: JobStatus;
}

// ─── Jobs ─────────────────────────────────────────────────────────────
export interface Job {
  id: string;
  company_id: string;
  property_id: string | null;
  job_type: JobType;
  linked_job_id: string | null;
  linked_job_summary: LinkedJobSummary | null;
  job_number: string;
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  claim_number: string | null;
  carrier: string | null;
  adjuster_name: string | null;
  adjuster_phone: string | null;
  adjuster_email: string | null;
  loss_type: LossType;
  loss_category: WaterCategory | null;
  loss_class: WaterClass | null;
  loss_cause: string | null;
  loss_date: string | null;
  home_year_built: number | null;
  status: JobStatus;
  floor_plan_id: string | null;
  assigned_to: string | null;
  notes: string | null;
  tech_notes: string | null;
  latitude: number | null;
  longitude: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobDetail extends Job {
  room_count: number;
  photo_count: number;
  floor_plan_count: number;
  line_item_count: number;
}

export interface JobCreate {
  job_type?: JobType;
  linked_job_id?: string;
  address_line1: string;
  loss_type?: LossType;
  city?: string;
  state?: string;
  zip?: string;
  property_id?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  loss_category?: WaterCategory;
  loss_class?: WaterClass;
  loss_cause?: string;
  loss_date?: string;
  home_year_built?: number;
  claim_number?: string;
  carrier?: string;
  adjuster_name?: string;
  adjuster_phone?: string;
  adjuster_email?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  tech_notes?: string;
}

// ─── Floor Plans (property-scoped, unified table, Spec 01H) ──────────
// Post-merge: one table. Each row IS a versioned snapshot of a floor at a
// property. No separate container + versions — they're the same thing now.
export interface FloorPlan {
  id: string;
  property_id: string;
  company_id: string;
  floor_number: number;
  floor_name: string;
  version_number: number;
  canvas_data: Record<string, unknown> | null;
  is_current: boolean;
  created_by_job_id: string | null;
  created_by_user_id: string | null;
  change_summary: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Opaque version tag for optimistic-concurrency writes (Round 3).
   * Derived from `updated_at` on the server. When the client saves
   * (POST /v1/floor-plans/{id}/versions), it echoes this string back
   * as `If-Match`. Server rejects with 412 VERSION_STALE if the row
   * has been written by another editor since the client read it.
   *
   * Round 5 (Lakshman P3 #6): type narrowed from `string | null | undefined`
   * to `string | undefined`. Tri-state at a contract boundary was a
   * smell — consumers reaching for `?? undefined` or `!etag` could
   * silently drop to no-etag, which under round-5's "If-Match required"
   * rule would previously have silently skipped the precondition. The
   * wire JSON may still produce `null` for the rare no-updated_at case,
   * but all current consumers narrow via `hasEtag()` (below) or the
   * `opts.etag && opts.etag.length > 0` truthy check in
   * `saveCanvasVersion` — both handle runtime null correctly even with
   * the stricter TS type, and the type now forbids silent-drop consumers.
   */
  etag?: string;
}

/**
 * Type guard for {@link FloorPlan.etag}. Returns `true` when the floor
 * plan row has a concrete etag string we can send as `If-Match`; `false`
 * otherwise (undefined, or runtime null). Use this when you need to
 * branch on "do I have an etag to assert?" — the `fp is FloorPlan &
 * { etag: string }` narrowing makes the positive branch type-safe.
 *
 * ```ts
 * if (hasEtag(fp)) {
 *   // fp.etag is string here, not string | undefined.
 *   sendIfMatch(fp.etag);
 * } else {
 *   // no etag available — use wildcard opt-out.
 *   sendIfMatch("*");
 * }
 * ```
 */
export function hasEtag(fp: FloorPlan): fp is FloorPlan & { etag: string } {
  return typeof fp.etag === "string" && fp.etag.length > 0;
}


// ─── Rooms (extended, Spec 01H) ──────────────────────────────────────
export type RoomType =
  | "living_room" | "kitchen" | "bathroom" | "bedroom" | "basement"
  | "hallway" | "laundry_room" | "garage" | "dining_room" | "office"
  | "closet" | "utility_room" | "other";
export type CeilingType = "flat" | "vaulted" | "cathedral" | "sloped";
export type FloorLevel = "basement" | "main" | "upper" | "attic";

// Mapping between the semantic FloorLevel enum (UI) and the integer
// floor_number stored on floor_plans (DB). Kept alongside the type so
// imports are single-source. Mirrors FLOOR_PRESETS in floor-selector.tsx.
export const FLOOR_LEVEL_TO_NUMBER: Record<FloorLevel, number> = {
  basement: 0,
  main: 1,
  upper: 2,
  attic: 3,
};
export const FLOOR_LEVEL_LABEL: Record<FloorLevel, string> = {
  basement: "Basement",
  main: "Main Floor",
  upper: "Upper Floor",
  attic: "Attic",
};
export function floorNumberToLevel(n: number | null | undefined): FloorLevel | null {
  if (n === 0) return "basement";
  if (n === 1) return "main";
  if (n === 2) return "upper";
  if (n === 3) return "attic";
  return null;
}

export interface Room {
  id: string;
  job_id: string;
  company_id: string;
  floor_plan_id: string | null;
  room_name: string;
  length_ft: number | null;
  width_ft: number | null;
  height_ft: number | null;
  square_footage: number | null;
  // V2 fields (Spec 01H) — optional with defaults for backward compat with mock data
  room_type?: RoomType | null;
  ceiling_type?: CeilingType;
  floor_level?: FloorLevel | null;
  affected?: boolean;
  material_flags?: string[] | null;
  wall_square_footage?: number | null;
  custom_wall_sf?: number | null;
  room_polygon?: Array<{ x: number; y: number }> | null;
  floor_openings?: Array<{ x: number; y: number; width: number; height: number }> | null;
  // Existing fields
  water_category: WaterCategory | null;
  water_class: WaterClass | null;
  dry_standard: number | null;
  equipment_air_movers: number;
  equipment_dehus: number;
  room_sketch_data: Record<string, unknown> | null;
  notes: string | null;
  sort_order: number;
  reading_count: number;
  latest_reading_date: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Walls (new, Spec 01H) ──────────────────────────────────────────
export type WallType = "exterior" | "interior";
export type OpeningType = "door" | "window" | "missing_wall";

export interface WallSegment {
  id: string;
  room_id: string;
  company_id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  wall_type: WallType;
  wall_height_ft: number | null;
  affected: boolean;
  shared: boolean;
  shared_with_room_id: string | null;
  sort_order: number;
  openings: WallOpening[];
  created_at: string;
  updated_at: string;
}

export interface WallOpening {
  id: string;
  wall_id: string;
  company_id: string;
  opening_type: OpeningType;
  position: number;
  width_ft: number;
  height_ft: number;
  sill_height_ft: number | null;
  swing: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Photos ───────────────────────────────────────────────────────────
export interface Photo {
  id: string;
  job_id: string;
  company_id: string;
  room_id: string | null;
  room_name: string | null;
  storage_url: string;
  filename: string | null;
  caption: string | null;
  photo_type: PhotoType;
  selected_for_ai: boolean;
  uploaded_at: string;
}

// ─── Moisture Readings ────────────────────────────────────────────────
export interface MoisturePoint {
  id: string;
  reading_id: string;
  location_name: string;
  reading_value: number;
  meter_photo_url: string | null;
  sort_order: number;
  created_at: string;
}

export interface DehuOutput {
  id: string;
  reading_id: string;
  dehu_model: string | null;
  rh_out_pct: number | null;
  temp_out_f: number | null;
  sort_order: number;
  created_at: string;
}

export interface MoistureReading {
  id: string;
  job_id: string;
  room_id: string;
  company_id: string;
  reading_date: string;
  day_number: number | null;
  atmospheric_temp_f: number | null;
  atmospheric_rh_pct: number | null;
  atmospheric_gpp: number | null;
  points: MoisturePoint[];
  dehus: DehuOutput[];
  created_at: string;
  updated_at: string;
}

// ─── Events ───────────────────────────────────────────────────────────
export interface Event {
  id: string;
  company_id: string;
  job_id: string | null;
  event_type: string;
  user_id: string | null;
  is_ai: boolean;
  event_data: Record<string, unknown>;
  created_at: string;
}

// ─── Reports ──────────────────────────────────────────────────────────
export interface Report {
  id: string;
  job_id: string;
  company_id: string;
  report_type: ReportType;
  status: ReportStatus;
  storage_url: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Dashboard (computed/aggregated) ──────────────────────────────────
export interface DashboardKPIs {
  active_jobs: number;
  active_jobs_change: number;
  revenue_mtd: number;
  revenue_change_pct: number;
  outstanding_ar: number;
  avg_days_to_pay: number;
  avg_cycle_days: number;
  cycle_change_days: number;
}

export interface PipelineStageData {
  stage: PipelineStage;
  label: string;
  count: number;
  amount: number;
  color: string;
}

export interface PriorityTask {
  id: string;
  job_id: string;
  address: string;
  description: string;
  priority: "critical" | "warning" | "normal" | "low";
  due?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  avatar_url: string | null;
  current_job_address: string | null;
  status: "on_site" | "available" | "off";
}
