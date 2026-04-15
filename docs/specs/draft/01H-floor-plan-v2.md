# Spec 01H: Floor Plan V2 — Sketch Tool Product Redesign

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% |
| **State** | Draft — spec review pending, not yet started |
| **Blocker** | Property table migration (prerequisite for Phase 1) |
| **Branch** | TBD (off main, after 01C merges) |
| **Depends on** | Spec 01C (Floor Plan Konva rebuild — in review), Spec 01B (Reconstruction — merged) |
| **Source** | Brett's Sketch & Floor Plan Tool Product Design Specification v2.0 (April 13, 2026) |

## Summary

Brett's V2 spec redefines the sketch tool from a drawing canvas into the **spatial backbone** of the platform. Every feature — moisture readings, equipment tracking, photo documentation, billing, and carrier reports — anchors to the floor plan.

Key changes from what we built in 01C:
- Floor plans belong to **properties**, not jobs (mitigation draws it, reconstruction inherits it)
- Rooms become **structured records** with type, ceiling, materials, affected status — not just rectangles with names
- Walls become **data-carrying segments** with type (exterior/interior), affected status, and SF calculations
- Moisture readings move **onto the canvas** as spatial pins with color-coded dry status
- Equipment tracking becomes **spatial** with placed/pulled timestamps driving billing
- Photos gain **categories**, **before/after pairing**, and **unplaced tray** workflow

## Done When

### Phase 1: Core Canvas & Room Data
- [ ] Properties table created; floor plans migrate from `job_id` to `property_id`
- [ ] Room creation: drop default 10×10 rectangle (dashed = unconfirmed), deform by dragging edges/corners
- [ ] Room confirmation card: name, type, dimensions, ceiling height, ceiling type, materials, affected status
- [ ] Room type system: 13 predefined types with auto-populated material defaults
- [ ] 6-inch grid snap (gridSize: 10px = 6 inches)
- [ ] Floor SF auto-calculated: length × width - floor openings
- [ ] Wall SF auto-calculated: perimeter LF × ceiling height × ceiling multiplier - openings
- [ ] Multi-floor selector: Basement / Main Floor / Upper Floor / Attic (predefined levels)
- [ ] Floor openings: stairwell cutouts that subtract from floor SF

### Phase 1B: Polygon Rooms
- [ ] Trace perimeter method: tap corners sequentially, auto-close into room
- [ ] L-shaped rooms via corner drag (inserts vertices, maintains 90° angles)
- [ ] RoomData changes from `{x, y, width, height}` to `{points: [{x,y}]}`
- [ ] Wall generation from polygon edges (N walls, not always 4)
- [ ] SF calculation from polygon area formula

### Phase 2: Wall Interactions
- [ ] Wall contextual menu on tap: Add Door, Add Window, Add Opening, Wall Type, Mark Affected
- [ ] Door height field (default 7ft, editable) — SF deduction: width × height
- [ ] Window height field (default 4ft) + sill height (optional) — SF deduction: width × height
- [ ] Opening (missing wall): dashed line indicator, drag handles for start/end, full SF deduction
- [ ] Wall type toggle: exterior / interior (drives Xactimate material codes)
- [ ] Wall affected status: per-wall mitigation scope flag (independent from room)
- [ ] Shared wall auto-detection on room snap, lighter line weight rendering

### Phase 3: Moisture Pins
- [ ] Moisture Mode toggle in toolbar (canvas dims, pin tools activate)
- [ ] Pin drop on canvas tap with placement card: location descriptor, material type, reading value
- [ ] Pin color: red (>10% above dry standard), amber (within 10%), green (at/below)
- [ ] Tap existing pin → enter new daily reading (pin shows latest color)
- [ ] Pin history panel: chronological readings with sparkline trend chart
- [ ] Regression detection: amber warning if reading increases day-over-day
- [ ] Room dry status: not dry until every pin in room is green
- [ ] Moisture floor plan PDF export

