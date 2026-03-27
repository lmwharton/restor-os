# Crewmatic API Reference — Spec 01

> **Base URL:** `{BACKEND_URL}/v1` (local: `http://localhost:5174/v1`, staging: Railway URL)
>
> **Auth:** All endpoints (except `/v1/shared/{token}`) require `Authorization: Bearer {supabase_jwt}` header.
> The backend validates the JWT, looks up the user, and injects `AuthContext(auth_user_id, user_id, company_id, role)`.
> All queries are scoped to `company_id` from the auth context — no cross-company data leaks.
>
> **Error format:** `{ "error": "Human message", "error_code": "MACHINE_CODE" }`
>
> **Request/Response contracts:** Every endpoint has typed Pydantic models for request and response. FastAPI enforces these — if a request doesn't match the schema, it returns `422 Unprocessable Entity` with field-level validation errors automatically. Frontend should match these types exactly.

---

## Backend Structure

```
backend/api/
├── main.py                    # FastAPI app, router registration
├── config.py                  # Environment settings
├── auth/                      # Auth + company (Spec 00)
│   ├── middleware.py           # JWT validation, get_auth_context
│   ├── router.py, schemas.py, service.py
├── shared/
│   ├── database.py            # Supabase clients (anon, authenticated, admin)
│   ├── exceptions.py          # AppException
│   ├── dependencies.py        # Ownership validators: get_valid_job (verifies job belongs to company),
│   │                          #   get_valid_room (verifies room belongs to job+company),
│   │                          #   get_valid_reading (verifies reading chain), PaginationParams
│   └── events.py              # log_event() — internal, fire-and-forget, never fails the parent operation
├── properties/                # router.py, schemas.py, service.py
├── jobs/                      # router.py, schemas.py, service.py
├── floor_plans/               # router.py, schemas.py, service.py
├── rooms/                     # router.py, schemas.py, service.py
├── photos/                    # router.py, schemas.py, service.py
├── moisture/                  # router.py, schemas.py, service.py
├── events/                    # router.py, schemas.py, service.py (read-only queries)
├── reports/                   # router.py, schemas.py, service.py
└── sharing/                   # router.py, schemas.py, service.py
```

Each module follows the same pattern:
- **`router.py`** — FastAPI route handlers (thin HTTP layer, calls service)
- **`schemas.py`** — Pydantic models defining request/response types (the contract)
- **`service.py`** — Business logic + Supabase queries

---

## Authentication & Authorization

- **Authentication:** JWT in `Authorization: Bearer {token}` header. Validated by `auth/middleware.py` which decodes the Supabase JWT, looks up the user record, and injects `AuthContext(auth_user_id, user_id, company_id, role)` into route handlers via FastAPI `Depends()`.
- **Tenant Isolation:** `get_authenticated_client(token)` from `shared/database.py` passes the user's JWT to Supabase. RLS policies on every table enforce `company_id` isolation at the database level -- queries automatically filter to the authenticated user's company.
- **Nested Ownership:** `shared/dependencies.py` provides validator dependencies that verify the full parent chain belongs to the authenticated user's company. For example, `get_valid_room` verifies: room exists AND room.job_id matches the path AND job.company_id matches auth context. Similarly for readings (job -> room -> reading) and points (job -> reading -> point). These are injected as FastAPI dependencies on nested routes.
- **Public Access:** `GET /v1/shared/{token}` is the ONLY unauthenticated endpoint. It uses the admin client to look up the share link by token hash, validates expiry/revocation, then serves scoped job data. No JWT required.

---

## Pydantic Schema Reference (Request/Response Types)

### Shared Types

```python
class AuthContext:
    auth_user_id: UUID      # from Supabase JWT
    user_id: UUID           # our users.id
    company_id: UUID        # tenant scope
    role: str               # owner | employee
    is_platform_admin: bool

class PaginatedResponse[T]:
    items: list[T]
    total: int

class ErrorResponse:
    error: str              # human-readable message
    error_code: str         # machine-readable code (e.g., JOB_NOT_FOUND)
```

### Properties

```python
class PropertyCreate:
    address_line1: str                  # required, 1-500 chars
    address_line2: str | None
    city: str                           # required, 1-100 chars
    state: str                          # required, exactly 2 chars
    zip: str                            # required, 5-10 chars
    latitude: float | None
    longitude: float | None
    year_built: int | None              # 1600-2030, pre-1978 = lead paint risk
    property_type: str | None           # residential | commercial | multi-family
    total_sqft: int | None              # >= 0

class PropertyUpdate:
    # All fields optional — only send what changed
    address_line1: str | None
    address_line2: str | None
    city: str | None
    state: str | None
    zip: str | None
    latitude: float | None
    longitude: float | None
    year_built: int | None
    property_type: str | None
    total_sqft: int | None

class PropertyResponse:
    id: UUID
    company_id: UUID
    address_line1: str
    address_line2: str | None
    city: str
    state: str
    zip: str
    latitude: float | None
    longitude: float | None
    usps_standardized: str | None       # auto-generated normalized address
    year_built: int | None
    property_type: str | None
    total_sqft: int | None
    created_at: datetime
    updated_at: datetime
```

