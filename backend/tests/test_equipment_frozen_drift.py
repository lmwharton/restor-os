"""Drift-check: Python ``EQUIPMENT_FROZEN_STATUSES`` vs. SQL literal set.

Mirror of ``test_archive_status_drift.py`` for the stricter equipment-
freeze list. The Python constant in ``api.shared.constants`` and the
SQL literal in ``ensure_equipment_mutable`` (migration d5a6b7c8e9f0)
MUST match — one is used for pre-flight rejection, the other for
atomic-transaction enforcement. A drift means either a Python-layer
over-rejection or a DB-layer bypass.

Lesson §3 — sibling enforcement paths must be kept in parity, and the
cheapest way to enforce parity is a test that asserts it directly.
"""

from __future__ import annotations

import re
from pathlib import Path

from api.shared.constants import EQUIPMENT_FROZEN_STATUSES

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "d5a6b7c8e9f0_spec01h_phase3_completed_at_and_eq_mutable.py"
)


def _sql_literal_set() -> frozenset[str]:
    """Extract the frozen-status literal from the CREATE OR REPLACE body
    of ensure_equipment_mutable. Pattern:

        IF v_status IN ('complete', 'submitted', 'collected') THEN

    If the migration body ever changes the literal list, this regex
    will stop matching and the test fails loudly rather than silently
    accepting the drift.
    """
    text = MIGRATION_FILE.read_text(encoding="utf-8")
    match = re.search(
        r"IF v_status IN \(([^)]+)\) THEN",
        text,
    )
    if match is None:
        raise AssertionError(
            "Could not locate the v_status IN (...) literal in the "
            "ensure_equipment_mutable migration. Either the migration "
            "was restructured or the regex needs updating."
        )
    items = [
        item.strip().strip("'\"")
        for item in match.group(1).split(",")
    ]
    return frozenset(items)


def test_python_and_sql_sets_match_exactly() -> None:
    sql_set = _sql_literal_set()
    assert sql_set == EQUIPMENT_FROZEN_STATUSES, (
        "EQUIPMENT_FROZEN_STATUSES drifted between Python and SQL.\n"
        f"  Python: {sorted(EQUIPMENT_FROZEN_STATUSES)}\n"
        f"  SQL:    {sorted(sql_set)}\n"
        "Update api.shared.constants.EQUIPMENT_FROZEN_STATUSES AND the "
        "migration body together, or add a new migration that brings "
        "the SQL function in sync with the Python set."
    )


def test_set_is_non_empty() -> None:
    """If the set empties out, every equipment write would be mutable,
    which silently disables the freeze. Sanity-check the shape."""
    assert len(EQUIPMENT_FROZEN_STATUSES) > 0


def test_collected_is_in_the_set() -> None:
    """``'collected'`` is the hard-archive state — it MUST be in both
    the looser ARCHIVED_JOB_STATUSES and the stricter
    EQUIPMENT_FROZEN_STATUSES. Pinning this belt-and-suspenders."""
    assert "collected" in EQUIPMENT_FROZEN_STATUSES


def test_complete_is_in_the_set() -> None:
    """The whole point of PR-B2 — 'complete' means the tech tapped
    Mark Job Complete, and equipment billing freezes at that moment."""
    assert "complete" in EQUIPMENT_FROZEN_STATUSES
