"use client";

/**
 * BottomSheet — shared primitive for mobile-first action modals.
 *
 * Built for spec 01K's Status Change + Closeout Checklist flows. Sticky footer
 * lives OUTSIDE the scrollable content (per web/CLAUDE.md house style) so the
 * Cancel / Confirm row never disappears under the iOS browser chrome and tall
 * forms keep the actions visible.
 *
 * Behavior matrix:
 *   mobile (< sm)         desktop (>= sm)
 *   ─────────────────     ─────────────────
 *   slides up from        fades + scales in
 *   bottom edge           centered dialog
 *   drag handle visible   handle hidden, X close button visible
 *   drag-to-dismiss       click backdrop / Escape / X
 *   safe-area aware       comfortable margins
 *
 * Both modes share:
 *   • Backdrop click dismisses
 *   • Escape key dismisses
 *   • Body scroll locked
 *   • Sticky footer outside scroll
 *   • 48px minimum tap targets via `tap` callers
 *   • --sheet-duration / --sheet-ease CSS tokens drive timing in lockstep
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

import { useEffect, useRef, useState, useCallback } from "react";

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

/** Dismiss when drag exceeds this many px past the panel top edge. */
const DRAG_DISMISS_THRESHOLD_PX = 100;

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
  // Live drag offset in px — only non-zero while user is dragging.
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const scrollBodyRef = useRef<HTMLDivElement>(null);
  // Touch tracking refs — refs (not state) so handlers don't rebind every frame.
  const touchStartYRef = useRef<number | null>(null);
  // Lock-in flag: once we decide a gesture is a sheet-drag (vs an inner scroll)
  // we keep dragging even if scrollTop changes mid-gesture.
  const dragLockedRef = useRef(false);

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

  // ── Drag-to-dismiss (mobile) ────────────────────────────────────────
  // Touch events naturally don't fire from mouse on desktop, so we don't
  // gate by breakpoint. The drag handle is hidden at sm: anyway.
  //
  // Rule: only treat a drag as a sheet-dismiss if the inner scroll body is
  // at scrollTop === 0. If the user is mid-scroll inside the body, gestures
  // belong to the scroller. Once a sheet-drag has started, we lock it in
  // until touchend so a fling doesn't accidentally hand off to the scroller.
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchStartYRef.current = e.touches[0].clientY;
    dragLockedRef.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartYRef.current === null || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - touchStartYRef.current;
    // Ignore upward drags — sheet only dismisses by pulling down.
    if (dy <= 0) {
      if (isDragging) setIsDragging(false);
      setDragY(0);
      return;
    }
    // Only start dragging if the scroll body is at the top OR drag is locked.
    const scrollTop = scrollBodyRef.current?.scrollTop ?? 0;
    if (!dragLockedRef.current && scrollTop > 0) {
      // User is scrolling content, not dragging the sheet.
      return;
    }
    dragLockedRef.current = true;
    if (!isDragging) setIsDragging(true);
    setDragY(dy);
  }, [isDragging]);

  const handleTouchEnd = useCallback(() => {
    touchStartYRef.current = null;
    if (!dragLockedRef.current) return;
    dragLockedRef.current = false;
    setIsDragging(false);
    if (dragY > DRAG_DISMISS_THRESHOLD_PX) {
      onClose();
    } else {
      // Snap back — transition re-enables since isDragging flips false.
      setDragY(0);
    }
  }, [dragY, onClose]);

  // Compose transform: closed → 100% (off-screen), dragging → translateY(dragY px),
  // open → 0. Mixing px and % gets handled by always sending one or the other.
  const panelTransform = !visible
    ? "translateY(100%)"
    : isDragging
      ? `translateY(${dragY}px)`
      : "translateY(0)";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{
        backgroundColor: "rgba(26,22,18,0.42)",
        backdropFilter: "blur(2px)",
        opacity: visible ? 1 : 0,
        // Backdrop and panel share --sheet-duration so they land in lockstep.
        transition: "opacity var(--sheet-duration) ease-out",
      }}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <div
        className="w-full max-w-md flex flex-col bg-background rounded-t-2xl sm:rounded-2xl border-t sm:border border-outline-variant/50 relative"
        style={{
          maxHeight: `${maxHeightPct}vh`,
          transform: panelTransform,
          // Disable transition while finger is down so the panel tracks the
          // drag 1:1; re-enable on release for snap-back / dismiss easing.
          transition: isDragging ? "none" : "transform var(--sheet-duration) var(--sheet-ease)",
          // pan-y allows our vertical drag-to-dismiss; contain stops Chrome's
          // pull-to-refresh from firing when the user drags the sheet.
          touchAction: "pan-y",
          overscrollBehavior: "contain",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Drag handle (grabber) — mobile-only iOS-style affordance.
            On desktop the modal is centered, so the handle is meaningless
            and reads as a stray decoration. Hide at sm: breakpoint. */}
        <div className="flex justify-center pt-2 shrink-0 sm:hidden">
          <div className="w-9 h-1 rounded-full bg-outline-variant/70" aria-hidden="true" />
        </div>

        {/* Desktop-only close button — at sm: and above the drag handle is
            hidden, so without an explicit X the only dismiss affordance is
            backdrop click / Escape. Add a 32px tap target in the corner. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="hidden sm:flex absolute top-3 right-3 w-8 h-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-low active:scale-[0.95] transition"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {/* Header — title + subtitle. Top padding respects the iPhone notch
            in landscape (safe-area-inset-top); falls back to 12px otherwise. */}
        <div className="px-5 pb-3 pr-12 sm:pr-12 shrink-0" style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
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
        <div ref={scrollBodyRef} className="px-5 py-4 overflow-y-auto flex-1 scrollbar-hide">{children}</div>

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