### Jobs

```python
class JobCreate:
    # Required (2 fields)
    address_line1: str                  # required
    loss_type: str = "water"            # water | fire | mold | storm | other

    # Optional — address
    city: str = ""
    state: str = ""
    zip: str = ""

    # Optional — property link
    property_id: UUID | None

    # Optional — customer
    customer_name: str | None
    customer_phone: str | None
    customer_email: str | None

    # Optional — loss info
    loss_category: str | None           # 1 | 2 | 3
    loss_class: str | None              # 1 | 2 | 3 | 4
    loss_cause: str | None              # e.g., "dishwasher leak"
    loss_date: date | None

    # Optional — insurance
    claim_number: str | None
    carrier: str | None
    adjuster_name: str | None
    adjuster_phone: str | None
    adjuster_email: str | None

    # Optional — notes
    notes: str | None
    tech_notes: str | None

class JobUpdate:
    # All fields optional — only send what changed
    status: str | None                  # needs_scope | scoped | submitted

    # Address
    address_line1: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None

    # Property link
    property_id: UUID | None = None

    # Customer
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None

    # Loss info
    loss_type: str | None = None
    loss_category: str | None = None
    loss_class: str | None = None
    loss_cause: str | None = None
    loss_date: date | None = None

    # Insurance
    claim_number: str | None = None
    carrier: str | None = None
    adjuster_name: str | None = None
    adjuster_phone: str | None = None
    adjuster_email: str | None = None

    # Notes
    notes: str | None = None
    tech_notes: str | None = None

class JobResponse:
    id: UUID
    company_id: UUID
    property_id: UUID | None
    job_number: str                     # auto-generated: JOB-YYYYMMDD-XXX
    address_line1: str
    city: str
    state: str
    zip: str
    customer_name: str | None
    customer_phone: str | None
    customer_email: str | None
    claim_number: str | None
    carrier: str | None
    adjuster_name: str | None
    adjuster_phone: str | None
    adjuster_email: str | None
    loss_type: str
    loss_category: str | None
    loss_class: str | None
    loss_cause: str | None
    loss_date: date | None
    status: str
    assigned_to: UUID | None
    notes: str | None
    tech_notes: str | None
    latitude: float | None
    longitude: float | None
    created_by: UUID | None
    updated_by: UUID | None
    created_at: datetime
    updated_at: datetime

class JobDetailResponse(JobResponse):
    room_count: int = 0                 # computed from job_rooms
    photo_count: int = 0                # computed from photos
    floor_plan_count: int = 0           # computed from floor_plans
    line_item_count: int = 0            # computed from line_items (Spec 02)
```

### Floor Plans

```python
class FloorPlanCreate:
    floor_number: int = 1               # 0-10 (0 = basement)
    floor_name: str = "Floor 1"         # max 50 chars
    canvas_data: dict | None            # JSONB: walls, doors, windows

class FloorPlanUpdate:
    floor_number: int | None
    floor_name: str | None
    canvas_data: dict | None
    thumbnail_url: str | None

class FloorPlanResponse:
    id: UUID
    job_id: UUID
    company_id: UUID
    floor_number: int
    floor_name: str
    canvas_data: dict | None
    thumbnail_url: str | None
    created_at: datetime
    updated_at: datetime

class SketchCleanupRequest:
    canvas_data: dict                   # raw sketch to clean up

class SketchChatRequest:
    canvas_data: dict                   # current sketch
    message: str                        # e.g., "move the door to the corner"

class SketchAIResponse:
    canvas_data: dict                   # cleaned/modified sketch
```

### Rooms

```python
class RoomCreate:
    room_name: str                      # required, 1-100 chars
    floor_plan_id: UUID | None          # link to floor plan (optional)
    length_ft: Decimal | None           # >= 0
    width_ft: Decimal | None
    height_ft: Decimal | None = 8.0     # default 8ft
    water_category: str | None          # 1 | 2 | 3
    water_class: str | None             # 1 | 2 | 3 | 4
    dry_standard: Decimal | None        # target reading for "dry"
    equipment_air_movers: int = 0       # >= 0
    equipment_dehus: int = 0
    room_sketch_data: dict | None       # per-room detail sketch
    notes: str | None
    sort_order: int = 0

class RoomUpdate:
    # All fields optional
    room_name: str | None
    floor_plan_id: UUID | None
    length_ft: Decimal | None
    width_ft: Decimal | None
    height_ft: Decimal | None
    water_category: str | None
    water_class: str | None
    dry_standard: Decimal | None
    equipment_air_movers: int | None
    equipment_dehus: int | None
    room_sketch_data: dict | None
    notes: str | None
    sort_order: int | None

class RoomResponse:
    id: UUID
    job_id: UUID
    company_id: UUID
    floor_plan_id: UUID | None
    room_name: str
    length_ft: Decimal | None
    width_ft: Decimal | None
    height_ft: Decimal | None
    square_footage: Decimal | None      # auto-calc: length * width
    water_category: str | None
    water_class: str | None
    dry_standard: Decimal | None
    equipment_air_movers: int
    equipment_dehus: int
    room_sketch_data: dict | None
    notes: str | None
    sort_order: int
    reading_count: int = 0              # computed: count of moisture_readings for this room
    latest_reading_date: date | None    # computed: max reading_date from moisture_readings
    created_at: datetime
    updated_at: datetime
```

