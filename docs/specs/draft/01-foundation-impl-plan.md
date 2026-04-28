# Customer–Property Foundation: Unified Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Customer-Property data foundation in one rollout — covering CREW-11 (data model + CRUD), CREW-13 (autocomplete pickers + canonicalization via existing Google Places integration), CREW-59 (Property + Customer detail pages), and CREW-60 (generalized job-clone pattern with "Convert to Reconstruction" preset).

**Architecture:** New `customers` first-class entity (company-scoped, phone-as-unique-key). `properties.customer_id` default-owner pointer + `jobs.customer_id` per-job customer. Drop denormalized `jobs.customer_*` columns (pre-launch clean cut). Generalized `clone_from_job_id` flag on POST /v1/jobs (covers Convert-to-Reconstruction). Property + Customer detail pages with property-centric customer body. All address canonicalization happens client-side via the existing `<AddressAutocomplete>` (Google Places) component.

**Tech Stack:** FastAPI + Supabase (Postgres + RLS), Pydantic v2, Alembic raw-SQL migrations, `phonenumbers` (E.164), `pg_trgm` (fuzzy search), `cryptography.fernet` (gate_code encryption), `bleach` (notes sanitization). Frontend: Next.js 16 + TanStack Query + existing `<AddressAutocomplete>` (Google Places via `use-places-autocomplete`).

**Specs:**
- `docs/specs/draft/01J-customer-property-model.md` — data model + customer CRUD foundation
- `docs/specs/draft/01K-address-autocomplete-canonicalization.md` — autocomplete pickers + match endpoints
- `docs/specs/draft/01L-detail-pages.md` — Property + Customer detail pages + list views + nav
- `docs/specs/draft/01M-job-clone.md` — generalized clone-from-job pattern

