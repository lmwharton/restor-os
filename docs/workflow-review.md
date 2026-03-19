# RestorOS — Workflow Review & Validation

> **For: Brett Sodders (Co-Founder)**
>
> We've designed 17 workflows for RestorOS based on your prototype, our research, and your first interview. Now we need you to validate each one: **Is this how you actually work? What's wrong? What's missing?**

---

> **How to review:**
> Read each workflow description. It's a simplified version of what the app will do. Answer the questions after each one — voice-record is fine, just say the workflow number and question number. Focus on what's WRONG or MISSING — if it looks right, just say "looks good" and move on.
>
> **~35 questions total, ~30 minutes.**

---

## Workflow 1: New Job Creation

**What we think happens:** Emergency call comes in. Owner (or tech) creates a job in the app with customer name, phone, address, insurance info (carrier, claim number, adjuster), loss details (type, category, class, source), and assigns a tech. Job gets a number, tech gets a push notification.

**Key details:**
- Address auto-completes via Google Places
- Insurance carrier is a searchable dropdown (State Farm, Allstate, USAA, etc.)
- Loss category: Cat 1 (clean), Cat 2 (gray), Cat 3 (black)
- Loss class: Class 1-4 based on water volume/evaporation
- Job status: New > In Progress > Monitoring > Completed > Invoiced > Closed

### Questions

> **W1.1** Is this the right info to capture on the first call? Is there anything you ask the customer that we're not capturing here (e.g., how long ago the water started, number of stories, is there a basement, do they have a plumber)?
>
> **W1.2** Who usually creates the job — you (the owner) or the tech? Does it depend on how the call comes in (direct call vs. insurance referral vs. TPA)?
>
> **W1.3** Do you always know the insurance info on the first call, or does that come later? How often is a job cash/out-of-pocket with no insurance involved?

---

## Workflow 2: Job Site Arrival

**What we think happens:** Tech arrives, opens the job in the app, takes initial photos. Walks the property to assess damage — identifies affected rooms, source of loss, extent of damage. Creates a room list in the app (kitchen, master bedroom, basement, etc.) with basic dimensions.

**Key details:**
- GPS-stamped arrival time logged
- Photos auto-tagged to the job location
- Rooms created with name, floor level, dimensions, flooring type

### Questions

> **W2.1** What's the FIRST thing you do when you walk in the door? Do you talk to the homeowner first, or go straight to assessing damage?
>
> **W2.2** Do you measure room dimensions on the first visit, or does that happen later? How do you measure — tape measure, laser, or eyeball it?
>
> **W2.3** Is there a safety assessment you do first? (PPE check, electrical hazards, structural concerns, asbestos visual check?) Should the app prompt for this?

---

## Workflow 3: Voice-Guided Scoping

**What we think happens:** The app walks the tech through documenting damage via voice, step by step:
1. "What room are you in?" → "Master bedroom"
2. "Describe the damage" → "Water damage on north wall, 3 feet up, drywall saturated"
3. "What material is the flooring?" → "Carpet over plywood subfloor"
4. "Estimated affected area?" → "About 10 by 12"

AI converts spoken descriptions into structured Xactimate line items.

**Key details:**
- Voice commands: "next" to advance, "done" to finish
- Keyboard fallback always available
- Works best in quieter environments (return visits, empty rooms)

### Questions

> **W3.1** You said voice needs to be really accurate or it won't get used. What's your realistic expectation — would you use voice for the initial walkthrough, for return monitoring visits, or both? When is it most useful?
>
> **W3.2** When you dictate damage, do you think room-by-room or do you describe the whole house at once? What's the natural way you'd talk about it?
>
> **W3.3** Are there standard phrases or terms you always use when describing damage? (e.g., "affected up to 24 inches," "wet to the touch," "visible staining") — if we knew these, we could make the AI much more accurate.

---

## Workflow 4: Manual Scoping (Keyboard)

**What we think happens:** Tech or owner types scope entries manually. Searchable database of Xactimate codes — type "drywall" and see matching line items. Select one, enter quantity, add notes. Each line item can have S500/OSHA justification attached.

**Key details:**
- Searchable Xactimate code database
- AI auto-suggests S500/OSHA justifications per line item
- Can add line items room-by-room or across the whole job

### Questions

> **W4.1** When you scope manually today, do you work from memory, a mental checklist, or do you reference something (a cheat sheet, past scopes, Xactimate directly)?
>
> **W4.2** How many line items does a typical water job have? A small job vs. a big job?
>
> **W4.3** For the S500/OSHA justifications you built in the prototype — can you give us 3-5 examples of specific line items and what justification you'd attach? (e.g., "antimicrobial application — justified by S500 Section 12.4 for Cat 2 water")

---

## Workflow 5: Moisture Reading Collection

**What we think happens:** Tech goes room by room with a moisture meter (Delmhorst QuickNav in your case). For each room:

1. **Atmospheric:** Take temp, relative humidity, calculate GPP (grains per pound)
2. **Moisture points:** Number 5-10 points around the room (base of wall, center of floor, etc.), record the reading for each
3. **Dehu output:** Record the dehumidifier's exhaust temperature and RH

