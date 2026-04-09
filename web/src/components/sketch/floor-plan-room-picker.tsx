"use client";

import { useState } from "react";
import type { RoomData } from "./floor-plan-tools";

const ROOM_PRESETS = ["Kitchen", "Living Room", "Master Bedroom", "Bedroom", "Bathroom", "Hallway", "Garage", "Office", "Dining Room", "Laundry"];

interface RoomPickerProps {
  existingRooms: RoomData[];
  propertyRooms?: Array<{ id: string; room_name: string }>;
  onSelect: (name: string) => void;
  onCancel: () => void;
}

export function FloorPlanRoomPicker({ existingRooms, propertyRooms, onSelect, onCancel }: RoomPickerProps) {
  const [customName, setCustomName] = useState("");

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20">
      <div className="bg-white rounded-xl shadow-lg p-4 w-[280px] max-h-[400px] overflow-y-auto">
        <h3 className="text-[13px] font-semibold text-[#1a1a1a] mb-3">Name this room</h3>

        {/* Existing Property Layout rooms (not yet drawn) */}
        {propertyRooms && propertyRooms.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#8a847e] mb-1.5">From Property Layout</p>
            <div className="flex flex-wrap gap-1.5">
              {propertyRooms
                .filter((r) => !existingRooms.some((sr) => sr.name === r.room_name))
                .map((r) => (
                  <button key={r.id} type="button" onClick={() => onSelect(r.room_name)}
                    className="px-3 py-1.5 rounded-full bg-[#fff3ed] text-[#e85d26] text-[12px] font-medium hover:bg-[#e85d26] hover:text-white transition-colors cursor-pointer">
                    {r.room_name}
                  </button>
                ))}
              {propertyRooms.filter((r) => !existingRooms.some((sr) => sr.name === r.room_name)).length === 0 && (
                <p className="text-[11px] text-[#8a847e]">All rooms already drawn</p>
              )}
            </div>
          </div>
        )}

        {/* Preset room names */}
        <div className="mb-3">
          <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#8a847e] mb-1.5">Quick pick</p>
          <div className="flex flex-wrap gap-1.5">
            {ROOM_PRESETS
              .filter((name) => !existingRooms.some((r) => r.name === name))
              .slice(0, 6)
              .map((name) => (
                <button key={name} type="button" onClick={() => onSelect(name)}
                  className="px-3 py-1.5 rounded-full border border-[#eae6e1] text-[#1a1a1a] text-[12px] font-medium hover:bg-[#eae6e1] transition-colors cursor-pointer">
                  {name}
                </button>
              ))}
          </div>
        </div>

        {/* Custom name input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && customName.trim()) onSelect(customName.trim()); }}
            placeholder="Custom name..."
            autoFocus
            className="flex-1 h-8 px-3 rounded-lg border border-[#eae6e1] text-[13px] text-[#1a1a1a] outline-none focus:border-[#e85d26]"
          />
          <button type="button" onClick={() => { if (customName.trim()) onSelect(customName.trim()); }}
            disabled={!customName.trim()}
            className="h-8 px-3 rounded-lg bg-[#e85d26] text-white text-[12px] font-semibold cursor-pointer disabled:opacity-40 hover:opacity-90 transition-opacity">
            Add
          </button>
        </div>

        <button type="button" onClick={onCancel}
          className="mt-3 w-full h-10 rounded-lg border border-[#eae6e1] text-[13px] font-medium text-[#6b6560] hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  );
}
