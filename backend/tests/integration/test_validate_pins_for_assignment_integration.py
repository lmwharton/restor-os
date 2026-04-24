"""Integration test for PR-B Step 4 — validate_pins_for_assignment.

Runtime verification of each rejection branch against the dev DB.
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
        pytest.skip("DATABASE_URL not reachable")
    url = _resolve_database_url()
    assert url is not None
    c = psycopg2.connect(url)
    c.autocommit = True
    yield c
    c.close()


@pytest.fixture()
def active_pin(conn):
    """An active (non-dry) pin + its job + a real user in the same
    tenant so we can forge a JWT that ``get_my_company_id()`` resolves."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT mp.id, mp.job_id, mp.company_id, u.auth_user_id
          FROM moisture_pins mp
          JOIN users u ON u.company_id = mp.company_id AND u.deleted_at IS NULL
         WHERE mp.dry_standard_met_at IS NULL
           AND u.auth_user_id IS NOT NULL
         LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        pytest.skip("no active pin + user pair available")
    return {
        "pin_id": row[0],
        "job_id": row[1],
        "company_id": row[2],
        "auth_user_id": row[3],
    }


def _set_jwt(cur, auth_user_id: str) -> None:
    cur.execute(
        "SELECT set_config('request.jwt.claims', %s, false)",
        (f'{{"sub": "{auth_user_id}"}}',),
    )


def test_empty_array_is_noop(conn, active_pin):
    """Per-room equipment passes an empty array; validation must be
    a no-op so the caller doesn't need a billing_scope branch."""
    cur = conn.cursor()
    _set_jwt(cur, str(active_pin["auth_user_id"]))
    cur.execute(
        "SELECT validate_pins_for_assignment(%s::uuid, ARRAY[]::uuid[])",
        (str(active_pin["job_id"]),),
    )
    # Did not raise.
    assert cur.fetchone() is not None


def test_null_array_is_noop(conn, active_pin):
    cur = conn.cursor()
    _set_jwt(cur, str(active_pin["auth_user_id"]))
    cur.execute(
        "SELECT validate_pins_for_assignment(%s::uuid, NULL::uuid[])",
        (str(active_pin["job_id"]),),
    )
    assert cur.fetchone() is not None


def test_null_job_id_raises_22023(conn, active_pin):
    cur = conn.cursor()
    _set_jwt(cur, str(active_pin["auth_user_id"]))
    with pytest.raises(psycopg2.Error) as exc:
        cur.execute(
            "SELECT validate_pins_for_assignment(NULL::uuid, ARRAY[%s]::uuid[])",
            (str(active_pin["pin_id"]),),
        )
    assert exc.value.pgcode == "22023"


def test_missing_jwt_raises_42501(conn, active_pin):
    cur = conn.cursor()
    cur.execute("SELECT set_config('request.jwt.claims', '', false)")
    with pytest.raises(psycopg2.Error) as exc:
        cur.execute(
            "SELECT validate_pins_for_assignment(%s::uuid, ARRAY[%s]::uuid[])",
            (str(active_pin["job_id"]), str(active_pin["pin_id"])),
        )
    assert exc.value.pgcode == "42501"


def test_valid_active_pin_passes(conn, active_pin):
    cur = conn.cursor()
    _set_jwt(cur, str(active_pin["auth_user_id"]))
    cur.execute(
        "SELECT validate_pins_for_assignment(%s::uuid, ARRAY[%s]::uuid[])",
        (str(active_pin["job_id"]), str(active_pin["pin_id"])),
    )
    assert cur.fetchone() is not None


def test_bogus_pin_id_raises_42501(conn, active_pin):
    cur = conn.cursor()
    _set_jwt(cur, str(active_pin["auth_user_id"]))
    bogus = str(uuid.uuid4())
    with pytest.raises(psycopg2.Error) as exc:
        cur.execute(
            "SELECT validate_pins_for_assignment(%s::uuid, ARRAY[%s]::uuid[])",
            (str(active_pin["job_id"]), bogus),
        )
    assert exc.value.pgcode == "42501"


def test_real_pin_wrong_job_raises_42501(conn, active_pin):
    """Pin exists + is in caller's tenant but belongs to a different
    job. Must reject — the URL-level ``p_job_id`` is the authority."""
    cur = conn.cursor()
    # Find ANY other job in the same company.
    cur.execute(
        """
        SELECT id FROM jobs
         WHERE company_id = %s AND id != %s AND deleted_at IS NULL
         LIMIT 1
        """,
        (str(active_pin["company_id"]), str(active_pin["job_id"])),
    )
    other_job = cur.fetchone()
    if not other_job:
        pytest.skip("no second job in tenant available")
    _set_jwt(cur, str(active_pin["auth_user_id"]))
    with pytest.raises(psycopg2.Error) as exc:
        cur.execute(
            "SELECT validate_pins_for_assignment(%s::uuid, ARRAY[%s]::uuid[])",
            (str(other_job[0]), str(active_pin["pin_id"])),
        )
    assert exc.value.pgcode == "42501"


def test_dry_pin_raises_22P02(conn, active_pin):
    """Proposal C8 — a pin marked dry rejects assignment with a
    DIFFERENT SQLSTATE than the access-denied case. PR-C maps this
    to distinct user copy."""
    cur = conn.cursor()
    # Flip the pin to dry via direct UPDATE (bypasses the trigger's
    # "act only on latest reading" guard; we're simulating the
    # end state the trigger would have produced).
    cur.execute(
        "UPDATE moisture_pins SET dry_standard_met_at = now() WHERE id = %s",
        (str(active_pin["pin_id"]),),
    )
    try:
        _set_jwt(cur, str(active_pin["auth_user_id"]))
        with pytest.raises(psycopg2.Error) as exc:
            cur.execute(
                "SELECT validate_pins_for_assignment(%s::uuid, ARRAY[%s]::uuid[])",
                (str(active_pin["job_id"]), str(active_pin["pin_id"])),
            )
        assert exc.value.pgcode == "22P02"
    finally:
        # Restore — never leave the dev DB in a dry state.
        cur.execute(
            "UPDATE moisture_pins SET dry_standard_met_at = NULL WHERE id = %s",
            (str(active_pin["pin_id"]),),
        )
