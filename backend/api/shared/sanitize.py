"""Input sanitization helpers for PostgREST query safety."""

import re


def sanitize_postgrest_search(search: str) -> str:
    """Sanitize a user-supplied search string for safe use in PostgREST .or_() filters.

    PostgREST filter strings use dots and commas as operators (e.g. `.ilike.`, `.eq.`,
    commas to separate clauses). If user input is interpolated directly into an .or_()
    string, an attacker can inject additional filter operators.

    This function strips the input down to characters that are safe for
    address/name searches: alphanumeric, spaces, hyphens, apostrophes, and hash
    (for unit numbers like "#2B").

    Returns an empty string if nothing remains after sanitization.
    """
    # Strip leading/trailing whitespace
    cleaned = search.strip()

    # Allow only safe characters for address/name searches
    # Letters, digits, spaces, hyphens, apostrophes, hash signs
    cleaned = re.sub(r"[^a-zA-Z0-9\s\-'#]", "", cleaned)

    # Collapse multiple spaces into one
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    return cleaned
