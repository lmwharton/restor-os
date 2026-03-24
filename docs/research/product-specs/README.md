# Crewmatic - Product Specification Suite

**Product:** Crewmatic - The Operating System for Restoration Contractors
**Date:** 2026-03-13
**Status:** Draft - Ready for Review

---

## What is Crewmatic?

Crewmatic is a field-first web application (PWA) for water restoration contractors. It replaces the fragmented paper/spreadsheet/multi-tool workflow with a single AI-powered platform that produces insurance-grade documentation.

**Core value proposition:** A tech with a phone arrives at a water-damaged property, documents everything through voice and photos, and produces Xactimate-ready scope notes — without touching a keyboard.

**Origin:** Built from a 301-message prototype conversation between a non-developer restoration contractor and Claude AI. The prototype validated the concept. This spec suite defines the production rebuild.

---

## Spec Documents

| # | Document | Contents |
|---|----------|----------|
| 1 | [Competitive Analysis](crewmatic-competitive-analysis.md) | 13 competitors analyzed, feature matrix, pricing landscape, market opportunity ($180-360M TAM), go-to-market strategy |
| 2 | [Consumer Workflows](crewmatic-consumer-workflows-v1.md) | 15 end-to-end workflows documented with triggers, steps, data schemas, edge cases, offline strategy |
| 3 | [Backend Architecture](crewmatic-backend-architecture.md) | 17 database tables (full SQL), 50+ API endpoints, AI pipelines (voice + photo + guided), RLS, multi-tenancy |
| 4 | [Frontend Architecture](crewmatic-frontend-architecture.md) | Component tree, state management, voice/camera UX, PWA strategy, streaming AI UI, performance targets |

---

## V1 Scope

### Personas
| Persona | Device | Role |
|---------|--------|------|
| **Restoration Tech** | Phone (PWA) | Field: capture readings, photos, voice scopes |
| **Company Owner** | Desktop + Phone | Office: review jobs, manage team, generate reports |

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, shadcn/ui, Tailwind, TanStack Query, Zustand |
| Backend | Python FastAPI |
| Database | Supabase (PostgreSQL + Auth + Storage) |
| AI - LLM | Anthropic Claude (scoping, photo analysis, guided sessions) |
| AI - STT | Deepgram Nova-2 (voice transcription) |
| Frontend Hosting | Vercel |
| Backend Hosting | Railway |

### Key Features
1. **AI Photo Scope** — Upload damage photos → AI generates Xactimate line items (FIRST TO MARKET)
2. **Voice-Guided Scoping** — Step-by-step voice dictation producing structured scope data
3. **Site Log** — Moisture readings (atmospheric, point, dehu output) with trend tracking
4. **Equipment Tracking** — Place/remove dehumidifiers, air movers by room
5. **Job Management** — Create/track jobs with customer, insurance, loss details
6. **Team Management** — Invite techs, assign to jobs
7. **Report Generation** — Xactimate-ready scope notes, moisture reports, PDF export
8. **Photo Documentation** — Capture with auto geo-tag, room assignment, offline queue
9. **PWA** — Installable, offline-capable for field use

### Out of Scope (V1)
- Room sketching (complex, photos cover 90% of needs)
- Invoicing / accounting
- Customer / adjuster portal (V2)
- Native mobile app (PWA first)
- Direct Xactimate API integration (CSV export for V1)
- Multi-company per user

---

## Pricing Model (Proposed)

| Tier | Price | Users | AI Scopes/mo | Target |
|------|-------|-------|-------------|--------|
| Solo | $49/mo | 2 | 50 | 1-2 person shops |
| Team | $149/mo | Unlimited | 200 | 3-10 person shops |
| Pro | $299/mo | Unlimited | 1,000 | 10-25 person shops |
| Enterprise | Custom | Unlimited | Unlimited | Franchises |

---

## Competitive Position

**Crewmatic is the ONLY platform that:**
1. Generates Xactimate line items from photos using AI
2. Offers true voice-guided scoping workflows
3. Combines field documentation + job management + AI in one tool
4. Is priced accessibly for 1-3 person shops ($49/mo vs $270-770/mo competitors)

**Key competitors:** Encircle (HIGH threat), magicplan (MEDIUM-HIGH), DASH (MEDIUM)

**Positioning:** Crewmatic complements Xactimate, doesn't replace it. "Everything before the estimate, faster."

---

## Implementation Timeline

| Phase | Weeks | Backend | Frontend |
|-------|-------|---------|----------|
| 1. Foundation | 1-2 | Supabase setup, migrations, auth | Next.js scaffold, auth, PWA |
| 2. Core Jobs | 3-4 | Job + Room + Team APIs | Job board, voice wizard |
| 3. Field Data | 5-6 | Photos, readings, equipment APIs | Photo capture, site log |
| 4. AI Integration | 7-8 | Deepgram + Claude pipelines, SSE | Streaming UI, line item cards |
| 5. Reports | 9-10 | PDF generation, Xactimate export | Report preview, download |
| 6. Polish | 11-12 | Sync APIs, audit log | Offline hardening, a11y, perf |

---

## GitHub

- **Org/Repo:** `crewmatic` or `restor-os`
- **Monorepo structure:**
  ```
  crewmatic/
    apps/
      web/        → Next.js frontend (Vercel)
      api/        → FastAPI backend (Railway)
    packages/
      types/      → Shared TypeScript types
      config/     → Shared config (ESLint, etc.)
    docs/
      specs/      → These spec documents
  ```

---

## Next Steps

1. Review all 4 spec documents
2. Finalize naming (Crewmatic confirmed?)
3. Create GitHub repo
4. Begin Phase 1: Foundation (backend + frontend in parallel)
