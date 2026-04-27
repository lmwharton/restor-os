import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { MoistureReadingSheet } from "../moisture-reading-sheet";
import type { MoisturePin, MoisturePinReading } from "@/lib/types";

// These are the integration tests for the flows I most recently shipped
// on the reading sheet — last-reading delete guard, ConfirmModal wiring,
// loading skeleton, local-date write. Pure derivation logic is covered
// by `src/lib/__tests__/moisture-reading-history.test.ts`; these focus
// on "did the component wire the extracted logic through correctly."

// ─── Hook mocks ────────────────────────────────────────────────────────

vi.mock("@/lib/hooks/use-moisture-pins", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/hooks/use-moisture-pins")
  >("@/lib/hooks/use-moisture-pins");
  return {
    ...actual,
    usePinReadings: vi.fn(),
    useCreatePinReading: vi.fn(),
    useUpdatePinReading: vi.fn(),
    useDeletePinReading: vi.fn(),
  };
});

// Import the mocked module so individual tests can steer return values.
import {
  usePinReadings,
  useCreatePinReading,
  useUpdatePinReading,
  useDeletePinReading,
} from "@/lib/hooks/use-moisture-pins";

const mockedUsePinReadings = vi.mocked(usePinReadings);
const mockedUseCreatePinReading = vi.mocked(useCreatePinReading);
const mockedUseUpdatePinReading = vi.mocked(useUpdatePinReading);
const mockedUseDeletePinReading = vi.mocked(useDeletePinReading);

// ─── Fixtures ──────────────────────────────────────────────────────────

function makePin(overrides: Partial<MoisturePin> = {}): MoisturePin {
  return {
    id: "pin-1",
    job_id: "job-1",
    room_id: "room-1",
    canvas_x: 120,
    canvas_y: 80,
    surface: "floor",
    position: "C",
    wall_segment_id: null,
    material: "drywall",
    dry_standard: 16,
    created_by: null,
    created_at: "2026-04-20T10:00:00Z",
    updated_at: "2026-04-22T10:00:00Z",
    latest_reading: null,
    color: null,
    is_regressing: false,
    reading_count: 0,
    ...overrides,
  };
}

function makeReading(
  overrides: Partial<MoisturePinReading> & {
    id: string;
    taken_at: string;
    reading_value: number;
  },
): MoisturePinReading {
  return {
    pin_id: "pin-1",
    recorded_by: null,
    meter_photo_url: null,
    notes: null,
    created_at: "2026-04-22T12:00:00Z",
    ...overrides,
  };
}

/**
 * Build a shape that matches the fraction of the TanStack Query
 * return value our component reads. Cast once at the call site rather
 * than trying to satisfy the full `UseQueryResult` union here — the
 * component never touches the rest.
 */
function readingsQueryResult(opts: {
  data: MoisturePinReading[] | undefined;
  isPending: boolean;
}) {
  return { ...opts } as unknown as ReturnType<typeof usePinReadings>;
}