### Photos

```python
class PhotoUploadUrlRequest:
    filename: str                       # required
    content_type: str                   # image/jpeg | image/png

class PhotoUploadUrlResponse:
    upload_url: str                     # presigned URL — frontend uploads file here
    storage_path: str                   # pass back to /confirm

class PhotoConfirm:
    storage_path: str                   # from upload-url response
    filename: str | None
    room_id: UUID | None
    room_name: str | None
    photo_type: str = "damage"          # damage | equipment | protection | containment | moisture_reading | before | after
    caption: str | None

class PhotoUpdate:
    room_id: UUID | None
    room_name: str | None
    photo_type: str | None
    caption: str | None
    selected_for_ai: bool | None

class PhotoResponse:
    id: UUID
    job_id: UUID
    company_id: UUID
    room_id: UUID | None
    room_name: str | None
    storage_url: str                    # signed URL, 15-min expiry
    filename: str | None
    caption: str | None
    photo_type: str
    selected_for_ai: bool
    uploaded_at: datetime

class BulkSelectRequest:
    photo_ids: list[UUID]               # min 1
    selected_for_ai: bool = True

class BulkTagRequest:
    assignments: list[BulkTagAssignment]

class BulkTagAssignment:
    photo_id: UUID
    room_id: UUID
```

### Moisture Readings

```python
class MoistureReadingCreate:
    reading_date: date
    atmospheric_temp_f: Decimal | None  # 0-200
    atmospheric_rh_pct: Decimal | None  # 0-100
    # atmospheric_gpp is auto-calculated — do NOT send

class MoistureReadingUpdate:
    reading_date: date | None
    atmospheric_temp_f: Decimal | None
    atmospheric_rh_pct: Decimal | None

class MoistureReadingResponse:
    id: UUID
    job_id: UUID
    room_id: UUID
    company_id: UUID
    reading_date: date
    day_number: int | None              # auto-calc from loss_date
    atmospheric_temp_f: Decimal | None
    atmospheric_rh_pct: Decimal | None
    atmospheric_gpp: Decimal | None     # auto-calculated
    points: list[MoisturePointResponse] = []
    dehus: list[DehuOutputResponse] = []
    created_at: datetime
    updated_at: datetime

class MoisturePointCreate:
    location_name: str                  # required, 1-200 chars
    reading_value: Decimal              # required
    meter_photo_url: str | None         # upload via photos pipeline first
    sort_order: int = 0

class MoisturePointUpdate:
    location_name: str | None
    reading_value: Decimal | None
    meter_photo_url: str | None
    sort_order: int | None

class MoisturePointResponse:
    id: UUID
    reading_id: UUID
    location_name: str
    reading_value: Decimal
    meter_photo_url: str | None
    sort_order: int
    created_at: datetime

class DehuOutputCreate:
    dehu_model: str | None              # e.g., "Phoenix Drymax XL"
    rh_out_pct: Decimal | None          # 0-100
    temp_out_f: Decimal | None          # 0-200
    sort_order: int = 0

class DehuOutputUpdate:
    dehu_model: str | None
    rh_out_pct: Decimal | None
    temp_out_f: Decimal | None
    sort_order: int | None

class DehuOutputResponse:
    id: UUID
    reading_id: UUID
    dehu_model: str | None
    rh_out_pct: Decimal | None
    temp_out_f: Decimal | None
    sort_order: int
    created_at: datetime
```

### Events

```python
class EventResponse:
    id: UUID
    company_id: UUID
    job_id: UUID | None
    event_type: str                     # see Event Types list below
    user_id: UUID | None                # null for AI actions
    is_ai: bool
    event_data: dict                    # flexible JSONB payload
    created_at: datetime

# No EventCreate — events are logged internally, never via API
```

### Reports

```python
class ReportCreate:
    report_type: str = "full_report"    # full_report | mitigation_invoice

class ReportResponse:
    id: UUID
    job_id: UUID
    company_id: UUID
    report_type: str
    status: str                         # draft | generating | ready | failed
    storage_url: str | None
    generated_at: datetime | None
    created_at: datetime
    updated_at: datetime

class ReportDownloadResponse:
    download_url: str                   # signed URL, 15-min expiry
```

### Share Links

```python
class ShareLinkCreate:
    scope: str = "full"                 # full | mitigation_only | photos_only
    expires_days: int = 7               # 1-30

class ShareLinkResponse:
    share_url: str                      # full public URL
    share_token: str                    # raw token (shown once)
    expires_at: datetime

class ShareLinkListItem:
    id: UUID
    scope: str
    expires_at: datetime
    revoked_at: datetime | None
    created_at: datetime

class SharedJobResponse:
    job: dict                           # scoped job fields (sensitive fields redacted)
    rooms: list[RoomResponse]
    photos: list[PhotoResponse]         # signed URLs
    moisture_readings: list[MoistureReadingResponse]  # if scope allows
    line_items: list[dict]              # if exists (from Spec 02)
    company: dict                       # name, phone, logo_url
```

