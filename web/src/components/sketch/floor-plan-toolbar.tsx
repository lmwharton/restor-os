"use client";

import { useEffect, useRef, useState } from "react";
import { TOOLS, type ToolType } from "./floor-plan-tools";
import { CANVAS_MODES, type CanvasMode } from "./moisture-mode";
import type Konva from "konva";

/* ------------------------------------------------------------------ */
/*  Tool Icons (inline SVG paths)                                      */
/* ------------------------------------------------------------------ */

function ToolIcon({ type, size = 18 }: { type: string; size?: number }) {
  const s = size;
  switch (type) {
    case "rect":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "line":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M4 20L20 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "trace":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M5 19L5 6L13 4L19 10L17 19L5 19" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx="5" cy="6" r="1.8" fill="currentColor" />
          <circle cx="13" cy="4" r="1.8" fill="currentColor" />
          <circle cx="19" cy="10" r="1.8" fill="currentColor" />
          <circle cx="17" cy="19" r="1.8" fill="currentColor" />
          <circle cx="5" cy="19" r="1.8" fill="currentColor" />
        </svg>
      );
    case "door":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M4 20V4h2v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M6 4a14 14 0 0 1 10 10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
        </svg>
      );
    case "window":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="4" y="6" width="16" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
          <line x1="12" y1="6" x2="12" y2="18" stroke="currentColor" strokeWidth="1.5" />
          <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "opening":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
          <line x1="4" y1="8" x2="4" y2="16" stroke="currentColor" strokeWidth="2" />
          <line x1="20" y1="8" x2="20" y2="16" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "cutout":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <rect x="4" y="4" width="16" height="16" rx="1.5" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
          <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
        </svg>
      );
    case "pointer":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M5 3l14 10-6 1-3 6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      );
    case "trash":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "pin":
      // Droplet + small center dot — reads as "moisture measurement spot."
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <path d="M12 2.5s6 6.5 6 11.5a6 6 0 1 1-12 0c0-5 6-11.5 6-11.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <circle cx="12" cy="14" r="1.6" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface FloorPlanToolbarProps {
  tool: ToolType;
  onToolChange: (t: ToolType) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  stageScale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  stageRef: React.RefObject<Konva.Stage | null>;
  affectedOverlay: boolean;
  onToggleAffectedOverlay: () => void;
  /** Canvas mode — filters the tool palette via CANVAS_MODES[mode].tools and
   *  switches the active-tool accent color (orange for Sketch, cyan for
   *  Moisture). Defaults to "sketch" so legacy callers keep working. */
  canvasMode?: CanvasMode;
}

/* ------------------------------------------------------------------ */
/*  Shared export handler                                              */
/* ------------------------------------------------------------------ */

