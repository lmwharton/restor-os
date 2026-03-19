# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Crewmatic?

Crewmatic is a field-first AI platform for water restoration contractors. It replaces 4-6 fragmented tools (Encircle, CompanyCam, magicplan, DASH, etc.) with a single app that turns damage photos into Xactimate-ready estimates, guides techs through scoping via voice, and automates insurance documentation. Tagline: "The Operating System for Restoration Contractors."

Key differentiators (no competitor has these):
- **AI Photo Scope** — damage photos → Xactimate line items in seconds
- **AI Hazmat Scanner** — auto-flags asbestos/lead in photos
- **S500/OSHA Justifications** — every line item auto-backed by industry standards

## Repository Structure

```
Crewmatic/
├── backend/                             # Python FastAPI backend (Railway-hosted)
│   ├── api/
│   │   ├── main.py                      # FastAPI app, CORS, health check
│   │   ├── config.py                    # pydantic-settings (env vars)
│   │   └── shared/                      # Database client, exceptions
│   ├── pyproject.toml
│   └── CLAUDE.md
├── docs/
│   ├── competitive-analysis.md          # Full competitive analysis + co-founder interview
│   └── product-specs/
│       ├── README.md                    # Product overview, tech stack, V1 scope, timeline
│       ├── restoros-architecture.md     # Full technical architecture (DB schema, APIs, frontend structure)
│       └── restoros-consumer-workflows-v1.md  # 15 end-to-end user workflows
└── web/                                 # Next.js 16 frontend (Vercel-hosted)
    └── src/app/
        ├── layout.tsx                   # Root layout (Geist fonts, metadata)
        ├── page.tsx                     # Homepage (default Next.js starter)
        └── competitive/page.tsx         # /competitive — renders competitive-analysis.md as styled page
```

**Note:** The database (Supabase PostgreSQL) is not set up yet. The `docs/product-specs/restoros-architecture.md` contains the full planned architecture including 19 database tables, 50+ API endpoints, and AI pipelines.

## Planned Tech Stack (from specs)

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), shadcn/ui, Tailwind CSS 4, TanStack Query, Zustand |
| Backend | Python FastAPI (`backend/api/`) |
| Database | Supabase (PostgreSQL + Auth + Storage) (planned) |
| AI - LLM | Anthropic Claude (photo scoping, voice extraction) |
| AI - STT | Deepgram Nova-2 (voice transcription) |
| Frontend Hosting | Vercel |
| Backend Hosting | Railway |

## Development Commands

### Frontend (`web/`)

```bash
cd web
npm install          # Install dependencies
npm run dev          # Start dev server (next dev) — runs on port 3000
npm run build        # Production build
npm run lint         # ESLint (flat config, Next.js core-web-vitals + TypeScript rules)
```

### Backend (`backend/`)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn api.main:app --reload --port 8000
ruff check api/      # Lint
ruff format api/     # Format
```

## Frontend Architecture

- **Next.js 16** with App Router, uses `src/` directory (`@/*` path alias maps to `./src/*`)
- **Tailwind CSS 4** via `@tailwindcss/postcss` plugin (not the older Tailwind config approach)
- **Geist Sans + Geist Mono** fonts loaded via `next/font/google`, exposed as CSS variables
- **React 19** with Server Components as default
- The `/competitive` page reads `docs/competitive-analysis.md` at build time using `fs` and renders it with `react-markdown` + `remark-gfm` + Tailwind Typography plugin

## Key Spec Documents

When implementing features, always reference:
1. **`docs/product-specs/restoros-architecture.md`** — database schemas (SQL), API endpoint contracts, component tree, state management strategy, AI pipeline architecture, RLS policies
2. **`docs/product-specs/restoros-consumer-workflows-v1.md`** — detailed user workflows with triggers, steps, data requirements, edge cases
3. **`docs/competitive-analysis.md`** — market context, competitor features, pricing validation, co-founder interview (Brett Sodders)

## Domain Terminology

- **Xactimate** — industry-standard estimating software required by 99% of insurance carriers. Crewmatic generates data *for* Xactimate, not a replacement
- **Scope / Scoping** — the process of identifying and documenting damage + required repair work as line items
- **Line items** — individual work entries with Xactimate codes (e.g., `WTR DRYOUT`, `DRYWLL RR`), units, quantities
- **S500** — IICRC Standard for Professional Water Damage Restoration (industry bible)
- **Cat 1/2/3** — water contamination categories (clean/gray/black)
- **Class 1-4** — water damage severity based on volume and evaporation potential
- **GPP** — Grains Per Pound, a humidity measurement used to track drying progress
- **Dehu** — dehumidifier
- **ESX** — Xactimate's file format for estimate data (editable, so PDF is preferred export)
- **Adjuster** — insurance company representative who approves/denies scope and payment

## Implementation Priorities (from contractor feedback)

V1 Core (in priority order):
1. AI Photo Scope (with S500/OSHA justifications)
2. Job Management + Scheduling/Dispatch
3. Site Log (moisture readings + equipment tracking)
4. Photo Documentation
5. Reports (PDF default)
6. Room Sketching
7. Auto Adjuster Reports
8. Team Management

## Multi-Tenancy Pattern

Every data table uses `company_id` for tenant isolation. PostgreSQL RLS policies enforce boundaries at the database level. Three roles: `owner` > `admin` > `tech`. Auth via Supabase JWT.
