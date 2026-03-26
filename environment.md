# Environments

## Local Development

| Service | URL | Port |
|---------|-----|------|
| Frontend (Next.js) | http://localhost:5173 | 5173 |
| Backend (FastAPI) | http://localhost:5174 | 5174 |
| Supabase API | http://127.0.0.1:55321 | 55321 |
| Supabase Studio | http://127.0.0.1:55323 | 55323 |
| Supabase DB (Postgres) | postgresql://postgres:postgres@127.0.0.1:55322/postgres | 55322 |
| Supabase Mailpit | http://127.0.0.1:55324 | 55324 |

### Start local dev

```bash
# 1. Start Supabase (runs migration automatically)
cd /Users/lakshman/Workspaces/Crewmatic
supabase start

# 2. Start backend (uses .env.local → local Supabase)
cd backend
source .venv/bin/activate
uvicorn api.main:app --reload --port 5174

# 3. Start frontend (uses .env.development.local → local Supabase + backend)
cd web
npm run dev -- --port 5173
```

### Environment files

| File | Points to | Purpose |
|------|-----------|---------|
| `backend/.env` | Cloud Supabase (staging) | Railway deployment |
| `backend/.env.local` | Local Supabase (55321) | Local dev (overrides .env) |
| `web/.env.local` | Cloud Supabase | Vercel deployment + staging |
| `web/.env.development.local` | Local Supabase (55321) | Local dev (overrides .env.local in dev) |
| `supabase/.env` | Google OAuth creds | Local Supabase Google auth |

## Staging

| Service | URL |
|---------|-----|
| Frontend (Vercel) | https://crewmaticai.vercel.app |
| Backend (Railway) | https://crewmatic-staging.up.railway.app |
| Supabase | https://wewxtwentwcqcpyghqhf.supabase.co |
| Supabase Studio | https://supabase.com/dashboard/project/wewxtwentwcqcpyghqhf |

## Production

| Service | URL |
|---------|-----|
| Frontend | TBD |
| Backend | TBD |

## External Services

| Service | Purpose | Dashboard |
|---------|---------|-----------|
| Vercel | Frontend hosting | https://vercel.com/dashboard |
| Railway | Backend hosting | TBD |
| Supabase | Database + Auth + Storage | https://supabase.com/dashboard/project/wewxtwentwcqcpyghqhf |
| Anthropic | Claude API (AI Photo Scope) | TBD |
| Deepgram | Voice transcription (STT) | TBD |
| Google Cloud | OAuth consent screen | https://console.cloud.google.com/apis/credentials |

## GitHub

| | |
|---|---|
| Repo | https://github.com/lmwharton/restor-os |
| Main branch | `main` |

## Port Convention

Crewmatic uses 5xxx/55xxx ports to avoid collisions with other local projects:

| Service | Port | Rationale |
|---------|------|-----------|
| Frontend | 5173 | Distinct from Next.js default 3000 |
| Backend | 5174 | Frontend + 1 |
| Supabase API | 55321 | Default 54321 + 1000 (avoids ServeOS collision) |
| Supabase DB | 55322 | Default 54322 + 1000 |
| Supabase Studio | 55323 | Default 54323 + 1000 |
| Supabase Mailpit | 55324 | Default 54324 + 1000 |
| Supabase Analytics | 55327 | Default 54327 + 1000 |
