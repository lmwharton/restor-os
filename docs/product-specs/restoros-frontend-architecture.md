# RestorOS Frontend Architecture

**Version:** 1.0
**Date:** 2026-03-13

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | shadcn/ui + Tailwind CSS 4 |
| Server State | TanStack Query 5 |
| Client State | Zustand 5 |
| Forms | React Hook Form + Zod |
| Auth | Supabase SSR |
| Charts | Recharts (lazy) |
| PDF | @react-pdf/renderer (lazy) |
| PWA | @serwist/next |
| Animations | Framer Motion |
| Icons | Lucide React |

---

## App Structure & Routing

```
/                           → Auth check → /dashboard or /login
/login                      → Google Sign-In + email
/onboarding                 → Company setup (first-time)

/(app)/                     → Authenticated shell
  dashboard/                → Owner: active jobs, metrics, team
  jobs/                     → Job board (list view)
    [jobId]/                → Job detail shell
      scope/                → Voice scoping wizard
      photos/               → Photo gallery + AI scope
      readings/             → Site log (moisture)
      equipment/            → Equipment at this job
      reports/              → Report preview + PDF
  equipment/                → Global equipment library
  team/                     → Team management
  settings/                 → Profile, company, billing

/(auth)/                    → Login, signup, invite accept
```

### Navigation

**Mobile (< 768px):** Bottom tab bar (Jobs, Dashboard, Equipment, More). 56px height, large touch targets. Swipe between job detail tabs.

**Desktop (>= 768px):** Collapsible left sidebar (240px expanded, 64px collapsed). Horizontal tabs for job details.

### Adaptive UI

`useViewMode()` hook returns `"field"` or `"office"` based on viewport + user role + preference override.

---

## Component Architecture

```
src/
├── app/                        → Next.js pages
├── components/
│   ├── ui/                     → shadcn/ui primitives
│   ├── layout/                 → AppShell, MobileNav, DesktopSidebar, TopBar
│   ├── shared/                 → DataTable, StreamingText, VoiceButton, PhotoGrid
│   └── features/
│       ├── scoping/            → ScopeWizard, VoiceFieldInput, VoiceCommandLayer
│       ├── photo-scope/        → PhotoCapture, AIAnalysisView, LineItemCard
│       ├── site-log/           → ReadingsDashboard, MoistureGrid, TrendChart
│       ├── jobs/               → JobCard, JobTable, JobFilters
│       ├── equipment/          → EquipmentLibrary, AssignEquipment
│       ├── reports/            → ReportPreview, XactimateExport
│       ├── team/               → TeamList, InviteMember
│       └── dashboard/          → ActiveJobsSummary, TeamActivity
├── hooks/
│   ├── useViewMode.ts          → Field vs office detection
│   ├── useVoiceInput.ts        → Web Speech API wrapper
│   ├── useVoiceCommands.ts     → "next", "done", "approve" navigation
│   ├── useCamera.ts            → Photo capture
│   ├── useOnlineStatus.ts      → Network connectivity
│   ├── useOfflineQueue.ts      → Queued mutations
│   └── useStreamingAI.ts       → SSE streaming for AI
├── lib/
│   ├── supabase/               → Client + server + middleware
│   ├── api.ts                  → Fetch wrapper with retry
│   ├── offline-store.ts        → IndexedDB via idb-keyval
│   └── image-compress.ts       → Client-side compression
├── stores/
│   ├── voice-store.ts          → Voice session state
│   ├── upload-queue-store.ts   → Pending uploads
│   └── ui-store.ts             → Sidebar, active tab, etc.
├── types/                      → TypeScript interfaces
└── providers/                  → QueryProvider, AuthProvider, OfflineProvider
```

---

## State Management

| State Type | Solution | Examples |
|---|---|---|
| Server state | TanStack Query | Jobs, readings, equipment, team |
| Auth | Supabase + Context | Current user, session, role |
| Forms | React Hook Form | Scope wizard, reading entry |
| Voice session | Zustand | Recording, transcript, active field |
| Upload queue | Zustand + IndexedDB | Pending photos, retry status |
| UI ephemeral | Zustand | Sidebar state, modals |

### Offline Strategy

