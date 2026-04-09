"""Seed the database with mock data matching the frontend mock-data.ts.

Run: cd backend && source .venv/bin/activate && python scripts/seed_mock_data.py

Uses direct psycopg2 (admin, bypasses RLS) since there's no authenticated user yet.
"""

import uuid
from datetime import UTC, datetime, timedelta

import psycopg2

# Load DATABASE_URL from .env
from dotenv import load_dotenv
import os

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

# ── Helpers ──────────────────────────────────────────────────────────
COMPANY_ID = "c0000000-0000-0000-0000-000000000001"
# Frontend mock uses j0000001-... but PostgreSQL UUIDs must start with hex chars (0-9, a-f)
# Map: j → 10, r → 20 to create valid UUIDs while keeping them recognizable
JOB_ID = lambda n: f"10000000-0000-0000-0000-{n:012d}"  # noqa: E731
ROOM_ID = lambda n: f"20000000-0000-0000-0000-{n:012d}"  # noqa: E731
now = datetime.now(UTC)


def days_ago(n):
    return (now - timedelta(days=n)).isoformat()


def date_str(n):
    return (now - timedelta(days=n)).strftime("%Y-%m-%d")


def new_uuid():
    return str(uuid.uuid4())


# ── Company ──────────────────────────────────────────────────────────
COMPANY = {
    "id": COMPANY_ID,
    "name": "Lansing Restoration Pros",
    "slug": "lansing-restoration-pros-demo",
    "phone": "(517) 555-0100",
    "email": "office@lansingrestorationpros.com",
    "address": "100 W Michigan Ave",
    "city": "Lansing",
    "state": "MI",
    "zip": "48933",
    "subscription_tier": "free",
}

