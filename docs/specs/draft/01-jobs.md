# Jobs + Site Log + Floor Plan — Full Property Documentation

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/7 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 00 (bootstrap) must be complete |
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
- [ ] User can create a job with address + loss type (2 required fields, rest optional)
- [ ] User can create a job by speaking (voice-to-form fills all fields progressively)
- [ ] User can view job list with status badges (Needs Scope / Scoped / Submitted)
- [ ] User can view job detail with all fields editable (grouped: Customer, Loss Info, Insurance)
- [ ] User can add floor plans (one per floor) and rooms to a job
- [ ] User can draw a floor plan sketch (walls, doors, windows) — rooms auto-populate from sketch
- [ ] User can "Clean up sketch" via AI (straighten walls, align corners, standardize dimensions)
- [ ] User can chat with AI to refine sketch ("move the door to the corner", "make it 10x10")
- [ ] User can add rooms without a sketch (typed/spoken dimensions)
- [ ] User can set per-room: dimensions, category, class, dry standard, equipment counts, notes
- [ ] User can upload photos (up to 100 per job, JPEG/PNG, 10MB max each)
- [ ] User can organize photos: tag by room, set photo type (damage/equipment/protection/before/after)
- [ ] User can select specific photos for AI analysis
- [ ] User can delete a photo (tap-and-hold on mobile)
- [ ] User can record daily moisture readings per room (atmospheric + moisture points + dehu output)
- [ ] GPP auto-calculates from temperature + relative humidity
- [ ] User can track equipment placed per room (air movers + dehus with +/- counters)
- [ ] User can add tech field notes (free text, voice-fillable) — AI reads these during scope
- [ ] User can export job as branded PDF (company header, line items, photos, floor plan, moisture log)
- [ ] User can share job via a link (read-only view)
- [ ] User can delete a job
- [ ] Voice input works across all forms (job creation, room setup, moisture readings, tech notes)
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Brett needs to capture everything about a property and its damage — from the initial phone call through daily monitoring to final submission. Today he uses paper + iPhone + scattered photos across Google Drive and Notes. There's no single place to track a job, its rooms, moisture readings, equipment, and documentation.

**Solution:** A complete job + site log system where the contractor:
1. Creates a job (voice or typed — customer, loss info, insurance details)
2. Adds floor plans with room sketches (draw walls → AI cleans up → rooms auto-populate)
3. Uploads and organizes photos by room
4. Tracks daily moisture readings and equipment per room
5. Writes tech field notes (voice-fillable — AI reads these during scope)
6. Exports everything as a branded PDF for the adjuster

This is the container that the AI Pipeline (Spec 02) plugs into.

**Scope:**
- IN: Job CRUD, floor plans + room sketches, room management (dimensions, category, class, equipment, notes), photo upload/organize/tag/delete, moisture readings (daily atmospheric + points + dehu output), GPP auto-calc, tech field notes, PDF export, share link, voice input across all forms
- OUT: AI Photo Scope / line item generation (Spec 02), AI Hazmat Scanner (Spec 02), scheduling/dispatch, team management, offline mode

## Database Schema

### New Enums
```sql
CREATE TYPE loss_type AS ENUM ('water', 'fire', 'mold', 'storm', 'other');
CREATE TYPE water_category AS ENUM ('1', '2', '3');
CREATE TYPE water_class AS ENUM ('1', '2', '3', '4');
```

### Tables

**jobs** (from design.md — already defined)
```sql
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_number      TEXT NOT NULL,  -- format: JOB-YYYYMMDD-XXX
    address_line1   TEXT NOT NULL,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    claim_number    TEXT,
    carrier         TEXT,
    adjuster_name   TEXT,
    adjuster_phone  TEXT,
    adjuster_email  TEXT,
    loss_type       loss_type NOT NULL DEFAULT 'water',
    loss_category   water_category,
    loss_class      water_class,
    loss_cause      TEXT,           -- e.g., "dishwasher leak", "pipe burst"
    loss_date       DATE,
    status          TEXT NOT NULL DEFAULT 'needs_scope',  -- needs_scope | scoped | submitted
    customer_name   TEXT,
    customer_phone  TEXT,
    customer_email  TEXT,
    year_built      INTEGER,        -- property age; pre-1978 = lead paint risk. Auto-fill from property API, confirm with homeowner.
    room_count      INTEGER DEFAULT 0,
    tech_notes      TEXT,           -- free-text field, voice-fillable, AI reads during scope
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(company_id, job_number)
);
```

**floor_plans** (NEW — one per floor)
```sql
CREATE TABLE floor_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    floor_number    INTEGER NOT NULL DEFAULT 1,
    floor_name      TEXT NOT NULL DEFAULT 'Floor 1',  -- "Floor 1", "Basement", "Attic"
    canvas_data     JSONB,          -- walls, doors, windows as geometric primitives
    thumbnail_url   TEXT,           -- rendered preview of the sketch
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(job_id, floor_number)
);
```

**job_rooms** (NEW — each room belongs to a floor plan)
```sql
CREATE TABLE job_rooms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    floor_plan_id   UUID REFERENCES floor_plans(id) ON DELETE SET NULL,  -- nullable: rooms can exist without a sketch
    room_name       TEXT NOT NULL,   -- "Master Bedroom", "Kitchen", "Living Room"
    length_ft       DECIMAL(6,2),
    width_ft        DECIMAL(6,2),
    height_ft       DECIMAL(6,2) DEFAULT 8,
    square_footage  DECIMAL(8,2),    -- auto-calc: length * width
    water_category  water_category,
    water_class     water_class,
    dry_standard    DECIMAL(6,2),    -- target reading for "dry" (reading of unaffected area)
    equipment_air_movers  INTEGER DEFAULT 0,
    equipment_dehus       INTEGER DEFAULT 0,
    notes           TEXT,            -- per-room notes, voice-fillable
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**photos** (from design.md — already defined, adding room_id FK)
```sql
CREATE TABLE photos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    room_id         UUID REFERENCES job_rooms(id) ON DELETE SET NULL,  -- NEW: link photo to room
    room_name       TEXT,            -- denormalized for display (or standalone if no room record)
    storage_url     TEXT NOT NULL,
    filename        TEXT,
    caption         TEXT,
    photo_type      TEXT DEFAULT 'damage',
    -- damage | equipment | protection | containment | moisture_reading | before | after
    selected_for_ai BOOLEAN DEFAULT false,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**moisture_readings** (NEW — daily readings per room)
