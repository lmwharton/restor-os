"""Text-scan guardrails for PR-B2 Steps 4-6 — the job-completion lifecycle.

Step 4 (d4a5b6c7e8f9): job_completion_events audit table.
Step 5 (d5a6b7c8e9f0): jobs.completed_at/_by columns + ensure_equipment_mutable.
Step 6 (d6a7b8c9e0f1): complete_job + reopen_job RPCs.

Consolidated: these three migrations land together as one product story
("explicit job completion with full audit + strict equipment freeze").
"""

from __future__ import annotations

from pathlib import Path

VERSIONS_DIR = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions"
)

STEP4_FILE = VERSIONS_DIR / "d4a5b6c7e8f9_spec01h_phase3_job_completion_events.py"
STEP5_FILE = VERSIONS_DIR / "d5a6b7c8e9f0_spec01h_phase3_completed_at_and_eq_mutable.py"
STEP6_FILE = VERSIONS_DIR / "d6a7b8c9e0f1_spec01h_phase3_complete_reopen_job.py"


def _read(f: Path) -> str:
    return f.read_text(encoding="utf-8")


def _upgrade(f: Path) -> str:
    return _read(f).split("DOWNGRADE_SQL")[0]


# ----- Step 4: job_completion_events -----


def test_step4_table_has_required_columns() -> None:
    up = _upgrade(STEP4_FILE)
    assert "CREATE TABLE job_completion_events" in up
    for col in [
        "company_id",
        "job_id",
        "completed_at",
        "completed_by",
        "reopened_at",
        "reopened_by",
        "reopen_reason",
        "notes",
    ]:
        assert col in up, f"missing column: {col}"


def test_step4_chk_reopen_after_complete() -> None:
    """Reopen moment must strictly follow completion moment. Physical
    impossibility otherwise; loud-fail."""
    up = _upgrade(STEP4_FILE)
    assert "chk_reopen_after_complete" in up
    assert "reopened_at IS NULL OR reopened_at > completed_at" in up


def test_step4_job_fk_cascades() -> None:
    """When a job is hard-deleted, its audit log goes with it — no
    orphan completion records."""
    up = _upgrade(STEP4_FILE)
    assert "job_id          UUID NOT NULL REFERENCES jobs(id)      ON DELETE CASCADE" in up


def test_step4_hot_index_is_job_with_completed_at_desc() -> None:
    """Latest-completion lookup (reopen RPC + UI) uses DESC order."""
    up = _upgrade(STEP4_FILE)
    assert "CREATE INDEX idx_job_completions_job" in up
    assert "ON job_completion_events(job_id, completed_at DESC)" in up


def test_step4_rls_via_get_my_company_id() -> None:
    up = _upgrade(STEP4_FILE)
    assert "ALTER TABLE job_completion_events ENABLE ROW LEVEL SECURITY" in up
    assert "CREATE POLICY jce_tenant" in up
    assert "company_id = get_my_company_id()" in up


# ----- Step 5: jobs columns + ensure_equipment_mutable -----


def test_step5_adds_both_completed_at_and_completed_by() -> None:
    up = _upgrade(STEP5_FILE)
    assert "ADD COLUMN completed_at TIMESTAMPTZ" in up
    assert "ADD COLUMN completed_by UUID REFERENCES users(id)" in up


def test_step5_chk_completed_pair_enforces_atomicity() -> None:
    """Both NULL or both set. Half-state is ambiguous for "is this job
    complete right now?"

    Round-1 review MEDIUM #3 — this test previously only asserted that
    the constraint NAME was present, which shipped CRITICAL #2 (the
    predicate was wrong: missing AND completed_by IS NOT NULL on the
    second disjunct). Now we pin the full predicate shape with regex so
    a future edit that drops either half breaks the test loudly.
    """
    import re as _re
    up = _upgrade(STEP5_FILE)
    assert "chk_completed_pair" in up
    # Full predicate: both-null OR both-not-null. Whitespace-tolerant
    # but pins both conjunction branches explicitly.
    pattern = _re.compile(
        r"\(completed_at IS NULL AND completed_by IS NULL\)"
        r"\s*OR\s*"
        r"\(completed_at IS NOT NULL AND completed_by IS NOT NULL\)",
        _re.DOTALL,
    )
    assert pattern.search(up), (
        "chk_completed_pair predicate must be both-null OR both-not-null. "
        "The earlier shape (completed_at IS NOT NULL) alone — without "
        "AND completed_by IS NOT NULL — let half-filled rows through."
    )


