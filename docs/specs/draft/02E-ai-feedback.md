# AI Feedback — Centralized Thumbs Up/Down for All AI Features

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/2 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 02A Phase 1 (event_history + log_ai_event pattern) |
| **Branch** | TBD |
| **Issue** | TBD |
| **Implementation Phase** | Phase 1 (ships with PhotoScope + HazmatCheck) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-07 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] `POST /v1/ai/feedback` — submit thumbs up/down for any AI-generated item
- [ ] Feedback linked to originating AI event via event_id
- [ ] Reusable `<AIFeedback />` component used across PhotoScope, HazmatCheck, Job Audit, Ask Crewmatic
- [ ] Visual states: idle → selected (highlighted) → submitted
- [ ] Optional comment field on thumbs-down
- [ ] Thumbs-down on PhotoScope item triggers agentic retry for that photo
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** AI accuracy improves with feedback, but each AI feature shouldn't have its own feedback mechanism. Need one centralized endpoint.

**Solution:** Single `POST /v1/ai/feedback` endpoint that accepts thumbs up/down for any AI-generated item, linked via `event_id`. One reusable frontend component used everywhere.

## Database Schema

**ai_feedback** (NEW)
```sql
CREATE TABLE ai_feedback (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES event_history(id) ON DELETE CASCADE,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES profiles(id),
    item_id     TEXT,           -- e.g., line item index or finding ID within the event
    rating      TEXT NOT NULL,  -- 'up' | 'down'
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(event_id, item_id, user_id)  -- one rating per user per item
);
```

## Phases & Checklist

### Phase 1: Backend — ❌

**API route (`api/feedback/router.py`):**
- [ ] `POST /v1/ai/feedback` — submit feedback for any AI feature
  - [ ] Request: `AIFeedbackRequest { event_id: UUID, item_id: str | None, rating: Literal['up','down'], comment: str | None }`
  - [ ] Response: `{ id: UUID, accepted: true }`
  - [ ] Auth required (extracts user_id and company_id from token)
- [ ] Validation:
  - [ ] `event_id` must exist in `event_history`
  - [ ] `event_id` must belong to the requesting user's `company_id`
  - [ ] Referenced event must have `is_ai=true`
  - [ ] If feedback already exists for this `(event_id, item_id, user_id)`, update instead of insert (idempotent)
- [ ] Store feedback in `ai_feedback` table
- [ ] **Agentic retry trigger:** If `rating='down'` AND event_type is `ai_photo_analysis`:
  - [ ] Enqueue a scope retry task for that photo (reuses 02A Celery task with feedback context)
  - [ ] Retry prompt includes: "User rejected these items: [list]. Re-analyze."
  - [ ] Max 2 retries per photo (check retry count in event_history)

**Schemas (`api/feedback/schemas.py`):**
- [ ] `AIFeedbackRequest { event_id: UUID, item_id: str | None, rating: Literal['up','down'], comment: str | None }`
- [ ] `AIFeedbackResponse { id: UUID, accepted: bool, retry_triggered: bool }`

**Alembic migration:**
- [ ] Create `ai_feedback` table (schema above)
- [ ] Index on `ai_feedback(event_id)`
- [ ] Unique constraint on `(event_id, item_id, user_id)`

**Mount router:**
- [ ] Add `feedback_router` to `api/main.py` with `prefix="/v1"`

**Tests:**
- [ ] pytest: `test_feedback.py` — feedback accepted for valid event_id, own company
- [ ] pytest: `test_feedback.py` — feedback rejected (403) for event_id from another company
- [ ] pytest: `test_feedback.py` — feedback rejected (400) for non-AI events (is_ai=false)
- [ ] pytest: `test_feedback.py` — duplicate feedback updates instead of creating new row (idempotent)
- [ ] pytest: `test_feedback.py` — thumbs-down on ai_photo_analysis triggers retry (mock Celery)
- [ ] pytest: `test_feedback.py` — retry not triggered after 2 previous retries (max check)

