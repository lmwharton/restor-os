/* global React */
const { useState: useStateC, useEffect: useEffectC, useMemo: useMemoC } = React;

/* ============================================================
   Customer Picker — single render is parameterized by `state`
   States: empty, typing, results, exact_toast, fuzzy_modal,
           no_match_form, selected
   Used standalone in artboards AND as the main control in the
   interactive playground.
   ============================================================ */

/* -------- Result row (used in dropdown) -------- */
function CustomerRow({ c, query, onSelect, accent }) {
  return (
    <button onClick={onSelect} className="tap" style={{
      display: "flex", alignItems: "center", gap: 12,
      width: "100%", padding: "12px 16px",
      background: "transparent", border: "none",
      textAlign: "left", cursor: "pointer",
      borderTop: "1px solid var(--border)",
    }}>
      <Avatar name={c.name} type={c.type} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 600, color: "var(--text)",
          letterSpacing: "-0.005em",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          <Highlight text={c.name} query={query} />
        </div>
        <div style={{
          fontSize: 13, color: "var(--text-2)", marginTop: 2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {c.entity && <>
            <span><Highlight text={c.entity} query={query} /></span>
            <span style={{ color: "var(--text-3)" }}>·</span>
          </>}
          <span className="mono"><Highlight text={c.phone_red} query={query} /></span>
        </div>
      </div>
      {accent && (
        <span style={{
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
          color: "var(--brand)", textTransform: "uppercase",
        }}>{accent}</span>
      )}
    </button>
  );
}

/* -------- Inline create form (state: no_match) -------- */
function InlineCreateCustomer({ initialName = "", initialPhone = "", onCancel, onCreate }) {
  const [name, setName]   = useStateC(initialName);
  const [entity, setEntity] = useStateC("");
  const [phone, setPhone] = useStateC(initialPhone);
  const [email, setEmail] = useStateC("");
  const [type, setType]   = useStateC("individual");

  return (
    <div style={{
      marginTop: 6,
      background: "#ffffff", border: "1px solid var(--border)",
      borderRadius: 12, padding: 16,
      animation: "fadeSlideIn 0.18s ease-out",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <MonoLabel accent>Create new customer</MonoLabel>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>No match for "{initialName || initialPhone}"</div>
        </div>
        <button onClick={onCancel} className="tap" aria-label="Cancel" style={{
          width: 36, height: 36, borderRadius: 999,
          background: "var(--container-low)", border: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-3)",
        }}><I.x /></button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormField label="Customer type">
          <RadioPair value={type} onChange={setType} options={[
            { v: "individual", label: "Individual" },
            { v: "commercial", label: "Commercial" },
          ]}/>
        </FormField>

        <FormField label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="Full name" />
        </FormField>

        {type === "commercial" && (
          <FormField label="Entity / company">
            <TextInput value={entity} onChange={setEntity} placeholder="ABC Property Mgmt" />
          </FormField>
        )}

        <FormField label="Phone" required>
          <TextInput value={phone} onChange={setPhone} placeholder="(503) 555‑0192" type="tel" />
        </FormField>

        <FormField label="Email">
          <TextInput value={email} onChange={setEmail} placeholder="customer@email.com" type="email" />
        </FormField>
      </div>

      <button onClick={() => onCreate({ name, entity, phone, email, type })} className="tap" style={{
        marginTop: 16, width: "100%", height: 52, borderRadius: 12,
        background: "var(--brand)", color: "#ffffff", border: "none",
        fontSize: 15, fontWeight: 700,
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        cursor: "pointer",
      }}>
        Create &amp; use
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m0 0l-5-5m5 5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </div>
  );
}

/* -------- Empty / typing / results dropdown -------- */
function CustomerSearchPanel({ query, onChange, onSelect, onCreateNew, autoFocus }) {
  const trimmed = (query || "").trim();
  const isTyping = trimmed.length > 0 && trimmed.length < 3;

  /* fake search */
  const matches = useMemoC(() => {
    if (!trimmed || isTyping) return [];
    const q = trimmed.toLowerCase();
    return SAMPLE_CUSTOMERS.filter(c => {
      return c.name.toLowerCase().includes(q)
          || (c.entity || "").toLowerCase().includes(q)
          || c.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""))
          || c.email.toLowerCase().includes(q);
    });
  }, [trimmed, isTyping]);

  const showDropdown = trimmed.length > 0;

  return (
    <div>
      <ComboInput
        autoFocus={autoFocus}
        value={query}
        onChange={onChange}
        onClear={() => onChange("")}
        placeholder="Phone, name, or email…"
        leftIcon={<I.search />}
        ariaExpanded={showDropdown}
      />
      {showDropdown && (
        <Dropdown footer={
          <CreateNewRow label="Create new customer" onClick={() => onCreateNew(trimmed)} />
        }>
          {/* typing state */}
          {isTyping && (
            <div style={{ padding: "20px 16px", display: "flex", alignItems: "center", gap: 10, color: "var(--text-3)", fontSize: 13 }}>
              <span style={{ display: "flex", gap: 4 }}>
                <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--text-3)" }} />
                <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--text-3)" }} />
                <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--text-3)" }} />
              </span>
              Searching…
            </div>
          )}

          {/* results */}
          {!isTyping && matches.length > 0 && matches.map(c => (
            <CustomerRow key={c.id} c={c} query={trimmed} onSelect={() => onSelect(c)} />
          ))}

          {/* no results */}
          {!isTyping && matches.length === 0 && (
            <div style={{ padding: "18px 16px" }}>
              <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.45 }}>
                No customer matches <strong style={{ color: "var(--text)" }}>"{trimmed}"</strong>.
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                Pick "Create new customer" below to add one.
              </div>
            </div>
          )}
        </Dropdown>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ */
