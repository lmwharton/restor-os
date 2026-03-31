"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePhotos, useRooms, useUpdatePhoto, useDeletePhoto, useUploadPhoto } from "@/lib/hooks/use-jobs";
import {
  ArrowBack,
  Tag,
  Camera,
  Upload,
  Check,
} from "@/components/icons";
import type { Photo, PhotoType } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Toolbar button                                                     */
/* ------------------------------------------------------------------ */

interface ToolbarAction {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  accent?: boolean;
  onClick?: () => void;
}

function ToolbarButton({ label, icon, disabled, accent, onClick }: ToolbarAction) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
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
  const { data: photos = [], isLoading: photosLoading } = usePhotos(jobId);
  const { data: rooms = [], isLoading: roomsLoading } = useRooms(jobId);
  const updatePhoto = useUpdatePhoto(jobId);
  const deletePhoto = useDeletePhoto(jobId);
  const uploadPhoto = useUploadPhoto(jobId);

  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Upload state */
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);
      const fileArray = Array.from(files);
      setUploadProgress({ current: 0, total: fileArray.length });

      for (let i = 0; i < fileArray.length; i++) {
        setUploadProgress({ current: i + 1, total: fileArray.length });
        try {
          await uploadPhoto.mutateAsync(fileArray[i]);
        } catch (err) {
          setError(
            `Failed to upload ${fileArray[i].name}: ${err instanceof Error ? err.message : "Unknown error"}`
          );
          break;
        }
      }
      setUploadProgress(null);
      // Reset file inputs so re-selecting the same file triggers onChange
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (captureInputRef.current) captureInputRef.current.value = "";
    },
    [uploadPhoto]
  );

  const isLoading = photosLoading || roomsLoading;
  const isUploading = uploadProgress !== null;

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

      {/* ─── Hidden file inputs ────────────────────────────────── */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={captureInputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* ─── Toolbar ────────────────────────────────────────────── */}
      <div className="flex items-stretch px-4 py-1">
        <ToolbarButton
          label="Tag Rooms"
          icon={<Tag size={20} />}
          disabled
        />
        <ToolbarButton
          label="Capture"
          icon={<Camera size={20} />}
          accent
          disabled={isUploading}
          onClick={() => captureInputRef.current?.click()}
        />
        <ToolbarButton
          label="Upload"
          icon={<Upload size={20} />}
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        />
      </div>

      {/* ─── Upload progress ──────────────────────────────────── */}
      {uploadProgress && (
        <div className="mx-4 mb-1">
          <div className="flex items-center gap-3 rounded-lg bg-surface-container-low px-4 py-2.5">
            <div className="flex-1">
              <p className="text-[12px] font-medium text-on-surface">
                Uploading {uploadProgress.current} of {uploadProgress.total}...
              </p>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-accent transition-all duration-300"
                  style={{
                    width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* ─── Error banner ───────────────────────────────────────── */}
      {error && (
        <div className="mx-4 mb-2 rounded-lg bg-error-container/20 border border-error/20 px-4 py-3 text-sm text-error flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-error/60 hover:text-error ml-3 text-xs font-semibold cursor-pointer">Dismiss</button>
        </div>
      )}

      {/* ─── Photo grid + detail panel ─────────────────────────── */}
      <div className="flex-1 px-4 pb-4 lg:grid lg:grid-cols-[1fr_288px] lg:gap-6">
        {/* Grid */}
        <div>
          {isLoading ? (
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-lg bg-surface-container-high animate-pulse" />
              ))}
            </div>
          ) : filteredPhotos.length === 0 ? (
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
                      setError(null);
                      const roomId = e.target.value || undefined;
                      const roomName = rooms.find((r) => r.id === roomId)?.room_name;
                      updatePhoto.mutate({
                        photoId: selectedPhoto.id,
                        room_id: roomId,
                        room_name: roomName,
                      }, {
                        onError: (err) => setError(err instanceof Error ? err.message : "Failed to update photo"),
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
                      setError(null);
                      updatePhoto.mutate({
                        photoId: selectedPhoto.id,
                        photo_type: e.target.value as PhotoType,
                      }, {
                        onError: (err) => setError(err instanceof Error ? err.message : "Failed to update photo"),
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
                        setError(null);
                        updatePhoto.mutate({
                          photoId: selectedPhoto.id,
                          caption: e.target.value,
                        }, {
                          onError: (err) => setError(err instanceof Error ? err.message : "Failed to update caption"),
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
                      setError(null);
                      updatePhoto.mutate({
                        photoId: selectedPhoto.id,
                        selected_for_ai: !selectedPhoto.selected_for_ai,
                      }, {
                        onError: (err) => setError(err instanceof Error ? err.message : "Failed to update photo"),
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
                      try {
                        setError(null);
                        await deletePhoto.mutateAsync(selectedPhoto.id);
                        setSelectedPhotoId(null);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to delete photo");
                      }
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
