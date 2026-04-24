# PR Review Lessons — Spec 01H

Living record of every pattern that cost us a review round on PR #10. One file, meant to stay.

Authoritative home for:
- meta-patterns extracted from reviewer feedback
- pre-PR grep checklist (runnable before every push)
- per-round scoreboard + honesty ledger
- start-of-task invariants brief (pre-implementation discipline)

> Note: an earlier copy of this file was scoped as "local working notes" and got wiped in a parallel cleanup. Treat this as permanent — commit changes like any other doc.

---

## Start-of-task invariants brief (pre-implementation)

Before writing code for any new feature, endpoint, or spec, produce a short **invariants brief** and get Samhith's approval. This catches the class of bug that survives casual "does it work?" testing — invariants that must hold across sibling sites, not just the one the feature names.

This discipline was added 2026-04-23 after the Phase 2 PR review caught 2 CRITICAL + 3 HIGH findings, all of which were invariant-scope sibling-misses of rules already documented here. **The fix isn't better review — it's deriving the rules up front, once.**

### What the brief contains

Three short lists, ~10 lines total:

1. **Rules that apply to this task.** Scan this doc's meta-patterns (§"The meta-patterns that bit us") plus the numbered lessons (§1–§15 and onward). Examples of rules that might apply:
   - archive guard (lesson R6 / §1) — every write on job-scoped data must call `raise_if_archived` / `ensure_job_mutable`
   - cross-job binding (§4) — URL `job_id` must match data's `job_id` via explicit check, not RLS alone
   - name-match safety (§2/§5) — any lookup that falls back to `room_name === name` must go through `canvas-room-resolver` or be grep-banned
   - atomic multi-write (§4) — sequential `.insert` calls that must succeed together belong in one plpgsql RPC, not Python-layer composition
   - calendar-day vs instant (§15) — `DATE` columns use local wall clock; `TIMESTAMPTZ` uses UTC. Consolidate helpers in `web/src/lib/dates.ts`.
   - URL shape matches operation shape — if the URL says "job A's pin," the service must verify it

2. **Sibling-site grep checklist — run after implementation.** Copy the exact commands so the invariant is grep-pinned. Examples:
   ```bash
   grep -rn "ensure_job_mutable" backend/api/<new-module>/
   grep -rn "propertyRooms.*find" web/src/components/sketch/
   grep -rn "toISOString().slice(0,\s*10)" web/src/
   ```

3. **Pin-the-invariant tests.** Which tests will fail on regression of the rule (not just the happy path)? Archive-guard per endpoint, cross-job rejection, polygon boundary, RPC atomic rollback — one each, scripted fake-client style, no live Supabase needed.

### Why this works

Reviewer findings in Round 1 + Round 2 of Phase 2 all shared one shape: a rule was applied at the code-location the feature named, and missed at one or more sibling locations that used the same pattern. Post-hoc `/critical-review` catches them, but each finding costs a review round. Deriving the rules before writing code — then grep-verifying them after — closes the gap without extra review rounds.

This brief lives WHERE `/critical-review` already reads from, so the skill inherits it automatically in future verification passes.

---

## The meta-patterns that bit us (rounds 1-3)

### 1. Claim-vs-fix gap
A reviewer item says "fixed X" in the PR body. The grep for the bug pattern still finds it at other call sites. Round-1 C3 fixed ONE TOCTOU; R4 found two more of the same shape in `update_floor_plan` and `cleanup_floor_plan`. Round-1 C1 added `ensure_job_mutable` to walls and rooms; R6 found three by-job FP endpoints still missing the guard.

**Discipline for the next PR:**
- For every fix with a name (C1, W1, R5, ...), grep the codebase for every occurrence of the bug SHAPE, not just the one the reviewer pointed at.
- If the fix adds a helper, grep every call site that SHOULD use it. Missed wire-ups become round 2.
- List every call site you considered in the PR description — invisible coverage isn't coverage.

### 2. Silent-skip / silent-coerce
Defensive code that swallows unexpected cases without logging.
- `_enrich_canvas_with_relational_snapshot` silently coerced non-dict → `{"rooms": []}` → F4 raises `INVALID_CANVAS_DATA` now.
- `restore_floor_plan_relational_snapshot` silently `CONTINUE`d on rooms failing the tenant check → F3 accumulates `skipped_rooms` and logs a warning.
- `list_rooms` returned `reading_count=0` when the table was missing — `XXX TEMP` in code was literally the bug's self-indictment.

