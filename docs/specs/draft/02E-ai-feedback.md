# AI Feedback — Centralized Thumbs Up/Down for All AI Features

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/2 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 02A (event_history + log_ai_event pattern) |
| **Branch** | TBD |
| **Issue** | TBD |

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
- [ ] Reusable thumbs up/down component used across all AI features
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** AI accuracy improves with feedback, but each AI feature (scope, hazmat, auditor, assistant) shouldn't have its own feedback mechanism. Need one centralized endpoint.

**Solution:** Single `POST /v1/ai/feedback` endpoint that accepts thumbs up/down for any AI-generated item, linked via `event_id`. One reusable frontend component.

## Phases & Checklist

### Phase 1: Backend — ❌
- [ ] Create `api/ai/feedback.py` — centralized AI feedback handler
- [ ] `POST /v1/ai/feedback` — submit feedback for any AI feature
- [ ] Request schema: `AIFeedbackRequest { event_id: UUID, item_id: str | None, rating: Literal['up','down'], comment: str | None }`
- [ ] **Storage:** Add `ai_feedback` table:
  ```sql
  CREATE TABLE ai_feedback (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id    UUID NOT NULL REFERENCES event_history(id) ON DELETE CASCADE,
      company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id     UUID NOT NULL REFERENCES profiles(id),
      item_id     TEXT,           -- e.g., line item index within the event
      rating      TEXT NOT NULL,  -- 'up' | 'down'
      comment     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- [ ] Alembic migration: create ai_feedback table
- [ ] Validates `event_id` belongs to the requesting user's company
- [ ] Validates the referenced event has `is_ai=true`
- [ ] Stores feedback linked to the original AI event
- [ ] pytest: feedback accepted for valid event_id
- [ ] pytest: feedback rejected for event_id from another company
- [ ] pytest: feedback rejected for non-AI events

### Phase 2: Frontend — ❌
- [ ] Thumbs up/down component reused across all AI features (PhotoScope, HazmatCheck, Job Audit, Ask Crewmatic)
- [ ] Optional comment field on thumbs-down
- [ ] All feedback calls go through single `POST /v1/ai/feedback` endpoint
- [ ] Visual states: idle → selected (up/down highlighted) → submitted

## Technical Approach

- Simple endpoint, no AI involved — just stores feedback in `ai_feedback` table
- Foreign key to `event_history(id)` links feedback to the originating AI action
- Reusable `<AIFeedback eventId={id} itemId={idx} />` component

**Key Files:**
- `backend/api/ai/feedback.py` — feedback handler
- `backend/api/feedback/router.py`, `schemas.py` — feedback endpoint
- `web/src/components/ai/ai-feedback.tsx` — reusable thumbs up/down component

## Decisions & Notes

- **Centralized, not per-feature:** One endpoint, one component. All AI features use the same pattern.
- **event_id is the key:** Every AI response includes an event_id from `log_ai_event()`. Feedback links back via this ID.
- **Optional comment on thumbs-down:** Helps understand why the AI was wrong. Not required.
- **This is a ~1 day build.** Small but foundational — every other AI spec depends on it for feedback.

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|