### Phase 4: Equipment Pins
- [ ] Equipment pin drop with placement card: type, quantity (air movers), auto-timestamp
- [ ] Equipment types: Air Mover, Dehumidifier, Air Scrubber, Hydroxyl Generator, Heater
- [ ] Pull Equipment workflow: tap pin → confirm → auto-timestamp pulled date → pin grays out
- [ ] Duration calculation: placed_at to pulled_at
- [ ] Duration feeds billing line items (quantity × days × rate)

### Phase 5: Photo Pins & Gallery
- [ ] Photo category selection on upload (8 categories, one tap)
- [ ] Before/After pairing: "Updated condition photo?" prompt when room has existing photos
- [ ] Unplaced photos tray: batch shoot, assign rooms later, flagged until assigned
- [ ] Photo count badge per room on canvas ("📷 14")
- [ ] Category filtering in room gallery
- [ ] GPS auto-capture on upload (browser Geolocation API)
- [ ] Tech name attribution on upload (from login session)

### Phase 6: Annotations & Versioning
- [ ] Annotation pins: free-text notes anchored to canvas locations
- [ ] Annotation metadata: timestamp, tech name, include/exclude from reports
- [ ] Sketch auto-versioning: every save creates snapshot with auto-generated change summary
- [ ] Version history panel accessible from toolbar
- [ ] Version rollback with confirmation step

---

## Database Schema

### Priority 1: Properties Table + Floor Plan Migration

```sql
-- Properties table — one property can have many jobs
CREATE TABLE properties (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    address_line1   TEXT NOT NULL,
    city            TEXT NOT NULL,
    state           TEXT NOT NULL,
    zip             TEXT NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_properties_company ON properties(company_id);

-- Prevent duplicate properties for the same address within a company
CREATE UNIQUE INDEX idx_properties_address_company
    ON properties(company_id, address_line1, city, state, zip);

-- RLS tenant isolation
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY properties_tenant ON properties
    USING (company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid);
```

**Relationship model:**

```
properties (parent)
  ├── jobs (children)        — job.property_id FK
  │     ├── mitigation job   → property_id = "abc"
  │     └── reconstruction   → property_id = "abc" (inherited via linked_job_id)
  └── floor_plans (children) — floor_plan.property_id FK
```

**Migration for floor_plans:**

```sql
-- Add property_id to floor_plans (nullable initially for migration)
ALTER TABLE floor_plans ADD COLUMN property_id UUID REFERENCES properties(id) ON DELETE CASCADE;

-- Backfill: create properties from existing jobs, link floor plans
-- (migration script creates property per unique job address, sets property_id)

-- After backfill, make property_id NOT NULL
ALTER TABLE floor_plans ALTER COLUMN property_id SET NOT NULL;

-- Index for property-level queries
CREATE INDEX idx_floor_plans_property ON floor_plans(property_id);
```

**Property auto-creation flow:**
1. Job created → property auto-created from address fields → `job.property_id` set
2. Reconstruction linked to mitigation via `linked_job_id` → `property_id` auto-copied from mitigation job
3. Floor plan created → `floor_plan.property_id` set from `job.property_id`
4. Both jobs see same floor plans via shared `property_id`

**Auto-creation logic (in job creation service):**

```python
# 1. Check if property exists for this address + company
existing = await supabase.table("properties").select("id").eq(
    "company_id", company_id
).eq("address_line1", address).eq("city", city).eq("state", state).eq("zip", zip
).maybe_single().execute()

if existing.data:
    property_id = existing.data["id"]
else:
    prop = await supabase.table("properties").insert({
        "company_id": company_id, "address_line1": address,
        "city": city, "state": state, "zip": zip,
        "latitude": lat, "longitude": lng,
    }).execute()
    property_id = prop.data[0]["id"]

# 2. Set on job
insert_data["property_id"] = property_id
```

