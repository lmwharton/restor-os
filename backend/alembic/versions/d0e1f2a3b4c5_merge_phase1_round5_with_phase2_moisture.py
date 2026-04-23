"""Merge Phase 1 Round 5 (ETag RPC) with Phase 2 (Moisture Pins).

Phase 2's moisture-pins migration (``b8f2a1c3d4e5``) was authored while
Phase 1 was still in review; its ``down_revision`` pointed at
``e1a7c9b30201`` (the Phase 1A container-merge). Phase 1 Rounds 2–5 then
landed ~12 migrations on top of that same ancestor, ending at
``c9d0e1f2a3b4`` which added ``p_expected_updated_at`` to the
``save_floor_plan_version`` RPC.

When Phase 1 PR #10 merged to main and Phase 2 was rebased on top,
nobody updated Phase 2's parent. Result: two parallel alembic heads
that share an ancestor but never reconcile.

This empty merge revision lets ``alembic upgrade head`` apply both
chains cleanly:

  * A DB currently at ``b8f2a1c3d4e5`` (local dev; Phase 2 applied early)
    traverses back to ``e1a7c9b30201``, discovers the Round 2–5 chain is
    not applied, runs it forward to ``c9d0e1f2a3b4``, then runs this
    merge (no-op).
  * A DB currently at ``c9d0e1f2a3b4`` (prod after Phase 1 merge, Phase 2
    not yet deployed) just runs ``b8f2a1c3d4e5`` followed by this merge.

No schema changes; alembic only needs the DAG node.

The alternative — rewriting ``b8f2a1c3d4e5.down_revision`` to point at
``c9d0e1f2a3b4`` — would break every environment that already has
``b8f2a1c3d4e5`` applied (like local dev), so the merge is the safe
move.

Revision ID: d0e1f2a3b4c5
Revises: b8f2a1c3d4e5, c9d0e1f2a3b4
Create Date: 2026-04-23
"""

from collections.abc import Sequence


revision: str = "d0e1f2a3b4c5"
down_revision: str | tuple[str, ...] | None = (
    "b8f2a1c3d4e5",
    "c9d0e1f2a3b4",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Merge-only; no schema changes."""
    pass


def downgrade() -> None:
    """Merge-only; no schema changes."""
    pass
