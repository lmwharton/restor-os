"""Text-scan guardrails for PR-B Step 1 — ensure_job_mutable plpgsql twin.

Pins the invariants the installed function must carry. Runs in plain pytest;
the companion integration test
(``tests/integration/test_ensure_job_mutable_integration.py``) exercises
the runtime behavior against the dev DB.
"""

from __future__ import annotations

from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "a1d3c5e7b9f2_spec01h_phase3_equipment_ensure_job_mutable.py"
)


def _read() -> str:
    return MIGRATION_FILE.read_text(encoding="utf-8")


def _upgrade() -> str:
    return _read().split("DOWNGRADE_SQL")[0]


def _downgrade() -> str:
    return _read().split("DOWNGRADE_SQL")[1]


def test_migration_file_exists() -> None:
    assert MIGRATION_FILE.exists()


def test_revision_identifiers() -> None:
    text = _read()
    assert 'revision: str = "a1d3c5e7b9f2"' in text
    assert 'down_revision: str | None = "f4c7e1b9a5d2"' in text


def test_function_signature_takes_single_job_id() -> None:
    up = _upgrade()
    assert "CREATE OR REPLACE FUNCTION ensure_job_mutable(p_job_id UUID)" in up
    assert "RETURNS VOID" in up


def test_tenant_derived_from_jwt_not_param() -> None:
    """Lesson §3 / C4 — SECURITY DEFINER RPCs must never accept a
    p_company_id alone. The whole input is just the job id; the company
    falls out of the JWT via get_my_company_id().
    """
    up = _upgrade()
    assert "v_caller_company := get_my_company_id()" in up
    # No p_company_id PARAMETER declared — the token only appears in
    # the explanatory comment that names the anti-pattern. Pin the
    # parameter-list form explicitly so a reviewer adding a param
    # can't slip one in under cover of comment mentions.
    import re
    params_block = re.search(
        r"CREATE OR REPLACE FUNCTION ensure_job_mutable\((.*?)\)\s*RETURNS",
        up,
        re.DOTALL,
    )
    assert params_block is not None, "couldn't isolate parameter list"
    assert "p_company_id" not in params_block.group(1)
    # v_caller_company is used in the fetch's WHERE clause — without
    # this, the function would resolve jobs cross-tenant.
    assert "AND company_id = v_caller_company" in up


def test_search_path_pinned() -> None:
    up = _upgrade()
    assert "SET search_path = pg_catalog, public" in up


def test_not_found_raises_P0002() -> None:
    """Not-found + cross-tenant + soft-deleted all collapse into the
    same SQLSTATE so the response doesn't leak existence across
    tenants. P0002 matches save_floor_plan_version's 'Job not found on
    this property' raise — unified catch block in Python."""
    up = _upgrade()
    # Single raise handles all three not-accessible cases.
    assert "IF NOT FOUND THEN" in up
    assert "USING ERRCODE = 'P0002'" in up


def test_archived_status_raises_42501() -> None:
    """42501 is the same code the existing archive guards use. Python
    catch block unifies 'cannot modify archived row' into one 403 path."""
    up = _upgrade()
    assert "IF v_status IN ('collected') THEN" in up
    # Matches ARCHIVED_JOB_STATUSES — keep in sync with the Python
    # constant (backend/api/shared/constants.py).
    assert "USING ERRCODE = '42501'" in up


def test_deleted_at_null_filter_present() -> None:
    """Soft-deleted jobs are invisible via the same filter the Python
    guard applies. Without this, deleting a job wouldn't stop new
    equipment writes."""
    up = _upgrade()
    assert "AND deleted_at IS NULL" in up


def test_null_param_guard() -> None:
    """Fail-fast on NULL p_job_id with 22023. Matches sibling RPCs'
    null-param pattern. Without this the SELECT would still NOT FOUND
    but with a misleading P0002 message."""
    up = _upgrade()
    assert "p_job_id IS NULL" in up
    assert "USING ERRCODE = '22023'" in up


def test_grants_match_sibling_rpcs() -> None:
    """authenticated + service_role is the standard GRANT set for Phase 1
    Phase 2 RPCs. Without GRANT EXECUTE, PostgREST callers get 42501
    permission-denied even when the function succeeds internally."""
    up = _upgrade()
    assert (
        "GRANT EXECUTE ON FUNCTION ensure_job_mutable(UUID) TO authenticated, service_role"
        in up
    )


def test_downgrade_drops_function_cleanly() -> None:
    down = _downgrade()
    assert "DROP FUNCTION IF EXISTS ensure_job_mutable(UUID)" in down
