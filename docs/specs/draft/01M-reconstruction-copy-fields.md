# Spec 01M: Reconstruction Auto-Copy Fields — Post-CREW-11 Updates

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% |
| **State** | Draft |
| **Blocker** | Bound to CREW-11 (this fix lands as part of CREW-11's jobs refactor — Phase 8 of unified impl plan) |
| **Branch** | TBD |
| **Issue** | [CREW-60](https://linear.app/crewmatic/issue/CREW-60) |
| **Depends on** | 01J (CREW-11) |
| **Blocks** | None |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-28 |
| Repurposed | 2026-04-28 (was "Generalized Job Clone" — confirmed the original feature was already shipped via 01B; this spec now tracks the residual COPY_FIELDS update) |

---

## Summary

The "Convert to Reconstruction" workflow is **already done** — built as part of Spec 01B (implemented). Frontend UI at `web/src/app/(protected)/jobs/new/page.tsx:484-507` ("Link to Mitigation Job" dropdown). Backend auto-copy at `backend/api/jobs/service.py:286-350`.

This spec covers the **residual fix** required when CREW-11's job-schema changes ship: the `COPY_FIELDS` list currently references columns that CREW-11 will drop (`customer_name`, `customer_phone`, `customer_email`, `address_line1`, `city`, `state`, `zip`). Without updating the list, reconstruction creation will 500 after CREW-11 deploys.

In the same pass, we also pick up `loss_category`, `loss_class`, `loss_cause` (insurance-relevant fields the original 01B COPY list missed).

---

## What Already Exists (Do Not Duplicate)

| Component | Status | Location |
|-----------|--------|----------|
| `jobs.linked_job_id` column | ✅ Live (01B) | Same role I had originally proposed for `parent_job_id` — keep using it. |
| Backend auto-copy logic on `POST /v1/jobs` when `linked_job_id` is set | ✅ Live (01B) | `backend/api/jobs/service.py:286-350`. Validates `job_type='reconstruction'` + same-company source + source is mitigation. |
| Frontend "Link to Mitigation Job" dropdown | ✅ Live (01B) | `web/src/app/(protected)/jobs/new/page.tsx:484-507`. Auto-populates green confirmation message after selection. |
| Pydantic body field `linked_job_id: UUID \| None` on `JobCreate` | ✅ Live (01B) | `backend/api/jobs/schemas.py:17`. |
| `linked_job_id` on `JobResponse` | ✅ Live (01B) | Frontend `Job` type at `web/src/lib/types.ts:92`. |

---

## Done When

### Backend `COPY_FIELDS` updated to match post-CREW-11 schema

Diff in `backend/api/jobs/service.py` (~line 319):

```diff
 COPY_FIELDS = [
     "claim_number",
     "carrier",
     "adjuster_name",
     "adjuster_phone",
     "adjuster_email",
-    "customer_name",
-    "customer_phone",
-    "customer_email",
-    "address_line1",
-    "city",
-    "state",
-    "zip",
+    "customer_id",
     "latitude",
     "longitude",
     "property_id",
     "loss_type",
+    "loss_category",
+    "loss_class",
+    "loss_cause",
     "loss_date",
 ]
```

- [ ] Update the list per the diff
- [ ] Verify the auto-copy path still uses `body.model_fields_set` to detect explicit overrides (existing pattern preserved)

### Tests

- [ ] `test_reconstruction_clone_copies_customer_id` — POST a reconstruction with `linked_job_id`; assert response's nested `customer.id` matches source mitigation's customer
- [ ] `test_reconstruction_clone_copies_loss_category_class_cause` — assert new fields propagate
- [ ] `test_reconstruction_clone_does_not_reference_dropped_columns` — regression: assert no `customer_name`/`address_*` in any code path
- [ ] All existing reconstruction-link tests in `backend/tests/test_jobs.py` updated for the post-CREW-11 body + response shape (no `customer_*`/`address_*` body fields; read response via `job.customer.name` not `job.customer_name`)

### Frontend

- [ ] No new components.
- [ ] Verify existing "Link to Mitigation Job" UX continues to work end-to-end after backend changes.
- [ ] Per CREW-13, the new-job form will use `<CustomerPicker>` + `<PropertyPicker>` — confirm the auto-copied `customer_id` + `property_id` correctly populate them.

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Use existing `linked_job_id`; do NOT add a new `parent_job_id` column | Same semantics. 01B already implemented it. Parallel column = duplication. |
| 2 | Use existing auto-copy mechanism; do NOT add a `clone_from_job_id` body flag | Same effect. Already shipped. Already battle-tested. |
| 3 | Hardcoded `COPY_FIELDS` list (not configurable per request) | Existing pattern from 01B. YAGNI. |
| 4 | Defer the one-click button + idempotency unique index to optional future tickets | Original CREW-60 plan included these. They're polish, not blocking. CREW-11 ships without them. |

---

## Database Schema

**No schema changes in this spec.** All schema work happens in CREW-11's migration.

---

## API Endpoints

**No new or modified API surface.** The existing `POST /v1/jobs` with `linked_job_id` set is the entry point.

---

## Implementation Phasing

This work is **part of Phase 8 (Jobs refactor)** in `docs/specs/draft/01-foundation-impl-plan.md`:
- **Task 8.2 (Refactor `create_job`)** — `COPY_FIELDS` update lands here. Add to the task's Done-When list.
- **Task 8.5 (Update existing job tests)** — tests update.

No new phase, no new task — explicit checklist items added to Phase 8.

---

## Out of Scope (deferred to optional future tickets)

- **One-click "Convert to Reconstruction" button** on completed mitigation job detail pages
- **Idempotency partial unique index** on `(linked_job_id) WHERE job_type='reconstruction' AND deleted_at IS NULL` + 23505 catch
- **Generalized clone for non-reconstruction use cases** (re-do, supplement, multi-trade follow-on)

---

## Quick Resume

**If resuming cold:**
1. Read `backend/api/jobs/service.py:286-350` — existing auto-copy block.
2. Apply the COPY_FIELDS diff in this spec's "Done When" section.
3. Implement alongside CREW-11's broader job refactor (Phase 8 of the unified plan).

---

## Session Log

_Populated as work progresses._

---

## Decisions Log

### 2026-04-28 — Repurposed from "Generalized Job Clone"

Original 01M proposed: new `parent_job_id` column, `clone_from_job_id` body flag, idempotency unique index, `<ConvertToReconstructionButton>`. After verifying the codebase, all those proposals were already covered (or made redundant) by Spec 01B's `linked_job_id` mechanism shipped earlier. Spec collapsed to just the COPY_FIELDS update, which is mandatory because CREW-11 drops the columns the existing list references. Optional UX/idempotency enhancements deferred to future small issues.
