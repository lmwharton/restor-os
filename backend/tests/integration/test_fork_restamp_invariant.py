"""Integration test: fork-time re-stamp invariant (lesson #29).

Locks in the cross-table invariant for Phase 3 Step 3's permanent fix in
migration ``e7b9c2f4a8d6``: every relational table that stamps
``floor_plan_id`` for a job-scoped row MUST be re-stamped inside
``save_floor_plan_version`` when that job forks a new version. Missing any
single UPDATE statement regresses the stale-stamp drift that put every
moisture pin into the orphan bucket before this fix landed.

Why introspection beats text-scan here: the migration-file text-scan
(``test_migration_restamp_rooms_pins_on_fork.py``) pins the SQL literal in
e7b9c2f4a8d6. This test asserts what's **actually installed in Postgres**,
so a LATER migration that CREATE OR REPLACEs ``save_floor_plan_version``
without carrying forward the UPDATE statements trips this test — even
though the prior migration file still has the right content. That's the
sibling-miss class the file-scan can't catch.

Extension rule: when a new spec adds a ``floor_plan_id`` column to a
job-scoped relational table (Phase 3 equipment expansion, Phase 5
annotations, future stamped-location tables), append that table's
expected UPDATE fragment to ``EXPECTED_RESTAMP_TABLES``. The test will
then require the fork RPC to maintain that stamp in sync on fork — the
single place that enumerates the "full set of downstream stamps" the
versioning state machine must keep consistent.
"""

from __future__ import annotations

import os
from pathlib import Path

import psycopg2
import pytest
from dotenv import dotenv_values

pytestmark = [pytest.mark.integration]


def _resolve_database_url() -> str | None:
    """DATABASE_URL lookup with .env fallback.

    Alembic loads .env via ``alembic/env.py``; pytest's default environment
    does not. Without this fallback, the test self-skips even when the
    developer has a perfectly usable DB configured in .env, which buries
    the guardrail this test is supposed to provide. Env var wins if both
    are set so CI can override.
    """
    env_url = os.environ.get("DATABASE_URL")
    if env_url:
        return env_url
    backend_dir = Path(__file__).resolve().parents[2]
    env_path = backend_dir / ".env"
    if env_path.exists():
        return dotenv_values(env_path).get("DATABASE_URL")
    return None


# Each entry names a table and the load-bearing fragments that must appear
# in the installed ``save_floor_plan_version`` body. The fragments are
# chosen to pin BOTH the UPDATE target AND the scoping filters — a rewrite
# that drops ``AND jr.job_id = p_job_id`` would silently re-stamp sibling
# jobs' rooms too, violating frozen-version semantics (Phase 1 rule:
# another job's pin only moves when THAT job saves).
EXPECTED_RESTAMP_TABLES: list[dict[str, list[str]]] = [
    {
        "table": "job_rooms",
        "fragments": [
            "UPDATE job_rooms jr",
            "SET floor_plan_id = v_new_row.id",
            "AND jr.job_id = p_job_id",
            "AND fp.property_id = p_property_id",
            "AND fp.floor_number = p_floor_number",
        ],
    },
    {
        "table": "moisture_pins",
        "fragments": [
            "UPDATE moisture_pins mp",
            "AND mp.job_id = p_job_id",
            "AND fp.property_id = p_property_id",
            "AND fp.floor_number = p_floor_number",
        ],
    },
    # PR-B Step 8 extension — equipment_placements.floor_plan_id is now
    # the third stamped column maintained by the fork RPC. Dropping this
    # UPDATE in a later migration would regress to the same drift we
    # saw for moisture pins before PR-A's permanent fix landed.
    {
        "table": "equipment_placements",
        "fragments": [
            "UPDATE equipment_placements ep",
            "AND ep.job_id = p_job_id",
            "AND fp.property_id = p_property_id",
            "AND fp.floor_number = p_floor_number",
        ],
    },
    # NB: ``moisture_pins.wall_segment_id`` was originally added here by
    # Phase 2 location-split (e2b3c4d5f6a7) and REMOVED by e5f6a7b8c9d0
    # after Gemini cross-review found the UPDATE was a no-op inside
    # save_floor_plan_version. The re-stamp lives inside
    # restore_floor_plan_relational_snapshot now (where new wall ids
    # exist by the time the UPDATE runs). The runtime invariant is
    # pinned by tests/integration/test_wall_segment_restamp_on_snapshot_restore.py —
    # that test asserts the post-condition end-to-end against a real DB,
    # which is the only correct tool for this class of invariant
    # (text-scan green-lit the misplaced UPDATE statement and missed
    # the structural defect — lesson #12).
]


def _db_reachable() -> bool:
    """Probe DATABASE_URL without raising — lets the test self-skip when
    the dev DB isn't running (CI default)."""
    url = _resolve_database_url()
    if not url:
        return False
    try:
        conn = psycopg2.connect(url, connect_timeout=2)
        conn.close()
        return True
    except Exception:
        return False


@pytest.fixture(scope="module")
def installed_rpc_body() -> str:
    """Read the currently-installed ``save_floor_plan_version`` body from
    ``pg_proc``. Skips if the DB isn't reachable."""
    if not _db_reachable():
        pytest.skip("DATABASE_URL not reachable — skipping integration test")
    url = _resolve_database_url()
    assert url is not None  # guarded by _db_reachable above
    conn = psycopg2.connect(url)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT pg_get_functiondef(oid) FROM pg_proc "
            "WHERE proname = 'save_floor_plan_version'"
        )
        row = cur.fetchone()
        assert row is not None, "save_floor_plan_version RPC missing from DB"
        return row[0]
    finally:
        conn.close()


@pytest.mark.parametrize(
    "entry",
    EXPECTED_RESTAMP_TABLES,
    ids=lambda e: e["table"],
)
def test_fork_rpc_restamps_downstream_table(
    installed_rpc_body: str, entry: dict[str, list[str]]
) -> None:
    """The installed ``save_floor_plan_version`` body must contain each
    declared UPDATE fragment, scoped to the caller job + this floor."""
    missing = [f for f in entry["fragments"] if f not in installed_rpc_body]
    assert not missing, (
        f"Fork RPC is missing re-stamp logic for {entry['table']}. "
        f"Expected fragments not found in installed body: {missing}. "
        "See docs/pr-review-lessons.md lesson #29 for the invariant + "
        "the rule for extending this test."
    )


def test_fork_rpc_still_derives_tenant_from_jwt(installed_rpc_body: str) -> None:
    """Regression pin for lesson §3 / C4 — SECURITY DEFINER RPCs must
    derive tenant from the JWT, never trust the caller-supplied
    p_company_id alone. Paired with this test because the re-stamp
    fix rewrote the RPC body; make sure it didn't accidentally drop
    the tenant-match check."""
    assert "v_caller_company := get_my_company_id()" in installed_rpc_body
    assert "v_caller_company <> p_company_id" in installed_rpc_body


def test_fork_rpc_pins_search_path(installed_rpc_body: str) -> None:
    """Regression pin for lesson §3 — every SECURITY DEFINER function
    must pin search_path to prevent the Phase 1 R3 hijack surface."""
    assert "SET search_path" in installed_rpc_body
    # Must include pg_catalog first so overridden operators can't redirect.
    assert "pg_catalog" in installed_rpc_body
