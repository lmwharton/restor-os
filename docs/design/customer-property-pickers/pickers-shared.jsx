/* global React */
/* Shared atoms for Customer + Property pickers.
   Vocabulary follows web/src — Geist + cream surfaces, 11px mono uppercase
   labels, brand-accent #e85d26, 48px tap targets, 16px input font, no shadows.
*/
const { useState, useEffect, useRef, useMemo } = React;

/* ============== ICONS ============== */
const I = {
  search: (p={}) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7"/><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  x: (p={}) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  check: (p={}) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  plus: (p={}) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  user: (p={}) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  building: (p={}) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><rect x="4" y="3" width="16" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  pin: (p={}) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><path d="M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.6"/></svg>,
  phone: (p={}) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}><path d="M5.2 4.5C5.2 3.7 5.9 3 6.7 3h2.4c.7 0 1.3.5 1.5 1.2l.7 2.7c.1.6-.1 1.2-.5 1.6L9.5 9.8a13 13 0 0 0 4.7 4.7l1.3-1.3c.4-.4 1-.6 1.6-.5l2.7.7c.7.2 1.2.8 1.2 1.5v2.4c0 .8-.7 1.5-1.5 1.5C11 18.8 5.2 13 5.2 4.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>,
  mail: (p={}) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M3 7l9 7 9-7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>,
  sparkle: (p={}) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>,
  chev: (p={}) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  alert: (p={}) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}><path d="M12 4l9.5 16.5h-19L12 4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M12 10v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>,
  back: (p={}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" {...p}><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  edit: (p={}) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}><path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M14 6l4 4" stroke="currentColor" strokeWidth="1.6"/></svg>,
};

/* ============== SAMPLE DATA ============== */
const SAMPLE_CUSTOMERS = [
  { id: "c1", name: "Sarah Johnson", entity: "ABC Property Mgmt", phone: "(503) 555‑0192", phone_red: "(503) 555‑••92", email: "sarah@abcpm.com", type: "commercial", properties: 3 },
  { id: "c2", name: "Sara Johnston", entity: null, phone: "(503) 555‑0144", phone_red: "(503) 555‑••44", email: "sara.j@gmail.com", type: "individual", properties: 1 },
  { id: "c3", name: "Sarah Johnson",  entity: "Johnson Family Trust", phone: "(971) 555‑0212", phone_red: "(971) 555‑••12", email: "sarahj@trust.co", type: "individual", properties: 2 },
  { id: "c4", name: "Marcus Holmes", entity: "ABC Property Mgmt", phone: "(503) 555‑0103", phone_red: "(503) 555‑••03", email: "marcus@abcpm.com", type: "commercial", properties: 6 },
  { id: "c5", name: "Marisol Hendricks", entity: null, phone: "(503) 555‑0188", phone_red: "(503) 555‑••88", email: "marisol@hendricks.io", type: "individual", properties: 1 },
];

const SAMPLE_PROPERTIES_SARAH = [
  { id: "p1", line1: "1042 Maple St", city: "Beaverton", state: "OR", zip: "97005", customer: "c1", note: "primary" },
  { id: "p2", line1: "1408 SE 22nd Ave", city: "Portland", state: "OR", zip: "97214", customer: "c1" },
  { id: "p3", line1: "215 Oak Park Dr", city: "Tigard", state: "OR", zip: "97223", customer: "c1" },
];

const SAMPLE_PROPERTIES_OTHER = [
  { id: "p4", line1: "1040 Maple St", city: "Beaverton", state: "OR", zip: "97005", customer: "c2", lastJob: "2024" },
  { id: "p5", line1: "10420 SW Maple Ln", city: "Beaverton", state: "OR", zip: "97005", customer: "c4" },
];

