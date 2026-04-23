import type { MoisturePin } from "./types";

export type RoomDryStatus = "dry" | "drying" | "wet" | "empty";

export interface RoomStatusCopy {
  label: string;
  colorHex: string;
}

export const ROOM_STATUS_COPY: Record<RoomDryStatus, RoomStatusCopy> = {
  dry: { label: "Dry", colorHex: "#16a34a" },
  drying: { label: "Drying", colorHex: "#d97706" },
  wet: { label: "Wet", colorHex: "#dc2626" },
  empty: { label: "—", colorHex: "#9ca3af" },
};

// Worst-pin-wins rollup. A room is "Dry" only when every pin has been
// measured AND reads green. A pin with null color (placed but no reading
// yet) counts as Drying — you can't claim dry on an unmeasured surface.
export function deriveRoomStatus(
  pins: Pick<MoisturePin, "room_id" | "color">[],
  roomId: string,
): RoomDryStatus {
  const roomPins = pins.filter((p) => p.room_id === roomId);
  if (roomPins.length === 0) return "empty";
  if (roomPins.some((p) => p.color === "red")) return "wet";
  if (roomPins.some((p) => p.color !== "green")) return "drying";
  return "dry";
}
