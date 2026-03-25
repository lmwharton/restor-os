# Crewmatic Design System

> Source of truth for all UI implementation. Reference this file when building any screen.
> Based on [crewmatic.ai](https://crewmatic.ai) brand identity.

## Brand

- **Name:** crewmatic (lowercase in logo, Title Case in prose)
- **Tagline:** The Operating System for Restoration Contractors
- **Logo:** Text-only for now — "crewmatic" in Geist Semibold 17px, tracking -0.45px, color #1a1a1a

## Typography

| Role | Font | Size | Weight | Letter Spacing | Color |
|------|------|------|--------|----------------|-------|
| Logo | Geist Sans | 17px | 600 (semibold) | -0.45px | #1a1a1a |
| Page title | Geist Sans | 32-40px | 700 (bold) | -1.5px | #1a1a1a |
| Section heading | Geist Sans | 20px | 700 | -0.5px | #1a1a1a |
| Subsection heading | Geist Sans | 15-16px | 600 | normal | #1a1a1a |
| Body text | Geist Sans | 14-15px | 400 | normal | #171717 |
| Secondary text | Geist Sans | 14px | 400 | normal | #6b6560 |
| Description/caption | Geist Sans | 13px | 400 | normal | #8a847e |
| Muted/footer | Geist Sans | 13px | 400 | normal | #b5b0aa |
| Monospace/code | Geist Mono | 13px | 400 | normal | #171717 |

**Fonts are loaded via `next/font/google` in layout.tsx as CSS variables.**

## Colors

### Core Palette

| Role | Hex | RGB | Usage |
|------|-----|-----|-------|
| Background | #ffffff | 255, 255, 255 | Page background |
| Primary text | #1a1a1a | 26, 26, 26 | Headings, nav, interactive text |
| Body text | #171717 | 23, 23, 23 | Paragraph body copy |
| Secondary text | #6b6560 | 107, 101, 96 | Subtitles, nav links |
| Caption text | #8a847e | 138, 132, 126 | Descriptions, helper text |
| Muted text | #b5b0aa | 181, 176, 170 | Footer, disabled |
| Border | #eae6e1 | 234, 230, 225 | Dividers, card borders |

### Accent Colors

| Role | Foreground | Background | Usage |
|------|-----------|-----------|-------|
| Primary (orange) | #e85d26 | #fff3ed | CTAs, links, eyebrow labels, active states |
| Success (green) | #2a9d5c | #edf7f0 | Status badges (scoped, done), positive indicators |
| Info (indigo) | #5b6abf | #eef0fc | Status badges (submitted), secondary actions |
| Warning (amber) | #d97706 | #fffbeb | In-progress badges, attention-needed states |
| Error (red) | #dc2626 | #fef2f2 | Error messages, destructive actions |
| Non-obvious (orange) | #e85d26 | #fff3ed | AI-found line items (orange left border) |

### Status Badge Colors

| Status | Text | Background |
|--------|------|-----------|
| Needs Scope | #6b6560 | #f5f5f4 |
| Scoped | #2a9d5c | #edf7f0 |
| Submitted | #5b6abf | #eef0fc |
| Draft | #8a847e | #f5f5f4 |
| In Progress | #d97706 | #fffbeb |

## Layout

- **Max width:** 768px for content pages (research, product, auth)
- **Max width:** 1024px for app pages (job list, job detail) — needs more room for data
- **Horizontal padding:** 24px (px-6)
- **Nav height:** ~60px
- **Section spacing:** 32px (py-8) between major sections
- **Card/row spacing:** 12px (py-3) between list items
- **Dividers:** 1px solid #eae6e1 between rows

## Components

### Buttons

| Type | Style |
|------|-------|
| Primary | bg-[#e85d26] text-white px-6 py-2.5 rounded-lg font-medium hover:bg-[#d14e1c] |
| Secondary | border border-[#eae6e1] text-[#1a1a1a] px-6 py-2.5 rounded-lg font-medium hover:bg-[#f5f5f4] |
| Ghost | text-[#6b6560] hover:text-[#1a1a1a] px-4 py-2 rounded-lg |
| Destructive | text-[#dc2626] hover:bg-[#fef2f2] px-4 py-2 rounded-lg |

### Inputs

| Style |
|-------|
| border border-[#eae6e1] rounded-lg px-4 py-3 text-[14px] text-[#1a1a1a] placeholder-[#b5b0aa] focus:border-[#e85d26] focus:ring-1 focus:ring-[#e85d26] |

### Cards / Rows

- No shadows. Use thin borders (#eae6e1) and dividers.
- Hover: border-[#e85d26]/30 for interactive cards
- Icon badges: 40x40px, rounded-[12px], tinted background

### Nav

```
┌─────────────────────────────────────┐
│ crewmatic          Company   [Sign] │
│ (logo)             Name      Out    │
└─────────────────────────────────────┘
```

- Sticky top
- White background, bottom border #eae6e1
- Logo left, company name + sign out right

## Mobile / Field Readiness

- **Touch targets:** 48px minimum height for all interactive elements (contractors wear gloves)
- **One-handed operation:** Forms stacked vertically, submit buttons pinned to bottom
- **Input sizing:** Full-width inputs, large text (16px minimum to prevent iOS zoom)
- **Loading states:** Every action that hits the API needs a loading indicator
- **Error states:** Clear message + retry action. Never a dead end.
- **Empty states:** Always show what to do next, never just blank space

## Don'ts

- No dark backgrounds (except marketing/landing pages)
- No gradients
- No card shadows (use borders instead)
- No blue-gray palette (use warm grays)
- No generic emoji in UI (only in marketing pages)
- No "Lorem ipsum" — always use realistic restoration contractor content
- No hiding the sign out button — contractors need to hand phones to techs
