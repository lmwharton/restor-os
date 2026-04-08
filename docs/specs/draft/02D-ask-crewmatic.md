# Ask Crewmatic — Context-Aware AI Chat on Any Job Screen

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/3 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 02A Phase 1 (shared AI service layer) |
| **Branch** | TBD |
| **Issue** | TBD |
| **Implementation Phase** | Phase 3 (independent, after shared AI layer exists) |

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
- [ ] Screen context auto-detected from current route (used for prioritizing, not limiting)
- [ ] Conversation history maintained per job session
- [ ] Streamed text response (no thinking stream — conversational)
- [ ] Mobile: bottom sheet (60% height). Desktop: side panel (~360px).
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors have questions while working a job — "What Xactimate code do I use for this?", "Is this reading normal?", "What am I missing?" — but no in-context help exists.

**Solution:** Ask Crewmatic — a floating AI chat available on every job screen. It's like texting an expert who knows everything about THIS specific job. Has access to all job data (photos, scope, readings, rooms, floor plan) and provides actionable answers with suggested next steps.

## Phases & Checklist

### Phase 1: Backend — ❌

**Prompt + tools:**
- [ ] Create `api/ai/prompts/assistant.py` — Ask Crewmatic system prompt
  - [ ] Persona: experienced restoration expert who knows this specific job
  - [ ] Include full job context in system prompt (all rooms, line items, readings, equipment, photos metadata)
  - [ ] `screen_context` tells AI what the contractor is currently looking at (for better answers)
  - [ ] Restoration domain knowledge: S500 references, Xactimate codes, equipment usage, adjuster tips
  - [ ] Keep responses concise and actionable (field use, small screen)
- [ ] Create `api/ai/tools/assistant.py` — suggested action tool schemas
  - [ ] `AddLineItemAction { xactimate_code, description, unit, quantity, room }`
  - [ ] `NavigateAction { screen, target_id? }`
  - [ ] `ExplainAction { topic, reference }`

**API routes (`api/assistant/router.py`):**
- [ ] `POST /v1/jobs/{job_id}/ask` — context-aware AI chat
  - [ ] Request: `AskRequest { message: str, screen_context: Literal['photos','floor_plan','scope','readings','report','general'], conversation_id: UUID | None }`
  - [ ] Response: SSE stream of text + final JSON with `{ reply, suggested_actions, event_id, conversation_id, cost_cents, duration_ms }`
  - [ ] **No Celery needed** — responses are fast (~2-5 seconds), not 15-30 seconds like photo analysis. Direct SSE from FastAPI.
  - [ ] First message with `conversation_id: null` → creates new conversation, returns `conversation_id`
  - [ ] Subsequent messages with `conversation_id` → appends to chat history
- [ ] Auth: validate user belongs to job's company

**Service layer (`api/assistant/service.py`):**
- [ ] Load full job context from DB: rooms, photos (metadata only), line items, readings, equipment, hazmat findings
- [ ] Build system prompt with job context + screen_context
- [ ] Maintain conversation history in Redis (`ask:{job_id}:{conversation_id}:messages`)
  - [ ] TTL: 2 hours (conversations expire after inactivity)
  - [ ] Store as list of `{ role, content }` messages
- [ ] Call Claude with `AI_CONFIGS["assistant"]` (no thinking, stream text)
- [ ] Parse suggested actions from tool-use results
- [ ] `log_ai_event()` for each message (cost tracking)
- [ ] Execute suggested actions when contractor taps them:
  - AddLineItem → call scope CRUD from 02A
  - Navigate → frontend handles (just return the route)

**Schemas (`api/assistant/schemas.py`):**
- [ ] `AskRequest { message, screen_context, conversation_id }`
- [ ] `AskResponse { reply, suggested_actions, event_id, conversation_id, cost_cents, duration_ms }`
- [ ] `SuggestedAction` = discriminated union of action types

**Mount router:**
- [ ] Add `assistant_router` to `api/main.py` with `prefix="/v1"`

**Tests:**
- [ ] pytest: `test_assistant_service.py` — returns valid response for each screen_context
- [ ] pytest: `test_assistant_service.py` — conversation history maintained across messages
- [ ] pytest: `test_assistant_service.py` — suggested_actions are valid types
- [ ] pytest: `test_assistant_service.py` — full job context loaded (not just current screen)
- [ ] pytest: `test_assistant_router.py` — auth: rejects requests for jobs not in user's company
- [ ] pytest: `test_assistant_router.py` — SSE stream delivers text + final JSON

### Phase 2: Frontend — FAB + Chat Panel — ❌

