"""Text-scan guardrails for PR-B2 Step 3 + Step 7 — equipment write RPCs.

Step 3 (d3a4b5c6e7f8) creates place_equipment / restart_equipment_placement /
pull_equipment_placement.
Step 7 (d7a8b9c0e1f2) swaps all four equipment RPCs (including move) to
ensure_equipment_mutable.

Consolidated into one test file because they share the sibling-
symmetry invariant (lesson §32): every equipment RPC must call the
stricter guard. A missing sibling is the whole-PR bug shape.
"""

from __future__ import annotations

import re
from pathlib import Path

VERSIONS_DIR = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions"
)

STEP3_FILE = VERSIONS_DIR / "d3a4b5c6e7f8_spec01h_phase3_place_restart_pull_rpcs.py"
STEP7_FILE = VERSIONS_DIR / "d7a8b9c0e1f2_spec01h_phase3_equipment_rpcs_use_stricter_guard.py"


def _read(f: Path) -> str:
    return f.read_text(encoding="utf-8")


def _upgrade(f: Path) -> str:
    return _read(f).split("DOWNGRADE_SQL")[0]


def test_step3_creates_three_rpcs() -> None:
    up = _upgrade(STEP3_FILE)
    assert "CREATE OR REPLACE FUNCTION place_equipment(" in up
    assert "CREATE OR REPLACE FUNCTION restart_equipment_placement(" in up
    assert "CREATE OR REPLACE FUNCTION pull_equipment_placement(" in up


def test_place_equipment_has_no_pin_param() -> None:
    up = _upgrade(STEP3_FILE)
    place_start = up.find("CREATE OR REPLACE FUNCTION place_equipment(")
    place_end = up.find(") RETURNS JSONB", place_start)
    params = up[place_start:place_end]
    assert "moisture_pin" not in params
    assert "p_asset_tags" in params
    assert "p_serial_numbers" in params


def test_place_equipment_enforces_cross_job_room_binding() -> None:
    """Lesson #30 — FK existence is not a binding check."""
    up = _upgrade(STEP3_FILE)
    place_start = up.find("CREATE OR REPLACE FUNCTION place_equipment(")
    place_end = up.find("$$ LANGUAGE plpgsql", place_start)
    body = up[place_start:place_end]
    assert "FROM job_rooms" in body
    assert "WHERE id = p_room_id" in body
    assert "AND job_id = p_job_id" in body
    assert "AND company_id = v_caller_company" in body


