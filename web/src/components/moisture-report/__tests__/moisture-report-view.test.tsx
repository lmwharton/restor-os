import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Konva needs a real <canvas> context; jsdom doesn't have one. Stub
// react-konva at the module boundary so the view renders its
// non-canvas siblings (header, date picker, summary table). The
// actual canvas rendering is visually verified via manual QA — what
// we care about in these tests is the data flow: props → date picker
// state → summary rollup → table columns.
vi.mock("react-konva", () => {
  const stub = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="konva-stub">{children}</div>
  );
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Line: stub,
    Text: stub,
    Arc: stub,
    Group: stub,
    Circle: stub,
  };
});

import { MoistureReportView } from "../moisture-report-view";
import type {
  FloorPlanData,
} from "@/components/sketch/floor-plan-tools";
import type { MoisturePin, MoisturePinReading } from "@/lib/types";

// ─── Fixtures ──────────────────────────────────────────────────────────

function makeCanvas(): FloorPlanData {
  return {
    gridSize: 10,
    rooms: [
      {
        id: "r1",
        x: 0,
        y: 0,
        width: 200,
        height: 150,
        name: "Living Room",
        fill: "#faf7f2",
        propertyRoomId: "pr-living",
      },
    ],
    walls: [],
    doors: [],
    windows: [],
  };
}

function makePin(over: Partial<MoisturePin> = {}): MoisturePin {
  return {
    id: "pin-1",
    job_id: "job-1",
    room_id: "pr-living",
    canvas_x: 50,
    canvas_y: 50,
    location_name: "Floor, NW Corner, Living Room",
    material: "drywall",
    dry_standard: 16,
    created_by: null,
    created_at: "2026-04-20T10:00:00Z",
    updated_at: "2026-04-20T10:00:00Z",
    latest_reading: null,
    color: null,
    is_regressing: false,
    reading_count: 0,
    ...over,
  };
}

function makeReading(
  over: Partial<MoisturePinReading> & {
    id: string;
    reading_date: string;
    reading_value: number;
  },
): MoisturePinReading {
  return {
    pin_id: "pin-1",
    recorded_by: null,
    meter_photo_url: null,
    notes: null,
    created_at: `${over.reading_date}T12:00:00Z`,
    ...over,
  };
}

afterEach(() => cleanup());