```
TanStack Query Cache (in-memory)
  ↕ @tanstack/query-persist-client
IndexedDB (persistent offline cache)

networkMode: 'offlineFirst' on all queries + mutations
Mutations queued → drain on reconnect → conflicts surface as toasts
```

---

## Voice Architecture

**Primary:** Web Speech API (free, offline-capable on many devices)
**Fallback:** Deepgram (noisy environments, long dictation)

### Voice Commands
```
"next"     → advance wizard step
"back"     → previous step
"done"     → complete section
"approve"  → approve AI suggestion
"reject"   → reject AI suggestion
```

### Design Principles
- Voice is enhancement, never the only path
- Every voice field has keyboard input alongside
- Noise detection: consecutive low-confidence → suggest keyboard
- Critical fields (phone, address): require explicit confirm

---

## AI Photo Scope UX (Killer Feature)

### Flow
```
1. Select photos → [Analyze with AI] button
2. Pulsing "Analyzing..." with streaming status text
3. Line item cards fade in one-by-one (staggered animation)
4. Each card: [Approve] [Edit] [Reject]
5. Confidence bar: green (>80%), yellow (60-79%), red (<60%)
6. [Approve All Remaining] + [Add to Scope] bulk actions
```

### Card States
- **Pending** (yellow border) → review needed
- **Approved** (green border, checkmark)
- **Rejected** (red border, strikethrough, undo for 5s)
- **Edited** (blue border, "modified" badge)

### Error Handling
- AI down → "Analysis unavailable. Photos saved -- analyze later."
- Partial stream failure → show received items + "Retry remaining"
- Bad photo quality → warning, proceed anyway or retake

---

## Camera / Photo UX

```
User taps "Add Photo"
  → <input type="file" capture="environment"> (native camera)
  → Client-side compression (4MB → ~400KB via browser-image-compression)
  → Thumbnail generated locally for instant display
  → Queued in IndexedDB for background upload
  → Upload progress with retry on failure
```

---

## PWA

### Service Worker Caching
| Resource | Strategy |
|----------|----------|
| App shell (HTML/JS/CSS) | Cache-first, update in background |
| API responses | Network-first, fall back to cache |
| Photos | Cache-first (immutable after upload) |
| AI endpoints | Network-only |

### Offline Capabilities
| Feature | Offline? |
|---------|----------|
| View jobs/rooms | Yes (cached) |
| Take photos | Yes (local queue) |
| Log readings | Yes (queued mutation) |
| Voice recording | Yes (stored locally) |
| AI Photo Scope | No (requires server) |
| Report generation | No |

---

## Mobile-First Design

- **Touch targets:** 48x48px minimum, 8px gap between targets
- **Primary actions:** 56px height buttons, bottom-anchored
- **Voice button:** 64px diameter floating button (bottom-right)
- **Single-column** on mobile, multi-column on desktop
- **High-contrast outdoor mode:** User toggle, 7:1+ contrast ratios

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Initial JS (gzipped) | < 150KB |
| Route chunks | < 50KB each |
| FCP (4G) | < 1.5s |
| TTI (4G) | < 3s |
| LCP | < 2.5s |
| CLS | < 0.1 |

Heavy libraries (recharts, jsPDF, dnd-kit) loaded via `dynamic()` on demand.

---

## Testing

| Layer | Tool | Target |
|-------|------|--------|
| Unit (hooks) | Vitest | 90% |
| Component | Vitest + RTL | Key flows |
| E2E | Playwright | Critical paths |
| Accessibility | axe-core | Every page |
| Performance | Lighthouse CI | Budget enforcement |

---

## Implementation Phases

| Phase | Weeks | Scope |
|-------|-------|-------|
| 1. Foundation | 1-2 | Next.js setup, Tailwind + shadcn, auth, AppShell, PWA |
| 2. Core Jobs | 3-4 | Job board, voice wizard, photo capture, offline caching |
| 3. AI Features | 5-6 | Photo scope (streaming UI, cards), reports |
| 4. Data/Mgmt | 7-8 | Site log, equipment, team, dashboard |
| 5. Polish | 9-10 | Offline hardening, performance, a11y, high-contrast mode |
