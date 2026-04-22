"""Drift test: SQL-side archive-status guards must match Python's
``ARCHIVED_JOB_STATUSES``.

Round 3 (post-review, LOW #5): several Spec 01H RPCs encode the archive-
status guard inline as ``IF v_job.status = 'collected' THEN`` instead of
pulling from a shared SQL helper. The Python constant
``api.shared.constants.ARCHIVED_JOB_STATUSES`` is documented as the single
source of truth — when it widens (e.g. to include ``'billed'`` later),
every Python caller inherits via ``ensure_job_mutable``, but these
plpgsql literals do not.

This test fails if any RPC archive-guard literal diverges from the
Python set. The fix when it fires is either:
  1. Update the migration literal to match (if widening happens), or
  2. Extract a SQL helper ``is_archived_job_status(status)`` and migrate
     the RPCs to use it (eliminates this class of drift entirely).

The scan is deliberately narrow: it only matches the archive-guard
grammar used by the Spec 01H RPCs, not the ``status IN (...)`` enum
definitions in earlier schema migrations (those carry the full set of
VALID job statuses, not the archive subset).
"""

from __future__ import annotations

import re
from pathlib import Path

from api.shared.constants import ARCHIVED_JOB_STATUSES

# ``IF <qualified>.status = '<literal>' THEN`` or ``WHEN <qualified>.status = '<literal>' THEN``
# — the Spec 01H archive-guard grammar. Qualified on purpose: CHECK
# constraint lines read like ``status IN ('new', 'collected', ...)`` and
# must be excluded.
ARCHIVE_GUARD_PATTERN = re.compile(
    r"""
    (?:IF|WHEN)\s+                # grammar keyword
    [A-Za-z_][A-Za-z0-9_]*        # variable name (e.g. v_job)
    \.status\s*=\s*               # .status =
    '(?P<status>[^']+)'           # the status literal
    \s+THEN                       # THEN terminator
    """,
    re.VERBOSE | re.IGNORECASE,
)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "alembic" / "versions"


def _scan_archive_guard_literals() -> dict[Path, list[tuple[int, str]]]:
    """Return {migration_path: [(line_no, literal), ...]} for every
    archive-guard literal found in RPC bodies."""
    hits: dict[Path, list[tuple[int, str]]] = {}
    for mig_path in sorted(MIGRATIONS_DIR.glob("*.py")):
        try:
            text = mig_path.read_text()
        except (OSError, UnicodeDecodeError):
            continue
        per_file: list[tuple[int, str]] = []
        for lineno, line in enumerate(text.splitlines(), start=1):
            for match in ARCHIVE_GUARD_PATTERN.finditer(line):
                per_file.append((lineno, match.group("status")))
        if per_file:
            hits[mig_path] = per_file
    return hits


def test_migration_archive_guards_match_python_constant() -> None:
    hits = _scan_archive_guard_literals()

    if not hits:
        # Defensive: the Spec 01H RPCs explicitly encode archive-status
        # guards. If this scan returns nothing, the pattern regressed
        # silently (e.g. someone rewrote them to a different grammar)
        # and this test no longer protects against drift.
        raise AssertionError(
            "test_archive_status_drift.py found zero archive-guard "
            "literals in backend/alembic/versions/. Expected to see the "
            "IF v_job.status = '<status>' THEN pattern from "
            "b8c9d0e1f2a3_spec01h_ensure_job_floor_plan_rpc.py and "
            "f6a9b0c1d2e3_spec01h_rollback_atomic_wrapper.py. The "
            "scanner grammar likely drifted from the actual migration "
            "text — update ARCHIVE_GUARD_PATTERN."
        )

    mismatches: list[str] = []
    for mig_path, entries in hits.items():
        for lineno, literal in entries:
            if literal not in ARCHIVED_JOB_STATUSES:
                mismatches.append(
                    f"{mig_path.name}:{lineno} uses status literal "
                    f"'{literal}' but ARCHIVED_JOB_STATUSES is "
                    f"{sorted(ARCHIVED_JOB_STATUSES)}. Either update the "
                    f"migration to match the Python constant, or extract "
                    f"a SQL helper so all guards share one source."
                )

    assert not mismatches, (
        "SQL-side archive-status guards diverged from "
        "api.shared.constants.ARCHIVED_JOB_STATUSES:\n  "
        + "\n  ".join(mismatches)
    )
