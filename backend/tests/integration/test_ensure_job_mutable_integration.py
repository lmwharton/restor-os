"""Integration test for PR-B Step 1 — ensure_job_mutable plpgsql twin.

Runtime verification against the dev DB. Text-scan in
``test_migration_equipment_ensure_job_mutable.py`` pins the source
literal; this file exercises each branch of the function body:

  1. Happy path — active job in caller tenant → no raise, no return.
  2. Not found — bogus UUID → P0002.
  3. Cross-tenant — real UUID but wrong company_id JWT → P0002.
  4. Soft-deleted — deleted_at set → P0002.
  5. Archived — status='collected' → 42501.
  6. NULL param → 22023.

Each test sets up an auth context via ``set_config('request.jwt.claims', ...)``
so ``get_my_company_id()`` resolves correctly inside the SECURITY DEFINER
function.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import psycopg2
import pytest
from dotenv import dotenv_values

pytestmark = [pytest.mark.integration]


def _resolve_database_url() -> str | None:
    env_url = os.environ.get("DATABASE_URL")
    if env_url:
        return env_url
    backend_dir = Path(__file__).resolve().parents[2]
    env_path = backend_dir / ".env"
    if env_path.exists():
        return dotenv_values(env_path).get("DATABASE_URL")
    return None


def _db_reachable() -> bool:
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
def conn():
    if not _db_reachable():
        pytest.skip("DATABASE_URL not reachable — skipping integration test")
    url = _resolve_database_url()
    assert url is not None
    c = psycopg2.connect(url)
    c.autocommit = True
    yield c
    c.close()


@pytest.fixture()
def active_job(conn):
    """Pick an existing active (non-archived, non-deleted) job from the dev
    DB + a real user in the same tenant so we can forge a JWT that
    ``get_my_company_id()`` will resolve correctly.

    Returns (job_id, company_id, auth_user_id, original_status). The
    auth_user_id is the value ``auth.uid()`` reads out of ``jwt.claims.sub``,
    which in turn maps to ``users.auth_user_id``, which ``get_my_company_id()``
    uses to look up the user's company. Without a real row here the function
    returns NULL and our tests hit the 'no authenticated company' branch
    instead of the branch they meant to exercise.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT j.id, j.company_id, u.auth_user_id, j.status
          FROM jobs j
          JOIN users u ON u.company_id = j.company_id AND u.deleted_at IS NULL
         WHERE j.deleted_at IS NULL
           AND j.status NOT IN ('collected')
           AND u.auth_user_id IS NOT NULL
         LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        pytest.skip("no active job + user pair available for fixture")
    return {
        "id": row[0],
        "company_id": row[1],
        "auth_user_id": row[2],
        "original_status": row[3],
    }


def _set_jwt(cur, auth_user_id: str) -> None:
    """Forge a JWT that auth.uid() can resolve.

    auth.uid() reads ``jwt.claims.sub``, NOT a company_id claim. Setting
    only company_id (as this test used to) leaves auth.uid() NULL and
    get_my_company_id() returns NULL — which is the 42501 'no
    authenticated company' branch of ensure_job_mutable, not what we're
    testing. Setting sub=auth_user_id lets get_my_company_id() look up
    the user's company the same way a real RPC call would.
    """
    cur.execute(
        "SELECT set_config('request.jwt.claims', %s, false)",
        (f'{{"sub": "{auth_user_id}"}}',),
    )


def test_happy_path_active_job_returns_without_raising(conn, active_job):
    cur = conn.cursor()
    _set_jwt(cur, str(active_job["auth_user_id"]))
    # This should not raise. A VOID function returns a single row with
    # a single column whose value is an empty string in psycopg2 — we
    # care that nothing RAISED, not the exact return shape.
    cur.execute("SELECT ensure_job_mutable(%s::uuid)", (str(active_job["id"]),))
    row = cur.fetchone()
    assert row is not None and len(row) == 1


def test_null_job_id_raises_22023(conn, active_job):
    cur = conn.cursor()
    _set_jwt(cur, str(active_job["auth_user_id"]))
    with pytest.raises(psycopg2.Error) as exc:
        cur.execute("SELECT ensure_job_mutable(NULL::uuid)")
    assert exc.value.pgcode == "22023"


