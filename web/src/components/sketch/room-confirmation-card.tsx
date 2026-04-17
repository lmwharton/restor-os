"use client";

import { useState, useCallback, useRef } from "react";
import type { RoomData } from "./floor-plan-tools";
import type { RoomType, CeilingType, FloorLevel } from "@/lib/types";

const ROOM_TYPE_MATERIAL_DEFAULTS: Record<string, string[]> = {
  living_room: ["carpet", "drywall", "paint"],
  kitchen: ["tile", "drywall", "paint", "backsplash"],
  bathroom: ["tile", "drywall", "paint"],
  bedroom: ["carpet", "drywall", "paint"],
  basement: ["concrete", "drywall"],
  hallway: ["carpet", "drywall", "paint"],
  laundry_room: ["tile", "drywall", "paint"],
  garage: ["concrete"],
  dining_room: ["hardwood", "drywall", "paint"],
  office: ["carpet", "drywall", "paint"],
  closet: ["carpet", "drywall"],
  utility_room: ["concrete", "drywall"],
  other: [],
};

const ROOM_TYPE_OPTIONS: { value: RoomType; label: string }[] = [
  { value: "living_room", label: "Living Room" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bathroom", label: "Bathroom" },
  { value: "bedroom", label: "Bedroom" },
  { value: "basement", label: "Basement" },
  { value: "hallway", label: "Hallway" },
  { value: "laundry_room", label: "Laundry" },
  { value: "garage", label: "Garage" },
  { value: "dining_room", label: "Dining" },
  { value: "office", label: "Office" },
  { value: "closet", label: "Closet" },
  { value: "utility_room", label: "Utility" },
  { value: "other", label: "Other" },
];

const CEILING_TYPES: { value: CeilingType; label: string; icon: string }[] = [
  { value: "flat", label: "Flat", icon: "─" },
  { value: "vaulted", label: "Vault", icon: "⌒" },
  { value: "cathedral", label: "Peak", icon: "∧" },
  { value: "sloped", label: "Slope", icon: "╱" },
];

const FLOOR_LEVEL_OPTIONS: { value: FloorLevel; label: string }[] = [
  { value: "basement", label: "Basement" },
  { value: "main", label: "Main" },
  { value: "upper", label: "Upper" },
  { value: "attic", label: "Attic" },
];

export interface RoomConfirmationData {
  name: string;
  propertyRoomId?: string;
  roomType: RoomType | null;
  ceilingHeight: number;
  ceilingType: CeilingType;
  floorLevel: FloorLevel | null;
  materialFlags: string[];
  affected: boolean;
}

interface RoomConfirmationCardProps {
  existingRooms: RoomData[];
  propertyRooms?: Array<{ id: string; room_name: string }>;
  onConfirm: (data: RoomConfirmationData) => void;
  onCancel: () => void;
  editingRoom?: RoomConfirmationData | null;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-on-surface-variant mb-1">
      {children}
    </p>
  );
}

