# Voice Everywhere — Deepgram + Claude Across All Forms

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 phases) |
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
- [ ] Voice Walkthrough mode produces structured site report with per-room damage classification
- [ ] Walkthrough report auto-maps observations to Xactimate line items with S500 justifications
- [ ] Walkthrough report exportable as insurance-ready PDF
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors are on job sites with dirty/wet gloves, holding tools, in noisy environments. Typing on a phone is slow and painful. Brett's #1 request: "I should just be speaking to it and not type."

**Solution:** Voice input overlay across all forms in the app. Deepgram Nova-2 handles real-time speech-to-text. Claude extracts structured fields from natural speech. Contractors speak naturally in any order — AI maps to the right fields.

**Scope:**
- IN: Deepgram streaming integration, Claude field extraction endpoint, reusable voice component, voice-to-form (job creation, room setup, moisture readings), voice-to-text (tech field notes), progressive field filling, corrections, hold-to-speak + continuous modes
- OUT: Voice scoping for line item generation (future), voice commands for navigation

## Information Architecture (Design Review)

### Voice Access Points
Every form with voice input gets a mic icon button in the form header. Tapping it opens the shared Voice Input bottom sheet overlay.

```
FORM SCREENS WITH VOICE INPUT:
┌─────────────────────────────────────────────────────────────────┐
│  1. Job Creation    → [mic] in form header                      │
│  2. Room Setup      → [mic] per room card                       │
│  3. Moisture Log    → [mic] per day entry                       │
│  4. Tech Field Notes→ [mic] opens pure transcription mode       │
└─────────────────────────────────────────────────────────────────┘

SHARED VOICE INPUT BOTTOM SHEET (slides up from bottom, 55% height):
┌─────────────────────────────────────────────────────────────────┐
│  [Hold to Speak]  [Tap Continuous]  ← mode toggle pills         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ live transcript text appears here as user speaks...       │  │
│  └───────────────────────────────────────────────────────────┘  │
│  "Got 2 fields — keep talking"  ← progress indicator            │
│                  (( 🎤 ))       ← 80px mic, orange gradient     │
│                "Listening..."                                    │
│  [Done — Review Fields]         ← full-width orange button      │
└─────────────────────────────────────────────────────────────────┘
```

### Walkthrough Mode Access
Walkthrough button is a **56px FAB** (floating action button) in the bottom-right of the job detail page, above the mobile bottom nav. Orange gradient, mic+camera icon. This is the signature CompanyCam-killer gesture.

```
JOB DETAIL PAGE                    WALKTHROUGH MODE (full screen)
┌────────────────────────┐        ┌──────────────────────────────┐
│ 123 Main St            │        │ ← Walkthrough    ● 03:24    X│
│ Scope|Photos|Rooms|Log │        │ ┌────────────────────────────┐│
│                        │  tap   │ │   Camera viewfinder        ││
│   [tab content]        │ ────►  │ │              [📷]          ││
│                        │  FAB   │ └────────────────────────────┘│
│                   [🎤] │        │ ┌────────────────────────────┐│
│ ─── bottom nav ─────── │        │ │ MASTER BEDROOM             ││
└────────────────────────┘        │ │ "Water damage along base..." │
                                  │ │ [photo] [photo]            ││
                                  │ └────────────────────────────┘│
                                  │ ● REC   [Finish & Generate]  │
                                  └──────────────────────────────┘
                                              │ finish
                                              ▼
                                  ┌──────────────────────────────┐
                                  │ WALKTHROUGH REPORT PREVIEW    │
                                  │ Room-by-room assessment       │
                                  │ [Edit] [Export PDF] [Share]   │
                                  └──────────────────────────────┘
```

### Visual Hierarchy per Screen
- **Voice bottom sheet:** Mode toggle → transcript → progress → mic button → done. Mic is the visual anchor.
- **Walkthrough recording:** Camera viewfinder (primary) → transcript scroll (secondary) → controls (tertiary).
- **Walkthrough report:** Room-by-room cards → line items per room → actions (edit/export/share).