---

## Error Codes Reference

| Code | HTTP | Module | When |
|------|------|--------|------|
| PROPERTY_DUPLICATE | 400 | Properties | Address already exists for company |
| PROPERTY_NOT_FOUND | 404 | Properties | Property ID not found |
| JOB_NOT_FOUND | 404 | Jobs | Job ID not found or wrong company |
| INVALID_LOSS_TYPE | 400 | Jobs | Not in: water, fire, mold, storm, other |
| INVALID_LOSS_CATEGORY | 400 | Jobs/Rooms | Not in: 1, 2, 3 |
| INVALID_LOSS_CLASS | 400 | Jobs/Rooms | Not in: 1, 2, 3, 4 |
| INVALID_STATUS | 400 | Jobs | Not in: needs_scope, scoped, submitted |
| NO_UPDATES | 400 | All PATCH | Empty update body |
| FORBIDDEN | 403 | Jobs | Non-owner trying to delete |
| FLOOR_PLAN_NOT_FOUND | 404 | Floor Plans | Floor plan ID not found |
| FLOOR_PLAN_EXISTS | 409 | Floor Plans | Duplicate floor_number on job |
| ROOM_NOT_FOUND | 404 | Rooms | Room ID not found |
| INVALID_WATER_CATEGORY | 400 | Rooms | Not in: 1, 2, 3 |
| INVALID_WATER_CLASS | 400 | Rooms | Not in: 1, 2, 3, 4 |
| PHOTO_NOT_FOUND | 404 | Photos | Photo ID not found |
| INVALID_FILE_TYPE | 400 | Photos | Not image/jpeg or image/png |
| PHOTO_LIMIT_REACHED | 400 | Photos | 100 photos per job max |
| INVALID_PHOTO_TYPE | 400 | Photos | Not a valid photo_type |
| READING_NOT_FOUND | 404 | Moisture | Reading ID not found |
| READING_EXISTS | 409 | Moisture | Duplicate room + date |
| POINT_NOT_FOUND | 404 | Moisture | Point ID not found |
| DEHU_NOT_FOUND | 404 | Moisture | Dehu ID not found |
| REPORT_NOT_FOUND | 404 | Reports | Report ID not found |
| REPORT_NOT_READY | 400 | Reports | Report still generating or failed |
| INVALID_REPORT_TYPE | 400 | Reports | Not in: full_report, mitigation_invoice |
| SHARE_NOT_FOUND | 404 | Sharing | Token not found |
| SHARE_EXPIRED | 403 | Sharing | Token expired or revoked |

---

## Existing Endpoints (Spec 00 — Bootstrap)

### Auth & Company

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/me` | JWT | Get current user + company |
| PATCH | `/v1/me` | JWT | Update user name/phone |
| GET | `/v1/company` | JWT | Get company (404 → onboarding) |
| POST | `/v1/company` | JWT | Create company (onboarding) |
| PATCH | `/v1/company` | JWT (owner) | Update company |
| POST | `/v1/company/logo` | JWT (owner) | Upload company logo |

---

## New Endpoints (Spec 01 — Jobs + Site Log + Floor Plan)

### Properties

```
POST   /v1/properties                              Create property
GET    /v1/properties                              List properties
GET    /v1/properties/{property_id}                Get property
PATCH  /v1/properties/{property_id}                Update property
```

#### POST /v1/properties
```jsonc
// Request
{
  "address_line1": "27851 Gilbert Drive",      // required
  "address_line2": null,
  "city": "Warren",                             // required
  "state": "MI",                                // required, 2 chars
  "zip": "48093",                               // required, 5-10 chars
  "latitude": 42.4975,
  "longitude": -83.0278,
  "year_built": 1977,                           // optional, pre-1978 = lead paint risk
  "property_type": "residential",               // residential | commercial | multi-family
  "total_sqft": 1850
}

// Response 201
{
  "id": "uuid",
  "company_id": "uuid",
  "address_line1": "27851 Gilbert Drive",
  "address_line2": null,
  "city": "Warren",
  "state": "MI",
  "zip": "48093",
  "latitude": 42.4975,
  "longitude": -83.0278,
  "usps_standardized": "27851 gilbert drive warren mi 48093",
  "year_built": 1977,
  "property_type": "residential",
  "total_sqft": 1850,
  "created_at": "2026-03-26T...",
  "updated_at": "2026-03-26T..."
}