**Floating Action Button (FAB):**
- [ ] Positioned bottom-right on all job screens
- [ ] Label: "Ask" with chat icon
- [ ] 56px circle, orange (#e85d26) background, white icon
- [ ] Z-index above all content
- [ ] Tap → opens chat panel

**Chat panel (mobile: bottom sheet):**
- [ ] Slides up from bottom, 60% viewport height
- [ ] Job content visible above, dimmed backdrop
- [ ] Header: "Ask Crewmatic" + close ✕
- [ ] Message area: scrollable chat bubbles
  - User messages: right-aligned, orange bg (#fff3ed)
  - AI replies: left-aligned, white bg with border (#eae6e1)
- [ ] Suggested actions: tappable chips below AI reply
  - Chip style: border #eae6e1, text #1a1a1a, rounded-lg
  - Tap chip → executes action (add line item, navigate, etc.)
- [ ] Input area: pinned to bottom of sheet
  - Full-width text input, 48px height
  - Send button (orange)
  - 16px min font size (prevents iOS zoom)
- [ ] Keyboard: sheet adjusts height when keyboard opens

**Chat panel (desktop: side panel):**
- [ ] Right side, ~360px wide, full height
- [ ] Job content stays fully visible on the left (no dimming)
- [ ] Same message layout and input as mobile

**Empty state (first open):**
- [ ] "Ask me anything about this job"
- [ ] 3 contextual question chips based on screen_context:
  - Photos tab: "What damage do you see?", "What code for baseboard removal?", "Is this reading normal?"
  - Scope tab: "What am I missing?", "Is this scope complete?", "Explain this line item"
  - Report tab: "Is this ready for the adjuster?", "What's my total?", "Any compliance issues?"
- [ ] Chips trigger the question as if the user typed it

**Conversation persistence:**
- [ ] Conversation persists while navigating between job tabs (same conversation_id)
- [ ] New job → new conversation
- [ ] Closing panel and reopening → same conversation (until TTL expires)

**Streaming:**
- [ ] AI reply streams text token by token (SSE from `/ask` endpoint)
- [ ] "Typing..." indicator while streaming
- [ ] Suggested actions appear after stream completes

**Feedback:**
- [ ] 👍👎 on each AI reply (shared AI Feedback component from 02E)

**Hooks:**
- [ ] `use-ask-crewmatic.ts` — `useAskCrewmatic(jobId)` mutation + SSE stream handler
- [ ] Manages conversation_id state, message history in React state

### Phase 3: Tests — ❌
- [ ] E2E: open FAB → type question → get streamed answer with action chips
- [ ] E2E: tap action chip → action executes (line item added, or navigated)
- [ ] E2E: conversation history across messages
- [ ] E2E: navigate between tabs → conversation persists
- [ ] Verify suggested question chips contextual to current screen
- [ ] Verify mobile bottom sheet behavior (keyboard, scroll)

## Technical Approach

- Reuses shared AI layer from Spec 02A (client, config, events)
- **No Celery needed.** Responses are fast (~2-5 seconds). Direct SSE from FastAPI endpoint.
- Model: Sonnet 4 (`AI_CONFIGS["assistant"]`) — no thinking, stream text
- Conversation history in Redis (2-hour TTL)
- Full job context on every request (not just current screen)

**Key Files:**
```
backend/api/
├── ai/prompts/assistant.py    # Ask Crewmatic prompt
├── ai/tools/assistant.py      # Suggested action schemas
├── assistant/
│   ├── router.py              # POST /v1/jobs/{id}/ask (SSE)
│   ├── service.py             # Context loading + Claude call
│   └── schemas.py             # Pydantic models
web/src/
├── components/assistant/
│   ├── assistant-fab.tsx       # Floating action button
│   ├── assistant-panel.tsx     # Bottom sheet (mobile) / side panel (desktop)
│   ├── chat-message.tsx        # User/AI message bubble
│   └── action-chip.tsx         # Suggested action chip
├── hooks/
│   └── use-ask-crewmatic.ts   # Mutation + SSE + conversation state
```

## Decisions & Notes

- **Full job access, always.** Loads entire job context. screen_context is for prioritizing, not limiting.
- **Conversation history per job session.** Messages build on each other. Redis with 2-hour TTL.
- **Model selection:** Sonnet 4 for chat (complex reasoning about restoration domain).
- **No thinking stream:** Conversational — just stream the reply text.
- **No Celery:** Fast responses (~2-5s), direct SSE is sufficient.

### Design Review Decisions (2026-04-07)

- **Mobile: bottom sheet (60% height).** Content visible above, dimmed.
- **Desktop: side panel (~360px).** Content stays fully visible.
- **Phase 3 implementation.** Independent, ships after shared AI layer.
- **Empty state with suggested questions.** Contextual to current screen.

### Eng Review Decisions (2026-04-08)

- **No Celery needed.** Direct SSE from FastAPI. Responses are 2-5 seconds, not 15-30.
- **Conversation history in Redis.** `ask:{job_id}:{conversation_id}:messages`. 2-hour TTL.
- **Reuses scope CRUD.** AddLineItem action calls existing 02A endpoints.

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|
