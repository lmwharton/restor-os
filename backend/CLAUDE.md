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

## Conventions

- Feature modules go in `api/{feature}/` with `router.py`, `service.py`, `schemas.py`
- All routes prefixed with `/v1` when included via `app.include_router(router, prefix="/v1")`
- Use `AppException` from `api.shared.exceptions` for error responses
- Use `get_supabase_client()` for user-scoped queries (respects RLS)
- Use `get_supabase_admin_client()` only for operations that bypass RLS (e.g., public report access)
- Linting: `ruff check api/` and `ruff format api/`
- Full API spec: `docs/product-specs/restoros-architecture.md` Part 5
