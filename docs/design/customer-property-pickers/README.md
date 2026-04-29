# Customer + Property Pickers — Design Handoff

This directory holds the **HTML/JS prototype** designed in Claude Design and exported as a handoff bundle. The prototype is the **source of truth for visual + interaction design** of the Customer Picker, Property Picker, and the New Job form (mobile + desktop) for **CREW-13** (Spec 01K).

The prototype is NOT production code — it's a pixel-perfect mock to be reproduced in our React/TypeScript stack with shadcn/Tailwind. Match the visual output; don't copy the prototype's internal structure.

## How to view the prototype

Open `Customer + Property Pickers.html` in a browser locally:

```bash
cd docs/design/customer-property-pickers
python3 -m http.server 8000
# open http://localhost:8000/Customer%20+%20Property%20Pickers.html
```

The host page renders all artboards on a single design canvas + an interactive playground driven by a Tweaks panel (cycles through customer / property states).

## Files

| File | Role |
|------|------|
| `Customer + Property Pickers.html` | Host page — loads React via CDN + every JSX file |
| `tokens.css` | Pulled from `web/src/app/globals.css`. Color tokens, type stack, status palette. **Already in our globals — don't re-create.** |
| `pickers-shared.jsx` | Atoms: `Pill`, `MonoLabel`, `Avatar`, `Highlight`, `Phone`, `PhoneHeader`, `Toast`, `Scrim`, `ConfirmModal`, `SelectedCard`, `ComboInput`, `Dropdown`, `CreateNewRow`, `DropSection`, `FormField`, `TextInput`, `RadioPair`, `SectionDivider`, `NewJobBackdrop`. Sample data: `SAMPLE_CUSTOMERS`, `SAMPLE_PROPERTIES_*`. |
| `customer-picker.jsx` | All 7 customer-picker states + the `CustomerSearchPanel` + `InlineCreateCustomer` form |
| `property-picker.jsx` | All 7 property-picker states + the `PropertySearchPanel` (with customer-scoped boost) |
| `new-job-form.jsx` | Full New Job form — both **mobile (390 wide)** and **desktop (1280 wide)** |
| `design-canvas.jsx` | Layout chrome — irrelevant to production |
| `tweaks-panel.jsx` | Playground state cycling — irrelevant to production |
| `pickers-app.jsx` | Top-level App that mounts the canvas + playground |
| `_handoff-readme.md` | Original Claude Design handoff README (keep for reference) |
| `_design-chat.md` | Original chat transcript with the design assistant — captures the WHY behind the designs |

## What each picker does (functional summary)

### CustomerPicker — 7 states

| State | Trigger | Visual |
|---|---|---|
| 1. Empty | Field has focus, query is empty | `<ComboInput>` with placeholder "Phone, name, or email…" + helper hint |
| 2. Typing (1–2 chars) | `query.length < 3` | Dropdown with animated typing dots ("Searching…") |
| 3. Results (3+ chars, hits) | `query.length >= 3` AND matches found | Dropdown lists `<CustomerRow>` with `<Highlight>` on matched substrings |
| 4. Exact phone match | API returned `tier=exact` | Field collapses to `<SelectedCard>` + `<Toast>` "Using existing customer Sarah Johnson" (auto-fill, no dialog) |
| 5. Fuzzy / close match | API returned `tier=close` | `<ConfirmModal>` over scrim — "Did you mean Sarah Johnson?" / [No, create new] [Yes, use existing] |
| 6. No match → inline create | API returned `tier=none` AND user picks "Create new customer" | `<InlineCreateCustomer>` form expands with: customer_type radio pair (Individual / Commercial), Name (required), Entity/company (only if commercial), Phone (required), Email |
| 7. Selected | Customer chosen via any path | `<SelectedCard>` collapsed view: avatar + name + Pill (Individual/Commercial) + entity + phone + email + "X properties on file" + [Change] button |

### PropertyPicker — 7 states

| State | Trigger | Visual |
|---|---|---|
| 1. Empty (no customer linked) | Field has focus, query empty, customer not yet selected | `<ComboInput>` with `<I.pin>` icon + placeholder "Address, city, or ZIP…" + helper "Validated by Google. We'll save the canonicalized address." |
| 2. Typing (1–2 chars) | `query.length < 3` | Dropdown with "Validating address…" typing dots |
| 3. Results — boosted | Customer is selected AND query matches | Dropdown shows TWO sections: `Sarah's properties · 3` (sparkle icon, `--brand-tint` background) FIRST, then `Other matches` |
| 4. Exact match | API `tier=exact` | `<SelectedCard>` + `<Toast>` "Using existing property 1042 Maple St" |
| 5. Fuzzy / close match | API `tier=close` | `<ConfirmModal>` — "Did you mean 1042 Maple St?" with the canonicalized form shown |
| 6. No match → silent create with toast | API `tier=none` after Google canonicalization | `<SelectedCard>` + `<Toast>` "Created new property 880 Riverstone Way". The picker auto-creates from Google's canonical components — no inline form needed |
| 7. Selected | Property chosen via any path | `<SelectedCard>` collapsed: pin icon + address line 1 + city/state/zip mono + "X prior jobs at this address" |