function stubMutation() {
  const mutate = vi.fn();
  return {
    fn: mutate,
    value: {
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreatePinReading>,
  };
}

// ─── Setup ─────────────────────────────────────────────────────────────

let createMutate: ReturnType<typeof vi.fn>;
let updateMutate: ReturnType<typeof vi.fn>;
let deleteMutate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const createStub = stubMutation();
  const updateStub = stubMutation();
  const deleteStub = stubMutation();
  createMutate = createStub.fn;
  updateMutate = updateStub.fn;
  deleteMutate = deleteStub.fn;
  mockedUseCreatePinReading.mockReturnValue(createStub.value);
  mockedUseUpdatePinReading.mockReturnValue(
    updateStub.value as unknown as ReturnType<typeof useUpdatePinReading>,
  );
  mockedUseDeletePinReading.mockReturnValue(
    deleteStub.value as unknown as ReturnType<typeof useDeletePinReading>,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function renderSheet(
  props: Partial<React.ComponentProps<typeof MoistureReadingSheet>> = {},
) {
  return render(
    <MoistureReadingSheet
      open
      jobId="job-1"
      pin={makePin()}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

// ─── Loading skeleton ──────────────────────────────────────────────────

describe("loading state", () => {
  it("renders the skeleton while the readings query is pending", () => {
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({ data: undefined, isPending: true }),
    );

    renderSheet();

    // aria-busy region is the single, stable skeleton anchor.
    expect(
      screen.getByLabelText(/loading reading history/i),
    ).toBeInTheDocument();
    // Real history list headings shouldn't appear while pending.
    expect(screen.queryByText(/reading[s]? logged/i)).not.toBeInTheDocument();
  });

  it("swaps skeleton for real history once data arrives", () => {
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({
        data: [
          makeReading({
            id: "r1",
            taken_at: "2026-04-21T12:00:00Z",
            reading_value: 14,
          }),
          makeReading({
            id: "r2",
            taken_at: "2026-04-22T12:00:00Z",
            reading_value: 18,
          }),
        ],
        isPending: false,
      }),
    );

    renderSheet();

    // Skeleton gone
    expect(
      screen.queryByLabelText(/loading reading history/i),
    ).not.toBeInTheDocument();
    // Real reading count label present
    expect(screen.getByText(/2 readings/i)).toBeInTheDocument();
  });
});

// ─── Last-reading delete guard ─────────────────────────────────────────

describe("last-reading delete guard", () => {
  it("disables the trash button when there is exactly one reading", () => {
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({
        data: [
          makeReading({
            id: "only",
            taken_at: "2026-04-22T12:00:00Z",
            reading_value: 15,
          }),
        ],
        isPending: false,
      }),
    );

    renderSheet();

    const trash = screen.getByRole("button", {
      name: /last reading.*delete the pin/i,
    });
    expect(trash).toBeDisabled();
  });

  it("enables trash buttons when there are multiple readings", () => {
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({
        data: [
          makeReading({
            id: "r1",
            taken_at: "2026-04-21T12:00:00Z",
            reading_value: 14,
          }),
          makeReading({
            id: "r2",
            taken_at: "2026-04-22T12:00:00Z",
            reading_value: 18,
          }),
        ],
        isPending: false,
      }),
    );

    renderSheet();

    const trashes = screen.getAllByRole("button", {
      name: /delete \d+(\.\d+)?% reading from/i,
    });
    expect(trashes).toHaveLength(2);
    trashes.forEach((btn) => expect(btn).toBeEnabled());
  });
});

// ─── Delete flow ────────────────────────────────────────────────────────

describe("delete reading flow", () => {
  beforeEach(() => {
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({
        data: [
          makeReading({
            id: "r1",
            taken_at: "2026-04-21T12:00:00Z",
            reading_value: 14,
          }),
          makeReading({
            id: "r2",
            taken_at: "2026-04-22T12:00:00Z",
            reading_value: 18,
          }),
        ],
        isPending: false,
      }),
    );
  });

  it("opens a ConfirmModal with the row's value + date", () => {
    renderSheet();

    const trash = screen.getByRole("button", {
      name: /delete 14% reading from/i,
    });
    fireEvent.click(trash);

    // Dialog role comes from ConfirmModal
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/delete reading/i);
    expect(dialog).toHaveTextContent(/14%/);
  });

  it("fires the delete mutation with the correct reading id on confirm", () => {
    renderSheet();

    const trash = screen.getByRole("button", {
      name: /delete 14% reading from/i,
    });
    fireEvent.click(trash);

    const confirm = screen.getByRole("button", { name: /^delete$/i });
    fireEvent.click(confirm);

    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate).toHaveBeenCalledWith("r1", expect.any(Object));
  });

  it("closes the ConfirmModal without mutating on Cancel", () => {
    renderSheet();

    const trash = screen.getByRole("button", {
      name: /delete 14% reading from/i,
    });
    fireEvent.click(trash);

    // Scope to the dialog — the sheet footer also has a Cancel
    // button, and an unscoped query would find both.
    const dialog = screen.getByRole("dialog");
    const cancel = within(dialog).getByRole("button", {
      name: /^cancel$/i,
    });
    fireEvent.click(cancel);

    expect(deleteMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ─── Today's reading uses local date ───────────────────────────────────

describe("today identification uses local date", () => {
  it("prefills the input when a reading matches today's local date", () => {
    // Freeze the clock at 8 PM on Apr 22 local. A UTC-based "today"
    // would be Apr 23 here and would miss the Apr 22 row — this
    // pins the fix that uses todayLocalIso.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 20, 0, 0));

    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({
        data: [
          makeReading({
            id: "today-row",
            taken_at: "2026-04-22T12:00:00Z",
            reading_value: 18,
          }),
        ],
        isPending: false,
      }),
    );

    renderSheet();

    const input = screen.getByPlaceholderText(/meter value/i) as HTMLInputElement;
    // Component prefills from today's stored value via the effect at
    // render — assert on the DOM value, not React state.
    expect(input.value).toBe("18");
  });

  it("re-seeds the input when today's reading arrives AFTER mount (cold open)", () => {
    // Regression guard: prior logic keyed prefill on pin.id alone.
    // On cold open the readings query is pending at mount —
    // todayReading is null, input seeds to "". When data arrives
    // with a today-row, the old logic didn't re-seed (pin.id
    // unchanged) and the tech saw an empty input even though the
    // DB had 67% for today. Now we track todayReading.id too and
    // re-seed once, before the user touches the input.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 10, 0, 0));

    // First render: query still pending.
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({ data: undefined, isPending: true }),
    );
    const { rerender } = renderSheet();
    const inputBefore = screen.getByPlaceholderText(/meter value/i) as HTMLInputElement;
    expect(inputBefore.value).toBe("");

    // Second render: query settles with today's reading at 67%.
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({
        data: [
          makeReading({
            id: "today-row",
            taken_at: "2026-04-22T12:00:00Z",
            reading_value: 67,
          }),
        ],
        isPending: false,
      }),
    );
    rerender(
      <MoistureReadingSheet
        open
        jobId="job-1"
        pin={makePin()}
        onClose={vi.fn()}
      />,
    );
    const inputAfter = screen.getByPlaceholderText(/meter value/i) as HTMLInputElement;
    expect(inputAfter.value).toBe("67");
  });

  it("does NOT re-seed after the user has typed (guards the L3 case)", () => {
    // The cold-open re-seed must NOT stomp an in-progress typed
    // value if the tech started typing before the query settled.
    // This is the exact regression that motivated the original L3
    // fix; the 2-key logic preserves it via userTypedRef.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 10, 0, 0));

    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({ data: undefined, isPending: true }),
    );
    const { rerender } = renderSheet();
    const input = screen.getByPlaceholderText(/meter value/i) as HTMLInputElement;

    // Tech types "42" while the query is still pending.
    fireEvent.change(input, { target: { value: "42" } });
    expect(input.value).toBe("42");

    // Data arrives — MUST NOT overwrite the typed 42 with the
    // stored today-reading.
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({
        data: [
          makeReading({
            id: "today-row",
            taken_at: "2026-04-22T12:00:00Z",
            reading_value: 67,
          }),
        ],
        isPending: false,
      }),
    );
    rerender(
      <MoistureReadingSheet
        open
        jobId="job-1"
        pin={makePin()}
        onClose={vi.fn()}
      />,
    );
    expect(input.value).toBe("42");
  });
});

