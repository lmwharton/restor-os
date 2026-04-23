"""Shared Pydantic-friendly validators.

Round-2 R11 extracted these from ``floor_plans/schemas.py`` so the same
size-cap rule can be applied to every JSONB field we accept over the API.
Without the generalization, a client could bypass W6's ``canvas_data`` cap
by pushing 10 MB into ``room_polygon`` / ``floor_openings`` / etc.
"""

from __future__ import annotations

import json
from typing import Any


def validate_json_size(
    value: Any,
    *,
    max_bytes: int,
    field_name: str,
) -> Any:
    """Raise ``ValueError`` if ``json.dumps(value)`` exceeds ``max_bytes``.

    Returns the value unchanged on success so this can be used directly as
    the body of a Pydantic ``@field_validator``. ``None`` passes through —
    callers that want to forbid NULL should add their own check.

    ``separators=(',', ':')`` mirrors what Postgres JSONB storage costs
    (no whitespace), so the cap is a faithful upper bound on row size.
    """
    if value is None:
        return value
    size = len(json.dumps(value, separators=(",", ":")))
    if size > max_bytes:
        raise ValueError(
            f"{field_name} too large: {size} bytes (max {max_bytes})"
        )
    return value


def validate_string_list(
    value: list[str] | None,
    *,
    max_items: int,
    max_item_length: int,
    field_name: str,
) -> list[str] | None:
    """Cap a list-of-strings on both count and per-item length.

    Used for ``material_flags``-shaped fields: a bounded list of short tags.
    Without the per-item cap, a single string could be arbitrarily long
    even if the list itself is short.
    """
    if value is None:
        return value
    if len(value) > max_items:
        raise ValueError(
            f"{field_name} has too many entries: {len(value)} (max {max_items})"
        )
    for i, item in enumerate(value):
        if not isinstance(item, str):
            raise ValueError(f"{field_name}[{i}] must be a string")
        if len(item) > max_item_length:
            raise ValueError(
                f"{field_name}[{i}] too long: {len(item)} chars (max {max_item_length})"
            )
    return value