// Errors
// 400 PROPERTY_DUPLICATE — Property at this address already exists
```

#### GET /v1/properties
```
Query params: ?search=gilbert&limit=20&offset=0
Response: { "items": [PropertyResponse], "total": 5 }
```

---

### Jobs (enhanced from Spec 00)

```
POST   /v1/jobs                                    Create job
GET    /v1/jobs                                    List jobs (filtered, paginated)
GET    /v1/jobs/{job_id}                           Get job detail (with counts)
PATCH  /v1/jobs/{job_id}                           Update job
DELETE /v1/jobs/{job_id}                           Soft delete job
```

#### POST /v1/jobs
```jsonc
// Request — only address_line1 + loss_type required
{
  // Required
  "address_line1": "27851 Gilbert Drive",
  "loss_type": "water",                           // water | fire | mold | storm | other

  // Optional — address
  "city": "Warren",
  "state": "MI",
  "zip": "48093",

  // Optional — property link
  "property_id": "uuid-of-property",              // links to properties table

  // Optional — customer
  "customer_name": "Jane Doe",
  "customer_phone": "(586) 555-9600",
  "customer_email": "janedoe@yahoo.com",

  // Optional — loss info
  "loss_category": "2",                           // 1 | 2 | 3 (water category)
  "loss_class": "1",                              // 1 | 2 | 3 | 4 (water class)
  "loss_cause": "dishwasher leak",
  "loss_date": "2026-03-13",

  // Optional — insurance
  "claim_number": "9742.34",
  "carrier": "State Farm",
  "adjuster_name": "Alex Garnapudi",
  "adjuster_phone": "(555) 123-4567",
  "adjuster_email": "a.garnet-poti@farmers.com",

  // Optional — notes
  "notes": "Customer called at 2pm",
  "tech_notes": "Lifted carpet and pad, flood cut 2ft..."
}

// Response 201 — JobDetailResponse (includes computed counts)
{
  "id": "uuid",
  "company_id": "uuid",
  "property_id": "uuid-or-null",
  "job_number": "JOB-20260326-001",               // auto-generated
  "address_line1": "27851 Gilbert Drive",
  "city": "Warren",
  "state": "MI",
  "zip": "48093",
  "latitude": null,
  "longitude": null,
  "customer_name": "Jane Doe",
  "customer_phone": "(586) 555-9600",
  "customer_email": "janedoe@yahoo.com",
  "claim_number": "9742.34",
  "carrier": "State Farm",
  "adjuster_name": "Alex Garnapudi",
  "adjuster_phone": "(555) 123-4567",
  "adjuster_email": "a.garnet-poti@farmers.com",
  "loss_type": "water",
  "loss_category": "2",
  "loss_class": "1",
  "loss_cause": "dishwasher leak",
  "loss_date": "2026-03-13",
  "status": "needs_scope",                        // needs_scope | scoped | submitted
  "assigned_to": null,
  "notes": "Customer called at 2pm",
  "tech_notes": "...",
  "created_by": "uuid",
  "updated_by": null,
  "created_at": "2026-03-26T...",
  "updated_at": "2026-03-26T...",
  // Computed counts (detail only)
  "room_count": 0,
  "photo_count": 0,
  "floor_plan_count": 0
}

// Errors
// 400 INVALID_LOSS_TYPE — must be: water, fire, mold, storm, other
// 400 INVALID_LOSS_CATEGORY — must be: 1, 2, 3
// 400 INVALID_LOSS_CLASS — must be: 1, 2, 3, 4
```

#### GET /v1/jobs
```
Query params:
  ?status=needs_scope          filter by status
  &loss_type=water             filter by loss type
  &search=gilbert              search address_line1, customer_name (ILIKE)
  &limit=20                    max 100
  &offset=0
  &sort_by=created_at          allowed: created_at, updated_at, job_number, customer_name
  &sort_dir=desc               asc | desc

Response: { "items": [JobResponse], "total": 12 }
```

#### GET /v1/jobs/{job_id}
```
Response: JobDetailResponse (with room_count, photo_count, floor_plan_count)
Errors: 404 JOB_NOT_FOUND
```

#### PATCH /v1/jobs/{job_id}
```jsonc
// Request — only send fields to update
{ "status": "scoped", "tech_notes": "Day 2: readings improving..." }

// Response: JobDetailResponse
// Errors: 400 NO_UPDATES, 400 INVALID_STATUS, 404 JOB_NOT_FOUND
```

#### DELETE /v1/jobs/{job_id}
```
Response: { "deleted": true }
Errors: 403 FORBIDDEN (owner/admin only), 404 JOB_NOT_FOUND
```

---

### Floor Plans

```
POST   /v1/jobs/{job_id}/floor-plans                         Create floor plan
GET    /v1/jobs/{job_id}/floor-plans                         List floor plans
PATCH  /v1/jobs/{job_id}/floor-plans/{floor_plan_id}         Update floor plan
DELETE /v1/jobs/{job_id}/floor-plans/{floor_plan_id}         Delete floor plan
POST   /v1/jobs/{job_id}/floor-plans/{floor_plan_id}/ai-cleanup   AI sketch cleanup
POST   /v1/jobs/{job_id}/floor-plans/{floor_plan_id}/ai-chat      AI sketch chat
```

#### POST /v1/jobs/{job_id}/floor-plans
```jsonc
// Request
{
  "floor_number": 1,                              // 0-10 (0 = basement)
  "floor_name": "Floor 1",                        // or "Basement", "Attic"
  "canvas_data": null                              // JSONB — null initially, set when user draws
}

// Response 201
{
  "id": "uuid",
  "job_id": "uuid",
  "company_id": "uuid",
  "floor_number": 1,
  "floor_name": "Floor 1",
  "canvas_data": null,
  "thumbnail_url": null,
  "created_at": "...",
  "updated_at": "..."
}

