"use client";

/**
 * BottomSheet — shared primitive for mobile-first action modals.
 *
 * Built for spec 01K's Status Change + Closeout Checklist flows. Sticky footer
 * lives OUTSIDE the scrollable content (per web/CLAUDE.md house style) so the
 * Cancel / Confirm row never disappears under the iOS browser chrome and tall
 * forms keep the actions visible.
 *
 * - Backdrop click dismisses
 * - Escape key dismisses
 * - Drag-handle grabber at top (visual affordance, not yet draggable)
 * - Slide-up animation on open
 * - Body scroll locked while open
 * - 48px minimum tap targets via `tap` callers
 *
 * Usage:
 *
 *   <BottomSheet
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     title="Change job status"
 *     subtitle={<>1042 Maple St · currently <Badge /></>}
 *     footer={<><CancelButton /><SubmitButton /></>}
 *   >
 *     {scrollableContent}
 *   </BottomSheet>
 */

import { useEffect, useState, useCallback } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Maximum height as percentage of viewport. Default 92. */
  maxHeightPct?: number;
  /** ARIA label for the dialog. Defaults to title. */
  ariaLabel?: string;
}

function BottomSheetContent({
  onClose,
  title,
  subtitle,
  footer,
  children,
  maxHeightPct = 92,
  ariaLabel,
}: Omit<BottomSheetProps, "open">) {
  const [visible, setVisible] = useState(false);

  // Slide-up animation on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{
        backgroundColor: "rgba(26,22,18,0.42)",
        backdropFilter: "blur(2px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 200ms ease-out",
      }}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <div
        className="w-full max-w-md flex flex-col bg-background rounded-t-2xl sm:rounded-2xl border-t sm:border border-outline-variant/50"
        style={{
          maxHeight: `${maxHeightPct}vh`,
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: "transform 240ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        {/* Drag handle (grabber) — mobile-only iOS-style affordance.
            On desktop the modal is centered, so the handle is meaningless
            and reads as a stray decoration. Hide at sm: breakpoint. */}
        <div className="flex justify-center pt-2 shrink-0 sm:hidden">
          <div className="w-9 h-1 rounded-full bg-outline-variant/70" aria-hidden="true" />
        </div>

        {/* Header — title + subtitle */}
        <div className="px-5 pt-3 pb-3 shrink-0">
          <h2 className="text-[18px] font-bold tracking-[-0.01em] text-on-surface">{title}</h2>
          {subtitle && (
            <div className="mt-1.5 text-[13px] text-on-surface-variant leading-snug">
              {subtitle}
            </div>
          )}
        </div>

        {/* Divider above scroll body */}
        <div className="h-px bg-outline-variant/40 shrink-0" />

        {/* Scrollable content */}
        <div className="px-5 py-4 overflow-y-auto flex-1 scrollbar-hide">{children}</div>

        {/* Sticky footer — sits OUTSIDE scroll, never disappears */}
        {footer && (
          <div
            className="border-t border-outline-variant/40 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] shrink-0 bg-background flex gap-2.5"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * BottomSheet — conditionally mounts content when open.
 * Remount on close ensures all internal animation state resets cleanly.
 */
export function BottomSheet({ open, ...rest }: BottomSheetProps) {
  if (!open) return null;
  return <BottomSheetContent {...rest} />;
}

/* ------------------------------------------------------------------ */
/*  Common footer button atoms (use these for consistency)             */
/* ------------------------------------------------------------------ */

interface FooterButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  /** Visual prominence. cancel = ghost; primary = filled brand or status color */
  variant?: "cancel" | "primary";
  /** Background color for primary variant. Defaults to brand-accent. */
  bg?: string;
  /** Text color for primary variant. Defaults to white. */
  fg?: string;
  /** Flex grow value — Cancel typically 1, Submit typically 2. */
  flex?: number;
  type?: "button" | "submit";
}

export function SheetFooterButton({
  onClick,
  disabled,
  children,
  variant = "primary",
  bg,
  fg = "#ffffff",
  flex = 1,
  type = "button",
}: FooterButtonProps) {
  if (variant === "cancel") {
    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        className="h-12 rounded-xl border border-outline-variant/60 bg-surface-container-lowest text-[15px] font-semibold text-on-surface hover:bg-surface-container-low active:scale-[0.98] disabled:opacity-50 transition"
        style={{ flex }}
      >
        {children}
      </button>
    );
  }

  // Primary — uses provided bg/fg (typically the target status color)
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="h-12 rounded-xl text-[15px] font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 transition disabled:cursor-not-allowed"
      style={{
        flex,
        backgroundColor: disabled
          // House style for disabled per web/CLAUDE.md: muted bg, dashed border, NOT a dimmed brand button
          ? "transparent"
          : (bg ?? "var(--brand-accent)"),
        color: disabled ? "var(--on-surface-variant)" : fg,
        border: disabled ? "1px dashed color-mix(in srgb, var(--outline-variant) 50%, transparent)" : "none",
      }}
    >
      {children}
    </button>
  );
}
