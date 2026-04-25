"""Text-scan contracts over backend/api/jobs/service.py.

Lightweight invariants the full jobs-service test suite would also
cover at runtime, but which carry a specific review-round cost when
they fail there — these assertions catch them cheaper.

Added 2026-04-25 after round-1 critical review of PR-B2 surfaced two
bug shapes:

- CRITICAL #1: ``log_event`` kwarg was ``metadata=`` (wrong) in
  ``complete_job`` + ``reopen_job``. The helper's signature takes
  ``event_data=``. TypeError at runtime AFTER the RPC commits, so the
  endpoint 500s on a completed job — user retries, hits "already
  complete" guard.
- HIGH #2: ``update_job`` accepted status transitions into/out of the
  equipment-frozen set without going through ``complete_job`` /
  ``reopen_job``, bypassing the stamp + auto-pull + audit row.
"""

from __future__ import annotations

import re
from pathlib import Path

SERVICE_FILE = (
    Path(__file__).resolve().parents[1] / "api" / "jobs" / "service.py"
)


def _text() -> str:
    return SERVICE_FILE.read_text(encoding="utf-8")


def test_log_event_kwarg_is_event_data_not_metadata() -> None:
    """CRITICAL #1 round-1 — every log_event call in jobs/service.py
    must use event_data=, not metadata=. Mis-named kwargs surface as
    TypeError at runtime which is caught AFTER the RPC commits, so the
    endpoint reports failure on a completed job.
    """
    text = _text()
    # Must have zero metadata= kwargs in log_event calls.
    assert "metadata=" not in text, (
        "jobs/service.py contains a log_event call using metadata= — "
        "the shared helper signature is event_data=. Rename every "
        "metadata= kwarg to event_data= in log_event invocations."
    )
    # And every log_event(...) with a dict kwarg should use event_data.
    # Count: 7 pre-existing event_data= usages before PR-B2; PR-B2 adds 2.
    # Lower-bound sanity check — don't hardcode the exact count because
    # new callers land over time.
    event_data_calls = len(re.findall(r"event_data=", text))
    assert event_data_calls >= 6, (
        f"Expected at least 6 event_data= usages (4 pre-existing + 2 from "
        f"PR-B2's complete_job + reopen_job), found {event_data_calls}. "
        f"A regression dropped a log call."
    )


def test_update_job_blocks_status_transitions_into_frozen_set() -> None:
    """HIGH #2 round-1 — a PATCH /jobs/{id} that sets status='complete'
    (or 'submitted' / 'collected') must 409 with STATUS_TRANSITION_FORBIDDEN.
    The dedicated endpoints (complete_job / submission / collection flows)
    are the only way into those states.
    """
    text = _text()
    # The guard must reference all three statuses in its predicate.
    assert "STATUS_TRANSITION_FORBIDDEN" in text
    # Predicate shape: status in {'complete', 'submitted', 'collected'}.
    pattern = re.compile(
        r"new_status\s+in\s+\{[^}]*['\"]complete['\"][^}]*['\"]submitted['\"][^}]*['\"]collected['\"]",
        re.DOTALL,
    )
    assert pattern.search(text), (
        "update_job must reject transitions INTO {complete, submitted, collected}. "
        "The check should assign updates['status'] to a local and compare against "
        "that frozen set before falling through to the pre-existing "
        "MITIGATION_STATUSES / RECONSTRUCTION_STATUSES check."
    )


def test_update_job_blocks_status_transitions_out_of_frozen_set() -> None:
    """HIGH #2 symmetric — once a job is in the frozen set, PATCH
    cannot drop it back out. Reopen is the only path out of 'complete'
    (owner-only, logs to job_completion_events). Allowing PATCH to
    exit would bypass the audit row stamp.
    """
    text = _text()
    pattern = re.compile(
        r"current_status\s+in\s+\{[^}]*['\"]complete['\"][^}]*['\"]submitted['\"][^}]*['\"]collected['\"]",
        re.DOTALL,
    )
    assert pattern.search(text), (
        "update_job must also reject transitions OUT OF {complete, submitted, "
        "collected}. The check should read the current jobs row status before "
        "the UPDATE and reject if the caller is trying to leave a frozen state "
        "without going through the dedicated reopen/unsubmit/uncollect flows."
    )