All readings are entered by typing the number (no Bluetooth). Data tracked over daily visits to show drying trends.

### Questions

> **W5.1** How many moisture points do you typically take per room? Is there a standard pattern (e.g., every 4 feet along the wall) or do you pick spots based on visible damage?
>
> **W5.2** Do you record atmospheric readings once per room or once per floor/zone? How do you currently calculate GPP — in your head, a chart, or an app?
>
> **W5.3** How do you track readings over time today? Paper log? Spreadsheet? Do you compare today's readings to yesterday's to see if things are drying?
>
> **W5.4** When you take a dehu reading, what exactly are you measuring — the output air, the input air, or both? What meter do you use for atmospheric (separate from the moisture meter)?

---

## Workflow 6: Equipment Placement & Tracking

**What we think happens:** Tech logs what equipment is placed in each room — dehumidifiers, air movers, air scrubbers. Records when placed and when removed. Equipment library tracks the company's inventory (serial numbers, Xactimate codes, daily rates).

**Key details:**
- Equipment tied to rooms for billing purposes
- Tracks "equipment days" (placed date to removed date) for Xactimate line items
- Equipment library: company-wide catalog of all equipment owned

### Questions

> **W6.1** How many pieces of equipment does a typical water job need? What's the usual mix (e.g., 1 dehu per room + 2 air movers)?
>
> **W6.2** Do you track equipment by serial number, or just by type/count? Does the adjuster care about specific serial numbers, or just the number of units and days?
>
> **W6.3** Is there a standard formula for how many air movers per square foot, or is it judgment? Does the app need to suggest equipment placement based on room size?

---

## Workflow 7: Photo Documentation

**What we think happens:** Tech takes photos throughout the job. Photos auto-tag with GPS location and auto-associate to the active job (like CompanyCam). Photos assigned to rooms, tagged as before/during/after. Stored in cloud, accessible from any device.

**Key details:**
- Auto-location logging (CompanyCam-style)
- Job photo archive — browse past jobs by location on a map (your iCloud hack, built in)
- Photos are the #1 documentation for getting paid (per your feedback)

### Questions

> **W7.1** How many photos do you take on a typical job? First visit vs. return visits?
>
> **W7.2** Do you take specific types of photos that adjusters expect? (e.g., "wide shot of affected area," "close-up of damage," "moisture meter reading on screen," "equipment in place") Is there a standard shot list?
>
> **W7.3** Do you ever take video? Would short video clips (30 seconds) be useful for documentation, or is it always photos?
>
> **W7.4** When you're done with a job, do you take "after" photos? Do adjusters require before/after comparison?

---

## Workflow 8: AI Photo Scope

**What we think happens:** Tech selects damage photos and taps "Analyze with AI." AI looks at each photo and generates Xactimate line items — what work is needed, what code, what quantity. Tech reviews each line item (approve/edit/reject). Approved items go into the scope.

**Key details:**
- AI returns line items with confidence scores
- Each item includes S500/OSHA justification
- 80% accuracy target (per your feedback), with the AI finding "non-obvious line items"
- Tech always reviews — nothing goes to adjuster without human approval

### Questions

> **W8.1** If you upload a photo of a water-damaged room, what line items would YOU expect to see? Walk us through a specific example — what's in the photo, what should the scope include?
>
> **W8.2** What are the "non-obvious line items" you mentioned? The ones a less experienced tech might miss? Give us 3-5 examples.
>
> **W8.3** Would you upload one photo per room, or multiple angles of the same room? What gives AI the best chance of catching everything?
>
> **W8.4** What would make you NOT trust the AI output? What kind of error would make you stop using the feature?

---

## Workflow 9: Daily Monitoring (Dry Log)

**What we think happens:** Tech returns daily (or every other day) to check drying progress. Takes new moisture readings, checks equipment, takes progress photos. App shows trends — is each room drying or not? If readings plateau, flags it for the owner.

**Key details:**
- Side-by-side comparison: today's readings vs. yesterday
- Trend charts per room (moisture over time)
- AI can estimate time to dry based on readings + equipment

### Questions

> **W9.1** How many days does a typical water job take to dry? What's short vs. long?
>
> **W9.2** How do you decide when the job is done (dry enough to remove equipment)? Is there a target moisture reading, or is it based on comparison to unaffected areas?
>
> **W9.3** What happens when something ISN'T drying? What do you do — add more equipment, reposition, tear out material? Does the app need to suggest corrective actions?

---

## Workflow 10: Report Generation

**What we think happens:** Owner reviews the job data (scope, photos, readings, equipment log) and generates a professional report. Default format is PDF. Can also export scope line items in Xactimate ESX format (optional).

**Report types:**
- **Scope report:** All Xactimate line items with justifications, organized by room
- **Moisture log:** Daily readings with trend charts, atmospheric data
- **Job summary:** Everything — photos, scope, readings, equipment, timeline

### Questions

