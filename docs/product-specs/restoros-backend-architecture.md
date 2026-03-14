# RestorOS Backend Architecture

**Version:** 1.0
**Date:** 2026-03-13

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python FastAPI |
| Database | Supabase (PostgreSQL + Auth + Storage) |
| Hosting | Railway |
| AI - LLM | Anthropic Claude (scoping, photo analysis) |
| AI - STT | Deepgram Nova-2 (voice transcription) |
| File Storage | Supabase Storage (presigned URL uploads) |
| Frontend Hosting | Vercel (Next.js) |

---

## High-Level Architecture

```
                    INTERNET
                       |
          +------------+------------+
          |                         |
    +-----------+             +-----------+
    |  Vercel   |             |  Railway  |
    |  Next.js  |             |  FastAPI  |
    +-----------+             +-----------+
          |                         |
          +------------+------------+
                       |
          +------------+------------+
          |            |            |
    +-----------+ +-----------+ +-----------+
    | Supabase  | | Supabase  | | Deepgram  |
    | Postgres  | | Storage   | | + Claude  |
    | + Auth    | | (Photos)  | | (AI)      |
    +-----------+ +-----------+ +-----------+
```

---

## Database Schema (17 Tables)

### Enums

```sql
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'tech');
CREATE TYPE job_status AS ENUM ('pending', 'in_progress', 'monitoring', 'completed', 'invoiced', 'closed');
CREATE TYPE loss_type AS ENUM ('water', 'fire', 'mold', 'storm', 'other');
CREATE TYPE water_category AS ENUM ('1', '2', '3');
CREATE TYPE water_class AS ENUM ('1', '2', '3', '4');
CREATE TYPE equipment_type AS ENUM ('moisture_meter', 'dehumidifier', 'air_mover', 'air_scrubber', 'hydroxyl_generator', 'thermal_camera', 'other');
CREATE TYPE scope_source AS ENUM ('voice', 'photo', 'manual');
CREATE TYPE ai_processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE report_status AS ENUM ('draft', 'generating', 'ready', 'exported');
CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'expired', 'revoked');
CREATE TYPE reading_type AS ENUM ('atmospheric', 'moisture_point', 'dehu_output');
CREATE TYPE subscription_tier AS ENUM ('free', 'starter', 'professional', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'paused');
```

### Table Summary

| # | Table | Purpose | Key Fields |
|---|-------|---------|------------|
| 1 | companies | Multi-tenant companies | name, slug, subscription_tier, stripe_customer_id |
| 2 | user_profiles | Extends Supabase auth.users | full_name, phone, avatar_url |
| 3 | company_members | User-company join (multi-tenancy) | company_id, user_id, role |
| 4 | company_invites | Team invitations | email, role, token, expires_at |
| 5 | jobs | Job records | address, customer, insurance, loss details, status |
| 6 | job_rooms | Rooms within a job | name, floor, dimensions, flooring_type |
| 7 | moisture_readings | All reading types (unified) | reading_type discriminator, atmospheric/point/dehu fields |
| 8 | equipment_library | Company equipment catalog | name, type, brand, model, xactimate_code |
| 9 | equipment_placements | Equipment placed at jobs | job_id, room_id, placed_at, removed_at |
| 10 | photos | Job photos | storage_path, EXIF (lat/lng), tags, room_id |
| 11 | voice_notes | Audio recordings + transcripts | audio_path, transcript, extraction_status |
| 12 | scope_entries | Xactimate line items | xactimate_code, category, description, unit, quantity |
| 13 | ai_scope_results | Raw AI output from analysis | photo_id, model_used, parsed_items, confidence |
| 14 | reports | Generated reports | report_type, pdf_path, esx_data |
| 15 | room_sketches | Room layout drawings | canvas_data (JSON), version |
| 16 | audit_log | Compliance trail | action, entity_type, old_data, new_data |

### Core Tables SQL

