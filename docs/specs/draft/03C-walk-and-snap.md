# 03C — Walk-and-Snap (composed mode)

> Voice-led field scoping mode. Tech taps `[Scope]` → mic auto-starts AND camera goes live → walks, talks, snaps in one motion. Photos auto-link to active voice clip with timing offsets.
>
> This is a **composition** of 03A (Photo Capture) + 03B (Voice Capture), not a new primitive.

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/3 phases) |
| **State** | 📋 Planned |
| **Blocker** | 03A Photo Capture + 03B Voice Capture |
| **Parent** | [03-capture-foundation.md](./03-capture-foundation.md) |
| **Branch** | TBD |
| **Issue** | child of CREW-20 (to be split) |
| **Linear Tech Plan** | [03C Walk-and-Snap (composed mode)](https://linear.app/crewmatic/document/tech-plan-03c-walk-and-snap-composed-mode-ff9fc5d1cd15) |
| **Source PRD** | Brett's "Voice + Photo Capture v1.0" — this is the field UX it describes |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-27 |
| Started | — |
| Completed | — |
| Sessions | 0 |

## Done When
- [ ] Tap `[Scope]` opens combined camera+mic UI; mic auto-starts (no second tap)
- [ ] Tech can snap 25+ photos in 30 seconds (volume buttons OR screen tap, burst supported)
- [ ] Each photo auto-links to active voice clip with timing offset (`photo_voice_offset_ms`)
- [ ] Auto room-tag from voice transcript (delegates to 03B which surfaces tag)
- [ ] Battery + storage pre-flight checks (warns below 15% / 500MB)
- [ ] 2:30 auto-stop with `[Resume]` / `[Done]` (max 5 min total)
- [ ] Auto-save on navigation (no "discard?" prompts)
- [ ] Works offline (records locally, syncs on reconnect)
- [ ] Per-room timing target: 60 seconds for 25 photos + voice description

## What this owns

- Combined camera + mic UI (the field scoping screen)
- Mic auto-start on entry
- Photo→voice timing offset linking
- Speed optimizations: volume-button snap, haptic feedback, burst mode, flashlight
- Battery + storage pre-flight checks
- 2:30 auto-stop with resume
- Pause-aware composition

## What this does NOT own

- Photo primitive (see 03A)
- Voice primitive (see 03B)
- AI processing of captures (see 02 AI Photo Analysis)
- Live transcript display (borrowed from 03B; this mode minimizes per Brett's PRD — clean interface, no scroll)

## Where used

- Field scoping flow (currently the only consumer)

## Phases

1. Combined UI shell (camera + mic on, both states managed together)
2. Photo→voice timing linkage + room auto-tag wiring
3. Speed optimizations (volume buttons, burst, haptics) + pre-flight checks + auto-stop

## Linked

- Brett's PRD — Voice + Photo Capture v1.0 (canonical UX spec)
- Sub-primitives: 03A photo, 03B voice
- Issue: CREW-20 (umbrella, will split to 03A/B/C children)
