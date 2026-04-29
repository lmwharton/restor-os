/* global React */
const { useState: useStateA, useEffect: useEffectA } = React;

/* ============================================================
   Interactive playground — combines both pickers in one screen.
   Driven by Tweaks (or by typing real text).
   ============================================================ */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "scenario": "fresh",
  "viewport": "mobile"
}/*EDITMODE-END*/;

function PlaygroundPhone({ scenario, setTweak }) {

  const [custQuery, setCustQuery] = useStateA("");
  const [selectedCust, setSelectedCust] = useStateA(null);
  const [custToast, setCustToast] = useStateA(null);
  const [custModal, setCustModal] = useStateA(false);
  const [custCreate, setCustCreate] = useStateA(false);

  const [propQuery, setPropQuery] = useStateA("");
  const [selectedProp, setSelectedProp] = useStateA(null);
  const [propToast, setPropToast] = useStateA(null);
  const [propModal, setPropModal] = useStateA(false);

  /* respond to scenario changes */
  useEffectA(() => {
    setCustQuery(""); setSelectedCust(null); setCustToast(null); setCustModal(false); setCustCreate(false);
    setPropQuery(""); setSelectedProp(null); setPropToast(null); setPropModal(false);
    if (scenario === "exact_phone") {
      setCustQuery("5035550192");
      setTimeout(() => {
        setSelectedCust(SAMPLE_CUSTOMERS[0]);
        setCustToast("Using existing customer Sarah Johnson");
        setCustQuery("");
        setTimeout(() => setCustToast(null), 2800);
      }, 600);
    } else if (scenario === "fuzzy") {
      setCustQuery("Sara Johnson abc"); setCustModal(true);
    } else if (scenario === "no_match") {
      setCustQuery("Mae Quinones"); setCustCreate(true);
    } else if (scenario === "selected") {
      setSelectedCust(SAMPLE_CUSTOMERS[0]);
      setSelectedProp(SAMPLE_PROPERTIES_SARAH[0]);
    } else if (scenario === "boosted") {
      setSelectedCust(SAMPLE_CUSTOMERS[0]);
      setPropQuery("maple");
    }
  }, [scenario]);

  return (
    <Phone>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <div style={{ height: "100%", overflowY: "auto", paddingBottom: 100 }} className="no-scrollbar">
          <PhoneHeader />
          <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Customer */}
            <div>
              <SectionDivider label="Customer" />
              {selectedCust ? (
                <SelectedCard
                  icon={selectedCust.type === "commercial" ? <I.building /> : <I.user />}
                  title={selectedCust.name}
                  badges={<Pill tone={selectedCust.type}>{selectedCust.type === "commercial" ? "Commercial" : "Individual"}</Pill>}
                  lines={[
                    selectedCust.entity && <span key="ent">{selectedCust.entity}</span>,
                    <span key="ph" className="mono">{selectedCust.phone}</span>,
                  ].filter(Boolean)}
                  onChange={() => { setSelectedCust(null); setTweak({ scenario: "fresh" }); }}
                />
              ) : custCreate ? (
                <>
                  <ComboInput value={custQuery} onChange={setCustQuery} placeholder="Phone, name, or email…" leftIcon={<I.search />} onClear={() => { setCustQuery(""); setCustCreate(false); }} />
                  <InlineCreateCustomer
                    initialName={custQuery}
                    initialPhone=""
                    onCancel={() => { setCustCreate(false); setCustQuery(""); }}
                    onCreate={(c) => {
                      setSelectedCust({ ...c, id: "new", type: c.type, properties: 0, phone_red: c.phone });
                      setCustCreate(false); setCustQuery("");
                      setCustToast("Created customer " + c.name);
                      setTimeout(() => setCustToast(null), 2800);
                    }}
                  />
                </>
              ) : (
                <CustomerSearchPanel
                  query={custQuery}
                  onChange={setCustQuery}
                  onSelect={(c) => { setSelectedCust(c); setCustQuery(""); }}
                  onCreateNew={(q) => setCustCreate(true)}
                />
              )}
            </div>

            {/* Property */}
            <div>
              <SectionDivider label="Property" />
              {selectedProp ? (
                <SelectedCard
                  icon={<I.pin />}
                  title={selectedProp.line1}
                  badges={selectedProp.note === "primary" ? <Pill tone="brandSoft">primary</Pill> : null}
                  lines={[
                    <span key="cs" className="mono">{selectedProp.city}, {selectedProp.state} {selectedProp.zip}</span>,
                  ]}
                  onChange={() => setSelectedProp(null)}
                />
              ) : (
                <PropertySearchPanel
                  query={propQuery}
                  onChange={setPropQuery}
                  onSelect={(p) => { setSelectedProp(p); setPropQuery(""); }}
                  onCreateNew={() => {
                    setSelectedProp({ id: "new", line1: propQuery || "880 Riverstone Way", city: "Hillsboro", state: "OR", zip: "97124" });
                    setPropQuery("");
                    setPropToast("Created new property");
                    setTimeout(() => setPropToast(null), 2800);
                  }}
                  customer={selectedCust}
                />
              )}
            </div>
          </div>
        </div>
        {custToast && <Toast tone={custToast.startsWith("Created") ? "success" : "neutral"}>{custToast}</Toast>}
        {propToast && <Toast tone="success">{propToast}</Toast>}

        {custModal && (
          <ConfirmModal
            title="Did you mean Sarah Johnson?"
            body={<><strong style={{ color: "var(--text)" }}>Sarah Johnson</strong> at <strong style={{ color: "var(--text)" }}>ABC Property Mgmt</strong> · <span className="mono">(503) 555‑••92</span></>}
            leftLabel="No, create new"
            rightLabel="Yes, use existing"
            onLeftClick={() => { setCustModal(false); setCustCreate(true); }}
            onRightClick={() => {
              setSelectedCust(SAMPLE_CUSTOMERS[0]); setCustModal(false); setCustQuery("");
            }}
          />
        )}
      </div>
    </Phone>
  );
}