/* Self-contained artboard variants used by the design canvas    */
/* ------------------------------------------------------------ */

/* All artboards use the same phone shell + "New Job → Customer" position.
   Difference is only what's shown for the customer field. */

function CustomerArtShell({ children, modal, toast, label }) {
  return (
    <Phone>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <div style={{ height: "100%", overflowY: "auto", paddingBottom: 100 }} className="no-scrollbar">
          <PhoneHeader />
          <div style={{ padding: "0 16px" }}>
            {label && <SectionDivider label={label} />}
            {children}
          </div>
        </div>
        {toast}
        {modal}
      </div>
    </Phone>
  );
}

/* 1 · Empty */
function CustomerEmpty() {
  return (
    <CustomerArtShell label="Customer">
      <CustomerSearchPanel query="" onChange={() => {}} onSelect={() => {}} onCreateNew={() => {}} />
      <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, paddingLeft: 4 }}>
        Phone is the fastest match. Three digits is enough.
      </div>
    </CustomerArtShell>
  );
}

/* 2 · Typing — debouncing */
function CustomerTyping() {
  return (
    <CustomerArtShell label="Customer">
      <CustomerSearchPanel query="50" onChange={() => {}} onSelect={() => {}} onCreateNew={() => {}} />
    </CustomerArtShell>
  );
}

/* 3 · Results — multiple matches */
function CustomerResults() {
  return (
    <CustomerArtShell label="Customer">
      <CustomerSearchPanel query="Sarah" onChange={() => {}} onSelect={() => {}} onCreateNew={() => {}} />
    </CustomerArtShell>
  );
}

/* 4 · Exact phone match — selected silently with toast */
function CustomerExactMatch() {
  const c = SAMPLE_CUSTOMERS[0];
  return (
    <CustomerArtShell label="Customer" toast={
      <Toast tone="neutral">
        Using existing customer <strong>Sarah Johnson</strong>
      </Toast>
    }>
      <SelectedCard
        icon={<I.user />}
        title={c.name}
        badges={<Pill tone={c.type}>{c.type === "commercial" ? "Commercial" : "Individual"}</Pill>}
        lines={[
          <span key="ph" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--text-3)" }}><I.phone /></span>
            <span className="mono">{c.phone}</span>
          </span>,
          <>
            {c.entity ? <>{c.entity} · <span className="mono">{c.email}</span></> : <span className="mono">{c.email}</span>}
          </>,
          <span key="props" style={{ fontSize: 12, color: "var(--text-3)" }}>{c.properties} {c.properties === 1 ? "property" : "properties"} on file</span>,
        ]}
        onChange={() => {}}
      />
    </CustomerArtShell>
  );
}

/* 5 · Fuzzy match modal */
function CustomerFuzzyModal() {
  return (
    <CustomerArtShell label="Customer" modal={
      <ConfirmModal
        title="Did you mean Sarah Johnson?"
        body={<>
          Found a close match for what you typed.<br/>
          <strong style={{ color: "var(--text)" }}>Sarah Johnson</strong> at <strong style={{ color: "var(--text)" }}>ABC Property Mgmt</strong> · <span className="mono">(503) 555‑••92</span>
        </>}
        leftLabel="No, create new"
        rightLabel="Yes, use existing"
        onLeftClick={() => {}}
        onRightClick={() => {}}
      />
    }>
      <CustomerSearchPanel query="Sara Johnson abc" onChange={() => {}} onSelect={() => {}} onCreateNew={() => {}} />
    </CustomerArtShell>
  );
}

/* 6 · No-match → inline create */
function CustomerNoMatchCreate() {
  return (
    <CustomerArtShell label="Customer">
      <ComboInput
        value="Mae Quinones"
        onChange={() => {}}
        placeholder="Phone, name, or email…"
        leftIcon={<I.search />}
        onClear={() => {}}
      />
      <InlineCreateCustomer
        initialName="Mae Quinones"
        initialPhone=""
        onCancel={() => {}}
        onCreate={() => {}}
      />
    </CustomerArtShell>
  );
}

/* 7 · Selected card (after selection from any path) */
function CustomerSelected() {
  const c = SAMPLE_CUSTOMERS[3]; // Marcus Holmes — commercial, 6 properties
  return (
    <CustomerArtShell label="Customer">
      <SelectedCard
        icon={<I.building />}
        title={c.name}
        badges={<Pill tone={c.type}>{c.type === "commercial" ? "Commercial" : "Individual"}</Pill>}
        lines={[
          <span key="ent" style={{ fontWeight: 500, color: "var(--text)" }}>{c.entity}</span>,
          <span key="ph" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--text-3)" }}><I.phone /></span>
            <span className="mono">{c.phone}</span>
            <span style={{ color: "var(--text-3)" }}>·</span>
            <span className="mono">{c.email}</span>
          </span>,
          <span key="props" style={{ fontSize: 12, color: "var(--text-3)" }}>{c.properties} properties on file</span>,
        ]}
        onChange={() => {}}
      />
    </CustomerArtShell>
  );
}

Object.assign(window, {
  CustomerRow, InlineCreateCustomer, CustomerSearchPanel, CustomerArtShell,
  CustomerEmpty, CustomerTyping, CustomerResults,
  CustomerExactMatch, CustomerFuzzyModal, CustomerNoMatchCreate, CustomerSelected,
});
