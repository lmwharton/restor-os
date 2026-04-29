# Feature Validator Report — Spec 01K Job Lifecycle

**Branch:** `lm-dev`
**Tag baseline:** `refine-loop/spec-01k-job-lifecycle/v0` → `v2`
**Scope:** 16 atomic commits + 1 fix commit (D9)
**Environment:** local (Supabase Docker port 55322, dev frontend 5173, dev backend 5174)
**Date:** 2026-04-28

## Verdict: **SHIP** ✓

| Track | Initial | After fixes | Notes |
|---|---|---|---|
| API | 14/14 PASS | 14/14 PASS | Full functional coverage. Two minor flags for follow-up (W7 invalid-target should 400 not 200; W8 row count is 14 not 21 — by design, varies per job_type). |
| DB | **12/13 PASS** | **13/13 PASS** | D9 (search_path lock) **fixed via migration `01k_a2_lock_rpc_search_path`**. Verified `proconfig` shows `search_path=pg_catalog,public` on both RPCs. |
| Logs | 7/7 PASS | 7/7 PASS | L5 "bug" was a false positive — re-tested `completed → active` reopen 3× cleanly (HTTP 200 + status flip + `job_reopened` event written). Logs agent likely conflated a 409 from a stale-state retry. |
| Cross-Layer | 12/12 PASS | 12/12 PASS | No contract drift. Frontend ↔ backend transition matrices, status sets, gate item_keys, mutation body schemas all agree. |
| **Total** | **45/46** | **46/46** | |

---

## Track 1 — API (14/14 PASS)

Hit each endpoint with a real JWT for `l@test.com`. Full results in `/tmp/fv-api-results.json`.

| # | Endpoint | Status | error_code | Verdict |
|---|---|---|---|---|
| W1 | `PATCH /v1/jobs/{lead}/status {active, expected=lead}` | 200 | — | PASS — `active_at` set |
| W2 | `PATCH ... {active, expected=completed}` (stale) | **409** | `STATUS_CONFLICT` | PASS — optimistic lock works |
| W3 | `PATCH ... {paid, expected=active}` (illegal) | **400** | `ILLEGAL_TRANSITION` | PASS — matrix enforced server-side |
| W4 | `PATCH ... {active, expected=on_hold}` (no reason) | 200 | — | PASS — resume from on_hold needs no reason |
| W5 | `PATCH ... {on_hold, expected=active}` (no reason) | **400** | `REASON_REQUIRED` | PASS — required-reason guard works |
| W6 | `GET /v1/jobs/{active}/closeout-gates?target=completed` | 200 | — | PASS — exactly 7 gates |
| W7 | `GET ...?target=lead` | 200 | — | PASS (flag — see below) |
| W8 | `GET /v1/companies/{id}/closeout-settings` | 200 | — | PASS — 14 rows (mit=7, fire=4, recon=3) |
| W9 | `PATCH .../closeout-settings/{id} {gate_level:hard_block}` | 200 | — | PASS — flips state cleanly |
| W10 | `POST .../closeout-settings/reset?job_type=mitigation` | 200 | — | PASS — `{reset:true, job_type:"mitigation"}` |
| W11 | Tenant isolation: foreign company_id | **403** | `FORBIDDEN` | PASS |
| W12 | `GET /v1/jobs/{id}` after W1 | 200 | — | PASS — status reflects W1 mutation |
| AUTH-401 | unauthenticated request | **401** | `AUTH_MISSING_TOKEN` | PASS |
| SCHEMA-422 | malformed body (missing `status`) | **422** | (FastAPI default) | PASS |

**Flags (non-blocking):**
- **W7**: `target=lead` returns 200 with empty `gates` array. Could mask client bugs (e.g., a client passing wrong target gets no error). Recommend tightening to 400 `INVALID_TARGET_STATUS` for any target other than `completed`. Filed as future polish — not a 01K shipping blocker.
- **W8**: Row count is 14 per company (mit=7, fire=4, recon=3, remodel=0), not the prompt's "~21". This matches `SPEC_DEFAULT_GATES` exactly — different job_types have different applicable gates by design (`all_equipment_pulled` only applies to mitigation, etc.). Prompt's expected was off by ~7.

