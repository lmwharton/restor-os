"""One-off seed for testing Spec 01H Phase 2 Block 3B (history + sparkline).

Inserts 5 back-dated moisture readings for a pin so the reading sheet
shows a populated history without waiting days of real logging.
Idempotent: re-running overwrites values on the same
(pin_id, reading_date) instead of erroring.

Run:
  cd backend && source .venv/bin/activate
  python scripts/seed_moisture_history.py <PIN_ID>

Find the pin id by opening DevTools → Network, tapping the pin, and
copying the id from the /moisture-pins response (or from the PATCH URL
when you drag it).
"""

import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise SystemExit("DATABASE_URL not set in backend/.env")

if len(sys.argv) != 2:
    raise SystemExit("Usage: python scripts/seed_moisture_history.py <PIN_ID>")
PIN_ID = sys.argv[1]

# (days_ago, reading_value). Drying arc with a deliberate bump at Day 4
# so the history list shows the ↑ up chevron on one row and the
# sparkline shows a visible uptick.
SEED = [
    (5, 38.0),  # Day 1 — baseline wet
    (4, 34.0),  # Day 2 — trending down
    (3, 25.0),  # Day 3 — still red above a 16% std
    (2, 29.0),  # Day 4 — BUMP (regression chevron)
    (1, 19.0),  # Day 5 — amber (within 10 of 16%)
]

conn = psycopg2.connect(DATABASE_URL)
try:
    with conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT mp.id, j.company_id, mp.material, mp.dry_standard
            FROM moisture_pins mp
            JOIN jobs j ON j.id = mp.job_id
            WHERE mp.id = %s
            """,
            (PIN_ID,),
        )
        row = cur.fetchone()
        if row is None:
            raise SystemExit(f"Pin {PIN_ID} not found")
        _, company_id, material, dry_standard = row
        print(
            f"Pin: {PIN_ID}\n  material={material}  dry_standard={dry_standard}%\n  company_id={company_id}"
        )

        for days_ago, value in SEED:
            cur.execute(
                """
                INSERT INTO moisture_pin_readings
                    (pin_id, company_id, reading_value, reading_date)
                VALUES (%s, %s, %s, CURRENT_DATE - %s)
                ON CONFLICT (pin_id, reading_date)
                DO UPDATE SET reading_value = EXCLUDED.reading_value
                RETURNING reading_date, reading_value
                """,
                (PIN_ID, company_id, value, days_ago),
            )
            rd, rv = cur.fetchone()
            print(f"  upserted {rd} → {rv}")

        cur.execute(
            """
            SELECT reading_date, reading_value
            FROM moisture_pin_readings
            WHERE pin_id = %s
            ORDER BY reading_date
            """,
            (PIN_ID,),
        )
        print("\nAll readings for this pin:")
        for rd, rv in cur.fetchall():
            print(f"  {rd}  {rv}%")
finally:
    conn.close()
