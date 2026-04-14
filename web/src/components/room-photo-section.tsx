"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useUploadPhoto, useDeletePhoto } from "@/lib/hooks/use-jobs";
import { ConfirmModal } from "@/components/confirm-modal";
import { Plus, Camera, Upload } from "@/components/icons";
import type { Photo } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface RoomPhotoSectionProps {
  jobId: string;
  roomId: string;
  roomName: string;
  photos: Photo[];
  variant: "sidebar" | "card";
  directUpload?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Lightbox                                                           */
/* ------------------------------------------------------------------ */

function PhotoLightbox({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div className="relative w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.storage_url}
          alt={photo.caption || photo.filename || "Room photo"}
          className="max-w-full max-h-full rounded-lg object-contain"
        />
        {/* Close — top right of viewport */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-0 right-0 w-9 h-9 rounded-full bg-white/15 text-white flex items-center justify-center cursor-pointer active:bg-white/25"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        {/* Caption overlay */}
        {(photo.caption || photo.room_name) && (
          <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/60 to-transparent rounded-b-lg">
            <p className="text-[13px] text-white/90 font-medium truncate">
              {photo.caption || photo.room_name}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Direct upload — no staging, uploads immediately                    */
/* ------------------------------------------------------------------ */

function DirectUploadButtons({ jobId, roomId, roomName }: { jobId: string; roomId: string; roomName: string }) {
  const uploadPhoto = useUploadPhoto(jobId);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setUploading(true);
    for (let i = 0; i < fileArray.length; i++) {
      setProgress({ current: i + 1, total: fileArray.length });
      try {
        await uploadPhoto.mutateAsync({ file: fileArray[i], room_id: roomId, room_name: roomName });
      } catch (err) {
        console.error("Upload failed:", err);
        break;
      }
    }
    setUploading(false);
    setProgress(null);
  }, [uploadPhoto, roomId, roomName]);

  if (uploading && progress) {
    return (
      <div className="space-y-1.5">
        <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
          <div
            className="h-full bg-brand-accent rounded-full transition-all duration-300"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
        </div>
        <p className="text-[10px] text-on-surface-variant font-[family-name:var(--font-geist-mono)] text-center font-semibold">
          Uploading {progress.current} of {progress.total}...
        </p>
      </div>
    );
  }

  return (
    <>
      <input ref={captureRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      <input ref={galleryRef} type="file" accept="image/jpeg,image/png" multiple className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      <div className="flex gap-1.5">
        <button type="button" onClick={() => captureRef.current?.click()}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-brand-accent font-semibold bg-brand-accent/8 active:bg-brand-accent/15 transition-colors cursor-pointer">
          <Camera size={12} /> Capture
        </button>
        <button type="button" onClick={() => galleryRef.current?.click()}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-brand-accent font-semibold bg-brand-accent/8 active:bg-brand-accent/15 transition-colors cursor-pointer">
          <Upload size={12} /> Gallery
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Multi-capture panel                                                */
/* ------------------------------------------------------------------ */

function CapturePanel({
  jobId,
  roomId,
  roomName,
}: {
  jobId: string;
  roomId: string;
  roomName: string;
  onDone: () => void;
}) {
  const uploadPhoto = useUploadPhoto(jobId);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Upload files immediately when captured/selected
  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setUploading(true);
    for (let i = 0; i < fileArray.length; i++) {
      setProgress({ current: i + 1, total: fileArray.length });
      try {
        await uploadPhoto.mutateAsync({ file: fileArray[i], room_id: roomId, room_name: roomName });
      } catch (err) {
        console.error("Upload failed:", err);
        break;
      }
    }
    setUploading(false);
    setProgress(null);
  }, [uploadPhoto, roomId, roomName]);

  return (
    <div className="space-y-3">
      {/* Hidden inputs */}
      <input
        ref={captureRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />

      {/* Upload progress */}
      {uploading && progress ? (
        <div className="space-y-1.5">
          <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
            <div
              className="h-full bg-brand-accent rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-on-surface-variant font-[family-name:var(--font-geist-mono)] text-center font-semibold">
            Uploading {progress.current} of {progress.total}...
          </p>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => captureRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-brand-accent font-semibold bg-brand-accent/8 active:bg-brand-accent/15 transition-colors cursor-pointer"
          >
            <Camera size={12} />
            Capture
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-brand-accent font-semibold bg-brand-accent/8 active:bg-brand-accent/15 transition-colors cursor-pointer"
          >
            <Upload size={12} />
            Gallery
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function RoomPhotoSection({ jobId, roomId, roomName, photos, variant, directUpload = false }: RoomPhotoSectionProps) {
  const deletePhoto = useDeletePhoto(jobId);
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);

  const gridCols = variant === "sidebar" ? "grid-cols-2" : "grid-cols-3";
  const isSidebar = variant === "sidebar";

  const handleDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    deletePhoto.mutate(deleteConfirmId);
    setDeleteConfirmId(null);
  }, [deleteConfirmId, deletePhoto]);

  return (
    <div className={isSidebar ? "mb-4" : ""}>
      {/* Section label */}
      <div className="flex items-center gap-2 mb-2">
        <h3
          className={
            isSidebar
              ? "text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-[#6b6560] font-semibold"
              : "text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant font-[family-name:var(--font-geist-mono)]"
          }
        >
          Photos
        </h3>
        {photos.length > 0 && (
          <span className="text-[10px] font-[family-name:var(--font-geist-mono)] text-on-surface-variant bg-surface-container-low rounded-full px-1.5 py-px">
            {photos.length}
          </span>
        )}
      </div>

      {/* Existing photo thumbnails */}
      {photos.length > 0 && (
        <div className={`grid ${gridCols} gap-1.5 mb-2`}>
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative aspect-square rounded-lg overflow-hidden bg-surface-container-high cursor-pointer group"
              onClick={() => setLightboxPhoto(photo)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.storage_url}
                alt={photo.caption || photo.filename || "Photo"}
                loading="lazy"
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              {/* Fallback when image fails to load */}
              <div className="absolute inset-0 flex flex-col items-center justify-center p-2 pointer-events-none">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-on-surface-variant/30 mb-1">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                  <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[8px] text-on-surface-variant/40 font-[family-name:var(--font-geist-mono)] text-center leading-tight truncate w-full">
                  {photo.filename || "Photo"}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(photo.id); }}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-pointer z-10"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add photos */}
      {directUpload ? (
        <DirectUploadButtons jobId={jobId} roomId={roomId} roomName={roomName} />
      ) : showCapture ? (
        <CapturePanel
          jobId={jobId}
          roomId={roomId}
          roomName={roomName}
          onDone={() => setShowCapture(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowCapture(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-brand-accent font-semibold bg-brand-accent/8 active:bg-brand-accent/15 transition-colors cursor-pointer"
        >
          <Plus size={12} />
          Add Photos
        </button>
      )}

      {/* Lightbox */}
      {lightboxPhoto && (
        <PhotoLightbox photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteConfirmId}
        title="Delete Photo"
        description="This photo will be permanently removed from this room."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
}
