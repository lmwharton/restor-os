/* global React */
const { useState: useStateF } = React;

/* ============================================================
   Full new-job form — mobile (390) + desktop (1280)
   Customer + Property pickers slot in alongside loss fields.
   ============================================================ */

const LOSS_TYPES = [
  { v: "water", label: "Water" },
  { v: "fire",  label: "Fire" },
  { v: "mold",  label: "Mold" },
  { v: "storm", label: "Storm" },
  { v: "other", label: "Other" },
];

function LossTypeChips({ value, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {LOSS_TYPES.map(t => {
        const sel = value === t.v;
        return (
          <button key={t.v} onClick={() => onChange(t.v)} className="tap" style={{
            height: 36, padding: "0 14px", borderRadius: 999,
            background: sel ? "var(--brand)" : "#ffffff",
            color: sel ? "#ffffff" : "var(--text-2)",
            border: sel ? "none" : "1px solid var(--border)",
            fontSize: 13, fontWeight: sel ? 700 : 500,
            cursor: "pointer",
          }}>{t.label}</button>
        );
      })}
    </div>
  );
}

function CategorySegments({ label, value, onChange, options }) {
  return (
    <div>
      <MonoLabel>{label}</MonoLabel>
      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        {options.map(o => {
          const sel = o.v === value;
          return (
            <button key={o.v} onClick={() => onChange(o.v)} className="tap" style={{
              flex: 1, height: 40, borderRadius: 8,
              background: sel ? "var(--brand)" : "#ffffff",
              color: sel ? "#ffffff" : "var(--text-2)",
              border: sel ? "none" : "1px solid var(--border)",
              fontSize: 13, fontWeight: sel ? 700 : 500,
              cursor: "pointer",
            }}>{o.label}</button>
          );
        })}
      </div>
    </div>
  );
}

function FormSection({ title, num, children, accent }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        {num != null && (
          <div style={{
            width: 22, height: 22, borderRadius: 999,
            background: accent ? "var(--brand)" : "var(--container)",
            color: accent ? "#ffffff" : "var(--text-2)",
            fontSize: 11, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: '"Geist Mono", ui-monospace, monospace',
          }}>{num}</div>
        )}
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.005em" }}>{title}</div>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>
      {children}
    </div>
  );
}