**Linear:** [CREW-11](https://linear.app/crewmatic/issue/CREW-11), [CREW-13](https://linear.app/crewmatic/issue/CREW-13), [CREW-59](https://linear.app/crewmatic/issue/CREW-59), [CREW-60](https://linear.app/crewmatic/issue/CREW-60).

---

## File Structure (the full delta this plan ships)

### Created — Backend
| Path | Spec | Purpose |
|------|------|---------|
| `backend/alembic/versions/<rev>_foundation_customer_property.py` | 01J/01K/01L/01M | Single Alembic revision: customers table + RLS + indexes; properties.customer_id + last_activity_at + trigger + notes columns; jobs.customer_id + parent_job_id + drop denorm + property_id NOT NULL; pg_trgm + match RPC. |
| `backend/api/customers/__init__.py` | 01J | Module marker |
| `backend/api/customers/schemas.py` | 01J | `CustomerCreate`, `CustomerUpdate`, `CustomerResponse`, `CustomerListItem`, `CustomerDetailResponse`, `CustomerDuplicateResponse`, `CustomerMatchResponse` |
| `backend/api/customers/service.py` | 01J/01K | CRUD + dedup + match |
| `backend/api/customers/router.py` | 01J/01K | 5 + 1 endpoints |
| `backend/api/shared/phone.py` | 01J | `normalize_phone()` E.164 helper |
| `backend/api/shared/encryption.py` | 01L | Fernet helpers for `gate_code` |
| `backend/api/shared/sanitize_notes.py` | 01L | `sanitize_access_notes()` via bleach |
| `backend/api/shared/rate_limit.py` (if not present) | 01K | Per-user 60/min rate limit decorator for match endpoints |
| `backend/tests/test_customers.py` | 01J | ~30 tests |
| `backend/tests/test_phone_normalization.py` | 01J | ~6 tests |
| `backend/tests/test_property_match.py` | 01K | ~10 tests |
| `backend/tests/test_property_detail_endpoints.py` | 01L | ~12 tests |
| `backend/tests/test_customer_detail_endpoints.py` | 01L | ~6 tests |
| `backend/tests/test_job_clone.py` | 01M | ~14 tests |
| `backend/tests/test_gate_code_encryption.py` | 01L | ~5 tests |

### Created — Frontend
| Path | Spec | Purpose |
|------|------|---------|
| `web/src/lib/hooks/use-customers.ts` | 01J | `useCustomer`, `useCustomers`, `useCreateCustomer`, `useUpdateCustomer`, `useDeleteCustomer` |
| `web/src/lib/hooks/use-customer-match.ts` | 01K | Match endpoint hook |
| `web/src/lib/hooks/use-property-match.ts` | 01K | Match endpoint hook |
| `web/src/lib/hooks/use-property-detail.ts` | 01L | Property + jobs/photos/notes for detail page |
| `web/src/lib/hooks/use-customer-detail.ts` | 01L | Customer + properties for detail page |
| `web/src/lib/hooks/use-reconstruction.ts` | 01M | Linked-reconstruction lookup |
| `web/src/lib/build-usps-standardized.ts` | 01K | Frontend mirror of backend dedup-key helper |
| `web/src/components/customer-picker.tsx` | 01K | Customer autocomplete + create-new |
| `web/src/components/property-picker.tsx` | 01K | Wraps `<AddressAutocomplete>` + match-tier dialog |
| `web/src/components/convert-to-reconstruction-button.tsx` | 01M | Button + confirmation dialog |
| `web/src/app/(protected)/properties/page.tsx` | 01L | Properties list view |
| `web/src/app/(protected)/properties/[id]/page.tsx` | 01L | Property detail page (Sketch / Jobs / Photos / Notes tabs) |
| `web/src/app/(protected)/customers/page.tsx` | 01L | Customers list view |
| `web/src/app/(protected)/customers/[id]/page.tsx` | 01L | Customer detail page (property-centric) |
| `web/src/lib/constants.ts` (extend) | 01K/01L | `MATCH_DEBOUNCE_MS`, `NOTES_DEBOUNCE_MS` |

### Modified — Backend
| Path | Spec | Change |
|------|------|--------|
| `backend/pyproject.toml` | 01J/01L | Add `phonenumbers>=8.13.0,<9`, `bleach>=6.1`, `cryptography>=42` |
| `backend/api/main.py` | 01J | Register `customers.router` |
| `backend/api/properties/schemas.py` | 01J/01K/01L | Accept `customer_id`; nested customer in response; new sub-resource schemas; reject notes fields on main PATCH |
| `backend/api/properties/service.py` | 01J/01K/01L | Cross-company FK validation; 23505 catch on POST/PATCH; nested customer embed; sub-resource logic; admin gate for customer_id changes |
| `backend/api/properties/router.py` | 01J/01K/01L | Sub-resource routes: `/jobs`, `/photos`, `/notes`, `/match` |
| `backend/api/jobs/schemas.py` | 01J/01M | Required FKs; drop inline customer/address; nested response; `clone_from_job_id` field; `parent_job_id` in response |
| `backend/api/jobs/service.py` | 01J/01M | FK pre-fetch; clone logic with COPY_FIELDS + linked_job_id; idempotency; soft-delete-blocked-when-reconstruction-child-exists |
| `backend/api/jobs/router.py` | 01J/01M | Refactored body; new `GET /v1/jobs/{id}/reconstruction` |
| `backend/api/sharing/service.py` | 01J | Column-projection whitelist for customer fields |
| `backend/api/config.py` | 01L | `GATE_CODE_FERNET_KEYS` env var |

### Modified — Frontend
| Path | Spec | Change |
|------|------|--------|
| `web/src/lib/types.ts` | 01J/01K/01L/01M | Customer types + nested customer/property in Job/Property; `parent_job_id` field |
| `web/src/lib/__tests__/types.test.ts` | 01J | Update for new shapes |
| `web/src/app/(protected)/dashboard/dashboard-client.tsx` | 01J | Read `job.customer.name` instead of `job.customer_name` |
| `web/src/app/(protected)/jobs/page.tsx` | 01J | Same |
| `web/src/app/(protected)/jobs/[id]/page.tsx` | 01J/01M | Same + add `<ConvertToReconstructionButton>` + "View Property" / "View Customer" links |
| `web/src/app/(protected)/jobs/new/page.tsx` (or wherever lives) | 01K | Replace inline customer/address with `<CustomerPicker>` + `<PropertyPicker>` |
| `web/src/lib/hooks/use-jobs.ts` | 01J/01M | Update query/mutation types |
| `web/src/components/sidebar-nav.tsx` (find via grep) | 01L | Add Properties + Customers tabs |

---

## Phase 0: Setup

### Task 0.1: Add backend dependencies

**Files:** `backend/pyproject.toml`

- [ ] **Step 1:** Open `backend/pyproject.toml`, locate `dependencies = [ ... ]`. Add three lines (alphabetical):

```toml
"bleach>=6.1,<7",
"cryptography>=42,<43",
"phonenumbers>=8.13.0,<9",
```

- [ ] **Step 2:** Install:
```bash
cd backend && pip install -e ".[dev]"
```

- [ ] **Step 3:** Verify imports:
```bash
cd backend && python -c "import phonenumbers, bleach; from cryptography.fernet import Fernet, MultiFernet; print('ok')"
```

- [ ] **Step 4:** Commit:
```bash
git add backend/pyproject.toml
git commit -m "deps: phonenumbers, bleach, cryptography (foundation rollout)"
```

### Task 0.2: Generate Fernet key + add env vars

**Files:** `backend/api/config.py`, `backend/.env.example`, `web/.env.example`

- [ ] **Step 1:** Generate a Fernet key:
```bash
cd backend && python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Copy the output (e.g., `g9V...=`).

- [ ] **Step 2:** Add to `backend/.env` (NOT committed) and `backend/.env.example` (committed, with placeholder):
```
# .env (real key, never committed)
GATE_CODE_FERNET_KEYS=g9V_actual_key=
# .env.example (placeholder)
GATE_CODE_FERNET_KEYS=  # comma-separated Fernet keys, newest first; rotate quarterly
```

- [ ] **Step 3:** Add to `backend/api/config.py` Settings class:
```python
class Settings(BaseSettings):
    # ... existing fields ...
    gate_code_fernet_keys: str  # comma-separated; MultiFernet rotates by parsing all
```

- [ ] **Step 4:** Verify Railway production secrets are set (cannot test locally — this is a manual checklist item the operator confirms before deploy):
```bash
# In Railway dashboard: Variables → confirm GATE_CODE_FERNET_KEYS is present
echo "Manual: confirm GATE_CODE_FERNET_KEYS is set in Railway"
```

- [ ] **Step 5:** Frontend env: confirm `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` exists in `web/.env.local`. If not, generate one in Google Cloud Console with `Places API`, `Geocoding API`, `Maps JavaScript API` enabled and HTTP-referrer restriction to `localhost:3000` + production domain. Document in `web/CLAUDE.md` under "Google Maps API key".

- [ ] **Step 6:** Commit:
```bash
git add backend/api/config.py backend/.env.example
git commit -m "config: add GATE_CODE_FERNET_KEYS for gate_code encryption (01L)"
```

---

## Phase 1: Database Migration (single revision, all four specs)

### Task 1.1: Write the unified Alembic revision

**Files:** `backend/alembic/versions/<auto>_foundation_customer_property.py`

- [ ] **Step 1:** Get current head:
```bash
cd backend && alembic current
```

- [ ] **Step 2:** Generate scaffold:
```bash
cd backend && alembic revision -m "foundation_customer_property"
```

- [ ] **Step 3:** Replace the generated file's `upgrade()` body with the unified SQL. Insert SQL **in this order** (constraints depend on prior steps):

```python
def upgrade() -> None:
    op.execute("""
-- ============================================================================
-- 1. pg_trgm for fuzzy autocomplete (01J + 01K)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 2. customers table (01J)
-- ============================================================================
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
    entity_name     TEXT,
    phone           TEXT CHECK (phone IS NULL OR phone ~ '^\\+[0-9]{10,15}$'),
    email           TEXT,
    customer_type   TEXT NOT NULL DEFAULT 'individual'
                    CHECK (customer_type IN ('individual', 'commercial')),
    notes           TEXT CHECK (notes IS NULL OR length(notes) <= 10000),
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_customers_company_phone_active
    ON customers(company_id, phone)
    WHERE phone IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_customers_company_name_active
    ON customers(company_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_company_entity_active
    ON customers(company_id, entity_name) WHERE entity_name IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_customers_company_email_active
    ON customers(company_id, email) WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_customers_name_trgm
    ON customers USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_entity_trgm
    ON customers USING gin (entity_name gin_trgm_ops) WHERE entity_name IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select" ON customers FOR SELECT
    USING (deleted_at IS NULL AND company_id = get_my_company_id());
CREATE POLICY "customers_insert" ON customers FOR INSERT
    WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "customers_update" ON customers FOR UPDATE
    USING (deleted_at IS NULL AND company_id = get_my_company_id())
    WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "customers_delete" ON customers FOR DELETE USING (false);

-- ============================================================================
-- 3. properties.customer_id + notes columns + last_activity_at (01J + 01L)
-- ============================================================================
ALTER TABLE properties
    ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE properties ADD COLUMN gate_code TEXT;  -- Fernet ciphertext (01L)
ALTER TABLE properties ADD COLUMN key_location TEXT
    CHECK (key_location IS NULL OR length(key_location) <= 500);
ALTER TABLE properties ADD COLUMN access_notes TEXT
    CHECK (access_notes IS NULL OR length(access_notes) <= 5000);
ALTER TABLE properties ADD COLUMN last_activity_at TIMESTAMPTZ;

CREATE INDEX idx_properties_customer
    ON properties(customer_id) WHERE customer_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_properties_company_last_activity
    ON properties(company_id, last_activity_at DESC NULLS LAST)
    WHERE deleted_at IS NULL;

-- ============================================================================
-- 4. Pre-launch wipe (01J)
-- ============================================================================
TRUNCATE jobs CASCADE;

-- ============================================================================
-- 5. Drop denormalized columns (01J)
-- ============================================================================
ALTER TABLE jobs DROP COLUMN customer_name;
ALTER TABLE jobs DROP COLUMN customer_phone;
ALTER TABLE jobs DROP COLUMN customer_email;

-- ============================================================================
-- 6. jobs.customer_id (required) + parent_job_id (clone) (01J + 01M)
-- ============================================================================
ALTER TABLE jobs ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE jobs ALTER COLUMN customer_id SET NOT NULL;
CREATE INDEX idx_jobs_customer ON jobs(customer_id) WHERE deleted_at IS NULL;

ALTER TABLE jobs ADD COLUMN parent_job_id UUID REFERENCES jobs(id) ON DELETE RESTRICT;
CREATE INDEX idx_jobs_parent ON jobs(parent_job_id) WHERE parent_job_id IS NOT NULL;

-- Reconstruction-only idempotency
CREATE UNIQUE INDEX idx_jobs_one_reconstruction_per_parent
    ON jobs(parent_job_id)
    WHERE job_type = 'reconstruction' AND deleted_at IS NULL AND parent_job_id IS NOT NULL;

-- ============================================================================
-- 7. Tighten jobs.property_id NOT NULL (01J)
-- ============================================================================
ALTER TABLE jobs ALTER COLUMN property_id SET NOT NULL;

-- ============================================================================
-- 8. last_activity_at trigger (01J Decision #21)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_property_last_activity()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.property_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
        UPDATE properties
        SET last_activity_at = GREATEST(COALESCE(last_activity_at, NEW.updated_at), NEW.updated_at)
        WHERE id = NEW.property_id;
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.property_id IS DISTINCT FROM NEW.property_id
       AND OLD.property_id IS NOT NULL THEN
        UPDATE properties p
        SET last_activity_at = (
            SELECT MAX(j.updated_at) FROM jobs j
            WHERE j.property_id = p.id AND j.deleted_at IS NULL
        )
        WHERE p.id = OLD.property_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jobs_update_property_activity
    AFTER INSERT OR UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_property_last_activity();

-- ============================================================================
-- 9. match_properties_close RPC for tier-based property match (01K)
-- ============================================================================
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
""")


def downgrade() -> None:
    op.execute("""
-- Inverse order
DROP FUNCTION IF EXISTS match_properties_close(UUID, TEXT, FLOAT, UUID);
DROP TRIGGER IF EXISTS trg_jobs_update_property_activity ON jobs;
DROP FUNCTION IF EXISTS update_property_last_activity();
ALTER TABLE jobs ALTER COLUMN property_id DROP NOT NULL;
DROP INDEX IF EXISTS idx_jobs_one_reconstruction_per_parent;
DROP INDEX IF EXISTS idx_jobs_parent;
ALTER TABLE jobs DROP COLUMN IF EXISTS parent_job_id;
ALTER TABLE jobs ALTER COLUMN customer_id DROP NOT NULL;
DROP INDEX IF EXISTS idx_jobs_customer;
ALTER TABLE jobs DROP COLUMN IF EXISTS customer_id;
ALTER TABLE jobs ADD COLUMN customer_name TEXT;
ALTER TABLE jobs ADD COLUMN customer_phone TEXT;
ALTER TABLE jobs ADD COLUMN customer_email TEXT;
DROP INDEX IF EXISTS idx_properties_company_last_activity;
DROP INDEX IF EXISTS idx_properties_customer;
ALTER TABLE properties DROP COLUMN IF EXISTS last_activity_at;
ALTER TABLE properties DROP COLUMN IF EXISTS access_notes;
ALTER TABLE properties DROP COLUMN IF EXISTS key_location;
ALTER TABLE properties DROP COLUMN IF EXISTS gate_code;
ALTER TABLE properties DROP COLUMN IF EXISTS customer_id;
DROP TABLE IF EXISTS customers CASCADE;
""")
```

- [ ] **Step 4:** Apply locally:
```bash
cd backend && alembic upgrade head
```
Expected: clean upgrade, no errors.

- [ ] **Step 5:** Smoke test schema:
```bash
cd backend && python -c "
import asyncio
from api.shared.database import get_supabase_admin_client

async def check():
    c = await get_supabase_admin_client()
    for t in ('customers',):
        r = await c.table(t).select('*').limit(0).execute()
        print(f'{t}: ok')
    # Verify match RPC exists
    rpc = await c.rpc('match_properties_close', {
        'p_company_id': '00000000-0000-0000-0000-000000000000',
        'p_input': 'test', 'p_threshold': 0.7
    }).execute()
    print('match_properties_close RPC: ok')

asyncio.run(check())
"
```

- [ ] **Step 6:** Test downgrade roundtrip:
```bash
cd backend && alembic downgrade -1 && alembic upgrade head
```

- [ ] **Step 7:** Commit:
```bash
git add backend/alembic/versions/<rev>_foundation_customer_property.py
git commit -m "migration: foundation rollout — customers + property_id wiring + clone schema"
```

---

## Phase 2: Phone normalization helper (01J)

### Task 2.1: Test + implement `normalize_phone`

**Files:** `backend/api/shared/phone.py`, `backend/tests/test_phone_normalization.py`

- [ ] **Step 1:** Write failing tests:

```python
# backend/tests/test_phone_normalization.py
import pytest
from api.shared.phone import normalize_phone
from api.shared.exceptions import AppException


@pytest.mark.parametrize("raw,expected", [
    ("(555) 555-1234", "+15555551234"),
    ("555-555-1234", "+15555551234"),
    ("555.555.1234", "+15555551234"),
    ("+1 555 555 1234", "+15555551234"),
    ("5555551234", "+15555551234"),
])
def test_us_freeform_to_e164(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize("raw", ["", "abc", "555", "1234567890123456789"])
def test_invalid_raises(raw):
    with pytest.raises(AppException) as e:
        normalize_phone(raw)
    assert e.value.error_code == "INVALID_PHONE"
    assert e.value.status_code == 422


def test_input_over_64_chars_raises():
    with pytest.raises(AppException):
        normalize_phone("1" * 65)
```

- [ ] **Step 2:** Run, expect failure (module doesn't exist).

- [ ] **Step 3:** Implement `backend/api/shared/phone.py`:

```python
import phonenumbers
from api.shared.exceptions import AppException

MAX_RAW_INPUT_LENGTH = 64
DEFAULT_REGION = "US"


def normalize_phone(raw: str) -> str:
    if not raw or len(raw) > MAX_RAW_INPUT_LENGTH:
        raise AppException(422, "Phone empty or too long", "INVALID_PHONE")
    try:
        parsed = phonenumbers.parse(raw, DEFAULT_REGION)
    except phonenumbers.NumberParseException as e:
        raise AppException(422, f"Phone unparseable: {e}", "INVALID_PHONE") from e
    if not phonenumbers.is_valid_number(parsed):
        raise AppException(422, "Phone not valid", "INVALID_PHONE")
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
```

- [ ] **Step 4:** Run tests, expect pass.

- [ ] **Step 5:** Commit:
```bash
git add backend/api/shared/phone.py backend/tests/test_phone_normalization.py
git commit -m "shared: normalize_phone E.164 helper (01J)"
```

---

## Phase 3: Encryption + sanitization helpers (01L)

### Task 3.1: Implement Fernet `gate_code` encryption helpers

**Files:** `backend/api/shared/encryption.py`, `backend/tests/test_gate_code_encryption.py`

- [ ] **Step 1:** Write failing tests:

```python
# backend/tests/test_gate_code_encryption.py
import os
import pytest
from cryptography.fernet import Fernet
from api.shared.encryption import encrypt_gate_code, decrypt_gate_code


@pytest.fixture(autouse=True)
def setup_keys(monkeypatch):
    monkeypatch.setenv("GATE_CODE_FERNET_KEYS", Fernet.generate_key().decode())
    # Reset module-level state
    import api.shared.encryption as enc
    enc._fernet = None


def test_encrypt_decrypt_roundtrip():
    plaintext = "1234"
    ct = encrypt_gate_code(plaintext)
    assert ct != plaintext
    assert decrypt_gate_code(ct) == plaintext


def test_encrypt_none_returns_none():
    assert encrypt_gate_code(None) is None
    assert encrypt_gate_code("") is None


def test_decrypt_none_returns_none():
    assert decrypt_gate_code(None) is None


def test_decrypt_invalid_raises():
    from cryptography.fernet import InvalidToken
    with pytest.raises(InvalidToken):
        decrypt_gate_code("not-a-valid-token")


def test_multifernet_rotates(monkeypatch):
    """Old key still decrypts after new key prepended."""
    old_key = Fernet.generate_key().decode()
    monkeypatch.setenv("GATE_CODE_FERNET_KEYS", old_key)
    import api.shared.encryption as enc
    enc._fernet = None
    ct_old = encrypt_gate_code("9999")

    new_key = Fernet.generate_key().decode()
    monkeypatch.setenv("GATE_CODE_FERNET_KEYS", f"{new_key},{old_key}")  # new first
    enc._fernet = None
    assert decrypt_gate_code(ct_old) == "9999"  # old token still decrypts
    ct_new = encrypt_gate_code("9999")
    assert ct_new != ct_old  # encrypted with new key
```

- [ ] **Step 2:** Run tests, expect failure.

- [ ] **Step 3:** Implement `backend/api/shared/encryption.py`:

```python
import os
from cryptography.fernet import Fernet, MultiFernet

_fernet: MultiFernet | None = None


def _build_fernet() -> MultiFernet:
    keys_csv = os.environ["GATE_CODE_FERNET_KEYS"]
    keys = [k.strip() for k in keys_csv.split(",") if k.strip()]
    if not keys:
        raise RuntimeError("GATE_CODE_FERNET_KEYS is empty")
    return MultiFernet([Fernet(k) for k in keys])


def encrypt_gate_code(plaintext: str | None) -> str | None:
    if not plaintext:
        return None
    global _fernet
    if _fernet is None:
        _fernet = _build_fernet()
    return _fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_gate_code(ciphertext: str | None) -> str | None:
    if not ciphertext:
        return None
    global _fernet
    if _fernet is None:
        _fernet = _build_fernet()
    return _fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
```

- [ ] **Step 4:** Run tests, expect pass. Commit.

### Task 3.2: Notes sanitization helper

**Files:** `backend/api/shared/sanitize_notes.py`, tests inline

- [ ] **Step 1:** Implement (tests trivial — single function):

```python
# backend/api/shared/sanitize_notes.py
import bleach

def sanitize_access_notes(value: str | None) -> str | None:
    if not value:
        return value
    # Strip ALL HTML tags + attributes; plaintext only
    return bleach.clean(value, tags=[], attributes={}, strip=True)
```

- [ ] **Step 2:** Add tests in `backend/tests/test_sanitize_notes.py`:

```python
from api.shared.sanitize_notes import sanitize_access_notes

def test_strips_html_tags():
    assert sanitize_access_notes("<script>alert(1)</script>hello") == "hello"

def test_strips_links():
    assert sanitize_access_notes('<a href="x">link</a>') == "link"

def test_passes_through_plain_text():
    assert sanitize_access_notes("Dog in yard, bring treats") == "Dog in yard, bring treats"

def test_none_passthrough():
    assert sanitize_access_notes(None) is None
```

- [ ] **Step 3:** Run tests, commit.

---

## Phase 4: Customers module skeleton + CRUD endpoints (01J)

### Task 4.1: Module scaffold + register router

**Files:** `backend/api/customers/{__init__.py, schemas.py, service.py, router.py}`, `backend/api/main.py`

- [ ] **Step 1:** Create empty `__init__.py`.
- [ ] **Step 2:** Create `schemas.py` with all 6 Pydantic models (`CustomerCreate`, `CustomerUpdate`, `CustomerResponse`, `CustomerListItem`, `CustomerDetailResponse`, `CustomerDuplicateResponse`, `CustomerMatchResponse`):

```python
from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

CustomerType = Literal["individual", "commercial"]


class CustomerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=200)
    entity_name: str | None = Field(None, max_length=200)
    phone: str | None = Field(None, max_length=64)
    email: EmailStr | None = Field(None, max_length=320)
    customer_type: CustomerType = "individual"
    notes: str | None = Field(None, max_length=10000)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be blank")
        return v


class CustomerUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=200)
    entity_name: str | None = Field(None, max_length=200)
    phone: str | None = Field(None, max_length=64)
    email: EmailStr | None = Field(None, max_length=320)
    customer_type: CustomerType | None = None
    notes: str | None = Field(None, max_length=10000)