/* ============== ATOMS ============== */
function Pill({ children, tone = "default" }) {
  const tones = {
    default:    { bg: "#ffffff",   border: "var(--border)",      fg: "var(--text-2)" },
    individual: { bg: "#f3ece4",   border: "#e6d9c8",            fg: "#7a5e2e" },
    commercial: { bg: "#fff3ed",   border: "#f3c8b3",            fg: "#cc4911" },
    success:    { bg: "#e7f6ec",   border: "#b8e2c5",            fg: "#1f6f3e" },
    warn:       { bg: "#fef3e2",   border: "#f3d8a8",            fg: "#7a4408" },
    info:       { bg: "#fbf2eb",   border: "var(--border)",      fg: "var(--text-2)" },
    brandSoft:  { bg: "var(--brand-tint)", border: "#f3c8b3",    fg: "#cc4911" },
  };
  const c = tones[tone] || tones.default;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      height: 22, padding: "0 8px", borderRadius: 999,
      background: c.bg, border: `1px solid ${c.border}`, color: c.fg,
      fontSize: 11, fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function MonoLabel({ children, accent }) {
  return (
    <div style={{
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 11, fontWeight: 600,
      color: accent ? "var(--brand)" : "var(--text-3)",
      letterSpacing: "0.06em", textTransform: "uppercase",
    }}>{children}</div>
  );
}

function Avatar({ name, type, size = 32 }) {
  const initials = (name || "?").split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const isCom = type === "commercial";
  return (
    <div style={{
      width: size, height: size, flex: "none",
      borderRadius: isCom ? 8 : 999,
      background: isCom ? "#fff3ed" : "#f3ece4",
      border: `1px solid ${isCom ? "#f3c8b3" : "#e6d9c8"}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: isCom ? "#cc4911" : "#7a5e2e",
      fontSize: size <= 28 ? 11 : 12, fontWeight: 700,
      letterSpacing: "0.02em",
    }}>{initials}</div>
  );
}

/* Highlight matched substring (case-insensitive). */
function Highlight({ text, query }) {
  if (!query) return <>{text}</>;
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = (text || "").toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: "#fff3ed", color: "#cc4911", padding: 0, fontWeight: 700, borderRadius: 2 }}>
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

/* ============== PHONE SHELL (matches existing app.jsx vocabulary) ============== */
function Phone({ children, statusBar = "9:41", noHomeIndicator }) {
  return (
    <div style={{
      width: 390, height: 844, background: "var(--bg)",
      border: "1px solid var(--border)", borderRadius: 28, overflow: "hidden",
      position: "relative", display: "flex", flexDirection: "column",
    }}>
      <div style={{
        height: 44, padding: "0 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between", fontSize: 14, fontWeight: 600,
        color: "#1a1a1a", flex: "none",
      }}>
        <span className="mono">{statusBar}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.85 }}>
          <svg width="16" height="10" viewBox="0 0 16 10" fill="none"><rect x="0" y="6" width="3" height="4" rx="0.5" fill="#1a1a1a"/><rect x="4.3" y="4" width="3" height="6" rx="0.5" fill="#1a1a1a"/><rect x="8.7" y="2" width="3" height="8" rx="0.5" fill="#1a1a1a"/><rect x="13" y="0" width="3" height="10" rx="0.5" fill="#1a1a1a"/></svg>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M7 9.5l1.5-1.5a2.1 2.1 0 0 0-3 0L7 9.5z" fill="#1a1a1a"/><path d="M3.7 6.2a4.7 4.7 0 0 1 6.6 0l-1 1a3.3 3.3 0 0 0-4.6 0l-1-1z" fill="#1a1a1a"/><path d="M.5 3a9.2 9.2 0 0 1 13 0l-1 1a7.8 7.8 0 0 0-11 0l-1-1z" fill="#1a1a1a"/></svg>
          <svg width="24" height="11" viewBox="0 0 24 11" fill="none"><rect x="0.5" y="0.5" width="20" height="10" rx="2.5" stroke="#1a1a1a" opacity="0.5"/><rect x="2" y="2" width="17" height="7" rx="1.5" fill="#1a1a1a"/><rect x="21.5" y="3.5" width="1.5" height="4" rx="0.75" fill="#1a1a1a" opacity="0.5"/></svg>
        </div>
      </div>
      {children}
      {!noHomeIndicator && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 24, display: "flex", justifyContent: "center", alignItems: "flex-end", paddingBottom: 8, pointerEvents: "none" }}>
          <div style={{ width: 134, height: 5, borderRadius: 5, background: "#1a1a1a" }} />
        </div>
      )}
    </div>
  );
}

/* "New Job" header used inside the phone */
function PhoneHeader({ title = "New Job" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 8px 12px",
      flex: "none",
    }}>
      <button className="tap" style={{
        width: 40, height: 40, borderRadius: 12, border: "none",
        background: "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text)",
      }}>
        <I.back />
      </button>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{title}</div>
    </div>
  );
}

/* Toast — matches design vocabulary: warm dark, mono accent */
function Toast({ children, tone = "neutral" }) {
  const tones = {
    neutral: { bg: "#1a1a1a", fg: "#ffffff", icon: "#ffffff" },
    success: { bg: "#1f6f3e", fg: "#ffffff", icon: "#bfe7cd" },
  };
  const c = tones[tone];
  return (
    <div style={{
      position: "absolute", left: 16, right: 16, top: 56,
      background: c.bg, color: c.fg,
      borderRadius: 12, padding: "12px 14px",
      display: "flex", alignItems: "center", gap: 10,
      fontSize: 13, fontWeight: 500, lineHeight: 1.4,
      boxShadow: "0 8px 24px rgba(26, 22, 18, 0.15)",
      animation: "fadeSlideIn 0.25s ease-out",
      zIndex: 5,
    }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 999, background: "rgba(255,255,255,0.14)", color: c.icon }}>
        <I.check />
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

/* Scrim used for modals */
function Scrim({ children, onClick }) {
  return (
    <div onClick={onClick} style={{
      position: "absolute", inset: 0,
      background: "rgba(26,22,18,0.42)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      animation: "fadeSlideIn 0.2s ease-out",
      zIndex: 10,
    }}>
      {children}
    </div>
  );
}

/* The "did you mean?" centered alert dialog used by both pickers */
function ConfirmModal({ tone = "info", title, body, onLeftClick, onRightClick, leftLabel, rightLabel }) {
  return (
    <Scrim>
      <div onClick={(e) => e.stopPropagation()} style={{
        margin: "auto",
        width: "calc(100% - 40px)", maxWidth: 340,
        background: "var(--bg)", borderRadius: 18,
        padding: "20px 20px 16px",
        border: "1px solid var(--border)",
      }}>
        {/* tone icon */}
        <div style={{
          width: 44, height: 44, borderRadius: 999,
          background: "var(--brand-tint)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--brand)", marginBottom: 12,
        }}>
          <I.sparkle />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em", marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.5 }}>{body}</div>

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={onLeftClick} className="tap" style={{
            flex: 1, height: 48, borderRadius: 12,
            background: "#ffffff", border: "1px solid var(--border)",
            fontSize: 14, fontWeight: 600, color: "var(--text)",
          }}>{leftLabel}</button>
          <button onClick={onRightClick} className="tap" style={{
            flex: 1, height: 48, borderRadius: 12,
            background: "var(--brand)", color: "#ffffff", border: "none",
            fontSize: 14, fontWeight: 700,
          }}>{rightLabel}</button>
        </div>
      </div>
    </Scrim>
  );
}

/* Selected card — collapsed state for either picker */
function SelectedCard({ icon, title, lines, badges, onChange }) {
  return (
    <div style={{
      background: "#ffffff", border: "1px solid var(--border)",
      borderRadius: 12, padding: 14,
      display: "flex", alignItems: "flex-start", gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, flex: "none", borderRadius: 8,
        background: "var(--brand-tint)", border: "1px solid #f3c8b3",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--brand)",
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.005em" }}>{title}</div>
          {badges}
        </div>
        {lines && lines.map((l, i) => (
          <div key={i} style={{ fontSize: 13, color: "var(--text-2)", marginTop: i === 0 ? 4 : 2, lineHeight: 1.4 }}>{l}</div>
        ))}
      </div>
      <button onClick={onChange} className="tap" style={{
        flex: "none", height: 36, padding: "0 12px", borderRadius: 8,
        background: "transparent", border: "1px solid var(--border)",
        fontSize: 13, fontWeight: 600, color: "var(--text)",
        display: "inline-flex", alignItems: "center", gap: 4,
      }}>
        <I.edit />
        Change
      </button>
    </div>
  );
}

/* Combobox input shell + dropdown panel layout used by both pickers */
function ComboInput({ value, onChange, placeholder, leftIcon, type = "text", onClear, ariaExpanded, autoFocus }) {
  return (
    <div className="focus-ring" style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "#ffffff", border: "1px solid var(--border-strong)",
      borderRadius: 12, padding: "0 12px",
      height: 52, transition: "border-color 0.12s, box-shadow 0.12s",
    }}>
      <span style={{ color: "var(--text-3)", display: "flex" }}>{leftIcon}</span>
      <input
        type={type}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-expanded={ariaExpanded}
        role="combobox"
        autoComplete="off"
        style={{
          flex: 1, height: "100%",
          border: "none", outline: "none", background: "transparent",
          fontSize: 16, color: "var(--text)",
          fontFamily: "inherit",
        }}
      />
      {value && onClear && (
        <button onClick={onClear} aria-label="Clear" style={{
          width: 26, height: 26, borderRadius: 999,
          background: "var(--container-low)", border: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-3)", flex: "none",
        }}><I.x /></button>
      )}
    </div>
  );
}

/* Dropdown shell anchored to input */
function Dropdown({ children, footer }) {
  return (
    <div style={{
      marginTop: 6,
      background: "#ffffff", border: "1px solid var(--border)",
      borderRadius: 12, overflow: "hidden",
      boxShadow: "0 8px 24px rgba(26, 22, 18, 0.06), 0 1px 3px rgba(26, 22, 18, 0.04)",
      animation: "fadeSlideIn 0.15s ease-out",
    }}>
      <div style={{ maxHeight: 380, overflowY: "auto" }} className="no-scrollbar">
        {children}
      </div>
      {footer && (
        <div style={{ borderTop: "1px solid var(--border)", background: "#fbf6f2" }}>
          {footer}
        </div>
      )}
    </div>
  );
}

/* "+ Create new" sticky-bottom button row */
function CreateNewRow({ label, onClick }) {
  return (
    <button onClick={onClick} className="tap" style={{
      display: "flex", alignItems: "center", gap: 10,
      width: "100%", padding: "14px 16px",
      background: "transparent", border: "none",
      color: "var(--brand)", fontSize: 14, fontWeight: 600,
      textAlign: "left", cursor: "pointer",
    }}>
      <span style={{
        width: 24, height: 24, borderRadius: 999,
        background: "var(--brand-tint)", border: "1px solid #f3c8b3",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}><I.plus /></span>
      {label}
    </button>
  );
}

/* SectionLabel inside dropdown — used for "Sarah's properties" header */
function DropSection({ children, accent = false }) {
  return (
    <div style={{
      padding: "10px 16px 6px",
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: accent ? "var(--brand)" : "var(--text-3)",
      display: "flex", alignItems: "center", gap: 6,
      background: accent ? "var(--brand-tint)" : "transparent",
      borderTop: "1px solid var(--border)",
    }}>{children}</div>
  );
}

/* Form field used inside inline create */
function FormField({ label, required, children, hint }) {
  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <MonoLabel>{label}</MonoLabel>
        {required && <span style={{ fontFamily: '"Geist Mono", ui-monospace, monospace', fontSize: 10, fontWeight: 700, color: "var(--brand)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Required</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <div className="focus-ring" style={{
      background: "#ffffff", border: "1px solid var(--border)",
      borderRadius: 10,
    }}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", height: 44,
          padding: "0 12px",
          border: "none", outline: "none", background: "transparent",
          fontSize: 16, color: "var(--text)",
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}

function RadioPair({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {options.map(o => {
        const sel = value === o.v;
        return (
          <button key={o.v} onClick={() => onChange(o.v)} className="tap" style={{
            flex: 1, height: 48, borderRadius: 10,
            background: sel ? "var(--brand-tint)" : "#ffffff",
            border: `1px solid ${sel ? "var(--brand)" : "var(--border)"}`,
            color: sel ? "var(--brand)" : "var(--text)",
            fontSize: 14, fontWeight: sel ? 700 : 500,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            cursor: "pointer",
          }}>
            <span style={{
              width: 16, height: 16, borderRadius: 999,
              border: `2px solid ${sel ? "var(--brand)" : "var(--border-strong)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flex: "none",
            }}>
              {sel && <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--brand)" }} />}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* Background page used behind a modal when the picker is invoked */
function NewJobBackdrop({ stage = "customer-empty" }) {
  return (
    <div style={{ position: "absolute", inset: "44px 0 0 0", overflow: "hidden", padding: 0 }}>
      <PhoneHeader />
      <div style={{ padding: "0 16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionDivider label="Customer" />
        <div style={{
          background: "#ffffff", border: "1px solid var(--border)",
          borderRadius: 12, padding: 14, opacity: 0.9,
        }}>
          <MonoLabel>Customer</MonoLabel>
          <div style={{ marginTop: 10, height: 52, borderRadius: 10, background: "var(--container-low)", display: "flex", alignItems: "center", padding: "0 12px", color: "var(--text-3)", fontSize: 14 }}>
            Sarah Johns…
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionDivider({ label, count }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0 4px" }}>
      <MonoLabel>{label}</MonoLabel>
      {count != null && <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{count}</div>}
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

/* Export to globals so other Babel scripts can use them. */
Object.assign(window, {
  I, SAMPLE_CUSTOMERS, SAMPLE_PROPERTIES_SARAH, SAMPLE_PROPERTIES_OTHER,
  Pill, MonoLabel, Avatar, Highlight,
  Phone, PhoneHeader, Toast, Scrim, ConfirmModal,
  SelectedCard, ComboInput, Dropdown, CreateNewRow, DropSection,
  FormField, TextInput, RadioPair, SectionDivider, NewJobBackdrop,
});
