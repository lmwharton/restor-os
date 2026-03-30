# TODOS — Crewmatic

Deferred items from eng review (2026-03-30). Ordered by priority.

## Pre-Spec 02 Blockers

### Dockerfile for backend (Railway)
Shapely requires libgeos (C library). WeasyPrint (Spec 02 PDF generation) requires cairo + pango. Without a Dockerfile, Railway buildpack detection may break silently on base image updates. Create `backend/Dockerfile` with Python 3.13 + system deps.
- **Blocked by:** nothing
- **Blocks:** Spec 02 Phase 9 (PDF generation)

### Job number retry loop is ineffective
`backend/api/jobs/service.py:64-85` — `_generate_job_number` re-reads the same `max` on retry because the failed insert hasn't committed. All 3 retries generate the same number. Fix: re-query after failed insert, or add random offset.
- **Blocked by:** nothing
- **Impact:** race condition on concurrent job creation (same day). Low risk at 1 user.

## Security

### Share link token in URL path
`GET /shared/{token}` passes raw token as path parameter. URL paths are logged by Railway, FastAPI middleware, Supabase, and browser history. Move token to POST body or query parameter before sharing line items (Spec 02).
- **Blocked by:** nothing
- **Fix before:** Spec 02 adds AI-generated line items to shared views

### Onboarding race condition
`backend/api/auth/service.py:101-194` — check-then-insert without transaction. Two simultaneous onboarding requests can create duplicate companies. Fix: use database-level UNIQUE constraint on auth_user_id + transaction.
- **Blocked by:** RPC-based transactions (accepted in review)
- **Impact:** very low (single-user V1), but fix before team invites

### File size validation unreliable
`backend/api/auth/router.py:54` — `UploadFile.size` is `None` when Content-Length header is missing (chunked uploads). Large files silently pass validation and load fully into memory. Fix: read file in chunks, enforce size limit on bytes read.
- **Blocked by:** nothing
- **Impact:** DoS vector (upload 100MB avatar). Low risk at single-user.

## Data Consistency

### Photo ordering inconsistency
`backend/api/sharing/service.py:181` orders photos by `created_at`. `backend/api/photos/service.py:298` orders by `uploaded_at`. If these columns diverge (e.g., DB clock skew), shared view and auth view show photos in different order.
- **Blocked by:** nothing
- **Impact:** cosmetic, but confusing for adjusters viewing shared links