function PlaygroundTweaks({ scenario, setTweak }) {
  return (
    <window.TweaksPanel title="Tweaks · Picker scenarios">
      <window.TweakSection title="Customer scenario">
        <window.TweakRadio
          value={scenario}
          onChange={(v) => setTweak({ scenario: v })}
          options={[
            { value: "fresh",       label: "Fresh" },
            { value: "exact_phone", label: "Exact phone" },
            { value: "fuzzy",       label: "Fuzzy" },
            { value: "no_match",    label: "No match" },
            { value: "boosted",     label: "Boosted props" },
            { value: "selected",    label: "Both selected" },
          ]}
        />
      </window.TweakSection>
    </window.TweaksPanel>
  );
}

/* ============================================================
   Canvas app
   ============================================================ */
function App() {
  const { DesignCanvas, DCSection, DCArtboard } = window;
  const [tweaks, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  return (
    <>
      <DesignCanvas
        title="Crewmatic — Customer + Property pickers"
        subtitle="New-job creation flow · field-first · prevents duplicate records"
      >
        <DCSection id="customer" title="1 · Customer picker"
          subtitle="Combobox · debounced search · create-new fallback · 390×844">
          <DCArtboard id="cust-empty"     label="Empty"            width={390} height={844}><CustomerEmpty /></DCArtboard>
          <DCArtboard id="cust-typing"    label="Typing (< 3 chars)" width={390} height={844}><CustomerTyping /></DCArtboard>
          <DCArtboard id="cust-results"   label="Multiple matches"  width={390} height={844}><CustomerResults /></DCArtboard>
          <DCArtboard id="cust-exact"     label="Exact phone · auto-fill + toast" width={390} height={844}><CustomerExactMatch /></DCArtboard>
          <DCArtboard id="cust-fuzzy"     label="Close fuzzy · 'Did you mean?'" width={390} height={844}><CustomerFuzzyModal /></DCArtboard>
          <DCArtboard id="cust-create"    label="No match · inline create"  width={390} height={844}><CustomerNoMatchCreate /></DCArtboard>
          <DCArtboard id="cust-selected"  label="Selected card (commercial)" width={390} height={844}><CustomerSelected /></DCArtboard>
        </DCSection>

        <DCSection id="property" title="2 · Property picker"
          subtitle="Google-canonicalized · boosts customer's known properties when one is selected">
          <DCArtboard id="prop-empty"     label="Empty (no customer)" width={390} height={844}><PropertyEmpty /></DCArtboard>
          <DCArtboard id="prop-typing"    label="Typing · validating"  width={390} height={844}><PropertyTyping /></DCArtboard>
          <DCArtboard id="prop-boosted"   label="Boosted · Sarah's properties" width={390} height={844}><PropertyResultsBoosted /></DCArtboard>
          <DCArtboard id="prop-exact"     label="Exact tier · auto-fill + toast" width={390} height={844}><PropertyExactMatch /></DCArtboard>
          <DCArtboard id="prop-fuzzy"     label="Close tier · 'Did you mean?'" width={390} height={844}><PropertyFuzzyModal /></DCArtboard>
          <DCArtboard id="prop-silent"    label="No match · silent create + toast" width={390} height={844}><PropertySilentCreate /></DCArtboard>
          <DCArtboard id="prop-selected"  label="Selected card" width={390} height={844}><PropertySelected /></DCArtboard>
        </DCSection>

        <DCSection id="form" title="3 · New job form"
          subtitle="Both pickers slot in alongside loss + insurance fields">
          <DCArtboard id="form-mobile"  label="Mobile · 390 wide"  width={390}  height={844}><NewJobMobile /></DCArtboard>
          <DCArtboard id="form-desktop" label="Desktop · 1280 wide" width={1280} height={900}><NewJobDesktop /></DCArtboard>
        </DCSection>

        <DCSection id="playground" title="4 · Interactive playground"
          subtitle="Type real text or use the Tweaks toggle to cycle scenarios">
          <DCArtboard id="play" label="Live picker · type anything" width={390} height={844}>
            <PlaygroundPhone scenario={tweaks.scenario} setTweak={setTweak} />
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
      <PlaygroundTweaks scenario={tweaks.scenario} setTweak={setTweak} />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