// Errors: 404 JOB_NOT_FOUND, 409 FLOOR_PLAN_EXISTS (duplicate floor_number)
```

#### PATCH /v1/jobs/{job_id}/floor-plans/{floor_plan_id}
```jsonc
// Request — typically updating canvas_data after user draws
{
  "canvas_data": { "walls": [...], "doors": [...], "windows": [...] }
}

// Response: FloorPlanResponse
```

> **Auto-room creation:** When floor plan `canvas_data` is saved (PATCH), if closed shapes form rooms, the backend auto-creates/updates `job_room` records with dimensions extracted from the geometry. This is handled server-side in the `floor_plans` service.

#### POST /v1/jobs/{job_id}/floor-plans/{floor_plan_id}/ai-cleanup
```jsonc
// Request
{ "canvas_data": { "walls": [...], "doors": [...] } }

// Response — cleaned geometry
{ "canvas_data": { "walls": [...], "doors": [...] } }
// Walls straightened, corners aligned, dimensions snapped to 0.25ft
```

#### POST /v1/jobs/{job_id}/floor-plans/{floor_plan_id}/ai-chat
```jsonc
// Request
{
  "canvas_data": { "walls": [...], "doors": [...] },
  "message": "Move the door to the corner and make room 2 be 10x10"
}

// Response — modified geometry
{ "canvas_data": { "walls": [...], "doors": [...] } }
```

---

### Rooms

```
POST   /v1/jobs/{job_id}/rooms                    Create room
GET    /v1/jobs/{job_id}/rooms                    List rooms
PATCH  /v1/jobs/{job_id}/rooms/{room_id}          Update room
DELETE /v1/jobs/{job_id}/rooms/{room_id}          Delete room
```

#### POST /v1/jobs/{job_id}/rooms
```jsonc
// Request
{
  "room_name": "Master Bedroom",                   // required
  "floor_plan_id": "uuid-or-null",                 // link to floor plan (optional)
  "length_ft": 10.5,
  "width_ft": 15.0,
  "height_ft": 8.0,                                // defaults to 8
  "water_category": "2",                            // 1 | 2 | 3
  "water_class": "1",                               // 1 | 2 | 3 | 4
  "dry_standard": 85.0,                             // target reading for "dry"
  "equipment_air_movers": 3,
  "equipment_dehus": 1,
  "room_sketch_data": null,                         // per-room detail sketch (JSONB)
  "notes": "Ceiling affected, hardwood under carpet",
  "sort_order": 0
}

// Response 201
{
  "id": "uuid",
  "job_id": "uuid",
  "company_id": "uuid",
  "floor_plan_id": "uuid-or-null",
  "room_name": "Master Bedroom",
  "length_ft": 10.5,
  "width_ft": 15.0,
  "height_ft": 8.0,
  "square_footage": 157.5,                         // auto-calculated: length * width
  "water_category": "2",
  "water_class": "1",
  "dry_standard": 85.0,
  "equipment_air_movers": 3,
  "equipment_dehus": 1,
  "room_sketch_data": null,
  "notes": "Ceiling affected, hardwood under carpet",
  "sort_order": 0,
  "created_at": "...",
  "updated_at": "..."
}

// Errors: 404 JOB_NOT_FOUND, 404 FLOOR_PLAN_NOT_FOUND, 400 INVALID_WATER_CATEGORY/CLASS
```

---

### Photos

```
POST   /v1/jobs/{job_id}/photos/upload-url         Get presigned upload URL
POST   /v1/jobs/{job_id}/photos/confirm            Confirm upload + create record
GET    /v1/jobs/{job_id}/photos                    List photos (filtered)
PATCH  /v1/jobs/{job_id}/photos/{photo_id}         Update photo metadata
DELETE /v1/jobs/{job_id}/photos/{photo_id}         Delete photo
POST   /v1/jobs/{job_id}/photos/bulk-select        Bulk mark selected_for_ai
POST   /v1/jobs/{job_id}/photos/bulk-tag           Bulk assign rooms to photos
```

#### POST /v1/jobs/{job_id}/photos/upload-url
```jsonc
// Request
{ "filename": "IMG_4521.jpg", "content_type": "image/jpeg" }

// Response
{
  "upload_url": "https://supabase.../storage/v1/object/upload/...",
  "storage_path": "company-uuid/job-uuid/photo-uuid.jpg"
}

// Frontend: upload file directly to upload_url (PUT), then call /confirm

// Errors: 400 INVALID_FILE_TYPE (only image/jpeg, image/png), 400 PHOTO_LIMIT_REACHED (max 100)
```

#### POST /v1/jobs/{job_id}/photos/confirm
```jsonc
// Request — after successful upload to Supabase Storage
{
  "storage_path": "company-uuid/job-uuid/photo-uuid.jpg",
  "filename": "IMG_4521.jpg",
  "room_id": "uuid-or-null",
  "room_name": "Master Bedroom",                   // auto-filled if room_id set
  "photo_type": "damage",                           // damage | equipment | protection | containment | moisture_reading | before | after
  "caption": "East wall water stain at 12 inches"
}