def test_bogus_uuid_raises_P0002(conn, active_job):
    cur = conn.cursor()
    _set_jwt(cur, str(active_job["auth_user_id"]))
    bogus = "00000000-0000-0000-0000-000000000000"
    with pytest.raises(psycopg2.Error) as exc:
        cur.execute("SELECT ensure_job_mutable(%s::uuid)", (bogus,))
    assert exc.value.pgcode == "P0002"


def test_cross_tenant_raises_P0002_not_42501(conn, active_job):
    """Security-sensitive: a real job UUID from tenant A must NOT leak
    the fact of its existence to tenant B. Collapsing cross-tenant into
    the same P0002 as not-found prevents that leak. Different SQLSTATEs
    would let a caller probe for other companies' job IDs.

    We need a REAL user from a different company so ``get_my_company_id()``
    resolves to a valid-but-different tenant. A random UUID here would
    hit the 42501 'no authenticated company' branch instead, testing a
    different thing than we mean to.
    """
    cur = conn.cursor()
    cur.execute(
        """
        SELECT auth_user_id
          FROM users
         WHERE company_id != %s
           AND deleted_at IS NULL
           AND auth_user_id IS NOT NULL
         LIMIT 1
        """,
        (str(active_job["company_id"]),),
    )
    row = cur.fetchone()
    if not row:
        pytest.skip("no user in a different tenant available for cross-tenant test")
    other_tenant_auth_uid = str(row[0])

    _set_jwt(cur, other_tenant_auth_uid)
    with pytest.raises(psycopg2.Error) as exc:
        cur.execute(
            "SELECT ensure_job_mutable(%s::uuid)", (str(active_job["id"]),)
        )
    assert exc.value.pgcode == "P0002"


def test_missing_jwt_raises_42501(conn, active_job):
    """If the caller has no JWT context, get_my_company_id() returns NULL
    and the function must reject with 42501 (insufficient_privilege)
    rather than silently proceed with v_caller_company=NULL (which
    would match all company_id IS NULL rows, if any existed)."""
    cur = conn.cursor()
    # Force-clear any JWT context. set_config to empty string.
    cur.execute("SELECT set_config('request.jwt.claims', '', false)")
    with pytest.raises(psycopg2.Error) as exc:
        cur.execute(
            "SELECT ensure_job_mutable(%s::uuid)", (str(active_job["id"]),)
        )
    assert exc.value.pgcode == "42501"


def test_soft_deleted_job_raises_P0002(conn, active_job):
    """A soft-deleted job is logically gone — same P0002 as not-found.
    Must NOT be accessible for mutations even though the row physically
    exists. Uses service-role to set/revert deleted_at; the function
    itself runs under the caller JWT, so this is a realistic flow."""
    cur = conn.cursor()
    # Flip deleted_at via direct UPDATE (bypasses RLS via the admin
    # connection the test harness uses — same pattern as the fork
    # restamp test).
    cur.execute(
        "UPDATE jobs SET deleted_at = now() WHERE id = %s",
        (str(active_job["id"]),),
    )
    try:
        _set_jwt(cur, str(active_job["auth_user_id"]))
        with pytest.raises(psycopg2.Error) as exc:
            cur.execute(
                "SELECT ensure_job_mutable(%s::uuid)", (str(active_job["id"]),)
            )
        assert exc.value.pgcode == "P0002"
    finally:
        # Restore — never leave the dev DB in a soft-deleted state.
        cur.execute(
            "UPDATE jobs SET deleted_at = NULL WHERE id = %s",
            (str(active_job["id"]),),
        )


def test_archived_job_raises_42501(conn, active_job):
    """A 'collected' job is the ARCHIVED_JOB_STATUSES value today.
    Function must reject mutations with 42501. If the Python constant
    expands (e.g., adds 'archived'), the plpgsql IN list must grow to
    match — the twin + constant must stay in lock-step."""
    cur = conn.cursor()
    cur.execute(
        "UPDATE jobs SET status = 'collected' WHERE id = %s",
        (str(active_job["id"]),),
    )
    try:
        _set_jwt(cur, str(active_job["auth_user_id"]))
        with pytest.raises(psycopg2.Error) as exc:
            cur.execute(
                "SELECT ensure_job_mutable(%s::uuid)", (str(active_job["id"]),)
            )
        assert exc.value.pgcode == "42501"
    finally:
        cur.execute(
            "UPDATE jobs SET status = %s WHERE id = %s",
            (active_job["original_status"], str(active_job["id"])),
        )
