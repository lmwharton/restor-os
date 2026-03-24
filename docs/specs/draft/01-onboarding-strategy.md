# Onboarding Strategy & Design

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 phases) |
| **State** | Draft — Strategic Review |
| **Blocker** | None |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-24 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] Activation metric defined and instrumented
- [ ] Onboarding flow implemented (sign-in through first AI scope run)
- [ ] Company knowledge store schema designed for progressive context capture
- [ ] Tech invite flow designed for multi-user transition
- [ ] Tests passing
- [ ] Code review approved

---

## Strategic Review

### 1. Activation Metric: What Is the "Aha Moment"?

**The aha moment is NOT seeing AI line items. It is seeing a non-obvious line item that the contractor would have missed.**

Here is the reasoning. Contractors already know how to identify obvious damage. They walk into a room with standing water and know they need `WTR DRYOUT`. The mundane line items are not impressive — they are expected. What makes Brett say "absolute game changer" is when the AI catches something like anti-microbial treatment behind drywall, or a content manipulation charge the tech forgot, or an S500-mandated air scrubber that no one wrote down. That is the moment the contractor realizes this tool will make them more money on every single job.

**Proposed activation metric:** User runs AI Photo Scope AND approves at least one non-obvious line item (items flagged with the orange border / "AI found this" label).

This is measurable (we track `is_non_obvious` on `line_items` and approval status), it correlates with the value proposition ("catches what you miss"), and it distinguishes Crewmatic from a generic photo upload tool.

**What Notion/Linear/Figma teach us here:** Each of these products has an activation metric tied to the core differentiator, not generic usage. Notion's is creating a page with linked databases (not just "creating a page"). Linear's is completing an issue from the keyboard (not just "creating a project"). Figma's is placing a component from a shared library (not just "drawing a rectangle"). The pattern: activate on the thing that makes you different, not the thing that makes you functional.

**Recommended instrumentation:**
- Track: `time_to_first_scope_run` (minutes from signup to first AI scope)
- Track: `non_obvious_items_approved` (count per scope run)
- Track: `non_obvious_items_dismissed` (if users consistently dismiss, the AI is hallucinating)
- Activation = first scope run with >= 1 non-obvious item approved
- Target: activation within first session (same day as signup)

---

### 2. "Try Before You Buy": Where Should the AI Demo Live?

**Recommendation: Public landing page demo with synthetic photos, NOT the user's own photos.**

Three options, evaluated:

**Option A: Pre-signup on the landing page (RECOMMENDED)**

Put a "See it in action" button on crewmatic.ai that runs AI Photo Scope on a pre-loaded set of damage photos (a kitchen with Category 2 water damage, for example). The user sees real line items generated in real time — including the non-obvious ones highlighted with the orange border. No signup required.

Why this wins:
- Contractors are skeptical. Brett said "as long as it looks legitimate." Showing them the output before asking for credentials removes the risk of "this is vaporware."
- Encircle does NOT do this. Their AI Scope requires an Encircle subscription to try. This is a competitive advantage in demos, trade shows, and word-of-mouth.
- The cost is low. One pre-cached AI run with synthetic results. No need to hit the API on every page load — pre-compute the results and animate the "generation" for dramatic effect.
- It creates a shareable artifact. A contractor can screenshot the demo and send it to another contractor. "Look what this thing found."

**Why NOT the user's own photos pre-signup:**
- Uploading real property photos before creating an account raises liability and privacy concerns (client property data with no terms of service accepted).
- If the AI produces bad results on the user's first photo (blurry shot, non-damage photo, unusual damage type), the first impression is negative and unrecoverable.
- Pre-signup photo upload requires building upload infrastructure that works for anonymous users — engineering waste.

**Option B: Post-signup, pre-first-job**
The current proposal ("Optional: Try AI Photo Scope demo"). This is fine but suboptimal. The user has already committed (signed up) but has not yet formed a habit. The demo at this stage feels like a tutorial, not a discovery moment.

**Option C: Post-first-job**
Too late. If the user creates a job, uploads photos, and THEN discovers AI scope, you have already lost the contractors who would have churned during the manual setup phase. The ones who stayed would have found AI scope anyway.

**The Lightfield parallel is instructive but needs adaptation.** Lightfield's "self-assembling CRM" works because CRM data (emails, calendar) already exists somewhere else and can be imported. Restoration data does NOT exist digitally — that is the whole problem. The contractor's "data" is a wet basement and a phone camera. You cannot self-assemble from nothing. So the Lightfield lesson is not "import existing data" but rather "show value before asking for effort." The landing page demo achieves this.

---

### 3. Single-User to Multi-User Transition: What Breaks

