"""Spec 01K — Job lifecycle transition matrix and helpers.

Single source of truth for which status transitions are legal, which require
a reason, which timestamp field gets set on entry, and which statuses are
considered terminal / archived / read-only.

Pure logic module — no I/O, no DB access. Backend service.py and the
PATCH /jobs/{id}/status route consume these constants. Frontend mirrors
the matrix in `web/src/lib/labels.ts` (STATUS_TRANSITIONS).
"""

# All 9 lifecycle statuses in canonical pipeline display order. The frontend
# mirrors this in `web/src/lib/types.ts` JOB_STATUSES — keep in sync.
JOB_STATUSES: tuple[str, ...] = (
    "lead", "active", "on_hold", "completed", "invoiced",
    "disputed", "paid", "cancelled", "lost",
)

# Same set, used for membership checks (mirrors the jobs_status_check constraint).
VALID_STATUSES: frozenset[str] = frozenset(JOB_STATUSES)

# Transition matrix: source → set of legal targets. Every status can move to
# every other status — opened up 2026-04-29 because contractors make mistakes
# and need an undo path. Off-happy-path transitions still require a reason
# (see `transition_needs_reason`); closeout gates still enforced via the
# closeout-checklist modal when target=`completed`.
# Mirrored on the frontend in web/src/lib/labels.ts STATUS_TRANSITIONS.
STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    s: frozenset(t for t in JOB_STATUSES if t != s) for s in JOB_STATUSES
}

# Canonical forward-pipeline transitions that never need a reason. Anything
# else (off-ramp, backward, skip-ahead) requires a reason so the audit trail
# captures *why* the contractor went off-script.
HAPPY_PATH_TRANSITIONS: frozenset[tuple[str, str]] = frozenset({
    ("lead",      "active"),
    ("active",    "completed"),
    ("completed", "invoiced"),
    ("invoiced",  "paid"),
    ("on_hold",   "active"),     # resume
    ("disputed",  "invoiced"),   # dispute resolved / supplement filed
})

# Statuses that always require a reason on transition INTO them (off-ramps + dispute).
REASON_REQUIRED: frozenset[str] = frozenset({"on_hold", "cancelled", "lost", "disputed"})


def transition_needs_reason(from_status: str, to_status: str) -> bool:
    """True if this from→to transition needs a reason. Combines:
      • Off-ramp / dispute targets (always need a reason)
      • Any move OFF the canonical happy-path forward pipeline

    Intentional happy-path transitions (lead→active, etc.) stay reason-free.
    """
    if to_status in REASON_REQUIRED:
        return True
    return (from_status, to_status) not in HAPPY_PATH_TRANSITIONS

# Per-status timestamp field set on entry. None = no timestamp field
# (e.g. lead has no timestamp because it's the default state).
TIMESTAMP_FIELDS: dict[str, str | None] = {
    "lead":      None,
    "active":    "active_at",
    "on_hold":   None,                # no on_hold_at — captured via event_history
    "completed": "completed_at",
    "invoiced":  "invoiced_at",
    "disputed":  "disputed_at",
    "paid":      "paid_at",
    "cancelled": "cancelled_at",
    "lost":      "cancelled_at",      # shared field — distinct via status value
}

# Terminal — no further transitions possible.
TERMINAL_STATUSES: frozenset[str] = frozenset({"paid", "cancelled", "lost"})

# Archived — excluded from default active-job lists.
ARCHIVED_STATUSES: frozenset[str] = frozenset({"paid", "cancelled", "lost"})

# Active list — surfaces in default views (dashboard, jobs list).
ACTIVE_LIST_STATUSES: frozenset[str] = frozenset({
    "lead", "active", "on_hold", "completed", "invoiced", "disputed",
})

# Read-only — generic PATCH /jobs/{id} rejects field updates other than payment-related.
# (Disputed unlocks the estimate, so it's NOT read-only.)
READ_ONLY_STATUSES: frozenset[str] = frozenset({"invoiced", "paid", "cancelled", "lost"})


def is_valid_status(status: str) -> bool:
    return status in VALID_STATUSES


def is_legal_transition(current: str, target: str) -> bool:
    """True if `target` is a legal next status from `current`."""
    return target in STATUS_TRANSITIONS.get(current, frozenset())


def is_archived(status: str | None) -> bool:
    return status is not None and status in ARCHIVED_STATUSES


def is_terminal(status: str | None) -> bool:
    return status is not None and status in TERMINAL_STATUSES


def event_type_for_transition(target: str) -> str:
    """Map a target status to the canonical event_type written to event_history."""
    return {
        "lost":      "job_lost",
        "cancelled": "job_cancelled",
        "disputed":  "dispute_opened",
        # disputed → invoiced becomes "dispute_resolved" — handled at call site
        # because it depends on the FROM status, not just the target.
    }.get(target, "status_changed")