> **W10.1** What does your current report/scope look like when you send it to an adjuster? Can you share a sample (redacted)?
>
> **W10.2** Do you send one combined report or separate documents (scope separate from moisture log separate from photos)?
>
> **W10.3** Do adjusters ever ask for specific formatting? Or do they just want the data and don't care how it looks?

---

## Workflow 10b: Auto Adjuster Reports

**What we think happens:** While the job is active, the app automatically generates and sends a daily progress update to the adjuster via email. The adjuster gets a secure link showing: job status, selected photos, latest moisture readings summary, equipment status. They can view but not edit. Same concept for the customer but even more limited (just status + selected photos).

### Questions

> **W10b.1** How often do adjusters call you for status updates? Would daily auto-reports actually reduce those calls?
>
> **W10b.2** What should the adjuster see vs. NOT see? Should they see individual moisture readings, or just a summary ("drying on track")?
>
> **W10b.3** Would the homeowner want this too? How much information do you share with the homeowner during the job?

---

## Workflow 11: Job Scheduling & Dispatch

**What we think happens:** Owner has a calendar/scheduling board showing all jobs and which tech is assigned to which job on which day. Owner assigns techs to jobs with date/time, techs get a push notification. Tech sees "My Schedule" on their phone — today's jobs, tomorrow's jobs.

**Key details:**
- Replaces the "late night text message" workflow
- Tech can update status: Scheduled > En Route > On Site > Completed
- Owner sees real-time status of all techs

### Questions

> **W11.1** How many jobs are active simultaneously right now on a typical week? How many techs across how many jobs?
>
> **W11.2** Do techs go to multiple jobs per day, or one job per day? Do some jobs need multiple techs at the same time?
>
> **W11.3** What info does the tech need to know for tomorrow's job? Just the address, or also what to bring (equipment, materials, PPE)?
>
> **W11.4** Do you ever have last-minute emergency calls that blow up the schedule? How often? What do you do — pull a tech from another job?

---

## Workflow 12: Team Management

**What we think happens:** Owner invites techs to the company via email. Tech creates an account, joins the company. Owner can assign techs to jobs, view team roster, manage roles (owner vs. tech).

### Questions

> **W12.1** Do your techs need to see ALL jobs or just the ones they're assigned to? Is there anything a tech should NOT see (pricing, profit margins, customer complaints)?
>
> **W12.2** Do you ever use subcontractors? Would they need limited access to the app for specific jobs?

---

## Workflow 13: Job Review & QA

**What we think happens:** Before sending a scope to the adjuster, the owner reviews the tech's work — checks photos, readings, scope line items. Can edit, add, or remove items. Approves the scope, generates the report, sends to adjuster.

### Questions

> **W13.1** How much do you actually review a tech's documentation before sending it? Line-by-line, or just a quick scan?
>
> **W13.2** What are the most common mistakes techs make in their documentation? What do you have to fix?
>
> **W13.3** Is there a back-and-forth between you and the tech ("hey you missed the baseboard in the hallway") or do you just fix it yourself?

---

## Workflow 14: Dashboard

**What we think happens:** Owner sees a dashboard with: active jobs (count + status), today's schedule, team activity, equipment deployed, recent AI scopes. Quick overview of the entire business at a glance.

### Questions

> **W14.1** What's the first thing you'd want to see when you open the app in the morning?
>
> **W14.2** Are there any KPIs or metrics you track for your business? (Jobs per month, revenue, average job size, equipment utilization, days to payment?)

---

## Workflow 15: The Whole Job — End to End

This is the big one. Walk us through ONE real job from start to finish.

### Questions

> **W15.1** Think of a recent water job. Walk us through EVERY step from the first phone call to getting paid. Don't skip anything — we want to hear about the parts that no software thinks about (the homeowner crying, moving furniture, the plumber who shows up, the adjuster who ghosts you).
>
> **W15.2** What's the messiest part of the job lifecycle? Where do things fall through the cracks?
>
> **W15.3** If you had a new tech starting tomorrow and you had to write them a step-by-step guide for "how to document a water job," what would it say?

---

## Workflow 16: What We Haven't Thought Of

> **W16.1** Is there a workflow or process in your daily work that we haven't mentioned at all in this document? Something you do regularly that doesn't fit into any of these categories?
>
> **W16.2** What about the BUILD-BACK side? After mitigation is done, there's reconstruction — drywall, paint, flooring. Is that a separate company/process, or do you handle both? Does the app need to cover build-back scope too?
>
> **W16.3** What about contents? (Homeowner's belongings — furniture, clothes, electronics affected by water.) Do you handle contents pack-out/cleaning, or is that a separate company? Is it part of the scope?
>
> **W16.4** What about the contract / work authorization process? You mentioned signing a paper contract at the door. Would digital contract signing in the app be useful? What does the contract typically include?

---

## Thank You

These workflows are the blueprint for what we're building. Your answers determine whether the app matches reality or whether we build something that looks good but nobody uses.

Take your time on W15 (the end-to-end job walkthrough) — that one answer alone is worth more than everything else combined.

*— The RestorOS Team*