**Rule:** if a code path handles an unexpected case, either raise or log. Never swallow to a default and proceed.

### 3. Sibling-miss within your own PR
A reviewer flags pattern X. You fix it at location A. Your fix introduces the same pattern X at location B. The critical review of my R19 work found exactly this: `_compute_wall_sf_for_room` accepted caller-supplied `p_company_id` — the anti-pattern R3 had JUST closed one migration earlier on `save_floor_plan_version`.

**Rule:** every time you write a new SECURITY DEFINER RPC, grep every other SECURITY DEFINER RPC in the repo and confirm shape parity (`get_my_company_id()` not `p_company_id`, pinned `search_path`, tenant-derived-from-JWT-not-params).

### 4. Atomic → non-atomic composition regression
C4 gave us an atomic `save_floor_plan_version` RPC. R19 added a separate `restore_floor_plan_relational_snapshot` RPC. My `rollback_version` called BOTH back-to-back at the Python layer — if the second raised, the first's state persisted. **Atomicity doesn't compose across network boundaries.**

**Rule:** if two RPCs must succeed-or-fail together, they belong in one plpgsql function, not two. The enclosing Python code does not create a transaction.

### 5. SQLSTATE collisions
R3's tenant mismatch raised 42501. R4's frozen-row trigger ALSO raised 42501. Python catches couldn't tell them apart — VERSION_FROZEN leaked out as DB_ERROR 500. Follow-on moved the trigger to 55006.

**Rule:** every new `RAISE EXCEPTION USING ERRCODE` should pick a SQLSTATE distinct from every other path that shares a Python catch block. Class 23 (integrity_constraint_violation), class 42 (access rule), class 55 (invalid_prerequisite_state), class 22 (data_exception), class P0 (plpgsql custom) are the usual slots.

### 6. Cache-invariant fragility when hooks don't own it
R15b: `useSaveCanvas` had no `jobId`, so it couldn't invalidate `["floor-plans", jobId]` internally. Every caller invalidated manually in `onSuccess`. W11 "worked" only because every current caller did it right. Next consumer would forget.

**Rule:** cache invariants belong on the hook, not the caller. If the hook can't invalidate all relevant keys because it doesn't have the args, add the args.

### 7. UX silent-reject is a bug, not a feature
Pre-R17-UX numeric inputs all had this shape:
```tsx
onChange={(e) => {
  const v = parseFloat(e.target.value);
  if (!isNaN(v) && v > 0) onChange(v);  // silently drop -10
}}
```
User types `-10`, nothing happens. No error message, no red border. **Either reject loudly or accept — never silently drop.**

### 8. "Legacy accommodation" is how bypass bugs re-enter
The original W1 had `if job_property_id is None: return  # legacy accommodation`. R8 pointed out this re-created the bypass across 3 sites once the shared helper inherited the skip.

**Rule:** if you find yourself writing "legacy accommodation" or "backward-compat skip," ask: is this path actually hit by current code? If no → raise instead of skip. If yes → fix the upstream data, then raise.

### 9. Error-branch blindness (round 3)
Fixed the same bug SHAPE at 2 save-call sites; missed the 3rd because it lived inside a `catch (err)` error-recovery branch, not on the happy path. I was scanning "save call sites" by user intent (autosave / cross-floor / first-create). The 409 recovery branch is semantically a save too.

**Rule:** when you fix a save-path bug, grep for the bug SHAPE, not just "happy-path save calls":
```bash
grep -nE 'apiPost.*floor-plans.*versions' web/src
```
Verify every single hit got the fix — no exceptions for "it's only the error path."

### 10. Downgrade asymmetry
Added a migration that changed an RPC's signature (2-arg → 1-arg) AND updated every caller to the new signature. Wrote the downgrade to restore the RPC's signature but forgot to restore the callers' call shape. After `alembic downgrade -1` the RPC exists with the old signature; callers still use the new shape; runtime crashes.

**Rule:** every `CREATE OR REPLACE FUNCTION` in UPGRADE_SQL needs a symmetric `CREATE OR REPLACE FUNCTION` in DOWNGRADE_SQL for BOTH (a) the function whose signature changed, AND (b) every function that CALLS it that also got rewritten.