```sql
CREATE TABLE moisture_readings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id         UUID NOT NULL REFERENCES job_rooms(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    reading_date    DATE NOT NULL,
    day_number      INTEGER,         -- auto-calc: days since loss_date
    -- Atmospheric conditions (same for all points in this reading)
    atmospheric_temp_f    DECIMAL(5,1),
    atmospheric_rh_pct    DECIMAL(5,1),
    atmospheric_gpp       DECIMAL(6,1),  -- auto-calc from temp + rh (psychrometric formula)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(room_id, reading_date)
);
```

**moisture_points** (NEW — individual measurement locations within a reading)
```sql
CREATE TABLE moisture_points (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_id      UUID NOT NULL REFERENCES moisture_readings(id) ON DELETE CASCADE,
    location_name   TEXT NOT NULL,    -- "Basement", "Kitchen wall", "South stud bay 3"
    reading_value   DECIMAL(6,1) NOT NULL,
    meter_photo_url TEXT,             -- photo of the meter display as proof
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**dehu_outputs** (NEW — dehumidifier readings within a moisture reading session)
```sql
CREATE TABLE dehu_outputs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_id      UUID NOT NULL REFERENCES moisture_readings(id) ON DELETE CASCADE,
    dehu_model      TEXT,             -- "Phoenix Drymax XL", "Dri-Eaz LGR 3500i"
    rh_out_pct      DECIMAL(5,1),
    temp_out_f      DECIMAL(5,1),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Data Relationships

```
job
├── floor_plans (1 per floor — visual sketches)
│   ├── Floor 1 (canvas_data: walls, doors, windows as geometry)
│   │   ├── Room drawn on sketch → creates job_room with floor_plan_id
│   │   └── Room drawn on sketch → dimensions auto-populated from sketch
│   └── Floor 2 (canvas_data: ...)
│
├── job_rooms (data about each room)
│   ├── Master Bedroom (floor_plan_id: Floor 1, 10.5x15ft, Cat 2, 3 air movers, 1 dehu)
│   │   ├── moisture_readings (daily)
│   │   │   ├── Day 1: atmospheric + moisture_points + dehu_outputs
│   │   │   └── Day 2: ...
│   │   └── photos (tagged to this room)
│   └── Living Room (floor_plan_id: Floor 1, 10.25x9.25ft)
│       └── ...
│
├── photos (60+ per job, tagged to rooms)
│   ├── room_id → links to job_room (which side of which room)
│   ├── selected_for_ai → damage photos sent to AI pipeline (Spec 02)
│   └── photo_type → damage | equipment | protection | before | after
│
├── line_items (generated by AI in Spec 02 — referenced here for PDF)
└── scope_runs (AI tracking in Spec 02 — referenced here for PDF)
```

**Floor plan ↔ Room relationship:**
- A floor_plan is per-floor (Floor 1, Floor 2). It contains the visual sketch.
- A job_room belongs to a floor plan via `floor_plan_id` (nullable).
- The floor plan canvas visually shows walls, doors, windows for all rooms on that floor.
- When you draw a closed shape on the canvas, it becomes a room → creates a job_room record with dimensions auto-calculated from the sketch geometry.
- Rooms can also exist WITHOUT a sketch (floor_plan_id = null) — just typed or spoken dimensions.
- Multiple job_rooms point to the same floor_plan (many rooms per floor).
- The sketch is the visual; the room is the data. Linked but independent.

## Phases & Checklist

### Phase 1: Job + Room + Floor Plan Backend — ❌
**Jobs CRUD:**
- [ ] Create `api/jobs/schemas.py` — Pydantic models for job create/update/response
- [ ] Create `api/jobs/service.py` — job business logic (create, list, get, update, delete)
- [ ] Create `api/jobs/router.py` — route handlers
- [ ] `POST /v1/jobs` — create job (required: address_line1, loss_type; optional: everything else)
- [ ] `GET /v1/jobs` — list jobs for company (filter by status, search by address/customer, paginate)
- [ ] `GET /v1/jobs/:id` — get job detail (with room count, photo count, line item count)
- [ ] `PATCH /v1/jobs/:id` — update job fields (including tech_notes)
- [ ] `DELETE /v1/jobs/:id` — soft delete job
- [ ] Auto-generate job_number format: `JOB-YYYYMMDD-XXX`
- [ ] Filter company_id from auth context on all queries

**Floor Plans CRUD:**
- [ ] Create `api/floor_plans/schemas.py` — Pydantic models
- [ ] Create `api/floor_plans/service.py` — floor plan business logic
- [ ] Create `api/floor_plans/router.py` — route handlers
- [ ] `POST /v1/jobs/:id/floor-plans` — create floor plan (floor_number, floor_name)
- [ ] `GET /v1/jobs/:id/floor-plans` — list floor plans for job
- [ ] `PATCH /v1/jobs/:jid/floor-plans/:fpid` — update floor plan (canvas_data, floor_name)
- [ ] `DELETE /v1/jobs/:jid/floor-plans/:fpid` — delete floor plan (sets room floor_plan_id to null)

**Rooms CRUD:**
- [ ] Create `api/rooms/schemas.py` — Pydantic models
- [ ] Create `api/rooms/service.py` — room business logic
- [ ] Create `api/rooms/router.py` — route handlers
- [ ] `POST /v1/jobs/:id/rooms` — create room (room_name required; dimensions, category, class, equipment optional)
- [ ] `GET /v1/jobs/:id/rooms` — list rooms for job (with equipment counts, reading summary)
- [ ] `PATCH /v1/jobs/:jid/rooms/:rid` — update room fields (dimensions, category, class, dry_standard, equipment, notes)
- [ ] `DELETE /v1/jobs/:jid/rooms/:rid` — delete room
- [ ] Auto-calculate square_footage on create/update: length_ft * width_ft

