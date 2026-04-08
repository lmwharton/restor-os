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
import { ConfirmModal } from "@/components/confirm-modal";
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
      className={`flex flex-1 flex-col lg:flex-row items-center gap-1 lg:gap-2 py-3.5 lg:px-3 lg:justify-center transition-opacity ${
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
/*  Photo card (thumbnail + room name below)                           */
/* ------------------------------------------------------------------ */

function PhotoCard({ photo, isSelected, tagMode, tagChecked, onClick }: {
  photo: Photo;
  isSelected: boolean;
  tagMode: boolean;
  tagChecked: boolean;
  onClick: () => void;
}) {
  return (
    <div onClick={onClick} className="cursor-pointer group">
      <div
        className={`relative aspect-square overflow-hidden rounded-lg bg-surface-container-high transition-shadow ${
          isSelected
            ? "ring-2 ring-brand-accent"
            : tagChecked
              ? "ring-2 ring-blue-500"
              : "group-hover:shadow-md"
        }`}
      >
        <img
          src={photo.storage_url}
          alt={photo.room_name || "Job photo"}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
        {/* Tag mode checkbox */}
        {tagMode && (
          <span className={`absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded ${
            tagChecked ? "bg-blue-500" : "bg-inverse-surface/40 border border-white/60"
          }`}>
            {tagChecked && <Check size={12} className="text-white" />}
          </span>
        )}
        {/* AI selected badge */}
        {!tagMode && photo.selected_for_ai && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-accent">
            <Check size={10} className="text-on-primary" />
          </span>
        )}
      </div>
      {/* Room name below image */}
      <p className="mt-1 text-[10px] text-on-surface-variant text-center truncate">
        {photo.room_name || "Untagged"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile bottom sheet for photo editing                              */
/* ------------------------------------------------------------------ */

const SELECT_CHEVRON_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238d7168' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;
const selectStyle = { backgroundImage: SELECT_CHEVRON_SVG, backgroundRepeat: 'no-repeat' as const, backgroundPosition: 'right 10px center' };

function MobilePhotoSheet({
  photo,
  rooms,
  editState,
  editDirty,
  isSaving,
  isDeleting,
  onEditChange,
  onSave,
  onDelete,
  onToggleAI,
  onClose,
}: {
  photo: Photo;
  rooms: { id: string; room_name: string }[];
  editState: { room_id?: string; room_name?: string; photo_type?: PhotoType; caption?: string };
  editDirty: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onEditChange: (updates: Partial<typeof editState>) => void;
  onSave: () => void;
  onDelete: () => void;
  onToggleAI: () => void;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; currentY: number; dragging: boolean }>({ startY: 0, currentY: 0, dragging: false });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current = { startY: e.touches[0].clientY, currentY: e.touches[0].clientY, dragging: true };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current.dragging || !sheetRef.current) return;
    const dy = e.touches[0].clientY - dragRef.current.startY;
    if (dy > 0) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
      dragRef.current.currentY = e.touches[0].clientY;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!sheetRef.current) return;
    const dy = dragRef.current.currentY - dragRef.current.startY;
    dragRef.current.dragging = false;
    if (dy > 100) {
      onClose();
    } else {
      sheetRef.current.style.transform = 'translateY(0)';
    }
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-inverse-surface/40" />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-0 inset-x-0 bg-surface-container-lowest rounded-t-2xl shadow-[0_-4px_24px_rgba(31,27,23,0.12)] max-h-[85vh] overflow-y-auto transition-transform duration-200"
        style={{ transform: 'translateY(0)' }}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-outline-variant/40" />
        </div>

        <div className="px-5 pb-8 space-y-4">
          {/* Photo preview + filename row */}
          <div className="flex gap-3 items-start">
            <div className="w-20 h-20 rounded-lg bg-surface-container-high overflow-hidden shrink-0">
              <img
                src={photo.storage_url}
                alt={photo.room_name || "Photo"}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <p className="text-[12px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant truncate">
                {photo.filename ?? "Untitled"}
              </p>
              <p className="text-[11px] text-on-surface-variant/60 mt-0.5">
                {photo.room_name || "Untagged"}
              </p>
            </div>
          </div>

          {/* Room */}
          <div>
            <label className="block text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1.5 font-semibold">
              Room
            </label>
            <select
              className="w-full h-11 px-3 pr-8 rounded-lg bg-surface-container-low text-[14px] text-on-surface outline-none focus:ring-2 focus:ring-brand-accent/30 appearance-none"
              style={selectStyle}
              value={editState.room_id ?? ""}
              onChange={(e) => {
                const roomId = e.target.value || undefined;
                const roomName = rooms.find((r) => r.id === roomId)?.room_name;
                onEditChange({ room_id: roomId, room_name: roomName });
              }}
            >
              <option value="">Untagged</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.room_name}</option>
              ))}
            </select>
          </div>

          {/* Type */}
          <div>
            <label className="block text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1.5 font-semibold">
              Type
            </label>
            <select
              className="w-full h-11 px-3 pr-8 rounded-lg bg-surface-container-low text-[14px] text-on-surface outline-none focus:ring-2 focus:ring-brand-accent/30 appearance-none"
              style={selectStyle}
              value={editState.photo_type ?? "damage"}
              onChange={(e) => onEditChange({ photo_type: e.target.value as PhotoType })}
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
              rows={2}
              placeholder="Add a caption..."
              value={editState.caption ?? ""}
              onChange={(e) => onEditChange({ caption: e.target.value })}
              onFocus={(e) => e.target.select()}
              className="w-full px-3 py-2.5 rounded-lg bg-surface-container-low text-[14px] text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:ring-2 focus:ring-brand-accent/30 resize-none"
            />
          </div>

          {/* AI toggle */}
          <div className="flex items-center justify-between py-1">
            <span className="text-[13px] font-medium text-on-surface">Include in AI Scope</span>
            <button
              type="button"
              onClick={onToggleAI}
              className={`w-11 h-7 rounded-full flex items-center px-1 cursor-pointer transition-colors ${
                photo.selected_for_ai ? "bg-brand-accent" : "bg-surface-dim"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                  photo.selected_for_ai ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Save + Delete */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onSave}
              disabled={!editDirty || isSaving}
              className="flex-1 h-12 rounded-xl text-[14px] font-semibold text-on-primary bg-brand-accent active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              className="flex-1 h-12 rounded-xl text-[14px] font-medium text-red-600 border border-red-200 active:bg-red-50 transition-colors disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [mobileSheetPhotoId, setMobileSheetPhotoId] = useState<string | null>(null);

  const mobileSheetPhoto = useMemo(() => {
    if (!mobileSheetPhotoId) return null;
    return photos.find((p) => p.id === mobileSheetPhotoId) ?? null;
  }, [mobileSheetPhotoId, photos]);

  /* Mobile sheet edit state (separate from desktop) */
  const [mobileEditState, setMobileEditState] = useState<{
    room_id?: string;
    room_name?: string;
    photo_type?: PhotoType;
    caption?: string;
  } | null>(null);
  const [mobileEditDirty, setMobileEditDirty] = useState(false);

  // Init mobile edit state when sheet opens
  useMemo(() => {
    if (mobileSheetPhoto) {
      setMobileEditState({
        room_id: mobileSheetPhoto.room_id ?? undefined,
        room_name: mobileSheetPhoto.room_name ?? undefined,
        photo_type: mobileSheetPhoto.photo_type as PhotoType,
        caption: mobileSheetPhoto.caption ?? "",
      });
      setMobileEditDirty(false);
    } else {
      setMobileEditState(null);
    }
  }, [mobileSheetPhoto?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMobileSave = useCallback(() => {
    if (!mobileSheetPhoto || !mobileEditState) return;
    setError(null);
    updatePhoto.mutate({
      photoId: mobileSheetPhoto.id,
      room_id: mobileEditState.room_id,
      room_name: mobileEditState.room_name,
      photo_type: mobileEditState.photo_type,
      caption: mobileEditState.caption,
    }, {
      onSuccess: () => {
        setMobileEditDirty(false);
        setMobileSheetPhotoId(null);
      },
      onError: (err) => setError(err instanceof Error ? err.message : "Failed to save changes"),
    });
  }, [mobileSheetPhoto, mobileEditState, updatePhoto]);

  const [showMobileDeleteConfirm, setShowMobileDeleteConfirm] = useState(false);

  /* Tag Rooms mode — multi-select photos and assign to a room */
  const [tagMode, setTagMode] = useState(false);
  const [tagSelectedIds, setTagSelectedIds] = useState<Set<string>>(new Set());
  const [tagSaving, setTagSaving] = useState(false);

  const toggleTagPhoto = useCallback((photoId: string) => {
    setTagSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  const handleAssignRoom = useCallback(async (roomId: string | null) => {
    if (tagSelectedIds.size === 0) return;
    setTagSaving(true);
    setError(null);
    const roomName = roomId ? rooms.find((r) => r.id === roomId)?.room_name : undefined;
    try {
      for (const photoId of tagSelectedIds) {
        await updatePhoto.mutateAsync({
          photoId,
          room_id: roomId ?? undefined,
          room_name: roomName,
        });
      }
      setTagSelectedIds(new Set());
      setTagMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to tag photos");
    } finally {
      setTagSaving(false);
    }
  }, [tagSelectedIds, rooms, updatePhoto]);

  /* Upload state */
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);

  /* Photo detail edit state — only save on explicit Save click */
  const [editState, setEditState] = useState<{
    room_id?: string;
    room_name?: string;
    photo_type?: PhotoType;
    caption?: string;
  } | null>(null);
  const [editDirty, setEditDirty] = useState(false);

  const selectedPhoto = useMemo(() => {
    if (!selectedPhotoId) return null;
    return photos.find((p) => p.id === selectedPhotoId) ?? null;
  }, [selectedPhotoId, photos]);

  // Reset edit state when selected photo changes
  useMemo(() => {
    if (selectedPhoto) {
      setEditState({
        room_id: selectedPhoto.room_id ?? undefined,
        room_name: selectedPhoto.room_name ?? undefined,
        photo_type: selectedPhoto.photo_type as PhotoType,
        caption: selectedPhoto.caption ?? "",
      });
      setEditDirty(false);
    } else {
      setEditState(null);
    }
  }, [selectedPhoto?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveDetails = useCallback(() => {
    if (!selectedPhoto || !editState) return;
    setError(null);
    updatePhoto.mutate({
      photoId: selectedPhoto.id,
      room_id: editState.room_id,
      room_name: editState.room_name,
      photo_type: editState.photo_type,
      caption: editState.caption,
    }, {
      onSuccess: () => setEditDirty(false),
      onError: (err) => setError(err instanceof Error ? err.message : "Failed to save changes"),
    });
  }, [selectedPhoto, editState, updatePhoto]);

  // Upload files directly (no confirmation modal — user already clicked Upload)
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
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (captureInputRef.current) captureInputRef.current.value = "";
    },
    [uploadPhoto]
  );

  const isLoading = photosLoading || roomsLoading;
  const isUploading = uploadProgress !== null;

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

  const maxPhotos = 100;

  return (
    <div className="min-h-dvh bg-surface">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 lg:max-w-6xl lg:mx-auto">
          <Link
            href={`/jobs/${jobId}`}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-surface-container-low active:bg-surface-container-high transition-colors"
            aria-label="Back to job"
          >
            <ArrowBack size={20} className="text-on-surface-variant" />
          </Link>
          <h1 className="flex-1 text-lg font-semibold text-on-surface">
            Photos
          </h1>
          <span className="rounded-md bg-surface-container-low px-2.5 py-1 font-mono text-xs text-on-surface-variant tabular-nums">
            {photos.length}/{maxPhotos}
          </span>
        </div>

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

      {/* ─── Main content ──────────────────────────────────────── */}
      <main className="px-4 pb-8 mt-2 lg:max-w-6xl lg:mx-auto lg:grid lg:grid-cols-[1fr_288px] lg:gap-6">
        {/* ─── Left column ─────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Toolbar card */}
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] overflow-hidden">
            <div className="flex items-stretch divide-x divide-outline-variant/15">
              <ToolbarButton
                label="Tag Rooms"
                icon={<Tag size={20} />}
                accent={tagMode}
                onClick={() => {
                  setTagMode((prev) => !prev);
                  setTagSelectedIds(new Set());
                }}
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
          </section>

          {/* Upload progress */}
          {uploadProgress && (
            <div className="rounded-xl bg-surface-container-lowest shadow-[0_1px_3px_rgba(31,27,23,0.04)] px-5 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[12px] font-medium text-on-surface">
                  {uploadProgress.current === uploadProgress.total
                    ? "Upload complete"
                    : `Uploading ${uploadProgress.current} of ${uploadProgress.total}...`}
                </p>
                <span className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant">
                  {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-surface-container-high overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-accent transition-all duration-300"
                  style={{
                    width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Room filter pills */}
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
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

            {roomFilters.untaggedCount > 0 && (
              <button
                onClick={() => setSelectedRoom("untagged")}
                className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-colors flex items-center gap-1.5 ${
                  selectedRoom === "untagged"
                    ? "bg-brand-accent text-on-primary"
                    : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                Untagged ({roomFilters.untaggedCount})
              </button>
            )}

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

          {/* Error banner */}
          {error && (
            <div className="rounded-lg bg-error-container/20 border border-error/20 px-4 py-3 text-sm text-error flex items-center justify-between">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} className="text-error/60 hover:text-error ml-3 text-xs font-semibold cursor-pointer">Dismiss</button>
            </div>
          )}

          {/* Photo grid card */}
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-5">
            {isLoading ? (
              <div className="grid grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-4">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-lg bg-surface-container-high animate-pulse" />
                ))}
              </div>
            ) : filteredPhotos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant/60">
                <Camera size={32} />
                <p className="mt-2 text-sm">No photos yet</p>
                <p className="mt-1 text-xs italic text-on-surface-variant/50">
                  Tip: Take 5 photos per room — floor, each wall, and ceiling
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 lg:grid-cols-5 gap-3 lg:gap-4">
                {filteredPhotos.map((photo) => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    isSelected={!tagMode && selectedPhotoId === photo.id}
                    tagMode={tagMode}
                    tagChecked={tagSelectedIds.has(photo.id)}
                    onClick={() => {
                      if (tagMode) {
                        toggleTagPhoto(photo.id);
                      } else {
                        // Desktop: select for sidebar. Mobile: open bottom sheet.
                        const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
                        if (isDesktop) {
                          setSelectedPhotoId(photo.id);
                        } else {
                          setMobileSheetPhotoId(photo.id);
                        }
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ─── Right column: detail panel / tag panel ─────────── */}
        <div className="hidden lg:block lg:sticky lg:top-20 lg:self-start min-w-0">
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)] p-4">
            {tagMode ? (
              /* ── Tag Rooms panel ─────────────────────────────── */
              <div className="space-y-4">
                <div>
                  <h3 className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em] font-semibold text-on-surface-variant">
                    Tag Rooms
                  </h3>
                  <p className="text-[22px] font-bold text-on-surface mt-1">
                    {tagSelectedIds.size} <span className="text-[14px] font-normal text-on-surface-variant">photo{tagSelectedIds.size !== 1 ? "s" : ""} selected</span>
                  </p>
                </div>

                {tagSelectedIds.size > 0 && rooms.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-2 font-semibold">
                      Assign to
                    </label>
                    <div className="space-y-1.5">
                      {rooms.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          disabled={tagSaving}
                          onClick={() => handleAssignRoom(r.id)}
                          className="w-full h-10 px-3 rounded-lg text-[13px] font-medium text-left bg-surface-container-low text-on-surface hover:bg-brand-accent hover:text-on-primary transition-colors cursor-pointer disabled:opacity-40"
                        >
                          {r.room_name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {tagSelectedIds.size === 0 && (
                  <p className="text-[13px] text-on-surface-variant leading-relaxed">
                    Click photos to select them, then pick a room to assign.
                  </p>
                )}

                {rooms.length === 0 && tagSelectedIds.size > 0 && (
                  <p className="text-[13px] text-on-surface-variant/60 italic">
                    No rooms yet — add rooms from the job detail page first.
                  </p>
                )}
              </div>
            ) : selectedPhoto && editState ? (
              <div className="space-y-3">
                {/* Photo preview */}
                <div className="aspect-square rounded-xl bg-surface-container-high flex items-center justify-center overflow-hidden">
                  <img
                    src={selectedPhoto.storage_url}
                    alt={selectedPhoto.room_name || "Selected photo"}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Filename */}
                <p className="text-[11px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant truncate">
                  {selectedPhoto.filename ?? "Untitled"}
                </p>

                {/* Room dropdown */}
                <div>
                  <label className="block text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-1.5 font-semibold">
                    Room
                  </label>
                  <select
                    className="w-full h-9 px-3 pr-8 rounded-lg bg-surface-container-low text-[13px] text-on-surface outline-none focus:ring-2 focus:ring-brand-accent/30 appearance-none"
                    style={selectStyle}
                    value={editState.room_id ?? ""}
                    onChange={(e) => {
                      const roomId = e.target.value || undefined;
                      const roomName = rooms.find((r) => r.id === roomId)?.room_name;
                      setEditState((prev) => prev ? { ...prev, room_id: roomId, room_name: roomName } : prev);
                      setEditDirty(true);
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
                    className="w-full h-9 px-3 pr-8 rounded-lg bg-surface-container-low text-[13px] text-on-surface outline-none focus:ring-2 focus:ring-brand-accent/30 appearance-none"
                    style={selectStyle}
                    value={editState.photo_type ?? "damage"}
                    onChange={(e) => {
                      setEditState((prev) => prev ? { ...prev, photo_type: e.target.value as PhotoType } : prev);
                      setEditDirty(true);
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
                    rows={2}
                    placeholder="Add a caption..."
                    value={editState.caption ?? ""}
                    onChange={(e) => {
                      setEditState((prev) => prev ? { ...prev, caption: e.target.value } : prev);
                      setEditDirty(true);
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-surface-container-low text-[13px] text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:ring-2 focus:ring-brand-accent/30 resize-none"
                  />
                </div>

                {/* AI selection toggle */}
                <div className="flex items-center justify-between py-1">
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

                {/* Save + Delete row */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleSaveDetails}
                    disabled={!editDirty || updatePhoto.isPending}
                    className="flex-1 h-9 rounded-lg text-[13px] font-semibold text-on-primary bg-brand-accent cursor-pointer transition-all hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {updatePhoto.isPending ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deletePhoto.isPending}
                    className="flex-1 h-9 rounded-lg text-[13px] font-medium text-red-600 border border-red-200 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {deletePhoto.isPending ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Camera size={24} className="text-on-surface-variant/40" />
                <p className="mt-2 text-sm text-on-surface-variant">
                  Select a photo to edit details
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* ─── Mobile tag mode bottom bar ────────────────────────── */}
      {tagMode && (
        <div className="fixed bottom-0 inset-x-0 z-20 lg:hidden pb-[env(safe-area-inset-bottom)]">
          <div className="bg-surface-container-lowest border-t border-outline-variant/15 px-4 pt-3 pb-4 mb-[68px] md:mb-0">
            <p className="text-[12px] font-medium text-on-surface-variant mb-2">
              {tagSelectedIds.size === 0
                ? "Select photos to tag"
                : `${tagSelectedIds.size} photo${tagSelectedIds.size > 1 ? "s" : ""} selected`}
            </p>
            <div className="flex gap-2 overflow-x-auto scrollbar-none">
              {rooms.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={tagSelectedIds.size === 0 || tagSaving}
                  onClick={() => handleAssignRoom(r.id)}
                  className="shrink-0 h-10 px-5 rounded-lg text-[13px] font-medium bg-surface-container-low text-on-surface active:bg-brand-accent active:text-on-primary transition-colors disabled:opacity-30"
                >
                  {r.room_name}
                </button>
              ))}
              {rooms.length === 0 && (
                <p className="text-[12px] text-on-surface-variant/60 italic">
                  Add rooms from job detail first
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Mobile photo edit sheet ────────────────────────────── */}
      {mobileSheetPhoto && mobileEditState && (
        <MobilePhotoSheet
          photo={mobileSheetPhoto}
          rooms={rooms}
          editState={mobileEditState}
          editDirty={mobileEditDirty}
          isSaving={updatePhoto.isPending}
          isDeleting={deletePhoto.isPending}
          onEditChange={(updates) => {
            setMobileEditState((prev) => prev ? { ...prev, ...updates } : prev);
            setMobileEditDirty(true);
          }}
          onSave={handleMobileSave}
          onDelete={() => setShowMobileDeleteConfirm(true)}
          onToggleAI={() => {
            updatePhoto.mutate({
              photoId: mobileSheetPhoto.id,
              selected_for_ai: !mobileSheetPhoto.selected_for_ai,
            });
          }}
          onClose={() => setMobileSheetPhotoId(null)}
        />
      )}

      {/* ─── Delete confirmation modal (desktop) ──────────────── */}
      <ConfirmModal
        open={showDeleteConfirm}
        title="Delete this photo?"
        description="This action cannot be undone. The photo will be permanently removed from this job."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={async () => {
          if (!selectedPhoto) return;
          setShowDeleteConfirm(false);
          try {
            setError(null);
            await deletePhoto.mutateAsync(selectedPhoto.id);
            setSelectedPhotoId(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete photo");
          }
        }}
      />

      {/* ─── Delete confirmation modal (mobile) ───────────────── */}
      <ConfirmModal
        open={showMobileDeleteConfirm}
        title="Delete this photo?"
        description="This action cannot be undone. The photo will be permanently removed from this job."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onCancel={() => setShowMobileDeleteConfirm(false)}
        onConfirm={async () => {
          if (!mobileSheetPhoto) return;
          setShowMobileDeleteConfirm(false);
          try {
            setError(null);
            await deletePhoto.mutateAsync(mobileSheetPhoto.id);
            setMobileSheetPhotoId(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete photo");
          }
        }}
      />
    </div>
  );
}
