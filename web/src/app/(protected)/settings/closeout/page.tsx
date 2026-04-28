"use client";

/**
 * Settings → Closeout Requirements
 *
 * Spec 01K Phase 3 admin page. Owner-only (admin role was dropped by
 * Spec 01I migration `01i_a2`; only `owner` and `tech` exist now, plus
 * the platform_admin flag for Crewmatic support staff).
 *
 * Configures gate strictness for the closeout checklist that surfaces
 * when a user marks a job Completed. One row per gate item × one column
 * per job type. Cells are dropdowns — Warning / Acknowledge / Hard Block.
 *
 * Backend lives at `backend/api/closeout/` — list/update/reset endpoints
 * are real (no mock fallback). Defensive `SPEC_DEFAULT_GATES` server-side
 * makes the modal work even for companies that pre-date the migration's
 * seed-defaults DO-block.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMe } from "@/lib/hooks/use-me";
import {
  useCloseoutSettings,
  useUpdateCloseoutSetting,
  useResetCloseoutSettings,
} from "@/lib/hooks/use-closeout";
import type { CloseoutSetting, GateLevel } from "@/lib/hooks/use-closeout";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

// Spec 01K D1 — single source of truth for the 7 closeout items. Order matters
// (renders top-to-bottom). Labels match what the closeout-checklist modal shows.
const CLOSEOUT_ITEMS: { key: string; label: string }[] = [
  { key: "contract_signed",        label: "Contract signed" },
  { key: "photos_final_after",     label: "Photos tagged Final / After" },
  { key: "moisture_per_room",      label: "All rooms have moisture reading" },
  { key: "all_rooms_dry_standard", label: "All rooms at dry standard" },
  { key: "all_equipment_pulled",   label: "All equipment pulled" },
  { key: "scope_finalized",        label: "Scope finalized" },
  { key: "certificate_generated",  label: "Certificate of Completion generated" },
];

const JOB_TYPE_COLUMNS: { key: CloseoutSetting["job_type"]; label: string }[] = [
  { key: "mitigation",     label: "Mitigation" },
  { key: "reconstruction", label: "Reconstruction" },
  { key: "fire_smoke",     label: "Fire / Smoke" },
];

// Spec 01K Option A — no blue. Severity ramp uses warm hues only:
// warn (soft amber) → acknowledge (warm tan, "needs your sign-off") → hard_block (red).
const GATE_LEVEL_META: Record<GateLevel, { label: string; color: string; bg: string; border: string }> = {
  warn:        { label: "Warning",          color: "#b8801f", bg: "#fdefd8", border: "#f0d6a3" },
  acknowledge: { label: "Must acknowledge", color: "#8a7560", bg: "#f3ece4", border: "#e0d6c9" },
  hard_block:  { label: "Hard block",       color: "#9b1c1c", bg: "#fbe6e6", border: "#f0c2c2" },
};

const ALL_LEVELS: GateLevel[] = ["warn", "acknowledge", "hard_block"];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CloseoutRequirementsPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const companyId = me?.company.id;
  // Spec 01I `01i_a2` dropped the 'admin' role — only 'owner' and 'tech' exist.
  // Closeout config is owner-only (or platform_admin support).
  const isOwner = me?.role === "owner" || me?.is_platform_admin;

  const { data: settings, isLoading: settingsLoading } = useCloseoutSettings(companyId);
  const updateSetting = useUpdateCloseoutSetting(companyId ?? "");
  const resetColumn = useResetCloseoutSettings(companyId ?? "");

  // Build a quick lookup: settings[itemKey][jobType] = setting | null (n/a)
  const lookup = useMemo(() => {
    const m = new Map<string, Map<string, CloseoutSetting>>();
    for (const s of settings ?? []) {
      if (!m.has(s.item_key)) m.set(s.item_key, new Map());
      m.get(s.item_key)!.set(s.job_type, s);
    }
    return m;
  }, [settings]);

  if (meLoading) {
    return <div className="p-6 text-on-surface-variant">Loading…</div>;
  }

  if (!isOwner) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-6 text-center">
          <h1 className="text-[18px] font-bold text-on-surface">Owner only</h1>
          <p className="mt-2 text-[14px] text-on-surface-variant">
            Closeout requirements are configured by the company owner.
          </p>
          <Link
            href="/jobs"
            className="inline-flex mt-4 h-9 px-5 rounded-lg bg-brand-accent text-on-primary text-[13px] font-semibold items-center"
          >
            Back to jobs
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1.5 text-[13px] text-on-surface-variant mb-4">
        <Link href="/settings" className="hover:text-on-surface">Settings</Link>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-semibold text-on-surface">Closeout Requirements</span>
      </div>

      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-on-surface">
          Closeout requirements
        </h1>
        <p className="mt-1.5 text-[13px] text-on-surface-variant max-w-2xl leading-snug">
          Configure when each job type is allowed to be marked Completed.
          Hard blocks prevent closeout entirely; acknowledgments require a logged
          reason; warnings surface non-fatally.
        </p>
      </div>

      {/* Table */}
      <div className="border border-outline-variant/50 rounded-xl overflow-hidden bg-surface-container-lowest">
        {/* Header row */}
        <div
          className="grid items-center text-[11px] font-semibold tracking-[0.06em] uppercase text-on-surface-variant px-4 py-3 bg-surface-container-low"
          style={{ gridTemplateColumns: "minmax(260px,1fr) 200px 200px 200px" }}
        >
          <div>Checklist item</div>
          {JOB_TYPE_COLUMNS.map((c) => (
            <div key={c.key}>{c.label}</div>
          ))}
        </div>

        {/* Body rows */}
        {settingsLoading ? (
          <div className="p-6 text-center text-on-surface-variant text-[13px]">Loading settings…</div>
        ) : (
          CLOSEOUT_ITEMS.map((item, i) => (
            <div
              key={item.key}
              className="grid items-center px-4 py-2.5"
              style={{
                gridTemplateColumns: "minmax(260px,1fr) 200px 200px 200px",
                borderBottom: i === CLOSEOUT_ITEMS.length - 1 ? "none" : "1px solid var(--outline-variant)",
                borderColor: "color-mix(in srgb, var(--outline-variant) 50%, transparent)",
              }}
            >
              <div className="text-[14px] font-medium text-on-surface pr-3">
                {item.label}
              </div>
              {JOB_TYPE_COLUMNS.map((col) => {
                const setting = lookup.get(item.key)?.get(col.key);
                if (!setting) {
                  return (
                    <div
                      key={col.key}
                      className="text-[13px] italic text-on-surface-variant/70 pr-3"
                    >
                      (n/a)
                    </div>
                  );
                }
                return (
                  <div key={col.key} className="pr-3">
                    <GateCellWithSaveState
                      settingId={setting.id}
                      value={setting.gate_level}
                      onChange={(level) =>
                        updateSetting.mutateAsync({ id: setting.id, gate_level: level })
                      }
                    />
                  </div>
                );
              })}
            </div>
          ))
        )}

        {/* Reset row */}
        <div
          className="grid items-center px-4 py-3 bg-surface-container-low"
          style={{ gridTemplateColumns: "minmax(260px,1fr) 200px 200px 200px", borderTop: "1px solid color-mix(in srgb, var(--outline-variant) 50%, transparent)" }}
        >
          <div className="text-[12px] text-on-surface-variant pr-3">
            Restore the factory defaults for this column.
          </div>
          {JOB_TYPE_COLUMNS.map((col) => (
            <div key={col.key} className="pr-3">
              <button
                type="button"
                onClick={() => resetColumn.mutate({ job_type: col.key })}
                disabled={resetColumn.isPending}
                className="h-9 px-3 rounded-lg border border-outline-variant/60 bg-surface-container-lowest text-[12px] font-semibold text-on-surface inline-flex items-center gap-1.5 hover:bg-surface-container active:scale-[0.98] disabled:opacity-50 transition"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v3.5h3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Reset to defaults
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-5 flex items-start gap-6 flex-wrap">
        <div className="text-[11px] font-semibold tracking-[0.06em] uppercase text-on-surface-variant pt-1.5">
          Gate levels
        </div>
        {ALL_LEVELS.map((lvl) => {
          const cfg = GATE_LEVEL_META[lvl];
          return (
            <div key={lvl} className="flex items-start gap-2">
              <span
                className="w-[22px] h-[22px] rounded-full inline-flex items-center justify-center"
                style={{ backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}
              >
                {gateGlyph(lvl, cfg.color)}
              </span>
              <div>
                <div className="text-[12px] font-bold text-on-surface">{cfg.label}</div>
                <div className="text-[11px] text-on-surface-variant max-w-[260px] leading-snug">
                  {gateLevelDescription(lvl)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  GateCellWithSaveState — wraps the dropdown with per-cell save UX    */
/*                                                                     */
/*  Three states:                                                      */
/*   - idle: no decoration                                             */
/*   - pending: spinner overlay, dropdown disabled                     */
/*   - saved: "Saved ✓" pill fades in, fades out after 1500ms          */
/*                                                                     */
/*  We track state per-cell rather than relying on the global mutation */
/*  flag because multiple cells can be edited in quick succession and  */
/*  the global flag would flicker the wrong cells.                     */
/* ------------------------------------------------------------------ */

interface GateCellWithSaveStateProps {
  /** Settings row id — used as a stable key only; not read inside this component. */
  settingId: string;
  value: GateLevel;
  onChange: (next: GateLevel) => Promise<unknown>;
}

function GateCellWithSaveState({ value, onChange }: GateCellWithSaveStateProps) {
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved">("idle");
  const fadeTimer = useRef<number | null>(null);

  // Cleanup pending fade timer on unmount so we don't update state after
  // the component leaves the tree.
  useEffect(() => () => {
    if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
  }, []);

  async function handleChange(next: GateLevel) {
    if (fadeTimer.current !== null) {
      window.clearTimeout(fadeTimer.current);
      fadeTimer.current = null;
    }
    setSaveState("pending");
    try {
      await onChange(next);
      setSaveState("saved");
      fadeTimer.current = window.setTimeout(() => {
        setSaveState("idle");
        fadeTimer.current = null;
      }, 1500);
    } catch {
      // Mutation surfaces error globally — reset to idle so the cell
      // doesn't pretend it saved.
      setSaveState("idle");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <GateCellSelect
          value={value}
          onChange={handleChange}
          disabled={saveState === "pending"}
        />
      </div>
      {/* Save-state indicator — fixed-width slot so the dropdown doesn't
          re-flow when the indicator shows/hides. Pending shows a spinner,
          saved shows a fading "Saved ✓" pill that auto-clears after 1.5s. */}
      <span
        aria-live="polite"
        className="inline-flex items-center justify-start gap-1 w-[52px] h-9 text-[11px] font-semibold whitespace-nowrap shrink-0"
        style={{
          opacity: saveState === "idle" ? 0 : 1,
          transform: saveState === "idle" ? "translateX(-4px)" : "translateX(0)",
          transition: "opacity 200ms ease, transform 200ms ease",
          color: saveState === "saved" ? "var(--status-completed)" : "var(--on-surface-variant)",
        }}
        aria-label={saveState === "saved" ? "Saved" : saveState === "pending" ? "Saving" : ""}
      >
        {saveState === "pending" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.4" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        )}
        {saveState === "saved" && (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Saved
          </>
        )}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  GateCellSelect — token-styled dropdown                              */
/* ------------------------------------------------------------------ */

interface GateCellSelectProps {
  value: GateLevel;
  onChange: (next: GateLevel) => void;
  disabled?: boolean;
}

function GateCellSelect({ value, onChange, disabled }: GateCellSelectProps) {
  const cfg = GATE_LEVEL_META[value];
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as GateLevel)}
        disabled={disabled}
        className="appearance-none w-full h-9 pl-3 pr-8 rounded-lg text-[13px] font-semibold outline-none focus:ring-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: cfg.bg,
          color: cfg.color,
          border: `1px solid ${cfg.border}`,
        }}
      >
        {ALL_LEVELS.map((l) => (
          <option key={l} value={l}>{GATE_LEVEL_META[l].label}</option>
        ))}
      </select>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
      >
        <path d="M6 9l6 6 6-6" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function gateGlyph(level: GateLevel, color: string) {
  if (level === "warn") {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
        <path d="M12 4l9.5 16.5h-19L12 4z" stroke={color} strokeWidth="2.6" strokeLinejoin="round" />
      </svg>
    );
  }
  if (level === "acknowledge") {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2.6" />
        <path d="M12 8v4" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="12" cy="16" r="1.4" fill={color} />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2.6" />
      <path d="M5.5 5.5l13 13" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function gateLevelDescription(lvl: GateLevel): string {
  switch (lvl) {
    case "warn":        return "Surfaces in checklist; doesn't block close.";
    case "acknowledge": return "Requires a logged reason to close anyway.";
    case "hard_block":  return "Closeout disabled until resolved.";
  }
}
