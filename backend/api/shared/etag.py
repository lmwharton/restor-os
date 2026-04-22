"""Shared ``etag`` helpers for optimistic-concurrency guards.

Round 3: a second critical review caught that ``compute_etag`` (in
``api/floor_plans/schemas.py``) and ``_coerce_etag`` (in
``api/floor_plans/service.py``) had identical bodies but diverged on
the ``None`` case — one returned ``None``, the other returned ``""``.
That's exactly the sibling-miss / silent-drift pattern the round-3
reviewer flagged. One helper, one semantic.

Semantics in one place:
  * ``None`` → ``None`` (no etag available; caller branches on it)
  * ``str``  → pass-through (already serialized by Postgres/Supabase)
  * ``datetime`` → ISO-8601 string (matches to_jsonb() wire format)

Equality comparison is handled by :func:`etags_match`, which normalizes
both sides via ``datetime.fromisoformat`` so microsecond-precision
drift in serialization (``"+00:00"`` vs ``".000000+00:00"``) doesn't
produce spurious 412s. An earlier version of the compare was raw string
equality; the docstring claimed parse-based normalization but the code
didn't do it — real bug fixed here.
"""

from __future__ import annotations

from datetime import datetime


def etag_from_updated_at(updated_at: datetime | str | None) -> str | None:
    """Derive a row's opaque etag from its ``updated_at`` value.

    ``None`` passes through as ``None`` so callers can explicitly detect
    "no etag" and skip the If-Match compare. Don't coerce to ``""`` — an
    empty string is truthy in Python and trips up frontend falsy-checks
    where a missing header was intended.
    """
    if updated_at is None:
        return None
    if isinstance(updated_at, str):
        return updated_at
    return updated_at.isoformat()


def etags_match(current: str | None, received: str | None) -> bool:
    """Compare two etags for conditional-write purposes.

    Returns ``True`` when the etags are equivalent. Both sides are parsed
    via :func:`datetime.fromisoformat` so formatting drift (microseconds
    precision, timezone representation) doesn't cause a spurious 412.
    Falls back to plain string equality if either side isn't a valid
    ISO-8601 string — covers hand-crafted test inputs and any future
    non-timestamp etag source.

    When either side is ``None``, returns ``False``. Callers decide
    separately whether a missing header should skip the check (backward
    compat during rollout) or fail the request.
    """
    if current is None or received is None:
        return False
    if current == received:
        return True  # fast path
    try:
        c = datetime.fromisoformat(current)
        r = datetime.fromisoformat(received)
    except (TypeError, ValueError):
        return False
    return c == r