**Database migration:**
- [ ] Alembic migration: create enums (loss_type, water_category, water_class)
- [ ] Alembic migration: create jobs table
- [ ] Alembic migration: create floor_plans table
- [ ] Alembic migration: create job_rooms table
- [ ] Enable RLS on all tables with company_id isolation

**Tests:**
- [ ] pytest: create job with minimal fields (address + loss type)
- [ ] pytest: create job with all fields populated
- [ ] pytest: list jobs returns only current company's jobs
- [ ] pytest: update job fields
- [ ] pytest: delete job
- [ ] pytest: create floor plan for job
- [ ] pytest: create room linked to floor plan
- [ ] pytest: create room without floor plan (standalone)
- [ ] pytest: update room equipment counts
- [ ] pytest: auto-calculate square_footage

### Phase 2: Photo + Moisture Backend — ❌
**Photos:**
- [ ] Create `api/photos/schemas.py` — Pydantic models
- [ ] Create `api/photos/service.py` — photo business logic
- [ ] Create `api/photos/router.py` — route handlers
- [ ] `POST /v1/jobs/:id/photos/upload-url` — generate presigned upload URL for Supabase Storage
- [ ] `POST /v1/jobs/:id/photos/confirm` — confirm upload, create photo record, resize to 1920px max
- [ ] `GET /v1/jobs/:id/photos` — list photos for job (with signed URLs, grouped by room)
- [ ] `PATCH /v1/jobs/:jid/photos/:pid` — update photo metadata (room_id, room_name, photo_type, caption, selected_for_ai)
- [ ] `DELETE /v1/jobs/:jid/photos/:pid` — delete photo (remove from storage + DB)
- [ ] `POST /v1/jobs/:id/photos/bulk-select` — mark multiple photos as selected_for_ai
- [ ] Photo resize on upload: max 1920px longest edge (reduces AI token cost ~4x)
- [ ] Enforce limits: max 100 photos per job, max 10MB per upload, JPEG/PNG only
- [ ] Generate signed URLs with 15-minute expiry for photo access

**Moisture Readings:**
- [ ] Create `api/moisture/schemas.py` — Pydantic models
- [ ] Create `api/moisture/service.py` — moisture business logic + GPP calculation
- [ ] Create `api/moisture/router.py` — route handlers
- [ ] `POST /v1/jobs/:jid/rooms/:rid/readings` — create daily moisture reading (date, atmospheric)
- [ ] `GET /v1/jobs/:jid/rooms/:rid/readings` — list readings for room (chronological, with points + dehu)
- [ ] `PATCH /v1/jobs/:jid/readings/:mid` — update reading (atmospheric values)
- [ ] `DELETE /v1/jobs/:jid/readings/:mid` — delete reading
- [ ] `POST /v1/jobs/:jid/readings/:mid/points` — add moisture point (location, value, meter photo)
- [ ] `PATCH /v1/jobs/:jid/readings/:mid/points/:mpid` — update point
- [ ] `DELETE /v1/jobs/:jid/readings/:mid/points/:mpid` — delete point
- [ ] `POST /v1/jobs/:jid/readings/:mid/dehus` — add dehu output (model, rh_out, temp_out)
- [ ] `PATCH /v1/jobs/:jid/readings/:mid/dehus/:did` — update dehu output
- [ ] `DELETE /v1/jobs/:jid/readings/:mid/dehus/:did` — delete dehu output
- [ ] Auto-calculate GPP from temperature + relative humidity (psychrometric formula)
- [ ] Auto-calculate day_number from job.loss_date

**Database migration:**
- [ ] Alembic migration: create photos table (with room_id FK)
- [ ] Alembic migration: create moisture_readings table
- [ ] Alembic migration: create moisture_points table
- [ ] Alembic migration: create dehu_outputs table

**Tests:**
- [ ] pytest: photo upload flow (presigned URL → confirm → record created)
- [ ] pytest: list photos returns signed URLs
- [ ] pytest: update photo metadata (room_id, type, caption)
- [ ] pytest: delete photo removes from storage and DB
- [ ] pytest: reject upload over 10MB / wrong format
- [ ] pytest: reject upload when job has 100 photos
- [ ] pytest: create moisture reading with atmospheric data
- [ ] pytest: GPP auto-calculates correctly (known temp/rh → expected GPP)
- [ ] pytest: add moisture points to reading
- [ ] pytest: add dehu outputs to reading
- [ ] pytest: day_number auto-calculates from loss_date

### Phase 3: Job List + Create + Detail Frontend — ❌
- [ ] Job list page (`/jobs`): cards with status badge, address, date, room count, photo count
- [ ] Active job indicator at top (most recently accessed job)
- [ ] Status badges: "Needs Scope" (gray), "Scoped" (green), "Submitted" (blue)
- [ ] Search bar: filter jobs by address or customer name
- [ ] "+ New Job" button → create job page
- [ ] Create job form with field groups:
  - **Customer:** customer_name, customer_phone, customer_email, address (line1, city, state, zip)
  - **Loss Info:** loss_date, loss_cause (loss source), water_category (Cat 1/2/3), water_class (Class 1-4)
  - **Insurance:** carrier, claim_number, adjuster_name, adjuster_email, adjuster_phone
- [ ] 2 required fields: address_line1 + loss_type. Everything else optional.
- [ ] Loss type selector: water/fire/mold — 3 large tap targets, default water
- [ ] "Create Job" button at bottom
- [ ] Job detail page (`/jobs/[id]`): all fields editable inline
- [ ] Job detail tabs: Overview | Site Log | Photos | Report
- [ ] Overview tab: all job fields grouped (Customer, Loss Info, Insurance), editable
- [ ] Delete job: confirmation dialog → delete
- [ ] Mobile-responsive: 48px touch targets, stacked layout on small screens
- [ ] Loading states, error states, empty states for each view

