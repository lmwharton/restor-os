# CLAUDE.md — backend (FastAPI)

See root `../CLAUDE.md` for project overview and domain context.

## Local Development

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn api.main:app --reload --port 5174
```

Set `DEBUG=true` in `.env` to enable Swagger UI at `/docs`.

## Environment Variables

Create `backend/.env` (never committed):

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...          # anon key (respects RLS)
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # service role key (bypasses RLS)
CORS_ORIGINS=["http://localhost:3000"]
DEBUG=true
```

## Database Migrations (Alembic)

Alembic is used **only** for schema migrations via raw SQL. We do NOT use SQLAlchemy ORM -- all queries go through the Supabase Python client.

```bash
# Check current migration state
alembic current

# Run all pending migrations
alembic upgrade head

# Create a new migration (manual SQL, not autogenerate)
alembic revision -m "add_rooms_table"

# Stamp a migration as applied without running it
alembic stamp <revision>

# View migration history
alembic history
```

`DATABASE_URL` is loaded from `.env` / `.env.local` by `alembic/env.py`. On Railway, set `alembic upgrade head` as the pre-deploy command.

## Conventions

- Feature modules go in `api/{feature}/` with `router.py`, `service.py`, `schemas.py`
- All routes prefixed with `/v1` when included via `app.include_router(router, prefix="/v1")`
- Use `AppException` from `api.shared.exceptions` for error responses
- Use `get_authenticated_client(token)` for all user-scoped queries (passes user's JWT, RLS enforces tenant isolation). This is the default for ALL normal user operations.
- Use `get_supabase_admin_client()` ONLY for onboarding and platform admin operations (e.g., creating initial company/user records, public share link access). Never for normal user queries.
- Linting: `ruff check api/` and `ruff format api/`
- Full API spec: `docs/product-specs/restoros-architecture.md` Part 5