### New Job Form — mobile + desktop

**Mobile (390px wide)** — single column, 4 sections numbered 1–4:
1. Customer — `<SelectedCard>`
2. Property — `<SelectedCard>` (with primary badge)
3. Loss — Loss type chips (Water/Fire/Mold/Storm/Other) + Cat 1/2/3 segments + Class 1/2/3/4 segments + Date of loss button + Cause text
4. Insurance — Carrier / Claim number / Adjuster

Sticky "Create job" button at bottom, brand orange, full width.

**Desktop (1280px wide)** — 2-column layout:
- Main column (flex-1): same 4 sections, but Customer + Property are inside a single card (2 cols), Loss + Insurance in their own cards
- Sidebar (320px): "To create this job" checklist + Tip card

Top bar has Back / "New job" title / Job number monocode / Mitigation/Reconstruction segmented control / Cancel / Create job buttons.

## Mapping to production code

When implementing CREW-13 (and the new-job form rewrite), translate the prototype components into our existing patterns:

| Prototype | Production target |
|---|---|
| `<ComboInput>` (custom) | shadcn `<Command>` or `<Input>` + custom dropdown — match the 52px height, brand-orange focus ring at 18% opacity |
| `<Dropdown>` floating panel | Floating UI / Radix Popover anchored under the input — match the `boxShadow` and `fadeSlideIn` animation |
| `<SelectedCard>` | New component `web/src/components/selected-card.tsx` — used for both customer + property collapsed views |
| `<ConfirmModal>` | shadcn `<Dialog>` styled to match the prototype's centered modal with brand-tint sparkle icon |
| `<Toast>` | Existing toast primitive (likely `sonner` or shadcn `<Toast>`) — match the warm-dark `#1a1a1a` background + checkmark icon style |
| `<InlineCreateCustomer>` | New `web/src/components/inline-create-customer.tsx` — expands inline below the search input |
| `<RadioPair>` | shadcn `<RadioGroup>` with custom styling — used for Individual/Commercial toggle |
| `<Pill>` | Existing badge primitive in our app (or shadcn `<Badge>`) — match the 5 tone variants |
| `<Highlight>` text | Pure JS function — render `<mark>` with `--brand-tint` background |
| `<PropertyPicker>`'s "boosted section" | Section header inside the dropdown with `--brand-tint` background + sparkle icon — uses the customer-scoped match endpoint result ordering |
| Loss type chips, Category/Class segments | shadcn `<ToggleGroup>` styled per prototype |
| Phone shell + design canvas | **NOT PRODUCTION** — these are mockup chrome only |

## Design decisions captured in this prototype (read these closely)

1. **Phone-first matching** — input placeholder explicitly says "Phone, name, or email…" with hint "Phone is the fastest match. Three digits is enough." This implies the phone-prefix dispatch in 01J Decision #18 should be the primary path the UX promotes.
2. **Customer-scoped property boost** — when a customer is already selected, the property picker shows their known properties at the top with a labeled section. Matches CREW-13's `customer_id` boost parameter on `GET /v1/properties/match`.
3. **Tier-based dialogs** — `exact` auto-fills with a toast (no interruption). `close` opens a centered modal that asks "Did you mean...?" with two equally-sized buttons. `none` either inline-creates (customer) or silently-creates with a toast (property, since Google already canonicalized it).
4. **Phone redaction in dropdown rows** — `phone_red` field shows `(503) 555-••92` in dropdown rows, full phone only on the selected card. Matches 01J Decision #20 (list endpoints exclude PII / minimize exposure).
5. **Inline create form fields** — Individual: name + phone (required) + email. Commercial: name + entity_name + phone (required) + email. The radio pair drives whether `entity_name` is shown.
6. **48px tap targets everywhere** — `<button className="tap">` enforces `min-height: 48px`. Match in production.
7. **Geist + Geist Mono font stack** — already configured in `web/src/app/layout.tsx`. Mono is used for phone numbers, ZIPs, dates, and 11px uppercase labels.
8. **Cream background** — `--bg: #fff8f4` already in `globals.css`. White cards on cream surface, no shadows except on dropdowns + modals.

## Read order before implementing

1. `_design-chat.md` — captures the design conversation and intent
2. `pickers-shared.jsx` — atoms vocabulary (so you know what `SelectedCard`, `Pill`, `Toast`, etc. should look like)
3. `customer-picker.jsx` — all customer states
4. `property-picker.jsx` — all property states
5. `new-job-form.jsx` — how the pickers compose into the form

Implementation lives in **Phase 11 (pickers) + Phase 12 (new-job form rewire)** of the unified impl plan: `docs/specs/draft/01-foundation-impl-plan.md`.
