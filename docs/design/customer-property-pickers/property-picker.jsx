/* global React */
const { useState: useStateP, useMemo: useMemoP } = React;

/* ============================================================
   Property Picker — same vocabulary as Customer.
   States: empty, typing, results (with optional customer-boost),
           exact_toast, fuzzy_modal, selected, silent_create_toast
   ============================================================ */

/* -------- Result row (used in dropdown) -------- */
function PropertyRow({ p, query, onSelect, badge }) {
  return (
    <button onClick={onSelect} className="tap" style={{
      display: "flex", alignItems: "center", gap: 12,
      width: "100%", padding: "12px 16px",
      background: "transparent", border: "none",
      textAlign: "left", cursor: "pointer",
      borderTop: "1px solid var(--border)",
    }}>
      <div style={{
        width: 36, height: 36, flex: "none", borderRadius: 8,
        background: "var(--container-low)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-2)",
      }}><I.pin /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 600, color: "var(--text)",
          letterSpacing: "-0.005em",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          <Highlight text={p.line1} query={query} />
        </div>
        <div style={{
          fontSize: 13, color: "var(--text-2)", marginTop: 2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          <span><Highlight text={`${p.city}, ${p.state} ${p.zip}`} query={query} /></span>
          {p.lastJob && <> <span style={{ color: "var(--text-3)" }}>·</span> <span style={{ color: "var(--text-3)" }}>last job {p.lastJob}</span></>}
        </div>
      </div>
      {badge}
    </button>
  );
}

/* Property search panel — shows boosted "Sarah's properties" if customer */
function PropertySearchPanel({ query, onChange, onSelect, onCreateNew, customer, autoFocus }) {
  const trimmed = (query || "").trim();
  const isTyping = trimmed.length > 0 && trimmed.length < 3;

  /* fake search — boost customer's properties to top */
  const { boosted, others } = useMemoP(() => {
    if (!trimmed || isTyping) return { boosted: [], others: [] };
    const q = trimmed.toLowerCase();
    const all = [...SAMPLE_PROPERTIES_SARAH, ...SAMPLE_PROPERTIES_OTHER];
    const matches = all.filter(p =>
      p.line1.toLowerCase().includes(q) ||
      p.city.toLowerCase().includes(q) ||
      p.zip.includes(q.replace(/\D/g, ""))
    );
    if (customer) {
      return {
        boosted: matches.filter(p => p.customer === customer.id),
        others:  matches.filter(p => p.customer !== customer.id),
      };
    }
    return { boosted: [], others: matches };
  }, [trimmed, isTyping, customer]);

  const showDropdown = trimmed.length > 0;
  const customerFirst = (customer?.name || "").split(" ")[0];

  return (
    <div>
      <ComboInput
        autoFocus={autoFocus}
        value={query}
        onChange={onChange}
        onClear={() => onChange("")}
        placeholder="Address, city, or ZIP…"
        leftIcon={<I.pin />}
        ariaExpanded={showDropdown}
      />
      {showDropdown && (
        <Dropdown footer={
          <CreateNewRow label="Create new property" onClick={() => onCreateNew(trimmed)} />
        }>
          {/* typing state */}
          {isTyping && (
            <div style={{ padding: "20px 16px", display: "flex", alignItems: "center", gap: 10, color: "var(--text-3)", fontSize: 13 }}>
              <span style={{ display: "flex", gap: 4 }}>
                <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--text-3)" }} />
                <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--text-3)" }} />
                <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--text-3)" }} />
              </span>
              Validating address…
            </div>
          )}

          {/* boosted section */}
          {!isTyping && boosted.length > 0 && (
            <>
              <DropSection accent>
                <I.sparkle /> {customerFirst}'s properties · {boosted.length}
              </DropSection>
              {boosted.map(p => (
                <PropertyRow key={p.id} p={p} query={trimmed} onSelect={() => onSelect(p)}
                  badge={p.note === "primary" && (
                    <Pill tone="brandSoft">primary</Pill>
                  )} />
              ))}
            </>
          )}

          {/* other matches */}
          {!isTyping && others.length > 0 && (
            <>
              {boosted.length > 0 && <DropSection>Other matches</DropSection>}
              {others.map(p => (
                <PropertyRow key={p.id} p={p} query={trimmed} onSelect={() => onSelect(p)} />
              ))}
            </>
          )}

          {/* no results */}
          {!isTyping && boosted.length === 0 && others.length === 0 && (
            <div style={{ padding: "18px 16px" }}>
              <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.45 }}>
                No address matches <strong style={{ color: "var(--text)" }}>"{trimmed}"</strong>.
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                We'll create one with the canonicalized form when you continue.
              </div>
            </div>
          )}
        </Dropdown>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ */
/* Property artboards                                            */
/* ------------------------------------------------------------ */

function PropertyArtShell({ children, modal, toast, customerSelected }) {
  const c = customerSelected ? SAMPLE_CUSTOMERS[0] : null;
  return (
    <Phone>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <div style={{ height: "100%", overflowY: "auto", paddingBottom: 100 }} className="no-scrollbar">
          <PhoneHeader />
          <div style={{ padding: "0 16px" }}>
            {/* tiny customer summary above */}
            {c && (
              <div style={{ marginBottom: 8 }}>
                <SectionDivider label="Customer" />
                <div style={{
                  background: "#ffffff", border: "1px solid var(--border)",
                  borderRadius: 12, padding: "10px 12px",
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <Avatar name={c.name} type={c.type} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-2)" }}>{c.entity}</div>
                  </div>
                  <button className="tap" style={{
                    height: 30, padding: "0 10px", borderRadius: 8,
                    background: "transparent", border: "1px solid var(--border)",
                    fontSize: 12, fontWeight: 600, color: "var(--text-2)",
                  }}>Change</button>
                </div>
              </div>
            )}

            <SectionDivider label="Property" />
            {children}
          </div>
        </div>
        {toast}
        {modal}
      </div>
    </Phone>
  );
}

/* 1 · Empty (no customer) */
function PropertyEmpty() {
  return (
    <PropertyArtShell>
      <PropertySearchPanel query="" onChange={() => {}} onSelect={() => {}} onCreateNew={() => {}} />
      <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, paddingLeft: 4 }}>
        Validated by Google. We'll save the canonicalized address.
      </div>
    </PropertyArtShell>
  );
}