**Room ownership:** Rooms stay job-scoped (`rooms.job_id` FK, not property-level). Reason: moisture readings, equipment counts, affected status, and water category are job-specific — a room can be affected in one job and not in another. The room's geometry comes from the shared property-level floor plan, but job-specific data belongs to the job. If mitigation creates 5 rooms and reconstruction inherits the floor plan, reconstruction creates its own room records with its own scope data.

### Priority 2: Room Enhancements

```sql
-- Room type enum — drives material defaults and Xactimate code suggestions
ALTER TABLE rooms ADD COLUMN room_type TEXT
    CHECK (room_type IN (
        'living_room', 'kitchen', 'bathroom', 'bedroom', 'basement',
        'hallway', 'laundry_room', 'garage', 'dining_room', 'office',
        'closet', 'utility_room', 'other'
    ));

-- Ceiling type — drives wall SF multiplier
ALTER TABLE rooms ADD COLUMN ceiling_type TEXT NOT NULL DEFAULT 'flat'
    CHECK (ceiling_type IN ('flat', 'vaulted', 'cathedral', 'sloped'));

-- Mitigation scope flag
ALTER TABLE rooms ADD COLUMN affected BOOLEAN NOT NULL DEFAULT false;

-- Material flags — auto-populated from room type, editable
-- e.g., ["carpet", "drywall", "paint", "backsplash"]
ALTER TABLE rooms ADD COLUMN material_flags JSONB NOT NULL DEFAULT '[]';

-- Wall SF (calculated, stored for reporting)
ALTER TABLE rooms ADD COLUMN wall_square_footage DECIMAL(10,2);
```

**Existing fields to wire up (already in schema, currently unused):**
- `height_ft` — default 8.0 in Pydantic, never set from frontend. Use for ceiling height.
- `square_footage` — exists, never calculated. Set to `length_ft × width_ft - floor_openings`.

**Ceiling type multipliers (hardcoded constants):**

| Ceiling Type | Multiplier | Use |
|-------------|------------|-----|
| flat | 1.0 | Standard — wall SF unchanged |
| vaulted | 1.3 | Extra wall area from vault curve |
| cathedral | 1.5 | Peaked ceiling, maximum extra area |
| sloped | 1.2 | Slight pitch, minor extra area |

### Priority 3: Photo Enhancements

```sql
-- Update photo_type categories to match Brett's spec
-- Current: damage | equipment | protection | containment | moisture_reading | before | after
-- New: damage | equipment_placement | drying_progress | before_demo | after_demo |
--      pre_repair | post_repair | final_completion
-- Keep old values valid during migration, add new ones
ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_photo_type_check;
ALTER TABLE photos ADD CONSTRAINT photos_photo_type_check CHECK (
    photo_type IN (
        -- V1 values (keep for backward compat)
        'damage', 'equipment', 'protection', 'containment', 'moisture_reading', 'before', 'after',
        -- V2 values (Brett's categories)
        'equipment_placement', 'drying_progress', 'before_demo', 'after_demo',
        'pre_repair', 'post_repair', 'final_completion'
    )
);

-- Before/After pairing
ALTER TABLE photos ADD COLUMN paired_photo_id UUID REFERENCES photos(id) ON DELETE SET NULL;

-- GPS auto-capture
ALTER TABLE photos ADD COLUMN latitude DOUBLE PRECISION;
ALTER TABLE photos ADD COLUMN longitude DOUBLE PRECISION;

-- Tech attribution
ALTER TABLE photos ADD COLUMN uploaded_by UUID REFERENCES users(id);
```

### Priority 4: Equipment Placements

```sql
CREATE TABLE equipment_placements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    floor_plan_id   UUID REFERENCES floor_plans(id) ON DELETE SET NULL,
    equipment_type  TEXT NOT NULL CHECK (equipment_type IN (
        'air_mover', 'dehumidifier', 'air_scrubber', 'hydroxyl_generator', 'heater'
    )),
    quantity        INTEGER NOT NULL DEFAULT 1
        CHECK (quantity >= 1),
    canvas_x        DECIMAL(6,2),
    canvas_y        DECIMAL(6,2),
    placed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    pulled_at       TIMESTAMPTZ,     -- null = still active
    placed_by       UUID REFERENCES users(id),
    pulled_by       UUID REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_equip_job ON equipment_placements(job_id);
CREATE INDEX idx_equip_active ON equipment_placements(job_id) WHERE pulled_at IS NULL;

-- RLS tenant isolation
ALTER TABLE equipment_placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY equip_tenant ON equipment_placements
    USING (company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid);
```

