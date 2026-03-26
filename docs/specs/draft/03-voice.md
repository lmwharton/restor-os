# Voice Everywhere — Deepgram + Claude Across All Forms

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/3 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 02 (AI Pipeline) must be complete |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-26 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] User can create a job by speaking (voice-to-form fills all fields progressively)
- [ ] User can speak room setup info (name, dimensions, category, class, equipment)
- [ ] User can speak moisture readings (temperature, humidity, point readings)
- [ ] User can dictate tech field notes via voice
- [ ] Voice corrections work naturally ("I'm sorry, the loss source is a dishwasher leak")
- [ ] Hold-to-speak and tap-for-continuous modes both work
- [ ] Live transcript visible as user speaks (~300ms latency)
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors are on job sites with dirty/wet gloves, holding tools, in noisy environments. Typing on a phone is slow and painful. Brett's #1 request: "I should just be speaking to it and not type."

**Solution:** Voice input overlay across all forms in the app. Deepgram Nova-2 handles real-time speech-to-text. Claude extracts structured fields from natural speech. Contractors speak naturally in any order — AI maps to the right fields.

**Scope:**
- IN: Deepgram streaming integration, Claude field extraction endpoint, reusable voice component, voice-to-form (job creation, room setup, moisture readings), voice-to-text (tech field notes), progressive field filling, corrections, hold-to-speak + continuous modes
- OUT: Voice scoping for line item generation (future), voice commands for navigation

## Phases & Checklist

### Phase 1: Voice Infrastructure — ❌
**Backend:**
- [ ] Create `api/voice/router.py` — route handlers
- [ ] Create `api/voice/service.py` — voice processing logic
- [ ] `POST /v1/voice/extract-fields` — accepts transcript + context (which form/fields), returns structured field JSON via Claude
- [ ] Claude prompt: "Extract structured data from this spoken transcript. The user is filling out [form context]. Return JSON with field names and values. If the speaker corrects themselves, use the corrected value."
- [ ] Deepgram API key management (env var)
- [ ] pytest: field extraction from sample transcripts
- [ ] pytest: corrections handled ("I mean dishwasher leak not washer leak")

**Frontend:**
- [ ] Create `web/src/components/voice/VoiceInput.tsx` — reusable voice input component
- [ ] Deepgram Nova-2 streaming integration (WebSocket from browser → Deepgram cloud → transcripts back)
- [ ] "Hold to Speak" button (press-and-hold for push-to-talk)
- [ ] "Tap Mic for Continuous" mode (tap to start, tap to stop)
- [ ] Live transcript display below the button (shows words as spoken, ~300ms latency)
- [ ] Progress indicator: "Got 1 field — keep talking" style feedback
- [ ] Field validation indicators: green checkmark when field is filled, orange warning triangle for uncertain values
- [ ] Microphone permission handling (request on first use, explain why)

### Phase 2: Voice-to-Form Integration — ❌
**Job creation:**
- [ ] Voice button on create job form
- [ ] Speak customer info: "customer name Jane Doe, phone 586-555-9600, email janedoe@yahoo.com"
- [ ] Speak address: "her address is 27851 Gilbert Drive, Warren Michigan 48093"
- [ ] Speak loss info: "loss source is dishwasher leak, cat 1, class 2, date of loss March 13th"
- [ ] Speak insurance: "insurance carrier State Farm, claim number 9742.34, adjuster Alex Garnapudi"
- [ ] Progressive field filling: fields update as user speaks (on Deepgram utterance-end events)
- [ ] Corrections: "I'm sorry, the loss source is a dishwasher leak" → updates previous value
- [ ] LLM sees full accumulated transcript, not just latest chunk → corrections work naturally

**Room setup:**
- [ ] "Speak Room Names" button → speak room names sequentially, auto-create room records
- [ ] Speak per-room: "Master bedroom, 10.5 by 15 feet, cat 2, class 1, 3 air movers, 1 dehu"
- [ ] Each room's "Speak" button → voice input for that room's fields

**Moisture readings:**
- [ ] Per-day "Speak" button → "temperature 72, humidity 45, basement reading 100, kitchen wall 150"
- [ ] AI extracts atmospheric + point readings from natural speech

### Phase 3: Voice-to-Text (Tech Field Notes) — ❌
- [ ] Speak button on tech field notes → continuous transcription mode → fills text area directly
- [ ] "Listening — describe what was done today..." indicator
- [ ] Stop button ends recording, transcript becomes the note text
- [ ] No LLM extraction needed — pure Deepgram transcription into text field
- [ ] Works on job-level tech notes and per-room notes

## Technical Approach

```
┌─────────────┐     audio chunks      ┌──────────────┐
│  Browser Mic │ ──────────────────►   │  Deepgram    │
│  (MediaStream)│                      │  Nova-2      │
└─────────────┘                        │  WebSocket   │
                                       └──────┬───────┘
                                              │ interim + final transcripts
                                              ▼
                                     ┌────────────────┐
                                     │  Frontend      │
                                     │  - Show live   │
                                     │    transcript  │
                                     │  - On utterance│
                                     │    end: call   │──► Claude API (field extraction)
                                     │    backend     │◄── { structured fields JSON }
                                     │  - Merge into  │
                                     │    form state  │
                                     └────────────────┘
```

- **Deepgram Nova-2** for STT — ~300ms latency, best quality for noisy job sites, handles construction noise and accents
- **Claude** for field extraction — parses natural speech into structured form data
- **Cost per job creation:** ~$0.01 (30s speech = ~$0.002 Deepgram + ~$0.003 Claude x 3-4 calls)
- **Tech field notes:** Deepgram only (pure transcription, no LLM extraction needed)
- **Two input modes:** Hold-to-speak (push-to-talk for noisy sites) + Tap for continuous (hands-free)

**Key Files:**
- `backend/api/voice/router.py`, `service.py` — voice field extraction endpoint
- `web/src/components/voice/VoiceInput.tsx` — reusable voice component
- `web/src/components/voice/useDeepgram.ts` — Deepgram WebSocket hook

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, Voice Infrastructure
# Prerequisite: Spec 02 (AI Pipeline) must be complete
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Voice-first is the killer feature.** Brett: "I should just be speaking to it and not type." Contractors are on job sites with wet/dirty gloves.
- **Deepgram Nova-2:** Best quality STT for noisy environments. ~$0.0043/min. Streaming via WebSocket with interim + final transcripts.
- **Free-form speech, not guided form.** Brett's feedback: guided form approach was "hard to track, hard to recover if you get off track." Solution: speak naturally in any order, AI extracts and maps to correct fields. See `docs/research/brett-prototype-sessions.md`.
- **Two modes:** Hold-to-speak (push-to-talk for noisy sites) + Tap for continuous (hands-free when quiet).
- **Corrections work naturally:** LLM sees full accumulated transcript. "I'm sorry, the loss source is a dishwasher leak" overrides previous "washer leak."
- **Voice-to-text vs voice-to-form:** Tech field notes use pure transcription (Deepgram only, no LLM). Structured forms use Deepgram + Claude extraction.
- **Spec ships after AI Pipeline (Spec 02)** because voice is the input method enhancement, not the core product. Manual input works for everything first.
