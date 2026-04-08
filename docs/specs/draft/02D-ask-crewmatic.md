# Ask Crewmatic — Context-Aware AI Chat on Any Job Screen

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/2 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 02A (shared AI service layer) |
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
- [ ] `POST /v1/jobs/{job_id}/assistant` — context-aware AI assistant responds to questions on any job screen
- [ ] Suggested actions rendered as tappable chips (add line item, navigate, explain)
- [ ] Screen context auto-detected from current route
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors have questions while working a job — "What Xactimate code do I use for this?", "Is this reading normal?", "What am I missing?" — but no in-context help exists.

**Solution:** Job Assistant — a floating AI chat available on every job screen. Knows the current job context (photos, scope, readings) and provides actionable answers with suggested next steps.

## Phases & Checklist

### Phase 1: Backend — ❌
- [ ] Create `api/ai/assistant.py` — job assistant pipeline
- [ ] `POST /v1/jobs/{job_id}/assistant` — context-aware AI assistant
- [ ] Request schema: `AssistantRequest { message: str, screen_context: Literal['photos','floor_plan','scope','readings','general'], target_id: UUID | None }`
- [ ] Response schema: `AssistantResponse { reply: str, suggested_actions: list[SuggestedAction], event_id: UUID, cost_cents: int, duration_ms: int }`
- [ ] `SuggestedAction` = `AddLineItemAction | EditSketchAction | NavigateAction | ExplainAction`
- [ ] Context-aware: fetches relevant job data based on `screen_context` (e.g., scope screen → loads line items; photos screen → loads photo metadata)
- [ ] Validates `target_id` exists and belongs to the job when provided
- [ ] Uses `log_ai_event()` — returns `event_id` in response
- [ ] Uses shared AI service layer from Spec 02A
- [ ] pytest: assistant returns valid response for each screen_context
- [ ] pytest: target_id validation rejects invalid IDs
- [ ] pytest: suggested_actions match expected types per screen_context

### Phase 2: Frontend — ❌
- [ ] Floating Action Button (FAB) on all job screens — opens Job Assistant panel
- [ ] Chat-style UI: user message → assistant reply with suggested actions
- [ ] Suggested actions rendered as tappable chips/buttons
- [ ] Screen context auto-detected from current route
- [ ] Thumbs up/down on assistant responses (uses Spec 02E feedback endpoint)

## Technical Approach

- Reuses shared AI service layer from Spec 02A
- Model: Sonnet 4 for assistant (needs reasoning + job context)
- Separate prompt template in `backend/api/ai/prompts/assistant.py`
- Context loading is dynamic based on screen_context parameter

**Key Files:**
- `backend/api/ai/assistant.py` — job assistant pipeline
- `backend/api/ai/prompts/assistant.py` — assistant prompt template
- `web/src/components/job-assistant.tsx` — FAB + chat UI

## Decisions & Notes

- **Three-layer frontend pattern:** Primary action button per screen, secondary toolbar actions, and Job Assistant FAB available on all screens.
- **Context-aware:** Loads different job data depending on which screen the user is on. Scope screen loads line items, photos screen loads photo metadata, etc.
- **Model selection:** Sonnet 4 for assistant (complex reasoning about restoration domain).
- **Haiku 3.5 for lightweight tasks:** Photo quality assessment, simple classification — use Haiku where Sonnet is overkill.

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|