// Response 201
{
  "id": "uuid",
  "job_id": "uuid",
  "company_id": "uuid",
  "room_id": "uuid-or-null",
  "room_name": "Master Bedroom",
  "storage_url": "https://signed-url...",           // 15-min signed URL
  "filename": "IMG_4521.jpg",
  "caption": "East wall water stain at 12 inches",
  "photo_type": "damage",
  "selected_for_ai": false,
  "uploaded_at": "..."
}
```

#### GET /v1/jobs/{job_id}/photos
```
Query params:
  ?room_id=uuid                filter by room
  &photo_type=damage           filter by type
  &selected_for_ai=true        filter by AI selection
  &group_by=room               group photos by room (optional, values: "room" or omit)
  &limit=50                    max 100
  &offset=0

Response (default, no group_by): { "items": [PhotoResponse], "total": 42 }
Response (group_by=room): { "groups": [{ "room_id": "uuid|null", "room_name": "str|null", "photos": [PhotoResponse] }], "total": 42 }
// All storage_urls are signed with 15-min expiry
```

#### POST /v1/jobs/{job_id}/photos/bulk-select
```jsonc
// Request
{ "photo_ids": ["uuid1", "uuid2", "uuid3"], "selected_for_ai": true }

// Response
{ "updated": 3 }
```

#### POST /v1/jobs/{job_id}/photos/bulk-tag
```jsonc
// Request — from Tag Rooms modal
{
  "assignments": [
    { "photo_id": "uuid1", "room_id": "uuid-room1" },
    { "photo_id": "uuid2", "room_id": "uuid-room1" },
    { "photo_id": "uuid3", "room_id": "uuid-room2" }
  ]
}

// Response
{ "updated": 3 }
```

---

### Moisture Readings

```
POST   /v1/jobs/{job_id}/rooms/{room_id}/readings                    Create reading
GET    /v1/jobs/{job_id}/rooms/{room_id}/readings                    List readings for room
GET    /v1/jobs/{job_id}/readings                                     List ALL readings for job
PATCH  /v1/jobs/{job_id}/readings/{reading_id}                       Update reading
DELETE /v1/jobs/{job_id}/readings/{reading_id}                       Delete reading
POST   /v1/jobs/{job_id}/readings/{reading_id}/points                Add moisture point
PATCH  /v1/jobs/{job_id}/readings/{reading_id}/points/{point_id}     Update point
DELETE /v1/jobs/{job_id}/readings/{reading_id}/points/{point_id}     Delete point
POST   /v1/jobs/{job_id}/readings/{reading_id}/dehus                 Add dehu output
PATCH  /v1/jobs/{job_id}/readings/{reading_id}/dehus/{dehu_id}       Update dehu
DELETE /v1/jobs/{job_id}/readings/{reading_id}/dehus/{dehu_id}       Delete dehu
```

#### POST /v1/jobs/{job_id}/rooms/{room_id}/readings
```jsonc
// Request
{
  "reading_date": "2026-03-19",
  "atmospheric_temp_f": 72.0,
  "atmospheric_rh_pct": 45.0
  // atmospheric_gpp is auto-calculated, do not send
}

// Response 201
{
  "id": "uuid",
  "job_id": "uuid",
  "room_id": "uuid",
  "company_id": "uuid",
  "reading_date": "2026-03-19",
  "day_number": 6,                                 // auto-calc from loss_date
  "atmospheric_temp_f": 72.0,
  "atmospheric_rh_pct": 45.0,
  "atmospheric_gpp": 58.2,                         // auto-calculated
  "points": [],
  "dehus": [],
  "created_at": "...",
  "updated_at": "..."
}

// Errors: 404 JOB_NOT_FOUND, 404 ROOM_NOT_FOUND, 409 READING_EXISTS (duplicate date+room)
```

#### POST /v1/jobs/{job_id}/readings/{reading_id}/points
```jsonc
// Request
{
  "location_name": "Kitchen wall",
  "reading_value": 150.0,
  "meter_photo_url": "https://signed-url...",       // upload via photos pipeline first
  "sort_order": 0
}

// Response 201: MoisturePointResponse
```

#### POST /v1/jobs/{job_id}/readings/{reading_id}/dehus
```jsonc
// Request
{
  "dehu_model": "Phoenix Drymax XL",
  "rh_out_pct": 1.0,
  "temp_out_f": 90.0,
  "sort_order": 0
}

// Response 201: DehuOutputResponse
```

#### GET /v1/jobs/{job_id}/readings
```
Returns ALL readings across ALL rooms for this job.
Each reading includes nested points[] and dehus[].
Ordered by reading_date ASC, room_id.
Used for PDF report generation and Drying Certificate.
```

---

### Event History

```
GET    /v1/jobs/{job_id}/events                    Job timeline
GET    /v1/events                                   Company activity feed
```

#### GET /v1/jobs/{job_id}/events
```
Query params:
  ?event_type=photo_uploaded   filter by type
  &limit=50                    max 200
  &offset=0