## Interaction States (Design Review)

| Feature | Loading | Empty | Error | Success | Partial |
|---------|---------|-------|-------|---------|---------|
| **Mic permission** | Browser permission prompt visible | N/A | Inline card: "Microphone Access Needed" with explanation, [Open Settings] + [Type Instead] buttons. Orange info style, not red. | Permission granted → mic button activates | N/A |
| **Voice bottom sheet** | Sheet slides up (200ms ease-out) | Transcript area shows placeholder: "Tap the mic and start speaking..." | See error states below | All fields filled → green checkmarks, "All fields captured!" message | Some fields filled, others waiting. Show green checks on filled, empty on remaining. |
| **Deepgram connection** | "Connecting..." spinner in transcript area (max 3s) | N/A | "Voice unavailable — check your connection" + [Retry] + [Type Instead]. Amber warning style. | Connected → listening state with pulsing rings | N/A |
| **STT transcription** | Interim words appear in lighter gray as Deepgram processes | "Listening..." below mic button | "Couldn't hear that — try again or move to a quieter spot" after 10s silence | Final transcript in full #1a1a1a color | Words appearing word-by-word (~300ms) |
| **Field extraction** | "Processing..." shimmer animation on form fields being extracted | N/A | "Couldn't extract [field] — please say it again" in transcript area | Field fills with value + green checkmark + brief highlight flash (200ms) | Some fields extracted, "Got 3 of 5 fields — keep talking" progress |
| **Voice walkthrough** | "Starting walkthrough..." with camera permission request | N/A | Camera denied: same inline card pattern as mic. Network lost mid-walkthrough: auto-save transcript locally, show "Offline — recording saved, will process when connected" | Report generated → preview screen | Mid-recording: timer + photo count visible at all times |
| **Walkthrough report** | "Generating report..." skeleton cards per room (shows room count from transcript) | N/A | "Report generation failed — [Retry] or [Export Raw Transcript]" | Full room-by-room report with line items | Report with some rooms complete, others show "Processing..." |

