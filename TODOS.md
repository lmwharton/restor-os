# TODOS — Crewmatic

Updated 2026-03-30. All eng review items complete.

## Open Items

### Spec 03 — Voice Everywhere (Design Review 2026-04-08)
- **Haptic feedback for voice interactions** — Add navigator.vibrate() calls: 10ms on mic activation, 5ms on field fill confirmation. Gives tactile feedback to contractors who can't always look at screen (dirty/wet gloves, holding tools). Polish item, non-blocking. Depends on: Spec 03 Phase 1 implementation.

## Completed

- ~~Job number retry loop~~ — FIXED: re-queries + random offset on collision
- ~~Share link token in URL path~~ — FIXED: POST /v1/shared/resolve + frontend updated
- ~~Onboarding race condition~~ — FIXED: rpc_onboard_user with advisory lock
- ~~File size validation unreliable~~ — FIXED: chunked read with 2MB hard limit
- ~~Photo ordering inconsistency~~ — FIXED: both use uploaded_at
- ~~Frontend shared page~~ — FIXED: uses POST /shared/resolve
- ~~Integration tests~~ — DONE: 23 tests against real local Supabase (RLS verified)

## Architecture Notes (for Spec 02)

### ✅ Celery + SSE for AI jobs (RESOLVED in Spec 02A eng review 2026-04-08)
Architecture decided: Celery worker + Railway Redis (broker + pub/sub) + SSE streaming.
- `POST /v1/scope/generate` → enqueue Celery task → return task_id
- `GET /v1/scope/stream/{task_id}` → SSE endpoint, replays from Redis list + subscribes pub/sub
- Worker publishes thinking + line_item + complete events to Redis
- SSE reconnection via Last-Event-ID header + Redis event log replay
- Redis lock per job_id for idempotency
- Applies to: PhotoScope (02A), HazmatCheck (02B), Job Audit (02C)
- Ask Crewmatic (02D) uses direct SSE (no Celery, responses are 2-5s)