When Brett invites his first tech, five things break in this onboarding:

**Break 1: The tech does not care about AI Photo Scope.**
The tech's aha moment is different from the owner's. Brett cares about "more money per job." His tech cares about "less paperwork, go home earlier." The onboarding for a tech should emphasize speed: "Take photos, AI does the rest, you're done." Not "look at these amazing line items."

**Break 2: No role-aware onboarding.**
The current flow assumes every user is an owner creating a workspace. When a tech receives an invite link, they should NOT see "Name your workspace." They should see "You've been invited to [DryPros]. Accept invite." Then go straight to their assigned jobs.

**Break 3: AI Photo Scope permissions.**
Should techs be able to run AI Photo Scope, or only upload photos for the owner to scope? This is a business decision with cost implications (each scope run costs API credits). The onboarding needs to surface this choice to the owner: "When your techs upload photos, should AI auto-scope or wait for your review?"

**Break 4: The company knowledge store is owner-only.**
Phase 2 (company context — services, equipment preferences, protocols) is something only the owner should configure. But the tech needs to benefit from it (e.g., if the company always uses a specific dehu brand, the AI should know that). The onboarding should make it clear: owner configures, everyone benefits.

**Break 5: Notification setup.**
Brett needs to know when a tech uploads photos or completes a scope. This is not in the current onboarding. Add a step during the first tech invite: "How do you want to be notified when your team submits work?"

**Recommended approach for V1:** Do not build multi-user onboarding yet. Brett is the only user. But design the single-user onboarding so it does not create technical debt. Specifically:
- The workspace creation step already exists (good).
- Store `user_role` from day one, even if Brett is the only user.
- When tech invites ship (V1.1 or V2), build an invite-specific onboarding path that bypasses workspace creation.

---

### 4. Competitive Moat via Onboarding: The Knowledge Store

**Yes, the onboarding can create switching costs. The mechanism is the company knowledge store.**

This is the most strategically important piece of the entire onboarding. Here is why:

Every time the AI runs a scope, it learns company-specific context:
- This company does residential water restoration in Michigan (affects material codes, labor rates, travel charges).
- This company uses LGR dehumidifiers, not conventional (affects equipment line items).
- This company always applies anti-microbial treatment to Category 2+ jobs (affects auto-included line items).
- This company's preferred Xactimate codes and descriptions (affects output format).
- Adjuster feedback patterns: "State Farm adjusters in Michigan always reject air scrubber charges over 3 days" (affects AI suggestions).

**The more a contractor uses Crewmatic, the smarter it gets for THEIR specific business.** This is the data moat. Switching to Encircle means starting from zero — the AI does not know your preferences, your market, your adjusters, or your equipment.

**How to build this into onboarding (progressive, not upfront):**

Phase 2 of the current proposal ("Company Context") is correct in spirit but should be restructured:

| When | What to capture | How |
|------|----------------|-----|
| Signup | Company name, phone, location (state/metro) | Form field |
| First job created | Loss type distribution (water/fire/mold) | Inferred from job data |
| First AI scope run | Review AI's equipment assumptions, correct if wrong | Inline during scope review |
| After 3 scope runs | "We noticed you always add [X]. Want us to auto-include it?" | Prompt |
| After 5 scope runs | "Your AI accuracy is 87%. Here's what it's learned about your business." | Dashboard insight |
| After 10 scope runs | Full company profile: preferred codes, equipment, protocols | Settings page (auto-populated) |

This is the Lightfield pattern done right: the product builds its own context from usage, not from an upfront questionnaire that the user abandons.

**Switching cost math:** After 50 scope runs, Crewmatic's AI has learned ~200 company-specific preferences. Reproducing this in Encircle (which does not have a knowledge store) is impossible. In a competitor that does, it takes 50 scope runs to retrain. That is 2-3 months of daily use. This is a real moat.

---

### 5. What Notion/Linear/Figma Got Right

**Notion: Templates as onboarding.**
Notion does not drop you into a blank page. It offers templates that give you structure immediately. Crewmatic equivalent: when Brett creates his first job, pre-populate the form with a realistic example (a Cat 2 kitchen water loss in Michigan) so he can see what a complete job looks like. Let him edit or delete it. This is faster than a tutorial and more concrete than an empty form.

**Linear: Speed as the value prop.**
Linear's onboarding is fast — create workspace, create first issue, done. No tutorial, no video, no "take a tour." The product IS the onboarding. Every interaction is designed to be faster than the alternative (Jira). Crewmatic should follow this. Do not add a product tour. Do not add a "getting started" checklist. The product itself should be so obviously faster than paper + phone that the onboarding IS using the product.