**Duration calculation (application-level):**
```
duration_days = CEIL((pulled_at - placed_at) / interval '1 day')
billing = quantity × duration_days × rate_per_day
```

### Priority 5: Annotations

```sql
CREATE TABLE annotations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    floor_plan_id   UUID NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    canvas_x        DECIMAL(6,2) NOT NULL,
    canvas_y        DECIMAL(6,2) NOT NULL,
    text            TEXT NOT NULL,
    created_by      UUID NOT NULL REFERENCES users(id),
    include_in_report BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_annotations_floor_plan ON annotations(floor_plan_id);

-- RLS tenant isolation
ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY annotations_tenant ON annotations
    USING (company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid);
```

### Priority 6: Sketch Versioning

```sql
CREATE TABLE floor_plan_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    floor_plan_id   UUID NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
    version_number  INTEGER NOT NULL,
    canvas_data     JSONB NOT NULL,
    change_summary  TEXT,  -- auto-generated: "Room added: Bathroom 2"
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(floor_plan_id, version_number)
);

CREATE INDEX idx_versions_floor_plan ON floor_plan_versions(floor_plan_id, version_number);
```

**Versioning strategy:** Only create snapshots on meaningful changes (room added/removed, wall modified, affected status changed). Skip minor position adjustments to avoid storage bloat — an active job with 50+ saves/day over 5 days would produce 250+ full JSONB snapshots otherwise.

---

## API Endpoints

### Properties (new)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/properties` | Member | Create property (auto-created on job creation) |
| GET | `/v1/properties/{id}` | Member | Get property |
| GET | `/v1/properties/{id}/floor-plans` | Member | List floor plans for property |
| PATCH | `/v1/properties/{id}` | Member | Update property |

### Floor Plans (modified — property-scoped)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/properties/{propertyId}/floor-plans` | Member | List floor plans (replaces job-scoped) |
| POST | `/v1/properties/{propertyId}/floor-plans` | Member | Create floor plan |
| PATCH | `/v1/properties/{propertyId}/floor-plans/{id}` | Member | Update floor plan (canvas_data save) |
| DELETE | `/v1/properties/{propertyId}/floor-plans/{id}` | Member | Delete floor plan |

**Backward compat:** Keep existing `/v1/jobs/{jobId}/floor-plans` as a read-only proxy that resolves `job.property_id` and queries property-level floor plans. Remove after frontend migration.

**Pydantic schema changes:**

```python
class FloorPlanCreate(BaseModel):
    floor_name: str = Field(default="Main Floor", max_length=50)
    # Frontend enforces: Basement | Main Floor | Upper Floor | Attic
    # No hard DB constraint — edge cases exist (Sub-Basement, 3rd Floor)
    canvas_data: dict | None = None

class FloorPlanResponse(BaseModel):
    id: UUID
    property_id: UUID                    # NEW — replaces job_id
    job_id: UUID | None = None           # DEPRECATED — keep during transition
    company_id: UUID
    floor_number: int
    floor_name: str
    canvas_data: dict | None
    thumbnail_url: str | None
    created_at: datetime
    updated_at: datetime
```

### Rooms (modified — new fields)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/jobs/{jobId}/rooms` | Member | Create room (add room_type, ceiling_type, material_flags, affected) |
| PATCH | `/v1/jobs/{jobId}/rooms/{id}` | Member | Update room (all new fields editable) |

**Pydantic schema changes:**