### Animation & Micro-interaction Specs
- **Field fill:** 200ms green (#2a9d5c) border flash → value slides in from left (150ms) → green checkmark fades in right side. Then border returns to normal #eae6e1.
- **Field correction:** Existing value gets a brief amber (#d97706) flash → old value slides out → new value slides in → green checkmark stays.
- **Bottom sheet open:** 200ms ease-out slide up from bottom + backdrop fade (matches existing voice-note-modal pattern).
- **Mic button pulsing:** Three concentric rings expand outward (2s infinite, staggered 0.4s). Mic button breathes (1.5s scale 1→1.06→1). Already implemented in voice-note-modal.tsx.
- **Transcript words:** Interim words appear in #8a847e (caption gray), finalize to #1a1a1a (primary text) on Deepgram final event.

### First-Time Voice Experience
On first use of voice in any form:
1. Bottom sheet opens with mic button in idle state (no pulsing)
2. Below mic: "Tap the mic and speak naturally. Say things like 'customer name Jane Doe, phone 586-555-9600'" — contextual example per form type
3. After first successful field extraction: brief "Nice! Keep going." celebration text in green, then fades
4. After first complete form via voice: "You just created a job by voice." toast with confetti-free celebration (simple green check animation)

Subsequent uses: skip onboarding, go straight to listening state.

### Error Recovery Principles
- **Never a dead end.** Every error has a [Retry] + a manual fallback ([Type Instead], [Export Raw]).
- **Offline resilience.** Voice walkthrough auto-saves transcript to localStorage. Field extraction retries when back online.
- **Calm, not alarming.** Errors use amber (#d97706) warning style, not red. Red is only for destructive actions.
- **Progressive degradation.** If Deepgram fails → offer to type. If Claude extraction fails → show raw transcript + let user manually fill fields.

## Phases & Checklist

### Phase 1: Voice Infrastructure — ❌
**Backend:**
- [ ] Create `api/voice/router.py` — route handlers
- [ ] Create `api/voice/service.py` — voice processing logic
- [ ] `POST /v1/voice/extract-fields` — accepts transcript + context (which form/fields), returns structured field JSON via Claude
- [ ] Claude prompt for field extraction (see prompt spec below)

**Claude Field Extraction Prompt Spec:**
```
System: You extract structured data from spoken transcripts for a water restoration
contractor app. The user speaks naturally in any order. Return ONLY the fields you
can confidently extract. If the speaker corrects themselves ("I mean X not Y"), use
the corrected value. For ambiguous values, prefer the domain-specific interpretation
(e.g., "cat 1" = water_category "1", "class 2" = water_class "2").

Context: {form_type} form with fields: {field_definitions}

Rules:
- Return JSON: { "fields": { "field_name": "value", ... }, "uncertain": ["field_name"] }
- Only include fields you're confident about. Put uncertain ones in the "uncertain" array.
- Parse dates naturally ("March 13th" → "2026-03-13", "yesterday" → relative to today)
- Parse phone numbers to digits ("five eight six five five five nine six hundred" → "5865559600")
- Parse addresses to structured parts (street, city, state, zip)
- "cat 1" / "category 1" / "category one" all → water_category: "1"
- "class 2" / "class two" all → water_class: "2"

Field definitions per form type (MUST match actual backend schema field names):
- job_creation: customer_name, customer_phone, customer_email, address_line1,
  city, state, zip, loss_type, loss_cause, loss_category, loss_class, loss_date,
  carrier, claim_number, adjuster_name, adjuster_phone, adjuster_email
- room_setup: room_name, length_ft, width_ft, height_ft, water_category,
  water_class, equipment_air_movers, equipment_dehus, notes
- moisture_reading: temperature_f, relative_humidity_pct, point_readings (array of
  { location: string, value: number })

IMPORTANT: The prompt returns field names that match the backend Pydantic schemas
exactly. Common speech-to-schema mappings:
- "phone" / "phone number" → customer_phone
- "category" / "cat" → loss_category (job) or water_category (room)
- "class" → loss_class (job) or water_class (room)
- "loss source" / "cause" → loss_cause
- "date of loss" → loss_date
- "insurance carrier" / "insurance company" → carrier
- "humidity" → relative_humidity_pct
```
- [ ] Deepgram API key management (env var)
- [ ] pytest: `test_voice.py` — full test suite:
  - [ ] `test_token_returns_temp_key` — GET /v1/voice/token returns valid temp Deepgram key
  - [ ] `test_token_requires_auth` — GET /v1/voice/token without JWT → 401
  - [ ] `test_extract_job_creation_happy_path` — transcript "customer name Jane Doe phone 586-555-9600" → { customer_name: "Jane Doe", customer_phone: "5865559600" }
  - [ ] `test_extract_corrections` — transcript "washer leak... I mean dishwasher leak" → loss_cause: "dishwasher leak" (uses corrected value)
  - [ ] `test_extract_domain_shorthand` — "cat 1 class 2" → water_category: "1", water_class: "2"
  - [ ] `test_extract_phone_words` — "five eight six five five five nine six hundred" → "5865559600"
  - [ ] `test_extract_date_natural` — "date of loss March 13th" → "2026-03-13"
  - [ ] `test_extract_address_structured` — "27851 Gilbert Drive Warren Michigan 48093" → structured address parts
  - [ ] `test_extract_empty_transcript` — empty string → empty fields
  - [ ] `test_extract_uncertain_fields` — ambiguous input → fields in "uncertain" array
  - [ ] `test_extract_room_setup` — "master bedroom 10 by 15 cat 2 class 1 3 air movers 1 dehu" → correct room fields
  - [ ] `test_extract_moisture_reading` — "temperature 72 humidity 45 basement reading 100" → structured readings
  - [ ] `test_extract_requires_auth` — POST without JWT → 401
  - [ ] `test_walkthrough_multi_room_parsing` — transcript with "moving to kitchen...moving to bedroom" → separate room entries
  - [ ] `test_walkthrough_photo_attachment` — photo_ids matched to correct rooms by context
  - [ ] `test_walkthrough_apply_atomic` — creates rooms + photos in one transaction
  - [ ] `test_walkthrough_apply_rollback` — partial failure → nothing saved
  - [ ] `test_walkthrough_apply_duplicate_rooms` — handles duplicate room names gracefully

**Frontend:**
- [ ] Create `web/src/components/voice/VoiceInput.tsx` — reusable voice input component
- [ ] Deepgram Nova-2 streaming integration (WebSocket from browser → Deepgram cloud → transcripts back)
- [ ] "Hold to Speak" button (press-and-hold for push-to-talk)
- [ ] "Tap Mic for Continuous" mode (tap to start, tap to stop)
- [ ] Live transcript display below the button (shows words as spoken, ~300ms latency)
- [ ] Progress indicator: "Got 1 field — keep talking" style feedback
- [ ] Field validation indicators: green checkmark when field is filled, orange warning triangle for uncertain values
- [ ] Microphone permission handling (request on first use, explain why)

**Frontend Tests (React Testing Library):**
- [ ] `VoiceInput.test.tsx`:
  - [ ] Renders in idle state with mic button and mode toggle
  - [ ] Mode toggle switches between hold-to-speak and continuous
  - [ ] Shows "Microphone Access Needed" card when permission denied
  - [ ] Displays live transcript text as it arrives
  - [ ] Shows progress indicator ("Got 2 fields") when fields extracted
  - [ ] Shows green checkmark on filled fields
  - [ ] Shows amber flash on correction
  - [ ] Auto-saves transcript to localStorage on unmount
  - [ ] Shows "Resume previous session?" when saved session exists
  - [ ] Calls extract endpoint with debounced timing (2s after last utterance)
- [ ] `MicButton.test.tsx`:
  - [ ] Renders idle state (no pulsing)
  - [ ] Renders active state (pulsing rings)
  - [ ] Accessible: aria-label toggles between "Start voice input" / "Stop listening"
  - [ ] Touch target is 80px (meets 48px minimum)
  - [ ] Respects prefers-reduced-motion (no animations)

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

### Phase 4: Voice Walkthrough Report — ❌
**The CompanyCam killer.** Walk the job site speaking + snapping photos → AI produces a structured site assessment, not just formatted text.

**Backend:**
- [ ] `POST /v1/voice/walkthrough` — accepts transcript + photo references, returns structured walkthrough report
- [ ] Claude prompt: combine voice transcript + photo context (room tags, GPS, timestamps) into a structured site assessment with per-room observations, damage classifications, and recommended line items
- [ ] Output schema: `{ rooms: [{ name, observations, damage_category, damage_class, photos, recommended_line_items[] }], summary, next_steps }`
- [ ] Link recommended line items to Xactimate codes (reuse Spec 02A PhotoScope mapping)
- [ ] Auto-attach S500/OSHA justifications to each recommended line item
- [ ] pytest: walkthrough transcript → structured report with correct damage classifications
- [ ] pytest: multi-room walkthrough parses into separate room entries

**Frontend:**
- [ ] "Walkthrough Mode" button on active job → opens voice + camera capture
- [ ] Continuous recording (up to 30 min, beating CompanyCam's 15-min limit)
- [ ] Photo capture during walkthrough — photos auto-tagged with timestamp + GPS + voice context
- [ ] Live transcript visible during walkthrough
- [ ] On completion: show structured report preview (rooms, observations, damage, line items)
- [ ] Edit/approve report before saving to job
- [ ] Export as PDF site assessment (insurance-ready)
- [ ] Share report with adjuster/customer via link

**Why this beats CompanyCam AI Note:**
- CompanyCam: voice → formatted text notes (no intelligence)
- Crewmatic: voice + photos → structured damage assessment with Xactimate line items, S500 justifications, and insurance-ready PDF

## Responsive & Accessibility (Design Review)

### Responsive Behavior

| Viewport | Voice Input | Walkthrough |
|----------|------------|-------------|
| **Mobile (<768px)** | Bottom sheet (55% height), full-width, slides up. Mic button centered. Mode toggle stacked if needed. | Full-screen takeover. Camera top 40%, transcript bottom 45%, controls pinned bottom. |
| **Tablet (768-1024px)** | Bottom sheet (45% height), max-width 480px centered. | Full-screen, camera and transcript side-by-side landscape, stacked portrait. |
| **Desktop (>1024px)** | Side panel (400px wide, right-aligned, slides in from right). Form visible alongside panel. | Mobile-only — hide walkthrough FAB on desktop. Office staff don't walk job sites. |

### Desktop Side Panel
```
┌──────────────────────────────────────────────────────────────┐
│ Header bar                                                    │
├─────────────────────────────────────┬────────────────────────┤
│                                     │ Voice Input        [X] │
│  Job Creation Form                  │ ─────────────────────  │
│  ┌──────────────────────────┐       │ [Hold] [Tap Continuous] │
│  │ Customer: Jane Doe ✔     │       │                        │
│  │ Phone: 586-555-9600 ✔    │       │ transcript area...     │
│  │ Address: ___________     │       │                        │
│  │ Loss Source: ________    │       │      (( 🎤 ))          │
│  └──────────────────────────┘       │   "Listening..."       │
│                                     │ [Done — Review Fields] │
├─────────────────────────────────────┴────────────────────────┤
```

### Accessibility
| Requirement | Implementation |
|------------|----------------|
| **Keyboard navigation** | Mic button: Enter/Space to toggle. Escape to close bottom sheet/panel. Tab order: mode toggle → transcript → mic → done. |
| **Screen reader** | Mic button: `aria-label="Start voice input"` / `"Stop listening"`. Live transcript: `aria-live="polite"` region. Field fills: announce "Customer name filled: Jane Doe". Progress: `aria-live="assertive"` for field counts. |
| **ARIA landmarks** | Bottom sheet: `role="dialog" aria-modal="true" aria-label="Voice input"`. Transcript: `role="log"`. |
| **Touch targets** | All buttons minimum 48px (DESIGN.md). Mic button 80px. Mode toggle segments 48px height. |
| **Color contrast** | Orange #e85d26 on white = 4.0:1 (passes AA large text). Green #2a9d5c on white = 3.9:1 (passes AA large text). Body text #1a1a1a on white = 16.6:1 (passes AAA). |
| **Reduced motion** | `prefers-reduced-motion: reduce` → disable pulsing rings, mic breathing animation. Field fills instant (no slide). |
| **iOS zoom prevention** | All inputs 16px+ font size (prevents Safari auto-zoom on focus). |

## Design System Token Mapping (Design Review)

All voice UI follows DESIGN.md. New patterns introduced by this spec:

### Segmented Control (new component)
Used for Hold to Speak / Tap Continuous mode toggle.
```
Container: h-12 rounded-full bg-surface-container p-1
Segment:   h-10 rounded-full px-4 text-[14px] font-medium
Active:    bg-brand-accent text-on-primary
Inactive:  bg-transparent text-on-surface-variant hover:text-on-surface
```
Touch target: 48px height (glove-safe). Only two segments for voice modes.

### Voice Component Token Map
| Element | Token / Class |
|---------|--------------|
| Mic button (idle) | primary-gradient, 80px, rounded-full, shadow-lg (exception: FAB needs shadow for elevation) |
| Mic button (active) | + pulsing rings: border-brand-accent/40, /25, /15 |
| Transcript area | bg-surface-container rounded-xl p-4 |
| Interim transcript | text-on-surface-variant (lighter, indicates processing) |
| Final transcript | text-on-surface (solid, indicates confirmed) |
| Progress text | text-brand-accent text-[13px] font-medium uppercase tracking-wider |
| Field filled checkmark | text-success (#2a9d5c) |
| Field correction flash | border-warning (#d97706) 200ms |
| Done button | primary-gradient h-12 rounded-xl text-on-primary font-medium |
| Mode toggle | Segmented control (above) |

### Walkthrough Recording Chrome
| Element | Token / Class |
|---------|--------------|
| Recording timer | text-error (#dc2626) font-mono, with pulsing 8px red dot |
| Photo count badge | bg-surface-container rounded-full px-3 py-1 text-[13px] |
| Camera viewfinder | bg-inverse-surface (dark) with rounded-xl overflow-hidden |
| Room label chip | bg-brand-accent/10 text-brand-accent text-[11px] font-mono uppercase tracking-wider px-2 py-1 rounded |
| Finish button | primary-gradient h-12 rounded-xl (same as Done button) |

### Walkthrough Report Cards
Follow existing card/row pattern from DESIGN.md:
- No shadows, thin border (#eae6e1)
- Per-room card: room name in section heading style, observations in body text
- Line items: row pattern with dividers, Xactimate code in mono font
- Photo thumbnails: 48px rounded-lg inline

## Technical Approach

### Why Deepgram Nova-2 (STT model choice)

| Option | Real-time? | Cost/min | Noise handling | Notes |
|--------|-----------|----------|---------------|-------|
| **Deepgram Nova-2** | YES (WebSocket streaming) | $0.0043 | Best for noisy environments | Our pick. Words appear as user speaks. |
| OpenAI Whisper API | NO (batch only) | $0.006 | Good | Kills the "fields fill as you speak" magic. Non-starter. |
| OpenAI Realtime API | YES (WebSocket) | $0.06 input | Good | 14x more expensive. Could replace Claude extraction but not worth the cost. |
| Browser Web Speech API | YES | Free | Poor | Terrible in noisy environments. Not production-grade. |

**Decision: Deepgram Nova-2.** Real-time streaming is non-negotiable (Brett needs to see fields fill as he speaks). Deepgram is the best STT for noisy construction environments, and at $0.0043/min it's the cheapest real-time option.

### Architecture (3 steps)

```
Step 1: Get a temporary Deepgram key (security)
┌──────────────┐   GET /v1/voice/token      ┌──────────────┐
│  Browser     │ ──────────────────────────► │  Backend     │
│              │ ◄────────────────────────── │  (FastAPI)   │
│              │   { token: "dg_temp_xxx",   │  stores real │
│              │     expires_in: 600 }       │  DG API key  │
└──────┬───────┘                             └──────────────┘
       │
Step 2: Stream audio to Deepgram directly (real-time, low latency)
┌──────────────┐   WebSocket (audio chunks)  ┌──────────────┐
│  Browser     │ ═══════════════════════════►│  Deepgram    │
│  MediaStream │                             │  Nova-2      │
│  (mic audio) │ ◄═══════════════════════════│  (cloud)     │
└──────┬───────┘   interim + final words     └──────────────┘
       │
       │  User sees live transcript (interim = gray, final = black)
       │
Step 3: Extract structured fields via Claude (on each utterance end)
┌──────────────┐  POST /v1/voice/extract     ┌──────────────┐
│  Browser     │ ──────────────────────────► │  Backend     │
│  sends full  │  { transcript: "...",       │  calls       │
│  accumulated │    context: "job_creation", │  Claude API  │
│  transcript  │    fields: ["customer_name",│  to extract  │
│  + context   │      "phone", "address"...] │  fields      │
│              │  }                          │              │
│              │ ◄────────────────────────── │              │
│              │  { fields: {               │              │
│              │    customer_name: "Jane..", │              │
│              │    phone: "586-555-9600"   │              │
│              │  }}                        │              │
└──────────────┘                            └──────────────┘
```

**Why browser connects to Deepgram directly (not through backend):**
Audio streaming through our backend would double bandwidth costs and add 50-100ms latency per hop. The browser sends audio directly to Deepgram's cloud. Our backend never touches the audio. Security is handled by temporary API keys (Step 1) that expire in 10 minutes.

**Why Claude extraction is a separate backend call (not Deepgram's):**
Deepgram transcribes speech to text. It doesn't understand that "cat 1 class 2" means water_category="1" and water_class="2" in our domain. Claude does the semantic mapping from natural speech to structured form fields. The backend sends the full accumulated transcript (not just the latest words) so corrections work naturally.

### Cost per voice interaction

| Scenario | Deepgram (STT) | Claude (extraction) | Total |
|---------|----------------|---------------------|-------|
| Job creation (30s speech) | $0.002 | ~$0.003 x 3-4 calls | ~$0.01 |
| Room setup (15s per room) | $0.001 | ~$0.003 x 1 call | ~$0.004 |
| Moisture reading (10s) | $0.001 | ~$0.002 x 1 call | ~$0.003 |
| Tech field notes (2 min) | $0.009 | $0 (no LLM needed) | ~$0.009 |
| Walkthrough (10 min) | $0.043 | ~$0.01 x 1 call | ~$0.05 |

At 10 jobs/day: ~$0.50/day for voice. Negligible.

### Backend Endpoints

| Endpoint | Purpose | Auth | Notes |
|---------|---------|------|-------|
| `GET /v1/voice/token` | Mint temporary Deepgram API key | JWT | Returns { token, expires_in }. Key valid 10 min, scoped to transcription only. |
| `POST /v1/voice/extract-fields` | Extract structured fields from transcript | JWT | Accepts { transcript, context, fields[] }. Returns { fields: {...} }. |
| `POST /v1/voice/walkthrough` | Generate structured walkthrough report | JWT | Accepts { transcript, photo_ids[] }. Returns { rooms: [...], summary }. |

### Frontend Components

| Component | Purpose | Notes |
|----------|---------|-------|
| `VoiceInput.tsx` | Reusable voice overlay (bottom sheet mobile, side panel desktop) | Extends existing voice-note-modal.tsx pattern |
| `useDeepgram.ts` | Custom hook wrapping Deepgram WebSocket | Uses `@deepgram/sdk` npm package. Handles connect/disconnect/reconnect. |
| `useVoiceExtraction.ts` | Custom hook for calling extract-fields endpoint | Debounced, sends on utterance_end. Merges results into form state. |
| `WalkthroughMode.tsx` | Full-screen walkthrough recording view | Camera + mic + transcript. Mobile only. |
| `WalkthroughReport.tsx` | Report preview/edit/export view | Per-room cards with observations and line items. |

### Eng Review Decisions (2026-04-08)
- **Deepgram API key security:** Backend mints temporary Deepgram keys via `GET /v1/voice/token` (10-min expiry, transcription-scoped). Browser never sees the real API key.
- **Extraction debounce:** 2-second debounce after last Deepgram utterance_end event before calling Claude. Reduces API calls from ~15 to ~3-4 per job creation. Timer resets if user keeps speaking.
- **Walkthrough report save:** Single atomic endpoint `POST /v1/voice/walkthrough/{job_id}/apply` creates all rooms + photos + line items in one Supabase transaction. All or nothing.
- **Shared MicButton component:** Extract mic button + pulsing rings from existing `voice-note-modal.tsx` into `web/src/components/voice/MicButton.tsx`. Both VoiceInput and VoiceNoteModal compose it. One source of truth for mic UI.
- **Test strategy (two-layer):** Layer 1: Mock Claude responses as fixtures, test merge/correction/field-mapping logic deterministically. Layer 2: 3-5 "golden set" tests against real Claude API (marked `@pytest.mark.slow`, CI-only). Ensures prompt regressions are caught without making fast tests flaky.
- **Offline limitation (acknowledged):** Browser→Deepgram direct means audio between last transcript event and network drop is lost. Saved transcript is best-effort. For 30-min walkthroughs, Deepgram's endpointing means at most ~1-3 seconds of audio is lost per drop. Acceptable trade-off vs. proxying all audio through backend.
- **Field names verified against backend schemas:** Claude prompt uses exact Pydantic field names (customer_phone, loss_category, loss_class, loss_cause, loss_date, carrier). Found and fixed mismatch during Codex review.

### Data Privacy & PII Handling
Voice interactions send customer PII (names, phones, addresses, claim numbers) to third-party services. Required safeguards:

| Concern | Mitigation |
|---------|-----------|
| **Deepgram audio data** | Set Deepgram `redact` option for PII. Set data retention to 0 days via Deepgram API settings. Audio is streamed, never stored by us. |
| **Claude transcript data** | Anthropic API does not use customer data for training (default). Transcripts sent to Claude contain PII but are not persisted by Anthropic. |
| **localStorage transcripts** | Auto-save for session resume contains transcript text (may include PII). Clear on: (1) successful form submission, (2) 5-minute expiry, (3) user logout. |
| **Walkthrough photos** | Uploaded to Supabase Storage (our infra, RLS-protected). GPS metadata stays in our DB. Not sent to Deepgram or Claude. |
| **User consent** | First-time voice use shows inline explanation: "Your voice is processed by Deepgram (transcription) and Claude (field extraction). Audio is not stored." |

### Key npm Dependencies
- `@deepgram/sdk` — official Deepgram client, handles WebSocket streaming
- No other new dependencies needed (Claude calls go through our existing backend Anthropic client)

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

## Design Review Decisions (2026-04-08)

- **Walkthrough FAB placement:** 56px floating action button, bottom-right of job detail page, above mobile bottom nav. Orange gradient with mic+camera icon. Desktop: hidden (walkthrough is mobile-only).
- **Mic permission denied UX:** Inline card in bottom sheet (not a modal). Orange info style. "Microphone Access Needed" + [Open Settings] + [Type Instead]. Calm, not alarming.
- **Field fill animation:** 200ms green border flash → value slides in → green checkmark. Corrections get amber flash first.
- **Mode toggle:** New segmented control component (48px height, rounded-full, orange active segment).
- **Desktop voice:** Voice input available on all viewports. Bottom sheet on mobile → side panel (400px) on desktop. Walkthrough stays mobile-only.
- **Navigate away mid-recording:** Auto-save transcript to localStorage on unmount. On return: "Resume previous session?" with transcript preview. 5-minute expiry.
- **Walkthrough report → job data:** Auto-create room records, attach photos to rooms, pre-populate recommended line items as draft scope. Contractor reviews and approves before finalizing.
- **Transcript max length:** Scrollable container, max-height 200px on mobile, 300px on desktop. Auto-scroll to bottom on new words. Manual scroll up to review.

## Decisions & Notes

- **Voice-first is the killer feature.** Brett: "I should just be speaking to it and not type." Contractors are on job sites with wet/dirty gloves.
- **Deepgram Nova-2:** Best quality STT for noisy environments. ~$0.0043/min. Streaming via WebSocket with interim + final transcripts.
- **Free-form speech, not guided form.** Brett's feedback: guided form approach was "hard to track, hard to recover if you get off track." Solution: speak naturally in any order, AI extracts and maps to correct fields. See `docs/research/brett-prototype-sessions.md`.
- **Two modes:** Hold-to-speak (push-to-talk for noisy sites) + Tap for continuous (hands-free when quiet).
- **Corrections work naturally:** LLM sees full accumulated transcript. "I'm sorry, the loss source is a dishwasher leak" overrides previous "washer leak."
- **Voice-to-text vs voice-to-form:** Tech field notes use pure transcription (Deepgram only, no LLM). Structured forms use Deepgram + Claude extraction.
- **Spec ships after AI Pipeline (Spec 02)** because voice is the input method enhancement, not the core product. Manual input works for everything first.
- **CompanyCam AI Note is the comp to beat.** CompanyCam ($2B valuation, Feb 2026) launched AI Note / Walkthrough Note: walk the site, speak, snap photos → formatted text notes. 15-min limit, mobile-only, $79-199/user/mo. No Xactimate codes, no damage classification, no insurance justifications. Our Phase 4 (Voice Walkthrough Report) takes the same input pattern and produces structured damage assessments with line items — the output they can't match.