// ─── Read-only mode (archived jobs) ────────────────────────────────────

describe("read-only mode", () => {
  beforeEach(() => {
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({
        data: [
          makeReading({
            id: "r1",
            taken_at: "2026-04-21T12:00:00Z",
            reading_value: 14,
          }),
          makeReading({
            id: "r2",
            taken_at: "2026-04-22T12:00:00Z",
            reading_value: 18,
          }),
        ],
        isPending: false,
      }),
    );
  });

  it("hides the Today's reading input, Save button, Edit chip, and trash buttons", () => {
    renderSheet({ readOnly: true, onEditRequest: vi.fn() });

    // History still renders (can audit past values)
    expect(screen.getByText(/2 readings/i)).toBeInTheDocument();

    // Write surfaces all gone
    expect(screen.queryByPlaceholderText(/meter value/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^save$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit pin settings/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryAllByRole("button", { name: /delete \d+(\.\d+)?% reading/i }),
    ).toHaveLength(0);
  });

  it("renders a single Close button instead of Cancel + Save", () => {
    renderSheet({ readOnly: true });

    expect(
      screen.getByRole("button", { name: /^close$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^cancel$/i }),
    ).not.toBeInTheDocument();
  });
});

// ─── Edit chip wiring ──────────────────────────────────────────────────

describe("edit affordance", () => {
  it("renders the Edit chip only when onEditRequest is supplied", () => {
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({ data: [], isPending: false }),
    );

    const { rerender } = renderSheet({ onEditRequest: undefined });
    expect(
      screen.queryByRole("button", { name: /edit pin settings/i }),
    ).not.toBeInTheDocument();

    rerender(
      <MoistureReadingSheet
        open
        jobId="job-1"
        pin={makePin()}
        onClose={vi.fn()}
        onEditRequest={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /edit pin settings/i }),
    ).toBeInTheDocument();
  });

  it("calls onEditRequest with the pin id when tapped", () => {
    mockedUsePinReadings.mockReturnValue(
      readingsQueryResult({ data: [], isPending: false }),
    );
    const onEditRequest = vi.fn();
    renderSheet({ onEditRequest });

    fireEvent.click(
      screen.getByRole("button", { name: /edit pin settings/i }),
    );
    expect(onEditRequest).toHaveBeenCalledWith("pin-1");
  });
});