class CustomerResponse(BaseModel):
    id: UUID
    company_id: UUID
    name: str
    entity_name: str | None
    phone: str | None
    email: str | None
    customer_type: CustomerType
    notes: str | None
    created_at: datetime
    updated_at: datetime


class CustomerListItem(BaseModel):
    id: UUID
    name: str
    entity_name: str | None
    customer_type: CustomerType


class CustomerDetailResponse(CustomerResponse):
    property_count: int
    job_count: int


class CustomerDuplicateResponse(BaseModel):
    """409 body when phone collision; explicit whitelist."""
    id: UUID
    name: str
    entity_name: str | None
    customer_type: CustomerType
    phone: str


class CustomerMatchResponse(BaseModel):
    tier: Literal["exact", "close", "none"]
    matches: list[CustomerListItem]
```

- [ ] **Step 3:** Empty `service.py` (filled in Tasks 4.2+).

- [ ] **Step 4:** `router.py`:

```python
from fastapi import APIRouter
router = APIRouter(prefix="/customers", tags=["customers"])
# Endpoints added in Tasks 4.2-4.6
```

- [ ] **Step 5:** Register in `backend/api/main.py`:

```python
from api.customers.router import router as customers_router
# ... existing imports ...
app.include_router(customers_router, prefix="/v1")
```

- [ ] **Step 6:** Commit:
```bash
git add backend/api/customers/ backend/api/main.py
git commit -m "customers: scaffold module + register router (01J)"
```

### Task 4.2: POST /v1/customers happy path + phone normalization

**Files:** `backend/api/customers/service.py`, `router.py`, `backend/tests/test_customers.py`

- [ ] **Step 1:** Failing test:

```python
# backend/tests/test_customers.py
import pytest
from httpx import AsyncClient