```python
class RoomCreate(BaseModel):
    room_name: str
    floor_plan_id: UUID | None = None
    length_ft: Decimal | None = None
    width_ft: Decimal | None = None
    height_ft: Decimal = Decimal("8.0")           # ceiling height
    room_type: str | None = None                    # NEW
    ceiling_type: str = "flat"                      # NEW
    material_flags: list[str] = []                  # NEW
    affected: bool = False                          # NEW
    water_category: str | None = None
    water_class: str | None = None
    dry_standard: Decimal | None = None
    equipment_air_movers: int = 0
    equipment_dehus: int = 0
```

### Equipment Placements (new)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/jobs/{jobId}/equipment-placements` | Member | List all placements (active + pulled) |
| POST | `/v1/jobs/{jobId}/equipment-placements` | Member | Place equipment (auto-stamps placed_at) |
| PATCH | `/v1/jobs/{jobId}/equipment-placements/{id}` | Member | Update placement |
| POST | `/v1/jobs/{jobId}/equipment-placements/{id}/pull` | Member | Pull equipment (auto-stamps pulled_at) |

```python
class EquipmentPlacementCreate(BaseModel):
    equipment_type: str  # "air_mover" | "dehumidifier" | "air_scrubber" | "hydroxyl_generator" | "heater"
    quantity: int = Field(default=1, ge=1)
    room_id: UUID | None = None          # auto-detected from canvas position, or explicit
    floor_plan_id: UUID | None = None
    canvas_x: Decimal | None = None
    canvas_y: Decimal | None = None
    notes: str | None = None

class EquipmentPlacementResponse(BaseModel):
    id: UUID
    job_id: UUID
    company_id: UUID
    room_id: UUID | None
    floor_plan_id: UUID | None
    equipment_type: str
    quantity: int
    canvas_x: Decimal | None
    canvas_y: Decimal | None
    placed_at: datetime
    pulled_at: datetime | None           # null = still active
    placed_by: UUID | None
    pulled_by: UUID | None
    duration_days: int | None            # computed: ceil((pulled_at - placed_at) / 1 day)
    notes: str | None
    created_at: datetime
```

### Moisture Readings (modified — pin coordinates)

Existing endpoints stay the same. Wire up existing `point_x`/`point_y` fields from architecture doc schema.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/jobs/{jobId}/rooms/{roomId}/readings` | Member | Create reading (add point_x, point_y for pin location) |

```python
# Add to existing MoisturePointCreate:
class MoisturePointCreate(BaseModel):
    location_name: str
    reading_value: Decimal
    material: str | None = None          # NEW — for dry standard lookup
    point_x: Decimal | None = None       # NEW — canvas pin X coordinate
    point_y: Decimal | None = None       # NEW — canvas pin Y coordinate
    meter_photo_url: str | None = None
```

### Annotations (new)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/floor-plans/{floorPlanId}/annotations` | Member | List annotations |
| POST | `/v1/floor-plans/{floorPlanId}/annotations` | Member | Create annotation |
| PATCH | `/v1/floor-plans/{floorPlanId}/annotations/{id}` | Member | Update annotation |
| DELETE | `/v1/floor-plans/{floorPlanId}/annotations/{id}` | Member | Delete annotation |

```python
class AnnotationCreate(BaseModel):
    canvas_x: Decimal
    canvas_y: Decimal
    text: str = Field(..., min_length=1, max_length=2000)
    include_in_report: bool = True

class AnnotationResponse(BaseModel):
    id: UUID
    job_id: UUID
    floor_plan_id: UUID
    company_id: UUID
    canvas_x: Decimal
    canvas_y: Decimal
    text: str
    created_by: UUID
    include_in_report: bool
    created_at: datetime
```

### Floor Plan Versions (new)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/floor-plans/{floorPlanId}/versions` | Member | List version history |
| GET | `/v1/floor-plans/{floorPlanId}/versions/{versionNumber}` | Member | Get specific version (read-only) |
| POST | `/v1/floor-plans/{floorPlanId}/versions/{versionNumber}/rollback` | Admin | Rollback to version |