---

## Track 2 — DB (13/13 PASS after D9 fix)

| # | Check | Verdict | Evidence |
|---|---|---|---|
| D1 | Alembic at head | PASS | `01k_a2_lock_rpc_search_path (head)` |
| D2 | 17 lifecycle columns on `jobs` | PASS | All present + correct types (TIMESTAMPTZ / TEXT / DATE / INT) |
| D3 | `closeout_settings` table shape | PASS | 7 cols + FK to companies CASCADE |
| D4 | Seed row count | PASS | **1988** rows (14 per × 142 companies = 1988 exactly) |
| D5 | Index naming | PASS | `idx_jobs_company_status` + `idx_jobs_status` coexist (no collision) |
| D6 | `jobs_status_check` constraint | PASS | All 9 lifecycle values allowed |
| D7 | `rpc_update_job_status` registered | PASS | |
| D8 | `rpc_seed_closeout_settings` registered | PASS | |
| **D9** | **search_path lock on RPCs** | **FAIL→PASS** | **Initial fail: both proconfig=NULL. Fixed via `01k_a2_lock_rpc_search_path`. Re-verified: both now show `search_path=pg_catalog,public`.** |
| D10 | RPC atomic on optimistic-lock miss | PASS | Stale `expected_current_status` → returns NULL, status unchanged, zero event_history rows |
| D11 | Per-company seed coverage matches `SPEC_DEFAULT_GATES` | PASS | 142 companies × (mit=7, recon=3, fire=4, remodel=0) — deterministic |
| D12 | Lifecycle timestamps on 10 seeded jobs | PASS | paid has 4 timestamps; disputed has full chain; lead/lost have none |
| D13 | RLS tenant isolation | PASS | l@test.com auth client sees own 14 rows, 0 of other company; service-role bypasses correctly |

---

## Track 3 — Logs (7/7 PASS)

| # | Check | Verdict | Evidence |
|---|---|---|---|
| L1 | `status_changed` event_type written | PASS | `lead → active` produced row with `event_type='status_changed'` |
| L2 | `event_data` keys are `to_status` / `from_status` (not legacy `new_status`) | PASS | Verified row: `{"to_status":"active","from_status":"lead"}` |
| L3 | Override flow adds `override_gates` + `override_reason` keys | PASS | `active → completed` w/ override produced `{...,"override_gates":["contract_signed"],"override_reason":"customer requested early completion"}` |
| L4 | Frontend reads new keys (not pre-fix `.new_status`) | PASS | `web/src/app/(protected)/jobs/[id]/page.tsx:222-235` reads `evt.event_data.to_status` and `.from_status`; comment cites Spec 01K |
| L5 | `dispute_opened` / `job_lost` / `job_cancelled` / `job_reopened` event types fire on right transitions | PASS | `lifecycle.event_type_for_transition()` + service.py 992-997 verified. **Re-tested `completed → active` 3× cleanly (HTTP 200 + status flip + `job_reopened` row written). Logs agent's initial 409 report was a false positive from a stale-state retry — bug NOT reproducible.** |
| L6 | No PII / secret leakage in `event_data` | PASS | Scanned last 20 rows for jwt/password/secret/token/credential/api_key/bearer patterns — clean |
| L7 | Timestamps within seconds of trigger | PASS | All test rows show created_at within ~1s of curl issuance |

---

## Track 4 — Cross-Layer (12/12 PASS)

Static contract comparison between frontend + backend constants.