### 11. Secondary-source drift
Kept a local-dev install script (`pr10_round2_apply.sql`) alongside the alembic chain. Drifted twice as new migrations landed. Dev following the script hit a broken DB.

**Rule:** never maintain two sources of truth manually. Either delete the secondary (alembic is truth; `alembic upgrade head` if dev is behind), or autogenerate the secondary via CI with a drift-check.

### 12. Test-tool mismatch
Wrote a text-regex migration test to catch the R1 typo — the right tool for literal-string bugs. But the R4 trigger's SQLSTATE behavior (55006 vs 42501 disambiguation, legitimate flip passing through) is a RUNTIME contract. Text-only test gave false confidence.

**Rule:** pick the test tool that matches the failure mode.
- Literal-string / syntactic bugs → text scan.
- Error-code mapping, SQL semantics, transaction boundaries → integration test against a live Postgres.
- Type / shape of API response → unit test with mock DB.

### 13. "My own lessons doc" warned me
The lessons file I wrote between round-2 and round-3 flagged patterns #1 and #3 as specific risks. I wrote the warning and then hit exactly those patterns on re-review. Rules on a page don't execute; a grep does.

**Rule:** the lessons doc is not a shield. Before "ready for review," run the pre-PR grep checklist — actual shell commands, actual output.

### 14. Wire-format normalization for conditional writes
Etag compare initially used raw string equality; the docstring claimed "normalizes via datetime parse" but the code didn't. Would have caused spurious 412s on microsecond drift (`"+00:00"` vs `".000000+00:00"` for the same instant).

**Rule:** for any value that round-trips between systems as a string, write the comparison at the SEMANTIC layer, not the BYTE layer. Parse both sides to the value-space, compare there. Fall back to string equality only on parse failure. Applies to timestamps, decimals, UUIDs.

---

## Round 4 — Lakshman's ETag review (2026-04-22)

### Why we kept finding things after 4 rounds

Honest answer, two pathologies.