function exportPngFromStage(stageRef: React.RefObject<Konva.Stage | null>) {
  const stage = stageRef.current;
  if (!stage) return;
  const layers = stage.getLayers();
  const gridLayer = layers[0];
  if (gridLayer) gridLayer.visible(false);
  const hiddenNodes: Array<{ visible: (v: boolean) => void }> = [];
  stage.find("Circle").forEach((c: { attrs: { fill?: string }; visible: (v: boolean) => void }) => {
    if (c.attrs.fill === "#5b6abf" || c.attrs.fill === "#e85d26") {
      c.visible(false);
      hiddenNodes.push(c);
    }
  });
  stage.draw();
  const uri = stage.toDataURL({ pixelRatio: 2 });
  if (gridLayer) gridLayer.visible(true);
  hiddenNodes.forEach((c) => c.visible(true));
  stage.draw();
  const link = document.createElement("a");
  link.download = "floor-plan.png";
  link.href = uri;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ------------------------------------------------------------------ */
/*  Desktop toolbar — UNCHANGED from the original icon + label + wrap  */
/*  layout. Shown at sm+ breakpoint.                                   */
/* ------------------------------------------------------------------ */

const deskBtnBase = "flex flex-col items-center justify-center w-[44px] h-[44px] rounded-lg text-[10px] font-medium cursor-pointer";
const deskBtnInactive = `${deskBtnBase} text-[#6b6560] hover:bg-[#eae6e1]`;
const deskBtnDisabled = `${deskBtnBase} text-[#6b6560] hover:bg-[#eae6e1] disabled:opacity-30`;

function DesktopToolbar({
  tool, onToolChange, canUndo, canRedo, onUndo, onRedo,
  stageScale, onZoomIn, onZoomOut, onFit, stageRef,
  affectedOverlay, onToggleAffectedOverlay,
  canvasMode = "sketch",
}: FloorPlanToolbarProps) {
  const modeCfg = CANVAS_MODES[canvasMode];
  // Filter the master TOOLS list to only the ones the active mode permits —
  // preserves the declaration order of TOOLS so the palette reads the same
  // each time (no reshuffling). Also preserves order defined in mode config.
  const allowedTools = TOOLS.filter((t) => modeCfg.tools.includes(t.id));
  return (
    <div className="hidden sm:flex items-center gap-1 px-3 py-2 border-b border-[#eae6e1] bg-[#faf8f5] flex-wrap">
      {allowedTools.map((t) => {
        const active = tool === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onToolChange(t.id)}
            aria-label={t.label}
            className={`${deskBtnBase} transition-all ${
              active ? "text-white" : "text-[#6b6560] hover:bg-[#eae6e1]"
            }`}
            style={active ? { background: modeCfg.accent } : undefined}
          >
            <ToolIcon type={t.icon} />
            <span className="mt-0.5">{t.label}</span>
          </button>
        );
      })}
      <div className="w-px h-8 bg-[#eae6e1] mx-1" />
      <button
        type="button"
        onClick={onToggleAffectedOverlay}
        aria-label="Toggle affected mode overlay"
        aria-pressed={affectedOverlay}
        className={`${deskBtnBase} transition-all ${
          affectedOverlay
            ? "bg-[#ba1a1a]/10 text-[#ba1a1a] ring-1 ring-[#ba1a1a]/30"
            : "text-[#6b6560] hover:bg-[#eae6e1]"
        }`}
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L14 8L20 9L15.5 13.5L17 20L12 17L7 20L8.5 13.5L4 9L10 8L12 2Z"
            fill={affectedOverlay ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        <span className="mt-0.5">Damage</span>
      </button>
      <div className="w-px h-8 bg-[#eae6e1] mx-1" />
      <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" className={deskBtnDisabled}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><path d="M3 10h14a4 4 0 0 1 0 8H10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 6L3 10l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="mt-0.5">Undo</span>
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Redo" className={deskBtnDisabled}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><path d="M21 10H7a4 4 0 0 0 0 8h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M17 6l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="mt-0.5">Redo</span>
      </button>
      <div className="w-px h-8 bg-[#eae6e1] mx-1" />
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" className={deskBtnInactive}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M21 21l-4-4M8 11h6M11 8v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <span className="mt-0.5">Zoom+</span>
      </button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" className={deskBtnInactive}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M21 21l-4-4M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <span className="mt-0.5">Zoom-</span>
      </button>
      <button type="button" onClick={onFit} aria-label="Reset view" className={deskBtnInactive}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M9 3v18M3 9h18" stroke="currentColor" strokeWidth="1" opacity="0.3" /></svg>
        <span className="mt-0.5">Fit</span>
      </button>
      <span className="text-[10px] text-[#8a847e] font-[family-name:var(--font-geist-mono)] ml-1">{Math.round(stageScale * 100)}%</span>
      <div className="w-px h-8 bg-[#eae6e1] mx-1" />
      <button type="button" onClick={() => exportPngFromStage(stageRef)} aria-label="Export PNG" className={deskBtnInactive}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="mt-0.5">Export</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile toolbar — instrument-panel redesign. One row, icons only,  */
/*  with an overflow menu for tier-2 tools and view controls.         */
/* ------------------------------------------------------------------ */

// Delete is frequent enough to deserve a primary slot — techs correct stray
// rooms/walls constantly. Trace / Opening / Cutout are the truly occasional
// tools and can live behind the overflow.
// Pin is listed first so Moisture Mode's palette leads with the primary
// drop action. Phase 1 Sketch Mode doesn't allow pin (filtered out by
// CANVAS_MODES.sketch.tools), so adding it here is safe — invisible when
// the mode doesn't permit it.
const PRIMARY_TOOL_IDS: ToolType[] = ["pin", "select", "room", "wall", "door", "window", "delete"];
const OVERFLOW_TOOL_IDS: ToolType[] = ["trace", "opening", "cutout"];

// Match the desktop layout: icon above a tiny label, every button. Labels
// stay readable on mobile so clients don't have to guess what each pictogram
// means. Row scrolls horizontally on narrow phones; shrink-0 keeps each
// button at its intrinsic size.
const mobileBtnBase =
  // touch-action: manipulation stops Safari from interpreting a quick second
  // tap as a double-tap-to-zoom gesture, which would otherwise swallow the
  // toggle-off re-tap the user relies on to cancel a tool.
  "relative flex flex-col items-center justify-center shrink-0 w-11 h-11 rounded-lg cursor-pointer transition-all duration-150 [touch-action:manipulation] select-none";
const mobileBtnLabel =
  "mt-0.5 text-[9px] font-medium tracking-[0.005em] leading-none";

function MobileToolButton({
  icon,
  label,
  active,
  onClick,
  activeColor = "#e85d26",
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  /** Background color when this tool is the active one. Sketch Mode uses the
   *  brand orange; Moisture Mode passes cyan so the active tool signals the
   *  user's current context without looking like a Sketch-Mode selection. */
  activeColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`${mobileBtnBase} ${
        active ? "text-white" : "text-[#6b6560] active:bg-[#e8e2d9]"
      }`}
      style={active ? { background: activeColor } : undefined}
    >
      {icon}
      <span className={mobileBtnLabel}>{label}</span>
    </button>
  );
}

function MobileUtilityButton({
  onClick,
  disabled,
  ariaLabel,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`${mobileBtnBase} text-[#6b6560] active:bg-[#e8e2d9] disabled:opacity-30`}
    >
      {children}
      <span className={mobileBtnLabel}>{label}</span>
    </button>
  );
}

