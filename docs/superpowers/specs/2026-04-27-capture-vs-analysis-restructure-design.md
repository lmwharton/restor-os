# Capture vs Analysis Restructure — Design Doc

**Date:** 2026-04-27
**Author:** Lakshman + Claude
**Status:** ✅ Approved + executed in Linear and local specs

## Problem

The Voice + Photo Capture and AI Photo Scope projects in Linear blurred two distinct concerns:

1. **Capture** — getting voice + photos out of the field into the system (input)
2. **Analysis** — taking captured photos + their full job context and producing AI outputs like Xactimate line items, hazmat findings, etc. (output)

Symptoms of the muddle:

- Brett's PRD bundled voice + photo together because in the field they happen simultaneously, but the engineering primitives need to be reusable for non-field surfaces (tech notes, dictating moisture readings, one-off after-photos, etc.)
- AI Photo Scope project name implied "PhotoScope = the project" but it actually contained PhotoScope (line items) AND HazmatCheck (hazards) as parallel siblings, which doesn't reflect that they share the same pipeline
- CREW-22 (Tier 1 compliance check) was filed under capture, but it's actually a processing concern that runs after capture syncs
- The two PRDs in the AI project (Estimator Tool + Estimating Engine Architecture) were not clearly disambiguated

## Decision

### Two-layer architecture

**Input layer — Project: Voice + Photo Capture (kept)**

- 🛠 **03 Capture Foundation (umbrella)** — primitives registry, draft state, offline-first storage, sync, EXIF preservation
- 🛠 **03A Photo Capture (primitive)** — snap + EXIF + metadata. Used everywhere.
- 🛠 **03B Voice Capture (primitive)** — record + Deepgram STT + transcript. Used everywhere.
- 🛠 **03C Walk-and-Snap (composed mode)** — voice-led field scoping; composes 03A + 03B with photo→voice timing offsets. **Brett's PRD describes this mode.**

**Output layer — Project: AI Photo Analysis (renamed from "AI Photo Scope")**

- 📝 PRD — Estimator Tool UX *(renamed from "AI Job Estimator Tool")* — WHAT the user sees
- 📝 PRD — Estimating Engine Internals *(renamed from "Estimating Engine Architecture")* — HOW the AI reasons
- 🛠 **02 AI Photo Analysis (umbrella)** — context aggregator + multi-pass Claude orchestration (Celery + Redis + SSE)
- 🛠 **02A Line Items Pass** — Xactimate line items + S500/OSHA/EPA citations
- 🛠 **02B Hazmat Pass** — asbestos + lead findings (uses property year_built)

### Mental model

- **Capture is plural** — voice and photo are independent primitives. Walk-and-snap is a *mode* that composes them.
- **Analysis is singular** — one context-rich pipeline runs multi-pass. PhotoScope and HazmatCheck are *lenses* over the same analysis output, not separate features.

### Issue moves

| Issue | From | To | Why |
| -- | -- | -- | -- |
| CREW-22 (compliance check) | Voice + Photo Capture | AI Photo Analysis | It's processing, not capture |
| CREW-38 (EXIF preservation) | (no project) | Voice + Photo Capture | Photo primitive concern |
| CREW-20 (capture infra) | Voice + Photo Capture | (stays — now umbrella) | Will split into 03A/B/C children |

## Why two prongs (testing argument)

Splitting the capture into primitives + composed mode beats one big "Voice + Photo Capture" spec because:

1. Photo capture can be verified independently of voice (no Deepgram dependency in tests)
2. Voice primitive is reusable for moisture-reading dictation, tech notes, voice-filling forms
3. Walk-and-snap integration test is small — checks only composition + timing
4. Can ship photo-only first if voice has issues
5. Each primitive is small enough for one PR; the composed mode is a thin shell on top

## Linear data model — disambiguation

Brett, Lakshman, and others kept conflating PRDs / Tech Plans / Issues. The fix is now in the master index. Three object types:

- **Project** = container under an Initiative (V1/V2/V3)
- **Document** = markdown doc inside a project. Either a PRD (📝 product) or Tech Plan (🛠 engineering)
- **Issue** = work ticket (CREW-NN) with status, assignee, priority

Documents and issues are *siblings*, not parent/child. A PRD doesn't "become" an issue.

## Artifacts shipped

- Linear project rename: `AI Photo Scope` → `AI Photo Analysis`
- 6 new Linear Tech Plan docs created (02 umbrella, 02B hazmat, 03 umbrella, 03A photo, 03B voice, 03C walk-and-snap)
- 2 PRD titles + content updated for clarity (Estimator Tool UX, Estimating Engine Internals)
- 02A doc title updated (`AI Photo Scope (02A)` → `02A Line Items Pass`)
- 3 issue moves (CREW-22, CREW-38) + CREW-20 reframed as umbrella
- Master index doc fully refreshed with new structure + spotlight section
- Local specs: renamed `03-voice.md` → `03B-voice-capture.md`, created `02-ai-pipeline.md`, `03-capture-foundation.md`, `03A-photo-capture.md`, `03C-walk-and-snap.md`

## Next steps (implementation)

1. **Split CREW-20** into 3 child issues for 03A / 03B / 03C work
2. **Order**: build 03A Photo Capture first (no Deepgram dep) → then 03B Voice Capture → then 03C composed mode
3. **In parallel** with 03A/B: 02 umbrella context aggregator + Celery scaffolding (CREW-23 prereq)
4. After capture primitives ship, wire 02A Line Items Pass and 02B Hazmat Pass on top of the umbrella
5. CREW-22 Tier 1 compliance check runs as a special pass on the same pipeline

## Links

- [Master Index](https://linear.app/crewmatic/document/master-index-crewmatic-workspace-30cd9593c2c0)
- [Project: AI Photo Analysis](https://linear.app/crewmatic/project/ai-photo-analysis-68b1d6ef77f0)
- [Project: Voice + Photo Capture](https://linear.app/crewmatic/project/voice-photo-capture-ed6e3919435c)