### Phase 2: Frontend — Reusable Component — ❌

**`<AIFeedback />` component (`web/src/components/ai/ai-feedback.tsx`):**
- [ ] Props: `eventId: string, itemId?: string, onRetryTriggered?: () => void`
- [ ] Two small icon buttons: 👍 and 👎
- [ ] Visual states:
  - Idle: both icons in muted color (#b5b0aa)
  - Hover: icon becomes primary text color (#1a1a1a)
  - Selected (up): 👍 in green (#2a9d5c), 👎 stays muted
  - Selected (down): 👎 in red (#dc2626), 👍 stays muted
  - Submitting: brief spinner on the selected icon
- [ ] Touch targets: 44px min (icons within a larger tap area)
- [ ] `aria-label="Rate: helpful"` on 👍, `aria-label="Rate: not helpful"` on 👎
- [ ] On 👎 tap: show optional comment field (text input, max 200 chars)
  - [ ] Submit button for comment (or auto-submit on blur)
  - [ ] Comment is optional — thumbs-down works without it
- [ ] Call `POST /v1/ai/feedback` via `useAIFeedback()` hook
- [ ] On `retry_triggered: true` response: call `onRetryTriggered()` callback (parent handles re-analysis UI)
- [ ] Optimistic UI: immediately show selected state, revert on API error

**Hook (`web/src/hooks/use-ai-feedback.ts`):**
- [ ] `useAIFeedback()` — TanStack Query mutation
- [ ] `submitFeedback({ eventId, itemId, rating, comment })` → `POST /v1/ai/feedback`
- [ ] Returns `{ submitFeedback, isLoading, isError }`
- [ ] Shared across all AI features (PhotoScope, HazmatCheck, Job Audit, Ask Crewmatic)

**Integration points (where `<AIFeedback />` is used):**
- [ ] PhotoScope: next to each AI-generated line item row (02A Phase 4)
- [ ] HazmatCheck: on each hazmat finding card (02B Phase 2)
- [ ] Job Audit: on each audit finding card (02C Phase 2)
- [ ] Ask Crewmatic: below each AI reply message (02D Phase 2)

## Technical Approach

- Simple REST endpoint, no AI involved — just stores feedback in `ai_feedback` table
- Foreign key to `event_history(id)` links feedback to originating AI action
- Unique constraint ensures one rating per user per item (idempotent)
- Agentic retry is the only "smart" behavior — triggers a Celery task requeue on thumbs-down
- Reusable frontend component: one `<AIFeedback />` used in 4 different contexts

**Key Files:**
```
backend/api/
├── feedback/
│   ├── router.py          # POST /v1/ai/feedback
│   └── schemas.py         # Pydantic models
web/src/
├── components/ai/
│   └── ai-feedback.tsx    # Reusable 👍👎 component
├── hooks/
│   └── use-ai-feedback.ts # Shared mutation hook
```

## Decisions & Notes

- **Centralized, not per-feature.** One endpoint, one component. All AI features use same pattern.
- **event_id is the key.** Every AI response includes event_id from `log_ai_event()`. Feedback links back via this ID.
- **Optional comment on thumbs-down.** Helps understand why AI was wrong. Not required.
- **Idempotent.** Same user rating same item → updates, doesn't create duplicate.
- **Agentic retry on thumbs-down.** Only for PhotoScope line items (ai_photo_analysis events). Triggers re-analysis of that photo with feedback context.

### Eng Review Decisions (2026-04-08)

- **Unique constraint on (event_id, item_id, user_id).** Prevents duplicate ratings. Update on conflict.
- **Retry trigger is backend-only.** Frontend doesn't need to know about Celery. Backend checks event_type and enqueues retry if applicable.
- **Max 2 retries per photo.** Count previous `ai_photo_analysis_retry` events in event_history before triggering.

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

---

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1 (Backend — ai_feedback table + POST /v1/ai/feedback endpoint)
```