#### companies
```sql
CREATE TABLE companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    phone           TEXT,
    email           TEXT,
    address_line1   TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    license_number  TEXT,
    logo_url        TEXT,
    settings        JSONB NOT NULL DEFAULT '{}',
    subscription_tier    subscription_tier NOT NULL DEFAULT 'free',
    subscription_status  subscription_status NOT NULL DEFAULT 'trialing',
    stripe_customer_id   TEXT,
    trial_ends_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### company_members
```sql
CREATE TABLE company_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role            user_role NOT NULL DEFAULT 'tech',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(company_id, user_id)
);
```

#### jobs
```sql
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_number      TEXT NOT NULL,
    address_line1   TEXT NOT NULL,
    city            TEXT NOT NULL,
    state           TEXT NOT NULL,
    zip             TEXT NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    claim_number    TEXT,
    carrier         TEXT,
    adjuster_name   TEXT,
    adjuster_phone  TEXT,
    loss_type       loss_type NOT NULL DEFAULT 'water',
    loss_category   water_category,
    loss_class      water_class,
    loss_date       DATE,
    status          job_status NOT NULL DEFAULT 'pending',
    customer_name   TEXT,
    customer_phone  TEXT,
    customer_email  TEXT,
    assigned_to     UUID[] DEFAULT '{}',
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(company_id, job_number)
);
```

#### moisture_readings (unified with reading_type discriminator)
```sql
CREATE TABLE moisture_readings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id         UUID NOT NULL REFERENCES job_rooms(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    reading_type    reading_type NOT NULL,
    reading_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Atmospheric
    temperature_f   DECIMAL(5,1),
    relative_humidity DECIMAL(5,1),
    gpp             DECIMAL(8,2),
    dew_point_f     DECIMAL(5,1),
    -- Moisture point
    point_number    INTEGER,
    point_label     TEXT,
    material        TEXT,
    moisture_value  DECIMAL(6,2),
    moisture_unit   TEXT DEFAULT '%',
    point_x         DECIMAL(6,2),
    point_y         DECIMAL(6,2),
    -- Dehu output
    dehu_equipment_id UUID REFERENCES equipment_library(id),
    output_temp_f     DECIMAL(5,1),
    output_rh         DECIMAL(5,1),
    -- Common
    recorded_by     UUID NOT NULL REFERENCES auth.users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### scope_entries (Xactimate line items)
```sql
CREATE TABLE scope_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id         UUID REFERENCES job_rooms(id) ON DELETE SET NULL,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    source          scope_source NOT NULL DEFAULT 'manual',
    source_id       UUID,
    xactimate_code  TEXT,
    category        TEXT NOT NULL,
    description     TEXT NOT NULL,
    unit            TEXT NOT NULL,
    quantity        DECIMAL(10,2) NOT NULL DEFAULT 0,
    unit_price      DECIMAL(10,2),
    is_approved     BOOLEAN NOT NULL DEFAULT false,
    is_included     BOOLEAN NOT NULL DEFAULT true,
    notes           TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_by      UUID NOT NULL REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Row-Level Security

Every table with `company_id` gets tenant isolation via RLS:

```sql
-- Helper functions
CREATE OR REPLACE FUNCTION get_user_company_id() RETURNS UUID AS $$
    SELECT company_id FROM company_members
    WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION user_belongs_to_company(check_company_id UUID) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM company_members
        WHERE user_id = auth.uid() AND company_id = check_company_id AND is_active = true
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Pattern applied to every company-scoped table:
-- SELECT: any member can read
-- INSERT: any member can create
-- UPDATE: any member can update
-- DELETE: owner only
```

---

## API Endpoints (50+)

### Auth & Company
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /v1/auth/signup | None | Create user + company |
| POST | /v1/auth/login | None | Login |
| GET | /v1/company | Member | Get company info |
| PATCH | /v1/company | Owner | Update company |

### Team
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /v1/team/members | Member | List team |
| POST | /v1/team/invites | Owner | Invite member |
| POST | /v1/team/invites/:token/accept | None | Accept invite |

### Jobs
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /v1/jobs | Member | List jobs (filter/search/paginate) |
| POST | /v1/jobs | Member | Create job |
| GET | /v1/jobs/:id | Member | Job detail + stats |
| PATCH | /v1/jobs/:id | Member | Update job |
| DELETE | /v1/jobs/:id | Owner | Delete job |

### Rooms
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /v1/jobs/:id/rooms | Member | List rooms |
| POST | /v1/jobs/:id/rooms | Member | Add room |
| PATCH | /v1/jobs/:id/rooms/:rid | Member | Update room |

### Moisture / Site Log
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /v1/jobs/:id/rooms/:rid/readings | Member | Get readings (filter by type/date) |
| POST | /v1/jobs/:id/rooms/:rid/readings | Member | Add reading |
| POST | /v1/jobs/:id/rooms/:rid/readings/batch | Member | Batch submit (offline sync) |
| GET | /v1/jobs/:id/moisture-summary | Member | Trend dashboard data |

### Equipment
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /v1/equipment | Member | Equipment library |
| POST | /v1/equipment | Owner | Add equipment |
| POST | /v1/jobs/:id/equipment | Member | Place equipment |
| POST | /v1/jobs/:id/equipment/:pid/remove | Member | Remove equipment |

### Photos
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /v1/jobs/:id/photos/upload-url | Member | Get presigned upload URL |
| POST | /v1/jobs/:id/photos/confirm | Member | Confirm upload + process EXIF |
| GET | /v1/jobs/:id/photos | Member | Photo gallery |

### AI (Streaming SSE)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /v1/ai/photo-scope | Member | AI analyze photo → Xactimate items |
| POST | /v1/ai/photo-scope/:id/approve | Member | Approve AI items → scope_entries |
| POST | /v1/ai/voice-scope | Member | Audio → transcript → Xactimate items |
| POST | /v1/ai/voice-scope/:id/approve | Member | Approve voice items |
| POST | /v1/ai/guided-scope/start | Member | Start interactive guided session |
| POST | /v1/ai/guided-scope/:sid/respond | Member | Continue guided conversation |

### Scope Entries
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /v1/jobs/:id/scope | Member | All scope entries |
| POST | /v1/jobs/:id/scope | Member | Add manual entry |
| PATCH | /v1/jobs/:id/scope/bulk | Member | Bulk approve/exclude |

### Reports
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /v1/jobs/:id/reports | Member | Generate report (SSE) |
| GET | /v1/jobs/:id/reports/:rid/download | Member | Download PDF |
| POST | /v1/jobs/:id/reports/:rid/export-xactimate | Member | Xactimate export |

---

## AI Integration Architecture

### Voice Scoping Pipeline
```
Client records audio
  → POST /ai/voice-scope (multipart)
  → FastAPI sends to Deepgram (streaming STT, ~$0.0043/min)
  → Transcript sent to Claude Sonnet for structured extraction
  → Returns Xactimate line items via SSE
  → User reviews + approves → scope_entries created
```

### Photo Scoping Pipeline
```
Client uploads photo via presigned URL
  → POST /ai/photo-scope { photo_id, job_id }
  → FastAPI fetches photo from Supabase Storage
  → Sends to Claude Vision API with scoping prompt
  → Parses structured Xactimate items
  → Stores in ai_scope_results
  → Streams results to client via SSE
  → User approves → scope_entries created
```

### Cost Controls
| Operation | Cost | Control |
|-----------|------|---------|
| Deepgram STT | ~$0.0043/min | Max 10 min/recording |
| Claude voice extraction | ~$0.01-0.03/call | Cache by transcript hash |
| Claude photo scope | ~$0.03-0.08/call | Deduplicate by photo + prompt hash |
| Monthly limits | Per tier | Solo: 50, Team: 200, Pro: 1000 |

---

## File Storage

```
Supabase Storage: "restoros" bucket

restoros/
  {company_id}/
    {job_id}/
      photos/originals/{photo_id}.jpg
      photos/thumbnails/{photo_id}_thumb.jpg
      audio/{voice_note_id}.webm
      reports/{report_id}.pdf
    company/logo.png
```

Upload flow: presigned URL → client uploads directly → POST /confirm triggers EXIF extraction + thumbnail generation.

---

## FastAPI Project Structure

```
backend/
  app/
    main.py
    config.py
    auth/       (dependencies, router, service)
    company/    (router, service, schemas)
    team/       (router, service, schemas)
    jobs/       (router, service, schemas)
    rooms/      (router, service, schemas)
    moisture/   (router, service, schemas)
    equipment/  (router, service, schemas)
    photos/     (router, service, exif, thumbnails)
    ai/         (router, voice_service, photo_service, guided_service, prompts, cost_tracker)
    scope/      (router, service, schemas)
    reports/    (router, service, pdf_generator, xactimate_export)
    sync/       (router, service)
    shared/     (database, exceptions, pagination, streaming)
  migrations/
  tests/
  Dockerfile
  railway.toml
```

---

## Implementation Roadmap

| Phase | Weeks | Scope |
|-------|-------|-------|
| 1. Foundation | 1-2 | Supabase setup, migrations, RLS, FastAPI scaffold, auth |
| 2. Core Jobs | 3-4 | Job + Room CRUD, team management, invites |
| 3. Field Data | 5-6 | Photos (presigned + EXIF), moisture readings, equipment |
| 4. AI Integration | 7-8 | Deepgram + Claude pipelines, SSE streaming, scope entries |
| 5. Reports | 9-10 | Report generation, PDF, Xactimate export, sketches |
| 6. Offline/Sync | 11-12 | Sync APIs, conflict resolution, IndexedDB integration |
