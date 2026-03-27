# AI Feature Naming & Information Architecture

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/3 phases) |
| **State** | Draft — Awaiting Review |
| **Blocker** | None |
| **Branch** | N/A (design spec, not code) |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-26 14:00 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] Every AI feature has a contractor-friendly name (no "AI" in the label)
- [ ] Features grouped by workflow step, not by technology
- [ ] Clear distinction: which features are buttons vs automatic/invisible
- [ ] Information architecture documented (what a new user sees and when)
- [ ] Naming applied to Spec 02 (ai-pipeline) and Spec 03 (voice)
- [ ] Brett confirms naming makes sense

## Overview

**Problem:** Crewmatic currently brands 8+ features with "AI" in the name: "AI Cleanup," "AI Edit," "Analyze with AI," "Hazard Scan," "Audit Scope," "Train AI," "Hold to Speak," "AI Chat." Brett's reaction: "There are so many AI things -- it's confusing." If the co-founder is overwhelmed, every new user will be too.

**Solution:** Remove "AI" from almost all feature names. Name features by what they DO for the contractor, not what technology powers them. Group by workflow step. Make most intelligence invisible (it just works). Only surface explicit actions when the contractor needs to make a decision.

**Scope:**
- IN: Naming convention, feature grouping, visibility model, information architecture, "holy shit" moment design
- OUT: UI wireframes, implementation changes, backend naming (internal code can still say "ai")

---

## The Naming Problem, Diagnosed

Brett thinks in this workflow:

```
Show up at site -> Take photos -> Figure out what to bill -> Write it up -> Send to adjuster -> Get paid
```

He does NOT think: "Now I will use AI Feature #4." Every feature name should answer one question: **"What does this do for me on the job?"**

Three rules for naming:
1. **Name the outcome, not the technology.** "Scope Check" not "AI Scope Auditor."
2. **Use contractor language.** "Line Items" not "Analyze." "Hazard Flag" not "AI Hazmat Scanner."
3. **If it is automatic, it has no name.** The contractor never sees it. It just works.

---

## Phase 1: Naming Recommendations

### The Rename Table

| Current Name | New Name | Why |
|---|---|---|
| "Analyze with AI" | **"Generate Line Items"** | This is the button Brett taps after uploading photos. It says exactly what happens: photos become billable line items. No ambiguity. |
| "AI Cleanup" (sketch) | **"Clean Up Sketch"** | Action verb. Brett drew a rough sketch, now he wants it cleaned up. He does not care that AI does it. |
| "AI Edit" (sketch) | **"Edit Sketch"** (with text input) | Just a text box on the sketch tool. Placeholder: "Add a hallway on the north side..." The AI is invisible — it is just a smart text box. |
| "Hazard Scan" | **"Check for Hazards"** | Verb form. Contractor is asking the app to check. Keep it as a distinct action because findings have legal/safety weight — it should not be silent. |
| "Audit Scope" | **"Scope Check"** | Short. Contractor language. "Check my scope before I send it." Like a spell-checker for estimates. |
| "Train AI" | **"Upload Past Scopes"** | Brett does not want to "train AI." He wants the app to learn his patterns. The label describes what HE does (upload PDFs), not what the system does. |
| "Hold to Speak" | **"Talk to Fill"** (or no label — just a mic icon) | The mic icon is sufficient. If a label is needed, "Talk to Fill" says what happens: you talk, fields fill in. |
| "AI Chat" (job Q&A) | **"Job Assistant"** | Or just a chat bubble icon in the job view. "Ask anything about this job." The word "assistant" implies helpfulness without "AI." |
| Photo quality feedback | **(No name — automatic)** | If a photo is blurry/dark, show a yellow banner: "This photo may be too dark for accurate results. Retake?" No feature name. It just happens. |
| Non-obvious item highlighting | **(No name — inline)** | Items the system found that the contractor might have missed show with a subtle highlight and tooltip: "Commonly missed — review this." No separate feature. |

### The "AI" Word: When to Use It

**Almost never in the UI.** Here is the rule:

- **Feature labels:** Never say "AI." Say what the feature does.
- **Marketing/landing page:** Use "AI" liberally. "AI-powered line item generation." "Smart scope checking." This is where "AI" sells.
- **Onboarding tooltips (first use only):** Brief mention. "Crewmatic uses AI to analyze your photos and suggest line items. You review and approve everything." Then never mention it again.
- **Settings/preferences:** "Smart Features" section if the contractor wants to toggle anything.

The only place "AI" might appear in the working UI: a small "Smart Suggestions" label on non-obvious items, or a subtle sparkle icon. But even this should be tested — Brett may not care.

---

## Phase 2: Feature Grouping by Workflow Step

### Current Problem
Features are scattered across tabs (Photos tab, Report tab, Settings) with no logical grouping. A new user sees random buttons.

### Recommended Grouping

Group features by WHERE the contractor is in their workflow, not by technology:

