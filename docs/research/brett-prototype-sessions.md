# Brett's Prototype Sessions & Feature Ideas

> **Source:** Multiple shared conversations between Brett and Claude, March 2026
> **Context:** Brett has been building an HTML prototype of ScopeFlow. These notes capture product insights, feature ideas, and UX decisions from those sessions.

---

## Market Sizing (March 19, 2026)

Brett asked about the number of water restoration companies with 1-25 employees in the USA.

| Metric | Value |
|--------|-------|
| Total water damage repair/restoration businesses (USA) | ~115,350 (broad definition) |
| IBISWorld damage restoration category | ~62,582 (2025) |
| Estimated 1-25 employee companies (85-90% of total) | **50,000-100,000** |
| Market fragmentation | No single company holds >5% market share |
| Revenue profile of target companies | 50% report $1M-$5M annual revenue |
| Water damage share of restoration revenue | 38-40% (largest segment, 2025) |

**Implication:** The TAM for small water/fire restoration shops with 1-25 employees is 50,000-100,000 companies in the US alone. Hyper-fragmented, underserved by enterprise software.

---

## "Outside the Box" AI Features (March 2026)

Brett asked for innovative features no competitor has. These go beyond the standard feature set.

### Tier 1 — High Impact, Unique

1. **AI Scope Auditor** — After a job is documented, AI reviews entire scope and flags missed line items. "You logged wet drywall in the bathroom — did you account for baseboard removal, insulation, and vapor barrier?" Cross-references S500 standards. *Already in V1 design.*

2. **AI Deposition Prep Assistant** — Feed ScopeFlow the job record and AI prepares contractor for litigation questions. "An attorney may ask why equipment was removed on day 6 given these moisture readings. Here's how to answer that." Restoration contractors get dragged into lawsuits more than people realize.

3. **Equipment ROI Tracker** — AI tracks which equipment gets deployed most, run hours per job, billing generated. "Your LGR dehumidifier has run 340 hours this quarter but only appeared on 4 jobs. Your air movers are pulling 3x the revenue per unit." Informs buy/retire decisions.

### Tier 2 — Smart Additions

4. **Photo Geo-Tagging with AI** — Better than CompanyCam. Not just GPS coordinates, but AI analysis layered on top of location data. Phone browsers expose GPS natively, zero added cost.

5. **AI-Powered Adjuster Communication** — Draft professional adjuster emails, supplement cover letters, and dispute responses in adjuster language.

---

## Voice Scoping UX Redesign (March 2026)

Brett's feedback on the guided form approach for voice input:

### Problem
> "I'm having trouble using guided form. It doesn't highlight each field fast enough sometimes and it's hard to track. If you get off track it's not easy to recover."

### Root Cause
The guided form approach has a fundamental mismatch — it forces a linear, field-by-field UI pattern onto something naturally conversational and free-flowing. **The form was driving the speech instead of speech driving the form.**

### Solution Direction
- Speech should be free-form — contractor talks naturally, AI extracts and maps to fields
- Two modes: **Continuous** (mic stays hot, hands-free) and **Push-to-Talk** (for noisy job sites)
- Fields lock green when confirmed, yellow with flag icon when ambiguous
- Spelling recognition: "spelled K-O-V-I-N-A-C-K" applies to last captured name
- Session log shows everything said for tracking

### POC Built
A proof-of-concept was built with:
- Core behavior: speak naturally in any order, AI extracts and maps to right field
- Text streams in with cursor effect
- Both continuous and push-to-talk modes
- Spelling recognition
- Session log panel

---

## Sketch Tool Requirements (March 2026)

Brett's feedback on the current canvas-based room sketching tool:

### Current State
- 7,900+ line HTML file
- Brett: "The entire thing isn't very good"

### Requirements
- **Live measurements** as walls are being drawn
- **Doors snap to walls** — interactive, "stick" to walls when close
- **Flip and rotate** doors and windows
- Better overall UX

### LiDAR Decision
- Skip LiDAR for now — fragmented on Android, requires native iOS (RoomPlan API)
- Revisit when going native iOS
- Current path: make canvas sketching tool actually good in the browser
- 80% of the value without native app dependency

---

## iOS Native App Direction

Brett's explicit statement:
> "I want to operate under the impression that this will one day soon be an app on iOS. So lets not make the decision based on the fact we're web based."

**What changes with iOS native:**
- GPS & Location via Core Location framework
- Camera integration (direct capture, not file picker)
- LiDAR / RoomPlan for auto-generated room sketches with dimensions
- Push notifications
- Offline-first with background sync
- Haptic feedback

**Current strategy:** Build web-first, design decisions should be iOS-forward.

---

## Brett's Working Style Notes

- Has been building an HTML prototype (single-file, 7,900+ lines)
- Explicitly concerned about code rollbacks: "Don't roll back past this file unless you notify me"
- Iterates fast — multiple sessions fixing specific bugs (iframe wiring, zoom scaling, door/window placement)
- Prefers to validate features by running on real jobs before declaring them done