**Pathology 1 — fix scope.** We fix at code-location scope, not invariant scope. Each PR closes the bug NAMED by the reviewer. The invariant-scoped siblings resurface next round because the invariants themselves were never written down, never grep-able, never test-pinnable. Lakshman has been literally telling us this since round 2 (patterns #1 and #3 above). We iterated through the same meta-mistake.

**Pathology 2 — design-level TOCTOU.** The etag system is "check in Python, write elsewhere (RPC / UPDATE)." That pattern IS the TOCTOU we claim to be fixing. We kept adding atomic filters at individual write sites (cleanup, update, save_canvas Case 2) but `save_floor_plan_version` RPC was never reached by the pattern. We're patching instances while the pattern that generates them is still in place.

### 15. Declaring a contract ≠ enforcing a contract end-to-end
Etag ships across 3 layers: (a) client sends If-Match, (b) Python validates, (c) SQL atomically enforces. Got (a) and (b). (c) is half-done — Case 2 has `.eq("updated_at", …)`, Case 3's RPC doesn't.

**Rule:** when adding a cross-cutting contract, list every layer it must be enforced at, and check every write path at each layer. One missing layer = the whole contract is advisory.

### 16. "Optional header" is a default-allow
Backend `if if_match is not None:` means missing header = no concurrency check. We picked this for "backward compat during rollout," but the safer pattern is: require it, return 428 `ETAG_REQUIRED`, allow explicit `If-Match: *` for creation flows (standard HTTP semantics).

**Rule:** for any new guard, explicitly name the missing-input default. "Not set = skip" is usually wrong for security/correctness. "Not set = reject with a specific code" is usually right.

### 17. New error paths need end-to-end UX, not just a banner
412 VERSION_STALE shows a banner saying "reload to re-apply your edits," then `window.location.reload()` nukes Konva state. Nothing to re-apply from. Banner is lying to the user.

**Rule:** for every new error state, write down what the user loses if it fires. If "nothing," fine. If "in-flight work," persist it before the reload and surface a restore path on the next load.

### 18. "Two users racing" includes "one user, two in-flight requests"
Self-412 on overlapping autosaves when POST latency > 2s debounce. Same user, same tab, back-to-back autosaves with the same cached etag. We framed etag as cross-user protection and forgot the same-user pipeline.

**Rule:** when analyzing concurrency, list the writer set explicitly. "Same-tab save_n vs same-tab save_n+1" is a valid pair. "Writer-A (mobile) vs Writer-A (web)" too.

### 19. Local fix ≠ invariant fix
Lakshman keeps flagging siblings because we fix at code-location scope. The invariant — "every etag-aware write path has atomic DB-level enforcement" — doesn't get named, grep-checked, test-pinned.

**Rule:** after a reviewer names a bug, extract the one-sentence invariant it violates, grep the codebase for other violations of the SAME invariant (not just the same code shape — same invariant), and list every site you checked in the PR description.

### 20. Rationales accepted for path A don't automatically license path B
Lakshman accepted "rollback's etag check is fast-reject-only because no data loss" as P3. We mentally extended that rationale to `save_canvas` Case 3, because "same shape." Lakshman marked Case 3 as P1 — same rationale, but save_canvas is the high-frequency autosave path. Frequency × violation-severity matters; we only measured severity.

**Rule:** when citing a rationale accepted for path A to defend path B, explicitly compare traffic / blast radius. If they differ, the rationale may not transfer.

### 21. Type-level tri-state permits runtime tri-state
`etag?: string | null` lets the next consumer reach for `?? undefined` or `!etag` and silently drop to no-etag (which per #16 means no guard). Looseness in the type encodes looseness in the expected behavior.

**Rule:** tri-state types at contract boundaries are a smell. Collapse to `T | undefined`, or wrap in a `hasEtag()` type guard that forces explicit handling at the call site.

### The actual fix for the meta-mistake

Before writing code for a cross-cutting feature like etag, write an **invariant list** up front. For etag it would have been:

- **INV-1.** Every mutating request carries an etag, or an explicit "no etag" marker (`If-Match: *` for creation).
- **INV-2.** Every write path enforces the etag atomically at the SQL layer (not Python).
- **INV-3.** Every error path preserves in-flight work before triggering navigation / reload.
- **INV-4.** At most one in-flight write per target at any moment.

Then every write path is checked against all four invariants. Every reviewer comment is traced back to which invariant it violates (not which file). When the invariant is stated, the siblings are grep-able.

---

## Round 5 — Spec 01H Phase 2 (2026-04-23)

### 22. Calendar-day vs instant — pick the right clock
`moisture_pin_readings.reading_date` is a PostgreSQL `DATE` column (no TZ). Two places on the frontend wrote "today" with `new Date().toISOString().slice(0, 10)` — UTC. The display helper parsed it back with local date components. At 8 PM US Pacific, a Tuesday reading got written as Wednesday, rendered as Wednesday, and the next morning's real Wednesday log silently upserted-over the 8 PM entry via `UNIQUE(pin_id, reading_date)`.

**Rule:** anything written to a `DATE` column, or compared as "is this today?", uses the wall clock (local date components). Anything written to a `TIMESTAMPTZ` column uses UTC (`toISOString()`). The two are not interchangeable. Consolidate both helpers in one module (`web/src/lib/dates.ts`) so future consumers inherit the decision instead of re-deriving it.

**Grep before adding dates to a new flow:**
```bash
grep -rn "toISOString().slice(0,\s*10)" web/src/   # UTC day-string — almost always wrong for DATE columns
grep -rn "new Date(.*-.*-.*)" web/src/             # UTC-midnight trap on DATE strings
```

### 23. Scripted fake clients don't validate wire format
Two bugs this round hit production (well, a user session) because they were shaped as Python-valid but PostgREST-invalid, and our fake-client fixtures only exercise the Python side:

- **Embedded-order syntax** — `.select("*, readings:moisture_pin_readings(*, order(reading_date.desc))")` parses fine in the fake client (which returns canned rows regardless of the select string) but PostgREST rejects it as `PGRST100` — that slot is reserved for aggregate functions (`sum`, `avg`, `count`, `max`, `min`). The correct idiom is `.order("reading_date", desc=True, foreign_table="readings")` — a separate call after `.select()`.
- **RPC schema-cache drift** — the backend called `save_floor_plan_version` with 9 params after a migration added `p_expected_updated_at`. The DB had the 9-arg function installed; PostgREST's internal function-signature cache had the old 8-arg one. Fake clients don't involve PostgREST at all, so unit tests passed; the real endpoint 500'd with "could not find the function … in the schema cache."

Both classes share a shape: the fake client tests that Python can construct the request; it does NOT test that PostgREST will accept it.

**Rule:** for every PostgREST query builder chain that uses non-trivial features (embedded order, foreign-table filters, RPC with renamed/added params), add one smoke-test path that hits the real dev DB or schedule a manual smoke-check step in the PR workflow. Unit tests over a scripted fake client are necessary but not sufficient for query-string correctness.

**Recovery moves when this fires in dev:**
- PostgREST schema cache miss: `psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema';"` — forces a reload without restarting Supabase.
- Verify RPC signature in DB: `SELECT proname, pronargs, pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = '<name>';` — confirms the DB has what the client expects before chasing the caller.

**Grep before shipping a new PostgREST query:**
```bash
grep -rn "order(.*)" backend/api/*/service.py          # inline order() inside select is wrong — must be foreign_table=
grep -rn "\.rpc(" backend/api/                         # every RPC call, cross-check against latest migration's RETURNS
```

### 24. FastAPI `response_model` silently drops undeclared fields
Added `readings` + `floor_plan_id` to the `list_pins_by_job` service-layer dict. The service-layer log proved both were in the returned value. The browser still saw the pre-change shape — no error, no warning, just missing keys. Two hours of chasing "uvicorn isn't running my code" before spotting it.

Cause: the endpoint is declared `@router.get(..., response_model=MoisturePinListResponse)`. FastAPI pipes the return value through `MoisturePinListResponse.model_validate(...)` before serializing. Pydantic's default behavior on output validation is to **silently strip any field not declared on the model**. Since `MoisturePinResponse` didn't declare `readings` or `floor_plan_id`, both evaporated between the service log and the HTTP wire.

**Rule:** every field you attach to a service return dict must be declared on the corresponding FastAPI `response_model` Pydantic schema. Service-layer log shape ≠ HTTP response shape; the `response_model` is the gate in between. This is the response-side sibling of lesson #23 — fake-client tests over service functions will pass even when the HTTP response is wrong, because they bypass FastAPI's serialization layer.

**Grep before adding a new field to a service return dict:**
```bash
# For every endpoint that returns this dict, find its response_model
# and add the field there too. Otherwise the backend log lies about
# what the browser sees.
grep -rn "response_model=" backend/api/<module>/router.py
# Then open each referenced schema and make sure the new field exists.
```

Diagnostic for "backend log shows the field but browser doesn't":
1. `curl` the endpoint directly — if field is missing, FastAPI is stripping it (schema problem), not the browser cache
2. `curl` the same query against Supabase PostgREST directly — if field is present there, the strip is in FastAPI not the DB layer
3. Check `response_model=...` on the endpoint, then check the schema — add the field

### 25. Denormalized truth in one consumer masks a missing FK everywhere else
`handleCreateRoom` on the floor-plan page called `POST /v1/jobs/:id/rooms` WITHOUT `floor_plan_id`. Every room created via the canvas got `job_rooms.floor_plan_id = NULL`. The floor-plan editor worked fine — it hydrates rooms from `floor_plans.canvas_data` (JSONB). The moisture-report view, sharing payload, per-floor pin filters, room-level photo counts — every RELATIONAL consumer saw orphaned rooms + cross-floor pin leaks. The bug predated Phase 2 but was invisible until a new consumer relied on the FK.

**Rule:** when introducing an FK column, every CREATE path must populate it. "Did the editor render OK?" is not the same as "did the data land correctly." If a column has multiple read consumers and one is a denormalized copy (like canvas_data JSONB), confirm the relational column is populated too.

**Grep before shipping a new FK column:**
```bash
# Every table insert path should mention every NOT NULL / FK column.
grep -rn "INSERT INTO job_rooms\|insert.*job_rooms" backend/
grep -rn "apiPost.*'/v1/jobs/[^']*/rooms'\|useCreateRoom" web/src/
# Then cross-check each call passes every FK column the schema declares.
```

**Detection after the fact:**
```sql
-- Any job_rooms row without a floor_plan_id is a latent cross-consumer bug.
SELECT COUNT(*) FROM job_rooms WHERE floor_plan_id IS NULL;
```

Also instructive: the floor-plan editor's JSONB-first design (read rooms from `canvas_data`, not from the relational table) is exactly why this bug hid. When a denormalized store works independently of the normalized store, the two WILL drift — usually silently.

---

### 26. Sibling-miss in the SAME function (narrow form of #3)
Lesson #3 covers PR-wide sibling-miss across files. This is the narrower repeat-prone version: **when you change a pattern in a function, grep the entire function (not just the named block) for siblings.**

**Real example.** Round 1 of the Phase 2 critical review flagged H2: two new `except Exception: pass` blocks in `sharing/service.py`'s `get_shared_job` (one for `moisture_pins`, one for `floor_plans`). Both narrowed correctly to `except APIError` + tolerated PGRST codes + log + re-raise. **A third block — the pre-existing `line_items` query — sat three lines below, still `except Exception: pass`.** Round 2 caught it as a HIGH sibling-miss. Same function, same anti-pattern, same fix shape — missed because the round-1 task was scoped to the named blocks, not "all blocks of this shape in this function."

**Rule:** before committing a fix that narrows / restructures error handling on a block, grep the *file or function* for the same pattern and either:
1. Fix every sibling occurrence in the same commit, OR
2. Explicitly carry forward the sibling case in the PR description ("known follow-up: line N has the same shape, deferred because X").

Never silently leave a sibling broken — the next reviewer (or the next reader six months later) will assume it was deliberate.

**Grep template (adapt to your fix shape):**
```bash
# After narrowing `except Exception: pass`, find every other instance
# in the same file and decide explicitly per-block.
grep -n "except Exception" path/to/file.py
```

This is also why "check the whole file" beats "check the immediate context" as a default reading habit. Three lines below your edit is still the same function.

---

### 27. Helpers with `.some()` / `.every()` need an explicit mixed-case branch
A boolean gate driving a fallback (`anyHas = arr.some(predicate)` → branch on true/false) silently collapses three real states into two: **all match, none match, mixed.** The "mixed" state usually drops the items that don't match — the bug is invisible on small fixtures and only surfaces on legacy or partially-migrated data.

**Real example.** `buildMoistureReportProps` had:
```ts
const anyPinHasFloorId = pins.some((p) => !!p.floor_plan_id);
const floors = floorPlans.map((fp) => ({
  ...
  pins: anyPinHasFloorId
    ? pins.filter((p) => p.floor_plan_id === fp.id)   // strict
    : fp.id === resolvedPrimaryId ? [...pins] : [],   // crammed
}));
```
For a multi-floor job where SOME pins had `floor_plan_id` (post-backfill resolved rows) and SOME didn't (multi-floor-ambiguous rows the migration intentionally left NULL), the `anyPinHasFloorId === true` branch ran and filter-mismatched pins silently disappeared from the report. The unit tests passed because every fixture was uniform — all pins had IDs OR all pins didn't.

**Rule:** any time you write `arr.some(...)` or `arr.every(...)` to drive a fallback, write the truth table **on paper or in a comment** before coding the branches:

| Case | What's true | What this branch does |
|---|---|---|
| All match | every item | strict path |
| None match | no item | full fallback |
| **Mixed** | some yes / some no | **explicit decision required** |

Pick the third row's behavior deliberately. If the answer is "drop the unmatched silently," a reviewer will catch that and you'll lose a sprint. The honest answers are usually: (a) bucket the unmatched into an `orphan` output, (b) hard-error so the upstream bug surfaces, or (c) merge both with an explicit precedence rule.

**Test pin:** add a fixture with at least one item in each of the three states. The drift bug is invisible without it.

---

### 28. Discriminants should enumerate failure modes BEFORE picking enum values
When you introduce an enum-typed discriminant (`status: "pending" | "ready" | "error"`), the failure mode is usually that the enum collapses two distinguishable cases into one — and the consumer can't tell them apart. The fix is later, costlier, and breaks API back-compat.

**Real example.** Round 1 H3 added `moisture_access: "denied" | "empty" | "present"` to the shared payload so the portal could branch empty-state copy correctly:
- `denied` → "ask the sender for restoration access"
- `empty` → "no readings logged yet"
- `present` → render the report

Round 2 caught a fourth distinguishable cause: `moisture_pins` query raised PGRST205 (table missing — backend misconfigured). The narrowed `except APIError` correctly returned `[]`, the discriminant computed `empty`, the portal told an adjuster "no readings yet — check back in a day." **The real state was "backend broken, ops needs to reload the schema cache."** The wrong copy fired because the enum had no value for "data should exist but the query failed."

Fix: added a fourth state `unavailable`, threaded a `moisture_unavailable` flag from the except block, surfaced "Moisture data temporarily unavailable" in the portal.

**Rule:** when introducing a discriminant, before picking enum values, write down every distinguishable cause from the consumer's perspective:

| Cause | Consumer should... |
|---|---|
| You don't have permission | Ask for a different link |
| Permission is fine, no data exists yet | Wait, check back |
| Permission is fine, data exists but query failed | Retry, alert ops |
| Permission is fine, data is here | Render |

Each row that should produce different UI copy is a separate enum value. If two rows would produce the same copy, they can collapse — but verify that's still true after the next review of the consumer code.

Symmetrically: when reviewing a discriminant someone else added, ask "what other reasons could the empty list have?" If you can name a third cause that gets the same UI as the other two, that's the missing enum value.

---

### 29. Every relational `floor_plan_id` stamp must be re-stamped on fork

Narrower, repeat-prone variant of #25 — specific to the floor-plan versioning
state machine. When `save_floor_plan_version` forks a new row (Case 3, and
also Case 1 on a floor's first save), `jobs.floor_plan_id` is atomically
retargeted to the new version. Every OTHER table that stamps a
`floor_plan_id` for the caller job on the same floor **must also be
retargeted in the same transaction**.

**Why this is repeat-prone.** Phase 1 designed the versioning around two
sources of truth: `jobs.floor_plan_id` (the pin) and `floor_plans.canvas_data`
(the JSONB blob the editor reads). The editor works off canvas_data, so
stale relational stamps are invisible to it. Consumers that filter by
**current-version** `floor_plan_id` (moisture-report UI, Xactimate line-item
aggregation, carrier report attribution appendix) are the ones that surface
the drift. Every phase that adds a new `floor_plan_id`-stamped column
inherits the gap unless the RPC's fork body is updated.

History: Phase 1B added `job_rooms.floor_plan_id` without updating the fork.
Phase 3 Step 2 added `moisture_pins.floor_plan_id` and inherited the same
gap via the backfill. The moisture-report view was the first consumer that
filtered by current-version id, which is where we finally hit it.

**Rule:** any PR that adds a `floor_plan_id` column to a job-scoped
relational table (future candidates: `equipment_placements.floor_plan_id`
expansion, `annotations.floor_plan_id`, any new stamped-location table)
must update `save_floor_plan_version`'s body to include a matching
`UPDATE` in the fork transaction, scoped to `(job_id, property_id,
floor_number)`. The scope is critical: sibling jobs pinned to older
versions keep their own stamps (frozen-version semantics, Phase 1 rule).

**Pre-PR grep when adding a stamped column:**
```bash
# Every stamped FK on a job-scoped table needs a fork-time UPDATE.
grep -rn "ADD COLUMN floor_plan_id" backend/alembic/versions/
# For each hit, confirm save_floor_plan_version updates that table on fork.
grep -n "UPDATE <your_table>" backend/alembic/versions/*save_floor_plan_version*.py
```

**Pin-the-invariant test:** `backend/tests/integration/test_fork_restamp_invariant.py`
introspects the installed RPC body via `pg_get_functiondef(oid)` and
asserts each known stamped table has a matching UPDATE clause. A later
CREATE OR REPLACE that drops any of these UPDATEs trips the test before
the PR ships.

**Cross-spec dependency:** future tables that stamp `floor_plan_id`
(Phase 3 equipment, Phase 5 annotations) must extend that integration test
with their own UPDATE assertion. The test is the one place that enumerates
the full set of tables that must stay in sync on fork.

---

## Review workflow lessons

### Batch pushes, don't drip-feed
Lakshman uses Codex-backed review — each round has real cost. Pushing incrementally = multiple review rounds = more cost. Accumulate ALL planned work for a round locally, push once, request review once.

### Draft reply BEFORE pushing
When a reviewer's ask conflicts with product intent (R2's `parent_pin` ask), draft the PR reply BEFORE pushing. Pushing without the reply leaves the open item looking unaddressed.

### Separate "won't fix (product intent)" from "won't fix (too expensive)"
R2 is the first type: "linked jobs share property layout until fork" is the product model. Reply explains WHY, not just WHAT. A future reviewer (or codex re-run) will re-raise the same comment otherwise.

### Every reviewer-named fix needs a regression test
If the reviewer wrote the code-fix snippet verbatim (R17 CHECK constraints), the regression test should scan for the exact constraint name + predicate shape. Makes "I applied the fix" grep-verifiable instead of author-claim-only.

---

## Pre-PR grep checklist

Run these before "ready for review." Any unplanned hits → fix or document.

```bash
# Sibling-miss on fixes with names
grep -rn "SECURITY DEFINER" backend/alembic/versions/ | grep -v get_my_company_id
grep -rn "p_company_id" backend/alembic/versions/ | grep -v "get_my_company_id\|v_caller_company"
grep -rn "ERRCODE = '42501'" backend/alembic/versions/

# Silent-skip / silent-coerce
grep -rn "except.*: pass\|except APIError: pass" backend/api/
grep -rn "CONTINUE;" backend/alembic/versions/
grep -rn "return None  # silent\|return \[\]  # silent" backend/api/

# Atomic composition
grep -rn "_create_version\|\.rpc(" backend/api/floor_plans/service.py | wc -l

# Leftover dev-only markers
grep -rn "XXX TEMP\|TODO REVERT\|DO NOT PUSH\|DO NOT COMMIT" backend/

# TypeScript silent-drop patterns
grep -rn "if (.* && v > 0) onChange\|if (.*Finite(.*)) return" web/src/

# ---- Round 4 additions ----

# Every etag-aware service method + atomicity coverage
grep -rn "if if_match is not None" backend/api/         # should match every etag-aware service method
grep -rn '\.eq("updated_at"' backend/api/                # should match every etag-aware UPDATE
grep -rn 'request.headers.get("If-Match")' backend/api/floor_plans/router.py  # every mutation route

# RPCs that accept mutating canvas state — each must take expected_updated_at
grep -rn 'CREATE OR REPLACE FUNCTION save_floor_plan_version\|rollback_floor_plan_version_atomic' backend/alembic/versions/

# Error-path UX check — forced reloads must persist in-flight work
grep -rn "window.location.reload" web/src/
grep -rn "setStaleConflict" web/src/

# Overlap guards — every client-initiated write to floor_plans should have an in-flight flag
grep -rnE "apiPost.*floor-plans.*versions" web/src/     # audit every call site for an in-flight guard

# Type looseness at contract boundaries
grep -rn "etag\?: string | null" web/src/lib/types.ts   # tri-state at contract surface is a smell
```

---

## Per-round scoreboard

### Round 1 → Round 2
17 findings, all real bugs pre-existing. No demerits on round-1 work — came from reviewer's broader scan. 126 new tests. 0 regressions.

### Round 2 → Round 3
- 2 regressions (R12 cache miss on error branch; downgrade asymmetry on my own migration).
- 1 sibling-miss-adjacent (script kept in sync at first, drifted).
- 1 false-confidence (text-only trigger test).

4-demerit round. Every finding traceable to a pattern already documented above.

### Round 3 → Round 4
- 3 post-push regressions caught during phase2 testing (CORS / reconcile else-branch / cross-floor `setActiveFloorId`).
- 6 Lakshman findings: 2× P1, 2× P2, 2× P3.
- Every round-4 finding is an **invariant-level miss**. The code at each site was locally correct. We didn't write down the invariants.

### Round 4 → Round 5 (in progress)
All 6 being addressed in this batch:
- **P1 #1 + P3 #5 collapsed:** thread `p_expected_updated_at` through `save_floor_plan_version` + `rollback_floor_plan_version_atomic` (one migration, closes both).
- **P1 #2:** persist rejected canvas to localStorage keyed on source floor at POST time; restore-draft banner on next load.
- **P2 #1:** module-scoped autosave in-flight guard with replay via `lastCanvasRef`.
- **P2 #2:** require `If-Match` on mutation endpoints (428 `ETAG_REQUIRED` when missing); accept `If-Match: *` for create.
- **P3 #6:** tighten `FloorPlan.etag` to `string | undefined` + add `hasEtag()` type guard.

---

## Honesty ledger

After each round, count findings by type:
- **New surface area** (fixes bugs reviewer hadn't seen) → credit
- **Regressions from my fixes** → demerit
- **Siblings I missed** → demerit
- **False confidence** (my test claimed coverage it didn't have) → demerit

Every round 3 + round 4 finding fell into the demerit bins. The fix is not "better intent" — it's running the pre-PR grep checklist and writing the invariant list for cross-cutting features BEFORE the code.

---

*Last updated: 2026-04-22 (post-round-4 lessons capture, pre-round-5 fixes)*
