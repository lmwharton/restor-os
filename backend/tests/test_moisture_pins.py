"""Pure-function tests for moisture pin logic.

Integration tests (real endpoints, real Supabase) are deferred until the
Phase 2 UI lands and we can exercise full flows end-to-end. The rules
below are easy to get wrong silently, so they're locked in here:

- compute_pin_color: the "10 percentage points absolute" vs. "10% of the
  standard" trap. A drywall pin (dry_standard=16) turns red above 26%,
  NOT above 17.6%.
- compute_is_regressing: latest > previous with the list sorted DESC.
"""

from decimal import Decimal

import pytest

from api.moisture_pins.service import (
    DRY_STANDARDS,
    compute_is_regressing,
    compute_pin_color,
)


class TestComputePinColor:
    """Pin color boundaries: green ≤ standard, amber ≤ standard+10, red >."""

    def test_green_at_exact_standard(self):
        # Boundary: reading == standard → green (inclusive).
        assert compute_pin_color(Decimal("16"), Decimal("16")) == "green"

    def test_green_well_below_standard(self):
        assert compute_pin_color(Decimal("10"), Decimal("16")) == "green"

    def test_amber_just_above_standard(self):
        # One tenth of a point above → amber.
        assert compute_pin_color(Decimal("16.1"), Decimal("16")) == "amber"

    def test_amber_at_exact_boundary(self):
        # Boundary: reading == standard + 10 → amber (inclusive).
        assert compute_pin_color(Decimal("26"), Decimal("16")) == "amber"

    def test_red_just_above_amber_boundary(self):
        # One hundredth of a point past amber → red.
        assert compute_pin_color(Decimal("26.01"), Decimal("16")) == "red"

    def test_red_far_above_standard(self):
        assert compute_pin_color(Decimal("45"), Decimal("16")) == "red"

    def test_ten_points_is_absolute_not_relative(self):
        """Guard against the "10% of the standard" misreading of spec 8.4.

        If the rule were "10% of standard," drywall (16) would flip to
        amber above 16 and red above 17.6. Under the correct rule, 17.6
        is still amber (since 17.6 <= 16 + 10 = 26).
        """
        assert compute_pin_color(Decimal("17.6"), Decimal("16")) == "amber"

    def test_concrete_uses_lower_standard(self):
        # Concrete dries to 5% — boundary is at 15 (amber) and red above.
        assert compute_pin_color(Decimal("4"), Decimal("5")) == "green"
        assert compute_pin_color(Decimal("15"), Decimal("5")) == "amber"
        assert compute_pin_color(Decimal("15.01"), Decimal("5")) == "red"
        assert compute_pin_color(Decimal("25"), Decimal("5")) == "red"


class TestComputeIsRegressing:
    """Regression detection: latest > previous with the list sorted DESC."""

    def test_empty_list_is_not_regressing(self):
        assert compute_is_regressing([]) is False

    def test_single_reading_is_not_regressing(self):
        # Need two readings to even compute regression.
        assert compute_is_regressing([{"reading_value": 22}]) is False

    def test_latest_higher_than_previous_is_regression(self):
        # Sorted DESC: [0] is latest, [1] is previous.
        readings = [
            {"reading_value": 28, "taken_at": "2026-04-20T12:00:00+00:00"},
            {"reading_value": 22, "taken_at": "2026-04-19T12:00:00+00:00"},
        ]
        assert compute_is_regressing(readings) is True

    def test_latest_lower_than_previous_is_not_regression(self):
        readings = [
            {"reading_value": 22, "taken_at": "2026-04-20T12:00:00+00:00"},
            {"reading_value": 28, "taken_at": "2026-04-19T12:00:00+00:00"},
        ]
        assert compute_is_regressing(readings) is False

    def test_latest_equal_to_previous_is_not_regression(self):
        readings = [
            {"reading_value": 22, "taken_at": "2026-04-20T12:00:00+00:00"},
            {"reading_value": 22, "taken_at": "2026-04-19T12:00:00+00:00"},
        ]
        assert compute_is_regressing(readings) is False

    def test_only_latest_two_matter(self):
        # Older readings don't affect the flag.
        readings = [
            {"reading_value": 22, "taken_at": "2026-04-20T12:00:00+00:00"},
            {"reading_value": 28, "taken_at": "2026-04-19T12:00:00+00:00"},
            {"reading_value": 100, "taken_at": "2026-04-18T12:00:00+00:00"},
        ]
        assert compute_is_regressing(readings) is False


class TestDryStandards:
    """The hardcoded material → standard dict is the default source for
    new pins. Locking in the values to prevent silent drift."""

    @pytest.mark.parametrize(
        "material,expected",
        [
            ("drywall", Decimal("16")),
            ("wood_subfloor", Decimal("15")),
            ("carpet_pad", Decimal("16")),
            ("concrete", Decimal("5")),
            ("hardwood", Decimal("12")),
            ("osb_plywood", Decimal("18")),
            ("block_wall", Decimal("10")),
        ],
    )
    def test_material_defaults(self, material, expected):
        assert DRY_STANDARDS[material] == expected

    def test_tile_is_not_in_dict(self):
        # Tile is non-absorbent; spec explicitly excludes it.
        assert "tile" not in DRY_STANDARDS
