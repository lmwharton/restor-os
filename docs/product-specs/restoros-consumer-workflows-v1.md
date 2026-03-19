# RestorOS V1 - Consumer Workflow Specification

**Document Version:** 1.1
**Date:** 2026-03-19
**Status:** Draft - Updated with Contractor Feedback (Brett Sodders interview)
**Previous Version:** 1.0 (2026-03-13)
**Product:** RestorOS - Water Restoration Contractor Platform

---

## Executive Summary

RestorOS is a field-first web application for water restoration contractors. It replaces fragmented paper/spreadsheet workflows with a guided, AI-assisted digital process that produces Xactimate-ready documentation.

**Core value proposition:** A restoration tech with a phone can arrive at a water-damaged property, document everything through photos and guided input, and produce insurance-grade scope notes and moisture reports -- faster than paper, with AI doing the heavy lifting.

**V1 Personas:**

| Persona | Role | Primary Device | Key Needs |
|---------|------|---------------|-----------|
| Restoration Tech | Field worker | Phone (PWA) | Fast data capture, voice-first, works in wet/damaged environments |
| Company Owner | Business manager | Desktop + Phone | Job oversight, QA review, report generation, team management |

**Input Mode Philosophy:**
- **Photo-first** for field damage documentation (Tech persona, phone) -- photos are "the biggest one to get paid"
- **Keyboard + voice** for field data capture (keyboard is primary, voice is enhancement for V1)
- **Keyboard-first** for office/review tasks (Owner persona, desktop)
- **AI-assisted** at every step where it reduces manual work
- **Online-first** with graceful degradation (photos save locally, sync when connected)

---

## System-Wide Conventions

### Offline Strategy

> **Contractor feedback (Brett Sodders):** "Offline is not a must-have right off the bat. Most people in metro Detroit have cell reception." Offline is a nice-to-have, not a core V1 requirement.

**V1 (ship):** Minimal offline support
- Show "No connection" banner when offline
- Photos save locally and auto-upload when back online
- Everything else requires connectivity

**V1.1 (ship soon after):** Read-only offline cache
- Cached view of assigned jobs (read-only)
- Moisture readings can be entered offline, sync on reconnect

**V2:** Full offline mutations + sync
- Create/edit jobs offline
- Full offline data entry with conflict resolution
- Background sync with merge strategies

| Capability | V1 Offline | V1.1 Offline | Online Required |
|-----------|------------|--------------|-----------------|
| Photo capture | Yes (stored locally, auto-upload) | Yes | Upload on reconnect |
| View assigned jobs | No | Yes (read-only cache) | Full data |
| Create/edit job | No | No | Yes |
| Moisture readings | No | Yes (sync on reconnect) | Sync on reconnect |
| Voice recording | No | No | Yes |
| AI Photo Scope | No | No | Requires API call |
| AI voice scoping | No | No | Requires API call |
| Report generation | No | No | Requires API + data |
| Team management | No | No | Requires API |
| Push notifications | No | No | Requires connectivity |
| Scheduling/Dispatch | No | No | Requires API |

### Data Sync Model (V1.1+)

When offline capabilities are added, all offline-capable workflows follow this pattern:
1. Data saved to local IndexedDB with `syncStatus: "pending"`
2. Background sync attempts when connectivity detected
3. Conflict resolution: last-write-wins with server timestamp, user notified of conflicts
4. Sync indicator visible in UI header (green = synced, yellow = pending, red = offline)

### Navigation Model

```
[Bottom Tab Bar - Mobile]
  Home (Dashboard)  |  Jobs  |  + New  |  Schedule  |  More

[Sidebar - Desktop]
  Dashboard
  Jobs
  Schedule
  Equipment
  Team
  Reports
  Settings
```

---

## Workflow 1: New Job Creation

### Overview
An emergency call comes in. Someone needs to create a job record quickly so the tech can be dispatched.

**Trigger:** Phone call from customer, insurance referral, TPA assignment, or walk-in request
**Actor:** Owner (primary), Tech (secondary -- can self-create when dispatched verbally)
**Primary input:** Keyboard (Owner at desk) or Voice (Tech in field)
**AI assistance:** Address auto-complete, loss type suggestion from description
**Offline:** Yes -- job created locally, synced when online

### Steps

```
[1] User taps "+ New Job" button (FAB on mobile, button on desktop)
         |
[2] Job creation form appears (single scrollable page)
         |
    [2a] Customer Info
         - Customer name (required) -- text input
         - Phone number (required) -- tel input, auto-format
         - Email (optional) -- email input
         - Address (required) -- address input with Google Places autocomplete
           -> On selection: auto-populates city, state, zip, lat/lng
           -> Offline: free-text entry, geocoded on sync
         |
    [2b] Insurance Info
         - Insurance carrier (optional) -- searchable dropdown of common carriers
           -> "State Farm", "Allstate", "USAA", "Liberty Mutual", etc.
           -> "Other" option with free text
         - Claim number (optional) -- text input
         - Policy number (optional) -- text input
         - Adjuster name (optional) -- text input
         - Adjuster phone (optional) -- tel input
         - Adjuster email (optional) -- email input
         |
    [2c] Loss Info
         - Loss date (required) -- date picker, defaults to today
         - Loss type (required) -- select:
           -> Water / Fire / Mold / Storm / Sewage / Other
         - Loss category (conditional, shown for Water) -- select:
           -> Category 1 (Clean Water)
           -> Category 2 (Gray Water)
           -> Category 3 (Black Water)
         - Loss class (conditional, shown for Water) -- select:
           -> Class 1 (Least amount of water)
           -> Class 2 (Large amount of water, carpet + walls <24")
           -> Class 3 (Greatest amount, walls, ceilings, insulation)
           -> Class 4 (Specialty, deep pockets of saturation)
         - Source of loss (optional) -- text, e.g., "Burst pipe under kitchen sink"
         - Brief description (optional) -- textarea
         |
    [2d] Assignment
         - Assigned tech(s) (optional) -- multi-select from team roster
         - Priority (optional) -- select: Emergency / Urgent / Standard
         - Scheduled date/time (optional) -- datetime picker
         |
[3] User taps "Create Job"
         |
[4] Job created with status "New"
         |
[5] System generates job number (format: JOB-YYYYMMDD-XXX)
         |
[6] If tech(s) assigned: push notification sent to tech(s)
         |
[7] User redirected to Job Detail view
```

### Data Captured

| Field | Type | Required | Storage |
|-------|------|----------|---------|
| job_id | UUID | auto | jobs table |
| job_number | string | auto | jobs table |
| company_id | UUID | auto (from user) | jobs table |
| customer_name | string | yes | jobs table |
| customer_phone | string | yes | jobs table |
| customer_email | string | no | jobs table |
| address_line1 | string | yes | jobs table |
| address_city | string | yes | jobs table |
| address_state | string | yes | jobs table |
| address_zip | string | yes | jobs table |
| address_lat | float | no | jobs table |
| address_lng | float | no | jobs table |
| insurance_carrier | string | no | jobs table |
| claim_number | string | no | jobs table |
| policy_number | string | no | jobs table |
| adjuster_name | string | no | jobs table |
| adjuster_phone | string | no | jobs table |
| adjuster_email | string | no | jobs table |
| loss_date | date | yes | jobs table |
| loss_type | enum | yes | jobs table |
| loss_category | enum | conditional | jobs table |
| loss_class | enum | conditional | jobs table |
| loss_source | string | no | jobs table |
| loss_description | text | no | jobs table |
| priority | enum | no | jobs table |
| scheduled_at | timestamp | no | jobs table |
| status | enum | auto ("new") | jobs table |
| created_by | UUID | auto | jobs table |
| created_at | timestamp | auto | jobs table |

### Outputs
- Job record visible on Job Board
- Job number for reference
- Push notification to assigned tech(s)
- Job appears on tech's "My Jobs" list

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Duplicate address detected | Warning: "A job at this address already exists (JOB-xxx). Create anyway?" |
| Offline creation | Saved locally. Job number assigned as `LOCAL-{timestamp}`, replaced with server number on sync |
| Address not found in autocomplete | Allow free-text entry, geocode later |
| No techs available to assign | Job created unassigned, owner can assign later |
| Required field missing | Inline validation, cannot submit until fixed |
| Customer calls back with insurance info | Owner edits job to add insurance fields (see Job Detail editing) |

