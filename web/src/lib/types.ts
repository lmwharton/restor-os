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
  | "new" | "contracted" | "mitigation" | "drying" | "job_complete" | "submitted" | "collected"  // mitigation
  | "scoping" | "in_progress";  // reconstruction-only
// Note: "new", "job_complete", "submitted", "collected" are shared across both pipelines
// Discuss with Lakshman: rename "job_complete" → "complete" for consistency across both pipelines?
export type ReconPhaseStatus = "pending" | "in_progress" | "on_hold" | "complete";
export type PhotoType = "damage" | "equipment" | "protection" | "containment" | "moisture_reading" | "before" | "after";
export type ReportType = "full_report" | "mitigation_invoice" | "reconstruction_report";
export type ReportStatus = "draft" | "generating" | "ready" | "failed";
export type ShareScope = "full" | "restoration_only" | "photos_only";

// ─── Pipeline stages (for dashboard) ─────────────────────────────────
export type MitigationPipelineStage = "new" | "contracted" | "mitigation" | "drying" | "job_complete" | "submitted" | "collected";
export type ReconPipelineStage = "new" | "scoping" | "in_progress" | "job_complete" | "submitted" | "collected";
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
  status: JobStatus;
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
  claim_number?: string;
  carrier?: string;
  adjuster_name?: string;
  adjuster_phone?: string;
  adjuster_email?: string;
  notes?: string;
  tech_notes?: string;
}

// ─── Floor Plans ──────────────────────────────────────────────────────
export interface FloorPlan {
  id: string;
  job_id: string;
  company_id: string;
  floor_number: number;
  floor_name: string;
  canvas_data: Record<string, unknown> | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Rooms ────────────────────────────────────────────────────────────
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