class TestCustomerCreate:
    @pytest.mark.asyncio
    async def test_full_payload(self, authenticated_client: AsyncClient, company_id: str):
        body = {
            "name": "Sarah Johnson",
            "entity_name": "ABC Property Management",
            "phone": "(555) 555-1234",
            "email": "sarah@abc.com",
            "customer_type": "commercial",
            "notes": "Decision-maker"
        }
        r = await authenticated_client.post("/v1/customers", json=body)
        assert r.status_code == 201
        d = r.json()
        assert d["name"] == "Sarah Johnson"
        assert d["phone"] == "+15555551234"  # normalized
        assert d["customer_type"] == "commercial"
        assert d["company_id"] == company_id

    @pytest.mark.asyncio
    async def test_minimal(self, authenticated_client: AsyncClient):
        r = await authenticated_client.post("/v1/customers", json={"name": "John Smith"})
        assert r.status_code == 201
        d = r.json()
        assert d["customer_type"] == "individual"
        assert d["phone"] is None

    @pytest.mark.asyncio
    async def test_blank_name_rejected(self, authenticated_client: AsyncClient):
        r = await authenticated_client.post("/v1/customers", json={"name": "   "})
        assert r.status_code == 422
```

- [ ] **Step 2:** Run, expect 404 (route not registered).

- [ ] **Step 3:** Implement `service.py`:

```python
from datetime import UTC, datetime
from uuid import UUID

from api.customers.schemas import CustomerCreate, CustomerUpdate
from api.shared.database import get_authenticated_client, get_supabase_admin_client
from api.shared.events import log_event
from api.shared.exceptions import AppException
from api.shared.phone import normalize_phone


async def create_customer(token: str, company_id: UUID, user_id: UUID, body: CustomerCreate) -> dict:
    client = await get_authenticated_client(token)
    normalized_phone = normalize_phone(body.phone) if body.phone else None
    insert_data = {
        "company_id": str(company_id),
        "name": body.name.strip(),
        "entity_name": body.entity_name.strip() if body.entity_name else None,
        "phone": normalized_phone,
        "email": body.email.lower().strip() if body.email else None,
        "customer_type": body.customer_type,
        "notes": body.notes,
    }
    try:
        result = await client.table("customers").insert(insert_data).execute()
    except Exception as exc:
        if "23505" in str(exc) or "duplicate key" in str(exc).lower():
            existing = await (
                client.table("customers")
                .select("id, name, entity_name, customer_type, phone")
                .eq("company_id", str(company_id))
                .eq("phone", normalized_phone)
                .is_("deleted_at", "null")
                .single()
                .execute()
            )
            await log_event(company_id, "customer_dedup_collision", user_id=user_id,
                event_data={"phone": normalized_phone, "existing_id": existing.data["id"]})
            raise AppException(409, existing.data, "CUSTOMER_DUPLICATE_PHONE") from exc
        raise

    row = result.data[0]
    await log_event(company_id, "customer_created", user_id=user_id,
        event_data={"customer_id": row["id"]})
    return row