**Figma: Multiplayer from day one.**
Figma shows you a cursor with your name on it, even when you are alone. This plants the seed: "other people will be here." Crewmatic equivalent: in the job detail view, show "Created by Brett Sodders" with an avatar. When techs join later, their names appear naturally. The product already feels multiplayer even when Brett is alone.

**The anti-pattern to avoid (from all three):**
Do not gate core features behind onboarding completion. Notion lets you use the product before you finish the welcome flow. Linear does not require you to set up integrations before creating issues. Figma does not require you to invite teammates before designing. Crewmatic should not require company context (Phase 2) before running AI Photo Scope. Let Brett upload photos and scope on minute one. Capture company context later, progressively.

---

## Evaluation Summary

### 3 Strategic Strengths

1. **Minimal time-to-value.** Two minutes to an empty job list is correct. The instinct to strip onboarding to the minimum is right. Most contractor software (DASH, Encircle) requires a sales call, a demo, a setup appointment, and sometimes an on-site training. Crewmatic letting you sign in with Google and be working in two minutes is a genuine competitive advantage, especially at trade shows and word-of-mouth demos.

2. **Progressive context capture is the right model.** Not asking for equipment preferences, service types, and protocols upfront is correct. Contractors will abandon a 15-field onboarding form. The Lightfield-inspired approach of learning from usage is the right call for this market.

3. **The job shell creates stickiness beyond the AI trick.** AI Photo Scope alone is a feature demo. Wrapping it in job management (the "shell" from design.md) means the contractor's data lives in Crewmatic. Every job, every photo, every scope run increases switching cost. This is well understood in the existing specs and should be preserved.

### 3 Strategic Risks

1. **The "optional" AI demo will be skipped.** If the Phase 1 demo is optional, most users will skip it (industry benchmark: 70-80% skip optional onboarding steps). But the AI demo IS the product. If a user signs up, sees an empty job list, and never runs AI Photo Scope, they will churn. **Recommendation:** Make the first scope run near-mandatory. Either pre-load a demo job with photos and prompt "Run AI Scope on this sample job?" or guide the user to upload their first real photo within the first session. Do not leave it as an optional sidebar.

2. **No failure state design for AI.** What happens when the AI generates bad line items? Wrong Xactimate codes? Hallucinated damage? The onboarding does not address this, but the first bad AI result will determine whether the contractor trusts the product. **Recommendation:** Build a feedback loop into the first scope run: "Were these accurate? [Thumbs up / Thumbs down / Mixed]." Use this to calibrate expectations and to feed the knowledge store. Show the contractor that the AI learns from corrections.

3. **Encircle Scope is live and shipping.** The competitive analysis correctly flags Encircle as CRITICAL threat. Their AI Scope launched in March 2026 with a free trial. Every month Crewmatic does not ship is a month Encircle's AI gets better with real contractor data. The onboarding strategy is fine, but speed-to-market matters more than onboarding polish. **Recommendation:** Ship the simplest possible onboarding (Google sign-in, company name, first job with AI scope) and iterate. Do not build the knowledge store, progressive context capture, or multi-user onboarding before the core AI Photo Scope flow is live and in Brett's hands.

### The Single Most Important Thing to Get Right

**The first AI scope run must produce results that look like a real Xactimate scope.**

Not "AI-generated suggestions." Not "here are some line items we found." It must look like something a contractor would actually hand to an adjuster. Real Xactimate codes. Real quantities with correct units. Real S500 citations. And at least one non-obvious item that makes the contractor think "I would have missed that."

If the first scope run looks like a toy, the product is dead. If it looks like a professional scope, the product sells itself. Everything else — onboarding speed, knowledge store, multi-user, progressive context — is secondary to this.

Brett said it: "as long as it looks legitimate, the older generation of contractors would absolutely use it."

The onboarding is not the product. The AI scope output is the product. The onboarding's only job is to get the contractor to that output as fast as possible.

---

## Overview

**Problem:** Contractors need to experience Crewmatic's AI value within minutes of first contact, not after a lengthy setup process. The onboarding must bridge from "skeptical contractor who heard about this at a trade show" to "contractor who has seen the AI find a line item they would have missed" in a single session.

**Solution:** A three-layer onboarding strategy: (1) public landing page demo with pre-loaded AI scope results, (2) two-minute signup to first job, (3) progressive company knowledge capture from usage patterns — not upfront forms.

**Scope:**
- IN: Signup flow, first-run experience, landing page demo, company context capture strategy, activation metric instrumentation, first AI scope run UX
- OUT: Multi-user/tech invite onboarding (V1.1), pricing/billing integration, Xactimate import/export, offline onboarding, notification preferences