export function RoomConfirmationCard({
  existingRooms,
  propertyRooms,
  onConfirm,
  onCancel,
  editingRoom,
}: RoomConfirmationCardProps) {
  const isEditing = !!editingRoom;
  const [name, setName] = useState(editingRoom?.name ?? "");
  // Tracks whether the user has committed a name and moved to the details step.
  // Can't derive this from `name.length > 0` — that would flip after the first
  // keystroke and hide the text input mid-typing.
  const [nameCommitted, setNameCommitted] = useState(isEditing);
  const [propertyRoomId, setPropertyRoomId] = useState<string | undefined>(
    editingRoom?.propertyRoomId
  );
  const [roomType, setRoomType] = useState<RoomType | null>(
    editingRoom?.roomType ?? null
  );
  const [ceilingHeight, setCeilingHeight] = useState<string>(
    editingRoom
      ? editingRoom.ceilingHeight % 1 === 0
        ? String(Math.round(editingRoom.ceilingHeight))
        : String(editingRoom.ceilingHeight)
      : ""
  );
  const [ceilingType, setCeilingType] = useState<CeilingType>(
    editingRoom?.ceilingType ?? "flat"
  );
  const [floorLevel, setFloorLevel] = useState<FloorLevel | null>(
    editingRoom?.floorLevel ?? null
  );
  const [materialFlags, setMaterialFlags] = useState<string[]>(
    editingRoom?.materialFlags ?? []
  );
  const [affected, setAffected] = useState(editingRoom?.affected ?? false);
  const [newMaterial, setNewMaterial] = useState("");

  const handleRoomTypeChange = useCallback((type: RoomType | null) => {
    setRoomType(type);
    // Material auto-fill disabled for now — will discuss with Lakshman
  }, []);

  const selectName = useCallback(
    (selectedName: string, propRoomId?: string) => {
      setName(selectedName);
      setPropertyRoomId(propRoomId);
      setNameCommitted(true);
      const match = ROOM_TYPE_OPTIONS.find(
        (o) =>
          o.value === selectedName.toLowerCase().replace(/\s+/g, "_") ||
          o.label.toLowerCase() === selectedName.toLowerCase()
      );
      if (match) handleRoomTypeChange(match.value);
    },
    [handleRoomTypeChange]
  );

  const handleConfirm = () => {
    if (!name.trim()) return;
    onConfirm({
      name: name.trim(),
      propertyRoomId,
      roomType,
      ceilingHeight: ceilingHeight === "" ? 8 : Number(ceilingHeight),
      ceilingType,
      floorLevel,
      materialFlags,
      affected,
    });
  };

  const removeMaterial = (mat: string) =>
    setMaterialFlags((prev) => prev.filter((m) => m !== mat));

  const addMaterial = () => {
    const trimmed = newMaterial.trim().toLowerCase();
    if (trimmed && !materialFlags.includes(trimmed)) {
      setMaterialFlags((prev) => [...prev, trimmed]);
      setNewMaterial("");
    }
  };

  const unmappedPropertyRooms = propertyRooms?.filter(
    (r) => !existingRooms.some((sr) => sr.propertyRoomId === r.id)
  );

  // Swipe-to-close — only tracked when touch starts on the top drag handle
  const panelRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const isDragging = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touchY = e.touches[0].clientY;
    // Only the top 24px (drag handle area) starts a swipe-to-close
    if (touchY > rect.top + 24) return;
    startYRef.current = touchY;
    currentYRef.current = touchY;
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current || !panelRef.current) return;
    currentYRef.current = e.touches[0].clientY;
    const delta = Math.max(0, currentYRef.current - startYRef.current);
    panelRef.current.style.transform = `translateY(${delta}px)`;
    panelRef.current.style.transition = "none";
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current || !panelRef.current) return;
    isDragging.current = false;
    const delta = currentYRef.current - startYRef.current;
    if (delta > 60) {
      panelRef.current.style.transition = "transform 200ms ease-out";
      panelRef.current.style.transform = "translateY(100%)";
      setTimeout(onCancel, 200);
    } else {
      panelRef.current.style.transition = "transform 150ms ease-out";
      panelRef.current.style.transform = "translateY(0)";
    }
  }, [onCancel]);

  const unusedPresets = ROOM_TYPE_OPTIONS.filter(
    (o) =>
      !existingRooms.some(
        (r) => r.name.toLowerCase().replace(/\s+/g, "_") === o.value
      )
  ).slice(0, 8);

  const showNameStep = !nameCommitted && !isEditing;

  return (
    <div className="absolute inset-0 z-20 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onCancel} />

      <div
        ref={panelRef}
        className="relative bg-surface-container-lowest rounded-t-2xl sm:rounded-xl shadow-[0_-4px_24px_rgba(31,27,23,0.1)] sm:shadow-[0_8px_24px_rgba(31,27,23,0.1)] w-full sm:w-[360px] min-h-[55vh] sm:min-h-[420px] max-h-[85vh] sm:max-h-[80vh] overflow-hidden overscroll-contain flex flex-col"
        style={{ animation: "slideUp 0.15s ease-out" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-1.5 sm:hidden shrink-0">
          <div className="w-8 h-0.5 rounded-full bg-outline-variant/40" />
        </div>

        {/* Scrollable content area — actions pinned below in a sticky footer */}
        <div className="px-4 pt-3 sm:px-4 sm:pt-4 flex-1 overflow-y-auto overscroll-contain">
          {/* Header */}
          <div className="mb-3 sm:mb-2.5">
            <h3 className="text-[15px] font-semibold text-on-surface sm:text-[16px]">
              {isEditing ? "Edit Room" : showNameStep ? "Name Room" : "Details"}
            </h3>
          </div>

          {showNameStep ? (
            <>
              {unmappedPropertyRooms && unmappedPropertyRooms.length > 0 && (
                <div className="mb-4 sm:mb-4">
                  <Label>Property Layout</Label>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {unmappedPropertyRooms.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => selectName(r.room_name, r.id)}
                        className="h-9 px-3.5 rounded-lg bg-brand-accent/10 text-brand-accent text-[12px] font-semibold hover:bg-brand-accent hover:text-on-primary active:scale-[0.97] transition-all cursor-pointer"
                      >
                        {r.room_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-4 sm:mb-5">
                <Label>Quick Pick</Label>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {unusedPresets.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => selectName(o.label)}
                      className="h-9 px-3.5 rounded-lg border border-outline-variant text-on-surface text-[12px] font-medium hover:bg-surface-container-high active:scale-[0.97] transition-all cursor-pointer"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim())
                      selectName(name.trim());
                  }}
                  placeholder="Custom name..."
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  className="flex-1 h-11 px-3 rounded-lg border border-outline-variant text-[13px] text-on-surface outline-none focus:border-brand-accent"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (name.trim()) selectName(name.trim());
                  }}
                  disabled={!name.trim()}
                  className="h-11 px-5 rounded-lg bg-brand-accent text-on-primary text-[13px] font-semibold cursor-pointer disabled:opacity-40 active:scale-[0.98] transition-all"
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Room name (compact inline edit) */}
              <div className="mb-2 sm:mb-4">
                <Label>Name</Label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className="w-full h-8 px-2.5 rounded-lg border border-outline-variant text-[12px] text-on-surface outline-none focus:border-brand-accent sm:h-10 sm:px-3 sm:text-[13px]"
                />
              </div>

              {/* Room type — compact 4-col grid (matches Ceiling/Floor style) */}
              <div className="mb-2 sm:mb-4">
                <Label>Type</Label>
                <div className="grid grid-cols-4 gap-1 sm:gap-1.5">
                  {ROOM_TYPE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => handleRoomTypeChange(o.value)}
                      className={`h-7 rounded-lg text-[10px] font-medium transition-all cursor-pointer sm:h-9 sm:text-[12px] ${
                        roomType === o.value
                          ? "bg-brand-accent text-on-primary"
                          : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ceiling + Height — inline row */}
              <div className="mb-2 sm:mb-4">
                <Label>Ceiling</Label>
                <div className="flex gap-1.5 items-center sm:gap-2">
                  <div className="flex-1 grid grid-cols-4 gap-1 sm:gap-1.5">
                    {CEILING_TYPES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setCeilingType(c.value)}
                        className={`h-7 rounded-lg text-[10px] font-medium cursor-pointer transition-all sm:h-9 sm:text-[12px] ${
                          ceilingType === c.value
                            ? "bg-brand-accent text-on-primary"
                            : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <div className="relative w-14 shrink-0 sm:w-16">
                    <input
                      type="number"
                      value={ceilingHeight}
                      onChange={(e) => setCeilingHeight(e.target.value)}
                      placeholder="8"
                      min={1}
                      max={30}
                      step={0.5}
                      onFocus={(e) => e.target.select()}
                      className="w-full h-7 px-1 pr-4 rounded-lg border border-outline-variant text-[11px] text-on-surface text-center outline-none focus:border-brand-accent font-[family-name:var(--font-geist-mono)] sm:h-9 sm:text-[12px]"
                    />
                    <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] text-on-surface-variant font-[family-name:var(--font-geist-mono)] sm:text-[10px]">
                      ft
                    </span>
                  </div>
                </div>
              </div>

              {/* Floor level — same grid style as ceiling */}
              <div className="mb-2 sm:mb-4">
                <Label>Floor</Label>
                <div className="grid grid-cols-4 gap-1 sm:gap-1.5">
                  {FLOOR_LEVEL_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() =>
                        setFloorLevel(floorLevel === o.value ? null : o.value)
                      }
                      className={`h-7 rounded-lg text-[10px] font-medium cursor-pointer transition-all sm:h-9 sm:text-[12px] ${
                        floorLevel === o.value
                          ? "bg-brand-accent text-on-primary"
                          : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Materials — compact chips */}
              <div className="mb-2 sm:mb-4">
                <Label>Materials</Label>
                {materialFlags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1.5 sm:gap-1.5 sm:mb-2">
                    {materialFlags.map((mat) => (
                      <span
                        key={mat}
                        className="inline-flex items-center gap-0.5 h-6 px-2 rounded-full bg-secondary-container/30 text-[10px] font-medium text-on-surface sm:h-7 sm:px-3 sm:text-[12px]"
                      >
                        {mat}
                        <button
                          type="button"
                          onClick={() => removeMaterial(mat)}
                          className="text-on-surface-variant hover:text-error cursor-pointer text-[12px] leading-none ml-0.5 sm:text-[14px]"
                          aria-label={`Remove ${mat}`}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-1 sm:gap-2">
                  <input
                    type="text"
                    value={newMaterial}
                    onChange={(e) => setNewMaterial(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addMaterial();
                      }
                    }}
                    placeholder="Add..."
                    onFocus={(e) => e.target.select()}
                    className="flex-1 h-7 px-2 rounded-lg border border-outline-variant text-[11px] text-on-surface outline-none focus:border-brand-accent sm:h-9 sm:px-3 sm:text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={addMaterial}
                    disabled={!newMaterial.trim()}
                    className="h-7 px-2 rounded-lg border border-outline-variant text-[10px] font-semibold text-on-surface-variant hover:bg-surface-container-high cursor-pointer disabled:opacity-30 sm:h-9 sm:px-3 sm:text-[14px]"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Affected — simple yes/no toggle */}
              <div className="mb-2 sm:mb-4">
                <Label>Affected</Label>
                <div className="grid grid-cols-2 gap-1 sm:gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAffected(false)}
                    className={`h-7 rounded-lg text-[10px] font-medium cursor-pointer transition-all sm:h-9 sm:text-[12px] ${
                      !affected
                        ? "bg-brand-accent text-on-primary"
                        : "border border-outline-variant text-on-surface-variant"
                    }`}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() => setAffected(true)}
                    className={`h-7 rounded-lg text-[10px] font-medium cursor-pointer transition-all sm:h-9 sm:text-[12px] ${
                      affected
                        ? "bg-error text-on-error"
                        : "border border-outline-variant text-on-surface-variant"
                    }`}
                  >
                    Yes — Damaged
                  </button>
                </div>
              </div>

            </>
          )}
        </div>

        {/* Sticky action footer — always visible, outside the scroll area */}
        <div className="shrink-0 px-4 pt-3 pb-4 sm:px-4 sm:pt-3 sm:pb-4 border-t border-outline-variant/30 bg-surface-container-lowest">
          {showNameStep ? (
            <button
              type="button"
              onClick={onCancel}
              className="w-full h-11 rounded-lg border border-red-200 text-[13px] font-medium text-red-600 hover:bg-red-50 cursor-pointer transition-colors sm:h-10"
            >
              Cancel
            </button>
          ) : (
            <>
              <div className="flex gap-1.5 sm:gap-2">
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => {
                      setName("");
                      setPropertyRoomId(undefined);
                      setRoomType(null);
                      setMaterialFlags([]);
                    }}
                    className="flex-1 h-10 rounded-lg border border-outline-variant text-[12px] font-medium text-on-surface-variant active:scale-[0.98] cursor-pointer sm:h-10 sm:text-[13px]"
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!name.trim()}
                  className="flex-1 h-10 rounded-lg bg-brand-accent text-on-primary text-[12px] font-semibold cursor-pointer disabled:opacity-40 active:scale-[0.98] transition-all sm:h-10 sm:text-[13px]"
                >
                  {isEditing ? "Update" : "Confirm"}
                </button>
              </div>
              <button
                type="button"
                onClick={onCancel}
                className="mt-3 w-full h-10 rounded-lg border border-red-200 text-[12px] font-medium text-red-600 hover:bg-red-50 cursor-pointer transition-colors sm:h-10 sm:text-[13px]"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from {
            transform: translateY(16px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
