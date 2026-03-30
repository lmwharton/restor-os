"""Tests for PostgREST search input sanitization."""

import pytest

from api.shared.sanitize import sanitize_postgrest_search


class TestSanitizePostgrestSearch:
    """Unit tests for sanitize_postgrest_search."""

    def test_normal_name(self):
        assert sanitize_postgrest_search("Brett") == "Brett"

    def test_normal_address(self):
        assert sanitize_postgrest_search("456 Oak Ave") == "456 Oak Ave"

    def test_address_with_unit(self):
        assert sanitize_postgrest_search("123 Main St #2B") == "123 Main St #2B"

    def test_name_with_apostrophe(self):
        assert sanitize_postgrest_search("O'Brien") == "O'Brien"

    def test_hyphenated_name(self):
        assert sanitize_postgrest_search("Smith-Jones") == "Smith-Jones"

    def test_strips_whitespace(self):
        assert sanitize_postgrest_search("  hello  ") == "hello"

    def test_collapses_multiple_spaces(self):
        assert sanitize_postgrest_search("hello   world") == "hello world"

    def test_strips_commas(self):
        """Commas are PostgREST clause separators -- must be stripped."""
        assert sanitize_postgrest_search("hello,world") == "helloworld"

    def test_strips_dots(self):
        """Dots are PostgREST operator separators -- must be stripped."""
        assert sanitize_postgrest_search("address.ilike.hack") == "addressilikehack"

    def test_strips_postgrest_injection_ilike(self):
        """Full PostgREST injection attempt with .ilike. operator."""
        malicious = "test%,email.ilike.%admin%"
        result = sanitize_postgrest_search(malicious)
        # Should strip %, commas, dots
        assert "," not in result
        assert "." not in result
        assert "%" not in result

    def test_strips_postgrest_injection_eq(self):
        """PostgREST injection attempt with .eq. operator."""
        malicious = "x,status.eq.new"
        result = sanitize_postgrest_search(malicious)
        assert "," not in result
        assert "." not in result

    def test_strips_percent_signs(self):
        """Percent signs used in LIKE wildcards -- must be stripped."""
        assert sanitize_postgrest_search("100%") == "100"

    def test_strips_parentheses(self):
        assert sanitize_postgrest_search("test(injection)") == "testinjection"

    def test_empty_string(self):
        assert sanitize_postgrest_search("") == ""

    def test_only_special_chars_returns_empty(self):
        assert sanitize_postgrest_search(".,,%()") == ""

    def test_whitespace_only_returns_empty(self):
        assert sanitize_postgrest_search("   ") == ""
