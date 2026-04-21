"""Shared domain constants for Spec 01H (Floor Plan V2).

Ceiling multipliers, room type material defaults, and valid enum sets
used by rooms service, walls service, and their Pydantic schemas.
"""

# Wall SF = perimeter LF * ceiling height * multiplier - opening deductions.
# Vaulted/cathedral/sloped ceilings add extra wall area above a flat ceiling.
# If a tech sets custom_wall_sf on a room, it overrides this calculation entirely.
CEILING_MULTIPLIERS: dict[str, float] = {
    "flat": 1.0,
    "vaulted": 1.3,
    "cathedral": 1.5,
    "sloped": 1.2,
}

# When a tech selects a room type, these materials auto-populate in the
# confirmation card. The tech can add/remove flags — these are just defaults.
# Source: Spec 01H "Room Type → Material Defaults" table.
ROOM_TYPE_MATERIAL_DEFAULTS: dict[str, list[str]] = {
    "living_room": ["carpet", "drywall", "paint"],
    "kitchen": ["tile", "drywall", "paint", "backsplash"],
    "bathroom": ["tile", "drywall", "paint"],
    "bedroom": ["carpet", "drywall", "paint"],
    "basement": ["concrete", "drywall"],
    "hallway": ["carpet", "drywall", "paint"],
    "laundry_room": ["tile", "drywall", "paint"],
    "garage": ["concrete"],
    "dining_room": ["hardwood", "drywall", "paint"],
    "office": ["carpet", "drywall", "paint"],
    "closet": ["carpet", "drywall"],
    "utility_room": ["concrete", "drywall"],
    "other": [],
}

# --- Valid enum sets (used for validation in schemas and services) ---

VALID_ROOM_TYPES: set[str] = set(ROOM_TYPE_MATERIAL_DEFAULTS.keys())

VALID_CEILING_TYPES: set[str] = set(CEILING_MULTIPLIERS.keys())

VALID_FLOOR_LEVELS: set[str] = {"basement", "main", "upper", "attic"}

VALID_WALL_TYPES: set[str] = {"exterior", "interior"}

VALID_OPENING_TYPES: set[str] = {"door", "window", "missing_wall"}

# --- Job lifecycle ---
#
# Jobs in these statuses are frozen: floor plan + room + wall data cannot be
# mutated. Only "collected" (payment received, file closed) is a true terminal
# state. "complete" means the tech finished field work but docs are still being
# assembled; "submitted" means the scope went to the carrier but resubmits are
# routine after rejection. Both must stay editable.
#
# Enforced by api.shared.guards.ensure_job_mutable at every write path that
# touches floor-plan-shaped data (floor_plans, job_rooms, wall_segments,
# wall_openings). Single source of truth so walls/rooms/floor_plans services
# agree on what "archived" means.
ARCHIVED_JOB_STATUSES: frozenset[str] = frozenset({"collected"})
