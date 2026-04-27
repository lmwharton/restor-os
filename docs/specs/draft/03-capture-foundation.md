# 03 — Capture Foundation (umbrella)

> Engineering umbrella for the Voice + Photo Capture project. Defines the primitives + sync architecture that 03A/B/C all sit on top of.

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 phases) |
| **State** | 📋 Planned |
| **Blocker** | None |
| **Branch** | TBD |
| **Issue** | CREW-20 (umbrella, splits into 03A/B/C) |
| **Linear Tech Plan** | [03 Capture Foundation (umbrella)](https://linear.app/crewmatic/document/tech-plan-03-capture-foundation-umbrella-6a50ee7b023c) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-27 |
| Started | — |
| Completed | — |
| Sessions | 0 |

## Done When
- [ ] Photo and voice primitives (03A, 03B) are independently importable hooks/components
- [ ] Both primitives honor offline-first contract (capture works with no connectivity, syncs on reconnect)
- [ ] Draft state preserves in-progress captures across navigation
- [ ] EXIF metadata preserved end-to-end (CREW-38)
- [ ] Auto-save on navigation (no "discard?" prompts per Brett's PRD)
- [ ] 03C walk-and-snap composition works using 03A + 03B together with photo→voice timing offsets

## What this owns

- Capture primitives registry (photo, voice as reusable components)
- Draft state (in-progress capture before save)
- Offline-first storage (IndexedDB + Service Worker queue)
- Sync architecture (resume on reconnect, conflict resolution)
- EXIF preservation pipeline

## What this does NOT own

- AI processing of captured data (see 02 AI Photo Analysis)
- Job model, room model (see Property Data Model)
- The walk-and-snap UX itself (composed in 03C)

## Sub-specs

- **03A Photo Capture (primitive)** — snap + EXIF + metadata
- **03B Voice Capture (primitive)** — record + Deepgram STT + transcript
- **03C Walk-and-Snap (composed mode)** — voice-led field scoping (Brett's PRD UX)

## Phases

1. Offline-first storage + sync infrastructure (IndexedDB, Service Worker, sync queue)
2. Photo primitive (03A) — independently usable
3. Voice primitive (03B) — independently usable
4. Walk-and-Snap composed mode (03C) — uses 03A + 03B with timing linkage

## Linked

- Brett's PRD: Voice + Photo Capture v1.0 (describes 03C field UX)
- Issues: CREW-20 (umbrella), CREW-21 (voice transcription → 03B), CREW-38 (EXIF → 03A)
