# CLAUDE.md — web (Next.js frontend)

See root `../CLAUDE.md` for project overview and domain context.

## Next.js 16 Conventions

- App Router with `src/` directory structure
- Server Components by default; only add `'use client'` when needed
- All request APIs are async: `await cookies()`, `await headers()`, `await params`, `await searchParams`
- Use `proxy.ts` (not `middleware.ts`) for request interception in Next.js 16
- Path alias: `@/*` → `./src/*`

## Styling

- Tailwind CSS 4 via PostCSS (`@tailwindcss/postcss`) — no `tailwind.config.js`
- Typography plugin (`@tailwindcss/typography`) for rendered markdown content
- Geist Sans for UI text, Geist Mono for code/data — loaded as CSS variables in root layout

## AGENTS.md

<!-- BEGIN:nextjs-agent-rules -->
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