/* 2 · Typing */
function PropertyTyping() {
  return (
    <PropertyArtShell customerSelected>
      <PropertySearchPanel query="104" onChange={() => {}} onSelect={() => {}} onCreateNew={() => {}}
        customer={SAMPLE_CUSTOMERS[0]} />
    </PropertyArtShell>
  );
}

/* 3 · Results — boosted "Sarah's properties" */
function PropertyResultsBoosted() {
  return (
    <PropertyArtShell customerSelected>
      <PropertySearchPanel query="maple" onChange={() => {}} onSelect={() => {}} onCreateNew={() => {}}
        customer={SAMPLE_CUSTOMERS[0]} />
    </PropertyArtShell>
  );
}

/* 4 · Exact match — auto-fill + toast */
function PropertyExactMatch() {
  const p = SAMPLE_PROPERTIES_SARAH[0];
  return (
    <PropertyArtShell customerSelected toast={
      <Toast>Using existing property <strong>1042 Maple St</strong></Toast>
    }>
      <SelectedCard
        icon={<I.pin />}
        title={p.line1}
        badges={<Pill tone="brandSoft">primary</Pill>}
        lines={[
          <span key="cs" className="mono">{p.city}, {p.state} {p.zip}</span>,
          <span key="cnt" style={{ fontSize: 12, color: "var(--text-3)" }}>4 prior jobs at this address</span>,
        ]}
        onChange={() => {}}
      />
    </PropertyArtShell>
  );
}

/* 5 · Close-tier modal */
function PropertyFuzzyModal() {
  return (
    <PropertyArtShell customerSelected modal={
      <ConfirmModal
        title="Did you mean 1042 Maple St?"
        body={<>
          You typed <strong style={{ color: "var(--text)" }}>"1042 maple, beaverton"</strong>. Google validated this to:<br/>
          <strong style={{ color: "var(--text)" }}>1042 Maple St, Beaverton, OR 97005</strong>
        </>}
        leftLabel="No, use what I typed"
        rightLabel="Yes, use existing"
        onLeftClick={() => {}}
        onRightClick={() => {}}
      />
    }>
      <ComboInput value="1042 maple, beaverton" onChange={() => {}} placeholder="Address…" leftIcon={<I.pin />} onClear={() => {}} />
    </PropertyArtShell>
  );
}

/* 6 · No match → silent create with toast */
function PropertySilentCreate() {
  return (
    <PropertyArtShell customerSelected toast={
      <Toast>Created new property <strong>880 Riverstone Way</strong></Toast>
    }>
      <SelectedCard
        icon={<I.pin />}
        title="880 Riverstone Way"
        badges={<Pill tone="success">new</Pill>}
        lines={[
          <span key="cs" className="mono">Hillsboro, OR 97124</span>,
          <span key="src" style={{ fontSize: 12, color: "var(--text-3)" }}>Canonicalized by Google · just now</span>,
        ]}
        onChange={() => {}}
      />
    </PropertyArtShell>
  );
}

/* 7 · Selected card (post-selection, no customer linked) */
function PropertySelected() {
  return (
    <PropertyArtShell>
      <SelectedCard
        icon={<I.pin />}
        title="1408 SE 22nd Ave"
        badges={null}
        lines={[
          <span key="cs" className="mono">Portland, OR 97214</span>,
          <span key="src" style={{ fontSize: 12, color: "var(--text-3)" }}>Validated · Google Address API</span>,
        ]}
        onChange={() => {}}
      />
    </PropertyArtShell>
  );
}

Object.assign(window, {
  PropertyRow, PropertySearchPanel, PropertyArtShell,
  PropertyEmpty, PropertyTyping, PropertyResultsBoosted,
  PropertyExactMatch, PropertyFuzzyModal, PropertySilentCreate, PropertySelected,
});