/* ---- Mobile form (390 wide) ---- */
function NewJobMobile() {
  const c = SAMPLE_CUSTOMERS[0];
  const p = SAMPLE_PROPERTIES_SARAH[0];
  return (
    <Phone>
      <div style={{ flex: 1, overflowY: "auto" }} className="no-scrollbar">
        {/* sticky-ish header */}
        <div style={{
          padding: "8px 12px 12px",
          display: "flex", alignItems: "center", gap: 8,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
        }}>
          <button className="tap" style={{
            width: 40, height: 40, borderRadius: 12, border: "none", background: "transparent",
            display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text)",
          }}><I.back /></button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>New Job</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>JOB-20260428-•••</div>
          </div>
        </div>

        <div style={{ padding: "16px 16px 100px", display: "flex", flexDirection: "column", gap: 22 }}>
          {/* job type */}
          <div>
            <MonoLabel>Job type</MonoLabel>
            <div style={{ marginTop: 8, display: "inline-flex", padding: 4, borderRadius: 999, background: "var(--container-low)" }}>
              <button className="tap" style={{ height: 36, padding: "0 18px", borderRadius: 999, background: "var(--brand)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: "#fff" }} /> Mitigation
              </button>
              <button className="tap" style={{ height: 36, padding: "0 18px", borderRadius: 999, background: "transparent", color: "var(--text-2)", border: "none", fontSize: 13, fontWeight: 600 }}>
                Reconstruction
              </button>
            </div>
          </div>

          {/* CUSTOMER */}
          <FormSection title="Customer" num="1">
            <SelectedCard
              icon={<I.user />}
              title={c.name}
              badges={<Pill tone={c.type}>Commercial</Pill>}
              lines={[
                <span key="ent" style={{ fontWeight: 500, color: "var(--text)" }}>{c.entity}</span>,
                <span key="ph" className="mono">{c.phone}</span>,
                <span key="props" style={{ fontSize: 12, color: "var(--text-3)" }}>{c.properties} properties on file</span>,
              ]}
            />
          </FormSection>

          {/* PROPERTY */}
          <FormSection title="Property" num="2">
            <SelectedCard
              icon={<I.pin />}
              title={p.line1}
              badges={<Pill tone="brandSoft">primary</Pill>}
              lines={[
                <span key="cs" className="mono">{p.city}, {p.state} {p.zip}</span>,
                <span key="cnt" style={{ fontSize: 12, color: "var(--text-3)" }}>4 prior jobs at this address</span>,
              ]}
            />
          </FormSection>

          {/* LOSS */}
          <FormSection title="Loss" num="3">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FormField label="Loss type" required>
                <LossTypeChips value="water" onChange={() => {}} />
              </FormField>

              <CategorySegments label="Category" value="2" onChange={() => {}} options={[
                { v: "1", label: "Cat 1" }, { v: "2", label: "Cat 2" }, { v: "3", label: "Cat 3" },
              ]}/>

              <CategorySegments label="Class" value="2" onChange={() => {}} options={[
                { v: "1", label: "1" }, { v: "2", label: "2" }, { v: "3", label: "3" }, { v: "4", label: "4" },
              ]}/>

              <FormField label="Date of loss">
                <button className="tap" style={{
                  width: "100%", height: 48, borderRadius: 10,
                  background: "#ffffff", border: "1px solid var(--border)",
                  padding: "0 12px", display: "flex", alignItems: "center", gap: 10,
                  textAlign: "left",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                  <span className="mono" style={{ fontSize: 14, color: "var(--text)", fontWeight: 600 }}>Mon · Apr 27, 2026</span>
                </button>
              </FormField>

              <FormField label="Cause">
                <TextInput value="Burst supply line under sink" onChange={() => {}} placeholder="Burst pipe, appliance leak…" />
              </FormField>
            </div>
          </FormSection>

          {/* INSURANCE */}
          <FormSection title="Insurance" num="4">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FormField label="Carrier">
                <TextInput value="Allstate" onChange={() => {}} placeholder="State Farm, Allstate…" />
              </FormField>
              <FormField label="Claim number">
                <TextInput value="" onChange={() => {}} placeholder="CLM-2026-00128" />
              </FormField>
              <FormField label="Adjuster">
                <TextInput value="J. Park" onChange={() => {}} placeholder="Name" />
              </FormField>
            </div>
          </FormSection>
        </div>
      </div>

      {/* sticky create */}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        padding: "12px 16px calc(20px + env(safe-area-inset-bottom))",
        background: "linear-gradient(to top, var(--bg) 60%, rgba(255,248,244,0))",
      }}>
        <button className="tap" style={{
          width: "100%", height: 56, borderRadius: 14,
          background: "var(--brand)", color: "#ffffff", border: "none",
          fontSize: 16, fontWeight: 700,
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          Create job
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m0 0l-5-5m5 5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>
    </Phone>
  );
}

/* ---- Desktop form (1280×900-ish) ---- */
function NewJobDesktop() {
  const c = SAMPLE_CUSTOMERS[0];
  const p = SAMPLE_PROPERTIES_SARAH[0];
  return (
    <div style={{
      width: 1280, minHeight: 900, background: "var(--bg)",
      display: "flex", flexDirection: "column",
      fontFamily: 'var(--font-geist), system-ui, sans-serif',
    }}>
      {/* top bar */}
      <div style={{
        height: 60, padding: "0 28px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 16,
        background: "rgba(255, 248, 244, 0.85)", backdropFilter: "blur(12px)",
      }}>
        <button style={{
          width: 36, height: 36, borderRadius: 8, border: "1px solid var(--border)",
          background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-2)", cursor: "pointer",
        }}><I.back /></button>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>New job</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>JOB-20260428-•••</div>
        </div>

        <div style={{ marginLeft: 24, display: "inline-flex", padding: 4, borderRadius: 999, background: "var(--container-low)" }}>
          <button style={{ height: 32, padding: "0 18px", borderRadius: 999, background: "var(--brand)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#fff" }} /> Mitigation
          </button>
          <button style={{ height: 32, padding: "0 18px", borderRadius: 999, background: "transparent", color: "var(--text-2)", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Reconstruction</button>
        </div>

        <div style={{ flex: 1 }} />
        <button style={{
          height: 36, padding: "0 14px", borderRadius: 8,
          background: "transparent", border: "1px solid var(--border)",
          fontSize: 13, fontWeight: 600, color: "var(--text-2)",
        }}>Cancel</button>
        <button style={{
          height: 36, padding: "0 16px", borderRadius: 8,
          background: "var(--brand)", color: "#ffffff", border: "none",
          fontSize: 13, fontWeight: 700,
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          Create job
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m0 0l-5-5m5 5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      {/* body */}
      <div style={{
        flex: 1, padding: "28px 28px 60px",
        display: "grid", gridTemplateColumns: "1fr 320px", gap: 24,
        maxWidth: 1280, margin: "0 auto", width: "100%",
      }}>
        {/* main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Card: Customer + Property */}
          <div style={{
            background: "#ffffff", border: "1px solid var(--border)",
            borderRadius: 14, padding: 24,
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20,
          }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 999,
                  background: "var(--brand)", color: "#fff",
                  fontSize: 11, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: '"Geist Mono", ui-monospace, monospace',
                }}>1</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Customer</div>
              </div>
              <SelectedCard
                icon={<I.user />}
                title={c.name}
                badges={<Pill tone="commercial">Commercial</Pill>}
                lines={[
                  <span key="ent" style={{ fontWeight: 500, color: "var(--text)" }}>{c.entity}</span>,
                  <span key="ph" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span className="mono">{c.phone}</span>
                    <span style={{ color: "var(--text-3)" }}>·</span>
                    <span className="mono" style={{ fontSize: 12 }}>{c.email}</span>
                  </span>,
                  <span key="props" style={{ fontSize: 12, color: "var(--text-3)" }}>{c.properties} properties on file</span>,
                ]}
              />
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 999,
                  background: "var(--brand)", color: "#fff",
                  fontSize: 11, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: '"Geist Mono", ui-monospace, monospace',
                }}>2</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Property</div>
              </div>
              <SelectedCard
                icon={<I.pin />}
                title={p.line1}
                badges={<Pill tone="brandSoft">primary</Pill>}
                lines={[
                  <span key="cs" className="mono">{p.city}, {p.state} {p.zip}</span>,
                  <span key="cnt" style={{ fontSize: 12, color: "var(--text-3)" }}>4 prior jobs at this address · 47.4953, ‑122.8019</span>,
                ]}
              />
            </div>
          </div>

          {/* Card: Loss */}
          <div style={{ background: "#ffffff", border: "1px solid var(--border)", borderRadius: 14, padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 999,
                background: "var(--container)", color: "var(--text-2)",
                fontSize: 11, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: '"Geist Mono", ui-monospace, monospace',
              }}>3</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Loss</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <FormField label="Loss type" required>
                <LossTypeChips value="water" onChange={() => {}} />
              </FormField>
              <FormField label="Date of loss">
                <button style={{
                  width: "100%", height: 40, borderRadius: 8,
                  background: "#ffffff", border: "1px solid var(--border)",
                  padding: "0 12px", display: "flex", alignItems: "center", gap: 10,
                  textAlign: "left", cursor: "pointer",
                }}>
                  <span className="mono" style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>Apr 27, 2026</span>
                </button>
              </FormField>

              <CategorySegments label="Category" value="2" onChange={() => {}} options={[
                { v: "1", label: "Cat 1" }, { v: "2", label: "Cat 2" }, { v: "3", label: "Cat 3" },
              ]}/>
              <CategorySegments label="Class" value="2" onChange={() => {}} options={[
                { v: "1", label: "1" }, { v: "2", label: "2" }, { v: "3", label: "3" }, { v: "4", label: "4" },
              ]}/>

              <div style={{ gridColumn: "1 / -1" }}>
                <FormField label="Cause">
                  <TextInput value="Burst supply line under kitchen sink" onChange={() => {}} placeholder="Burst pipe, appliance leak…" />
                </FormField>
              </div>
            </div>
          </div>

          {/* Card: Insurance */}
          <div style={{ background: "#ffffff", border: "1px solid var(--border)", borderRadius: 14, padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 999,
                background: "var(--container)", color: "var(--text-2)",
                fontSize: 11, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: '"Geist Mono", ui-monospace, monospace',
              }}>4</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Insurance</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
              <FormField label="Carrier"><TextInput value="Allstate" onChange={() => {}} /></FormField>
              <FormField label="Claim number"><TextInput value="" onChange={() => {}} placeholder="CLM-2026-00128" /></FormField>
              <FormField label="Adjuster name"><TextInput value="J. Park" onChange={() => {}} /></FormField>
              <FormField label="Adjuster email"><TextInput value="jpark@allstate.com" onChange={() => {}} /></FormField>
              <FormField label="Adjuster phone"><TextInput value="(206) 555‑0144" onChange={() => {}} /></FormField>
            </div>
          </div>
        </div>

        {/* sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#ffffff", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
            <MonoLabel>To create this job</MonoLabel>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { ok: true,  txt: "Customer linked",      sub: "Sarah Johnson · ABC Property Mgmt" },
                { ok: true,  txt: "Property selected",    sub: "1042 Maple St (existing)" },
                { ok: true,  txt: "Loss type set",        sub: "Water · Cat 2 / Class 2" },
                { ok: false, txt: "Add claim number",     sub: "Optional, but speeds up close" },
              ].map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 999,
                    background: r.ok ? "#e7f6ec" : "var(--container-low)",
                    border: `1px solid ${r.ok ? "#b8e2c5" : "var(--border)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center", flex: "none",
                    color: r.ok ? "#1f6f3e" : "var(--text-3)", marginTop: 1,
                  }}>{r.ok && <I.check />}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: r.ok ? "var(--text-2)" : "var(--text)" }}>{r.txt}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{r.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: "#fbf6f2", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
            <MonoLabel>Tip</MonoLabel>
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
              Picking an existing customer auto-boosts their known properties to the top of the property search.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { NewJobMobile, NewJobDesktop });