def test_step5_ensure_equipment_mutable_blocks_three_statuses() -> None:
    """The equipment-freeze set: {complete, submitted, collected}.
    Stricter than ARCHIVED_JOB_STATUSES (which only has 'collected')."""
    up = _upgrade(STEP5_FILE)
    assert "CREATE OR REPLACE FUNCTION ensure_equipment_mutable(" in up
    assert "IF v_status IN ('complete', 'submitted', 'collected') THEN" in up


def test_step5_function_has_security_definer_and_search_path() -> None:
    up = _upgrade(STEP5_FILE)
    assert "SECURITY DEFINER" in up
    assert "SET search_path = pg_catalog, public" in up


def test_step5_tenant_derives_from_jwt_not_params() -> None:
    """Lesson §3 — get_my_company_id(), never a p_company_id param."""
    up = _upgrade(STEP5_FILE)
    fn_start = up.find("CREATE OR REPLACE FUNCTION ensure_equipment_mutable(")
    fn_end = up.find("$$ LANGUAGE plpgsql", fn_start)
    fn = up[fn_start:fn_end]
    assert "get_my_company_id()" in fn
    # Negative pin — no p_company_id param.
    signature_start = fn.find("(")
    signature_end = fn.find(")")
    signature = fn[signature_start:signature_end]
    assert "p_company_id" not in signature


# ----- Step 6: complete_job + reopen_job -----


def test_step6_complete_job_transitions_to_complete_status() -> None:
    up = _upgrade(STEP6_FILE)
    assert "CREATE OR REPLACE FUNCTION complete_job(" in up
    assert "SET status       = 'complete'" in up


def test_step6_complete_job_auto_pulls_active_equipment_same_timestamp() -> None:
    """All auto-pulled rows share the same timestamp as jobs.completed_at.
    No smear of microsecond-different values across the billing edge."""
    up = _upgrade(STEP6_FILE)
    c_start = up.find("CREATE OR REPLACE FUNCTION complete_job(")
    c_end = up.find("$$ LANGUAGE plpgsql", c_start)
    body = up[c_start:c_end]
    assert "UPDATE equipment_placements" in body
    assert "SET pulled_at  = v_completed_at" in body
    assert "WHERE job_id = p_job_id" in body
    assert "AND pulled_at IS NULL" in body


def test_step6_complete_job_inserts_audit_row() -> None:
    up = _upgrade(STEP6_FILE)
    c_start = up.find("CREATE OR REPLACE FUNCTION complete_job(")
    c_end = up.find("$$ LANGUAGE plpgsql", c_start)
    body = up[c_start:c_end]
    assert "INSERT INTO job_completion_events (" in body
    assert "RETURNING id INTO v_event_id" in body


def test_step6_complete_job_rejects_already_complete_statuses() -> None:
    """Double-completion is a bug; loud-fail with 55006."""
    up = _upgrade(STEP6_FILE)
    assert "IF v_current_status IN ('complete', 'submitted', 'collected') THEN" in up