function renderView(
  opts: {
    pins?: MoisturePin[];
    readingsByPinId?: Map<string, MoisturePinReading[]>;
    selectedDate?: string;
    onSelectedDateChange?: (d: string) => void;
  } = {},
) {
  const pins = opts.pins ?? [];
  const readingsByPinId = opts.readingsByPinId ?? new Map();
  const selectedDate = opts.selectedDate ?? "2026-04-22";
  // When there are pins we put them on a single floor; when there
  // are no pins the `floors` array is empty, exercising the
  // empty-state branch in the view.
  const floors = pins.length
    ? [
        {
          floorPlanId: "fp-1",
          floorName: "Main",
          floorNumber: 1,
          canvas: makeCanvas(),
          pins,
        },
      ]
    : [];
  return render(
    <MoistureReportView
      job={{
        job_number: "RM-2026-014",
        customer_name: "Brett Sodders",
        address: "1112 Stanley Dr, Augusta, GA 30909",
      }}
      company={{ name: "DryPros" }}
      floors={floors}
      readingsByPinId={readingsByPinId}
      selectedDate={selectedDate}
      onSelectedDateChange={opts.onSelectedDateChange ?? vi.fn()}
    />,
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe("MoistureReportView", () => {
  it("renders header, date picker, and summary table for a multi-reading pin", () => {
    const pin = makePin();
    const readings = [
      makeReading({ id: "r1", reading_date: "2026-04-20", reading_value: 30 }),
      makeReading({ id: "r2", reading_date: "2026-04-22", reading_value: 18 }),
      makeReading({ id: "r3", reading_date: "2026-04-24", reading_value: 14 }),
    ];
    renderView({
      pins: [pin],
      readingsByPinId: new Map([[pin.id, readings]]),
      selectedDate: "2026-04-24",
    });

    // Header shows job metadata
    expect(screen.getByText("RM-2026-014")).toBeInTheDocument();
    expect(screen.getByText(/Brett Sodders/)).toBeInTheDocument();

    // Summary table: location + material + all three day columns
    expect(
      screen.getByText("Floor, NW Corner, Living Room"),
    ).toBeInTheDocument();
    expect(screen.getByText("Drywall")).toBeInTheDocument();
    expect(screen.getByText("D1")).toBeInTheDocument();
    expect(screen.getByText("D2")).toBeInTheDocument();
    expect(screen.getByText("D3")).toBeInTheDocument();

    // Reading values present in the row
    expect(screen.getByText(/30%/)).toBeInTheDocument();
    expect(screen.getByText(/18%/)).toBeInTheDocument();
    expect(screen.getByText(/14%/)).toBeInTheDocument();
  });

  it("calls onSelectedDateChange when the date picker changes", () => {
    const pin = makePin();
    const readings = [
      makeReading({ id: "r1", reading_date: "2026-04-20", reading_value: 30 }),
      makeReading({ id: "r2", reading_date: "2026-04-22", reading_value: 18 }),
    ];
    const onSelectedDateChange = vi.fn();
    renderView({
      pins: [pin],
      readingsByPinId: new Map([[pin.id, readings]]),
      selectedDate: "2026-04-20",
      onSelectedDateChange,
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2026-04-22" } });
    expect(onSelectedDateChange).toHaveBeenCalledWith("2026-04-22");
  });

  it("computes the dry rollup against the selected date, not the latest reading", () => {
    // Pin becomes dry on Apr 24. With selectedDate=Apr 22 the rollup
    // should say 0 of 1 dry. With selectedDate=Apr 24 → 1 of 1.
    // Pins asserting "as of <selected date>" is the whole point of
    // the date-picker contract (Brett §8.6).
    const pin = makePin();
    const readings = [
      makeReading({ id: "r1", reading_date: "2026-04-20", reading_value: 30 }),
      makeReading({ id: "r2", reading_date: "2026-04-22", reading_value: 18 }),
      makeReading({ id: "r3", reading_date: "2026-04-24", reading_value: 14 }),
    ];

    // Snapshot on Apr 22 — pin NOT yet dry. The rollup renders its
    // pieces in sibling <span>s so we match by element structure:
    // find the container that says "pins dry as of …" and assert on
    // its textContent.
    const { container: c22 } = renderView({
      pins: [pin],
      readingsByPinId: new Map([[pin.id, readings]]),
      selectedDate: "2026-04-22",
    });
    expect(c22.textContent).toMatch(/0\s*of\s*1\s*pins dry/i);
    cleanup();

    // Snapshot on Apr 24 — pin IS dry.
    const { container: c24 } = renderView({
      pins: [pin],
      readingsByPinId: new Map([[pin.id, readings]]),
      selectedDate: "2026-04-24",
    });
    expect(c24.textContent).toMatch(/1\s*of\s*1\s*pins dry/i);
  });

  it("renders the no-floor-plans empty state when the job has no floors", () => {
    // When `floors` is empty (job hasn't drawn any rooms yet), the
    // view short-circuits both the canvas and the summary table into
    // one "draw rooms first" message. Regression guard: previously
    // TWO empty-state messages rendered.
    renderView({ pins: [], readingsByPinId: new Map() });
    const empties = screen.getAllByText(
      /doesn.t have any floor plans yet|no moisture pins/i,
    );
    expect(empties).toHaveLength(1);
    // Date picker still present for consistency — fallback to today.
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("shows a Dry date column value once a pin hits dry standard", () => {
    // Pin dries on Apr 22 — "D2" column + "22 Apr" should appear in
    // the Dry date column per Brett §8.5's "green checkmark with the
    // date it was achieved."
    const pin = makePin();
    const readings = [
      makeReading({ id: "r1", reading_date: "2026-04-21", reading_value: 30 }),
      makeReading({ id: "r2", reading_date: "2026-04-22", reading_value: 14 }),
    ];
    renderView({
      pins: [pin],
      readingsByPinId: new Map([[pin.id, readings]]),
      selectedDate: "2026-04-22",
    });
    // Dry date cell reads as one emerald phrase — "22 Apr · D2" — so
    // the whole-phrase match guards the shape + the day-index. The
    // date "Apr 22" also appears in the column header; this is the
    // specific combination that only appears in the Dry date cell.
    expect(screen.getByText(/Apr 22 · D2/)).toBeInTheDocument();
  });
});