### Dependencies
- **Feeds into:** Job Site Arrival (#2), all subsequent job workflows
- **Requires:** User authentication, company setup complete
- **Optional:** Team roster populated (for tech assignment)

---

## Workflow 2: Job Site Arrival & Initial Assessment

### Overview
Tech arrives at the job site and begins the documentation process. This is the gateway to all field data capture.

**Trigger:** Tech arrives at job site (or opens job from their list)
**Actor:** Tech
**Primary input:** Voice + taps (phone, often one-handed, sometimes wearing gloves)
**AI assistance:** Checklist suggestions based on loss type, auto-timestamp
**Offline:** Yes -- all initial assessment data captured locally

### Steps

```
[1] Tech opens job from "My Jobs" list or scans QR code
         |
[2] Job Detail screen loads showing job summary
         |
[3] Tech taps "Start Site Visit" button
         |
[4] System records:
         - Arrival timestamp (auto)
         - GPS coordinates (auto, with permission)
         - Creates new "site_visit" record
         |
[5] Initial Assessment Checklist appears (configurable per loss type)
         |
    For WATER loss, checklist includes:
    [ ] Source identified and mitigated?
    [ ] Water supply shut off?
    [ ] Electrical hazards assessed?
    [ ] Safety hazards documented?
    [ ] Homeowner present?
    [ ] Areas of damage identified?
    [ ] Content moved/protected?
    [ ] Standing water present?
         |
[6] Tech checks items, can add notes to each (voice or text)
         |
[7] Tech taps "Add Affected Room" to begin room-by-room documentation
         |
    [7a] Room name -- select from common list:
         Kitchen, Bathroom, Master Bedroom, Bedroom 2, Bedroom 3,
         Living Room, Dining Room, Family Room, Laundry, Garage,
         Hallway, Closet, Office, Basement, Utility Room, Attic,
         Custom (free text)
         |
    [7b] Room dimensions (important for payment -- adjusters need sq footage):
         Length x Width (feet) -- minimum: wall lengths
         Ceiling height (default 8')
         Room shape (rectangular default, L-shaped, custom)
         Note: "You could submit a scope without dimensions -- it just
         might not get paid very quickly."
         V2: LiDAR integration (like MagicPlan) for automatic measurement
         |
    [7c] Affected materials checklist:
         [ ] Carpet   [ ] Pad   [ ] Hardwood   [ ] Laminate
         [ ] Tile     [ ] VCT   [ ] Vinyl      [ ] Drywall
         [ ] Baseboard [ ] Insulation [ ] Cabinets [ ] Contents
         |
    [7d] Repeat for each affected room
         |
[8] Tech can now branch to any field workflow:
         -> Take Photos (#7)
         -> Start Voice Scoping (#3)
         -> Take Moisture Readings (#5)
         -> Place Equipment (#6)
         |
[9] When leaving site: Tech taps "End Site Visit"
         |
[10] System records departure timestamp
          |
[11] Site visit summary shown (duration, rooms added, photos taken, readings count)
```

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| site_visit_id | UUID | site_visits table |
| job_id | UUID (FK) | site_visits table |
| tech_id | UUID (FK) | site_visits table |
| arrival_at | timestamp | site_visits table |
| arrival_lat | float | site_visits table |
| arrival_lng | float | site_visits table |
| departure_at | timestamp | site_visits table |
| checklist_items | jsonb | site_visits table |
| notes | text | site_visits table |
| visit_number | int | site_visits table (auto-increments per job) |
| room_id | UUID | rooms table |
| room_name | string | rooms table |
| room_length_ft | float | rooms table |
| room_width_ft | float | rooms table |
| room_ceiling_height_ft | float | rooms table |
| room_shape | enum (rectangular, l_shaped, custom) | rooms table |
| affected_materials | string[] | rooms table |

### Outputs
- Site visit record with timestamps (proof of attendance for insurance)
- Room inventory for the job
- Foundation for moisture readings, photos, equipment placement
- GPS verification of on-site presence

### Edge Cases

| Scenario | Handling |
|----------|----------|
| GPS unavailable | Record without coordinates, flag for manual verification |
| Tech forgets to end visit | Auto-end after 12 hours with note "auto-closed" |
| Job has no rooms yet | Prompt to add at least one room before proceeding |
| Previous visit exists | New visit auto-numbered (Visit #2, #3, etc.) |
| Tech at wrong address | GPS mismatch warning if >0.5 miles from job address |
| Gloved hands / wet phone | Large tap targets (min 48px), minimal typing required |

### Dependencies
- **Requires:** Job exists (#1)
- **Feeds into:** All field workflows (#3-#8)
- **Referenced by:** Dry Log (#9), Report Generation (#10), Auto Adjuster Reports (#10b)

---

## Workflow 3: Guided Voice Scoping

### Overview
A tech narrates their damage assessment and the system structures it into Xactimate-ready scope notes. The AI guides the tech through a step-by-step process, asking for specific information in sequence.

> **Contractor feedback (Brett Sodders):** "Job sites can get noisy. Homeowners can get annoying. It needs to be really accurate or it won't be utilized." Voice is an **enhancement, not the primary input** for V1. Keyboard/manual entry must be equally fast and always available. Voice works best in empty rooms during monitoring visits (no homeowner, less noise) vs. initial assessment (homeowner present, noisy). Do not lead with voice in marketing until accuracy is proven in real field conditions.

**Trigger:** Tech taps "Voice Scope" from job detail or room detail
**Actor:** Tech
**Primary input:** Voice with keyboard fallback (keyboard must be equally fast)
**AI assistance:** Real-time transcription, structured extraction, Xactimate line item suggestion
**Offline:** Recording only. Transcription + AI processing requires connectivity.
**Note:** Voice needs high accuracy per contractor feedback. Keyboard/manual entry is the reliable fallback.

### Steps

```
[1] Tech taps "Voice Scope" button on job or room
         |
[2] System checks microphone permission
         -> If denied: prompt to enable, show manual entry fallback
         |
[3] Voice Scoping UI appears:
         +-----------------------------------------+
         |  Voice Scoping - Room: Kitchen           |
         |                                          |
         |  Step 1 of 6: Describe the damage        |
         |                                          |
         |  "Tell me what you see. What surfaces     |
         |   are affected and how?"                  |
         |                                          |
         |       [  Recording...  ]                 |
         |       ~~~~ waveform animation ~~~~       |
         |                                          |
         |  Transcription:                          |
         |  "We've got about 3 feet of water        |
         |   damage on the drywall, baseboards      |
         |   are warped, carpet is saturated..."     |
         |                                          |
         |  [ Pause ]  [ Next Step ]  [ Redo ]      |
         +-----------------------------------------+
         |
[4] Guided steps sequence (per room):
         |
    Step 1: DAMAGE DESCRIPTION
         Prompt: "Describe what you see. What surfaces are affected?"
         Captures: free-form damage narrative
         |
    Step 2: AFFECTED AREAS & MEASUREMENTS
         Prompt: "What are the dimensions? How high does the damage go
                  on the walls? How much carpet/flooring is affected?"
         Captures: dimensions, linear/square feet affected
         |
    Step 3: MATERIALS AFFECTED
         Prompt: "What materials need to be removed or replaced?
                  Drywall, baseboard, carpet, pad, insulation?"
         Captures: material list with quantities
         |
    Step 4: DEMOLITION NEEDED
         Prompt: "What needs to be torn out? Drywall cuts, carpet
                  removal, baseboard removal?"
         Captures: demo scope items
         |
    Step 5: CONTENT MANIPULATION
         Prompt: "Any furniture or contents that need to be moved,
                  cleaned, or stored? How many items?"
         Captures: content handling items
         |
    Step 6: ADDITIONAL NOTES
         Prompt: "Anything else? Pre-existing damage, special
                  conditions, access issues?"
         Captures: supplementary notes
         |
[5] After each step, AI processes transcription:
         - Extracts structured data from natural language
         - Suggests Xactimate line items
         - Shows confidence score for each suggestion
         |
[6] Review screen shows extracted data:
         +-----------------------------------------+
         |  Scope Review - Kitchen                  |
         |                                          |
         |  Suggested Line Items:                   |
         |                                          |
         |  [x] WTR DRYOUT - Struct drying/day     |
         |      Category: WTR  Qty: 1  Unit: DAY   |
         |      Confidence: 95%                     |
         |                                          |
         |  [x] DRY RMBASBD - R&R baseboard        |
         |      Category: DRY  Qty: 24  Unit: LF   |
         |      Confidence: 88%                     |
         |                                          |
         |  [x] DRY CUT24 - Cut drywall 2' flood   |
         |      Category: DRY  Qty: 48  Unit: SF   |
         |      Confidence: 82%                     |
         |                                          |
         |  [ ] DRY INSUL - R&R insulation          |
         |      Category: DRY  Qty: 48  Unit: SF   |
         |      Confidence: 45% -- NEEDS REVIEW     |
         |                                          |
         |  [Edit] [Add Item] [Re-record] [Accept]  |
         +-----------------------------------------+
         |
[7] Tech reviews, toggles items on/off, edits quantities
         |
[8] Tech taps "Accept" -- line items saved to job scope
         |
[9] Move to next room or finish scoping
```

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| voice_scope_id | UUID | voice_scopes table |
| job_id | UUID (FK) | voice_scopes table |
| room_id | UUID (FK) | voice_scopes table |
| audio_file_url | string | Supabase Storage |
| audio_duration_sec | int | voice_scopes table |
| raw_transcription | text | voice_scopes table |
| ai_extraction | jsonb | voice_scopes table |
| step_number | int | voice_scope_steps table |
| step_prompt | string | voice_scope_steps table |
| step_transcription | text | voice_scope_steps table |
| step_audio_url | string | Supabase Storage |
| line_item_code | string | scope_line_items table |
| line_item_description | string | scope_line_items table |
| line_item_category | string | scope_line_items table |
| line_item_quantity | float | scope_line_items table |
| line_item_unit | string | scope_line_items table |
| line_item_confidence | float | scope_line_items table |
| line_item_accepted | boolean | scope_line_items table |
| line_item_source | enum ("voice", "manual", "ai_photo") | scope_line_items table |

### Outputs
- Structured scope notes per room
- Xactimate-compatible line items with codes
- Audio recordings (evidence/audit trail)
- Full transcription text

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Noisy environment (fans, dehumidifiers running) | Warning: "Noisy environment detected. Speak clearly and close to phone." Allow re-record per step. |
| AI misinterprets speech | Each step has "Redo" button. Tech can also manually edit transcription. |
| AI suggests wrong line items | Tech can deselect, edit, or add items manually. Low-confidence items (<60%) flagged for review. |
| Connectivity drops mid-scope | Audio saved locally. Transcription queued. UI shows: "Audio saved. Will process when back online." |
| Tech skips a step | Allow skip with warning: "Skipping may result in incomplete scope." |
| Multiple techs scope same room | Merge/append with conflict warning to owner during QA |
| Unfamiliar Xactimate code | Tooltip with full description on each line item |

### Dependencies
- **Requires:** Job exists (#1), Room(s) defined (#2)
- **Feeds into:** Report Generation (#10), Job Review (#13)
- **AI services:** Speech-to-text API, Claude API for extraction + line item suggestion
- **Reference data:** Xactimate line item database (codes, descriptions, units)

---

## Workflow 4: Manual Data Entry (Voice Fallback)

### Overview
Keyboard-based entry for scope data. Used when voice is impractical (quiet environment, owner at desk, or voice processing unavailable).

**Trigger:** Tech/Owner chooses "Type Scope" or voice is unavailable
**Actor:** Tech or Owner
**Primary input:** Keyboard
**AI assistance:** Auto-suggest line items as user types, smart defaults
**Offline:** Yes -- all data entry works offline

### Steps

```
[1] User navigates to room within a job
         |
[2] Taps "Add Scope Items" or "Type Scope"
         |
[3] Scope entry form:
         |
    [3a] Damage narrative (textarea)
         - User types free-form description
         - AI suggests line items as user types (debounced, 500ms)
         - Similar to voice scoping review, but keyboard-driven
         |
    [3b] Direct line item entry:
         +-----------------------------------------+
         |  Add Line Item                           |
         |                                          |
         |  Search: [demol________]                 |
         |                                          |
         |  Suggestions:                            |
         |  > DRY DEMODRYWL - Demo drywall          |
         |  > DRY RMBASBD - R&R baseboard           |
         |  > DRY DEMO - Demolition labor           |
         |                                          |
         |  Selected: DRY DEMODRYWL                 |
         |  Description: Demo drywall               |
         |  Qty: [48___]  Unit: SF                  |
         |  Room: Kitchen                           |
         |                                          |
         |  [Add Another] [Done]                    |
         +-----------------------------------------+
         |
[4] User can also paste scope notes from another source
         -> AI parses pasted text into structured line items
         |
[5] S500/OSHA Compliance Justifications (auto-suggested):
         - When a line item is added (manually, via voice, or via AI photo scope),
           the system auto-suggests industry standard justifications:
         - Examples:
           "Structural drying required per IICRC S500 Section 10.3.2"
           "Category 2 water requires antimicrobial application per IICRC S500 Section 12.4"
           "PPE required per OSHA 29 CFR 1910.134 for Category 3 water"
         - Justifications attached to each line item in the scope
         - Owner can accept, edit, or remove justifications before report generation
         - Purpose: Adjusters cannot reject line items backed by industry standards
         |
[6] Review and save
```

### Data Captured
Same schema as Voice Scoping (#3) -- `scope_line_items` table, but with `source: "manual"`.

Additional fields for compliance justifications:

| Field | Type | Storage |
|-------|------|---------|
| justification_text | string | scope_line_items table |
| justification_standard | string (e.g., "IICRC S500", "OSHA") | scope_line_items table |
| justification_section | string (e.g., "Section 10.3.2") | scope_line_items table |
| justification_accepted | boolean | scope_line_items table |

### Outputs
- Same as Voice Scoping: structured line items per room
- S500/OSHA compliance justifications attached to each applicable line item

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Xactimate code unknown | Searchable database by description, not just code |
| Pasted text poorly formatted | AI does best-effort parse, user reviews/corrects |
| Duplicate line item for same room | Warning: "This item already exists for Kitchen. Add duplicate?" |

### Dependencies
- **Alternative to:** Voice Scoping (#3)
- **Same outputs as:** Voice Scoping (#3)

---

## Workflow 5: Moisture Reading Collection

### Overview
Core field data collection. Tech takes atmospheric readings for each room and point readings at numbered locations on affected materials. This data drives drying progress tracking and is critical for insurance documentation.

**Trigger:** Tech is at job site, ready to take readings (initial or return visit)
**Actor:** Tech
**Primary input:** Keyboard (numeric entry) + Voice (optional dictation for notes)
**AI assistance:** Anomaly detection ("This reading seems high for Day 3, verify?"), drying progress indicators
**Offline:** Yes -- all readings stored locally

### Steps

```
[1] Tech navigates to job -> room -> "Moisture Readings"
         |
[2] System shows reading entry screen:
         |
    [2a] SELECT METER
         - Choose from equipment library (preference setting, not connectivity):
           Protimeter | Delmhorst | Flir | Wagner | Tramex
         - Meter saved as default for session
         - Input method: Tech reads the meter display, types the number manually
         - No Bluetooth/wireless connectivity -- manual entry only
         |
    [2b] ATMOSPHERIC READINGS (per room, per visit)
         +-----------------------------------------+
         |  Atmospheric - Kitchen                   |
         |  Visit #1 - Jan 15, 2026                 |
         |                                          |
         |  Temperature:  [ 72.5 ] F                |
         |  Rel. Humidity: [ 65.2 ] %               |
         |  GPP (calculated): 58.3                  |
         |  Dew Point (calculated): 59.1 F          |
         |                                          |
         |  Dehu Output (if applicable):            |
         |  Temperature:  [ 95.0 ] F                |
         |  Rel. Humidity: [ 22.0 ] %               |
         |                                          |
         |  [Save Atmospheric]                      |
         +-----------------------------------------+
         |
         Note: GPP (Grains Per Pound) auto-calculated from temp + RH
         using psychrometric formula.
         |
    [2c] POINT READINGS (numbered points per room)
         +-----------------------------------------+
         |  Point Readings - Kitchen                |
         |                                          |
         |  Material: [Drywall  v]                  |
         |  Dry Standard: 15%                       |
         |                                          |
         |  Point 1: [ 45.2 ] %  Location: [N wall, 12" from corner]
         |  Point 2: [ 38.7 ] %  Location: [N wall, 36" from corner]
         |  Point 3: [ 22.1 ] %  Location: [E wall, 24" from corner]
         |  Point 4: [ 14.8 ] %  Location: [E wall, 48" from corner]
         |  [+ Add Point]                           |
         |                                          |
         |  Status: 2 of 4 points at/below dry std  |
         |                                          |
         |  [Save Points]                           |
         +-----------------------------------------+
         |
[3] Tech repeats for each room
         |
[4] Summary screen shows all rooms with status:
         |
    Kitchen:    4 points | 50% dry   | [!] High atmospheric RH
    Bathroom:   3 points | 33% dry   | OK
    Hallway:    2 points | 100% dry  | Ready for rebuild
```

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| reading_set_id | UUID | moisture_reading_sets table |
| job_id | UUID (FK) | moisture_reading_sets table |
| room_id | UUID (FK) | moisture_reading_sets table |
| site_visit_id | UUID (FK) | moisture_reading_sets table |
| meter_id | UUID (FK) | moisture_reading_sets table |
| recorded_at | timestamp | moisture_reading_sets table |
| atmo_temp_f | float | moisture_reading_sets table |
| atmo_rh_pct | float | moisture_reading_sets table |
| atmo_gpp | float (calculated) | moisture_reading_sets table |
| atmo_dew_point_f | float (calculated) | moisture_reading_sets table |
| dehu_output_temp_f | float | moisture_reading_sets table |
| dehu_output_rh_pct | float | moisture_reading_sets table |
| point_id | UUID | moisture_points table |
| point_number | int | moisture_points table |
| point_value | float | moisture_points table |
| point_material | enum | moisture_points table |
| point_location_desc | string | moisture_points table |
| dry_standard | float | moisture_points table (from material default) |

### Material Dry Standards Reference

| Material | Dry Standard |
|----------|-------------|
| Drywall | 15% |
| Wood framing | 16% |
| Hardwood flooring | 12% |
| Concrete | 17% |
| Plywood/OSB | 16% |
| Carpet pad | 10% |

### Outputs
- Moisture reading records per room per visit
- Drying progress calculation (% of points at/below dry standard)
- Trend data for Dry Log (#9)
- Data for Moisture Report in Report Generation (#10)

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Reading seems impossible (e.g., drywall at 99%) | Warning: "This reading is unusually high for [material]. Please verify." Allow save anyway. |
| Different meter used than previous visit | Note meter change in record, may affect comparison |
| Point location unclear | Voice-to-text for location description, or photo of point location |
| Forgot atmospheric reading | Prompt when saving points: "No atmospheric reading for this room today. Add now?" |
| Negative trend (readings going up) | Alert: "Readings increased since last visit. Possible new water source or insufficient drying." |

### Dependencies
- **Requires:** Job exists (#1), Room(s) defined (#2), Equipment library has meters (#6)
- **Feeds into:** Dry Log (#9), Report Generation (#10)
- **Referenced by:** Job Review (#13)

---

## Workflow 6: Equipment Placement & Tracking

### Overview
Tech logs what drying equipment is placed in each room. This is essential for billing (equipment rental charges) and for monitoring adequate drying setup.

**Trigger:** Tech places or removes equipment during site visit
**Actor:** Tech
**Primary input:** Taps (select from equipment library) + keyboard for serial numbers
**AI assistance:** Recommendations for equipment quantity based on room size and loss class
**Offline:** Yes

### Steps

```
[1] Tech navigates to job -> room -> "Equipment"
         |
[2] Equipment placement screen:
         +-----------------------------------------+
         |  Equipment - Kitchen                     |
         |                                          |
         |  [+ Add Equipment]                       |
         |                                          |
         |  Active Equipment:                       |
         |  (none yet)                              |
         |                                          |
         |  AI Suggestion:                          |
         |  Based on room size (12x10, Class 2):    |
         |  - 1 LGR Dehumidifier                    |
         |  - 4 Air Movers                          |
         |  [Apply Suggestions]                     |
         +-----------------------------------------+
         |
[3] Tap "+ Add Equipment"
         |
    [3a] Equipment type:
         - Air Mover / Fan
         - Dehumidifier (LGR, Conventional, Desiccant)
         - Air Scrubber
         - Heater
         - Deodorization (Ozone, Hydroxyl)
         - Moisture Meter (for assignment, not placement)
         - Other
         |
    [3b] Equipment details:
         - Brand/Model (select from library or type new)
         - Serial number / Asset tag (optional, for company-owned units)
         - Rental source (if rented) -- "Company Owned" | vendor name
         |
    [3c] Placement details:
         - Location in room (optional text, e.g., "Against north wall")
         - Placed date/time (defaults to now)
         |
[4] Equipment saved, appears in room list
         |
[5] To remove/pick up equipment:
         - Swipe item or tap "Pick Up"
         - Records pickup date/time
         - Calculates total days placed
         |
[6] Equipment summary per job shows:
         |
    All Equipment - Job JOB-20260115-001
    Kitchen:    1 Dehu (Day 3) | 4 Air Movers (Day 3)
    Bathroom:   1 Dehu (Day 3) | 2 Air Movers (Day 3)
    Total: 2 Dehumidifiers, 6 Air Movers
    Total equipment days: 18
```

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| equipment_placement_id | UUID | equipment_placements table |
| job_id | UUID (FK) | equipment_placements table |
| room_id | UUID (FK) | equipment_placements table |
| equipment_type | enum | equipment_placements table |
| equipment_brand | string | equipment_placements table |
| equipment_model | string | equipment_placements table |
| serial_number | string | equipment_placements table |
| rental_source | string | equipment_placements table |
| placed_at | timestamp | equipment_placements table |
| picked_up_at | timestamp | equipment_placements table |
| placed_by | UUID (FK) | equipment_placements table |
| picked_up_by | UUID (FK) | equipment_placements table |
| location_description | string | equipment_placements table |
| total_days | float (calculated) | equipment_placements table |

### Company Equipment Library

| Field | Type | Storage |
|-------|------|---------|
| equipment_id | UUID | equipment_library table |
| company_id | UUID (FK) | equipment_library table |
| equipment_type | enum | equipment_library table |
| brand | string | equipment_library table |
| model | string | equipment_library table |
| serial_number | string | equipment_library table |
| status | enum (available, deployed, maintenance) | equipment_library table |
| current_job_id | UUID (FK, nullable) | equipment_library table |

### Outputs
- Equipment placement records per room
- Total equipment days for billing
- Equipment utilization tracking
- Data for report generation

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Equipment moved between rooms | "Pick up" from room A, "Place" in room B -- two records |
| Equipment already deployed on another job | Warning: "This unit is currently deployed on JOB-xxx. Continue?" |
| Power outage / equipment failure | Note field on equipment record for issues |
| Forgot to log pickup | Allow backdating pickup with manual date/time entry |

### Dependencies
- **Requires:** Job exists (#1), Room(s) defined (#2)
- **Feeds into:** Dry Log (#9), Report Generation (#10)
- **Related:** Equipment Library in Settings (#16)

---

## Workflow 7: Photo Documentation

### Overview
Tech captures photos of damage, progress, and equipment. Photos are geotagged and timestamped automatically. They can be tagged by room and category.

**Trigger:** Tech taps camera button at any point during job work
**Actor:** Tech
**Primary input:** Camera + taps for tagging
**AI assistance:** Auto-categorization of photo content, duplicate detection
**Offline:** Yes -- photos stored locally, uploaded on reconnect

### Steps

```
[1] Tech taps camera icon (available from job detail, room detail, or FAB)
         |
[2] Device camera opens
         |
[3] Tech takes photo
         |
[4] Photo captured with automatic metadata:
         - Timestamp
         - GPS coordinates (auto-logged)
         - Device info
         - Auto-association: GPS matches to active job/location
           (like CompanyCam -- photo auto-logs to the job based on GPS proximity)
         |
[5] Post-capture tagging screen:
         +-----------------------------------------+
         |  [Photo Preview]                         |
         |                                          |
         |  Job: [JOB-042 - 123 Main St] (auto)    |
         |  Room: [Kitchen  v]                      |
         |                                          |
         |  Category:                               |
         |  ( ) Before / Initial damage              |
         |  ( ) During / Progress                   |
         |  ( ) After / Completed                   |
         |  ( ) Equipment                           |
         |  ( ) Moisture reading                    |
         |  ( ) Contents                            |
         |  ( ) Safety concern                      |
         |                                          |
         |  Caption (optional): [Voice or type]     |
         |                                          |
         |  [Save] [Retake] [Delete]                |
         +-----------------------------------------+
         |
[6] Photo saved and associated with job + room
         - If GPS matches a job address (within 0.1 miles), auto-associate
         - If no match, prompt tech to select job manually
         |
[7] Tech can continue taking more photos (rapid capture mode)
         - Batch tagging available after capture session
         |
[8] All photos visible in job photo gallery:
         - Filterable by room, category, date
         - Grid view with thumbnails
         - Tap to view full-size with metadata overlay
         |
[9] Job Photo Archive (cross-job):
         - All company photos searchable by location on a map view
         - Click a map pin to see all photos taken at that address
         - Reference library for past work ("at that job we did X")
         - Replaces contractor's current iCloud workaround for photo organization
```

> **Contractor feedback (Brett Sodders):** Photo documentation with auto-location is "the biggest one to get paid." CompanyCam's auto-location feature is the gold standard to match. Photos must geo-tag automatically and log to the correct job without manual selection when possible.

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| photo_id | UUID | photos table |
| job_id | UUID (FK) | photos table |
| room_id | UUID (FK, nullable) | photos table |
| site_visit_id | UUID (FK) | photos table |
| file_url | string | Supabase Storage |
| thumbnail_url | string | Supabase Storage |
| taken_at | timestamp | photos table |
| taken_lat | float | photos table |
| taken_lng | float | photos table |
| category | enum | photos table |
| caption | string | photos table |
| taken_by | UUID (FK) | photos table |
| file_size_bytes | int | photos table |
| sync_status | enum (pending, uploaded, failed) | photos table |

### Outputs
- Timestamped, geotagged photo record
- Organized photo gallery per job
- Photos available for AI Photo Scope (#8)
- Photos included in reports (#10)

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Camera permission denied | Show instructions to enable, offer file upload as alternative |
| Storage full on device | Warning before capture: "Device storage low. Photos may not save." |
| Blurry photo detected | AI check post-capture: "This photo appears blurry. Retake?" |
| Bulk upload from gallery | "Import Photos" option to select multiple existing photos, batch tag |
| GPS unavailable | Photo saved without coordinates, flagged |
| Offline -- many photos queued | Show upload queue with progress. Prioritize by job. |
| Photo accidentally deleted | Soft delete with 30-day recovery |

### Dependencies
- **Requires:** Job exists (#1)
- **Feeds into:** AI Photo Scope (#8), Report Generation (#10)
- **Optional:** Room defined for per-room tagging

---

## Workflow 8: AI Photo Scope

### Overview
Tech uploads damage photos, and AI analyzes them to suggest Xactimate line items. This accelerates scoping by identifying damage types and quantities from visual evidence.

**Trigger:** Tech selects photos and taps "AI Scope" or uploads photos directly to AI Scope
**Actor:** Tech or Owner
**Primary input:** Photo upload + review taps
**AI assistance:** Core of this workflow -- Claude Vision analyzes damage photos
**Offline:** No -- requires API connectivity

### Steps

```
[1] User navigates to job -> "AI Photo Scope"
         |
[2] Photo selection:
         - Select from existing job photos (multi-select)
         - Or capture new photos directly
         - Or upload from device gallery
         |
[3] User selects room for context (helps AI accuracy)
         |
[4] User taps "Analyze Photos"
         |
[5] Loading state:
         +-----------------------------------------+
         |  Analyzing 4 photos...                   |
         |                                          |
         |  [=====>              ] 40%              |
         |                                          |
         |  Looking for:                            |
         |  - Water damage indicators               |
         |  - Affected materials                    |
         |  - Damage severity                       |
         |  - Required repairs                      |
         +-----------------------------------------+
         |
[6] AI returns analysis:
         +-----------------------------------------+
         |  AI Photo Scope Results                  |
         |  Kitchen - 4 photos analyzed             |
         |                                          |
         |  [Photo 1 thumbnail]                     |
         |  Detected: Water staining on drywall,    |
         |  approx 2ft high, baseboard warped       |
         |                                          |
         |  Suggested Line Items:                   |
         |                                          |
         |  [x] WTR EXTRTCPT - Extract water,       |
         |      carpet      Qty: 120 SF   92%       |
         |  [x] DRY RMBASBD - R&R baseboard         |
         |      Qty: 24 LF                  87%     |
         |  [x] DRY CUT24 - Cut drywall 2' flood   |
         |      cut      Qty: 48 SF         85%     |
         |  [x] DRY RMCPT+P - R&R carpet & pad     |
         |      Qty: 120 SF                 78%     |
         |  [ ] PTG SEAL - Seal/prime after drying  |
         |      Qty: 48 SF                  55%     |
         |                                          |
         |  [Edit Items] [Accept All] [Discard]     |
         +-----------------------------------------+
         |
[7] User reviews, toggles, edits quantities
         |
[8] Accepted items added to job scope (merged with voice scope items)
         - S500/OSHA compliance justifications auto-suggested per line item
           (same as Manual Entry #4, step 5)
         |
[9] If duplicates detected with existing scope items:
         -> "DRY RMBASBD already in scope (24 LF from voice scope).
            Keep existing | Replace | Add both"
```

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| ai_scope_id | UUID | ai_photo_scopes table |
| job_id | UUID (FK) | ai_photo_scopes table |
| room_id | UUID (FK) | ai_photo_scopes table |
| photo_ids | UUID[] | ai_photo_scopes table |
| ai_response | jsonb | ai_photo_scopes table |
| ai_model_version | string | ai_photo_scopes table |
| processing_time_ms | int | ai_photo_scopes table |
| created_by | UUID (FK) | ai_photo_scopes table |
| created_at | timestamp | ai_photo_scopes table |
| line items | (same schema as voice scope) | scope_line_items table with source: "ai_photo" |

### Outputs
- AI-generated line items with confidence scores
- Visual analysis summary per photo
- Line items merged into job scope

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Poor photo quality | AI returns lower confidence + warning: "Image quality may affect accuracy" |
| Non-damage photo (e.g., selfie) | AI: "No water damage detected in this image. Select different photos?" |
| AI suggests wrong damage type | User can edit/remove. Feedback logged for model improvement. |
| Very large photos (>10MB) | Compress before upload, maintain quality for analysis |
| Rate limiting on AI API | Queue requests, show position: "2 requests ahead of yours" |
| API timeout | Retry automatically once. If second failure: "Analysis unavailable. Try again later or use manual entry." |

### Dependencies
- **Requires:** Job exists (#1), Photos taken (#7)
- **AI service:** Claude Vision API
- **Merges with:** Voice Scope (#3) and Manual Entry (#4) line items
- **Feeds into:** Report Generation (#10), Job Review (#13)

---

## Workflow 9: Dry Log / Daily Monitoring

### Overview
On return visits, the tech takes new moisture readings and logs drying progress. The system compares readings over time and indicates whether the structure is drying properly.

**Trigger:** Tech returns to job site for monitoring visit (typically daily for 3-5 days)
**Actor:** Tech
**Primary input:** Keyboard (numeric entry) + taps
**AI assistance:** Trend analysis, drying anomaly alerts, estimated days remaining
**Offline:** Yes -- readings captured locally

### Steps

```
[1] Tech opens job, taps "New Visit" or "Continue Monitoring"
         |
[2] Site visit initiated (same as Workflow #2, step 3-4)
         |
[3] Dry Log dashboard shows progress overview:
         +-----------------------------------------+
         |  Dry Log - JOB-20260115-001              |
         |  Day 3 of Drying                         |
         |                                          |
         |  Overall Progress: 62% dry               |
         |  [=========>       ]                     |
         |                                          |
         |  Room Status:                            |
         |  Kitchen    [==>       ] 35% -- ALERT    |
         |  Bathroom   [======>   ] 70%             |
         |  Hallway    [=========] 100% GOAL MET    |
         |                                          |
         |  [Start Today's Readings]                |
         +-----------------------------------------+
         |
[4] Tech taps room to take today's readings
         |
[5] Reading entry (same UI as Workflow #5)
         - Previous reading values shown for reference
         - Color coding: green (improving), yellow (stagnant), red (worsening)
         |
[6] After entering readings, comparison shown:
         +-----------------------------------------+
         |  Kitchen - Moisture Trend                |
         |                                          |
         |  Point | Day 1 | Day 2 | Day 3 | Dry   |
         |  ------+-------+-------+-------+-----   |
         |  Pt 1  | 45.2  | 38.1  | 32.5  | 15.0  |
         |  Pt 2  | 38.7  | 29.4  | 22.8  | 15.0  |
         |  Pt 3  | 22.1  | 18.3  | 15.2  | 15.0  |
         |  Pt 4  | 14.8  | 14.5  | 14.3  | 15.0  |
         |                                          |
         |  Atmo  | Day 1 | Day 2 | Day 3          |
         |  Temp  | 72.5  | 74.2  | 75.0           |
         |  RH    | 65.2  | 55.1  | 48.3           |
         |  GPP   | 58.3  | 51.2  | 45.8           |
         |                                          |
         |  AI Note: "Drying on track. At this      |
         |  rate, estimated 2 more days to reach     |
         |  dry standard for all points."            |
         +-----------------------------------------+
         |
[7] Equipment check:
         - System prompts: "Equipment still running? All units operational?"
         - Tech confirms or notes issues
         |
[8] If all points in a room meet dry standard:
         -> "Kitchen has reached dry standard!
            Ready to pick up equipment?
            [Yes, Pick Up] [Leave for 1 more day]"
         |
[9] End of visit summary
```

### Data Captured
Same as Moisture Reading Collection (#5), plus:

| Field | Type | Storage |
|-------|------|---------|
| drying_day | int (calculated) | derived from visit dates |
| drying_trend | enum (improving, stagnant, worsening) | calculated per point |
| estimated_days_remaining | int | calculated by AI |
| equipment_status_check | jsonb | site_visits table |

### Outputs
- Daily moisture reading records
- Drying trend visualization
- AI-generated drying estimates
- Equipment status confirmation
- Dry-standard-met notifications

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Readings going up | Alert: "Point 2 in Kitchen increased from 29.4 to 35.1. Possible new water source. Investigate." |
| Drying stalled (no change 2+ days) | Alert: "Stagnant readings detected. Consider: more equipment, antimicrobial treatment, or moisture barrier removal." |
| Missed a day | Gap noted in log. AI adjusts trend calculations. |
| New area of damage found | Allow adding new room/points at any time |
| Different tech on return visit | All previous data visible regardless of who entered it |

### Dependencies
- **Requires:** Initial moisture readings exist (#5), Equipment placed (#6)
- **Builds on:** Each previous visit's data
- **Feeds into:** Report Generation (#10), Job Review (#13)

---

## Workflow 10: Report Generation

### Overview
Generates professional reports for insurance adjusters, company records, and customer communication. Multiple report types available.

**Trigger:** Owner or Tech taps "Generate Report" from job detail
**Actor:** Owner (primary), Tech (can generate from field)
**Primary input:** Taps (select report type and options)
**AI assistance:** Narrative generation for scope notes, data summarization
**Offline:** No -- requires server-side processing

### Steps

```
[1] User navigates to job -> "Reports"
         |
[2] Report type selection:
         +-----------------------------------------+
         |  Generate Report                         |
         |                                          |
         |  [Xactimate Scope Notes]                 |
         |  Formatted scope with all line items,     |
         |  organized by room. Ready to import.      |
         |                                          |
         |  [Moisture/Drying Report]                 |
         |  Complete moisture log with readings,     |
         |  trends, and drying documentation.        |
         |                                          |
         |  [Job Summary Report]                     |
         |  Overview of entire job: scope, photos,   |
         |  readings, equipment, timeline.           |
         |                                          |
         |  [Photo Report]                           |
         |  All photos organized by room and date    |
         |  with captions and metadata.              |
         |                                          |
         |  [Equipment Log]                          |
         |  Equipment placement/pickup dates,        |
         |  total days for billing.                  |
         +-----------------------------------------+
         |
[3] User selects report type
         |
[4] Configuration options:
         - Include company logo/branding
         - Include/exclude specific rooms
         - Date range for readings
         - Include photos (and which categories)
         - Format: PDF (default, non-editable) | ESX (Xactimate import file, optional)
         |
[5] Generation:
         |
    For XACTIMATE SCOPE NOTES:
         - AI generates professional narrative from raw scope data
         - Line items formatted in Xactimate-importable structure
         - Room-by-room organization
         - Includes: loss description, mitigation protocol, line items
         |
    For MOISTURE/DRYING REPORT:
         - Atmospheric readings table per room per day
         - Point readings table with trend columns
         - Drying progress graphs (text-based in V1, charts in V2)
         - Equipment log embedded
         - Final drying certificate when all points at standard
         |
    For JOB SUMMARY:
         - Job details header (customer, address, insurance, dates)
         - Scope summary with total line items
         - Photo thumbnails
         - Moisture summary
         - Equipment summary
         - Timeline of all site visits
         |
[6] Preview screen
         |
[7] User can edit AI-generated narrative before finalizing
         |
[8] Download as PDF or share via:
         - Email to adjuster (pre-filled with adjuster email from job)
         - Email to customer
         - Copy link (Supabase-hosted PDF with expiring link)
```

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| report_id | UUID | reports table |
| job_id | UUID (FK) | reports table |
| report_type | enum | reports table |
| generated_by | UUID (FK) | reports table |
| generated_at | timestamp | reports table |
| config | jsonb | reports table |
| file_url | string | Supabase Storage |
| ai_narrative | text | reports table |
| narrative_edited | boolean | reports table |
| shared_with | jsonb (email recipients) | reports table |
| share_link | string | reports table |
| share_link_expires_at | timestamp | reports table |

### Outputs
- PDF report documents (default -- non-editable, adjusters prefer this)
- ESX export for Xactimate import (optional -- use with caution)
- Shareable links
- Email delivery

> **Contractor feedback (Brett Sodders):** "It feels weird to send an ESX file because once they get it they can manipulate it. Like handing off a Word document where they can rewrite it." PDF is the default and preferred format. ESX is available but secondary.

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Incomplete data (missing readings for some rooms) | Warning: "Kitchen has no moisture readings. Report will note 'No data available'." |
| Very large job (20+ rooms) | Paginated report generation, progress indicator |
| AI narrative needs heavy editing | Full text editor with save-as-draft capability |
| Adjuster email bounces | Notification: "Email to adjuster@insurance.com failed. Verify address." |
| Report needs updating after new data | "Regenerate Report" option, previous version archived |

### Dependencies
- **Requires:** Job data from workflows #1-#9
- **Consumes:** Scope line items, moisture readings, photos, equipment records
- **AI service:** Claude API for narrative generation

---

## Workflow 10b: Auto Adjuster Reports

### Overview
System automatically compiles job progress and sends limited-access reports to insurance adjusters and customers. Reduces phone calls, keeps adjusters informed, and speeds up payment.

> **Contractor feedback (Brett Sodders):** Adjusters constantly call asking for updates. An automated daily report keeps them informed without the contractor having to stop working and make calls.

**Trigger:** Daily (automated, configurable time) or on-demand by owner
**Actor:** System (automated) or Owner (on-demand)
**Primary input:** Configuration (one-time setup per job), then automated
**AI assistance:** Narrative summary generation for progress updates
**Offline:** No -- requires server-side processing and email delivery

### Steps

```
[1] Owner enables "Adjuster Updates" on a job:
         +-----------------------------------------+
         |  Adjuster Updates - JOB-042              |
         |                                          |
         |  Auto-send daily report: [ON]            |
         |  Send time: [6:00 PM v]                  |
         |                                          |
         |  Adjuster email: adj@insurance.com       |
         |  (pre-filled from job insurance info)     |
         |                                          |
         |  Include in report:                      |
         |  [x] Selected photos (owner picks which) |
         |  [x] Latest moisture readings             |
         |  [x] Equipment status                     |
         |  [x] Drying progress summary              |
         |  [ ] Full scope line items                |
         |                                          |
         |  Customer portal: [ON]                    |
         |  Customer sees: Status + selected photos  |
         |  (no moisture data, no scope, no pricing) |
         |                                          |
         |  [Save Settings] [Send Now]               |
         +-----------------------------------------+
         |
[2] At scheduled time (or on "Send Now"), system compiles report:
         |
    [2a] Gathers latest data:
         - Selected photos from most recent visit
         - Current moisture readings with trend
         - Equipment still deployed (count + days)
         - Overall drying progress percentage
         - AI-generated narrative summary of progress
         |
    [2b] Generates limited-access report:
         - Secure, time-limited link (not full app access)
         - Adjuster sees read-only view: photos, readings, progress
         - Adjuster does NOT see: all photos, raw data, pricing, internal notes
         |
[3] Email sent to adjuster:
         +-----------------------------------------+
         |  Subject: Job Update - 123 Main St       |
         |  JOB-042 | Day 3 of Drying               |
         |                                          |
         |  Progress: 62% dry (4 of 6 rooms)        |
         |  Equipment: 2 dehus, 6 air movers active  |
         |  Est. completion: 2 more days              |
         |                                          |
         |  [View Full Report]                       |
         |  (link expires in 30 days)                |
         +-----------------------------------------+
         |
[4] Adjuster clicks link -> secure read-only report page
         |
[5] Customer portal (if enabled):
         - Even more limited view: job status + selected photos only
         - No moisture data, no scope, no pricing
         - Reduces "when will you be done?" calls
```

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| adjuster_report_id | UUID | adjuster_reports table |
| job_id | UUID (FK) | adjuster_reports table |
| report_type | enum (adjuster, customer) | adjuster_reports table |
| recipient_email | string | adjuster_reports table |
| sent_at | timestamp | adjuster_reports table |
| secure_link | string | adjuster_reports table |
| secure_link_expires_at | timestamp | adjuster_reports table |
| included_photo_ids | UUID[] | adjuster_reports table |
| include_moisture | boolean | adjuster_reports table |
| include_equipment | boolean | adjuster_reports table |
| include_scope | boolean | adjuster_reports table |
| ai_summary | text | adjuster_reports table |
| viewed_at | timestamp | adjuster_reports table |
| auto_send_enabled | boolean | job_adjuster_settings table |
| auto_send_time | time | job_adjuster_settings table |

### Outputs
- Daily automated email to adjuster with secure report link
- Optional customer portal with status-only view
- Read-only report page (no login required, link-based access)
- View tracking (owner can see if adjuster opened the report)

### Edge Cases

| Scenario | Handling |
|----------|----------|
| No new data since last report | Skip sending, or send "No update today -- drying continues" |
| Adjuster email bounces | Notify owner: "Report email to adj@insurance.com failed" |
| Secure link shared with unauthorized party | Link is read-only with limited data, acceptable risk |
| Job completed but auto-send still on | Auto-disable when job status changes to "Completed" |
| Multiple adjusters on same job | Allow multiple recipient emails |

### Dependencies
- **Requires:** Job exists (#1), some data captured (photos, readings, etc.)
- **Consumes:** Photos (#7), Moisture readings (#5), Equipment (#6)
- **Related to:** Report Generation (#10) -- full reports vs. these limited progress updates

---

## Workflow 11: Job Scheduling & Dispatch

### Overview
Owner sets up the week's schedule, assigns techs to jobs with specific dates and times, and techs receive automatic notifications. This replaces the current workflow of texting employees late at night about next-day assignments.

> **Contractor feedback (Brett Sodders, #1 pain point):** "I'm texting my guys at 11pm telling them where to go tomorrow." This workflow must eliminate late-night text messages by letting owners batch-schedule the week and have techs notified automatically.

**Trigger:** Owner assigns techs to jobs or creates/updates schedule
**Actor:** Owner (creates schedule), Tech (views and acts on schedule)
**Primary input:** Keyboard + taps (Owner, desktop or phone), View-only + check-in (Tech, phone)
**AI assistance:** Suggested scheduling based on tech proximity to job sites, workload balancing
**Offline:** No -- requires connectivity for schedule sync and notifications

### Steps

```
[1] Owner navigates to "Schedule" view (calendar/list hybrid)
         |
[2] Schedule management screen:
         +-----------------------------------------+
         |  Schedule          [Week v]  [+ Assign] |
         |                                          |
         |  Mon Jan 19                              |
         |  +------------------------------------+  |
         |  | 8:00 AM  JOB-042 | 123 Main St    |  |
         |  | Tech: Mike J.    | Monitoring      |  |
         |  +------------------------------------+  |
         |  | 1:00 PM  JOB-047 | 456 Oak Ave    |  |
         |  | Tech: Mike J.    | Initial Assess  |  |
         |  +------------------------------------+  |
         |                                          |
         |  Tue Jan 20                              |
         |  +------------------------------------+  |
         |  | 9:00 AM  JOB-042 | 123 Main St    |  |
         |  | Tech: Sarah K.   | Monitoring      |  |
         |  +------------------------------------+  |
         |                                          |
         |  Unscheduled Jobs:                       |
         |  JOB-048 - No tech, no date assigned     |
         |  JOB-049 - Tech assigned, no date        |
         +-----------------------------------------+
         |
[3] Owner taps "+ Assign" or taps an empty slot:
         |
    [3a] Select job (from active jobs list)
    [3b] Select tech(s) (from team roster)
    [3c] Select date
    [3d] Select time (optional -- can be "AM" / "PM" / specific time)
    [3e] Add notes (optional, e.g., "Bring extra air movers")
         |
[4] Assignment saved
         |
[5] Push notification sent to assigned tech(s):
         "New assignment: JOB-042 at 123 Main St
          Mon Jan 19, 8:00 AM - Monitoring visit
          Notes: Bring extra air movers"
         |
[6] Tech sees "My Schedule" on their phone:
         +-----------------------------------------+
         |  My Schedule                             |
         |                                          |
         |  TODAY - Mon Jan 19                      |
         |  +------------------------------------+  |
         |  | 8:00 AM  JOB-042                   |  |
         |  | 123 Main St - Monitoring            |  |
         |  | Notes: Bring extra air movers       |  |
         |  | [Navigate] [Check In]               |  |
         |  +------------------------------------+  |
         |  | 1:00 PM  JOB-047                   |  |
         |  | 456 Oak Ave - Initial Assessment    |  |
         |  | [Navigate] [Check In]               |  |
         |  +------------------------------------+  |
         |                                          |
         |  TOMORROW - Tue Jan 20                   |
         |  (No assignments)                        |
         +-----------------------------------------+
         |
[7] Tech taps "Check In" when arriving at job site
         -> Triggers Site Visit workflow (#2)
         -> GPS recorded, timestamp logged
         -> Status updates back to owner's dashboard
         |
[8] Owner can view real-time status:
         - Scheduled (not yet checked in)
         - En route (tapped Navigate)
         - On site (checked in)
         - Completed (ended site visit)
```

### Data Captured

| Field | Type | Required | Storage |
|-------|------|----------|---------|
| schedule_id | UUID | auto | job_schedules table |
| job_id | UUID (FK) | yes | job_schedules table |
| user_id | UUID (FK) | yes | job_schedules table |
| scheduled_date | date | yes | job_schedules table |
| scheduled_time | time | no | job_schedules table |
| time_slot | enum (morning, afternoon, specific) | no | job_schedules table |
| notes | text | no | job_schedules table |
| status | enum (scheduled, en_route, on_site, completed, no_show) | auto | job_schedules table |
| assigned_by | UUID (FK) | auto | job_schedules table |
| assigned_at | timestamp | auto | job_schedules table |
| checked_in_at | timestamp | no | job_schedules table |
| notification_sent | boolean | auto | job_schedules table |
| notification_sent_at | timestamp | no | job_schedules table |

### Outputs
- Tech receives push notification with assignment details
- Tech sees daily/weekly schedule on phone
- Owner sees schedule overview with real-time status
- Check-in triggers site visit workflow
- Eliminates late-night text messages for next-day assignments

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Double-booking a tech (two jobs, same time) | Warning: "Mike is already scheduled for JOB-042 at 8:00 AM. Schedule anyway?" |
| Tech not available (sick, day off) | Owner can reassign to another tech. Original tech notified of cancellation. |
| Schedule changed after notification sent | New notification: "Schedule updated: JOB-042 moved to 10:00 AM" |
| Tech doesn't check in by scheduled time | Alert to owner: "Mike hasn't checked in for JOB-042 (scheduled 8:00 AM, now 8:30 AM)" |
| Weekend/after-hours emergency | Allow scheduling at any time. Emergency flag bypasses quiet hours for notifications. |
| Owner wants to set up entire week at once | Batch scheduling mode: select multiple days, assign same tech to recurring jobs |

### Dependencies
- **Requires:** Jobs exist (#1), Team members exist (#12)
- **Feeds into:** Site Arrival (#2), Dashboard (#14)
- **Navigation:** "Schedule" tab added to bottom nav (mobile) and sidebar (desktop)

---

## Workflow 12: Team Management

### Overview
Company owner invites technicians to their company, manages roles, and assigns techs to jobs. Includes invite, role management, and job assignment. Full team management (availability, skills, workload tracking) in later phases.

**Trigger:** Owner needs to add team members or assign jobs
**Actor:** Owner
**Primary input:** Keyboard
**AI assistance:** None in V1
**Offline:** No -- requires connectivity

### Steps

```
[1] Owner navigates to "Team" from sidebar/nav
         |
[2] Team management screen:
         +-----------------------------------------+
         |  Team                     [+ Invite]     |
         |                                          |
         |  Active Members:                         |
         |                                          |
         |  John Smith (Owner)          You         |
         |  john@restorationco.com                  |
         |                                          |
         |  Mike Johnson (Tech)      Active         |
         |  mike@restorationco.com                  |
         |  Active jobs: 3                          |
         |  [Edit] [Remove]                         |
         |                                          |
         |  Pending Invitations:                    |
         |  sarah@restorationco.com   Sent Jan 12   |
         |  [Resend] [Cancel]                       |
         +-----------------------------------------+
         |
[3] To invite: Tap "+ Invite"
         |
    [3a] Enter email address
    [3b] Select role: Tech | Owner (co-owner)
    [3c] System sends invitation email with sign-up link
         |
[4] Invited user:
         - Receives email with link
         - Clicks link -> sign up flow (or login if existing account)
         - Automatically joined to company
         |
[5] To assign tech to job:
         - From job detail -> "Assigned Techs" -> "Assign"
         - Select from team roster
         - Tech receives push notification
```

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| user_id | UUID | users table |
| company_id | UUID (FK) | company_members table |
| role | enum (owner, tech) | company_members table |
| invited_by | UUID (FK) | company_members table |
| invited_at | timestamp | company_members table |
| accepted_at | timestamp | company_members table |
| status | enum (pending, active, deactivated) | company_members table |
| invitation_token | string | invitations table |
| invitation_email | string | invitations table |
| invitation_expires_at | timestamp | invitations table |

### Outputs
- Team roster for the company
- Tech assignment to jobs
- Activity tracking per team member

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Invited email already has account | Account linked to company automatically |
| Invitation expired (7 days) | Owner can resend |
| Tech removed while assigned to active jobs | Warning: "Mike has 3 active jobs. Reassign before removing?" |
| Owner tries to invite themselves | Prevented: "This email is already on your team." |
| Company has only one owner, tries to remove self | Prevented: "You are the only owner. Transfer ownership first." |

### Dependencies
- **Requires:** Company setup complete (Onboarding #15)
- **Feeds into:** Job assignment in New Job Creation (#1), Scheduling (#11), Job Site Arrival (#2)

---

## Workflow 13: Job Review & QA

### Overview
Owner reviews a tech's completed work before sending documentation to the insurance adjuster. This is the quality gate.

**Trigger:** Tech marks job as "Ready for Review" or Owner opens completed job
**Actor:** Owner
**Primary input:** Keyboard + taps (desktop-first workflow)
**AI assistance:** Completeness check, flag missing data, scope consistency review
**Offline:** No -- requires full data access

### Steps

```
[1] Owner sees "Ready for Review" badge on Job Board
         |
[2] Opens job detail -> "Review" tab
         |
[3] AI Completeness Check runs automatically:
         +-----------------------------------------+
         |  QA Review - JOB-20260115-001            |
         |                                          |
         |  Completeness Score: 85%                  |
         |                                          |
         |  [OK] Customer info complete              |
         |  [OK] Insurance info complete             |
         |  [OK] 4 rooms documented                  |
         |  [OK] Scope items: 18 line items          |
         |  [!!] Kitchen: No "before" photos         |
         |  [OK] Moisture readings: 3 visits          |
         |  [!!] Bathroom: Only 1 moisture point     |
         |       (minimum recommended: 3)            |
         |  [OK] Equipment log complete              |
         |  [OK] All equipment picked up             |
         |                                          |
         |  [View Full Job] [View Reports]           |
         +-----------------------------------------+
         |
[4] Owner reviews each section:
         |
    [4a] SCOPE REVIEW
         - All line items listed by room
         - Owner can edit quantities, add/remove items
         - AI flags: unusual quantities, missing common items
           e.g., "Drywall cut but no insulation removal listed"
         |
    [4b] PHOTO REVIEW
         - All photos in gallery
         - Flag missing categories per room
         - Owner can add captions, re-categorize
         |
    [4c] MOISTURE DATA REVIEW
         - Verify readings are reasonable
         - Check drying trend is complete
         - Verify all rooms reached dry standard (or explain why not)
         |
    [4d] REPORT REVIEW
         - Preview generated reports
         - Edit AI-generated narratives
         - Approve for sending
         |
[5] Owner can:
         - "Approve" -- marks job as reviewed, ready to send to adjuster
         - "Request Changes" -- sends notes back to tech
         - "Edit Directly" -- makes changes themselves
         |
[6] If "Request Changes":
         - Owner types feedback per issue
         - Tech receives notification: "Changes requested on JOB-xxx"
         - Tech sees specific feedback items to address
         |
[7] If "Approve":
         - Job status changes to "Reviewed"
         - Owner can immediately generate and send reports
```

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| review_id | UUID | job_reviews table |
| job_id | UUID (FK) | job_reviews table |
| reviewer_id | UUID (FK) | job_reviews table |
| completeness_score | float | job_reviews table |
| completeness_issues | jsonb | job_reviews table |
| status | enum (in_review, changes_requested, approved) | job_reviews table |
| feedback_items | jsonb | job_reviews table |
| reviewed_at | timestamp | job_reviews table |
| approved_at | timestamp | job_reviews table |

### Outputs
- QA completeness report
- Feedback to tech (if changes requested)
- Approved status enabling report distribution
- Audit trail of review process

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Job has no scope items | Block review: "No scope items found. Job cannot be reviewed." |
| Multiple rounds of revisions | History tracked: Review Round 1, 2, 3... |
| Owner edits tech's data | Edit logged with who made the change and when |
| Tech disputes owner's changes | Comment thread on specific items (V2 feature, flag for now) |
| Job partially complete (still drying) | Allow partial review: "Scope Approved | Moisture Log In Progress" |

### Dependencies
- **Requires:** Job with data from workflows #3-#9
- **Feeds into:** Report Generation (#10) -- approved jobs ready for adjuster
- **Notifies:** Tech via push notification

---

## Workflow 14: Dashboard / Job Overview

### Overview
The central hub showing all jobs, their statuses, and key metrics. Different views for Owner vs Tech.

**Trigger:** User opens app / navigates to Home/Dashboard
**Actor:** Owner and Tech (different views)
**Primary input:** Taps/clicks (navigation)
**AI assistance:** Smart alerts, workload suggestions
**Offline:** Partial -- cached data shown, marked as potentially stale

### Steps - Owner View

```
[1] Owner opens app -> Dashboard
         |
[2] Dashboard layout:
         +-----------------------------------------+
         |  RestorOS Dashboard                      |
         |  Good morning, John                      |
         |                                          |
         |  ACTIVE JOBS: 7    NEED REVIEW: 2        |
         |  COMPLETED: 34     THIS MONTH: 5         |
         |                                          |
         |  Alerts:                                 |
         |  [!] JOB-042: Drying stalled in Kitchen  |
         |  [!] JOB-038: Ready for review           |
         |  [!] JOB-045: No visit logged today      |
         |                                          |
         |  Active Jobs:                            |
         |  +------------------------------------+  |
         |  | JOB-042 | 123 Main St              |  |
         |  | Day 4   | 3 rooms | 62% dry        |  |
         |  | Tech: Mike J.  | Status: In Drying  |  |
         |  +------------------------------------+  |
         |  | JOB-045 | 456 Oak Ave              |  |
         |  | Day 1   | 5 rooms | 15% dry        |  |
         |  | Tech: Sarah K. | Status: Scoping    |  |
         |  +------------------------------------+  |
         |                                          |
         |  Team Activity:                          |
         |  Mike J. -- 3 active jobs, on site now   |
         |  Sarah K. -- 2 active jobs, last seen 2h |
         +-----------------------------------------+
```

### Steps - Tech View

```
[1] Tech opens app -> My Jobs
         |
[2] Tech dashboard:
         +-----------------------------------------+
         |  My Jobs                                 |
         |  Hi Mike                                 |
         |                                          |
         |  TODAY'S SCHEDULE:                        |
         |  9:00 AM - JOB-042 (monitoring visit)    |
         |  1:00 PM - JOB-047 (initial assessment)  |
         |                                          |
         |  Active Jobs (3):                        |
         |  +------------------------------------+  |
         |  | JOB-042 | 123 Main St              |  |
         |  | Day 4   | Need readings today       |  |
         |  | [Start Visit]                       |  |
         |  +------------------------------------+  |
         |  | JOB-045 | 456 Oak Ave              |  |
         |  | Day 1   | Scoping incomplete        |  |
         |  | [Continue Scoping]                  |  |
         |  +------------------------------------+  |
         |                                          |
         |  Notifications:                          |
         |  - New job assigned: JOB-047             |
         |  - Changes requested: JOB-038            |
         +-----------------------------------------+
```

### Data Captured
Dashboard is read-only. No new data captured.

### Outputs
- Real-time job status overview
- Alerts for items needing attention
- Quick navigation to specific jobs
- Team activity summary (Owner only)

### Edge Cases

| Scenario | Handling |
|----------|----------|
| No active jobs | Empty state: "No active jobs. [Create New Job]" |
| Many active jobs (20+) | Scrollable list with search/filter |
| Stale offline data | Banner: "Showing cached data from [timestamp]. Connect to refresh." |
| Tech has no scheduled jobs today | Show "No jobs scheduled today" with list of all active jobs |

### Dependencies
- **Reads from:** All job data
- **Links to:** All workflows via job detail navigation

---

## Workflow 15: User Onboarding

### Overview
New user signs up, creates their company, and is guided through first job creation.

**Trigger:** User visits app for the first time or receives invitation
**Actor:** New user (becomes Owner or Tech)
**Primary input:** Keyboard
**AI assistance:** None in onboarding
**Offline:** No -- requires connectivity

### Steps - New Company (Owner)

```
[1] User visits app -> "Sign Up"
         |
[2] Authentication:
         - Email + Password
         - OR Google OAuth
         - OR Apple Sign-In
         |
[3] Email verification (if email/password)
         |
[4] Profile setup:
         - Full name
         - Phone number
         - Role: "I'm starting a company" | "I was invited to a team"
         |
[5] If "starting a company":
         |
    [5a] Company Setup:
         - Company name
         - Company phone
         - Company address (auto-complete)
         - License number (optional)
         - Logo upload (optional)
         |
    [5b] Equipment Library Quick Setup:
         "What moisture meters do you use?"
         [ ] Protimeter  [ ] Delmhorst  [ ] Flir
         [ ] Wagner      [ ] Tramex    [ ] Other
         |
         "What drying equipment do you have?"
         Air movers: [___] units
         Dehumidifiers: [___] units
         Air scrubbers: [___] units
         |
    [5c] First Job Prompt:
         "Ready to create your first job?"
         [Create Job] [Skip for now]
         |
[6] If "invited to a team":
         - Enter invitation code or paste link
         - Linked to company automatically
         - Profile complete, redirect to "My Jobs"
```

### Steps - Invited Tech

```
[1] Tech receives invitation email
         |
[2] Clicks link -> Sign up form (pre-filled email)
         |
[3] Creates password (or OAuth)
         |
[4] Profile setup: name, phone
         |
[5] Automatically joined to company
         |
[6] Brief tutorial overlay (3 screens):
         - "Here's your job board"
         - "Tap a job to start documenting"
         - "Use voice or keyboard to enter data"
         |
[7] Redirect to "My Jobs"
```

### Data Captured

| Field | Type | Storage |
|-------|------|---------|
| user_id | UUID | users table (Supabase Auth) |
| email | string | users table |
| full_name | string | user_profiles table |
| phone | string | user_profiles table |
| avatar_url | string | user_profiles table |
| company_id | UUID | companies table |
| company_name | string | companies table |
| company_phone | string | companies table |
| company_address | text | companies table |
| company_license | string | companies table |
| company_logo_url | string | companies table |
| onboarding_completed | boolean | user_profiles table |
| onboarding_completed_at | timestamp | user_profiles table |

### Outputs
- Authenticated user account
- Company record (if Owner)
- Team membership
- Ready to create jobs

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Email already registered | "Account exists. [Log In] or [Reset Password]" |
| Invitation expired | "This invitation has expired. Ask your team owner to resend." |
| OAuth account has no email | Prompt for email after OAuth |
| User signs up as Owner, later invited to another company | Support multiple company memberships (V2). V1: one company per user. |
| Browser doesn't support PWA | App still works as web app, no install prompt |

### Dependencies
- **Requires:** Nothing (entry point)
- **Enables:** All other workflows
- **Auth provider:** Supabase Auth

---

## Workflow 16: Settings & Profile

### Overview
Configuration screens for user profile, company settings, and equipment library.

**Trigger:** User navigates to Settings
**Actor:** Owner (full access) or Tech (limited to profile)
**Primary input:** Keyboard
**AI assistance:** None
**Offline:** View-only. Changes require connectivity.

### Sections

```
Settings
|
+-- Profile
|   +-- Name, email, phone, avatar
|   +-- Password change
|   +-- Notification preferences
|       - Push: New job assigned, Changes requested, Job alerts
|       - Email: Daily summary, Weekly report
|
+-- Company (Owner only)
|   +-- Company name, address, phone
|   +-- Logo upload
|   +-- License number
|   +-- Default settings:
|       - Default loss type
|       - Default insurance carriers list
|       - Room name presets
|       - Dry standard overrides per material
|
+-- Equipment Library (Owner only)
|   +-- Moisture Meters
|   |   - Add/edit/remove meters
|   |   - Brand, model, serial number, calibration date
|   +-- Drying Equipment
|   |   - Add/edit/remove units
|   |   - Type, brand, model, serial, status
|   +-- Equipment Templates
|       - "Standard water kit": 4 air movers + 1 LGR dehu
|
+-- Team (Owner only)
|   +-- (Links to Team Management workflow #11)
|
+-- Subscription / Billing (Owner only)
|   +-- Plan details
|   +-- Payment method
|   +-- Usage (AI calls, storage)
|
+-- App Settings
    +-- Theme: Light / Dark / System
    +-- Measurement units: Imperial / Metric
    +-- Offline storage limit
    +-- Clear cached data
    +-- About / Version info
```

### Data Captured
Documented in individual table schemas above. Settings are stored in:

| Field | Type | Storage |
|-------|------|---------|
| user_preferences | jsonb | user_profiles table |
| company_settings | jsonb | companies table |
| notification_settings | jsonb | user_profiles table |

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Tech tries to access company settings | Hidden from nav. Direct URL returns 403. |
| Logo too large | Max 2MB, auto-resize |
| Delete equipment that's currently deployed | Prevent: "This unit is deployed on JOB-xxx. Pick up first." |

---

## Job Status Lifecycle

```
    NEW
     |
     v
  ASSIGNED ------> CANCELLED
     |
     v
  SCHEDULED (tech + date assigned)
     |
     v
  IN PROGRESS
     |
     +----> SCOPING
     |        |
     |        v
     +----> DRYING (monitoring phase)
     |        |
     |        v
     +----> READY FOR REVIEW
              |
              v
           IN REVIEW
              |
        +-----+-----+
        |           |
        v           v
  CHANGES        APPROVED
  REQUESTED         |
     |              v
     +----------> COMPLETED
                     |
                     v
                  INVOICED (V2)
                     |
                     v
                  CLOSED
```

### Status Definitions

| Status | Description | Set By |
|--------|-------------|--------|
| New | Job created, no activity yet | System (on creation) |
| Assigned | Tech(s) assigned | Owner or System |
| Scheduled | Tech assigned with specific date/time | Owner (via Scheduling #11) |
| In Progress | Tech has started site visit | System (on first visit) |
| Scoping | Active scope documentation | System (on first scope entry) |
| Drying | Equipment placed, monitoring readings | System (on first moisture reading with equipment) |
| Ready for Review | Tech marks work complete | Tech |
| In Review | Owner is reviewing | System (when Owner opens review) |
| Changes Requested | Owner sent feedback | Owner |
| Approved | QA passed | Owner |
| Completed | Reports sent, job wrapped up | Owner |
| Cancelled | Job cancelled | Owner |

---

## Cross-Workflow Data Flow

```
                        +------------------+
                        | NEW JOB (#1)     |
                        | customer, address|
                        | insurance, loss  |
                        +--------+---------+
                                 |
                        +--------v---------+
                        | SCHEDULING (#11) |
                        | assign tech+date |
                        | push notification|
                        +--------+---------+
                                 |
                        +--------v---------+
                        | SITE ARRIVAL (#2)|
                        | timestamp, GPS,  |
                        | rooms, checklist  |
                        +--------+---------+
                                 |
              +------------------+------------------+
              |                  |                  |
     +--------v------+  +-------v-------+  +-------v--------+
     | VOICE SCOPE   |  | MOISTURE      |  | PHOTOS (#7)    |
     | (#3, V1.1)    |  | READINGS (#5) |  | geo-tagged,    |
     | OR MANUAL (#4)|  | atmo + points |  | auto-location  |
     | -> line items |  | per room      |  +-------+--------+
     | + S500/OSHA   |  |               |          |
     | justifications|  |               |  +-------v--------+
     +--------+------+  +-------+-------+  | AI PHOTO       |
              |                  |          | SCOPE (#8)     |
              |                  |          | -> line items  |
              |                  |          +-------+--------+
              |                  |                  |
     +--------v------+  +-------v-------+          |
     | EQUIPMENT (#6)|  | DRY LOG (#9)  |          |
     | placement,    |  | daily readings|          |
     | tracking      |  | trend analysis|          |
     +--------+------+  +-------+-------+          |
              |                  |                  |
              +------------------+------------------+
                                 |
                   +-------------+-------------+
                   |                           |
          +--------v---------+      +----------v-----------+
          | REPORTS (#10)    |      | AUTO ADJUSTER        |
          | scope, moisture, |      | REPORTS (#10b)       |
          | photos, summary  |      | daily progress,      |
          | PDF default      |      | secure link,         |
          +--------+---------+      | limited access       |
                   |                +----------------------+
          +--------v---------+
          | JOB REVIEW (#13) |
          | QA, approve,     |
          | send to adjuster |
          +------------------+
```

---

## Feature Set

All features are in scope. Implementation roadmap and phasing to be determined after spec review.

| # | Feature | Notes |
|---|---------|-------|
| 1 | AI Photo Scope | With S500/OSHA auto-justifications |
| 2 | Site Log (moisture + equipment) | Atmospheric, points, dehu output, equipment placement |
| 3 | Reports | PDF default, ESX optional |
| 4 | Room Sketching | Dimensions required for payment; LiDAR integration future |
| 5 | Voice Scoping | Needs high accuracy; keyboard fallback equally important |
| 6 | Photo Documentation | GPS auto-tagging, job photo archive |
| 7 | Job Management | Full CRUD with customer, insurance, loss details |
| 8 | Team Management | Invite, roles, assignment |
| 9 | Hazmat Scanner | Asbestos + lead paint detection |
| 10 | Report Generation | Scope notes, moisture reports, job summaries |
| 11 | Job Scheduling & Dispatch | Calendar, tech assignment, push notifications |
| 12 | Auto Adjuster Reports | Limited-access daily updates to adjusters |
| 13 | S500/OSHA Justifications | Auto-attach compliance citations to line items |
## Out of Scope for V1

The following are explicitly NOT included in V1 but may be considered for future versions:

| Feature | Rationale |
|---------|-----------|
| LiDAR room scanning | V2 differentiator. V1 uses manual dimension entry (room shape + wall lengths + ceiling height) |
| Full offline mode | Contractor feedback: "Not a must-have right off the bat." V1 only: photos save locally. |
| Bluetooth meter connectivity | No contractor demand. Techs read the meter, type the number. |
| Customer self-service portal | Limited customer view via Auto Adjuster Reports (#10b) covers V1 needs |
| Invoicing / billing | Separate system (QuickBooks, etc.) |
| Multi-company accounts | One company per user in V1 |
| Real-time collaboration | Not needed when 1-2 techs per job |
| Xactimate direct API integration | ESX file export sufficient for V1 |
| Custom report templates | Standard templates cover 90% of needs |
| Chat / messaging between team | Push notifications + scheduling (#11) sufficient for V1 |
| Inventory management | Equipment tracking (deployed/available) covers V1 needs |
| Third-party TPA integrations | Manual data entry from TPA assignments |
| Advanced analytics / BI | Simple metrics on dashboard sufficient |
| White-labeling | Single brand in V1 |
| Native mobile app | PWA covers mobile needs for V1 |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time to create scope notes | <15 min per room (vs. 30+ min paper) | Timestamp from first voice recording to scope approval |
| Moisture reading entry time | <3 min per room | Timestamp from opening room to saving readings |
| Report generation time | <2 min | Click "Generate" to PDF available |
| Job documentation completeness | >90% of jobs have all required fields | Completeness score from QA workflow |
| Offline reliability | 0 data loss incidents | Sync success rate tracking |
| Tech adoption | >80% of team uses app within 2 weeks | Login/activity tracking |
| AI line item accuracy | >75% acceptance rate | Accepted vs. total suggested items |
| Daily active usage | Tech uses app every workday | DAU/MAU ratio |

---

## Appendix A: Xactimate Line Item Categories (Common Water Restoration)

| Code Prefix | Category | Examples |
|-------------|----------|----------|
| WTR | Water extraction | EXTRTCPT (extract carpet), EXTRHRD (extract hard surface) |
| DRY | Drying/Demolition | CUT24 (2' flood cut), RMBASBD (R&R baseboard), RMCPT (R&R carpet) |
| CLN | Cleaning | CLNCPT (clean carpet), CLNHRD (clean hard surface) |
| PTG | Painting | SEAL (seal/prime), PTGFLAT (paint flat) |
| INS | Insulation | BATTEN (batt insulation), BLOWN (blown insulation) |
| FLR | Flooring | HRDWD (hardwood), LMNT (laminate), TILE (tile) |
| CNT | Contents | MANIP (content manipulation), PACKOUT (pack out) |

---

## Appendix B: Psychrometric Calculations

GPP (Grains Per Pound) is calculated from temperature and relative humidity:

```
Given: Temperature (F), Relative Humidity (%)

1. Convert temp to Celsius: Tc = (Tf - 32) * 5/9
2. Calculate saturation vapor pressure:
   Es = 6.112 * exp((17.67 * Tc) / (Tc + 243.5))
3. Calculate actual vapor pressure:
   E = Es * (RH / 100)
4. Calculate mixing ratio (g/kg):
   W = 621.97 * (E / (1013.25 - E))
5. Convert to GPP:
   GPP = W * 7 (approximately)

Dew Point:
   Td = (243.5 * ln(E/6.112)) / (17.67 - ln(E/6.112))
   Td_F = Td * 9/5 + 32
```

These calculations run client-side for offline capability.

---

*End of Workflow Specification - Version 1.0*