### Phase 4: Site Log Frontend — Rooms + Floor Plan Sketch + Moisture — ❌
**Room Management:**
- [ ] Site Log tab with sections: Rooms | Equipment | Moisture Readings
- [ ] "+ Add Room" button → room form (name dropdown, dimensions, category, class)
- [ ] Room name dropdown: common names (Master Bedroom, Kitchen, Living Room, Bathroom, Basement, Hallway, Garage, Laundry, Closet, Custom...)
- [ ] Per-room card: room name, dimensions summary, category, class, equipment counts
- [ ] Expandable room card → full edit: dimensions (L x W x H), category, class, dry standard, notes, equipment
- [ ] Equipment per room: Air Movers (+ / - counter), Dehus (+ / - counter)
- [ ] Room notes: free text area per room
- [ ] Remove room button with confirmation
- [ ] Per-room Photos button → filters photo grid to this room's photos

**Floor Plan Sketch Tool:**
- [ ] "Draw the Floor Plan" banner with "Open Sketch" button
- [ ] "Skip sketch?" option with "Speak Room Names" and "+ Add Room Manually" alternatives
- [ ] Floor tabs: Floor 1, Floor 2... with "+ Add Floor" and rename
- [ ] Canvas drawing tool:
  - [ ] Tap-and-drag to draw walls (line segments)
  - [ ] Snap endpoints to connect walls (close shapes → rooms)
  - [ ] Add doors (tap on wall segment → place door)
  - [ ] Add windows (tap on wall segment → place window)
  - [ ] Add openings (tap on wall segment → place opening)
  - [ ] Add stairs (freeform placement)
  - [ ] Add labels (text on canvas)
  - [ ] Select tool (tap to select wall/element, drag to move)
  - [ ] Pan tool (scroll/drag canvas)
  - [ ] Erase tool (tap element to delete)
  - [ ] Clear all button
- [ ] Auto-display dimensions on wall segments (feet + inches)
- [ ] Auto-calculate room SF when walls close a shape
- [ ] Grid background for scale reference
- [ ] Touch-optimized: finger-friendly on mobile, mouse on desktop
- [ ] "Clean up sketch" button → sends canvas_data to Claude API → returns cleaned geometry (straightened walls, aligned corners, snapped dimensions to nearest 0.25ft)
- [ ] Chat refinement: text input below sketch to tell AI "move the door to the corner", "make room 2 be 10x10" → AI updates canvas_data
- [ ] When rooms are created from sketch, auto-create job_room records with dimensions
- [ ] Rooms from sketch show "2 rooms loaded from sketch — tap to edit" indicator
- [ ] Canvas library: research best option (Konva.js/react-konva, Fabric.js, or Excalidraw fork)

**Moisture Readings:**
- [ ] Moisture Readings section within Site Log
- [ ] Moisture meter selector: dropdown of common meters (Delmhorst QuickNav, Protimeter, etc.)
- [ ] Moisture scale toggle: 0-100% or 0-300 (Delmhorst scale)
- [ ] Dry standard reference: "wood ≤16%, concrete ≤0.5%"
- [ ] "+ Add Day" button → creates new reading for today's date
- [ ] Per-day reading card:
  - Date (with calendar picker)
  - Remove / Speak / Photo buttons
  - **Atmospheric:** Temp °F, RH %, GPP (auto-calculated, displayed in green)
  - **Moisture Points:** numbered list with location name + reading value + meter photo button
  - "+ Point" button to add more measurement locations
  - **Dehu Output:** model dropdown + RH Out % + Temp Out °F
  - "+ Dehu" button to add more dehumidifiers
- [ ] "Clear Today" button (removes all data for current day reading)
- [ ] Readings sorted by day_number ascending

**Tech Field Notes:**
- [ ] Tech Field Notes section (on job detail or site log)
- [ ] Free text area with placeholder: "Describe what was done — techniques, materials removed, PPE worn, equipment changes... (e.g. lifted carpet and pad, flood cut drywall 2ft, applied antimicrobial, wore N95 and Tyvek)"
- [ ] Note below field: "AI reads these notes when building scope — the more detail the better"
- [ ] Speak button → voice input mode (uses same Deepgram pipeline as voice-to-form)
- [ ] When speaking: "Listening — describe what was done today..." indicator with Stop button