# ── Jobs ─────────────────────────────────────────────────────────────
# Matches mockJobs from web/src/lib/mock-data.ts exactly
JOBS = [
    # 7 Mitigation jobs
    {
        "id": JOB_ID(1),
        "company_id": COMPANY_ID,
        "job_type": "mitigation",
        "job_number": "JOB-20260324-001",
        "address_line1": "123 Oak Street",
        "city": "Lansing", "state": "MI", "zip": "48912",
        "customer_name": "Jane Smith",
        "customer_phone": "(517) 555-0142",
        "customer_email": "jane.smith@email.com",
        "claim_number": "SF-2026-4521",
        "carrier": "State Farm",
        "adjuster_name": "Mike Johnson",
        "adjuster_phone": "(517) 555-0199",
        "adjuster_email": "mjohnson@statefarm.com",
        "loss_type": "water", "loss_category": "2", "loss_class": "2",
        "loss_cause": "Dishwasher supply line failure",
        "loss_date": date_str(3),
        "status": "mitigation",
        "tech_notes": "Lifted carpet and pad in master bedroom. Flood cut drywall 2ft from floor.",
        "latitude": 42.7325, "longitude": -84.5555,
        "created_at": days_ago(3), "updated_at": days_ago(0),
    },
    {
        "id": JOB_ID(2),
        "company_id": COMPANY_ID,
        "job_type": "mitigation",
        "job_number": "JOB-20260323-002",
        "address_line1": "842 Maple Avenue",
        "city": "Flint", "state": "MI", "zip": "48503",
        "customer_name": "Robert Chen",
        "customer_phone": "(810) 555-0234",
        "customer_email": "rchen@email.com",
        "claim_number": "ALT-2026-1198",
        "carrier": "Allstate",
        "adjuster_name": "Sarah Williams",
        "adjuster_phone": "(810) 555-0288",
        "adjuster_email": "swilliams@allstate.com",
        "loss_type": "water", "loss_category": "1", "loss_class": "2",
        "loss_cause": "Frozen pipe burst — second floor bathroom",
        "loss_date": date_str(5),
        "status": "drying",
        "latitude": 43.0125, "longitude": -83.6875,
        "created_at": days_ago(5), "updated_at": days_ago(1),
    },
    {
        "id": JOB_ID(3),
        "company_id": COMPANY_ID,
        "job_type": "mitigation",
        "job_number": "JOB-20260321-003",
        "address_line1": "519 Pine Ridge Drive",
        "city": "Ann Arbor", "state": "MI", "zip": "48104",
        "customer_name": "Maria Garcia",
        "customer_phone": "(734) 555-0567",
        "customer_email": "mgarcia@email.com",
        "claim_number": "PROG-2026-7744",
        "carrier": "Progressive",
        "adjuster_name": "Tom Davis",
        "adjuster_phone": "(734) 555-0600",
        "adjuster_email": "tdavis@progressive.com",
        "loss_type": "water", "loss_category": "3", "loss_class": "3",
        "loss_cause": "Sewer backup in basement",
        "loss_date": date_str(5),
        "status": "submitted",
        "tech_notes": "Category 3 — full PPE required. Extracted standing water with truck mount.",
        "latitude": 42.2808, "longitude": -83.7430,
        "created_at": days_ago(5), "updated_at": days_ago(0),
    },
    {
        "id": JOB_ID(4),
        "company_id": COMPANY_ID,
        "job_type": "mitigation",
        "job_number": "JOB-20260326-004",
        "address_line1": "202 Cedar Way",
        "city": "Detroit", "state": "MI", "zip": "48226",
        "customer_name": "David Kim",
        "customer_phone": "(313) 555-0891",
        "customer_email": "dkim@email.com",
        "carrier": "USAA",
        "loss_type": "water", "loss_category": "2", "loss_class": "1",
        "loss_cause": "Water heater leak",
        "loss_date": date_str(2),
        "status": "new",
        "latitude": 42.3314, "longitude": -83.0458,
        "created_at": days_ago(2), "updated_at": days_ago(0),
    },
    {
        "id": JOB_ID(5),
        "company_id": COMPANY_ID,
        "job_type": "mitigation",
        "job_number": "JOB-20260320-005",
        "address_line1": "315 Elm Boulevard",
        "city": "Lansing", "state": "MI", "zip": "48910",
        "customer_name": "Lisa Thompson",
        "customer_phone": "(517) 555-0345",
        "customer_email": "lthompson@email.com",
        "claim_number": "SF-2026-3890",
        "carrier": "State Farm",
        "adjuster_name": "Amy Brown",
        "adjuster_phone": "(517) 555-0401",
        "adjuster_email": "abrown@statefarm.com",
        "loss_type": "water", "loss_category": "1", "loss_class": "1",
        "loss_cause": "Ice dam roof leak",
        "loss_date": date_str(6),
        "status": "drying",
        "tech_notes": "Minor attic leak. Affected ceiling drywall in master bedroom and hallway.",
        "latitude": 42.7195, "longitude": -84.5475,
        "created_at": days_ago(6), "updated_at": days_ago(1),
    },
    {
        "id": JOB_ID(6),
        "company_id": COMPANY_ID,
        "job_type": "mitigation",
        "job_number": "JOB-20260319-006",
        "address_line1": "777 Birch Lane",
        "city": "East Lansing", "state": "MI", "zip": "48823",
        "customer_name": "Paul Anderson",
        "customer_phone": "(517) 555-0678",
        "customer_email": "panderson@email.com",
        "claim_number": "ERIE-2026-5521",
        "carrier": "Erie Insurance",
        "adjuster_name": "Chris Lee",
        "adjuster_phone": "(517) 555-0700",
        "adjuster_email": "clee@erieinsurance.com",
        "loss_type": "water", "loss_category": "2", "loss_class": "2",
        "loss_cause": "Washing machine overflow",
        "loss_date": date_str(7),
        "status": "drying",
        "latitude": 42.7369, "longitude": -84.4839,
        "created_at": days_ago(7), "updated_at": days_ago(2),
    },
    {
        "id": JOB_ID(7),
        "company_id": COMPANY_ID,
        "job_type": "mitigation",
        "job_number": "JOB-20260326-007",
        "address_line1": "450 Walnut Court",
        "city": "Lansing", "state": "MI", "zip": "48911",
        "customer_name": "Tom Reynolds",
        "customer_phone": "(517) 555-0999",
        "customer_email": "treynolds@email.com",
        "carrier": "Farmers Insurance",
        "loss_type": "water", "loss_category": "3",
        "loss_cause": "Toilet overflow — commercial property",
        "loss_date": date_str(0),
        "status": "new",
        "notes": "Emergency call — dispatched immediately",
        "latitude": 42.7085, "longitude": -84.5655,
        "created_at": days_ago(0), "updated_at": days_ago(0),
    },
    # 5 Reconstruction jobs
    {
        "id": JOB_ID(8),
        "company_id": COMPANY_ID,
        "job_type": "reconstruction",
        "linked_job_id": JOB_ID(3),
        "job_number": "JOB-20260401-008",
        "address_line1": "519 Pine Ridge Drive",
        "city": "Ann Arbor", "state": "MI", "zip": "48104",
        "customer_name": "Maria Garcia",
        "customer_phone": "(734) 555-0567",
        "customer_email": "mgarcia@email.com",
        "claim_number": "PROG-2026-7744",
        "carrier": "Progressive",
        "adjuster_name": "Tom Davis",
        "adjuster_phone": "(734) 555-0600",
        "adjuster_email": "tdavis@progressive.com",
        "loss_type": "water",
        "loss_cause": "Sewer backup in basement — reconstruction after mitigation",
        "loss_date": date_str(5),
        "status": "in_progress",
        "notes": "Linked to mitigation JOB-003. Demo complete, rough-in underway.",
        "latitude": 42.2808, "longitude": -83.7430,
        "created_at": days_ago(2), "updated_at": days_ago(0),
    },
    {
        "id": JOB_ID(9),
        "company_id": COMPANY_ID,
        "job_type": "reconstruction",
        "job_number": "JOB-20260403-009",
        "address_line1": "1200 Grand River Ave",
        "city": "East Lansing", "state": "MI", "zip": "48823",
        "customer_name": "Kathy Nguyen",
        "customer_phone": "(517) 555-0412",
        "customer_email": "knguyen@email.com",
        "claim_number": "TRAV-2026-8821",
        "carrier": "Travelers",
        "adjuster_name": "Derek Hall",
        "adjuster_phone": "(517) 555-0455",
        "adjuster_email": "dhall@travelers.com",
        "loss_type": "fire",
        "loss_cause": "Kitchen fire — rebuild required",
        "loss_date": date_str(14),
        "status": "scoping",
        "notes": "Insurance-referred standalone reconstruction.",
        "latitude": 42.7369, "longitude": -84.4839,
        "created_at": days_ago(4), "updated_at": days_ago(1),
    },
    {
        "id": JOB_ID(10),
        "company_id": COMPANY_ID,
        "job_type": "reconstruction",
        "job_number": "JOB-20260405-010",
        "address_line1": "88 Washtenaw Ave",
        "city": "Ypsilanti", "state": "MI", "zip": "48197",
        "customer_name": "Derek Lawson",
        "customer_phone": "(734) 555-0811",
        "customer_email": "dlawson@email.com",
        "claim_number": "USAA-2026-4410",
        "carrier": "USAA",
        "adjuster_name": "Robin Patel",
        "adjuster_phone": "(734) 555-0822",
        "adjuster_email": "rpatel@usaa.com",
        "loss_type": "water",
        "loss_cause": "Basement flood — full rebuild after mitigation",
        "loss_date": date_str(20),
        "status": "new",
        "notes": "Waiting on insurance approval to begin.",
        "latitude": 42.2411, "longitude": -83.6130,
        "created_at": days_ago(1), "updated_at": days_ago(0),
    },
    {
        "id": JOB_ID(11),
        "company_id": COMPANY_ID,
        "job_type": "reconstruction",
        "linked_job_id": JOB_ID(5),
        "job_number": "JOB-20260406-011",
        "address_line1": "315 Elm Boulevard",
        "city": "Lansing", "state": "MI", "zip": "48910",
        "customer_name": "Lisa Thompson",
        "customer_phone": "(517) 555-0345",
        "customer_email": "lthompson@email.com",
        "claim_number": "SF-2026-3890",
        "carrier": "State Farm",
        "adjuster_name": "Amy Brown",
        "adjuster_phone": "(517) 555-0401",
        "adjuster_email": "abrown@statefarm.com",
        "loss_type": "water",
        "loss_cause": "Ice dam roof leak — ceiling and wall rebuild",
        "loss_date": date_str(6),
        "status": "complete",
        "notes": "Reconstruction complete, generating final report.",
        "tech_notes": "All drywall, paint, and insulation replaced.",
        "latitude": 42.7195, "longitude": -84.5475,
        "created_at": days_ago(10), "updated_at": days_ago(0),
    },
    {
        "id": JOB_ID(12),
        "company_id": COMPANY_ID,
        "job_type": "reconstruction",
        "job_number": "JOB-20260402-012",
        "address_line1": "2100 Michigan Ave",
        "city": "Dearborn", "state": "MI", "zip": "48124",
        "customer_name": "Frank Morales",
        "customer_phone": "(313) 555-0277",
        "customer_email": "fmorales@email.com",
        "claim_number": "TRAV-2026-9102",
        "carrier": "Travelers",
        "adjuster_name": "Linda Chen",
        "adjuster_phone": "(313) 555-0290",
        "adjuster_email": "lchen@travelers.com",
        "loss_type": "fire",
        "loss_cause": "Electrical fire in garage — partial rebuild",
        "loss_date": date_str(30),
        "status": "in_progress",
        "notes": "Framing and electrical rough-in complete. Drywall phase starting.",
        "latitude": 42.3223, "longitude": -83.1763,
        "created_at": days_ago(8), "updated_at": days_ago(1),
    },
]