```

- [ ] **Step 4:** Add POST endpoint to `router.py`:

```python
from fastapi import Depends, Request
from uuid import UUID

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.customers.schemas import CustomerCreate, CustomerResponse
from api.customers.service import create_customer
from api.shared.dependencies import _get_token


@router.post("", status_code=201, response_model=CustomerResponse)
async def create_customer_endpoint(
    body: CustomerCreate, request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    return await create_customer(_get_token(request), ctx.company_id, ctx.user_id, body)
```

- [ ] **Step 5:** Run tests, expect pass. Commit.

### Task 4.3: POST dedup, body validation, RLS isolation tests

Append to `test_customers.py`. Combines: phone-dedup-409 with whitelisted body, dedup-excludes-soft-deleted, mass-assignment rejection (extra="forbid", company_id, deleted_at), notes max length, phone max length, RLS isolation, same-phone-across-companies-allowed.

- [ ] **Step 1:** Add tests (~150 lines, see spec § Testing for full list).
- [ ] **Step 2:** Run, expect pass (already-implemented from Task 4.2).
- [ ] **Step 3:** Commit `customers: lock body-validation + dedup + RLS contracts`.

### Task 4.4: GET /v1/customers/{id} (full PII + counts)

- [ ] **Step 1:** Tests:

```python
class TestCustomerGet:
    @pytest.mark.asyncio
    async def test_returns_full_pii_and_counts(self, authenticated_client):
        c = await authenticated_client.post("/v1/customers", json={"name": "X", "phone": "+15554443333"})
        cid = c.json()["id"]
        r = await authenticated_client.get(f"/v1/customers/{cid}")
        assert r.status_code == 200
        assert r.json()["phone"] == "+15554443333"
        assert r.json()["property_count"] == 0
        assert r.json()["job_count"] == 0

    @pytest.mark.asyncio
    async def test_404_when_not_found(self, authenticated_client):
        r = await authenticated_client.get("/v1/customers/00000000-0000-0000-0000-000000000000")
        assert r.status_code == 404
```

- [ ] **Step 2:** Implement `get_customer` (see 01J spec for full body — runs property_count + job_count via two `count="exact"` queries).
- [ ] **Step 3:** Add GET endpoint, run tests, commit.

### Task 4.5: GET /v1/customers list + multi-field input-shape search

Per 01J Decision #18: digits → phone exact; `@` → email ilike; else → fuzzy on name + entity_name. Response items exclude PII.

- [ ] **Step 1:** Tests (pagination, name fuzzy, phone prefix, email at-sign, PII excluded — see 01J spec).
- [ ] **Step 2:** Implement `list_customers` with input-shape dispatch helper.
- [ ] **Step 3:** Run, commit.

### Task 4.6: PATCH /v1/customers/{id} normalize-then-compare

- [ ] **Step 1:** Tests (happy path, phone same-format-different-string no redundant check, phone collision 409, deleted_at body rejected).
- [ ] **Step 2:** Implement `update_customer` with normalize-then-compare on phone.
- [ ] **Step 3:** Commit.

### Task 4.7: DELETE /v1/customers/{id} with dependents pre-flight

Per 01J Decision #15: blocked when referenced by non-deleted property OR job → 409.

- [ ] **Step 1:** Tests (admin-only, succeeds when no dependents, blocked when property/job references, hard-delete blocked via authenticated client).
- [ ] **Step 2:** Implement `delete_customer` using admin client + 0-count pre-flight.
- [ ] **Step 3:** Commit.

---

## Phase 5: Properties extension (01J + 01K + 01L)

### Task 5.1: Update PropertyCreate / PropertyUpdate / PropertyResponse schemas

- [ ] **Step 1:** Edit `backend/api/properties/schemas.py`:
  - Add `customer_id: UUID | None = None` to `PropertyCreate` and `PropertyUpdate`
  - Add `PropertyCustomerNested` with whitelist (id, name, entity_name, customer_type, phone, email)
  - Add `customer: PropertyCustomerNested | None` to `PropertyResponse`
  - Add `last_activity_at: datetime | None`
  - **PropertyUpdate explicitly excludes `gate_code`, `key_location`, `access_notes`** (extra="forbid" handles it; doc the intent)

- [ ] **Step 2:** Commit `properties: schemas — accept customer_id + nested customer + last_activity (01J/01L)`.

### Task 5.2: POST /v1/properties accepts customer_id with cross-company validation + 23505 catch

- [ ] **Step 1:** Tests:
  - `test_create_with_customer_id`
  - `test_create_with_customer_id_from_other_company_404` (uses `secondary_company_client` fixture)
  - `test_create_duplicate_address_returns_409_with_existing_id` (01K Decision #9)
  - `test_get_returns_nested_customer`

- [ ] **Step 2:** Update `create_property`:
  - If `customer_id` provided, pre-fetch customer → 0 rows = 404 CUSTOMER_NOT_FOUND
  - Round latitude/longitude to 5 decimals
  - On insert, catch 23505 unique-violation on `idx_properties_company_usps_active`, fetch existing, return 409 PROPERTY_DUPLICATE
  - Use embed-style SELECT for response: `select="*, customer:customers(id, name, entity_name, customer_type, phone, email)"`

- [ ] **Step 3:** Run, commit.

### Task 5.3: PATCH /v1/properties/{id} with admin gate + 23505 catch on address change

- [ ] **Step 1:** Tests:
  - `test_change_owner_admin_succeeds`
  - `test_change_owner_tech_role_403`
  - `test_set_owner_initial_null_to_value_admin_only` (Decision #13 — even initial set is admin-only)
  - `test_change_owner_logs_event_with_old_and_new`
  - `test_patch_customer_id_from_other_company_404`
  - `test_patch_address_change_collision_returns_409_property_address_belongs_to_other` (01K Decision #10)
  - `test_patch_rejects_gate_code_in_main_route` (01L Decision: notes go through `/notes` only)

- [ ] **Step 2:** Update `update_property`:
  - Accept `user_role` parameter; admin-only for `customer_id` mutations
  - Cross-company validation when customer_id is being set
  - 23505 catch on PATCH → 409 with conflicting property's id
  - Reject notes fields on this route (let `extra="forbid"` handle)
  - log_event `property_owner_changed` when customer_id changes

- [ ] **Step 3:** Update router endpoint to pass `ctx.role`.
- [ ] **Step 4:** Run, commit.

### Task 5.4: GET /v1/properties/{id}/jobs sub-resource

- [ ] **Step 1:** Tests (chronological order, pagination, soft-delete excluded).
- [ ] **Step 2:** Implement service function `list_property_jobs(token, company_id, property_id, limit, offset)` with `ORDER BY created_at DESC, id DESC`. Add router endpoint.
- [ ] **Step 3:** Commit.

### Task 5.5: GET /v1/properties/{id}/photos sub-resource

- [ ] **Step 1:** Tests (aggregated across jobs, deterministic ordering, pagination, page_size cap at 200, single-query no-N+1, soft-delete excluded, RLS isolation).
- [ ] **Step 2:** Implement single-query JOIN:

```python
async def list_property_photos(token, company_id, property_id, limit=50, offset=0):
    client = await get_authenticated_client(token)
    # Embed jobs to access property_id constraint via PostgREST relationship
    result = await (
        client.table("photos")
        .select("*, job:jobs!inner(id, job_number, property_id, deleted_at)", count="exact")
        .eq("company_id", str(company_id))
        .eq("job.property_id", str(property_id))
        .is_("job.deleted_at", "null")
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .order("id", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return {"items": result.data, "total": result.count or 0}
```

- [ ] **Step 3:** Add `Field(default=50, ge=1, le=200)` to the page_size query param.
- [ ] **Step 4:** Commit.

### Task 5.6: PATCH /v1/properties/{id}/notes (the only notes endpoint)

- [ ] **Step 1:** Tests:
  - `test_partial_patch_only_changes_specified_fields`
  - `test_member_can_edit` (NOT admin-only)
  - `test_max_lengths_enforced`
  - `test_access_notes_html_stripped` — body `<script>alert(1)</script>hello` → stored `hello`
  - `test_gate_code_encrypted_at_rest` — DB row's `gate_code` differs from input plaintext
  - `test_extra_fields_rejected`

- [ ] **Step 2:** Add `PropertyNotesUpdate` schema:

```python
class PropertyNotesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gate_code: str | None = Field(None, max_length=128)
    key_location: str | None = Field(None, max_length=500)
    access_notes: str | None = Field(None, max_length=5000)
```

- [ ] **Step 3:** Implement `update_property_notes`:

```python
from api.shared.encryption import encrypt_gate_code
from api.shared.sanitize_notes import sanitize_access_notes


async def update_property_notes(token, company_id, user_id, property_id, body: PropertyNotesUpdate):
    client = await get_authenticated_client(token)
    update_data = body.model_dump(exclude_unset=True)
    if "gate_code" in update_data:
        update_data["gate_code"] = encrypt_gate_code(update_data["gate_code"])
    if "access_notes" in update_data:
        update_data["access_notes"] = sanitize_access_notes(update_data["access_notes"])
    if not update_data:
        return await get_property(token, company_id, property_id)
    result = await (
        client.table("properties")
        .update(update_data)
        .eq("id", str(property_id))
        .eq("company_id", str(company_id))
        .single().execute()
    )
    if not result.data:
        raise AppException(404, "Property not found", "PROPERTY_NOT_FOUND")
    return result.data
```

Note: when reading back property via `get_property`, decrypt `gate_code` before returning. Add a `_decrypt_property_row()` helper in service.

- [ ] **Step 4:** Add router endpoint, run tests, commit.

---

## Phase 6: Customer detail aggregations (01L)

### Task 6.1: GET /v1/customers/{id}/properties with LATERAL JOIN

- [ ] **Step 1:** Tests (returns owned properties with latest_job summary, pagination, latest_job is null when no jobs, ordered by last_activity_at DESC, latest_job projection excludes insurance fields, single-query — no N+1).

- [ ] **Step 2:** Add a new RPC for the latest-job-per-property query (PostgREST embed alone can't do "latest" cleanly):

Add to migration → or add a new tiny migration if 1.1 already shipped:

```sql
CREATE OR REPLACE FUNCTION customer_properties_with_latest_job(
    p_company_id UUID,
    p_customer_id UUID,
    p_limit INT,
    p_offset INT
) RETURNS TABLE (
    id UUID, address_line1 TEXT, city TEXT, state TEXT, zip TEXT,
    last_activity_at TIMESTAMPTZ,
    latest_job_id UUID, latest_job_number TEXT, latest_job_type TEXT,
    latest_job_status TEXT, latest_job_completed_at TIMESTAMPTZ,
    job_count BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT
        p.id, p.address_line1, p.city, p.state, p.zip, p.last_activity_at,
        lj.id, lj.job_number, lj.job_type, lj.status, lj.completed_at,
        (SELECT count(*) FROM jobs j2
         WHERE j2.property_id = p.id AND j2.deleted_at IS NULL) AS job_count
    FROM properties p
    LEFT JOIN LATERAL (
        SELECT j.id, j.job_number, j.job_type, j.status, j.completed_at
        FROM jobs j
        WHERE j.property_id = p.id AND j.deleted_at IS NULL
        ORDER BY j.created_at DESC LIMIT 1
    ) lj ON true
    WHERE p.company_id = p_company_id
      AND p.customer_id = p_customer_id
      AND p.deleted_at IS NULL
    ORDER BY p.last_activity_at DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset;
$$;
```

- [ ] **Step 3:** Add this function to the migration (ensures it ships in the same revision; or write a follow-up alembic if main migration already merged — for unified rollout, add to `1.1` before merge).

- [ ] **Step 4:** Implement service function `list_customer_properties(token, company_id, customer_id, limit, offset)` calling the RPC; map result rows to `LatestJobSummary` model.

- [ ] **Step 5:** Add router endpoint. Run tests. Commit.

---

## Phase 7: Match endpoints + rate limiting (01K)

### Task 7.1: Add rate-limit middleware (if not already present)

- [ ] **Step 1:** Check existing middleware: `grep -r "rate.limit\|RateLimit" backend/api/`.
- [ ] **Step 2:** If absent, install `slowapi`:
```bash
cd backend && pip install slowapi
```
Add to `pyproject.toml`. Configure in `backend/api/main.py`:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=lambda req: req.headers.get("authorization", get_remote_address(req)))
app.state.limiter = limiter
```

- [ ] **Step 3:** Commit.

### Task 7.2: GET /v1/customers/match

- [ ] **Step 1:** Tests:
  - `test_phone_exact_via_normalize_phone`
  - `test_phone_invalid_falls_back_to_name_fuzzy` (catches INVALID_PHONE)
  - `test_at_sign_dispatches_to_email`
  - `test_else_fuzzy_on_name_and_entity`
  - `test_response_excludes_pii`
  - `test_rate_limit_429`

- [ ] **Step 2:** Implement service function `match_customers` with input-shape dispatch + try/except on phone normalization.

- [ ] **Step 3:** Add router endpoint with `@limiter.limit("60/minute")` decorator. Commit.

### Task 7.3: GET /v1/properties/match

- [ ] **Step 1:** Tests:
  - `test_exact_tier`
  - `test_close_tier_via_pg_trgm`
  - `test_no_tier`
  - `test_customer_id_boost_orders_owned_first`
  - `test_response_customer_projection_excludes_pii` (only id + display_name)
  - `test_rls_isolation`
  - `test_rate_limit_429`

- [ ] **Step 2:** Implement service function calling `match_properties_close` RPC + exact-tier SELECT first. Whitelist customer projection in the response composition step.

- [ ] **Step 3:** Add router endpoint with rate limit. Commit.

---

## Phase 8: Jobs refactor (01J + 01M)

### Task 8.1: Update Job schemas (drop denorm, required FKs, nested response, clone_from_job_id, parent_job_id in response)

- [ ] **Step 1:** Edit `backend/api/jobs/schemas.py`:

```python
class JobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    customer_id: UUID
    property_id: UUID
    job_number: str = Field(..., min_length=1, max_length=100)
    job_type: Literal["mitigation", "reconstruction"] = "mitigation"
    clone_from_job_id: UUID | None = None
    # insurance + loss fields, all optional/overridable (full list per 01M COPY_FIELDS)
    loss_date: date | None = None
    claim_number: str | None = None
    carrier: str | None = None
    adjuster_name: str | None = None
    adjuster_phone: str | None = None
    adjuster_email: str | None = None
    loss_type: Literal["water", "fire", "mold", "storm", "other"] = "water"
    loss_category: Literal["1", "2", "3"] | None = None
    loss_class: Literal["1", "2", "3", "4"] | None = None
    loss_cause: str | None = None
    notes: str | None = None
    # NOTE: parent_job_id, customer_name, customer_phone, customer_email, address_* OMITTED


class JobCustomerNested(BaseModel):
    id: UUID
    name: str
    entity_name: str | None
    customer_type: str
    phone: str | None
    email: str | None


class JobPropertyNested(BaseModel):
    id: UUID
    address_line1: str
    address_line2: str | None
    city: str
    state: str
    zip: str
    latitude: float | None
    longitude: float | None


class JobResponse(BaseModel):
    id: UUID
    company_id: UUID
    customer_id: UUID
    property_id: UUID
    parent_job_id: UUID | None  # NEW (01M Decision #11)
    linked_job_id: UUID | None  # existing from 01B
    job_number: str
    job_type: str
    status: str
    # ... insurance + loss + dates ...
    customer: JobCustomerNested
    property: JobPropertyNested
    created_at: datetime
    updated_at: datetime


class IdempotentJobResponse(JobResponse):
    idempotent_replay: bool = False  # 01M Decision #11
```

Update `JobUpdate` similarly (all fields Optional, no `clone_from_job_id`).

- [ ] **Step 2:** Commit `jobs: schemas — required FKs + nested response + clone_from_job_id (01J/01M)`.

### Task 8.2: Refactor `create_job` with FK pre-fetch + clone logic

- [ ] **Step 1:** Add full set of failing tests:
  - `test_create_requires_customer_id` / `_property_id`
  - `test_rejects_inline_customer_fields` / `_address_fields`
  - `test_with_customer_from_other_company_404` / `_property_from_other_company_404`
  - `test_response_has_nested_customer_and_property`
  - `test_clone_copies_insurance_fields_from_source`
  - `test_clone_body_overrides_source_fields`
  - `test_clone_sets_parent_job_id`
  - `test_clone_does_not_copy_scope_or_notes`
  - `test_clone_with_source_from_other_company_404`
  - `test_reconstruction_clone_idempotent_serial`
  - `test_reconstruction_clone_idempotent_concurrent_double_click` (asyncio.gather)
  - `test_non_reconstruction_clones_can_multiply`
  - `test_clone_when_source_soft_deleted_returns_existing_reconstruction` (Decision #18)
  - `test_idempotent_replay_does_not_double_log_audit`
  - `test_idempotent_replay_preserves_original_created_by`
  - `test_idempotent_replay_filters_company_id` (Decision #16)
  - `test_reconstruction_clone_populates_linked_job_id` (Decision #12)
  - `test_non_reconstruction_clone_does_not_populate_linked_job_id`
  - `test_parent_job_id_unsettable_via_any_path`
  - `test_audit_log_event_data_excludes_pii`

- [ ] **Step 2:** Implement `create_job` per 01M spec. Full body in spec § "API Endpoints" → "Modified: POST /v1/jobs". Key elements:
  - FK pre-fetch (customer + property) — 404 on miss
  - If `clone_from_job_id`: source pre-fetch with idempotent fallback
  - COPY_FIELDS list (10 fields)
  - Body overrides clone (including explicit None)
  - `linked_job_id = parent_job_id` for reconstruction (Decision #12)
  - 23505 catch with company-scoped existing-row lookup (Decision #16)
  - Service-layer `assert "parent_job_id" not in body_dict` (Decision #15)
  - Single audit event on first insert only
  - Return `IdempotentJobResponse` shape with embeds

- [ ] **Step 3:** Helper `_fetch_job_with_embeds` for response composition.

- [ ] **Step 4:** Run all tests, commit.

### Task 8.3: GET /v1/jobs/{id}/reconstruction lookup endpoint

- [ ] **Step 1:** Tests (returns linked, 404 when none, RLS isolation, soft-delete excluded).
- [ ] **Step 2:** Implement service + router. Commit.

### Task 8.4: Soft-delete blocked when reconstruction child exists

- [ ] **Step 1:** Test `test_source_job_soft_delete_blocked_when_reconstruction_child_exists` (Decision #17).
- [ ] **Step 2:** Update `delete_job` (or whatever the soft-delete service is) with pre-flight: 0-count query for `parent_job_id = $id AND job_type = 'reconstruction' AND deleted_at IS NULL`. If > 0 → 409 `JOB_HAS_DEPENDENT_RECONSTRUCTION`.
- [ ] **Step 3:** Run, commit.

### Task 8.5: Update existing job tests for new payload + response shapes

- [ ] **Step 1:** Find broken tests:
```bash
cd backend && pytest tests/test_jobs.py -v 2>&1 | grep -E "FAIL|ERROR"
```
- [ ] **Step 2:** Walk through each, replace inline customer/address fields with FKs, replace response field reads with nested.
- [ ] **Step 3:** All pass. Commit.

---

## Phase 9: Share-link redaction (column projection) (01J)

### Task 9.1: Update share-link service to use column whitelist

- [ ] **Step 1:** Locate share-link module: `grep -rn "redact\|adjuster" backend/api/`.
- [ ] **Step 2:** Tests:
  - `test_share_link_response_omits_phone_email_notes_keys` (raw service response shape — pre-serialization assertion)
  - `test_share_link_includes_customer_name_and_entity`
  - `test_share_link_omits_customer_notes_explicitly`
- [ ] **Step 3:** Update the share-link query to project explicitly:

```python
result = await (
    admin_client.table("jobs")
    .select("""
        id, job_number, status, ...,
        property:properties(
            id, address_line1, city, state, zip,
            customer:customers(id, name, entity_name, customer_type)
        )
    """)
    .eq("id", str(job_id)).single().execute()
)
```

- [ ] **Step 4:** Run, commit.

---

## Phase 10: Frontend — Types + base hooks (01J + 01M)

### Task 10.1: Update types.ts

- [ ] **Step 1:** Edit `web/src/lib/types.ts`. Add `Customer`, `CustomerListItem`, `CustomerCreate`, `CustomerUpdate`, `CustomerNested`, `PropertyNested`. Update `Property` (add nested `customer`, `last_activity_at`, notes fields). Update `Job` (drop `customer_*`, `address_*`; add nested `customer`, `property`, `parent_job_id`).

- [ ] **Step 2:** Update `web/src/lib/__tests__/types.test.ts`.
- [ ] **Step 3:** `cd web && npx tsc --noEmit` — fix any compile errors at call sites (mostly mechanical replacements).
- [ ] **Step 4:** Commit.

### Task 10.2: use-customers + use-reconstruction hooks

- [ ] **Step 1:** Create `web/src/lib/hooks/use-customers.ts` with all 5 query/mutation hooks (mirror `use-properties.ts`).
- [ ] **Step 2:** Create `web/src/lib/hooks/use-reconstruction.ts` (returns null on 404).
- [ ] **Step 3:** Type-check. Commit.

### Task 10.3: use-customer-match + use-property-match hooks

- [ ] **Step 1:** Create both hooks with `enabled: query.length > 0` guards.
- [ ] **Step 2:** Type-check, commit.

### Task 10.4: use-property-detail + use-customer-detail hooks

- [ ] **Step 1:** Each fetches the parent + sub-resources (jobs, photos, owned-properties).
- [ ] **Step 2:** Type-check, commit.

### Task 10.5: Update existing screens reading job.customer_*

- [ ] **Step 1:** Grep call sites:
```bash
grep -rn "customer_name\|customer_phone\|customer_email\|address_line1.*\bjob\b" web/src/
```
- [ ] **Step 2:** Replace each with nested access (`job.customer?.name ?? "Unknown"` defensive).
- [ ] **Step 3:** Run frontend tests + type-check. Commit.

---

## Phase 11: Frontend — Pickers (01K)

### Task 11.1: build-usps-standardized helper (frontend mirror of backend)

- [ ] **Step 1:** Create `web/src/lib/build-usps-standardized.ts`:
```typescript
export function buildUSPSStandardized(parts: {
  address_line1: string; city: string; state: string; zip: string;
  address_line2?: string | null;
}): string {
  return [
    parts.address_line1.trim().toLowerCase(),
    (parts.address_line2 ?? "").trim().toLowerCase(),
    parts.city.trim().toLowerCase(),
    parts.state.trim().toLowerCase(),
    parts.zip.trim().toLowerCase(),
  ].filter(Boolean).join(" ");
}
```
- [ ] **Step 2:** Add a unit test mirroring the backend test cases (same input → same output). Commit.

### Task 11.2: CustomerPicker component

- [ ] **Step 1:** Create `web/src/components/customer-picker.tsx` (~200 LOC). Inline create form opens on "Create new" click. Tier-routes via 409 dedup re-prompt.
- [ ] **Step 2:** Add component tests (vitest + RTL): debounce, tier-exact auto-select, tier-close dialog, create-new flow, 409 dedup re-prompt.
- [ ] **Step 3:** Run, commit.

### Task 11.3: PropertyPicker component (wraps existing AddressAutocomplete)

- [ ] **Step 1:** Create `web/src/components/property-picker.tsx`. Wrap existing `<AddressAutocomplete>`. On its `onSelect`, call `usePropertyMatch` with `{usps_standardized, customer_id}`. Tier-routes:

```tsx
function PropertyPicker({ customerId, value, onChange }: Props) {
  const [addrParts, setAddrParts] = useState<AddressParts | null>(null);
  const usps = addrParts ? buildUSPSStandardized(addrParts) : null;
  const { data: match } = usePropertyMatch({
    usps_standardized: usps,
    customer_id: customerId,
  });

  useEffect(() => {
    if (match?.tier === "exact") {
      onChange(match.matches[0].id);
      toast(`Using existing property at ${match.matches[0].address_line1}`);
    }
  }, [match]);

  return (
    <>
      <AddressAutocomplete onSelect={setAddrParts} />
      {match?.tier === "close" && (
        <CloseMatchDialog
          matches={match.matches}
          onUseExisting={(id) => onChange(id)}
          onCreateNew={async () => {
            const created = await createProperty({...addrParts, customer_id: customerId});
            onChange(created.id);
          }}
        />
      )}
      {match?.tier === "none" && addrParts && /* auto-create on form submit */ null}
    </>
  );
}
```

- [ ] **Step 2:** Component tests: Google selection → match call → tier dialog routing.
- [ ] **Step 3:** Commit.

### Task 11.4: Wire pickers into the new-job form

- [ ] **Step 1:** Locate the new-job form: `find web/src/app -name "new" -type d` or `grep -r "createJob\|create_job" web/src/app/`.
- [ ] **Step 2:** Replace inline customer + address fields with `<CustomerPicker>` + `<PropertyPicker customerId={customerId}>`. Submit posts `customer_id` + `property_id` only.
- [ ] **Step 3:** E2E test: walk the full flow. Commit.

---

## Phase 12: Frontend — Detail pages + list views + nav (01L)

### Task 12.1: Property Detail Page

- [ ] **Step 1:** Create `web/src/app/(protected)/properties/[id]/page.tsx`. Header + 4 tabs (URL-synced via `?tab=`). Use existing tab components from 01H if present, otherwise build via `useSearchParams`. Notes tab: 3 inline-edit fields with debounced single-field PATCH.
- [ ] **Step 2:** Create supporting components: `<PropertyDetailHeader>`, `<PropertyDetailTabs>`, `<PropertyNotesEditor>`.
- [ ] **Step 3:** Component tests. Commit.

### Task 12.2: Property List View

- [ ] **Step 1:** Create `web/src/app/(protected)/properties/page.tsx`. Search-by-address + sort by `last_activity_at DESC`.
- [ ] **Step 2:** Tests. Commit.

### Task 12.3: Customer Detail Page (property-centric)

- [ ] **Step 1:** Create `web/src/app/(protected)/customers/[id]/page.tsx`. Header + property-centric body (per 01L Decision #2). Fetches via `useCustomerDetail` (calls `/v1/customers/{id}` + `/v1/customers/{id}/properties`).
- [ ] **Step 2:** Tests. Commit.

### Task 12.4: Customer List View

- [ ] **Step 1:** Create `web/src/app/(protected)/customers/page.tsx`. Multi-field search (uses `<CustomerPicker>`-style match in search mode).
- [ ] **Step 2:** Tests. Commit.

### Task 12.5: Sidebar nav additions

- [ ] **Step 1:** Find the sidebar component (likely `web/src/components/sidebar-nav.tsx` or similar). Add Properties + Customers entries between Jobs and Team.
- [ ] **Step 2:** Mobile responsive verification. Commit.

### Task 12.6: "View Property" / "View Customer" links on job detail

- [ ] **Step 1:** Edit `web/src/app/(protected)/jobs/[id]/page.tsx`. Add subtle text links to `/properties/{job.property_id}` and `/customers/{job.customer_id}` next to address + customer name.
- [ ] **Step 2:** Test, commit.

---

## Phase 13: Frontend — Convert to Reconstruction button (01M)

### Task 13.1: ConvertToReconstructionButton

- [ ] **Step 1:** Create `web/src/components/convert-to-reconstruction-button.tsx` (~80 LOC). See 01M spec § "Frontend Architecture" for full body.
- [ ] **Step 2:** Tests:
  - hidden when `job_type !== "mitigation"`
  - hidden when `status !== "completed"`
  - shows "Convert to Reconstruction" when no existing reconstruction
  - shows "View Reconstruction →" when reconstruction exists (toggle via `useReconstruction(jobId)`)
  - dialog confirms before POST
  - redirects to new job after success
- [ ] **Step 3:** Wire into `web/src/app/(protected)/jobs/[id]/page.tsx`. Commit.

---

## Phase 14: Verification

### Task 14.1: Backend full test suite + lint

- [ ] **Step 1:** `cd backend && pytest -v`. All pass.
- [ ] **Step 2:** `cd backend && ruff check api/`. No errors.
- [ ] **Step 3:** `cd backend && ruff format api/`. If diff, commit `backend: ruff format`.

### Task 14.2: Frontend full test suite + build

- [ ] **Step 1:** `cd web && npm test`. All pass.
- [ ] **Step 2:** `cd web && npm run lint`. No errors.
- [ ] **Step 3:** `cd web && npm run build`. Clean.

### Task 14.3: Manual smoke test against staging (operator step)

- [ ] **Step 1:** Lakshman runs through:
  - Create customer with phone → DB stores E.164 → list endpoint hides phone
  - Create property linked to customer → property detail page renders all 4 tabs
  - Create job (new-job form) → pickers work, customer + property pre-fill
  - Customer detail page lists property + latest-job summary
  - Convert to Reconstruction → new job linked → "View Reconstruction →" toggle works
  - Adjuster share-link → no phone/email/notes visible

### Task 14.4: Move specs to in-progress

- [ ] **Step 1:** `git mv docs/specs/draft/01J-customer-property-model.md docs/specs/in-progress/`
- [ ] **Step 2:** Same for 01K, 01L, 01M, and the impl plan.
- [ ] **Step 3:** Commit `specs: move foundation specs to in-progress`.
- [ ] **Step 4:** `git push origin lm-dev`.

### Task 14.5: Open PR

- [ ] **Step 1:** `gh pr create --base main --title "[V1] Foundation: customer-property data model + pickers + detail pages + clone"` with body referencing the four Linear issues.

---

## Self-Review Notes

Spec coverage: ✅ every Done-When checkbox across the four specs maps to a task.

Type consistency: ✅ `JobResponse`, `PropertyResponse`, `CustomerResponse`, `IdempotentJobResponse`, `PropertyMatchCandidate`, `CustomerMatchResponse` referenced consistently across phases.

Risk callouts:
- The migration is large (single revision, multiple table mutations). Test downgrade path locally + on staging before prod merge.
- `secondary_company_client` and `tech_client` test fixtures may need adding to `backend/tests/conftest.py` — first task that uses them adds them.
- `slowapi` is the first rate-limit library in this codebase; alternative: skip slowapi and write a per-user redis-backed counter if Redis is available. Confirm at impl time.
- The customer-properties LATERAL JOIN RPC needs to ship in the same migration as Phase 1 (otherwise a separate small migration follow-up).
- Frontend pickers reuse the existing `<AddressAutocomplete>` Google Places integration. Make sure `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set in `.env.local` for local dev.

---

## Execution choice

**Subagent-Driven (recommended)** — fresh subagent per task with two-stage review between tasks. Best for a plan this size (~70 tasks).

**Inline Execution** — work in the current session with checkpoints. More context retention, slower per-task overhead.

**Awaiting Lakshman's go before execution.**