function MobileDivider() {
  return <span aria-hidden className="w-px h-5 bg-[#d9d3cb]/70 mx-0.5 shrink-0" />;
}

function MobileToolbar({
  tool, onToolChange, canUndo, canRedo, onUndo, onRedo,
  onZoomIn, onZoomOut, onFit, stageRef,
  affectedOverlay, onToggleAffectedOverlay,
  canvasMode = "sketch",
}: FloorPlanToolbarProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);
  const modeCfg = CANVAS_MODES[canvasMode];

  // Only primary tools that this mode ALSO allows are shown in the main row.
  // Moisture Mode's allowed set is small (select + delete) so the row is short
  // and uncluttered — matches the v2 design's "shorter row, more breathing".
  const primaryTools = TOOLS.filter(
    (t) => PRIMARY_TOOL_IDS.includes(t.id) && modeCfg.tools.includes(t.id),
  ).sort((a, b) => PRIMARY_TOOL_IDS.indexOf(a.id) - PRIMARY_TOOL_IDS.indexOf(b.id));

  // Overflow also filters by mode — so Trace/Opening/Cutout disappear from
  // "More" when in Moisture Mode (they're sketch-only drawing tools).
  const overflowTools = OVERFLOW_TOOL_IDS.filter((id) => modeCfg.tools.includes(id));

  // Orange indicator on the overflow trigger if the active tool is inside the
  // menu — prevents "where am I" confusion when the user picks Trace/Cutout
  // and the main bar no longer shows a pressed state.
  const overflowHoldsActive = overflowTools.includes(tool);

  // The "More" trigger is ALWAYS visible, pinned to the right of the toolbar.
  // Counter hints at how many items are behind the menu. + 4 is the view
  // controls (Zoom+, Zoom-, Fit, Export) which are always in overflow.
  const overflowCount = overflowTools.length + 4;

  return (
    <div className="sm:hidden relative border-b border-[#eae6e1] bg-[#faf8f5]">
      <div className="flex items-center px-2 py-1.5 gap-0">
        {/* Scrollable tools region — any overflow lives here and scrolls
            horizontally. Right-edge gradient fade hints at more content. */}
        <div className="relative flex-1 min-w-0">
          <div className="flex items-center gap-0.5 overflow-x-auto overflow-y-hidden scrollbar-none pr-5">
            {/* Primary draw tools */}
            {primaryTools.map((t) => (
              <MobileToolButton
                key={t.id}
                icon={<ToolIcon type={t.icon} />}
                label={t.label}
                active={tool === t.id}
                onClick={() => onToolChange(t.id)}
                activeColor={modeCfg.accent}
              />
            ))}

            <MobileDivider />

            {/* Damage overlay */}
            <button
              type="button"
              onClick={onToggleAffectedOverlay}
              aria-label="Toggle damage overlay"
              aria-pressed={affectedOverlay}
              className={`${mobileBtnBase} ${
                affectedOverlay
                  ? "bg-[#ba1a1a] text-white shadow-[0_1px_2px_rgba(186,26,26,0.25),0_2px_8px_rgba(186,26,26,0.18)]"
                  : "text-[#6b6560] active:bg-[#e8e2d9]"
              }`}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L14 8L20 9L15.5 13.5L17 20L12 17L7 20L8.5 13.5L4 9L10 8L12 2Z"
                  fill={affectedOverlay ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={mobileBtnLabel}>Damage</span>
            </button>

            <MobileUtilityButton onClick={onUndo} disabled={!canUndo} ariaLabel="Undo" label="Undo">
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <path d="M3 10h14a4 4 0 0 1 0 8H10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7 6L3 10l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </MobileUtilityButton>

            <MobileUtilityButton onClick={onRedo} disabled={!canRedo} ariaLabel="Redo" label="Redo">
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <path d="M21 10H7a4 4 0 0 0 0 8h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M17 6l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </MobileUtilityButton>
          </div>

          {/* Right-edge fade — signals "there's more beyond the viewport."
              Non-interactive, sits above the scroll area, bleeds into the
              pinned More button's side so the transition feels seamless. */}
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#faf8f5] via-[#faf8f5]/80 to-transparent"
          />
        </div>

        {/* Hairline divider between scrollable region and pinned More. */}
        <span aria-hidden className="w-px h-7 bg-[#d9d3cb] mx-1 shrink-0" />

        {/* Overflow trigger — pinned, always visible */}
        <button
          ref={overflowBtnRef}
          type="button"
          onClick={() => setOverflowOpen((v) => !v)}
          aria-label="More tools"
          aria-expanded={overflowOpen}
          aria-haspopup="menu"
          className={`${mobileBtnBase} shrink-0 ${
            overflowOpen
              ? "bg-[#e8e2d9] text-[#3a3632]"
              : "text-[#6b6560] active:bg-[#e8e2d9]"
          }`}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <circle cx="6" cy="12" r="1.8" fill="currentColor" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <circle cx="18" cy="12" r="1.8" fill="currentColor" />
          </svg>
          <span className={mobileBtnLabel}>More</span>
          {/* Count badge — tells the user concretely that there are N items
              behind this menu, not just a generic "more". Hidden when the
              active tool lives inside (the orange dot takes over instead). */}
          {!overflowHoldsActive && !overflowOpen && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full text-white text-[9px] font-semibold leading-[15px] text-center shadow-[0_0_0_2px_#faf8f5] tabular-nums"
              style={{ background: modeCfg.accent }}
            >
              {overflowCount}
            </span>
          )}
          {overflowHoldsActive && (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full shadow-[0_0_0_2px_#faf8f5]"
              style={{ background: modeCfg.accent }}
            />
          )}
        </button>
      </div>

      <MobileOverflowMenu
        tool={tool}
        onToolChange={onToolChange}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onFit={onFit}
        onExport={() => exportPngFromStage(stageRef)}
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        anchorRef={overflowBtnRef}
        toolIds={overflowTools}
        activeColor={modeCfg.accent}
      />

      <style jsx>{`
        .scrollbar-none::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-none {
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}

interface MobileOverflowMenuProps {
  tool: ToolType;
  onToolChange: (t: ToolType) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onExport: () => void;
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  /** Overflow draw tool ids allowed in the active mode. Empty → the Draw
   *  section is omitted (moisture mode currently has no overflow drawing). */
  toolIds: ToolType[];
  /** Accent color for the active-item highlight — matches the mode's accent
   *  (orange in Sketch, cyan in Moisture). */
  activeColor: string;
}

function MobileOverflowMenu({
  tool,
  onToolChange,
  onZoomIn,
  onZoomOut,
  onFit,
  onExport,
  open,
  onClose,
  anchorRef,
  toolIds,
  activeColor,
}: MobileOverflowMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const overflowTools = TOOLS.filter((t) => toolIds.includes(t.id));

  return (
    <div
      ref={panelRef}
      className="absolute right-2 top-full mt-1.5 z-30 w-[188px] bg-white rounded-xl shadow-[0_2px_4px_rgba(31,27,23,0.04),0_8px_28px_rgba(31,27,23,0.12)] border border-[#eae6e1] overflow-hidden"
      style={{ animation: "overflowMenuReveal 0.14s cubic-bezier(0.16, 1, 0.3, 1)" }}
      role="menu"
    >
      <span
        aria-hidden
        className="absolute right-[14px] -top-[5px] w-[10px] h-[10px] bg-white border-l border-t border-[#eae6e1] rotate-45"
      />

      <div className="relative bg-white">
        {overflowTools.length > 0 && (
          <>
            <div className="px-1.5 py-1.5">
              <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.12em] text-[#a29c95] px-2 pt-1 pb-1.5">
                Draw
              </p>
              <div className="flex flex-col">
                {overflowTools.map((t) => {
                  const active = tool === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onToolChange(t.id);
                        onClose();
                      }}
                      className={`flex items-center gap-2.5 px-2 h-9 rounded-md text-[12px] font-medium cursor-pointer transition-colors ${
                        active ? "text-white" : "text-[#3a3632] active:bg-[#f5f1eb]"
                      }`}
                      style={active ? { background: activeColor } : undefined}
                    >
                      <ToolIcon type={t.icon} size={16} />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="h-px bg-[#eae6e1]" />
          </>
        )}

        <div className="px-1.5 py-1.5">
          <p className="text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.12em] text-[#a29c95] px-2 pt-1 pb-1.5">
            View
          </p>
          <div className="flex flex-col">
            <MenuRow
              onClick={() => { onZoomIn(); onClose(); }}
              icon={
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M21 21l-4-4M8 11h6M11 8v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              }
              label="Zoom in"
            />
            <MenuRow
              onClick={() => { onZoomOut(); onClose(); }}
              icon={
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M21 21l-4-4M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              }
              label="Zoom out"
            />
            <MenuRow
              onClick={() => { onFit(); onClose(); }}
              icon={
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M9 3v18M3 9h18" stroke="currentColor" strokeWidth="1" opacity="0.3" />
                </svg>
              }
              label="Fit to view"
            />
          </div>
        </div>

        <div className="h-px bg-[#eae6e1]" />

        <div className="px-1.5 py-1.5">
          <MenuRow
            onClick={() => { onExport(); onClose(); }}
            icon={
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            label="Export PNG"
          />
        </div>
      </div>

      <style jsx>{`
        @keyframes overflowMenuReveal {
          from {
            opacity: 0;
            transform: translateY(-4px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

function MenuRow({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2.5 px-2 h-9 rounded-md text-[12px] font-medium text-[#3a3632] active:bg-[#f5f1eb] cursor-pointer transition-colors"
    >
      <span className="text-[#6b6560]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Exported wrapper — renders mobile OR desktop based on breakpoint. */
/* ------------------------------------------------------------------ */

export function FloorPlanToolbar(props: FloorPlanToolbarProps) {
  return (
    <>
      <MobileToolbar {...props} />
      <DesktopToolbar {...props} />
    </>
  );
}
