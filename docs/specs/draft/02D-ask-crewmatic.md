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
- [ ] `POST /v1/jobs/{job_id}/ask` — context-aware AI responds to questions on any job screen
- [ ] AI has access to the ENTIRE job (photos, scope, readings, rooms, floor plan — not just current screen)
- [ ] Suggested actions rendered as tappable chips (add line item, navigate, explain)
- [ ] Screen context auto-detected from current route (used for prioritizing context, not limiting it)
- [ ] Conversation history maintained per job session
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors have questions while working a job — "What Xactimate code do I use for this?", "Is this reading normal?", "What am I missing?" — but no in-context help exists.

**Solution:** Ask Crewmatic — a floating AI chat available on every job screen. It's like texting an expert who knows everything about THIS specific job. Has access to all job data (photos, scope, readings, rooms, floor plan) and provides actionable answers with suggested next steps.

## Phases & Checklist

### Phase 1: Backend — ❌
- [ ] Create `api/ai/assistant.py` — Ask Crewmatic pipeline
- [ ] `POST /v1/jobs/{job_id}/ask` — context-aware AI chat
- [ ] Request schema: `AskRequest { message: str, screen_context: Literal['photos','floor_plan','scope','readings','report','general'], conversation_id: UUID | None }`
- [ ] Response schema: `AskResponse { reply: str, suggested_actions: list[SuggestedAction], event_id: UUID, conversation_id: UUID, cost_cents: int, duration_ms: int }`
- [ ] `SuggestedAction` = `AddLineItemAction | NavigateAction | ExplainAction`
- [ ] **Full job context:** Always loads the entire job context (all rooms, photos, line items, readings, equipment). `screen_context` tells the AI what the user is currently looking at, but it has access to everything.
- [ ] **Conversation history:** Maintain chat history per job session via `conversation_id`. First message creates a new conversation; subsequent messages include the ID to continue.
- [ ] Uses `log_ai_event()` — returns `event_id` in response
- [ ] Uses shared AI service layer from Spec 02A
- [ ] pytest: assistant returns valid response for each screen_context
- [ ] pytest: conversation history is maintained across messages
- [ ] pytest: suggested_actions are valid types

### Phase 2: Frontend — ❌
- [ ] Floating Action Button (FAB) labeled "Ask" on all job screens — opens chat panel
- [ ] Chat-style UI: user message → streamed AI reply with suggested actions
- [ ] Suggested actions rendered as tappable chips/buttons
- [ ] Screen context auto-detected from current route
- [ ] Conversation persists while navigating between job tabs (same conversation_id)
- [ ] Thumbs up/down on responses (uses Spec 02E feedback endpoint)

## Technical Approach

- Reuses shared AI service layer from Spec 02A
- Model: Sonnet 4 for chat (needs reasoning + full job context)
- **No thinking stream** — conversational, just stream the text reply
- Separate prompt template in `backend/api/ai/prompts/assistant.py`
- Full job context loaded on every request (not just current screen data)
- `screen_context` included in system prompt so AI knows what the user is looking at

**Key Files:**
- `backend/api/ai/assistant.py` — Ask Crewmatic pipeline
- `backend/api/ai/prompts/assistant.py` — chat prompt template
- `backend/api/assistant/router.py`, `service.py`, `schemas.py` — chat endpoints
- `web/src/components/assistant/assistant-fab.tsx` — floating action button
- `web/src/components/assistant/assistant-panel.tsx` — slide-up chat panel
- `web/src/components/assistant/action-chip.tsx` — suggested action chip

## Decisions & Notes

- **Full job access, always.** The AI loads the entire job context every time — not just the current screen's data. `screen_context` tells it what the user is looking at, but it can reference anything in the job.
- **Conversation history per job session.** Chat isn't stateless — messages build on each other. "What about the kitchen?" makes sense after "Which rooms have the worst damage?"
- **Three-layer frontend pattern:** Primary action button per screen, secondary toolbar actions, and Ask Crewmatic FAB available on all screens.
- **Model selection:** Sonnet 4 for chat (complex reasoning about restoration domain).
- **No thinking stream:** Unlike PhotoScope/HazmatCheck/Job Audit, this is conversational — just stream the reply text. No need for narrated analysis.

### Design Review Decisions (2026-04-07)

- **Mobile: bottom sheet (60% height).** Slides up from bottom. Job content visible above, dimmed. Input pinned to bottom of sheet.
- **Desktop: side panel.** Right side, ~360px wide. Job content stays fully visible on the left.
- **Built independently (Phase 3).** Not coupled to Photos tab workspace. Can ship anytime after shared AI layer exists.
- **Empty state with suggested questions:** First open shows "Ask me anything about this job" + 3 contextual question chips based on screen_context (e.g., on Photos tab: "What damage do you see?", "What code for baseboard removal?", "Is this reading normal?").

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|