def test_step6_reopen_job_is_owner_only() -> None:
    """Role check inside the txn — Python pre-flight is optional fast
    path; the RPC is the authoritative enforcement."""
    up = _upgrade(STEP6_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION reopen_job(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    assert "SELECT id, role INTO v_caller_user, v_caller_role" in body
    assert "v_caller_role <> 'owner'" in body


def test_step6_reopen_job_requires_non_empty_reason() -> None:
    """Reopen must be logged with a reason — audit trail is useless
    without WHY."""
    up = _upgrade(STEP6_FILE)
    assert "p_reason IS NULL OR length(trim(p_reason)) = 0" in up


def test_step6_reopen_job_reverts_status_and_clears_stamps() -> None:
    """After HIGH #1 fix (round-1 review), the target status is picked
    from a CASE on job_type (drying for mitigation, in_progress for
    reconstruction) rather than hardcoded. The UPDATE uses
    v_target_status; the literal 'drying' appears only inside the CASE
    branch, not the UPDATE itself."""
    up = _upgrade(STEP6_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION reopen_job(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    # UPDATE uses the computed target status, not a literal.
    assert "SET status       = v_target_status" in body
    assert "completed_at = NULL" in body
    assert "completed_by = NULL" in body


def test_step6_reopen_job_does_not_un_pull_equipment() -> None:
    """The whole point of the chain model: historical pulled_at stamps
    are immutable; billing for past spans is frozen. If the tech wants
    to run a unit again, they call restart_equipment_placement.

    Scanning the reopen body to confirm there's no UPDATE touching
    equipment_placements.pulled_at.
    """
    up = _upgrade(STEP6_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION reopen_job(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    # No UPDATE to equipment_placements in the reopen path.
    assert "UPDATE equipment_placements" not in body
    assert "pulled_at = NULL" not in body  # would un-pull


def test_step6_reopen_stamps_latest_completion_event_row() -> None:
    """The LIMIT 1 ORDER BY completed_at DESC is critical — prior
    completion cycles' rows are historical and must not be touched."""
    up = _upgrade(STEP6_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION reopen_job(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    assert "UPDATE job_completion_events" in body
    assert "ORDER BY completed_at DESC" in body
    assert "LIMIT 1" in body
    # Only open event rows (reopened_at IS NULL) are candidates.
    assert "reopened_at IS NULL" in body


# ----- Round-1 review fixes (2026-04-25) -----


def test_step6_complete_job_rejects_null_caller_user() -> None:
    """CRITICAL #2 part 2 — complete_job must reject callers that can't
    be resolved to an internal user row (service-role / soft-deleted
    actor / missing users row). Without this, completed_by = NULL
    would pass the now-fixed chk_completed_pair as 23514, losing the
    plpgsql context. 42501 upfront is the clean shape.
    """
    up = _upgrade(STEP6_FILE)
    c_start = up.find("CREATE OR REPLACE FUNCTION complete_job(")
    c_end = up.find("$$ LANGUAGE plpgsql", c_start)
    body = up[c_start:c_end]
    assert "IF v_caller_user IS NULL THEN" in body
    assert "ERRCODE = '42501'" in body


def test_step6_reopen_job_branches_target_status_on_job_type() -> None:
    """HIGH #1 — reopen must not hardcode 'drying'; reconstruction jobs
    have no 'drying' stage. The CASE branch picks 'drying' for
    mitigation, 'in_progress' for reconstruction.
    """
    up = _upgrade(STEP6_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION reopen_job(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    # CASE branching on job_type present.
    assert "CASE v_job_type" in body
    assert "WHEN 'mitigation'" in body
    assert "WHEN 'reconstruction'" in body
    assert "'drying'" in body
    assert "'in_progress'" in body
    # The UPDATE should use the computed v_target_status, not a literal.
    assert "SET status       = v_target_status" in body
    # Negative pin: the old hardcoded literal must not be present in
    # the UPDATE assignment (still mentioned inside the CASE branch).
    assert "SET status       = 'drying'" not in body


def test_step6_reopen_job_filters_deleted_at_is_null() -> None:
    """Out-of-scope #1 — soft-deleted jobs must not be reopenable.
    The SELECT that reads the job must filter deleted_at IS NULL.
    """
    up = _upgrade(STEP6_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION reopen_job(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    # The job SELECT in reopen path must carry deleted_at IS NULL.
    assert "AND deleted_at IS NULL" in body


def test_step6_reopen_job_locks_event_row_for_update() -> None:
    """MEDIUM #2 — two concurrent reopens on the same job must not
    both update the same completion event row. FOR UPDATE inside the
    inner SELECT serializes the second caller behind the first.
    """
    up = _upgrade(STEP6_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION reopen_job(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    # Look for the idiom: LIMIT 1\n... FOR UPDATE inside the inner SELECT.
    assert "LIMIT 1" in body
    assert "FOR UPDATE" in body


def test_step6_complete_job_filters_deleted_at_is_null() -> None:
    """Symmetric check — complete_job also filters deleted_at IS NULL
    on the jobs SELECT so a soft-deleted job can't be completed."""
    up = _upgrade(STEP6_FILE)
    c_start = up.find("CREATE OR REPLACE FUNCTION complete_job(")
    c_end = up.find("$$ LANGUAGE plpgsql", c_start)
    body = up[c_start:c_end]
    # The jobs SELECT in complete_job must carry deleted_at IS NULL.
    # (The inner users SELECT also has it; find the jobs-table one.)
    jobs_select = body.find("FROM jobs j")
    assert jobs_select != -1
    # After that FROM, look for the deleted_at filter within the same
    # SELECT statement (up to the next terminating semicolon).
    stmt_end = body.find(";", jobs_select)
    jobs_stmt = body[jobs_select:stmt_end]
    assert "deleted_at IS NULL" in jobs_stmt
