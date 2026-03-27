"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePhotos, useRooms, useUpdatePhoto, useDeletePhoto } from "@/lib/hooks/use-jobs";
import {
  ArrowBack,
  Shield,
  Tag,
  Sparkle,
  Camera,
  Upload,
  Check,
} from "@/components/icons";
import type { Photo } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Toolbar button                                                     */
/* ------------------------------------------------------------------ */

interface ToolbarAction {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  accent?: boolean;
}

function ToolbarButton({ label, icon, disabled, accent }: ToolbarAction) {
  return (
    <button
      disabled={disabled}
      className={`flex flex-1 flex-col lg:flex-row items-center gap-1 lg:gap-2 py-2 lg:px-3 lg:justify-center transition-opacity ${
        disabled
          ? "opacity-40 cursor-not-allowed"
          : accent
            ? "text-brand-accent"
            : "text-on-surface-variant hover:text-on-surface"
      }`}
    >
      {icon}
      <span className="font-mono text-[10px] lg:text-[11px] uppercase tracking-wider">
        {label}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Photo thumbnail                                                    */
/* ------------------------------------------------------------------ */

function PhotoThumbnail({ photo }: { photo: Photo }) {
  const isUntagged = !photo.room_id;

  return (
    <div
      className={`relative aspect-square overflow-hidden rounded-lg bg-surface-container-high ${
        isUntagged ? "border-2 border-dashed border-brand-accent/40" : ""
      }`}
    >
      {/* Photo image */}
      <img
        src={photo.storage_url}
        alt={photo.room_name || "Job photo"}
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
      />

      {/* Room label at bottom */}
      {photo.room_name && (
        <span className="absolute bottom-0 left-0 right-0 bg-inverse-surface/70 text-inverse-on-surface text-[10px] px-2 py-0.5 rounded text-center truncate">
          {photo.room_name}
        </span>
      )}

      {/* AI selected badge */}
      {photo.selected_for_ai && (
        <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-accent">
          <Check size={10} className="text-on-primary" />
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function PhotosPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const { data: photos = [] } = usePhotos(jobId);
  const { data: rooms = [] } = useRooms(jobId);
  const updatePhoto = useUpdatePhoto(jobId);
  const deletePhoto = useDeletePhoto(jobId);

  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  const selectedPhoto = useMemo(() => {
    if (!selectedPhotoId) return null;
    return photos.find((p) => p.id === selectedPhotoId) ?? null;
  }, [selectedPhotoId, photos]);

  /* Build filter pills from room data */
  const roomFilters = useMemo(() => {
    const untaggedCount = photos.filter((p) => !p.room_id).length;

    const roomCounts = rooms.map((r) => ({
      id: r.id,
      label: r.room_name,
      count: photos.filter((p) => p.room_id === r.id).length,
    }));

    return { untaggedCount, roomCounts, total: photos.length };
  }, [photos, rooms]);

  /* Filter photos by selected room */
  const filteredPhotos = useMemo(() => {
    if (selectedRoom === null) return photos;
    if (selectedRoom === "untagged") return photos.filter((p) => !p.room_id);
    return photos.filter((p) => p.room_id === selectedRoom);
  }, [photos, selectedRoom]);

  /* Max photos */
  const maxPhotos = 100;

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 pt-4 pb-2">
        <Link
          href={`/jobs/${jobId}`}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-low text-on-surface-variant transition-colors hover:bg-surface-container"
        >
          <ArrowBack size={18} />
        </Link>
        <h1 className="flex-1 text-lg font-semibold text-on-surface">
          Photos
        </h1>
        <span className="rounded-md bg-surface-container-low px-2.5 py-1 font-mono text-xs text-on-surface-variant tabular-nums">
          {photos.length}/{maxPhotos}
        </span>
      </header>

      {/* ─── Toolbar ────────────────────────────────────────────── */}
      <div className="flex items-stretch px-4 py-1">
        <ToolbarButton
          label="Hazard"
          icon={<Shield size={20} />}
          disabled
        />
        <ToolbarButton
          label="Tag Rooms"
          icon={<Tag size={20} />}
        />
        <ToolbarButton
          label="AI Scope"
          icon={<Sparkle size={20} />}
          disabled
        />
        <ToolbarButton
          label="Capture"
          icon={<Camera size={20} />}
          accent
        />
        <ToolbarButton
          label="Upload"
          icon={<Upload size={20} />}
        />
      </div>

      {/* ─── Room filter pills ──────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-none">
        {/* All */}
        <button
          onClick={() => setSelectedRoom(null)}
          className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
            selectedRoom === null
              ? "bg-brand-accent text-on-primary"
              : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
          }`}
        >
          All ({roomFilters.total})
        </button>

        {/* Untagged */}
        {roomFilters.untaggedCount > 0 && (
          <button
            onClick={() => setSelectedRoom("untagged")}
            className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-colors flex items-center gap-1.5 ${
              selectedRoom === "untagged"
                ? "bg-brand-accent text-on-primary"
                : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
            }`}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400"
              aria-hidden
            />
            Untagged ({roomFilters.untaggedCount})
          </button>
        )}

        {/* Per-room */}
        {roomFilters.roomCounts.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedRoom(r.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
              selectedRoom === r.id
                ? "bg-brand-accent text-on-primary"
                : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
            }`}
          >
            {r.label} ({r.count})
          </button>
        ))}
      </div>

      {/* ─── Photo grid + detail panel ─────────────────────────── */}
      <div className="flex-1 px-4 pb-4 lg:grid lg:grid-cols-[1fr_288px] lg:gap-6">
        {/* Grid */}
        <div>
          {filteredPhotos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant/60">
              <Camera size={32} />
              <p className="mt-2 text-sm">No photos yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3">
              {filteredPhotos.map((photo) => (
                <div
                  key={photo.id}
                  onClick={() => setSelectedPhotoId(photo.id)}
                  className={`cursor-pointer rounded-lg transition-all ${
                    selectedPhotoId === photo.id
                      ? "ring-2 ring-brand-accent ring-offset-2 ring-offset-surface"
                      : ""
                  }`}
                >
                  <PhotoThumbnail photo={photo} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Desktop detail panel */}
        <div className="hidden lg:block">
          <div className="sticky top-20 bg-surface-container-lowest rounded-2xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4">
            {selectedPhoto ? (
              <div className="space-y-4">
                {/* Photo preview */}
                <div className="aspect-square rounded-xl bg-surface-container-high flex items-center justify-center overflow-hidden">
                  <img
                    src={selectedPhoto.storage_url}
                    alt={selectedPhoto.room_name || "Selected photo"}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Filename */}
                <p className="text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant truncate">
                  {selectedPhoto.filename ?? "Untitled"}
                </p>

                {/* Room dropdown */}
                <div>
                  <label className="block text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1.5 font-semibold">
                    Room
                  </label>
                  <select
                    className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-sm text-on-surface outline-none focus:ring-2 focus:ring-brand-accent/30"
                    value={selectedPhoto.room_id ?? ""}
                    onChange={(e) => {
                      const roomId = e.target.value || undefined;
                      const roomName = rooms.find((r) => r.id === roomId)?.room_name;
                      updatePhoto.mutate({
                        photoId: selectedPhoto.id,
                        room_id: roomId,
                        room_name: roomName,
                      });
                    }}
                  >
                    <option value="">Untagged</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.room_name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Type dropdown */}
                <div>
                  <label className="block text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1.5 font-semibold">
                    Type
                  </label>
                  <select
                    className="w-full h-10 px-3 rounded-lg bg-surface-container-low text-sm text-on-surface outline-none focus:ring-2 focus:ring-brand-accent/30"
                    value={selectedPhoto.photo_type}
                    onChange={(e) => {
                      updatePhoto.mutate({
                        photoId: selectedPhoto.id,
                        photo_type: e.target.value,
                      });
                    }}
                  >
                    <option value="damage">Damage</option>
                    <option value="equipment">Equipment</option>
                    <option value="protection">Protection</option>
                    <option value="containment">Containment</option>
                    <option value="moisture_reading">Moisture Reading</option>
                    <option value="before">Before</option>
                    <option value="after">After</option>
                  </select>
                </div>

                {/* Caption */}
                <div>
                  <label className="block text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1.5 font-semibold">
                    Caption
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Add a caption..."
                    defaultValue={selectedPhoto.caption ?? ""}
                    key={selectedPhoto.id}
                    onBlur={(e) => {
                      if (e.target.value !== (selectedPhoto.caption ?? "")) {
                        updatePhoto.mutate({
                          photoId: selectedPhoto.id,
                          caption: e.target.value,
                        });
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-surface-container-low text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:ring-2 focus:ring-brand-accent/30 resize-none"
                  />
                </div>

                {/* AI selection toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-on-surface">Include in AI Scope</span>
                  <button
                    type="button"
                    onClick={() => {
                      updatePhoto.mutate({
                        photoId: selectedPhoto.id,
                        selected_for_ai: !selectedPhoto.selected_for_ai,
                      });
                    }}
                    className={`w-10 h-6 rounded-full flex items-center px-1 cursor-pointer transition-colors ${
                      selectedPhoto.selected_for_ai ? "bg-brand-accent" : "bg-surface-dim"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                        selectedPhoto.selected_for_ai ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Delete */}
                <button
                  type="button"
                  onClick={async () => {
                    if (window.confirm("Delete this photo?")) {
                      await deletePhoto.mutateAsync(selectedPhoto.id);
                      setSelectedPhotoId(null);
                    }
                  }}
                  disabled={deletePhoto.isPending}
                  className="text-[12px] text-error hover:underline cursor-pointer disabled:opacity-50"
                >
                  {deletePhoto.isPending ? "Deleting..." : "Delete photo"}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Camera size={24} className="text-on-surface-variant/40" />
                <p className="mt-2 text-sm text-on-surface-variant">
                  Select a photo to edit details
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Bottom tip ─────────────────────────────────────────── */}
      <div className="px-6 pb-6 pt-2 text-center">
        <p className="text-xs italic text-on-surface-variant/50">
          Tip: Take 5 photos per room — floor, each wall, and ceiling
        </p>
      </div>
    </div>
  );
}