```
JOB WORKFLOW
============

1. SET UP JOB
   - Create job (customer, address, insurance)
   - Voice: "Talk to Fill" mic icon on every form field (invisible — just a mic button)

2. DOCUMENT THE SITE
   - Take/upload photos (auto-tagged to rooms when possible)
   - Draw floor plan ("Clean Up Sketch" after rough drawing)
   - Photo quality warnings (automatic, no button)

3. BUILD YOUR SCOPE
   - "Generate Line Items" (the big button — photos become line items)
   - Review, edit, add, delete line items (manual work)
   - "Scope Check" (pre-submission audit — "did I miss anything?")
   - Non-obvious items highlighted inline (automatic)

4. CHECK FOR HAZARDS
   - "Check for Hazards" (explicit button — separate from scope because findings are safety/legal)

5. CREATE REPORT
   - "Push to Report" (approved line items become the PDF)
   - Branded PDF generation

6. LEARN FROM HISTORY (Settings / Onboarding)
   - "Upload Past Scopes" (one-time or periodic)
```

### Why This Order Matters

This matches how Brett actually works on a job site:
1. He gets the call, creates the job in his truck.
2. He walks the site, takes photos, draws a sketch.
3. He figures out what to bill (this is where Crewmatic saves hours).
4. He checks for hazards (legal protection).
5. He generates the report and sends it to the adjuster.
6. Over time, the app gets smarter from his history.

The "holy shit" moment is in step 3: "Generate Line Items." Everything before it is setup. Everything after it is output.

---

## Phase 3: Visibility Model — Buttons vs Invisible

### Explicit Actions (Buttons the Contractor Taps)

These require a decision or produce output the contractor must review:

| Action | Where | Why Explicit |
|---|---|---|
| **"Generate Line Items"** | Scope tab / Photos tab | Core product action. Contractor chooses WHEN to run it (after uploading all photos). Output needs review. |
| **"Scope Check"** | Scope tab (after line items exist) | Contractor decides when scope is ready to check. Output is actionable (add/ignore flagged items). |
| **"Check for Hazards"** | Photos tab or Job overview | Safety/legal implications. Findings need explicit acknowledgment. Should not be silent. |
| **"Clean Up Sketch"** | Floor plan tool | Contractor decides when rough sketch is done. Output replaces their drawing. |
| **"Upload Past Scopes"** | Settings or Onboarding | Requires contractor action (selecting files). One-time or periodic. |
| **"Push to Report"** | Scope tab | Explicit approval gate before generating PDF. |

### Invisible / Automatic (No Button, No Name)

These run without the contractor doing anything:

| Capability | Trigger | What Contractor Sees |
|---|---|---|
| Photo quality check | On photo upload | Yellow banner: "This photo may be too dark -- retake?" |
| Non-obvious item flagging | During line item generation | Subtle highlight on items + "Commonly missed" tag |
| Voice form filling | Contractor taps mic icon | Fields populate as they talk. No "AI" label. |
| Sketch text editing | Contractor types in text box on sketch | Sketch updates. It is just a text box that happens to be smart. |
| Citation attachment | During line item generation | Every line item has S500/OSHA citation inline. No action needed. |
| Job Assistant | Contractor taps chat bubble | Answers appear. Labeled "Job Assistant" not "AI Chat." |

### The Key Principle

**If the contractor does not need to make a decision about the output, the feature is invisible.** Photo quality check? Automatic. Citation generation? Automatic. Non-obvious item flagging? Automatic (it is just part of the line item display).

**If the contractor needs to review, approve, or act on the output, it is an explicit button.** Line item generation? Button. Scope check? Button. Hazard scan? Button.

---

## Information Architecture: How a New User Discovers Features

### First Job (Onboarding Flow)

A new contractor should not see 8 buttons on their first job. Discovery should be progressive:

```
FIRST JOB FLOW
==============

1. Create job (simple form, mic icon visible but not explained)
   -> After saving: tooltip on mic icon "Tip: Tap the mic to fill forms by voice"

2. Upload photos
   -> If blurry photo: auto-warning appears (teaches that the app checks quality)
   -> After 3+ photos uploaded: "Generate Line Items" button appears with pulse animation
   -> First-time tooltip: "Crewmatic analyzes your photos and suggests billable line items.
      You review everything before it goes anywhere."

3. Tap "Generate Line Items"
   -> Line items stream in. Non-obvious items highlighted.
   -> THIS IS THE "HOLY SHIT" MOMENT.
   -> After generation: small toast "Found 3 items you might have missed"

4. Review line items
   -> After review: "Scope Check" button appears
   -> Tooltip: "Want a second opinion? Scope Check reviews your scope for missed items."

5. (Optional) Tap "Scope Check"
   -> Shows flagged items. One-click add.

6. "Push to Report"
   -> PDF generated.
   -> SUCCESS. Contractor just saved 2 hours.

7. Post-first-job nudge (next day or next login):
   -> "Upload your past scopes so Crewmatic learns your billing patterns."
   -> "Check for Hazards is available on any job with photos."
```

### Feature Discovery Priority