### Phase 5: Photo Upload + Management Frontend — ❌
- [ ] Photos tab on job detail: upload zone + photo grid
- [ ] Photo toolbar (from Brett's ScopeFlow): Hazard Scan | Tag Rooms | Analyze with AI | Take Photo | Upload
  - "Hazard Scan" and "Analyze with AI" are Spec 02 (AI Pipeline) — show buttons but disabled/greyed until Spec 02 ships
  - "Tag Rooms" — bulk-assign photos to rooms
  - "Take Photo" — opens camera directly
  - "Upload" — file picker for existing photos
- [ ] Room filter tabs: "All Photos" | "General" | room names from job_rooms (e.g., "Master Bedroom" | "Living Room")
- [ ] Upload: "Take photos or upload from camera roll" — `<input type="file" accept="image/*" capture="environment">` for rear camera on mobile
- [ ] Upload progress bar per photo
- [ ] Upload failure: retry button with "Upload failed — check your connection"
- [ ] Photo grid: thumbnails organized by room (grouped) or flat grid
- [ ] Tap photo: view full-size in lightbox/modal
- [ ] Tap-and-hold (mobile) or right-click (desktop): delete photo
- [ ] Photo metadata: tap to edit room (dropdown of job_rooms), photo type (damage/equipment/protection/containment/moisture_reading/before/after), caption
- [ ] "Select for AI" toggle on each photo — or bulk select mode
- [ ] Photo guidance banner (first time): "For best AI results, take 5 photos per room: floor, each wall, and ceiling"
- [ ] Photo count indicator: "42 / 100 photos"
- [ ] Filter photos by room (links from room card's "Photos" button)
- [ ] "Tag Rooms" button → modal: shows all photos with room dropdown per photo (from job_rooms). Bulk-assign photos to rooms before AI analysis. Cancel / Save buttons.

### Phase 6: PDF Export + Share Link — ❌
- [ ] Create `api/reports/service.py` — PDF generation logic
- [ ] Create `api/reports/router.py` — route handlers
- [ ] `POST /v1/jobs/:id/report` — generate PDF (WeasyPrint on Railway)
- [ ] `GET /v1/jobs/:id/report/download` — download generated PDF
- [ ] `POST /v1/jobs/:id/share` — generate share token (time-limited, read-only)
- [ ] `GET /v1/shared/:token` — public read-only job view (no auth required)
- [ ] **Multiple report types:**
  - **PDF Report** — full scope (all categories): company header, job info, floor plan, rooms, ALL line items with citations, photos, moisture log, tech notes
  - **Mitigation Invoice** — mitigation-category items ONLY. Sent first to adjuster for fast payment. Same layout but filtered to mitigation line items.
  - **Drying Certificate** — generated from moisture readings. Shows: initial readings → daily progress → final readings at dry standard. Proves equipment days were justified. Includes atmospheric data + GPP trends.
- [ ] PDF sections (full report):
  - Company-branded header (logo + name + phone)
  - Job address, date, homeowner name, insurance info
  - Floor plan sketch (rendered as image from canvas_data)
  - Room summary table (name, dimensions, SF, category, class, equipment)
  - Line items table grouped by trade category (Xactimate Code | Description | Qty | Unit | S500/OSHA Citation)
  - Moisture reading log (daily table: date, atmospheric, points, trends)
  - Photo grid with captions (grouped by room)
  - Tech field notes
  - Footer: "Generated by Crewmatic" + page numbers
- [ ] PDF library: WeasyPrint (HTML-to-PDF). Railway Dockerfile needs cairo + pango system deps.
- [ ] Report tab on job detail: PDF preview (iframe or image), download button, share button
- [ ] Share flow: generate link → copy to clipboard → "Link copied!"
- [ ] PDF error state: "Report generation failed — try again" with retry button
- [ ] pytest: PDF generation produces valid PDF file
- [ ] pytest: share token generates and resolves to correct job
- [ ] pytest: expired share token returns 403

### Phase 7: Voice Everywhere — ❌
**Voice infrastructure (cross-cutting — applies to all forms):**
- [ ] Deepgram Nova-2 streaming integration (WebSocket from browser → Deepgram cloud → transcripts back)
- [ ] Backend: `POST /v1/voice/extract-fields` — accepts transcript + context (which form), returns structured field JSON via Claude
- [ ] Frontend: Voice input component (reusable across all forms)
  - "Hold to Speak" button (press-and-hold for push-to-talk)
  - "Tap Mic for Continuous" mode (tap to start, tap to stop)
  - Live transcript display below the button (shows words as spoken, ~300ms latency)
  - Progress indicator: "Got 1 field — keep talking" style feedback
  - Field validation indicators: green checkmark when field is filled, orange warning triangle for uncertain values

**Voice-to-form (job creation):**
- [ ] Speak customer info: "customer name Jane Doe, phone 586-555-9600, email janedoe@yahoo.com"
- [ ] Speak address: "her address is 27851 Gilbert Drive, Warren Michigan 48093"
- [ ] Speak loss info: "loss source is dishwasher leak, cat 1, class 2, date of loss March 13th"
- [ ] Speak insurance: "insurance carrier State Farm, claim number 9742.34, adjuster Alex Garnapudi"
- [ ] Progressive field filling: fields update as user speaks (on Deepgram utterance-end events)
- [ ] Corrections: "I'm sorry, the loss source is a dishwasher leak" → updates previous value
- [ ] LLM sees full accumulated transcript, not just latest chunk → corrections work naturally

**Voice-to-form (room setup):**
- [ ] "Speak Room Names" button → speak room names sequentially, auto-create room records
- [ ] Speak per-room: "Master bedroom, 10.5 by 15 feet, cat 2, class 1, 3 air movers, 1 dehu"
- [ ] Each room's "Speak" button → voice input for that room's fields

**Voice-to-form (moisture readings):**
- [ ] Per-day "Speak" button → "temperature 72, humidity 45, basement reading 100, kitchen wall 150"

**Voice-to-text (tech field notes):**
- [ ] Speak button → continuous transcription mode → fills text area directly
- [ ] "Listening — describe what was done today..." indicator
- [ ] Stop button ends recording, transcript becomes the note text

**Technical approach:**
```
┌─────────────┐     audio chunks      ┌──────────────┐
│  Browser Mic │ ──────────────────►   │  Deepgram    │
│  (MediaStream)│                      │  Nova-2      │
└─────────────┘                        │  WebSocket   │
                                       └──────┬───────┘
                                              │ interim + final transcripts
                                              ▼
                                     ┌────────────────┐
                                     │  Frontend      │
                                     │  - Show live   │
                                     │    transcript  │
                                     │  - On utterance│
                                     │    end: call   │──► Claude API (field extraction)
                                     │    backend     │◄── { structured fields JSON }
                                     │  - Merge into  │
                                     │    form state  │
                                     └────────────────┘
```
- Deepgram handles STT (speech-to-text) — ~300ms latency, streams interim + final transcripts
- Claude handles field extraction — parses natural speech into structured form data
- Cost per job creation: ~$0.01 (30s speech = ~$0.002 Deepgram + ~$0.003 Claude × 3-4 calls)
- For tech field notes: Deepgram only (pure transcription, no LLM extraction needed)

## Technical Approach

**Job creation pattern:**
- 2 required fields: address + loss type. Everything else nullable/optional.
- Auto-generate `job_number` on creation: `JOB-20260324-001`
- Status starts as `needs_scope`, transitions to `scoped` when AI scope runs, `submitted` when user marks as submitted.

**Field grouping (from Brett's ScopeFlow demo):**
- **Customer:** customer_name, customer_phone, customer_email, address (line1 + city + state + zip)
- **Loss Info:** loss_date, loss_cause ("loss source"), water_category (Cat 1/2/3), water_class (Class 1-4)
- **Insurance:** carrier, claim_number, adjuster_name, adjuster_email, adjuster_phone

**Photo upload pattern (presigned URLs):**
```
1. Frontend calls POST /v1/jobs/:id/photos/upload-url
2. Backend generates presigned upload URL from Supabase Storage
3. Frontend uploads directly to Supabase Storage using presigned URL
4. Frontend calls POST /v1/jobs/:id/photos/confirm with storage path
5. Backend creates photo record, triggers resize (1920px max)
6. Backend returns photo record with signed access URL
```

**Floor plan sketch tool:**
- Canvas-based drawing (HTML5 Canvas via react-konva or similar)
- Geometric primitives stored as JSONB: walls (line segments with length), doors (gap in wall), windows (marked segment), rooms (closed polygons)
- AI cleanup: send canvas_data to Claude → returns cleaned geometry (straightened walls, aligned corners)
- AI chat refinement: natural language instructions → Claude modifies canvas_data
- When sketch creates rooms, auto-create job_room records with dimensions from geometry
- Future iOS: Apple RoomPlan API (LiDAR) → generates canvas_data in same JSONB format

**GPP auto-calculation:**
```python
# Psychrometric formula (ASHRAE)
def calculate_gpp(temp_f: float, rh_pct: float) -> float:
    """Calculate Grains Per Pound from temperature and relative humidity."""
    temp_c = (temp_f - 32) * 5 / 9
    # Saturation vapor pressure (Magnus formula)
    es = 6.112 * math.exp((17.67 * temp_c) / (temp_c + 243.5))
    # Actual vapor pressure
    ea = es * (rh_pct / 100)
    # Mixing ratio (g/kg)
    w = 621.97 * ea / (1013.25 - ea)
    # Convert to grains per pound (1 g/kg ≈ 7 gr/lb)
    gpp = w * 7.0
    return round(gpp, 1)
```

**PDF generation:**
- WeasyPrint on Railway (HTML template → CSS → PDF)
- Fetch all job data: rooms, floor plans, photos, line items, moisture readings, tech notes
- Render floor plan canvas_data as SVG image for PDF
- Store PDF in Supabase Storage, return signed download URL
- Alternative: `reportlab` if WeasyPrint causes Railway build issues

**Share link:**
- Generate random token, store in DB with expiry (7 days default)
- Public route `/v1/shared/:token` returns job data without auth
- Frontend renders a read-only job view at `/shared/:token`

**Key Files:**
- `backend/api/jobs/` — job CRUD (router, service, schemas)
- `backend/api/floor_plans/` — floor plan CRUD
- `backend/api/rooms/` — room CRUD
- `backend/api/photos/` — photo management
- `backend/api/moisture/` — moisture readings + points + dehu outputs
- `backend/api/reports/` — PDF generation
- `backend/api/voice/` — voice transcript → field extraction
- `web/src/app/(protected)/jobs/page.tsx` — job list
- `web/src/app/(protected)/jobs/[id]/page.tsx` — job detail (tabs: Overview | Site Log | Photos | Report)
- `web/src/app/(protected)/jobs/[id]/site-log/` — rooms, floor plan sketch, moisture readings
- `web/src/app/(protected)/jobs/[id]/photos/` — photo upload + grid
- `web/src/app/(protected)/jobs/[id]/report/` — PDF preview + download
- `web/src/app/(protected)/jobs/new/page.tsx` — create job form
- `web/src/app/shared/[token]/page.tsx` — public shared view
- `web/src/components/sketch/` — floor plan drawing canvas
- `web/src/components/voice/` — reusable voice input component

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, Job + Room + Floor Plan Backend
# Prerequisite: Spec 00 (bootstrap) must be complete
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Job creation:** 2 required fields only (address + loss type). Brett: "can't start without claim number" but that's for insurance submission, not initial creation. Let them add it later.
- **Field grouping:** Customer | Loss Info | Insurance (validated against Brett's ScopeFlow demo, March 2026).
- **Voice-first is V1:** Voice-to-form is the killer feature. Deepgram Nova-2 for STT (~300ms, best quality for noisy job sites), Claude for field extraction. Hold-to-speak + tap-for-continuous modes.
- **Floor plan sketch in V1:** Canvas drawing tool with AI cleanup + chat refinement. Schema includes canvas_data from day one. Future iOS: LiDAR via Apple RoomPlan API generates same JSONB format.
- **Floor plan ↔ Room relationship:** Floor plan is per-floor (visual sketch). Rooms link to floor plan via floor_plan_id (nullable). Rooms can exist without a sketch. Multiple rooms per floor plan. The sketch is the visual; the room is the data.
- **Room sketch detail:** Per-room sketch detail (which side has door/window) lives IN the floor plan canvas. You zoom into that room's portion of the floor plan — no separate per-room sketch table needed.
- **Moisture readings in V1:** Daily tracking with atmospheric (temp, RH%, GPP auto-calc), moisture points (location + reading + meter photo), dehu output. Needed for adjuster documentation (equipment days must be justified by drying timeline).
- **Equipment tracking in V1:** Air movers + dehus count per room. Simple +/- counters. Adjusters need count × days.
- **Tech field notes:** Free text, voice-fillable. "AI reads these notes when building scope — the more detail the better." Links to AI Pipeline (Spec 02).
- **Photo limits:** 100 per job, 10MB each, JPEG/PNG only (Brett takes ~60 per job). HEIC deferred.
- **Photo resize:** 1920px max on upload. Reduces AI token cost ~4x when Spec 02 processes them.
- **Photos link to rooms:** room_id FK on photos table. Photos can be filtered by room.
- **PDF expanded:** Now includes floor plan sketch, room summary, moisture log, tech notes — not just line items and photos.
- **Storage:** Private bucket. All photo access via signed URLs (15-min expiry). Client property photos are sensitive.
- **Share links:** Time-limited (7 days), read-only. No auth required for viewing.
- **Status flow V1:** needs_scope → scoped → submitted.
- **Canvas library:** Research needed — Konva.js/react-konva (React-native, good touch), Fabric.js (most mature), or Excalidraw fork (open-source whiteboard). Decision during Phase 4.
- **GPP formula:** Psychrometric calculation from ASHRAE tables. Pure math, no AI needed. Replaces separate app Brett currently uses.
- **Spec 02 is now AI Pipeline** (was originally spec 02 for floor plan, but floor plan merged into spec 01).
- **year_built on jobs:** Added to schema. Pre-1978 = lead paint risk (EPA RRP rule). Can auto-fill from property data API (Zillow/ATTOM/county records) based on address, but always confirm with homeowner. Used by Hazmat Scanner in Spec 02.
- **Hazmat Scanner (Spec 02):** Two scan types — Asbestos Risk Scan + Lead Paint Risk Scan. AI analyzes uploaded photos for potential ACMs (vermiculite insulation, pipe wrap, 9x9 floor tiles) and lead paint indicators (alligatoring pattern). Per-finding output: material name, location, risk level (HIGH RISK badge), "What I see" description, next steps ("Do not disturb. Have certified inspector collect sample"), "Order Test Kit" CTA. Lead paint scan uses year_built to determine risk (pre-1978). "Add to Report" button includes findings in PDF. Mandatory disclaimer: "not a substitute for professional testing." Local contractor referrals by zip code (Google Maps, Angi, HomeAdvisor, EPA Directory). Future revenue: sponsored contractor listings + test kit affiliate links.
- **Photo toolbar (from Brett's ScopeFlow):** Hazard Scan | Tag Rooms | Analyze with AI | Take Photo | Upload. Room filter tabs below (All Photos + room names from job_rooms). Hazard Scan and Analyze with AI are Spec 02 features — buttons present but disabled in Spec 01.
- **Tag Rooms modal (Spec 01):** Before AI analysis, user assigns each photo to a room via a modal — photo thumbnail + room dropdown (from job_rooms). This is a Spec 01 feature (part of photo management). "Analyze →" button triggers Spec 02.
- **AI Photo Scope output (Spec 02 — captured from Brett's demo):**
  - Summary paragraph at top describing overall damage assessment
  - Line items grouped by **trade category**: Mitigation (blue), Insulation (yellow), Drywall (orange), Painting (yellow), Structural (gray), General (green). Each category has a colored header bar.
  - Per line item: Xactimate CODE (colored text) | DESCRIPTION | UNIT (E/S/LF/H/C) | QTY | ROOM | justify icon | delete (x)
  - **Citations inline** below relevant line items — "OSHA General Duty Clause 5(a)(1); IICRC S500 Sec 13.5.6.1 — AFDs required when particulates are aerosolized during demolition". Citations are the revenue tool — adjusters cannot argue with S500/OSHA citations.
  - "Push to Report →" button at top — sends approved items to PDF
  - "+ Add Line Item" at bottom — manual additions (source: 'manual')
  - Flow: Tag Rooms → Analyze with AI → Review/Edit/Delete items → Push to Report
  - **Trade category field needed on line_items schema** — `category TEXT` (mitigation, insulation, drywall, painting, structural, plumbing, electrical, general). Items are sorted by category for display.
  - Quantities use room dimensions from job_rooms (SF for drywall/painting = room square_footage, LF for baseboard = room perimeter from dimensions)
- **Mitigation vs Reconstruction separation (critical cash flow insight from Brett):** Mitigation = strictly water restoration (extraction, demolition, equipment, drying). Reconstruction = everything after (drywall, painting, insulation, structural). Contractors get paid MUCH faster by submitting mitigation invoice FIRST, then reconstruction later. Bundling delays payment for everything. Trade categories drive which report each item goes into.
- **Report types (from Brett's ScopeFlow):**
  - **PDF Report** — full scope (all categories, all line items)
  - **Mitigation Invoice** — mitigation-category items ONLY — sent first to adjuster for fast payment
  - **Drying Certificate** — generated from moisture readings, proves dry standard was met, proves equipment days were justified. Needed to close out mitigation billing.
  - **Share Portal** — read-only link for adjuster/homeowner to view job documentation
  - **Close Job** — marks job as complete/submitted
- **Line item categories are billing-critical, not just display.** They determine: (1) which PDF report the item appears in, (2) which invoice goes out first, (3) payment timeline. Mitigation items = fast payment. Reconstruction items = slower payment. This is a core domain rule.
- **Certificate of Dryness (Spec 01 — auto-generated from moisture data):** Professional document: cert number, property address, claim number, loss type, drying period, days of drying, adjuster, technician, contractor. Room-by-room drying summary table: room name, dimensions, drying period, dry standard, final readings (color-coded: orange if above std, green if at/below), equipment used, status (IN PROGRESS / COMPLETE). Statement of Compliance citing IICRC S500. Technician signature line + date. Footer: "Generated by Crewmatic | IICRC S500 Compliant Documentation". Auto-generated entirely from moisture_readings + job_rooms data — no manual work.
- **AI Scope Auditor (Spec 02 — the "second expert"):** "Reviews your scope like a 10-year veteran — flags missed line items before it goes to the adjuster." Runs AFTER Push to Report, BEFORE submitting to adjuster. Cross-references: (1) line items in scope vs photos/rooms/readings, (2) S500/OSHA standards for what SHOULD be present given damage type, (3) domain logic rules (Cat 2 → antimicrobial required, affected rooms need equipment, source appliance needs disconnect/reconnect line item, Class 2 → flood cut needed, etc.), (4) data quality (impossible moisture readings = data entry error). Output: list of flagged items with severity (critical/warning/suggestion), title, room tag, specific Xactimate code badges to add, explanation of WHY it's needed. Examples from Brett's demo: missing water extraction, no moisture inspection, missing equipment in affected rooms, no antimicrobial for Cat 2, unrealistic drying log data, missing flooring assessment, no drywall flood cut, missing source appliance disconnect, no deodorization, missing content manipulation. Each finding is one-click "Add to Scope" with auto-justification. "Re-Audit" button after changes. "Train AI" button to teach contractor preferences. This is the moat — it catches $50 line items humans miss and backs them with citations so adjusters can't deny.
- **AI as second expert before submission:** The flow is: AI Photo Scope (generate items) → Contractor review/edit → Push to Report → AI Scope Auditor (catch what's missing) → Add flagged items → Submit to adjuster. Two AI passes: one to generate, one to audit. This is the "second expert overseeing before submitting" pattern.
- **Scope Intelligence / Train AI (Spec 02 or onboarding):** "Train AI on your past scopes" — upload up to 10 most recent insurance scopes (PDF). AI extracts line items, pricing patterns, and identifies where contractor has been leaving money on the table. Makes Scope Auditor smarter on every future job. Could be part of onboarding flow (first-time setup) or accessible from the AI Scope Auditor screen via "Train AI" button.
- **Network effects / crowdsourced scope intelligence (V3 — the platform moat):** Across all contractors using Crewmatic, aggregate anonymized scope data. When one contractor scopes a Cat 2 dishwasher leak, AI can suggest: "Other contractors typically also add these line items for this type of loss." This is the network effect — every contractor's data makes every other contractor's scopes better. Increases profit per job for the entire network. Examples: "87% of contractors add antimicrobial treatment for Cat 2 losses", "Contractors who add content manipulation for kitchen losses get paid 23% more on average." This is the crowdsourced pricing database from the V3 roadmap — but the data collection starts in V1 with scope_runs tracking. Privacy: all suggestions are aggregate/anonymized, never revealing individual contractor data.
  - **Technical architecture for network effects:**
    1. **Normalize:** Every completed job becomes a "scope signature" — loss profile (loss_type, category, class, source) + final line items (kept/edited/deleted/added manually from scope_runs).
    2. **Co-occurrence matrix:** Build lookup table: `(loss_type, category, class, source) → [{xactimate_code, frequency_pct, approval_rate_pct}]`. Example: Cat 2 dishwasher leak → antimicrobial 92%, content manipulation 87%, baseboard R&R 78%, deodorization 34%.
    3. **Surface suggestions:** During Scope Auditor (before submission), add "Community Insights" section alongside rule-based flags: "Based on 450 similar jobs, contractors who added deodorization got paid for it 89% of the time. [+ Add with citation]"
    4. **Privacy model:** Minimum 20+ jobs of same profile before showing suggestions. Percentages only, never company names. Contractors can opt out of contributing but still receive suggestions.
    5. **Implementation:** Background job (nightly/weekly) aggregates scope_runs + line_items into co-occurrence tables. No real-time computation needed. The Scope Auditor already runs before submission — just add community insights data source.
    6. **Moat:** Every contractor who uses Crewmatic contributes to the intelligence pool. More contractors = better suggestions. Competitors can't replicate without the user base. Contractors who leave lose access. This is "Waze for restoration scoping."
    7. **V1 foundation:** scope_runs table already tracks AI items generated / kept / edited / deleted / added manually. This is the raw data that feeds the network intelligence in V3. No additional V1 work needed — just keep collecting.
    8. **Three audit sources (shipped progressively):**
       - **(a) AI REAL-TIME (Spec 02 / V1):** Analyzes current job's photos, room data, moisture readings, tech notes against S500/OSHA/EPA standards. Reasons from first principles. Works from job #1 with zero history. This is the AI Scope Auditor as shown in Brett's demo.
       - **(b) AI PAST HISTORY (V2):** Learns from contractor's own past jobs — uploaded scope PDFs (onboarding) + Crewmatic scope_runs. "You had a similar Cat 2 dishwasher job at 123 Oak St last month — you added content manipulation there but it's missing here." Acts as a coach: reinforces good catches, flags regressions.
       - **(c) AI NETWORK (V3):** Anonymized aggregate from all contractors on the platform. "92% of contractors add antimicrobial for Cat 2 losses." Co-occurrence matrix, 20+ job minimum, percentages only. The network effect moat.
    9. **Progressive intelligence timeline:** Jobs 1-10: AI learns from uploaded past scope PDFs (onboarding). Jobs 11-20: AI learns from contractor's own Crewmatic scope_runs. Job 21+: suggestions from BOTH personal history AND network. More contractors = stronger network suggestions. Personal suggestions are always available regardless of network size.
    10. **Board & People (V2 — from Brett's demo):** Per-job message board for communication between techs, owner, customer, adjuster. Simple threaded messages (name + text + timestamp). Contacts section with Customers and Adjusters tabs — each with name, phone, email, share link, remove. Team Members section links to Company Settings. Not in Spec 01 but informs V2 team management spec.
    11. **Company Settings expanded (from Brett's demo):** Profile tab: logo upload, company name, city/region, phone, email, website URL, app URL, Google Review link. Inventory tab (V2 — equipment library). Our `companies` table already has name, phone, email, logo_url from bootstrap. Need to add: `city TEXT`, `region TEXT` (or state), `website_url TEXT`, `google_review_url TEXT`, `yelp_url TEXT`, and a general `social_links JSONB` for other profiles (Facebook, BBB, Angi, HomeAdvisor, etc.). These show on branded PDF reports, portals, and emails. Future: SEO/AEO audit — analyze contractor's online presence (Google Business, Yelp, website) and suggest improvements to rank better for local restoration searches. Value-add that deepens platform stickiness.
    12. **Daily auto-report to adjuster/customer (V2):** Auto-generate daily progress email from today's moisture readings + photos uploaded + tech field notes. Send to adjuster + customer via email with limited-access Share Portal link. This is the "Auto Adjuster Reports" feature from the V2 roadmap. Keeps adjuster informed proactively → faster approvals → faster payment.
    12. **AI as coach, not just auditor:** The AI references specific past jobs to make suggestions actionable and contextual. Examples: "You had a similar Cat 2 dishwasher job at 123 Oak St last month — you added content manipulation there but it's missing here." "Good catch adding deodorization — you missed this on your last 3 Cat 2 jobs." "This is a new line item you haven't used before — nice find." It reinforces good habits AND catches regressions. Over time it learns the contractor's patterns and only flags what's actually relevant — reducing noise, increasing trust.
