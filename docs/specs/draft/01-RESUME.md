# Customer–Property Foundation — Resume Snapshot

**Use this file to pick up the rollout in a fresh session.**

## TL;DR for next-session Claude

You're picking up the **Customer-Property Foundation rollout** mid-flight. All specs, eng reviews, design handoff, and the unified implementation plan are complete and committed. **Implementation has not started.** The user wants you to execute the plan via subagent-driven development with review checkpoints.

## What's been decided (all locked, in committed specs)

- **Scope:** 4 Linear issues in `[V1][01] Property Data Model` project shipping as one rollout:
  - **CREW-11** — Customer entity + property/job FK wiring (data model + CRUD foundation)
  - **CREW-13** — Customer + Property pickers (autocomplete via existing Google Places integration, NOT Smarty)
  - **CREW-59** — Property detail page + Customer detail page (symmetric, with property notes column)
  - **CREW-60** — Reconstruction `COPY_FIELDS` update (the "Convert to Reconstruction" feature is already shipped via 01B; CREW-60 just patches `COPY_FIELDS` to remove dropped columns and add new ones)

- **Architecture:**
  - New `customers` table (company-scoped, phone-as-unique-key per company, partial unique index)
  - `properties.customer_id` (default-owner pointer, nullable, ON DELETE SET NULL)
  - `jobs.customer_id` (required, ON DELETE RESTRICT)
  - Drop `jobs.customer_*` and `jobs.address_*` columns (manual cleanup pre-deploy — see below)
  - `properties.notes` (single plain-text column, bleach-sanitized — NO encryption in V1)
  - `properties.last_activity_at` denormalized column with trigger (avoid N+1 sorting)
  - All address canonicalization client-side via existing `<AddressAutocomplete>` (Google Places)

- **Migration safety:** NO `TRUNCATE` in the committed migration SQL. The Python `upgrade()` opens with a row-count guard that raises if `jobs` has any non-soft-deleted rows. Operator manually clears `jobs` (`DELETE FROM jobs;` in Supabase SQL Editor) before each deploy.

## Source-of-truth files (read these in order)

| Order | File | What it contains |
|---|---|---|
| 1 | `docs/specs/draft/01-foundation-impl-plan.md` | **The master plan.** 13 phases, ~70 TDD-style tasks. Step-by-step code + commands. Start here. |
| 2 | `docs/specs/draft/01J-customer-property-model.md` | Data-model spec — schema, RLS, decisions, tests |
| 3 | `docs/specs/draft/01K-address-autocomplete-canonicalization.md` | Pickers + match endpoints spec |
| 4 | `docs/specs/draft/01L-detail-pages.md` | Property + Customer detail pages spec |
| 5 | `docs/specs/draft/01M-reconstruction-copy-fields.md` | Tiny CREW-60 spec — just the COPY_FIELDS diff |
| 6 | `docs/design/customer-property-pickers/README.md` | Design prototype reference — every picker state mocked in HTML/JSX. **Open `Customer + Property Pickers.html` in a browser to see the visual target.** |
| 7 | `CLAUDE.md` and `backend/CLAUDE.md` | Project conventions, code style, commit rules |

## Pre-flight (verified before starting)

| Check | Status |
|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set in `web/.env.local` | ✅ Verified |
| Backend deps to add: `phonenumbers`, `bleach` (NO `cryptography` — encryption dropped) | ⏳ Phase 0 |
| No Fernet env var needed | ✅ Encryption dropped |
| Branch `lm-dev` up to date | ✅ Last commit `9cc9dd5` |

## How to execute

**Use subagent-driven-development.** For each task in the impl plan:

1. Spawn a fresh subagent (general-purpose or backend-engineer/frontend-engineer when applicable) with the task's full instructions copied verbatim
2. Subagent writes code + tests, runs the verification command, commits
3. Parent (you) reviews the diff in current context — verify it actually did what the plan said
4. Move to next task

**Pause for Lakshman's review at these phase boundaries:**

| After phase | What he'll check |
|---|---|
| Phase 1 (migration) | Schema correct on dev DB |
| Phase 4 (customers CRUD) | `/v1/customers` endpoints work |
| Phase 8 (jobs refactor) | Existing reconstruction creation still works |
| Phase 11 (frontend pickers) | New-job form pickers render correctly |
| Phase 12 (detail pages) | `/properties/[id]` and `/customers/[id]` work |
| Phase 13 (verification) | Final smoke test |

After each pause: he says "continue" or specifies fixes. Don't proceed without explicit OK.

## Decisions log (key items)

These are settled — DON'T re-relitigate unless he explicitly asks:

- **Pickers use existing Google Places integration**, not Smarty Streets. `web/src/components/address-autocomplete.tsx` already exists and handles canonicalization client-side.
- **Property notes** = single plain-text column, NOT three (`gate_code`/`key_location`/`access_notes`), NOT encrypted. Bleach sanitization stays.
- **No `parent_job_id`** column — 01B's existing `linked_job_id` already serves the same purpose. CREW-60 is just the COPY_FIELDS update.
- **No "Convert to Reconstruction" button** in this rollout — current new-job form's "Link to Mitigation Job" dropdown already covers it.
- **Reconstruction idempotency unique index** deferred to optional follow-up.
- **No `TRUNCATE`** in migration SQL — manual operator cleanup + Python row-count guard.
- **Customer match `customer` projection** is `{id, display_name}` only — no phone/email/notes (mirrors 01J Decision #19/#20).
- **Cross-company FK validation** is app-layer (authenticated client pre-fetch + 404), not RLS — Postgres FKs bypass RLS.
- **Pydantic `extra="forbid"`** on every body schema — mass-assignment guard.

## Linear status

All 4 issues in `[V1][01] Property Data Model` project:
- CREW-11 — Backlog, Urgent, MVP — assigned to Lakshman
- CREW-13 — Backlog, Urgent, MVP — assigned to Lakshman
- CREW-59 — Backlog, High, MVP — assigned to Lakshman
- CREW-60 — Backlog, High, MVP — assigned to Lakshman

All have detailed tech-spec comments referencing the source files in `docs/specs/draft/`.

## How to start (the literal first action)

Read `docs/specs/draft/01-foundation-impl-plan.md` from top, then begin **Phase 0, Task 0.1** (add `phonenumbers` and `bleach` to `backend/pyproject.toml`).

Don't write a new plan, don't re-spec, don't re-review. The plan IS the spec for execution.

---

## Resume prompt (paste this into a fresh session)

```
Resume the Customer–Property Foundation rollout. Read docs/specs/draft/01-RESUME.md
first for full context. All specs, eng reviews, design bundle, and the unified impl
plan are committed on lm-dev (last commit 9cc9dd5).

Then begin Phase 0 of docs/specs/draft/01-foundation-impl-plan.md via
subagent-driven-development. Pause for my review at the phase boundaries listed in
the resume file.

Auto mode active — execute autonomously, minimize interruptions.
```
