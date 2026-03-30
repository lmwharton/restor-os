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
│   ├── design.md                        # Master PRD — product vision, V1 scope, architecture, AI pipeline
│   ├── research/                        # Evidence base (do not modify during implementation)
│   │   ├── competitive-analysis.md      # Market analysis + Brett's full interview (W1-W16) + insights
│   │   ├── xactimate-codes-water.md     # 50+ Xactimate WTR codes with selectors and units
│   │   ├── tpa-carrier-guidelines.md    # TPA rules, rejection triggers, carrier requirements
│   │   └── product-specs/               # Original product specifications
│   │       ├── README.md                # Product overview, tech stack, V1 scope
│   │       ├── restoros-architecture.md # Full technical architecture (18 DB tables, 50+ APIs)
│   │       └── restoros-consumer-workflows-v1.md  # 15 end-to-end user workflows
│   └── specs/                           # Implementation specs (one per feature)
│       ├── draft/                       # Specs being written
│       ├── in-progress/                 # Specs currently being implemented
│       └── implemented/                 # Completed specs
├── environment.md                       # Staging/production URLs and service dashboard links
└── web/                                 # Next.js 16 frontend (Vercel-hosted)
    └── src/app/
        ├── layout.tsx                   # Root layout (Geist fonts, metadata)
        ├── page.tsx                     # Homepage
        ├── competitive/page.tsx         # /competitive — renders competitive analysis
        ├── research/page.tsx            # /research — market research, interviews, evidence
        └── product/page.tsx             # /product — what we're building, specs, roadmap
```

## Document Hierarchy

```
Research (docs/research/)  →  Design (docs/design.md)  →  Specs (docs/specs/)  →  Code
  what we know                 what we're building         how we build each piece
```

- **Research** — raw evidence: competitive analysis, Brett's interview, Xactimate codes, TPA rules
- **Design** — ONE document: product vision, V1 scope, architecture, schema, AI pipeline rules
- **Specs** — one per feature, with checklist. Move between draft/ → in-progress/ → implemented/

**Note:** The database (Supabase PostgreSQL) is not set up yet. `docs/design.md` contains the V1 schema and API endpoints.

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

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
