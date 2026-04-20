"use client";

// Placement sheet for a new moisture pin. Opens when the tech taps empty
// space inside a room while in Moisture Mode. Captures the structured
// location descriptor (surface + position + room auto-filled), material
// with S500-default dry standard, and the initial reading.
//
// Mobile: bottom sheet (drag-to-dismiss handle on top).
// Desktop: centered modal. Same contents either way.

import { useMemo, useRef, useState } from "react";
import type { MoistureMaterial } from "@/lib/types";
import { DRY_STANDARDS } from "@/lib/hooks/use-moisture-pins";

type Surface = "Floor" | "Wall" | "Ceiling";
type Position = "NW" | "NE" | "C" | "SW" | "SE";

export interface PlacementSheetData {
  surface: Surface;
  position: Position;
  material: MoistureMaterial;
  dry_standard: number;
  initial_reading: number;
  /** Composed "Surface, Position, Room Name" for the pin's location_name. */
  location_name: string;
}

interface MoisturePlacementSheetProps {
  open: boolean;
  /** Shown as a read-only pill so the tech can confirm the pin landed
   *  in the room they expected. */
  roomName: string;
  /** Material tags present in this room (from job_rooms.material_flags).
   *  Ones that have moisture meaning get promoted to a "Suggested" group
   *  at the top of the material dropdown. */
  roomMaterialFlags: string[];
  onSave: (data: PlacementSheetData) => void;
  onClose: () => void;
}

const SURFACES: Surface[] = ["Floor", "Wall", "Ceiling"];
const POSITIONS: Position[] = ["NW", "NE", "C", "SW", "SE"];

// The 7 material options that map to a dry standard. Order matches the
// backend DRY_STANDARDS dict so developers can cross-reference easily.
const MATERIAL_OPTIONS: Array<{ value: MoistureMaterial; label: string }> = [
  { value: "drywall", label: "Drywall" },
  { value: "wood_subfloor", label: "Wood subfloor" },
  { value: "carpet_pad", label: "Carpet pad" },
  { value: "concrete", label: "Concrete" },
  { value: "hardwood", label: "Hardwood" },
  { value: "osb_plywood", label: "OSB / plywood" },
  { value: "block_wall", label: "Block wall" },
];

// Map room.material_flags string values → moisture pin MoistureMaterial.
// Room flags are coarser (e.g., "carpet" the covering); moisture pins
// measure the substrate (the "carpet_pad" beneath). Anything not in the
// map is filtered out of the suggestions (e.g., "paint" / "tile" have no
// moisture reading).
const ROOM_FLAG_TO_MATERIAL: Record<string, MoistureMaterial> = {
  drywall: "drywall",
  carpet: "carpet_pad",
  concrete: "concrete",
  hardwood: "hardwood",
};