# ── Rooms ────────────────────────────────────────────────────────────
ROOMS = [
    # Job 1: 123 Oak Street (3 rooms)
    {"id": ROOM_ID(1), "job_id": JOBS[0]["id"], "company_id": COMPANY_ID, "room_name": "Master Bedroom", "length_ft": 10.5, "width_ft": 15, "height_ft": 8, "square_footage": 157.5, "water_category": "2", "water_class": "2", "dry_standard": 16, "equipment_air_movers": 3, "equipment_dehus": 1, "notes": "Carpet and pad removed. Flood cut 2ft.", "sort_order": 0},
    {"id": ROOM_ID(2), "job_id": JOBS[0]["id"], "company_id": COMPANY_ID, "room_name": "Kitchen", "length_ft": 12, "width_ft": 9, "height_ft": 8, "square_footage": 108, "water_category": "2", "water_class": "2", "dry_standard": 16, "equipment_air_movers": 2, "equipment_dehus": 1, "notes": "Source room — dishwasher supply line.", "sort_order": 1},
    {"id": ROOM_ID(3), "job_id": JOBS[0]["id"], "company_id": COMPANY_ID, "room_name": "Hallway", "length_ft": 3, "width_ft": 12, "height_ft": 8, "square_footage": 36, "water_category": "2", "water_class": "1", "dry_standard": 16, "equipment_air_movers": 1, "equipment_dehus": 0, "sort_order": 2},
    # Job 2: 842 Maple Avenue (5 rooms)
    {"id": ROOM_ID(4), "job_id": JOBS[1]["id"], "company_id": COMPANY_ID, "room_name": "Bathroom", "length_ft": 8, "width_ft": 6, "height_ft": 8, "square_footage": 48, "water_category": "1", "water_class": "2", "dry_standard": 14, "equipment_air_movers": 2, "equipment_dehus": 1, "notes": "Source room — pipe burst behind vanity wall.", "sort_order": 0},
    {"id": ROOM_ID(5), "job_id": JOBS[1]["id"], "company_id": COMPANY_ID, "room_name": "Hallway", "length_ft": 4, "width_ft": 10, "height_ft": 8, "square_footage": 40, "water_category": "1", "water_class": "1", "dry_standard": 14, "equipment_air_movers": 1, "equipment_dehus": 0, "sort_order": 1},
    {"id": ROOM_ID(6), "job_id": JOBS[1]["id"], "company_id": COMPANY_ID, "room_name": "Laundry Room", "length_ft": 6, "width_ft": 6, "height_ft": 8, "square_footage": 36, "water_category": "1", "water_class": "1", "dry_standard": 14, "equipment_air_movers": 1, "equipment_dehus": 0, "sort_order": 2},
    {"id": ROOM_ID(7), "job_id": JOBS[1]["id"], "company_id": COMPANY_ID, "room_name": "Living Room", "length_ft": 18, "width_ft": 14, "height_ft": 8, "square_footage": 252, "water_category": "1", "water_class": "2", "dry_standard": 14, "equipment_air_movers": 3, "equipment_dehus": 1, "sort_order": 3},
    {"id": ROOM_ID(8), "job_id": JOBS[1]["id"], "company_id": COMPANY_ID, "room_name": "Basement", "length_ft": 20, "width_ft": 24, "height_ft": 7, "square_footage": 480, "water_category": "1", "water_class": "2", "dry_standard": 14, "equipment_air_movers": 4, "equipment_dehus": 2, "notes": "Finished basement — carpet removed.", "sort_order": 4},
    # Job 3: 519 Pine Ridge Drive (2 rooms)
    {"id": ROOM_ID(9), "job_id": JOBS[2]["id"], "company_id": COMPANY_ID, "room_name": "Basement", "length_ft": 22, "width_ft": 18, "height_ft": 7, "square_footage": 396, "water_category": "3", "water_class": "3", "dry_standard": 14, "equipment_air_movers": 5, "equipment_dehus": 2, "notes": "Cat 3 — full demo required.", "sort_order": 0},
    {"id": ROOM_ID(10), "job_id": JOBS[2]["id"], "company_id": COMPANY_ID, "room_name": "Utility Room", "length_ft": 8, "width_ft": 10, "height_ft": 7, "square_footage": 80, "water_category": "3", "water_class": "2", "dry_standard": 14, "equipment_air_movers": 2, "equipment_dehus": 1, "sort_order": 1},
    # Job 4: 202 Cedar Way (1 room)
    {"id": ROOM_ID(11), "job_id": JOBS[3]["id"], "company_id": COMPANY_ID, "room_name": "Garage", "length_ft": 20, "width_ft": 20, "height_ft": 9, "square_footage": 400, "water_category": "2", "water_class": "1", "dry_standard": 14, "equipment_air_movers": 2, "equipment_dehus": 1, "sort_order": 0},
    # Job 5: 315 Elm Boulevard (2 rooms)
    {"id": ROOM_ID(12), "job_id": JOBS[4]["id"], "company_id": COMPANY_ID, "room_name": "Master Bedroom", "length_ft": 14, "width_ft": 12, "height_ft": 8, "square_footage": 168, "water_category": "1", "water_class": "1", "dry_standard": 14, "equipment_air_movers": 1, "equipment_dehus": 1, "sort_order": 0},
    {"id": ROOM_ID(13), "job_id": JOBS[4]["id"], "company_id": COMPANY_ID, "room_name": "Hallway", "length_ft": 4, "width_ft": 8, "height_ft": 8, "square_footage": 32, "water_category": "1", "water_class": "1", "dry_standard": 14, "equipment_air_movers": 1, "equipment_dehus": 0, "sort_order": 1},
    # Job 6: 777 Birch Lane (3 rooms)
    {"id": ROOM_ID(14), "job_id": JOBS[5]["id"], "company_id": COMPANY_ID, "room_name": "Laundry Room", "length_ft": 6, "width_ft": 8, "height_ft": 8, "square_footage": 48, "water_category": "2", "water_class": "2", "dry_standard": 16, "equipment_air_movers": 2, "equipment_dehus": 1, "notes": "Source room — washing machine.", "sort_order": 0},
    {"id": ROOM_ID(15), "job_id": JOBS[5]["id"], "company_id": COMPANY_ID, "room_name": "Kitchen", "length_ft": 14, "width_ft": 10, "height_ft": 8, "square_footage": 140, "water_category": "2", "water_class": "1", "dry_standard": 16, "equipment_air_movers": 2, "equipment_dehus": 0, "sort_order": 1},
    {"id": ROOM_ID(16), "job_id": JOBS[5]["id"], "company_id": COMPANY_ID, "room_name": "Basement", "length_ft": 16, "width_ft": 20, "height_ft": 7, "square_footage": 320, "water_category": "2", "water_class": "2", "dry_standard": 16, "equipment_air_movers": 3, "equipment_dehus": 1, "sort_order": 2},
]