def test_restart_rpc_requires_pulled_parent_same_job() -> None:
    """Defensive check upfront so the error message is crisp before the
    trigger re-enforces atomically."""
    up = _upgrade(STEP3_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION restart_equipment_placement(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    assert "FROM equipment_placements" in body
    assert "AND job_id = p_job_id" in body
    assert "AND company_id = v_caller_company" in body
    assert "AND pulled_at IS NOT NULL" in body
    assert "FOR UPDATE" in body


def test_restart_rpc_copies_parent_fields_not_caller_params() -> None:
    """Chain integrity relies on copying type/size/room from the parent —
    a caller can't smuggle in different values. The CREATE path here
    sources from v_parent, not from params."""
    up = _upgrade(STEP3_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION restart_equipment_placement(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    # The INSERT VALUES pulls type/size/room from v_parent.*.
    assert "v_parent.equipment_type" in body
    assert "v_parent.equipment_size" in body
    assert "v_parent.room_id" in body
    # restarted_from_placement_id is the FK link.
    assert "restarted_from_placement_id" in body
    assert "p_previous_placement_id" in body


def test_restart_rpc_restamps_floor_plan_from_current_job() -> None:
    """Lesson #29 — chain links inherit the CURRENT job stamp, not the
    parent's stamp. If a floor plan forked while the unit was paused,
    the new link sits on the current version."""
    up = _upgrade(STEP3_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION restart_equipment_placement(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    assert "SELECT floor_plan_id INTO v_floor_plan_id" in body
    assert "FROM jobs" in body


def test_restart_rpc_chain_walk_has_cycle_detection() -> None:
    """Round-1 review MEDIUM #1 — the recursive CTE that finds the
    chain head must not infinite-loop on a cycle. The Postgres 14+
    ``CYCLE ... SET is_cycle USING path`` clause handles it; the
    SELECT filters ``NOT is_cycle`` so cycled rows don't match; a
    defensive NULL check on v_chain_head raises 55006 when the head
    is unreachable.
    """
    up = _upgrade(STEP3_FILE)
    r_start = up.find("CREATE OR REPLACE FUNCTION restart_equipment_placement(")
    r_end = up.find("$$ LANGUAGE plpgsql", r_start)
    body = up[r_start:r_end]
    assert "CYCLE id SET is_cycle USING path" in body
    assert "AND NOT is_cycle" in body
    assert "IF v_chain_head IS NULL THEN" in body
    # The defensive raise must be 55006 for invalid-prerequisite-state.
    assert "ERRCODE = '55006'" in body


def test_pull_rpc_is_atomic_compare_and_set() -> None:
    """WHERE pulled_at IS NULL ensures no double-pull — the UPDATE silently
    matches zero rows on an already-pulled placement, and we raise P0002
    explicitly. Silent success would mislead billing."""
    up = _upgrade(STEP3_FILE)
    p_start = up.find("CREATE OR REPLACE FUNCTION pull_equipment_placement(")
    p_end = up.find("$$ LANGUAGE plpgsql", p_start)
    body = up[p_start:p_end]
    assert "AND pulled_at IS NULL" in body
    assert "RETURNING pulled_at INTO v_pulled_at" in body
    assert "IF v_pulled_at IS NULL THEN" in body


# ----- Step 7: sibling-symmetry invariant (lesson §32) -----


def _sql_body(text: str, start_marker: str, end_marker: str) -> str:
    """Extract the contents of a triple-quoted Python string constant.
    Used to scan the SQL bodies without docstring mentions polluting
    regex counts.
    """
    start = text.find(start_marker)
    if start == -1:
        raise AssertionError(f"marker not found: {start_marker!r}")
    start = text.find('"""', start) + 3
    end = text.find(end_marker, start)
    return text[start:end]


def test_step7_all_four_equipment_rpcs_call_stricter_guard() -> None:
    """All FOUR equipment write RPCs in step 7 must call
    ensure_equipment_mutable, not the looser ensure_job_mutable. A
    sibling that stays on the looser guard becomes a backdoor.
    """
    # Slice to JUST the UPGRADE_SQL string body so docstring mentions
    # of "PERFORM ensure_equipment_mutable" don't inflate the count.
    text = _read(STEP7_FILE)
    up_sql = _sql_body(text, "UPGRADE_SQL =", '"""')
    strict_calls = len(re.findall(r"PERFORM ensure_equipment_mutable\b", up_sql))
    loose_calls = len(re.findall(r"PERFORM ensure_job_mutable\b", up_sql))
    assert strict_calls == 4, (
        f"Expected 4 ensure_equipment_mutable calls across the 4 equipment "
        f"RPCs in step 7, found {strict_calls}. A sibling was likely "
        f"left on the looser guard."
    )
    assert loose_calls == 0, (
        f"Upgrade path has {loose_calls} ensure_job_mutable call(s) — "
        f"every equipment RPC should have been migrated to the stricter guard."
    )


def test_step7_rpcs_are_four_specific_names() -> None:
    """Sanity — if a reviewer adds/removes an equipment RPC, this test
    surfaces the count mismatch with test above."""
    up = _upgrade(STEP7_FILE)
    for name in [
        "CREATE OR REPLACE FUNCTION place_equipment(",
        "CREATE OR REPLACE FUNCTION restart_equipment_placement(",
        "CREATE OR REPLACE FUNCTION pull_equipment_placement(",
        "CREATE OR REPLACE FUNCTION move_equipment_placement(",
    ]:
        assert name in up, f"missing RPC replacement: {name}"


def test_step7_downgrade_restores_looser_guard_on_all_four() -> None:
    """Symmetric downgrade — all four revert to ensure_job_mutable.
    Lesson #10 — downgrade must match."""
    text = _read(STEP7_FILE)
    down_sql = _sql_body(text, "DOWNGRADE_SQL =", '"""')
    strict_calls = len(re.findall(r"PERFORM ensure_equipment_mutable\b", down_sql))
    loose_calls = len(re.findall(r"PERFORM ensure_job_mutable\b", down_sql))
    assert strict_calls == 0
    assert loose_calls == 4