export function MoisturePlacementSheet({
  open,
  roomName,
  roomMaterialFlags,
  onSave,
  onClose,
}: MoisturePlacementSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDragging = useRef(false);

  // Split materials into Suggested (from room's material_flags) + Other.
  // Suggested materials are surfaced first so the tech picks them with one tap.
  const { suggested, other } = useMemo(() => {
    const suggestedSet = new Set<MoistureMaterial>();
    for (const flag of roomMaterialFlags) {
      const mat = ROOM_FLAG_TO_MATERIAL[flag];
      if (mat) suggestedSet.add(mat);
    }
    const suggested = MATERIAL_OPTIONS.filter((m) => suggestedSet.has(m.value));
    const other = MATERIAL_OPTIONS.filter((m) => !suggestedSet.has(m.value));
    return { suggested, other };
  }, [roomMaterialFlags]);

  // Default material: first Suggested if any, else drywall (safest default —
  // drywall is present in ~every restoration job).
  const defaultMaterial: MoistureMaterial = suggested[0]?.value ?? "drywall";

  const [surface, setSurface] = useState<Surface>("Floor");
  const [position, setPosition] = useState<Position>("C");
  const [material, setMaterial] = useState<MoistureMaterial>(defaultMaterial);
  // String state for numeric inputs so the user can type intermediate values
  // (empty string, "4.", "4.5") without state rejecting them. Seeded from
  // the material's default dry standard.
  const [dryStandardStr, setDryStandardStr] = useState(String(DRY_STANDARDS[defaultMaterial]));
  const [readingStr, setReadingStr] = useState("");

  // When the user picks a different material, auto-fill the dry standard
  // with its default (they can still override afterwards).
  const handleMaterialChange = (m: MoistureMaterial) => {
    setMaterial(m);
    setDryStandardStr(String(DRY_STANDARDS[m]));
  };

  const dryNum = Number(dryStandardStr);
  const readNum = Number(readingStr);
  const dryValid = Number.isFinite(dryNum) && dryNum >= 0 && dryNum <= 100;
  const readValid = Number.isFinite(readNum) && readNum >= 0 && readNum <= 100;
  const canSave = dryValid && readValid && readingStr !== "";

  // Drag-to-dismiss on mobile — mirrors cutout-editor-sheet.tsx pattern.
  const handleTouchStart = (e: React.TouchEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.touches[0].clientY;
    if (y > rect.top + 24) return;
    startYRef.current = y;
    currentYRef.current = y;
    isDragging.current = true;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current || !panelRef.current) return;
    currentYRef.current = e.touches[0].clientY;
    const delta = Math.max(0, currentYRef.current - startYRef.current);
    panelRef.current.style.transform = `translateY(${delta}px)`;
    panelRef.current.style.transition = "none";
  };
  const handleTouchEnd = () => {
    if (!isDragging.current || !panelRef.current) return;
    isDragging.current = false;
    const delta = currentYRef.current - startYRef.current;
    if (delta > 60) {
      panelRef.current.style.transition = "transform 200ms ease-out";
      panelRef.current.style.transform = "translateY(100%)";
      setTimeout(onClose, 200);
    } else {
      panelRef.current.style.transition = "transform 200ms ease-out";
      panelRef.current.style.transform = "translateY(0)";
    }
  };

  if (!open) return null;

  const handleSave = () => {
    if (!canSave) return;
    const positionWord =
      position === "C"
        ? "Center"
        : position === "NW"
          ? "NW Corner"
          : position === "NE"
            ? "NE Corner"
            : position === "SW"
              ? "SW Corner"
              : "SE Corner";
    const location_name = `${surface}, ${positionWord}, ${roomName}`;
    onSave({
      surface,
      position,
      material,
      dry_standard: dryNum,
      initial_reading: readNum,
      location_name,
    });
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      <div
        ref={panelRef}
        className="relative bg-surface-container-lowest rounded-t-2xl sm:rounded-xl shadow-[0_-4px_24px_rgba(31,27,23,0.1)] sm:shadow-[0_8px_24px_rgba(31,27,23,0.1)] w-full sm:w-[420px] max-h-[85dvh] sm:max-h-[80vh] overflow-hidden flex flex-col"
        style={{ animation: "slideUp 0.15s ease-out" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-1.5 sm:hidden shrink-0">
          <div className="w-8 h-0.5 rounded-full bg-outline-variant/40" />
        </div>

        <div className="px-4 pt-3 pb-2 sm:px-5 sm:pt-5 sm:pb-3 flex-1 min-h-0 overflow-y-auto">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] sm:text-[16px] font-semibold text-on-surface">New moisture pin</h3>
              {/* Room pill — cyan-tinted so the tech visually connects it to Moisture Mode */}
              <span className="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-1 rounded-lg bg-[#0891b2]/10 text-[#0891b2] text-[11px] font-semibold font-[family-name:var(--font-geist-mono)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0891b2]" />
                {roomName}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 -mr-1 -mt-1 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low cursor-pointer"
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Surface chip row */}
          <div className="mb-4">
            <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1.5">Surface</p>
            <div className="flex gap-2">
              {SURFACES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSurface(s)}
                  className={`h-7 sm:h-9 px-3 rounded-lg text-[12px] sm:text-[13px] font-medium transition-colors cursor-pointer ${
                    surface === s
                      ? "bg-brand-accent text-on-primary"
                      : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Position chip grid */}
          <div className="mb-4">
            <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1.5">Position</p>
            <div className="grid grid-cols-5 gap-2">
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPosition(p)}
                  className={`h-7 sm:h-9 rounded-lg text-[12px] sm:text-[13px] font-medium transition-colors cursor-pointer ${
                    position === p
                      ? "bg-brand-accent text-on-primary"
                      : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Material — native select with Suggested optgroup */}
          <div className="mb-4">
            <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1.5">Material</p>
            <div className="relative">
              <select
                value={material}
                onChange={(e) => handleMaterialChange(e.target.value as MoistureMaterial)}
                className="appearance-none w-full h-9 pl-3 pr-8 rounded-lg bg-surface-container-low text-[13px] text-on-surface outline-none focus:ring-2 focus:ring-brand-accent cursor-pointer"
              >
                {suggested.length > 0 && (
                  <optgroup label="Suggested (from room)">
                    {suggested.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}  ·  {DRY_STANDARDS[m.value]}% std
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={suggested.length > 0 ? "Other" : "Materials"}>
                  {other.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}  ·  {DRY_STANDARDS[m.value]}% std
                    </option>
                  ))}
                </optgroup>
              </select>
              {/* Custom chevron to match the web/CLAUDE.md select pattern */}
              <svg
                aria-hidden
                width={14} height={14} viewBox="0 0 24 24" fill="none"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
              >
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>

          {/* Dry standard + Initial reading — side by side */}
          <div className="grid grid-cols-2 gap-3 mb-2">
            <div>
              <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1.5">Dry standard</p>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  value={dryStandardStr}
                  onChange={(e) => setDryStandardStr(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  min={0}
                  max={100}
                  step={0.5}
                  className={`w-full h-10 px-3 pr-8 rounded-lg border text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] font-semibold outline-none focus:border-brand-accent ${
                    !dryValid && dryStandardStr !== "" ? "border-red-400" : "border-outline-variant"
                  }`}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">%</span>
              </div>
            </div>
            <div>
              <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1.5">Initial reading</p>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  value={readingStr}
                  onChange={(e) => setReadingStr(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  min={0}
                  max={100}
                  step={0.5}
                  placeholder="Meter value"
                  autoFocus
                  className={`w-full h-10 px-3 pr-8 rounded-lg border-2 text-[13px] text-on-surface font-[family-name:var(--font-geist-mono)] font-semibold outline-none focus:border-brand-accent ${
                    !readValid && readingStr !== "" ? "border-red-400" : "border-brand-accent/40"
                  }`}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky footer — Cancel + Save pin */}
        <div className="shrink-0 px-4 pt-3 pb-4 sm:px-5 sm:pt-3 sm:pb-4 border-t border-outline-variant/30 bg-surface-container-lowest">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 rounded-lg bg-surface-container-low text-[13px] font-medium text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 h-10 rounded-lg bg-brand-accent text-on-primary text-[13px] font-semibold cursor-pointer disabled:opacity-40 active:scale-[0.98] transition-all"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from { transform: translateY(16px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