| Priority | Feature | When Discovered | How |
|---|---|---|---|
| 1 (Core) | Generate Line Items | First job, after uploading photos | Primary CTA, pulse animation, tooltip |
| 2 (Core) | Review/Edit Line Items | Immediately after generation | It is the main screen |
| 3 (Value-add) | Scope Check | After first line item review | Button appears post-generation, tooltip |
| 4 (Safety) | Check for Hazards | Second job or settings exploration | Mentioned in post-first-job nudge |
| 5 (Ambient) | Voice form filling | First form interaction | Mic icon always visible, tooltip on first form |
| 6 (Ambient) | Clean Up Sketch | When using floor plan tool | Button on sketch toolbar |
| 7 (Growth) | Upload Past Scopes | After first completed job | Nudge notification |
| 8 (Support) | Job Assistant | When contractor looks confused or via help icon | Chat bubble, always available |

---

## The "Holy Shit" Moment

The activation moment is NOT "contractor sees AI features." It is:

**"I uploaded 12 photos and Crewmatic generated 18 line items with Xactimate codes, including 3 things I would have forgotten to bill for, each backed by S500/OSHA citations the adjuster cannot argue with."**

That sentence does not contain the word "AI." It contains: "18 line items," "3 things I would have forgotten," and "adjuster cannot argue."

The naming and IA must serve this moment:
- The button says "Generate Line Items" (clear expectation)
- The output shows real Xactimate codes (credibility)
- Non-obvious items are highlighted with "Commonly missed" (the money moment)
- Citations are inline (the adjuster-proof moment)
- The whole thing took 30 seconds (the time-saving moment)

Everything else in the product exists to set up or follow up on this moment.

---

## Competitive Positioning Note

Encircle is adding "AI features" to their marketing. They will brand everything "AI-powered." This is actually an advantage for Crewmatic:

- Encircle: "AI-Powered Documentation" (vague, marketing-speak)
- Crewmatic: "Generate Line Items" (specific, action-oriented)

Contractors do not buy "AI." They buy "I get paid faster." Crewmatic's naming should reflect that the intelligence is baked in, not bolted on. It is not a feature — it is how the product works.

---

## Impact on Existing Specs

### Spec 02 (AI Pipeline) — Changes Needed
- Rename "Analyze with AI" button to "Generate Line Items" throughout
- Rename "Hazard Scan" button to "Check for Hazards"
- Rename "Audit Scope" button to "Scope Check"
- Rename "Train AI" button to "Upload Past Scopes"
- Rename "AI Scope Auditor" banner text to "Scope Check" with subtitle "Reviews your scope like a 10-year veteran"
- Rename "Scope Intelligence" modal title to "Upload Past Scopes"
- Remove "AI" from all user-facing labels
- Keep "AI" in all backend code and internal naming (api/ai/pipeline.py etc. stays the same)

### Spec 03 (Voice) — Changes Needed
- "Hold to Speak" becomes mic icon with no label (or "Talk to Fill" if label needed)
- Remove "AI" from voice feature descriptions

### Marketing / Landing Page — Separate Concern
- "AI" is appropriate in marketing copy
- "AI-powered line item generation" is fine for the website
- "Powered by AI" footer badge in the app is fine
- The distinction: marketing sells the technology, the product delivers the outcome

---

## Out of Scope

- UI wireframes or mockups (this spec covers naming and architecture only)
- Backend code renaming (internal names like `api/ai/` are fine as-is)
- Icon design or visual treatment of features
- A/B testing naming variants (good idea for later)
- Detailed onboarding flow design (covered at high level, needs its own spec)

---

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| "Generate Line Items" is too generic — does not convey the "magic" | Medium | Test with Brett. If he wants more punch, try "Auto-Scope" or "Smart Scope." But start generic — contractors are skeptical of hype. |
| Removing "AI" reduces perceived value for investors/marketing | Low | Keep "AI" in all external communications. Internal product strips it. Investors see the landing page, not the app. |
| New users do not discover "Scope Check" or "Check for Hazards" | Medium | Progressive disclosure (Phase 3 above). Features appear at the right workflow moment with tooltips. |
| Contractors expect "Generate Line Items" to be perfect and get frustrated | High | Set expectations in the first-use tooltip: "Crewmatic suggests line items for your review. You approve everything before it goes anywhere." Emphasize "suggestions" not "answers." |
| "Upload Past Scopes" sounds like work — contractors skip it | Medium | Make it optional. Show clear value: "Contractors who upload past scopes get 20% more accurate suggestions." Defer to post-first-job nudge. |

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Core principle:** Name the outcome, not the technology. Contractors buy results, not AI.
- **"AI" in UI:** Almost never. Reserved for marketing, onboarding tooltips (first-use only), and settings labels.
- **Visibility rule:** If no decision needed, it is invisible. If output needs review, it is a button.
- **"Holy shit" moment:** "Generate Line Items" -> 18 items in 30 seconds, including 3 you would have missed, with citations the adjuster cannot argue. No mention of "AI."
- **Progressive disclosure:** First job shows only the core flow. Secondary features appear after the first success.
- **Internal code naming unchanged:** Backend modules stay `api/ai/pipeline.py` etc. This spec only affects user-facing labels.