## Phases & Checklist

### Phase 1: Landing Page AI Demo — Not Started
- [ ] Create pre-computed AI scope result set (realistic Cat 2 kitchen water loss)
- [ ] Build "See AI Photo Scope in action" component on landing page
- [ ] Animated line-item generation (streaming appearance, non-obvious items highlighted)
- [ ] "Sign up to try with your own photos" CTA after demo completes
- [ ] Track: demo_viewed, demo_completed, demo_to_signup_conversion

### Phase 2: Minimal Signup Flow — Not Started
- [ ] Google OAuth sign-in (from bootstrap spec 00)
- [ ] Workspace creation: company name + phone (from bootstrap spec 00)
- [ ] Post-signup: guided first job creation with sample data option
- [ ] "Try with sample photos" pre-loaded job OR "Upload your own photos" choice
- [ ] If sample: pre-loaded Cat 2 kitchen photos, prompt to run AI scope
- [ ] If own: photo upload, prompt to run AI scope after 3+ photos uploaded
- [ ] Track: time_to_first_scope_run, path_chosen (sample vs own)

### Phase 3: First Scope Run Experience — Not Started
- [ ] AI scope results with non-obvious items highlighted (orange border, "AI found this")
- [ ] Inline editing of line items (tap to edit code, description, quantity)
- [ ] Feedback prompt after first run: "How did the AI do?" (accurate / mostly / needs work)
- [ ] If "needs work": collect specific corrections, feed to knowledge store
- [ ] Track: non_obvious_items_approved, non_obvious_items_dismissed, feedback_rating
- [ ] Export PDF of scope (the "shareable artifact" that drives word-of-mouth)

### Phase 4: Progressive Knowledge Capture — Not Started
- [ ] After first scope: infer location (state/metro) from job address
- [ ] After first scope: prompt to confirm/correct equipment assumptions
- [ ] After 3 scopes: "We noticed you always [X]. Auto-include?" prompt
- [ ] After 5 scopes: AI accuracy dashboard showing what it has learned
- [ ] Company knowledge store schema: `company_preferences` table (equipment, protocols, common corrections, preferred codes)
- [ ] Track: knowledge_store_entries_count, ai_accuracy_over_time

## Technical Approach

The onboarding builds on bootstrap spec 00 (auth, workspace creation, empty job list). Key additions:

**Landing page demo:** Static pre-computed JSON result set rendered with the same `LineItemCard` component used in the real product. No API call needed — animate the reveal client-side. This avoids API costs and ensures consistent demo quality.

**First-run routing logic:**
```
User signs in → has company?
  NO → workspace creation → first job prompt
  YES → has any jobs?
    NO → first job prompt (with sample option)
    YES → job list (normal flow)
```

**Knowledge store schema addition:**
```sql
CREATE TABLE company_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    preference_key TEXT NOT NULL,  -- e.g., 'default_dehu_type', 'auto_include_antimicrobial'
    preference_value JSONB NOT NULL,
    source TEXT NOT NULL DEFAULT 'inferred',  -- 'inferred' | 'user_confirmed' | 'manual'
    confidence FLOAT DEFAULT 0.5,  -- 0-1, increases with confirmations
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(company_id, preference_key)
);
```

**Activation metric instrumentation:** Add event tracking to the scope run flow. Use a simple events table or Posthog/Mixpanel (decision deferred). Key events: `signup`, `workspace_created`, `first_job_created`, `first_scope_run`, `non_obvious_approved`, `pdf_exported`.

**Key Files:**
- `web/src/app/page.tsx` — Landing page with AI demo component
- `web/src/app/(auth)/login/page.tsx` — Sign-in page
- `web/src/app/(app)/onboarding/page.tsx` — Workspace creation + first job prompt
- `web/src/app/(app)/jobs/[id]/scope/page.tsx` — AI scope results with feedback
- `backend/api/routes/preferences.py` — Company preferences CRUD
- `backend/api/models/preferences.py` — Knowledge store schema

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, landing page AI demo
# Depends on: spec 00 (bootstrap) for auth and workspace creation
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

**2026-03-24 — Strategic review completed.** Key decisions:
- Activation metric = first scope run with non-obvious item approved (not just "saw line items")
- Landing page demo uses pre-computed results (no live API, no user photo upload pre-signup)
- First scope run should be near-mandatory, not optional — offer sample photos as low-friction path
- Knowledge store is progressive (inferred from usage), not upfront (questionnaire)
- Multi-user onboarding deferred to V1.1 — but store user_role from day one
- Speed-to-market prioritized over onboarding polish — Encircle Scope is live
