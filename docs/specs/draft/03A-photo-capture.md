# 03A — Photo Capture (primitive)

> Standalone photo capture primitive. Click shutter → save → attach metadata. Used independently across the app and composed into 03C walk-and-snap.

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 phases) |
| **State** | 📋 Planned |
| **Blocker** | 03 Capture Foundation (storage + sync infrastructure) |
| **Parent** | [03-capture-foundation.md](./03-capture-foundation.md) |
| **Branch** | TBD |
| **Issue** | child of CREW-20 (to be split) |
| **Linear Tech Plan** | [03A Photo Capture (primitive)](https://linear.app/crewmatic/document/tech-plan-03a-photo-capture-primitive-74eeeee65cd9) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-27 |
| Started | — |
| Completed | — |
| Sessions | 0 |

## Done When
- [ ] Photo capture component opens full-screen camera (mobile-optimized)
- [ ] Snap via screen tap, volume buttons (Vol Up / Vol Down), or hold-for-burst (3-5 photos/sec)
- [ ] Haptic feedback on each capture
- [ ] EXIF metadata (timestamp, GPS) preserved end-to-end (CREW-38)
- [ ] Optional metadata attachment: room, label, manual note, voice clip ref
- [ ] Saves to `photos` table + Supabase Storage with offline-first queue
- [ ] Flashlight toggle (independent of camera flash)
- [ ] Battery + storage pre-flight checks (warns below 15% / 500MB)
- [ ] Component is callable from any screen — not coupled to walk-and-snap

## What it does

- Open camera (full-screen, mobile-optimized)
- Snap via screen tap, volume buttons, hold-for-burst
- Preserve EXIF (timestamp + GPS) through compression/upload
- Attach metadata: room, label, optional manual note, optional voice clip ref
- Save to `photos` table + Supabase Storage
- Offline-first: queue when offline, sync on reconnect
- Flashlight toggle for dark spaces

## Where used

- One-off photos (after-work documentation, equipment placement, receipts)
- Walk-and-snap mode (03C composes 03A + 03B)
- Hazmat tab close-up snaps
- Reconstruction documentation
- Floor plan pin photos

## Output schema

```typescript
type Photo = {
  id: string
  job_id: string
  room: string | null
  label: string | null
  note: string | null
  voice_note_id: string | null
  exif: { timestamp: string; gps_lat: number | null; gps_lng: number | null }
  storage_path: string
  created_at: string
}
```

## Phases

1. Camera UI + snap
2. EXIF preservation through pipeline (CREW-38)
3. Metadata attachment + save
4. Offline-first queue + sync

## Linked

- Issue: CREW-20 (umbrella), CREW-38 (EXIF)
