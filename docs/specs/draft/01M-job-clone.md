# Spec 01M: Generalized Job Clone (covers Convert to Reconstruction)

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% |
| **State** | Draft |
| **Blocker** | Depends on CREW-11 (01J) for `customer_id` and `property_id` FKs on jobs |
| **Branch** | TBD |
| **Issue** | [CREW-60](https://linear.app/crewmatic/issue/CREW-60) |
| **Depends on** | 01J |
| **Blocks** | None directly |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-28 |

## Reference
- [CREW-60](https://linear.app/crewmatic/issue/CREW-60)
- [01J spec § Out of Scope](./01J-customer-property-model.md) — Phase 3 of original 01J PRD lives here
- [01B job-types-reconstruction (implemented)](../implemented/01B-job-types-reconstruction.md) — defines mitigation/reconstruction `job_type` enum + `linked_job_id`

---

## Summary

Generalized "create a new job by cloning fields from an existing one" pattern. The **"Convert to Reconstruction"** button Brett asked for becomes the first UI preset of this — no dedicated endpoint.

Server-side: `POST /v1/jobs` accepts an optional `clone_from_job_id`. When set, backend copies a hardcoded list of insurance + loss-context fields from the source job unless the body overrides them. Sets `parent_job_id` on the new job for audit traceability.

UI-side: a single "Convert to Reconstruction" button on completed mitigation jobs opens a confirmation dialog and POSTs `{ job_type: 'reconstruction', clone_from_job_id, customer_id, property_id }`. Same backend path, same DB rows, just a UI preset.

This generalizes for free to:
- **Re-do / warranty job** at the same property
- **Insurance supplement** with scope overrides
- **Multi-trade follow-on** (plumbing → HVAC at the same rental, inherit customer + property + insurance)
- **Estimate revision**

One pattern. One endpoint. Many use cases. Avoids endpoint proliferation as Brett's multi-trade vision rolls in.

---

## What Already Exists (Do Not Duplicate)

| Component | Status | Notes |
|-----------|--------|-------|
| `jobs.job_type` enum (`mitigation`, `reconstruction`) | ✅ Live (01B) | Existing column. Convert button uses `job_type='reconstruction'`. |
| `jobs.linked_job_id` (01B) | ✅ Live | Different concept — 01B's `linked_job_id` is "two jobs at the same insurance claim" (mitigation ↔ reconstruction siblings). This spec adds `parent_job_id` which is "this job was cloned from that one" — a stricter parent/child audit link. They can coexist (often the same value). |
| Job CRUD endpoints (after 01J) | ✅ Live | Refactored body shape from 01J: `customer_id` + `property_id` required, no inline customer/address fields. |

---

## Done When

### Schema
- [ ] `jobs.parent_job_id UUID NULL REFERENCES jobs(id) ON DELETE RESTRICT` — clone source pointer
- [ ] `CREATE INDEX idx_jobs_parent ON jobs(parent_job_id) WHERE parent_job_id IS NOT NULL`
- [ ] **Reconstruction-only partial unique index**: `CREATE UNIQUE INDEX idx_jobs_one_reconstruction_per_parent ON jobs(parent_job_id) WHERE job_type='reconstruction' AND deleted_at IS NULL AND parent_job_id IS NOT NULL` — prevents double-click from creating two reconstructions for the same mitigation. Other clone types (re-do, supplement) are allowed to multiply.

### Backend
- [ ] `JobCreate` schema (from 01J) accepts optional `clone_from_job_id: UUID`
- [ ] `parent_job_id` is **never accepted in the request body** (`extra="forbid"` on the schema; field is server-set from `clone_from_job_id`)
- [ ] When `clone_from_job_id` is provided, service:
  - Pre-fetches source via authenticated client; 0 rows → `404 SOURCE_JOB_NOT_FOUND`
  - Copies these fields from source UNLESS body overrides: `loss_date`, `claim_number`, `carrier`, `adjuster_name`, `adjuster_phone`, `adjuster_email`, `loss_type`, `loss_category`, `loss_class`, `loss_cause`
  - Body's `customer_id` and `property_id` are still required (frontend pre-fills from source for convert UX)
  - Sets `parent_job_id = clone_from_job_id` on the insert
- [ ] On 23505 unique-violation against `idx_jobs_one_reconstruction_per_parent`: catch, fetch the existing reconstruction, return it as 200 (idempotent — double-click safe). Response includes `idempotent_replay: true` flag for observability.
- [ ] Optional helper endpoint: `GET /v1/jobs/{id}/reconstruction` — returns the linked reconstruction job if exists, else 404. Used by the button toggle UX.
- [ ] Audit log entry on the source job: `event_type = "job_cloned"`, `event_data = { source_job_id, new_job_id, new_job_type }`. Adjuster-share-link tests must continue to pass (no PII change here).
- [ ] Tests cover happy path, override path, idempotency (serial + concurrent), cross-company source, hard-delete restrict, scope-not-copied (negative test).

### Frontend
- [ ] `<ConvertToReconstructionButton>` component on the job detail page (`web/src/app/(protected)/jobs/[id]/page.tsx`)
- [ ] Visible only when `job.job_type === 'mitigation'` AND `job.status === 'completed'` AND `job.linked_reconstruction_id == null` (latter inferred from a `useReconstruction(jobId)` hook calling `GET /v1/jobs/{id}/reconstruction`)
- [ ] Confirmation dialog: *"Create reconstruction job at {address}? This will link to the completed water mitigation from {loss_date}."*
- [ ] On confirm: POST `/v1/jobs` with body `{ job_type: 'reconstruction', clone_from_job_id, customer_id: src.customer_id, property_id: src.property_id }`. Redirect to new job's detail.
- [ ] If a linked reconstruction already exists, button label switches to "View Reconstruction →" and click navigates instead of POSTing.
- [ ] Tests: button visibility logic, dialog confirms, idempotent re-click navigation, redirect after success.

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Generalized clone via `clone_from_job_id` flag** on `POST /v1/jobs` (not a dedicated `POST /v1/jobs/{id}/convert-to-reconstruction` endpoint) | Same UI work either way (~5% more backend code). Generalizes to re-do / supplement / multi-trade scenarios without rebuilding. Aligns with Brett's multi-trade scaling vision. Avoids endpoint proliferation. |
| 2 | **Hardcoded copy-field list** (insurance + loss-context only): `loss_date`, `claim_number`, `carrier`, `adjuster_*`, `loss_type/category/class/cause`. NOT scope items, NOT notes, NOT customer-specific fields. | Keeps the contract simple. Deterministic. Configurable copy lists are a YAGNI; if a use case demands selective copying later, add a `clone_fields: list[str]` body field then. |
| 3 | `parent_job_id` is `ON DELETE RESTRICT` (not SET NULL or CASCADE) | Hard-delete a referenced source job should fail loudly. Soft-delete preserves the link (which is what we want for audit). |
| 4 | Reconstruction idempotency via partial unique index (`WHERE job_type='reconstruction' AND deleted_at IS NULL AND parent_job_id IS NOT NULL`) — race-safe at the DB layer | Catches double-click on the convert button. Service catches `23505` and returns the existing reconstruction with `idempotent_replay: true`. Other clone types (re-do, supplement) are intentionally allowed to multiply. |
| 5 | Sketch behavior on convert: per 01H, `floor_plans` are property-anchored and version-pinned. New reconstruction job auto-pins to the latest floor-plan version. "Start Fresh" sketch is a power-user option in the sketch tool itself, not the convert dialog. | Reuses 01H's existing version-pin logic. No new code. |
| 6 | The convert button lives on the **job detail page**, not the property detail page | Action is on the job ("convert THIS job"), not the property. Belongs with the job's other actions. |
| 7 | The convert button only shows on `completed` mitigation jobs — not `in_progress` ones | A reconstruction shouldn't start before the mitigation is dry. Enforced at the UI level; backend doesn't gate (allows future override / admin power use). |
| 8 | "View Reconstruction →" toggle uses a pre-check via `GET /v1/jobs/{id}/reconstruction` | One round-trip to determine button label. Cached in React Query so subsequent renders are instant. |
| 9 | `parent_job_id` is **read-only in the API** (server-set from `clone_from_job_id`, never accepted in body) | Prevents tampering — a malicious client shouldn't be able to claim a job is descended from one it isn't. |
| 10 | Audit event `job_cloned` (not `job_converted_to_reconstruction`) | Future-proofed naming for the generalized pattern. Distinguish convert use cases via `new_job_type` in event data. |
| 11 | **`parent_job_id` is exposed in `JobResponse`** as `parent_job_id: UUID \| None`. The response wrapper for idempotent replay returns `IdempotentJobResponse extends JobResponse` with an additional `idempotent_replay: bool = False` field. | Audit trail observable from API. Idempotent replay is a real client signal, not a magic field that gets stripped by Pydantic. |
| 12 | **When cloning to `job_type='reconstruction'`, the service ALSO populates `linked_job_id = clone_from_job_id`** for compatibility with 01B's mitigation↔reconstruction sibling-lookup queries. `parent_job_id` and `linked_job_id` will hold the same value for reconstruction clones. Other clone types (re-do, supplement) populate only `parent_job_id`. | 01B's `linked_job_id` is the existing audit pointer. We preserve its semantics rather than silently breaking 01B's UI/API. The parallel pointer is a one-line cost in the insert. |
| 13 | **Idempotent replay does NOT log a duplicate audit event.** The `job_cloned` event is logged ONLY on the first successful insert. Replays return the existing job (RLS-scoped — same company so visible anyway) without writing audit history. | Audit log fidelity. Double-counting clones inflates metrics and confuses post-incident review. |
| 14 | **Idempotent replay response preserves the original `created_by`** — does NOT swap in the replaying user's id. `idempotent_replay: true` flag is the only observable signal that a replay occurred; no `replayed_by_user_id` field. | Information disclosure: User B clicking 100ms after User A shouldn't learn User A's identity beyond what's already visible to same-company members. The flag is sufficient observability. |
| 15 | **Service-layer assertion `assert "parent_job_id" not in body.model_dump()`** as defense-in-depth before constructing `insert_data`. Catches the case where a future schema change accidentally exposes the field even with `extra="forbid"` configured. | Belt-and-suspenders security posture. Test `test_parent_job_id_unsettable_via_any_path` locks this in. |
| 16 | **Idempotent replay's existing-row lookup explicitly filters `company_id`** in addition to `parent_job_id`. RLS would also block cross-company, but defense-in-depth. | Same posture as 01J Decision #16 (cross-company FK validation). |
| 17 | **Soft-delete of a source job is BLOCKED if a non-soft-deleted reconstruction child exists** — mirrors 01J Decision #15. Returns 409 `JOB_HAS_DEPENDENT_RECONSTRUCTION`. Job soft-delete service must check before setting `deleted_at`. | Prevents orphan reconstruction with dangling parent_job_id pointer. Forces explicit cleanup order: delete reconstruction first (or both at once via a transactional bulk-delete UI in V2). |
| 18 | **Idempotent replay edge case — source job soft-deleted between two POSTs.** First POST succeeded; user then soft-deletes source; second POST's pre-fetch returns 0 rows. Service still checks for an existing reconstruction by `parent_job_id` even when source is gone — returns it with `idempotent_replay: true`. Only returns 404 `SOURCE_JOB_NOT_FOUND` if no reconstruction child exists either. | Otherwise the user sees a 404 instead of "you already created this." |

---

## Database Schema

```sql
-- ============================================================================
-- jobs.parent_job_id (clone source pointer)
-- ============================================================================
ALTER TABLE jobs
    ADD COLUMN parent_job_id UUID REFERENCES jobs(id) ON DELETE RESTRICT;

CREATE INDEX idx_jobs_parent
    ON jobs(parent_job_id)
    WHERE parent_job_id IS NOT NULL;

-- ============================================================================
-- Reconstruction idempotency: at most one active reconstruction per source
-- ============================================================================
CREATE UNIQUE INDEX idx_jobs_one_reconstruction_per_parent
    ON jobs(parent_job_id)
    WHERE job_type = 'reconstruction'
      AND deleted_at IS NULL
      AND parent_job_id IS NOT NULL;
```

`downgrade()`:
```sql
DROP INDEX IF EXISTS idx_jobs_one_reconstruction_per_parent;
DROP INDEX IF EXISTS idx_jobs_parent;
ALTER TABLE jobs DROP COLUMN IF EXISTS parent_job_id;
```

---

## API Endpoints

### Modified: `POST /v1/jobs`

Body (extends the 01J shape):

```python
class JobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: UUID
    property_id: UUID
    job_number: str = Field(..., min_length=1, max_length=100)
    job_type: Literal["mitigation", "reconstruction"] = "mitigation"
    clone_from_job_id: UUID | None = None  # NEW

    # ... insurance + loss + status fields, all optional and overridable when cloning
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
    # NOTE: parent_job_id is NEVER accepted in body — server-set from clone_from_job_id
```

Backend logic:

```python
async def create_job(token, company_id, user_id, body):
    client = get_authenticated_client(token)

    # Existing FK pre-fetch (from 01J)
    customer = await fetch_one_or_404(...)  # 404 CUSTOMER_NOT_FOUND
    property_ = await fetch_one_or_404(...)  # 404 PROPERTY_NOT_FOUND

    parent_job_id = None
    cloned_fields = {}
    if body.clone_from_job_id:
        # Try fetching source — but if it's gone (soft-deleted), still check for an
        # existing reconstruction child (Decision #18 — idempotent replay survives source deletion)
        source = await client.table("jobs").select("*") \
            .eq("id", str(body.clone_from_job_id)) \
            .eq("company_id", str(company_id)) \
            .is_("deleted_at", "null") \
            .maybe_single().execute()

        if not source.data:
            # Source not visible — but if a reconstruction child exists, return it (idempotent)
            existing_recon = await client.table("jobs").select("*") \
                .eq("parent_job_id", str(body.clone_from_job_id)) \
                .eq("company_id", str(company_id)) \
                .eq("job_type", "reconstruction") \
                .is_("deleted_at", "null") \
                .maybe_single().execute()
            if existing_recon.data:
                return {**existing_recon.data, "idempotent_replay": True}
            raise AppException(404, "Source job not found", "SOURCE_JOB_NOT_FOUND")

        parent_job_id = body.clone_from_job_id

        # Hardcoded copy list (Decision #2)
        COPY_FIELDS = [
            "loss_date", "claim_number", "carrier",
            "adjuster_name", "adjuster_phone", "adjuster_email",
            "loss_type", "loss_category", "loss_class", "loss_cause",
        ]
        for f in COPY_FIELDS:
            cloned_fields[f] = source.data.get(f)

    body_dict = body.model_dump(exclude={"clone_from_job_id"}, exclude_unset=True)

    # Defense-in-depth: even with extra="forbid", catch any future schema regression
    assert "parent_job_id" not in body_dict, \
        "parent_job_id must not appear in request body"

    # Body overrides clone (explicit None in body wins over source's value)
    insert_data = {**cloned_fields, **body_dict}
    insert_data["company_id"] = str(company_id)
    insert_data["created_by"] = str(user_id)
    if parent_job_id:
        insert_data["parent_job_id"] = str(parent_job_id)
        # Decision #12: also populate linked_job_id for reconstruction clones (01B compat)
        if insert_data.get("job_type") == "reconstruction":
            insert_data["linked_job_id"] = str(parent_job_id)

    try:
        result = await client.table("jobs").insert(insert_data).execute()
    except Exception as exc:
        if "23505" in str(exc) and "one_reconstruction_per_parent" in str(exc):
            # Decision #16: explicit company_id filter (defense-in-depth)
            existing = await client.table("jobs").select("*") \
                .eq("parent_job_id", str(parent_job_id)) \
                .eq("company_id", str(company_id)) \
                .eq("job_type", "reconstruction") \
                .is_("deleted_at", "null") \
                .maybe_single().execute()
            if not existing.data:
                # Race after race: source soft-deleted between unique-violation and lookup
                raise AppException(409, "Reconstruction conflict", "RECONSTRUCTION_RACE") from exc
            # Decision #13/14: NO duplicate audit log on replay; return existing as-is
            return {**existing.data, "idempotent_replay": True}
        raise

    new_job = result.data[0]
    if parent_job_id:
        # Audit log only on the original successful insert (Decision #13)
        # event_data does NOT include copied field values (no PII / claim numbers / adjuster contact)
        await log_event(company_id, "job_cloned", user_id=user_id,
            event_data={
                "source_job_id": str(parent_job_id),
                "new_job_id": new_job["id"],
                "new_job_type": new_job["job_type"],
            })
    return new_job
```

### New: `GET /v1/jobs/{id}/reconstruction`

| Method | Endpoint | Role | Behavior |
|---|---|---|---|
| `GET` | `/v1/jobs/{id}/reconstruction` | Member | Returns the linked reconstruction job if one exists. 404 if none. Used by the button-toggle UX. Single query: `SELECT * FROM jobs WHERE parent_job_id = $1 AND job_type = 'reconstruction' AND deleted_at IS NULL LIMIT 1`. |

Response shape: same as `JobResponse` from 01J — full nested customer + property.

---

## Frontend Architecture

### Convert Button Placement

```tsx
// web/src/app/(protected)/jobs/[id]/page.tsx
// Within the job detail header, near other job actions:

{job.job_type === "mitigation" && job.status === "completed" && (
  <ConvertToReconstructionButton job={job} />
)}
```

```tsx
// web/src/components/convert-to-reconstruction-button.tsx
function ConvertToReconstructionButton({ job }: { job: Job }) {
  const { data: existingRecon } = useReconstruction(job.id);  // GET /v1/jobs/{id}/reconstruction
  const router = useRouter();
  const createJob = useCreateJob();
  const [showDialog, setShowDialog] = useState(false);

  if (existingRecon) {
    return <Button variant="ghost" onClick={() => router.push(`/jobs/${existingRecon.id}`)}>
      View Reconstruction →
    </Button>;
  }

  return (
    <>
      <Button onClick={() => setShowDialog(true)}>
        Convert to Reconstruction
      </Button>
      <ConfirmDialog
        open={showDialog}
        onCancel={() => setShowDialog(false)}
        onConfirm={async () => {
          const result = await createJob.mutateAsync({
            customer_id: job.customer_id,
            property_id: job.property_id,
            job_type: "reconstruction",
            clone_from_job_id: job.id,
            // job_number generated server-side or per existing convention
          });
          router.push(`/jobs/${result.id}`);
        }}
        title={`Create reconstruction job at ${job.property.address_line1}?`}
        body={`This will link to the completed water mitigation from ${formatDate(job.loss_date)}.`}
      />
    </>
  );
}
```

### Reconstruction lookup hook

```tsx
// web/src/lib/hooks/use-reconstruction.ts
export function useReconstruction(jobId: string) {
  return useQuery({
    queryKey: ["job", jobId, "reconstruction"],
    queryFn: async () => {
      try {
        return await apiClient<Job>(`/v1/jobs/${jobId}/reconstruction`);
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
  });
}
```

---

## Testing Requirements

### Backend
- `test_job_clone_copies_insurance_fields_from_source` — all 10 COPY_FIELDS land on the new job
- `test_job_clone_body_overrides_source_fields` — body-provided value wins; explicit `null` in body also wins (e.g., to clear a field that the source had populated)
- `test_job_clone_sets_parent_job_id` — read back from DB
- `test_job_clone_does_not_copy_scope_or_notes` — negative assertion
- `test_job_clone_does_not_copy_status` — new job starts at default status, not source's `completed`
- `test_job_clone_with_source_from_other_company_returns_404` — RLS-scoped pre-fetch
- `test_reconstruction_clone_idempotent_serial` — second POST returns existing with `idempotent_replay: true`
- `test_reconstruction_clone_idempotent_concurrent_double_click` — `asyncio.gather` two parallel POSTs; exactly one new row, both responses have the same `id`
- `test_non_reconstruction_clones_can_multiply` — three "re-do" clones of the same source job all succeed (no idempotency lock for non-reconstruction)
- `test_parent_job_hard_delete_restricted` — attempting hard-delete of a source mitigation that has a reconstruction child raises IntegrityError
- `test_clone_from_job_id_not_in_body_does_nothing` — POST without `clone_from_job_id` works as before, no copy
- `test_parent_job_id_in_body_rejected` — `extra="forbid"` blocks tampering attempt
- `test_get_reconstruction_endpoint_returns_linked_job`
- `test_get_reconstruction_endpoint_returns_404_when_none`
- `test_get_reconstruction_excludes_soft_deleted`
- `test_audit_log_records_job_cloned_event`
- `test_idempotent_replay_does_not_double_log_audit_event` — second POST returns existing without writing a 2nd `job_cloned` row
- `test_idempotent_replay_preserves_original_created_by` — replaying user is NOT swapped into the response's `created_by`
- `test_idempotent_replay_when_source_soft_deleted_returns_existing_reconstruction` — Decision #18
- `test_idempotent_replay_existing_lookup_filters_company_id` — Decision #16
- `test_reconstruction_clone_populates_linked_job_id` — Decision #12
- `test_non_reconstruction_clone_does_not_populate_linked_job_id` — only reconstruction gets the 01B sibling pointer
- `test_parent_job_id_unsettable_via_any_path` — `extra="forbid"` blocks body; service-layer assertion catches future regressions
- `test_source_job_soft_delete_blocked_when_reconstruction_child_exists` — Decision #17; mirrors 01J Decision #15
- `test_audit_log_event_data_excludes_pii` — `job_cloned` event has no claim/adjuster/loss_cause values
- `test_idempotent_replay_response_includes_idempotent_replay_true_flag` — observability contract

### Frontend
- `convert-to-reconstruction-button.test.tsx`:
  - hidden when `job.job_type !== "mitigation"`
  - hidden when `job.status !== "completed"`
  - shows "Convert to Reconstruction" when no existing reconstruction
  - shows "View Reconstruction →" when reconstruction exists
  - dialog confirms before POST
  - redirects to new job after success
- E2E: complete a mitigation → click Convert → confirm → land on new reconstruction job → verify insurance fields inherited

---

## Spec Interactions

| Spec | Interaction |
|------|-------------|
| 01J (CREW-11) | This spec extends `JobCreate` schema and `create_job` service. `parent_job_id` is the third FK column on `jobs` (after `customer_id` and `property_id`). |
| 01B (Reconstruction) | 01B's `linked_job_id` is "siblings on same insurance claim". This spec's `parent_job_id` is "this job descended from that one". They often coincide (most reconstructions are clones of their mitigation), but they're conceptually distinct. Don't conflate. |
| 01H (Floor Plan v2) | New reconstruction auto-pins to latest sketch version per floor — no code in this spec, just relies on 01H's existing pin logic. |
| 01L (CREW-59) | The convert button is on job detail, NOT property detail. Property detail has "+ Create Job at this Property" CTA (which is a from-scratch job, not a clone). |

---

## Out of Scope

- **Clone fields configurability** (`clone_fields: list[str]` in body) — YAGNI for V1. Add when a real use case demands it.
- **Bulk clone** (clone N jobs at once) — V2.
- **Cross-company clone** — explicitly forbidden. Companies are tenant-isolated.
- **Cloning status / scope items / notes** — explicit non-features. Status is workflow-state-specific. Scope is mitigation-vs-reconstruction-specific. Notes are temporal commentary.
- **Auto-creating supplements** — V2 supplement-claim use case will reuse the same `clone_from_job_id` mechanism but with a different UI preset. Not built here.

---

## Quick Resume

**If resuming cold:**
1. Schema delta is tiny (one column + two indexes). Goes into the unified migration alongside 01J/01K/01L changes.
2. The trick is the idempotency partial unique + 23505 catch in the service. Test the concurrent double-click case explicitly.
3. Frontend button is small (~80 LOC). The harder UX work is the `useReconstruction` hook handling 404s gracefully.

---

## Session Log

_Populated as work progresses._

---

## Decisions Log

_Populated during eng review and implementation._
