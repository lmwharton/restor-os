"""Guardrails for Alembic trigger-function names across migrations.

Round-2 review surfaced a downgrade that called ``set_updated_at()`` (function
does not exist in this repo — the real name is ``update_updated_at()`` defined
in ``001_bootstrap.py``). A one-character typo made every rollback of the
Spec 01H chain crash with ``function set_updated_at() does not exist``.

This test reads every migration file as text and asserts the only trigger
function we install and call is ``update_updated_at()``. It runs in plain
pytest — no Alembic context required — so CI catches the regression even when
the migration chain can't be applied locally.
"""

from __future__ import annotations

import re
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"

# Matches ``EXECUTE FUNCTION <name>(`` — the only place a trigger resolves the
# function name. Trigger identifiers such as ``set_updated_at_wall_segments``
# are fine (they're just names); the CALL is what has to be real.
_EXECUTE_FUNCTION_RE = re.compile(r"EXECUTE\s+FUNCTION\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.IGNORECASE)

_ALLOWED_FUNCTIONS = {
    # Installed in 001_bootstrap.py and reused by every feature migration.
    "update_updated_at",
    "prevent_admin_self_escalation",
    # R4 belt-and-suspenders (round 2, d8e9f0a1b2c3): rejects UPDATEs on
    # frozen (is_current=false) floor_plans rows. Defined in the same
    # migration that installs the trigger.
    "floor_plans_prevent_frozen_mutation",
    # Phase 3 Step 4 (f4c7e1b9a5d2): maintains moisture_pins.dry_standard_met_at
    # on every moisture_pin_readings INSERT. Sets on first dry reading,
    # clears on re-wet. Out-of-order guard via COALESCE(-infinity).
    "moisture_pin_dry_check",
    # Phase 3 PR-B2 Step 2 (d2a3b4c5e6f7): enforces chain integrity on
    # equipment_placements.restarted_from_placement_id — same job, type,
    # size, and parent must be pulled. Fires BEFORE INSERT OR UPDATE.
    "equipment_chain_integrity",
}


def _migration_files() -> list[Path]:
    return sorted(p for p in MIGRATIONS_DIR.glob("*.py") if p.name != "__init__.py")


def test_every_trigger_calls_update_updated_at() -> None:
    """Each `EXECUTE FUNCTION foo()` in a migration must resolve to an installed function."""
    offenders: list[tuple[str, int, str]] = []
    for path in _migration_files():
        text = path.read_text(encoding="utf-8")
        for match in _EXECUTE_FUNCTION_RE.finditer(text):
            func_name = match.group(1)
            if func_name in _ALLOWED_FUNCTIONS:
                continue
            line_no = text.count("\n", 0, match.start()) + 1
            offenders.append((path.name, line_no, func_name))

    assert not offenders, (
        "Migration references trigger functions that do not exist in this repo.\n"
        f"Allowed: {sorted(_ALLOWED_FUNCTIONS)}\n"
        "Offenders:\n" + "\n".join(f"  {name}:{line} — EXECUTE FUNCTION {func}()" for name, line, func in offenders)
    )


def test_no_stale_set_updated_at_function_call() -> None:
    """Explicit regression guard for the Round-2 R1 finding.

    ``set_updated_at`` is fine as a trigger identifier (e.g. the trigger NAME
    ``set_updated_at_wall_segments``) but never as the FUNCTION we execute.
    """
    bad_pattern = re.compile(r"EXECUTE\s+FUNCTION\s+set_updated_at\s*\(", re.IGNORECASE)
    offenders: list[tuple[str, int]] = []
    for path in _migration_files():
        text = path.read_text(encoding="utf-8")
        for match in bad_pattern.finditer(text):
            line_no = text.count("\n", 0, match.start()) + 1
            offenders.append((path.name, line_no))
    assert not offenders, (
        "Found `EXECUTE FUNCTION set_updated_at()` — this function does not exist "
        "in the repo. Use `update_updated_at()` (from 001_bootstrap.py). Offenders: "
        + ", ".join(f"{name}:{line}" for name, line in offenders)
    )
