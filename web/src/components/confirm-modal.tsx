"use client";

import { useCallback, useEffect, useRef } from "react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus cancel button on open
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  // Close on backdrop click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onCancel();
    },
    [onCancel]
  );

  if (!open) return null;

  const isDanger = variant === "danger";

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="w-full max-w-sm mx-4 bg-surface-container-lowest rounded-2xl shadow-[0_8px_30px_rgba(31,27,23,0.12),0_2px_8px_rgba(31,27,23,0.06)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 pt-6 pb-4">
          <h2
            id="confirm-title"
            className="text-[16px] font-semibold text-on-surface"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 text-[13px] text-on-surface-variant leading-relaxed">
              {description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 px-6 pb-5">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 h-11 rounded-xl text-[13px] font-semibold text-on-surface-variant bg-surface-container-low hover:bg-surface-container transition-colors cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 h-11 rounded-xl text-[13px] font-semibold transition-colors cursor-pointer ${
              isDanger
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-brand-accent text-on-primary hover:bg-brand-accent/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
