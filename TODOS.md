# TODOS — Crewmatic

Updated 2026-03-30. Items from eng review.

## Pre-Spec 02 Blockers

### Dockerfile for backend (Railway)
Shapely requires libgeos (C library). WeasyPrint (Spec 02 PDF generation) requires cairo + pango. Without a Dockerfile, Railway buildpack detection may break silently on base image updates. Create `backend/Dockerfile` with Python 3.13 + system deps.
- **Blocked by:** nothing
- **Blocks:** Spec 02 Phase 9 (PDF generation)

### Frontend: update shared page to use POST /shared/resolve
The backend now has `POST /v1/shared/resolve` (token in body, not URL path). The frontend `web/src/app/shared/[token]/page.tsx` still calls `GET` with token in path. Update to POST the token in the request body.
- **Blocked by:** nothing
- **Impact:** security improvement (token no longer logged in URL paths)

### Backend integration tests against real Supabase
Unit tests use mocked Supabase. Need integration tests hitting a real local Supabase (Docker) to validate RLS policies, RPC functions, and query syntax.
- **Blocked by:** Docker setup for local Supabase test instance

## Completed (from original TODOS)

- ~~Job number retry loop~~ — FIXED: re-queries + random offset on collision
- ~~Share link token in URL path~~ — FIXED: POST /v1/shared/resolve added
- ~~Onboarding race condition~~ — FIXED: rpc_onboard_user with advisory lock
- ~~File size validation unreliable~~ — FIXED: chunked read with 2MB hard limit
- ~~Photo ordering inconsistency~~ — FIXED: both use uploaded_at

## Architecture Notes (for Spec 02)

### Celery for long-running AI jobs
AI Photo Scope calls (Claude Vision, 15-30s) must NOT block the API. Architecture:
- `POST /v1/jobs/{id}/photos/generate-scope` → enqueue Celery task → return task_id immediately
- Client polls `GET /v1/jobs/{id}/scope/status/{task_id}` or uses SSE for streaming
- Celery worker processes photos asynchronously
- Redis as broker (Upstash Redis via Supabase/Railway, or self-hosted)
- This pattern applies to: AI Photo Scope, Hazmat Scanner, Scope Check, Job Assistant