Response: {
  "items": [
    {
      "id": "uuid",
      "company_id": "uuid",
      "job_id": "uuid",
      "event_type": "photo_uploaded",
      "user_id": "uuid-or-null",
      "is_ai": false,
      "event_data": { "photo_id": "uuid", "filename": "IMG_4521.jpg" },
      "created_at": "2026-03-26T14:32:00Z"
    }
  ],
  "total": 47
}
```

#### GET /v1/events
```
Query params:
  ?event_type=job_created      filter by type
  &job_id=uuid                 filter by job
  &limit=50
  &offset=0

Response: { "items": [EventResponse], "total": 150 }
// Company-wide activity feed, ordered by created_at DESC
```

**Note:** No POST endpoint — events are logged internally by all services via `log_event()` helper.

---

### Reports

```
POST   /v1/jobs/{job_id}/reports                              Generate report
GET    /v1/jobs/{job_id}/reports                              List reports (poll status)
GET    /v1/jobs/{job_id}/reports/{report_id}/download          Get download URL
```

#### POST /v1/jobs/{job_id}/reports
```jsonc
// Request
{ "report_type": "full_report" }                    // full_report | mitigation_invoice

// Response 201 — status will be "generating"
{
  "id": "uuid",
  "job_id": "uuid",
  "company_id": "uuid",
  "report_type": "full_report",
  "status": "generating",                           // draft | generating | ready | failed
  "storage_url": null,
  "generated_at": null,
  "created_at": "...",
  "updated_at": "..."
}

// Poll GET /v1/jobs/{job_id}/reports until status = "ready"
// Errors: 404 JOB_NOT_FOUND, 400 INVALID_REPORT_TYPE
```

#### GET /v1/jobs/{job_id}/reports/{report_id}/download
```jsonc
// Response — only when status = "ready"
{ "download_url": "https://signed-url-15min..." }

// Errors: 404 REPORT_NOT_FOUND, 400 REPORT_NOT_READY
```

---

### Share Links

```
POST   /v1/jobs/{job_id}/share                     Create share link
GET    /v1/jobs/{job_id}/share                     List active share links
DELETE /v1/jobs/{job_id}/share/{link_id}            Revoke share link
GET    /v1/shared/{token}                          Public read-only view (NO AUTH)
```

#### POST /v1/jobs/{job_id}/share
```jsonc
// Request
{
  "scope": "full",                                  // full | mitigation_only | photos_only
  "expires_days": 7                                 // 1-30 days
}

// Response 201
{
  "share_url": "https://crewmaticai.vercel.app/shared/abc123def456",
  "share_token": "abc123def456",                    // raw token (shown once, stored as hash)
  "expires_at": "2026-04-02T..."
}
```

#### GET /v1/shared/{token} — NO AUTH
```jsonc
// Response — scoped job data based on share link scope
{
  "job": {
    "job_number": "JOB-20260326-001",
    "address_line1": "27851 Gilbert Drive",
    "city": "Warren", "state": "MI", "zip": "48093",
    "loss_type": "water",
    "loss_category": "2",
    "loss_class": "1",
    "status": "scoped"
    // customer_phone, customer_email REDACTED in shared view
  },
  "rooms": [...],
  "photos": [...],                                  // signed URLs
  "moisture_readings": [...],                       // if scope allows
  "line_items": [...],                              // if exists (from Spec 02)
  "company": {
    "name": "Dry Pros",
    "phone": "(586) 944-7700",
    "logo_url": "..."
  }
}

// Errors: 404 SHARE_NOT_FOUND, 403 SHARE_EXPIRED
```

---

## Event Types (for filtering)

```
job_created, job_updated, job_status_changed, job_deleted,
property_created, property_updated,
room_added, room_updated, room_deleted,
floor_plan_created, floor_plan_updated, floor_plan_sketch_cleaned,
photo_uploaded, photo_updated, photo_deleted, photo_tagged_to_room, photos_bulk_tagged,
ai_photo_analysis, ai_photo_analysis_retry, ai_sketch_cleanup, ai_sketch_chat,
ai_hazmat_scan, ai_scope_audit,
line_item_generated, line_item_accepted, line_item_edited, line_item_deleted, line_item_added_manual,
ai_feedback_thumbs_up, ai_feedback_thumbs_down,
moisture_reading_added, moisture_reading_updated, moisture_reading_deleted,
equipment_updated,
report_generated, report_downloaded, report_shared,
settings_updated, team_member_invited, team_member_joined
```

---

## Endpoint Count Summary

| Module | Endpoints | Methods |
|--------|-----------|---------|
| Properties | 4 | POST, GET list, GET detail, PATCH |
| Jobs | 5 | POST, GET list, GET detail, PATCH, DELETE |
| Floor Plans | 6 | POST, GET list, PATCH, DELETE, AI cleanup, AI chat |
| Rooms | 4 | POST, GET list, PATCH, DELETE |
| Photos | 7 | upload-url, confirm, GET list, PATCH, DELETE, bulk-select, bulk-tag |
| Moisture | 11 | readings CRUD, points CRUD, dehus CRUD, job-level list |
| Events | 2 | job timeline, company feed |
| Reports | 3 | generate, list/poll, download |
| Share | 4 | create, list, revoke, public view |
| **Total** | **46** | |
