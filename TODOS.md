# TODOS — Crewmatic

Updated 2026-03-30. All eng review items complete.

## All Clear

No open items. Everything from the eng review (21 issues) has been fixed and verified.

## Completed

- ~~Job number retry loop~~ — FIXED: re-queries + random offset on collision
- ~~Share link token in URL path~~ — FIXED: POST /v1/shared/resolve + frontend updated
- ~~Onboarding race condition~~ — FIXED: rpc_onboard_user with advisory lock
- ~~File size validation unreliable~~ — FIXED: chunked read with 2MB hard limit
- ~~Photo ordering inconsistency~~ — FIXED: both use uploaded_at
- ~~Frontend shared page~~ — FIXED: uses POST /shared/resolve
- ~~Integration tests~~ — DONE: 23 tests against real local Supabase (RLS verified)

## Architecture Notes (for Spec 02)

### Celery for long-running AI jobs
AI Photo Scope calls (Claude Vision, 15-30s) must NOT block the API. Architecture:
- `POST /v1/jobs/{id}/photos/generate-scope` → enqueue Celery task → return task_id immediately
- Client polls `GET /v1/jobs/{id}/scope/status/{task_id}` or uses SSE for streaming
- Celery worker processes photos asynchronously
- Redis as broker (Upstash Redis via Supabase/Railway, or self-hosted)
- This pattern applies to: AI Photo Scope, Hazmat Scanner, Scope Check, Job Assistant