```python
class FloorPlanVersionResponse(BaseModel):
    id: UUID
    floor_plan_id: UUID
    version_number: int
    canvas_data: dict
    change_summary: str | None       # auto-generated: "Room added: Bathroom 2"
    created_by: UUID
    created_at: datetime
```

---

## Canvas Data Model — Current vs. V2

### Current FloorPlanData (01C)

```typescript
interface FloorPlanData {
  gridSize: 20;                    // 20px = 1ft
  rooms: RoomData[];               // { id, x, y, width, height, name, fill, propertyRoomId? }
  walls: WallData[];               // { id, x1, y1, x2, y2, thickness, roomId? }
  doors: DoorData[];               // { id, wallId, position, width, swing }
  windows: WindowData[];           // { id, wallId, position, width }
}
```

### V2 FloorPlanData

```typescript
interface FloorPlanData {
  gridSize: 10;                     // 10px = 6 inches (CHANGED)
  rooms: RoomData[];
  walls: WallData[];
  doors: DoorData[];
  windows: WindowData[];
  openings: OpeningData[];          // NEW — missing wall pass-throughs
}

interface RoomData {
  id: string;
  // Phase 1A: rectangle
  x: number; y: number;
  width: number; height: number;
  // Phase 1B: polygon (replaces x/y/width/height)
  points?: Array<{ x: number; y: number }>;
  name: string;
  fill: string;
  propertyRoomId?: string;
  // NEW metadata (also stored in backend rooms table)
  roomType?: string;                // "kitchen", "bathroom", etc.
  ceilingHeight?: number;           // feet, default 8
  ceilingType?: string;             // "flat" | "vaulted" | "cathedral" | "sloped"
  affected?: boolean;               // mitigation scope flag
  materialFlags?: string[];         // ["carpet", "drywall", "paint"]
  floorOpenings?: Array<{           // stairwell cutouts
    id: string;
    x: number; y: number;
    width: number; height: number;
  }>;
}

interface WallData {
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
  thickness: number;
  roomId?: string;
  // NEW fields
  wallType?: "exterior" | "interior";   // drives Xactimate material codes
  affected?: boolean;                    // per-wall mitigation scope
  shared?: boolean;                      // auto-detected from room adjacency; renders lighter line weight
  wallHeight?: number;                   // inherits from room, can override
}

interface DoorData {
  id: string;
  wallId: string;
  position: number;                 // 0-1 parametric
  width: number;                    // feet
  swing: 0 | 1 | 2 | 3;
  height?: number;                  // NEW — default 7ft, for SF deduction
}

interface WindowData {
  id: string;
  wallId: string;
  position: number;
  width: number;
  height?: number;                  // NEW — default 4ft, for SF deduction
  sillHeight?: number;              // NEW — optional documentation field
}

// NEW type
interface OpeningData {
  id: string;
  wallId: string;
  position: number;                 // 0-1 parametric center
  width: number;                    // feet
  height: number;                   // defaults to wall height (full pass-through)
}
```

---

## SF Calculation Logic

### Floor SF

```typescript
function calculateFloorSF(room: RoomData): number {
  const grossSF = (room.width / gridSize) * (room.height / gridSize);
  // or for polygon: use shoelace formula on room.points
  const openingSF = (room.floorOpenings || [])
    .reduce((sum, o) => sum + (o.width / gridSize) * (o.height / gridSize), 0);
  return grossSF - openingSF;
}
```

### Wall SF