# ── Recon Phases ─────────────────────────────────────────────────────
PHASES = [
    # Job 8: in_progress — demo done, rough-in active
    {"job_id": JOBS[7]["id"], "company_id": COMPANY_ID, "phase_name": "Demo", "status": "complete", "sort_order": 0, "started_at": days_ago(2), "completed_at": days_ago(1), "notes": "All affected drywall and flooring removed"},
    {"job_id": JOBS[7]["id"], "company_id": COMPANY_ID, "phase_name": "Rough-in", "status": "in_progress", "sort_order": 1, "started_at": days_ago(1), "notes": "Electrical and plumbing rough-in underway"},
    {"job_id": JOBS[7]["id"], "company_id": COMPANY_ID, "phase_name": "Drywall", "status": "pending", "sort_order": 2},
    {"job_id": JOBS[7]["id"], "company_id": COMPANY_ID, "phase_name": "Paint", "status": "pending", "sort_order": 3},
    {"job_id": JOBS[7]["id"], "company_id": COMPANY_ID, "phase_name": "Flooring", "status": "pending", "sort_order": 4},
    {"job_id": JOBS[7]["id"], "company_id": COMPANY_ID, "phase_name": "Trim & Finish", "status": "pending", "sort_order": 5},
    {"job_id": JOBS[7]["id"], "company_id": COMPANY_ID, "phase_name": "Final Inspection", "status": "pending", "sort_order": 6},
    # Job 9: scoping — all phases pending
    {"job_id": JOBS[8]["id"], "company_id": COMPANY_ID, "phase_name": "Demo", "status": "pending", "sort_order": 0},
    {"job_id": JOBS[8]["id"], "company_id": COMPANY_ID, "phase_name": "Rough-in", "status": "pending", "sort_order": 1},
    {"job_id": JOBS[8]["id"], "company_id": COMPANY_ID, "phase_name": "Drywall", "status": "pending", "sort_order": 2},
    {"job_id": JOBS[8]["id"], "company_id": COMPANY_ID, "phase_name": "Paint", "status": "pending", "sort_order": 3},
    {"job_id": JOBS[8]["id"], "company_id": COMPANY_ID, "phase_name": "Flooring", "status": "pending", "sort_order": 4},
    {"job_id": JOBS[8]["id"], "company_id": COMPANY_ID, "phase_name": "Trim & Finish", "status": "pending", "sort_order": 5},
    {"job_id": JOBS[8]["id"], "company_id": COMPANY_ID, "phase_name": "Final Inspection", "status": "pending", "sort_order": 6},
    # Job 11: complete — all phases complete
    {"job_id": JOBS[10]["id"], "company_id": COMPANY_ID, "phase_name": "Drywall", "status": "complete", "sort_order": 0, "started_at": days_ago(9), "completed_at": days_ago(5)},
    {"job_id": JOBS[10]["id"], "company_id": COMPANY_ID, "phase_name": "Paint", "status": "complete", "sort_order": 1, "started_at": days_ago(5), "completed_at": days_ago(3)},
    {"job_id": JOBS[10]["id"], "company_id": COMPANY_ID, "phase_name": "Insulation", "status": "complete", "sort_order": 2, "started_at": days_ago(3), "completed_at": days_ago(1)},
    # Job 12: in_progress — framing done, drywall starting
    {"job_id": JOBS[11]["id"], "company_id": COMPANY_ID, "phase_name": "Demo & Cleanup", "status": "complete", "sort_order": 0, "started_at": days_ago(7), "completed_at": days_ago(5)},
    {"job_id": JOBS[11]["id"], "company_id": COMPANY_ID, "phase_name": "Framing", "status": "complete", "sort_order": 1, "started_at": days_ago(5), "completed_at": days_ago(3)},
    {"job_id": JOBS[11]["id"], "company_id": COMPANY_ID, "phase_name": "Electrical Rough-in", "status": "complete", "sort_order": 2, "started_at": days_ago(4), "completed_at": days_ago(2)},
    {"job_id": JOBS[11]["id"], "company_id": COMPANY_ID, "phase_name": "Drywall", "status": "in_progress", "sort_order": 3, "started_at": days_ago(1)},
    {"job_id": JOBS[11]["id"], "company_id": COMPANY_ID, "phase_name": "Paint", "status": "pending", "sort_order": 4},
    {"job_id": JOBS[11]["id"], "company_id": COMPANY_ID, "phase_name": "Garage Door", "status": "pending", "sort_order": 5},
]


