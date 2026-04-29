# Spec 01K: Address Autocomplete + Customer Picker (Google Places)

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% |
| **State** | Draft |
| **Blocker** | Depends on CREW-11 (customers + customer_id wiring) |
| **Branch** | TBD |
| **Issue** | [CREW-13](https://linear.app/crewmatic/issue/CREW-13) |
| **Depends on** | 01J (CREW-11) |
| **Blocks** | None — ships alongside 01J |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-28 |
| Revised | 2026-04-28 (eng review: switched canonicalization provider from Smarty to Google Places — already integrated; applied review fixes) |

## Reference
- [CREW-13](https://linear.app/crewmatic/issue/CREW-13)
- **Design prototype:** [`docs/design/customer-property-pickers/`](../../design/customer-property-pickers/README.md) — full HTML/JS mockup of every state (empty / typing / results / exact / fuzzy / no-match / selected) for both `<CustomerPicker>` and `<PropertyPicker>`, plus the mobile + desktop New Job form. Read the README in that directory before implementing UI — it maps each prototype component to its production target.
- Existing components: `web/src/components/address-autocomplete.tsx` (Google Places via `use-places-autocomplete`), `web/src/components/google-maps-provider.tsx` (loads `places`, `geocoding`, `maps` libs).
- npm deps: `@googlemaps/js-api-loader`, `use-places-autocomplete` (already installed).

---

## Summary

When a tech is creating a new job, the form's customer + address fields detect existing records and prevent duplicates **at write time** — not via post-hoc merge tooling.

Two surfaces:

1. **Customer picker** — `<CustomerPicker>` debounces user input, fires `GET /v1/customers/match`, surfaces tier-based suggestions ("use existing?" vs "create new"). Phone-as-unique-key (01J) means dupes can't slip through at the DB level either.
2. **Property picker** — reuses the existing `<AddressAutocomplete>` component (Google Places + Geocoding, already loaded). User selects a Google-canonicalized address → frontend has structured `{address_line1, city, state, zip, latitude, longitude}` → submits to backend → backend fuzzy-matches against existing properties before insert. If a match is found, "Did you mean 123 Main St?" dialog routes the user.

Net effect: a tech entering a slightly mistyped address gets pointed to the existing property. Property dupes are prevented at write time. No backend third-party API call (Google Places does its work client-side during selection). No Smarty.

---

## What Already Exists (Do Not Duplicate)

| Component | Status | Notes |
|-----------|--------|-------|
| `customers` + `properties` tables | ✅ Live (after CREW-11) | This spec extends with the match endpoint and property pickers. |
| `pg_trgm` extension | ✅ Live (after CREW-11) | Used for fuzzy property match. |
| `properties.usps_standardized` | ✅ Live | The address dedup key. Computed from canonical components. |
| `_build_usps_standardized` helper | ✅ Live | Reused unchanged. |
| `<AddressAutocomplete>` component | ✅ Live | Returns `{address_line1, city, state, zip, latitude, longitude}` from a Google Places selection. We reuse this, do not rebuild. |
| `<GoogleMapsProvider>` | ✅ Live | Loads `places`, `geocoding`, `maps` libs. |
| Customer search via `GET /v1/customers?search=` | ✅ Live (after CREW-11) | Used by customer picker. The `match` endpoint here is a thin tier-envelope wrapper. |

---

## Done When

### Backend
- [ ] New endpoint `GET /v1/customers/match?query={...}` returns `{ tier: "exact" | "close" | "none", matches: [...] }`. Uses authenticated client (RLS-scoped). Input-shape dispatch per 01J Decision #18 (digits → phone exact; `@` → email ilike; else → fuzzy on name + entity_name).
- [ ] New endpoint `GET /v1/properties/match?usps_standardized={...}&customer_id={...}` returns `{ tier, matches: [{ id, address_line1, city, state, zip, similarity, customer: { id, display_name } | null }] }`. Authenticated client only. Input is the **already-canonicalized** form from the frontend's `<AddressAutocomplete>` selection. If `customer_id` provided, customer-owned properties surface first in `matches[]` ordering.
- [ ] **`PropertyMatchCandidate.customer` projection is restricted to `{id, display_name}` only** — never phone/email/notes/entity_name. Mirrors 01J Decision #19 (column-projection whitelist).
- [ ] Match-endpoint logic:
  1. SELECT properties WHERE `usps_standardized = $input AND deleted_at IS NULL` → if hit, `tier="exact"`, single candidate.
  2. Else SELECT with `pg_trgm similarity(usps_standardized, $input) >= 0.7` → ordered by similarity DESC LIMIT 5 → `tier="close"`.
  3. Else `tier="none"`, empty matches.
- [ ] **Per-user rate limit on `/match` endpoints (60 req/min/user)** via existing FastAPI rate-limit middleware. Decision #6's frontend debounce is UX only — server-side rate limit is the safety net.
- [ ] `POST /v1/properties` body unchanged from 01J. Service-layer:
  - Computes `usps_standardized` from submitted `address_line1, city, state, zip` via existing `_build_usps_standardized`
  - Stores `latitude` / `longitude` directly from the body (frontend extracted them from the Google Places result)
  - On 23505 against `idx_properties_company_usps_active`: **catch and return 409 `PROPERTY_DUPLICATE` with the existing row's `{id, address_line1, city, state, zip}`** (mirrors 01M idempotent-replay pattern). Log `property_duplicate_collision` event.
- [ ] `PATCH /v1/properties/{id}` re-checks uniqueness when address fields change. Same 23505 catch → 409 `PROPERTY_ADDRESS_BELONGS_TO_OTHER` with conflicting row's id. Test `test_property_patch_address_conflict_returns_409`.
- [ ] No backend third-party API integration (no Smarty, no Google API key on backend). `GOOGLE_PLACES_API_KEY` stays a frontend-only config.
- [ ] Tests cover both match endpoints + RLS isolation + 409 collision paths + customer-scoped boost ordering.

### Frontend
- [ ] New component `web/src/components/customer-picker.tsx`. Debounced 300ms (use `useDebouncedCallback` from existing utility, or import a global constant). Calls `GET /v1/customers/match`. Renders dropdown: tier-exact → silent auto-select; tier-close → "Did you mean Sarah Johnson? [Yes] [Create new]"; tier-none → inline "Create new customer" form.
- [ ] New component `web/src/components/property-picker.tsx`. **Wraps the existing `<AddressAutocomplete>`** — does not rebuild Google Places UX. On Google place selection: receives `{address_line1, city, state, zip, latitude, longitude}` from `<AddressAutocomplete>`'s `onSelect`. Then calls `GET /v1/properties/match` with the `usps_standardized` form. Tier dialog routes:
  - `exact` → silent auto-select with toast "Using existing property at 123 Main St"
  - `close` → modal: "Did you mean 123 Main St? [Use existing] [No, create new]"
  - `none` → inline create with the components Google returned
- [ ] When `customerId` is set, `<PropertyPicker>` passes it to the match endpoint so customer-owned properties boost in the results.
- [ ] React Query hooks `web/src/lib/hooks/use-customer-match.ts` + `use-property-match.ts`.
- [ ] New job creation form (`web/src/app/(protected)/jobs/new/...` — confirm path during impl) replaces inline customer + address fields with `<CustomerPicker>` + `<PropertyPicker>`. Submits via the clean FK-only `POST /v1/jobs` from 01J Decision #9.
- [ ] Customer picker has a "Create new customer" inline form (`name / entity_name / phone / email / customer_type`) that fires `POST /v1/customers` and auto-selects the result. On 409 `CUSTOMER_DUPLICATE_PHONE`, surface the existing customer + "Use existing?" prompt.
- [ ] Mobile: pickers full-width; close-tier dialog uses existing `<BottomSheet>` (`web/src/components/bottom-sheet.tsx`).
- [ ] Tests cover debouncing, tier routing, rate-limit behavior (mock 429), `<AddressAutocomplete>` integration.

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Google Places + Geocoding** as the canonical-address provider — NOT Smarty, NOT USPS Web API. Frontend extracts canonical components client-side from the Google place selection; backend just stores them. | Already integrated. No new vendor, no new env vars, no DPA paperwork, no backend third-party call burning quota. Google's `address_components` are accurate enough for restoration use cases (the address is "where the tech is going," not a USPS shipping label). |
| 2 | Canonicalization happens **at frontend selection time** (when the user picks a Google Places suggestion) — not at backend write time | Eliminates a backend API dependency. Faster mobile UX (autocomplete-as-you-type). Single source of truth for the canonical form. |
| 3 | Backend still computes `usps_standardized` from the submitted components via `_build_usps_standardized` (lowercase + strip + concat) | Provides the partial-unique-index dedup key. Cheap, deterministic, no third-party. |
| 4 | New tier-based `GET /v1/properties/match` endpoint — not extending `GET /v1/properties?search=` | Different response shape (`{tier, matches}`), different ranking (exact then pg_trgm). Keeps the basic list endpoint clean. |
| 5 | Customer-picker tier endpoint (`GET /v1/customers/match`) is a thin tier-envelope wrapper around the existing list-endpoint search. | Uniform UX between customer + property pickers. Backend reuses 01J Decision #18 dispatch. |
| 6 | Frontend debounces 300ms before firing match endpoints. **Server-side rate limit (60/min/user) is the actual safety net.** | Client debounce can be bypassed; server rate limit cannot. Match endpoints are cheap (pg_trgm) but enumerable. |
| 7 | When `customer_id` is set on the property picker, customer-owned properties boost first in the match endpoint's response (server-side ordering) | Restoration mental model: "Sarah's place." Server-side keeps the contract clean for clients. |
| 8 | **`PropertyMatchCandidate.customer` is projected to `{id, display_name}` only** — never PII | Mirrors 01J Decision #19. Match endpoints are list endpoints; PII excluded. |
| 9 | On `POST /v1/properties` with a duplicate canonical form, catch the 23505 unique-violation and return `409 PROPERTY_DUPLICATE` with the existing row's id (similar to `idempotent_replay` pattern in 01M Decision #4) | Race-safe at the DB layer. Frontend can navigate to the existing property instead of crashing. |
| 10 | On `PATCH /v1/properties/{id}` with an address change that collides with another property, return `409 PROPERTY_ADDRESS_BELONGS_TO_OTHER` with the conflicting id | Mirrors 01L Decision #14 promise. Frontend can offer "use that property instead" navigation. |
| 11 | All match queries use `get_authenticated_client(token)` (RLS-scoped) — never the admin client | Prevents cross-company enumeration. Required for security. |
| 12 | No `GOOGLE_PLACES_API_KEY` on the backend | The frontend already holds the key. No need to duplicate. Backend never calls Google. |
| 13 | Geocoded `latitude / longitude` come from Google Places (already happens in `<AddressAutocomplete>`'s `onSelect`). Stored on `properties.latitude / longitude` (already columns). Rounded to 5 decimals (~1m precision) on insert to reduce geo-PII surface. | Sub-meter geocoding is overkill + a re-identification risk. 5 decimals = ~1m, which is fine for the dashboard map. |
| 14 | `customers.notes`, `customers.email`, `customers.phone` excluded from match-endpoint results (consistent with 01J Decision #20) | Match is a list/search context. PII stays in detail endpoints. |
| 15 | Google Places API key is configured via `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (existing env var). Restrict the key to specific HTTP referrers + APIs (`Places API`, `Geocoding API`, `Maps JavaScript API`) in Google Cloud Console. Document in `web/CLAUDE.md`. | Standard Google Maps Platform key hygiene. Restrict-by-referrer prevents key abuse from other origins. |

---

## API Endpoints

### `GET /v1/properties/match`

Query params:
- `usps_standardized` (string) — already-canonicalized form from frontend
- `customer_id` (UUID, optional) — boost customer-owned properties in results

Response:

```python
class PropertyMatchCustomer(BaseModel):
    id: UUID
    display_name: str  # name or entity_name (whichever is "primary")

class PropertyMatchCandidate(BaseModel):
    id: UUID
    address_line1: str
    city: str
    state: str
    zip: str
    similarity: float          # 1.0 for exact tier; pg_trgm value for close tier
    customer: PropertyMatchCustomer | None  # default-owner if set; whitelisted

class PropertyMatchResponse(BaseModel):
    tier: Literal["exact", "close", "none"]
    matches: list[PropertyMatchCandidate]
```

Service logic:
```python
async def match_properties(token, company_id, usps_standardized, customer_id=None):
    client = await get_authenticated_client(token)

    # Tier 1: exact
    exact = await client.table("properties") \
        .select("id, address_line1, city, state, zip, customer_id") \
        .eq("company_id", str(company_id)) \
        .eq("usps_standardized", usps_standardized) \
        .is_("deleted_at", "null") \
        .limit(1) \
        .execute()
    if exact.data:
        return {"tier": "exact", "matches": [_with_customer(client, exact.data[0], similarity=1.0)]}

    # Tier 2: close
    # Use raw SQL via RPC or PostgREST `or_` filter for pg_trgm similarity
    close = await client.rpc("match_properties_close", {
        "p_company_id": str(company_id),
        "p_input": usps_standardized,
        "p_threshold": 0.7,
        "p_customer_id_boost": str(customer_id) if customer_id else None,
    }).execute()
    if close.data:
        return {"tier": "close", "matches": [...]}

    return {"tier": "none", "matches": []}
```

Add the SQL function to the migration:

```sql
CREATE OR REPLACE FUNCTION match_properties_close(
    p_company_id UUID,
    p_input TEXT,
    p_threshold FLOAT,
    p_customer_id_boost UUID DEFAULT NULL
) RETURNS TABLE (
    id UUID, address_line1 TEXT, city TEXT, state TEXT, zip TEXT,
    customer_id UUID, similarity FLOAT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT
        p.id, p.address_line1, p.city, p.state, p.zip, p.customer_id,
        similarity(p.usps_standardized, p_input) AS sim
    FROM properties p
    WHERE p.company_id = p_company_id
      AND p.deleted_at IS NULL
      AND similarity(p.usps_standardized, p_input) >= p_threshold
    ORDER BY
        (p.customer_id = p_customer_id_boost) DESC NULLS LAST,
        sim DESC
    LIMIT 5;
$$;
```

Note: `SECURITY INVOKER` so RLS still applies. The function runs as the calling user.

### `GET /v1/customers/match`

Query params:
- `query` (string) — phone, name, or email; input-shape dispatch

Response:

```python
class CustomerMatchResponse(BaseModel):
    tier: Literal["exact", "close", "none"]
    matches: list[CustomerListItem]  # 01J's existing list shape — id, name, entity_name, customer_type
```

Service logic:
1. If digits ≥ 7 → exact phone lookup (normalized via `normalize_phone()`; if `INVALID_PHONE` raised, **catch and degrade to fuzzy name search**).
2. If `@` in query → email ilike search; if any results have similarity ≥ 0.6 → tier="close".
3. Else fuzzy name + entity_name search; tier="exact" only on exact name match (case-insensitive trimmed); else tier="close" if similarity ≥ 0.6.

### Modified: `POST /v1/properties` and `PATCH /v1/properties/{id}` (from 01J)

No body shape change. Service-layer additions:
- Use `_build_usps_standardized` to compute the dedup key.
- On 23505 unique-violation: catch, fetch existing row, return `409 PROPERTY_DUPLICATE` (POST) or `409 PROPERTY_ADDRESS_BELONGS_TO_OTHER` (PATCH) with the existing row's id.
- Round `latitude` / `longitude` to 5 decimals before insert.

---

## Frontend Architecture

### Customer Picker

```tsx
<CustomerPicker
  value={customerId}
  onChange={(id) => setCustomerId(id)}
/>
```

- Input field, debounced 300ms (constant: `MATCH_DEBOUNCE_MS = 300` in `web/src/lib/constants.ts`)
- Calls `useCustomerMatch({ query })`
- Renders dropdown: matches with `name · entity_name` (no phone/email visible)
- Tier-exact match → silent auto-select with toast
- Tier-close match → "Did you mean Sarah Johnson?" with [Yes] [Create new]
- "Create new" opens inline form `<CustomerInlineCreate>` → POST /v1/customers
- On 409 from create: surface existing customer with "Use existing?" prompt

### Property Picker

```tsx
<PropertyPicker
  customerId={customerId}                  // optional — boosts that customer's properties
  value={propertyId}
  onChange={(id) => setPropertyId(id)}
/>
```

Internally:

```tsx
function PropertyPicker({ customerId, onChange }) {
  const [addrParts, setAddrParts] = useState<AddressParts | null>(null);
  const { data: matchResult } = usePropertyMatch({
    usps_standardized: addrParts ? buildUSPSStandardized(addrParts) : null,
    customer_id: customerId,
  });

  return (
    <>
      <AddressAutocomplete
        onSelect={(parts) => setAddrParts(parts)}
        // existing component, unchanged
      />
      {matchResult?.tier === "close" && (
        <CloseMatchDialog matches={matchResult.matches} onConfirm={...} />
      )}
      {matchResult?.tier === "exact" && (
        <Toast message={`Using existing property at ${matchResult.matches[0].address_line1}`} />
      )}
    </>
  );
}
```

`buildUSPSStandardized()` is the frontend mirror of the backend helper — same lowercase/strip logic, used to compute the dedup key client-side before calling the match endpoint.

### New Job Form Wiring

```tsx
function NewJobForm() {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  // ...other job fields...

  return (
    <form>
      <CustomerPicker value={customerId} onChange={setCustomerId} />
      <PropertyPicker customerId={customerId} value={propertyId} onChange={setPropertyId} />
      {/* loss type, dates, etc. */}
      <SubmitButton disabled={!customerId || !propertyId} />
    </form>
  );
}
```

---

## Testing Requirements

### Backend
- `test_property_match_exact_tier` — known canonical → tier="exact"
- `test_property_match_close_tier_via_pg_trgm` — typo → close tier ordered by similarity DESC
- `test_property_match_no_tier` — no candidates
- `test_property_match_customer_id_boosts_owned_properties` — same address slightly different; customer's owned property surfaces first
- `test_property_match_customer_projection_excludes_pii` — response has only `customer.id` and `customer.display_name`
- `test_property_match_rls_isolation` — Company A query against Company B's address returns tier="none"
- `test_property_match_rate_limit_429_after_60_per_minute`
- `test_property_create_collision_returns_409_with_existing_id`
- `test_property_patch_address_conflict_returns_409_with_other_id`
- `test_customer_match_phone_exact` — digits-only → tier="exact" via normalize_phone
- `test_customer_match_phone_invalid_falls_back_to_name_fuzzy` — bad phone shape doesn't 422 the request
- `test_customer_match_email_close` — `@` triggers email ilike
- `test_customer_match_name_fuzzy_close`
- `test_customer_match_rls_isolation`
- `test_customer_match_excludes_pii_from_response`

### Frontend
- `customer-picker.test.tsx` — debouncing, tier routing, inline create flow
- `property-picker.test.tsx` — wraps `<AddressAutocomplete>`, calls match endpoint after Google selection, tier-routes correctly
- `property-picker.test.tsx` — passes `customer_id` to match when set, shows boosted ordering
- E2E: tech selects existing customer → types address → Google Places suggests → selects → match endpoint hits → close-tier dialog → "use existing" → submit creates job linked to both

---

## Spec Interactions

| Spec | Interaction |
|------|-------------|
| 01J (CREW-11) | Foundation; this spec assumes `customers`, `properties.customer_id`, `jobs.customer_id` all live |
| 01L (CREW-59) | Property + Customer detail pages reuse `<CustomerPicker>` for the "Change Owner" dialog. **Address change is NOT a feature of the property detail page in this rollout** — addresses are immutable once a property is created (defer change-address to V2 if needed) |
| 01M (CREW-60) | New-job flow's pickers feed customer_id + property_id into the clone-from-job POST when converting reconstruction |
| Existing dashboard map | Continues to use Google Maps. Same `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. No conflicts. |

---

## Out of Scope (explicit)

- **International addresses** — V1 is US/Canada via Google Places' default region. Other regions work but are not tested.
- **Smarty Streets / USPS Web API integration** — explicitly NOT used. Google Places handles canonicalization client-side.
- **Backend Google API calls** — never. Backend has no Google API key.
- **Property merge tooling** — write-time canonicalization (frontend-via-Google) prevents duplicates.
- **Cached match results / LRU on backend** — at V1 scale, pg_trgm is fast (sub-50ms). Add caching at 10x scale if needed.
- **Address re-canonicalization for pre-existing rows** — pre-launch, no rows. If retroactive cleanup is ever needed, write a one-shot script.
- **Address change on existing property** (PATCH `address_*` fields) — supported but not exposed in any UI in this spec. Implementation here only ensures the API handles it correctly (409 on conflict). UI for editing comes in 01L if/when added.

---

## Quick Resume

**If resuming cold:**
1. Frontend `<AddressAutocomplete>` already does Google Places autocomplete + structured component extraction. **Reuse it. Do not rebuild.**
2. The match endpoints are pure backend — no third-party calls. Just pg_trgm and PostgREST queries.
3. Rate limit on `/match` endpoints is mandatory (Decision #6) — the existing FastAPI rate-limit middleware should already exist; if not, add it.
4. The 23505 catch on POST `/v1/properties` is the same pattern as 01M's idempotent replay — copy that pattern.

---

## Session Log

_Populated as work progresses._

---

## Decisions Log

### 2026-04-28 — Eng review fixes (provider switch + security/perf)

Parallel review by backend-architect, security-auditor, code-reviewer. 6 critical changes:

1. **Provider switch from Smarty to Google Places.** Reviewer flagged that `web/src/components/address-autocomplete.tsx` and `<GoogleMapsProvider>` are already integrated. Decision #1 inverted: drop Smarty, reuse Google. Frontend canonicalizes client-side; backend just stores submitted values. No new vendor, no DPA, no backend API key.
2. **Match endpoint customer projection whitelist.** Was returning full `CustomerNested`; now returns only `{id, display_name}` to mirror 01J Decision #19.
3. **23505 catch on `POST /v1/properties`** for duplicate canonical form → 409 with existing row's id. Mirrors 01M idempotent-replay pattern.
4. **23505 catch on `PATCH /v1/properties/{id}`** when address-change collides → 409 `PROPERTY_ADDRESS_BELONGS_TO_OTHER`. Closes 01L Decision #14's promise.
5. **Server-side rate limit on `/match` endpoints (60/min/user)** — frontend debounce is UX only, not security.
6. **`latitude`/`longitude` rounded to 5 decimals** on insert — reduces geo-PII surface; sub-meter precision is overkill for the dashboard map.
7. **All match queries use authenticated client (RLS-scoped).** Explicit Decision #11.
8. **Phone normalization in customer match catches `INVALID_PHONE` and falls back to fuzzy name search** — instead of 422-ing the request.
9. **Match candidates' similarity score** locked: 1.0 for exact tier, pg_trgm value for close tier. Removes ambiguity flagged by reviewer.

_Further decisions populated during implementation._
