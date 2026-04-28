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

### Status Badge Colors — Job Lifecycle (Spec 01K, 9 statuses)

These are the lifecycle status colors. **No blue** (DESIGN.md says no blue-gray palette). Active uses the Crewmatic brand orange to signal "work is happening here."

| Status | Text | Background | Memorable thing |
|--------|------|-----------|-----------------|
| Lead | #6b6560 | #f5f5f4 | Neutral — pipeline entry, no commitment |
| Active | #e85d26 | #fff3ed | **Brand orange** — crew is moving, this is "live" |
| On Hold | #d97706 | #fffbeb | Amber — paused, not scary |
| Completed | #2a9d5c | #edf7f0 | Green — work done, ready for invoicing |
| Invoiced | #5b6abf | #eef0fc | Indigo — money in flight |
| Disputed | #b45309 | #fef3c7 | Darker amber + **orange ring on map pin** for visual differentiation from On Hold |
| Paid | #059669 | #ecfdf5 | Emerald — closed |
| Cancelled | #9b1c1c | #fef2f2 | Red — terminal sad |
| Lost | #b5b0aa | #f5f5f4 | Muted grey + strikethrough on label — never converted |

**Differentiation rule:** Active / On Hold / Disputed all sit in the warm-orange spectrum. Distinguish via:
- Active = pure brand orange (#e85d26) — brightest, used everywhere
- On Hold = yellow-tilted amber (#d97706 / #fffbeb) — softer
- Disputed = darker amber (#b45309) + orange ring on dashboard map pins (shape differentiator)

### Status Badge Colors — Legacy (pre-01K)

The 5-status palette below is the pre-01K legacy palette. Once 01K migration runs, all jobs use the 9-status palette above. Kept here for reference until legacy code is removed.

| Status | Text | Background |
|--------|------|-----------|
| Needs Scope | #6b6560 | #f5f5f4 |
| Scoped | #2a9d5c | #edf7f0 |
| Submitted | #5b6abf | #eef0fc |
| Draft | #8a847e | #f5f5f4 |
| In Progress | #d97706 | #fffbeb |

### Contract Status Badge (header)

When `contract_signed_at IS NOT NULL` on a job, show a small badge in the job detail header:

```
[ ✓ Contract signed ]   bg-[#edf7f0] text-[#2a9d5c] px-2 py-0.5 rounded text-[12px] font-medium
```

Pin badge inline next to the job number, never larger than the job number itself.

### Disputed Map Pin (dashboard)

Standard pin = filled circle in status color. Disputed pin gets an extra visual:

```
   ┌──┐  ← orange ring (#e85d26, 2px)
   │██│  ← amber fill (#b45309)
   └──┘
   "Disputed" label below pin in 11px text-[#b45309]
```

The ring on top of the fill is what makes Disputed visually distinct from On Hold at glance distance.

## Modals (new pattern for 01K)

01K introduces two key modals: **Status Change** and **Closeout Checklist**. Both follow the same pattern.

### Modal Container

```
- Overlay: bg-black/40 backdrop-blur-sm
- Container: bg-white rounded-xl shadow-xl max-w-md w-full mx-4
- Padding: 24px on all sides
- Border: none (shadow + rounded does the work)
```

### Modal Structure

```
┌─────────────────────────────────────┐
│ [Title] · 17px font-semibold        │
│ [Subtitle] · 13px text-[#8a847e]    │  ← 4px gap
│ ─────────────────────────────────── │  ← 24px gap
│                                     │
│ [Body content]                      │
│                                     │
│ ─────────────────────────────────── │  ← 24px gap, 1px border-t #eae6e1
│        [Cancel]    [Primary action] │  ← 12px gap between buttons
└─────────────────────────────────────┘
```

### Status Change Modal — specific layout

```
Title: Change job status
Subtitle: 1042 Maple St · Active

[Status selector] — pill buttons in a row, 1 per legal transition
  ┌────────┐ ┌──────────┐ ┌───────────┐
  │ Mark   │ │ Put on   │ │  Cancel  │
  │ done   │ │  hold    │ │  job     │
  └────────┘ └──────────┘ └───────────┘
  (active state uses target-status color from palette above)

[Reason field] — only shown when target status requires reason (on_hold, cancelled, lost, disputed)
  Label: "Reason" · 13px text-[#6b6560]
  Textarea: 3 rows, full-width, standard input styling

[For on_hold only: Resume date]
  Label: "Expected resume date (optional)"
  Date picker (native or custom)

[Gate failures section] — only shown if closeout gates fail
  ⚠️  Contract not signed (acknowledge)
  ⚠️  2 air movers still placed (warning)
  [Close anyway reason ▾]   ← dropdown, only shown if any 'acknowledge' gate failed

[Footer buttons]
  [Cancel] (ghost) · [Submit] (primary, color matches target status)
```

### Closeout Checklist Modal — specific layout

```
Title: Mark this job completed?
Subtitle: 1042 Maple St · Mitigation

[Checklist] — one row per gate item, with icon + label + status
  ✅ Contract signed
  ✅ Photos tagged Final/After (4 of 4 rooms)
  ⚠️  2 air movers still placed                   ← amber warning icon
  ✅ All rooms at dry standard
  ✅ Scope finalized (estimate sent 4/10)
  🚫 Certificate not yet generated                ← red icon — hard block

[If any 'acknowledge' gate fails → Close Anyway reason]
  Label: "Why are you closing without [item]?"
  Dropdown: Customer requested early completion / Scope transferred / Job cancelled partial / Dry standard override already logged / Other (free text)

[Footer]
  [Cancel] (ghost) · [Mark Completed] (primary green, disabled if hard_block)
```

### Modal Touch Targets

- Buttons: 48px minimum height (gloves)
- Pill selectors: 56px min — bigger because tech might be deciding fast
- Form inputs: 48px min height, 16px font (no iOS zoom)

## Settings — Closeout Requirements Page

Admin page at `/settings/closeout`. Owner / admin role only.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│ Closeout Requirements                                    │
│ Configure when each job type is allowed to be marked    │
│ Completed.                                               │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │                Mit    Build-Back   Fire/Smoke      │  │
│ │ Contract       [Ack▾] [Ack▾]       [Ack▾]          │  │
│ │ Photos/room    [Warn▾][Warn▾]      [Warn▾]         │  │
│ │ Moisture/room  [Warn▾](n/a)        (n/a)           │  │
│ │ ...                                                │  │
│ │                                                    │  │
│ │ [Reset Mit]  [Reset Build-Back]  [Reset Fire/Smoke]│  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ Legend:                                                  │
│ ⚠️  Warning    Ack  Must acknowledge    🚫 Hard block    │
└──────────────────────────────────────────────────────────┘
```

- Table: 1024px max-width, 1px borders #eae6e1, no shadows
- Cell dropdown: 32px height, full-width within cell, white bg, border-[#eae6e1] rounded-md
- (n/a) cells: muted grey #b5b0aa, italic, no dropdown
- Reset buttons: ghost style, only confirms after AskUserQuestion-style modal
- Help text below table: "Default for new companies: all Warning except Contract Signed = Must Acknowledge"

## Job Detail Header — additions for 01K

Add three new pieces below the job number:

```
JOB-20260418-007        Active                    1042 Maple St
                                                  ──────────────
                        [✓ Contract signed]                    
                        Cycle time: 4 days        Days to payment: —
                        ──────────────────        ──────────────
```

- Cycle time appears once status reaches Completed (computed from `active_at → completed_at`)
- Days-to-payment appears once status reaches Paid (computed from `invoiced_at → paid_at`, excluding time spent in `disputed`)
- Both styled: 11px text-[#8a847e] uppercase tracking-wide for label, 13px text-[#1a1a1a] font-semibold for value

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