```typescript
const CEILING_MULTIPLIERS = { flat: 1.0, vaulted: 1.3, cathedral: 1.5, sloped: 1.2 };

function calculateWallSF(
  room: RoomData,
  walls: WallData[],
  doors: DoorData[],
  windows: WindowData[],
  openings: OpeningData[],
  gridSize: number
): number {
  // Step 1: Perimeter LF (exclude shared walls)
  const roomWalls = walls.filter(w => w.roomId === room.id && !w.shared);
  const perimeterLF = roomWalls.reduce((sum, w) => {
    const length = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) / gridSize;
    return sum + length;
  }, 0);

  // Step 2: Ceiling height
  const ceilingHeight = room.ceilingHeight || 8;

  // Step 3: Gross wall area
  const grossSF = perimeterLF * ceilingHeight;

  // Step 4: Opening deductions
  const allWallIds = new Set(roomWalls.map(w => w.id));
  const doorDeduct = doors
    .filter(d => allWallIds.has(d.wallId))
    .reduce((sum, d) => sum + d.width * (d.height || 7), 0);
  const windowDeduct = windows
    .filter(w => allWallIds.has(w.wallId))
    .reduce((sum, w) => sum + w.width * (w.height || 4), 0);
  const openingDeduct = openings
    .filter(o => allWallIds.has(o.wallId))
    .reduce((sum, o) => sum + o.width * o.height, 0);

  // Step 5: Net wall area with ceiling multiplier
  const netSF = grossSF - doorDeduct - windowDeduct - openingDeduct;
  const multiplier = CEILING_MULTIPLIERS[room.ceilingType || "flat"];
  return Math.round(netSF * multiplier * 10) / 10;
}
```

**Worked example — Kitchen 12×10, 8ft flat ceiling, one 3ft door, one 4ft window:**
```
Perimeter: 12 + 10 + 12 + 10 = 44 LF (no shared walls)
Gross: 44 × 8 = 352 SF
Door: 3 × 7 = 21 SF
Window: 4 × 4 = 16 SF
Net: 352 - 21 - 16 = 315 SF
Multiplier: flat = 1.0
Final: 315 SF
```

---

## Room Type → Material Defaults Mapping

When a room type is selected on the confirmation card, these material flags auto-populate:

| Room Type | Default Material Flags |
|-----------|----------------------|
| living_room | `["carpet", "drywall", "paint"]` or `["hardwood", "drywall", "paint"]` |
| kitchen | `["tile", "drywall", "paint", "backsplash"]` or `["vinyl", "drywall", "paint", "backsplash"]` |
| bathroom | `["tile", "drywall", "paint"]` |
| bedroom | `["carpet", "drywall", "paint"]` |
| basement | `["concrete", "drywall"]` or `["carpet", "block_wall"]` |
| hallway | `["carpet", "drywall", "paint"]` |
| laundry_room | `["tile", "drywall", "paint"]` or `["vinyl", "drywall", "paint"]` |
| garage | `["concrete"]` or `["concrete", "drywall"]` |
| dining_room | `["hardwood", "drywall", "paint"]` or `["carpet", "drywall", "paint"]` |
| office | `["carpet", "drywall", "paint"]` or `["hardwood", "drywall", "paint"]` |
| closet | `["carpet", "drywall"]` |
| utility_room | `["concrete", "drywall"]` or `["vinyl", "drywall"]` |
| other | `[]` (no defaults) |

Defaults are editable — tech can add/remove flags on the confirmation card.

**Note:** Rooms with multiple common floor types (e.g., kitchen = tile OR vinyl) present the first option as default. Tech can change via checkbox.

---

## Moisture Pin Color Logic

```typescript
// Brett's spec: red = "above dry standard by >10%", amber = "within 10% of dry standard"
// Interpretation: 10 percentage points above standard (not 10% of the standard value)
// e.g., drywall standard 16% → amber up to 26%, red above 26%
function pinColor(reading: number, dryStandard: number): "red" | "amber" | "green" {
  if (reading <= dryStandard) return "green";
  if (reading <= dryStandard + 10) return "amber";
  return "red";
}
```

**Note:** Brett's spec says ">10%" which is ambiguous — could mean 10 percentage points above standard, or 10% of the standard value. The 10-point interpretation is used here because the relative interpretation creates impractically narrow amber windows for low-standard materials (concrete at 5% would have a 0.5% amber window). Confirm interpretation during implementation.

