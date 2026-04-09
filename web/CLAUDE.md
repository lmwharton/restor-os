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

## UI Design Conventions (MUST follow)

- **Primary buttons (desktop):** `h-9 rounded-lg text-[13px] font-semibold text-on-primary bg-brand-accent` + `hover:shadow-lg active:scale-[0.98] disabled:opacity-40`
- **Primary buttons (mobile):** `h-10 px-8 rounded-full text-[13px] font-semibold text-on-primary bg-brand-accent` — centered pill, NOT full-width. Never use fixed bottom bars for CTAs; place inline at end of content.
- **Delete buttons:** `h-9 rounded-lg text-[13px] font-medium text-red-600 border border-red-200 hover:bg-red-50`
- **Save + Delete together:** both `flex-1` — equal width, never one bigger
- **No native dialogs:** never `window.confirm/alert` — use `<ConfirmModal>` from `@/components/confirm-modal`
- **Back arrow:** `w-10 h-10 rounded-xl bg-surface-container-low active:bg-surface-container-high`, icon `size={20}`
- **Cards:** `bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04)]` with `p-4` or `p-5`
- **Selects:** `appearance-none` + custom SVG chevron, `h-9 px-3 pr-8 rounded-lg bg-surface-container-low text-[13px]`
- **Delete color:** `text-red-600` everywhere (matches Sign Out). Modal: `bg-red-600 text-white`
- **Headers:** sub-pages `text-lg font-semibold`, main pages `text-[16px] font-bold`
- **Inputs:** add `onFocus={(e) => e.target.select()}` on all text inputs
- **Disabled/coming-soon:** muted `bg-surface-container` with `border border-dashed border-outline-variant/50`, never a dimmed brand-accent button
- **Never full-width buttons on desktop** — use `inline-flex px-5` for compact buttons. Full-width only inside narrow containers (cards, modals, mobile bottom sheets)
- **"New" status color:** indigo `#4f46e5`, NOT red (red reads as error)
- **Consistency > beauty** — all section headings same size/weight, uniform spacing, don't mix monospace labels with bold headings at the same level
- **Explain before designing** — present the approach before implementing. Get approval. Implement in one cohesive pass, not incremental CSS patches

## AGENTS.md

<!-- BEGIN:nextjs-agent-rules -->
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
