"""Integration tests for the Phase 2 archive-guard + pin↔job cross-check.

Scripted fake-client tests (no live Supabase) that pin the two
critical-review findings into the regression suite:

1. Archive guard — every mutating endpoint on moisture_pins must call
   `raise_if_archived` on the pin's parent job before writing. The
   Phase 1 R6 fix closed this hole on floor_plans / rooms / walls;
   Phase 2 reopened it on six fresh endpoints. These tests guarantee a
   future regression shows up as a test failure, not a silent write
   against an archived job.

2. Pin↔job cross-check — reading-level CRUD used to take the URL's
   ``job_id`` for company scoping only and pass ``pin_id`` straight
   through. A tech opening ``/jobs/A/moisture-pins/pin_from_B/readings``
   could land writes on Job B (intra-company). The fix cross-checks
   ``pin.job_id == URL job_id`` and 404s on mismatch.

Pattern borrowed from TestCase2IsCurrentTOCTOU in test_floor_plans.py.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

import api.moisture_pins.service as mp_service
from api.moisture_pins.schemas import (
    MoisturePinCreate,
    MoisturePinReadingCreate,
    MoisturePinReadingUpdate,
    MoisturePinUpdate,
)
from api.shared.exceptions import AppException

# ─── Fake Supabase client ────────────────────────────────────────────────


def _result(data):
    r = MagicMock()
    r.data = data
    return r


def _make_fake_client(*, job_row: dict, pin_row: dict | None):
    """Build a fake client that returns ``job_row`` for any ``jobs`` query
    and ``pin_row`` for any ``moisture_pins`` query. Any other table or
    a mutating insert/update/delete returns empty — sufficient for the
    guard tests since execution should never reach those paths.
    """

    class QB:
        def __init__(self, table_name: str):
            self.table_name = table_name
            self.filters: dict[str, object] = {}

        def select(self, *args, **kwargs): return self
        def single(self): return self
        def order(self, *args, **kwargs): return self
        def limit(self, *args, **kwargs): return self
        def is_(self, col, val): self.filters[col] = val; return self
        def eq(self, col, val): self.filters[col] = val; return self
        def update(self, row): return self
        def insert(self, row): return self
        def delete(self): return self

        async def execute(self):
            if self.table_name == "jobs":
                return _result(job_row)
            if self.table_name == "moisture_pins":
                # Mimic PostgREST: .eq("id", ...).execute() returns a
                # list of matching rows. None ⇒ empty list.
                return _result([pin_row] if pin_row else [])
            if self.table_name == "job_rooms":
                return _result({"id": "room-1", "room_polygon": []})
            return _result([])

    class FakeClient:
        def table(self, name):
            return QB(name)

    return FakeClient()


@pytest.fixture
def ids():
    return {
        "job_id": uuid4(),
        "company_id": uuid4(),
        "user_id": uuid4(),
        "pin_id": uuid4(),
        "reading_id": uuid4(),
        "other_job_id": uuid4(),
        "room_id": uuid4(),
    }


def _archived_job_row(job_id, status="collected"):
    return {
        "id": str(job_id),
        "status": status,
        "deleted_at": None,
        "company_id": str(uuid4()),
        "property_id": str(uuid4()),
    }


def _active_job_row(job_id, company_id):
    return {
        "id": str(job_id),
        "status": "mitigation",
        "deleted_at": None,
        "company_id": str(company_id),
        "property_id": str(uuid4()),
    }


def _pin_row(pin_id, job_id):
    return {
        "id": str(pin_id),
        "job_id": str(job_id),
        "room_id": str(uuid4()),
        "company_id": str(uuid4()),
        "canvas_x": 100.0,
        "canvas_y": 100.0,
        "surface": "floor",
        "position": "C",
        "wall_segment_id": None,
        "material": "drywall",
        "dry_standard": 16.0,
    }


def _patch_client(client):
    return patch.object(
        mp_service, "get_authenticated_client", AsyncMock(return_value=client),
    )


# ─── Archive guard: every mutating endpoint rejects writes ──────────────


class TestArchiveGuardOnMutations:
    """Phase 1 R6 lesson applied to Phase 2: `raise_if_archived` (via
    `ensure_job_mutable`) must fire before any write on a job that's
    already been handed to the carrier (status = collected). Without
    this guard, a stale browser tab or a direct API caller can write
    into a frozen job."""

    @pytest.mark.asyncio
    async def test_create_pin_rejects_archived_job(self, ids):
        fake = _make_fake_client(
            job_row=_archived_job_row(ids["job_id"]),
            pin_row=None,
        )
        body = MoisturePinCreate(
            room_id=ids["room_id"],
            canvas_x=100, canvas_y=100,
            surface="floor", position="C", material="drywall",
            dry_standard=16,
            initial_reading={
                "reading_value": 15,
                "taken_at": "2026-04-22T12:00:00-04:00",
            },
        )
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.create_pin(
                    "tok",
                    job_id=ids["job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "JOB_ARCHIVED"
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_update_pin_rejects_archived_job(self, ids):
        fake = _make_fake_client(
            job_row=_archived_job_row(ids["job_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        body = MoisturePinUpdate(canvas_x=110)
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.update_pin(
                    "tok",
                    pin_id=ids["pin_id"],
                    job_id=ids["job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "JOB_ARCHIVED"

    @pytest.mark.asyncio
    async def test_delete_pin_rejects_archived_job(self, ids):
        fake = _make_fake_client(
            job_row=_archived_job_row(ids["job_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.delete_pin(
                    "tok",
                    pin_id=ids["pin_id"],
                    job_id=ids["job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                )
        assert exc.value.error_code == "JOB_ARCHIVED"

    @pytest.mark.asyncio
    async def test_create_reading_rejects_archived_job(self, ids):
        fake = _make_fake_client(
            job_row=_archived_job_row(ids["job_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        body = MoisturePinReadingCreate(
            reading_value=18, taken_at="2026-04-23T12:00:00-04:00",
        )
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.create_reading(
                    "tok",
                    pin_id=ids["pin_id"],
                    job_id=ids["job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "JOB_ARCHIVED"

    @pytest.mark.asyncio
    async def test_update_reading_rejects_archived_job(self, ids):
        fake = _make_fake_client(
            job_row=_archived_job_row(ids["job_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        body = MoisturePinReadingUpdate(reading_value=20)
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.update_reading(
                    "tok",
                    reading_id=ids["reading_id"],
                    pin_id=ids["pin_id"],
                    job_id=ids["job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "JOB_ARCHIVED"

    @pytest.mark.asyncio
    async def test_delete_reading_rejects_archived_job(self, ids):
        fake = _make_fake_client(
            job_row=_archived_job_row(ids["job_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.delete_reading(
                    "tok",
                    reading_id=ids["reading_id"],
                    pin_id=ids["pin_id"],
                    job_id=ids["job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                )
        assert exc.value.error_code == "JOB_ARCHIVED"


# ─── Cross-job pin rejection (intra-company URL swap) ────────────────────


class TestCrossJobPinRejection:
    """Even within the same company, a URL pointing at `/jobs/A/.../pin_from_B`
    must not let writes (or reads) land on B. Helper responds with 404
    PIN_NOT_FOUND — deliberately identical to the "pin doesn't exist"
    case so the error doesn't leak the pin's real parent job."""

    @pytest.mark.asyncio
    async def test_update_pin_rejects_cross_job_pin(self, ids):
        # Pin belongs to job A, URL targets job B (both unarchived, same
        # company — only the pin↔job binding catches this).
        fake = _make_fake_client(
            job_row=_active_job_row(ids["other_job_id"], ids["company_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        body = MoisturePinUpdate(canvas_x=110)
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.update_pin(
                    "tok",
                    pin_id=ids["pin_id"],
                    job_id=ids["other_job_id"],  # URL's job
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "PIN_NOT_FOUND"
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_pin_rejects_cross_job_pin(self, ids):
        fake = _make_fake_client(
            job_row=_active_job_row(ids["other_job_id"], ids["company_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.delete_pin(
                    "tok",
                    pin_id=ids["pin_id"],
                    job_id=ids["other_job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                )
        assert exc.value.error_code == "PIN_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_create_reading_rejects_cross_job_pin(self, ids):
        fake = _make_fake_client(
            job_row=_active_job_row(ids["other_job_id"], ids["company_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        body = MoisturePinReadingCreate(
            reading_value=18, taken_at="2026-04-23T12:00:00-04:00",
        )
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.create_reading(
                    "tok",
                    pin_id=ids["pin_id"],
                    job_id=ids["other_job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "PIN_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_update_reading_rejects_cross_job_pin(self, ids):
        fake = _make_fake_client(
            job_row=_active_job_row(ids["other_job_id"], ids["company_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        body = MoisturePinReadingUpdate(reading_value=20)
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.update_reading(
                    "tok",
                    reading_id=ids["reading_id"],
                    pin_id=ids["pin_id"],
                    job_id=ids["other_job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "PIN_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_delete_reading_rejects_cross_job_pin(self, ids):
        fake = _make_fake_client(
            job_row=_active_job_row(ids["other_job_id"], ids["company_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.delete_reading(
                    "tok",
                    reading_id=ids["reading_id"],
                    pin_id=ids["pin_id"],
                    job_id=ids["other_job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                )
        assert exc.value.error_code == "PIN_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_list_readings_rejects_cross_job_pin(self, ids):
        # Read-path cross-check: even without an archive guard, the
        # pin↔job binding still fires to prevent intra-company leak.
        fake = _make_fake_client(
            job_row=_active_job_row(ids["other_job_id"], ids["company_id"]),
            pin_row=_pin_row(ids["pin_id"], ids["job_id"]),
        )
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.list_readings(
                    "tok",
                    pin_id=ids["pin_id"],
                    job_id=ids["other_job_id"],
                )
        assert exc.value.error_code == "PIN_NOT_FOUND"


# ─── update_pin placement validation (HIGH #3) ───────────────────────────


def _fake_client_with_room(*, job_row, pin_row, room_row, capture=None):
    """Extended fake client that serves a configurable ``job_rooms`` row
    (for polygon validation) and optionally records the `update()`
    payload so tests can assert on it. ``capture`` is a dict the test
    can inspect after the call.

    Mirrors the existing ``_make_fake_client`` pattern; kept separate
    because HIGH #3 tests need polygon shape + update inspection, and
    collapsing both into one helper would make the archive-guard
    fixtures harder to read.
    """

    class QB:
        def __init__(self, name):
            self.name = name
            self.filters: dict[str, object] = {}
            self.update_args: dict | None = None

        def select(self, *a, **kw): return self
        def single(self): return self
        def order(self, *a, **kw): return self
        def limit(self, *a, **kw): return self
        def is_(self, col, val): self.filters[col] = val; return self
        def eq(self, col, val): self.filters[col] = val; return self
        def insert(self, row): return self
        def delete(self): return self

        def update(self, row):
            self.update_args = row
            if capture is not None and self.name == "moisture_pins":
                capture["update"] = row
            return self

        async def execute(self):
            if self.name == "jobs":
                return _result(job_row)
            if self.name == "moisture_pins":
                # Return the patched pin shape on UPDATE so update_pin
                # can continue past the empty-result 404 guard.
                if self.update_args is not None:
                    return _result([{**pin_row, **self.update_args}])
                return _result([pin_row] if pin_row else [])
            if self.name == "job_rooms":
                return _result(room_row)
            if self.name == "moisture_pin_readings":
                return _result([])
            return _result([])

    class FakeClient:
        def table(self, name): return QB(name)

    return FakeClient()


# A square polygon with corners at (0,0), (100,0), (100,100), (0,100).
_SQUARE_POLY = [
    {"x": 0, "y": 0},
    {"x": 100, "y": 0},
    {"x": 100, "y": 100},
    {"x": 0, "y": 100},
]


def _room_row(room_id, job_id, polygon):
    return {
        "id": str(room_id),
        "job_id": str(job_id),
        "room_polygon": polygon,
    }


class TestUpdatePinPlacementValidation:
    """Drag-to-move and room-swap paths now run the same point-in-polygon
    + room-belongs-to-job invariant that ``create_pin`` enforces. Guards
    the sibling-miss the reviewer flagged: prior behavior silently
    accepted any canvas coords on PATCH, orphaning pins outside any
    room polygon (canvas visibility filter then hid them — looked like
    data loss to the tech).
    """

    @pytest.mark.asyncio
    async def test_update_pin_rejects_coords_outside_polygon(self, ids):
        # Pin at (50,50) inside square [0..100] — a drag to (200, 200)
        # lands well outside. Post-fix: 400 PIN_OUTSIDE_ROOM.
        pin = _pin_row(ids["pin_id"], ids["job_id"])
        pin["room_id"] = str(ids["room_id"])
        fake = _fake_client_with_room(
            job_row=_active_job_row(ids["job_id"], ids["company_id"]),
            pin_row=pin,
            room_row=_room_row(ids["room_id"], ids["job_id"], _SQUARE_POLY),
        )
        body = MoisturePinUpdate(canvas_x=200, canvas_y=200)
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.update_pin(
                    "tok",
                    pin_id=ids["pin_id"],
                    job_id=ids["job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "PIN_OUTSIDE_ROOM"
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_update_pin_accepts_coords_inside_polygon(self, ids):
        # Same pin; a drag to (40, 60) stays within the square — no raise.
        pin = _pin_row(ids["pin_id"], ids["job_id"])
        pin["room_id"] = str(ids["room_id"])
        fake = _fake_client_with_room(
            job_row=_active_job_row(ids["job_id"], ids["company_id"]),
            pin_row=pin,
            room_row=_room_row(ids["room_id"], ids["job_id"], _SQUARE_POLY),
        )
        body = MoisturePinUpdate(canvas_x=40, canvas_y=60)
        with _patch_client(fake), patch.object(
            mp_service, "log_event", AsyncMock(return_value=None),
        ):
            result = await mp_service.update_pin(
                "tok",
                pin_id=ids["pin_id"],
                job_id=ids["job_id"],
                company_id=ids["company_id"],
                user_id=ids["user_id"],
                body=body,
            )
        assert result["canvas_x"] == 40.0
        assert result["canvas_y"] == 60.0

    @pytest.mark.asyncio
    async def test_update_pin_rejects_room_swap_to_wrong_job(self, ids):
        # Pin is on Job A; PATCH tries to move it to a room whose
        # job_id is Job B (a different job on the same company). The
        # ``job_rooms`` fake returns None for that room_id → 404
        # ROOM_NOT_FOUND — same as create_pin's behavior.
        pin = _pin_row(ids["pin_id"], ids["job_id"])
        pin["room_id"] = str(ids["room_id"])
        foreign_room = uuid4()
        fake = _fake_client_with_room(
            job_row=_active_job_row(ids["job_id"], ids["company_id"]),
            pin_row=pin,
            room_row=None,  # No room matching both id + job_id.
        )
        body = MoisturePinUpdate(room_id=foreign_room)
        with _patch_client(fake):
            with pytest.raises(AppException) as exc:
                await mp_service.update_pin(
                    "tok",
                    pin_id=ids["pin_id"],
                    job_id=ids["job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "ROOM_NOT_FOUND"
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_update_pin_material_change_auto_fills_dry_standard(self, ids):
        # API caller changes material to hardwood without sending
        # dry_standard. Backend must auto-fill with the hardwood
        # default so the per-material threshold stays consistent —
        # mirrors the UI edit sheet's behavior. Guards callers who
        # PATCH only material (e.g. future scripted flows).
        pin = _pin_row(ids["pin_id"], ids["job_id"])
        pin["room_id"] = str(ids["room_id"])
        capture: dict = {}
        fake = _fake_client_with_room(
            job_row=_active_job_row(ids["job_id"], ids["company_id"]),
            pin_row=pin,
            room_row=_room_row(ids["room_id"], ids["job_id"], _SQUARE_POLY),
            capture=capture,
        )
        body = MoisturePinUpdate(material="hardwood")
        with _patch_client(fake), patch.object(
            mp_service, "log_event", AsyncMock(return_value=None),
        ):
            await mp_service.update_pin(
                "tok",
                pin_id=ids["pin_id"],
                job_id=ids["job_id"],
                company_id=ids["company_id"],
                user_id=ids["user_id"],
                body=body,
            )
        assert capture["update"]["material"] == "hardwood"
        assert capture["update"]["dry_standard"] == 12.0  # DRY_STANDARDS["hardwood"]

    @pytest.mark.asyncio
    async def test_update_pin_material_change_respects_explicit_dry_standard(
        self, ids,
    ):
        # When the caller sends BOTH material and dry_standard, the
        # explicit value wins — no silent override by the material
        # default. Mirrors create_pin's priority order.
        pin = _pin_row(ids["pin_id"], ids["job_id"])
        pin["room_id"] = str(ids["room_id"])
        capture: dict = {}
        fake = _fake_client_with_room(
            job_row=_active_job_row(ids["job_id"], ids["company_id"]),
            pin_row=pin,
            room_row=_room_row(ids["room_id"], ids["job_id"], _SQUARE_POLY),
            capture=capture,
        )
        body = MoisturePinUpdate(material="hardwood", dry_standard=14)
        with _patch_client(fake), patch.object(
            mp_service, "log_event", AsyncMock(return_value=None),
        ):
            await mp_service.update_pin(
                "tok",
                pin_id=ids["pin_id"],
                job_id=ids["job_id"],
                company_id=ids["company_id"],
                user_id=ids["user_id"],
                body=body,
            )
        assert capture["update"]["dry_standard"] == 14.0

    @pytest.mark.asyncio
    async def test_create_pin_rejects_coords_outside_polygon(self, ids):
        # M2 — polygon validation on create. Without this guard the
        # Q6 spec rule ("pin must be placed inside the selected room;
        # whitespace drops are rejected") only existed in docstrings
        # for creation; now it's pinned as a regression test.
        room_row = _room_row(ids["room_id"], ids["job_id"], _SQUARE_POLY)
        job_row = _active_job_row(ids["job_id"], ids["company_id"])

        class _QB:
            def __init__(self, name):
                self.name = name
                self.filters: dict = {}

            def select(self, *a, **kw): return self
            def single(self): return self
            def order(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def is_(self, col, val): self.filters[col] = val; return self
            def eq(self, col, val): self.filters[col] = val; return self

            async def execute(self):
                if self.name == "jobs":
                    return _result(job_row)
                if self.name == "job_rooms":
                    return _result(room_row)
                return _result([])

        class _FakeClient:
            def table(self, name): return _QB(name)

        body = MoisturePinCreate(
            room_id=ids["room_id"],
            # (200, 200) lies well outside the [0..100] square polygon.
            canvas_x=200, canvas_y=200,
            surface="floor", position="C", material="drywall",
            dry_standard=16,
            initial_reading={
                "reading_value": 15,
                "taken_at": "2026-04-22T12:00:00-04:00",
            },
        )
        with _patch_client(_FakeClient()):
            with pytest.raises(AppException) as exc:
                await mp_service.create_pin(
                    "tok",
                    job_id=ids["job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "PIN_OUTSIDE_ROOM"
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_create_reading_allows_multiple_readings_same_day(self, ids):
        # Phase 3 Step 3 (regression pin): the UNIQUE(pin_id, reading_date)
        # index was dropped so Brett's post-demo re-inspection workflow can
        # log a 2nd reading on the same pin later the same day without the
        # 2nd save being silently rejected. Asserts the 23505/409 path is
        # gone: a second same-day insert flows through unchanged.
        job_row = _active_job_row(ids["job_id"], ids["company_id"])
        pin_row = _pin_row(ids["pin_id"], ids["job_id"])
        inserted_row = {
            "id": "00000000-0000-0000-0000-000000000099",
            "pin_id": ids["pin_id"],
            "company_id": ids["company_id"],
            "reading_value": 18,
            "taken_at": "2026-04-22T15:30:00-04:00",
            "recorded_by": ids["user_id"],
            "meter_photo_url": None,
            "notes": None,
            "created_at": "2026-04-22T19:30:00Z",
        }

        class _QB:
            def __init__(self, name):
                self.name = name
                self.filters: dict = {}
                self.inserting = False

            def select(self, *a, **kw): return self
            def single(self): return self
            def order(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def is_(self, col, val): self.filters[col] = val; return self
            def eq(self, col, val): self.filters[col] = val; return self

            def insert(self, row):
                self.inserting = True
                return self

            async def execute(self):
                if self.name == "jobs":
                    return _result(job_row)
                if self.name == "moisture_pins":
                    return _result([pin_row])
                if self.name == "moisture_pin_readings" and self.inserting:
                    return _result([inserted_row])
                return _result([])

        class _FakeClient:
            def table(self, name): return _QB(name)

        body = MoisturePinReadingCreate(
            reading_value=18, taken_at="2026-04-22T15:30:00-04:00",
        )
        with _patch_client(_FakeClient()):
            result = await mp_service.create_reading(
                "tok",
                pin_id=ids["pin_id"],
                job_id=ids["job_id"],
                company_id=ids["company_id"],
                user_id=ids["user_id"],
                body=body,
            )
        assert result["taken_at"] == "2026-04-22T15:30:00-04:00"
        assert result["reading_value"] == 18

    @pytest.mark.asyncio
    async def test_create_pin_propagates_rpc_failure_as_db_error(self, ids):
        # M3 — atomic create. The pin + initial-reading INSERT now lives
        # inside a SECURITY DEFINER RPC so any failure rolls both back
        # inside a single function-level transaction. There is no
        # Python-side compensating DELETE to go wrong anymore. If the
        # RPC itself raises (simulated here), we surface it as 500
        # DB_ERROR with no orphan state possible.
        from postgrest.exceptions import APIError as PostgrestAPIError

        job_row = _active_job_row(ids["job_id"], ids["company_id"])
        room_row = _room_row(ids["room_id"], ids["job_id"], _SQUARE_POLY)

        class _QB:
            def __init__(self, name):
                self.name = name
                self.filters: dict = {}

            def select(self, *a, **kw): return self
            def single(self): return self
            def order(self, *a, **kw): return self
            def limit(self, *a, **kw): return self
            def is_(self, col, val): self.filters[col] = val; return self
            def eq(self, col, val): self.filters[col] = val; return self

            async def execute(self):
                if self.name == "jobs":
                    return _result(job_row)
                if self.name == "job_rooms":
                    return _result(room_row)
                return _result([])

        class _FakeClient:
            def table(self, name):
                return _QB(name)

            def rpc(self, name, params):
                class _RpcQB:
                    async def execute(self):
                        # Simulate any failure inside the RPC — e.g.
                        # 23505 on the readings unique index, a
                        # transient planner error, etc. Atomic rollback
                        # happens inside the function; all we see out
                        # here is the raise.
                        raise PostgrestAPIError(
                            {"message": "simulated", "code": "XX000"},
                        )

                return _RpcQB()

        body = MoisturePinCreate(
            room_id=ids["room_id"],
            canvas_x=50, canvas_y=50,
            surface="floor", position="C", material="drywall",
            dry_standard=16,
            initial_reading={
                "reading_value": 15,
                "taken_at": "2026-04-22T12:00:00-04:00",
            },
        )
        with _patch_client(_FakeClient()):
            with pytest.raises(AppException) as exc:
                await mp_service.create_pin(
                    "tok",
                    job_id=ids["job_id"],
                    company_id=ids["company_id"],
                    user_id=ids["user_id"],
                    body=body,
                )
        assert exc.value.error_code == "DB_ERROR"
        assert exc.value.status_code == 500

    @pytest.mark.asyncio
    async def test_update_pin_partial_coord_merges_against_existing_y(self, ids):
        # Patch sends only ``canvas_x`` — the polygon check must use
        # the pin's existing ``canvas_y`` for the merged validation,
        # not drop y and fail closed. Pin at (50, 50) inside square;
        # PATCH x=70 alone → (70, 50), still inside.
        pin = _pin_row(ids["pin_id"], ids["job_id"])
        pin["room_id"] = str(ids["room_id"])
        pin["canvas_x"] = 50.0
        pin["canvas_y"] = 50.0
        fake = _fake_client_with_room(
            job_row=_active_job_row(ids["job_id"], ids["company_id"]),
            pin_row=pin,
            room_row=_room_row(ids["room_id"], ids["job_id"], _SQUARE_POLY),
        )
        body = MoisturePinUpdate(canvas_x=70)
        with _patch_client(fake), patch.object(
            mp_service, "log_event", AsyncMock(return_value=None),
        ):
            result = await mp_service.update_pin(
                "tok",
                pin_id=ids["pin_id"],
                job_id=ids["job_id"],
                company_id=ids["company_id"],
                user_id=ids["user_id"],
                body=body,
            )
        assert result["canvas_x"] == 70.0
