# PR Review Lessons — Spec 01H

Living record of every pattern that cost us a review round on PR #10. One file, meant to stay.

Authoritative home for:
- meta-patterns extracted from reviewer feedback
- pre-PR grep checklist (runnable before every push)
- per-round scoreboard + honesty ledger

> Note: an earlier copy of this file was scoped as "local working notes" and got wiped in a parallel cleanup. Treat this as permanent — commit changes like any other doc.

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