**Regression detection:** If a reading value increases day-over-day at the same pin (e.g., Day 2 was 32%, Day 3 is 38%), the pin shows an amber warning icon regardless of its color status. This flags potential issues: new leak, equipment failure, or moisture migration from adjacent area. The regression flag is visual-only (no backend field needed) — computed by comparing the latest two readings for that pin location.

**Common dry standards by material type:**

| Material | Dry Standard |
|----------|-------------|
| Drywall | 16% |
| Wood subfloor | 15% |
| Carpet pad | 16% |
| Concrete | 5% |
| Hardwood | 12% |
| OSB / Plywood | 18% |

These are stored per-room on the `dry_standard` field. The tech can override for specific conditions.

---

## LiDAR — V2 Roadmap (Not in Scope)

LiDAR is explicitly V2. Not built now. But V1 data model must accommodate it.

**What LiDAR does:** Tech scans a room with iPhone Pro (Apple RoomPlan API, iOS 16+). Scan returns L × W × H. Values populate the same room confirmation card that manual input creates. Everything after — wall interactions, moisture pins, equipment, photos — is identical.

**Why V1 matters for V2:** If `RoomData` stores dimensions, ceiling height, wall segments, and openings correctly, LiDAR is just an alternative input method filling the same fields. The data model is input-agnostic.

**Evaluation candidates:**
- Apple RoomPlan API (free, iPhone Pro only, Swift-based)
- Locometric framework (cross-platform, licensed, includes Xactimate ESX export)

**Verisk ESX integration:** Requires formal Verisk Strategic Alliance partnership. ESX payload is encrypted — no reverse engineering path. Partnership is a longer-term strategic goal, not V1 or V2.

**What NOT to build:**
- No LiDAR scanning UI
- No RoomPlan API integration
- No 3D view
- No ESX export

---

## Data Storage Split

| Data | Where | Why |
|------|-------|-----|
| Room geometry (x, y, width, height, points) | canvas_data JSON | Visual rendering on canvas |
| Room metadata (type, ceiling, materials, affected) | Backend `rooms` table | Queried by estimating engine, reports, portal |
| Wall geometry (x1, y1, x2, y2, thickness) | canvas_data JSON | Visual rendering |
| Wall metadata (type, affected, shared, height) | canvas_data JSON | Visual-only; parse server-side if reports need it |
| Door/window/opening geometry + dimensions | canvas_data JSON | Visual rendering + SF calc (frontend) |
| Moisture pin readings | Backend `moisture_readings` table | Queried for readings page, trend charts, PDF export, portal |
| Equipment placements | Backend `equipment_placements` table | Queried for billing, duration tracking, reports |
| Photo metadata | Backend `photos` table | Queried for gallery, portal, category filtering |
| Annotations | Backend `annotations` table | Queried for reports, portal, include/exclude toggle |
| Sketch versions | Backend `floor_plan_versions` table | Queried for version history, rollback, audit trail |

**Rule:** If queried independently or has its own history → backend table. If purely visual rendering → canvas_data JSON.

---

## Open Questions

- **Wall data: JSON vs. backend table?** — Proposed: canvas_data JSON since walls aren't queried independently. If Xactimate export or PDF reports need per-wall breakdowns without parsing JSON, we'd need a `walls` table. Depends on which downstream systems consume wall-level data.

---

---

## NOT in Scope

- LiDAR integration (V2 roadmap — see above)
- Equipment icons on floor plan (beyond pins — full equipment library is Spec 04C)
- 3D view
- AI cleanup/straightening (Spec 02 territory)
- Multi-user real-time collaboration
- Verisk ESX export (requires Strategic Alliance partnership)
- Adjuster portal floor plan view (separate spec)
- Multi-device backup conflict resolution (flagged as M5 in 01C review, V1 acceptable with one tech per job)

---

*Created: 2026-04-15. Source: Brett's Sketch & Floor Plan Tool Product Design Specification v2.0 (April 13, 2026).*