| # | Check | Verdict |
|---|---|---|
| X1 | `STATUS_TRANSITIONS` matrix (FE ↔ BE) | PASS |
| X2 | `REASON_REQUIRED_STATUSES` set (FE ↔ BE) | PASS |
| X3 | `JOB_STATUSES` tuple (FE ↔ BE) — 9 statuses, canonical order | PASS |
| X4 | `STATUS_COLORS` keys cover every status | PASS |
| X5 | Closeout `item_key` keys (FE ↔ BE evaluators + labels) | PASS |
| X6 | `JOB_TYPE_COLUMNS` vs `SPEC_DEFAULT_GATES` | PASS (marginal — see flag) |
| X7 | `SPEC_DEFAULT_GATES` (service.py) vs migration seed | PASS |
| X8 | `update_status` validation gates through lifecycle matrix only | PASS |
| X9 | Frontend mutation body fields vs `StatusUpdateBody` schema | PASS |
| X10 | `gate.detail` rendered verbatim | PASS |
| X11 | Disputed pin colors match Option A tokens | PASS (marginal — see flag) |
| X12 | `STATUS_META.bg` vs `--status-*-bg` CSS tokens | PASS |

**Marginal flags (no bug, but desync hazards):**
- **X6**: backend `SPEC_DEFAULT_GATES` includes a `"remodel"` key with empty list; frontend has no remodel column. If anyone populates remodel gates server-side, they'd be invisible to the admin. Add a comment in `JOB_TYPE_COLUMNS`.
- **X11**: `dashboard-map.tsx` uses hardcoded hex for the disputed pin because Google Maps `SymbolPath` doesn't consume CSS vars. Values match `--status-disputed` / `--status-active` today; future palette changes to `globals.css` would silently desync. Mitigated by colocated comment naming the tokens, not eliminated.

---

## Fix landed during validation

**`fix(01k): lock search_path on lifecycle + closeout-seed RPCs`** (commit `275fcd2`)

New migration `backend/alembic/versions/01k_a2_lock_rpc_search_path.py` runs:
```sql
ALTER FUNCTION rpc_update_job_status(...) SET search_path = pg_catalog, public;
ALTER FUNCTION rpc_seed_closeout_settings(...) SET search_path = pg_catalog, public;
```

Uses ALTER FUNCTION rather than CREATE OR REPLACE — no need to re-emit the 80+ line plpgsql bodies. Verified via `pg_proc.proconfig`: both RPCs now show `search_path=pg_catalog,public`. Aligns with the codebase's established convention (`rpc_create_jobs_batch`, `rpc_onboard_user`).

---

## Test data state (post-validation)

All 10 seed jobs restored to canonical statuses for "lmtest pro" company:

```
lead       43df71a2  100 Main St
active     205f2fcc  200 Oak Ave
active     9d865418  300 Pine Rd
on_hold    8479b004  400 Birch Ln
completed  6f03d632  500 Elm Blvd
invoiced   36e49b59  600 Cedar Ct
disputed   f6c6736e  700 Maple Way
paid       4c4eea66  800 Walnut Pl
lost       8a9f6f28  900 Spruce Dr
cancelled  85c7d77d  1000 Aspen Trail
```

Test event_history rows from validation runs cleaned up.

---

## Verdict: SHIP

- API: clean across all 14 workflows (functional + auth + tenant + schema)
- DB: clean after the search_path fix; 142 companies × 14 settings rows × 9 statuses all coherent
- Logs: clean; event_history shape matches spec; frontend timeline reads correct keys
- Cross-layer: zero contract drift between frontend and backend; no bugs to fix

Two minor follow-ups filed (W7 should 400 on invalid target; FE missing remodel column — add comment) but neither blocks shipping. Ready for `/ship` to PR + merge.

## Files referenced
- `/tmp/fv-api-results.json` — API track raw results
- `/tmp/fv-db-results.json` — DB track raw results
- `/tmp/fv-logs-results.json` — Logs track raw results
- `/tmp/fv-crossval-results.json` — Cross-val raw results
- `backend/alembic/versions/01k_a2_lock_rpc_search_path.py` — D9 fix migration