def seed():
    print(f"Connecting to database...")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    try:
        # 1. Insert company
        print("Seeding company...")
        cur.execute("""
            INSERT INTO companies (id, name, slug, phone, email, address, city, state, zip, subscription_tier)
            VALUES (%(id)s, %(name)s, %(slug)s, %(phone)s, %(email)s, %(address)s, %(city)s, %(state)s, %(zip)s, %(subscription_tier)s)
            ON CONFLICT (id) DO NOTHING
        """, COMPANY)

        # 2. Insert jobs (mitigation first, then reconstruction — FK order matters)
        print(f"Seeding {len(JOBS)} jobs...")
        for job in JOBS:
            cols = list(job.keys())
            vals = [job[c] for c in cols]
            placeholders = ", ".join(["%s"] * len(cols))
            col_names = ", ".join(cols)
            cur.execute(
                f"INSERT INTO jobs ({col_names}) VALUES ({placeholders}) ON CONFLICT (id) DO NOTHING",
                vals,
            )

        # 3. Insert rooms
        print(f"Seeding {len(ROOMS)} rooms...")
        for room in ROOMS:
            cols = list(room.keys())
            vals = [room[c] for c in cols]
            placeholders = ", ".join(["%s"] * len(cols))
            col_names = ", ".join(cols)
            cur.execute(
                f"INSERT INTO job_rooms ({col_names}) VALUES ({placeholders}) ON CONFLICT (id) DO NOTHING",
                vals,
            )

        # 4. Insert recon phases
        print(f"Seeding {len(PHASES)} recon phases...")
        for phase in PHASES:
            phase_with_id = {"id": new_uuid(), **phase}
            cols = list(phase_with_id.keys())
            vals = [phase_with_id[c] for c in cols]
            placeholders = ", ".join(["%s"] * len(cols))
            col_names = ", ".join(cols)
            cur.execute(
                f"INSERT INTO recon_phases ({col_names}) VALUES ({placeholders})",
                vals,
            )

        conn.commit()
        print("\nDone! Seeded:")
        print(f"  1 company: {COMPANY['name']}")
        print(f"  {len(JOBS)} jobs (7 mitigation + 5 reconstruction)")
        print(f"  {len(ROOMS)} rooms")
        print(f"  {len(PHASES)} recon phases")
        print("\nCheck your Supabase Table Editor to see the data!")

    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    seed()
