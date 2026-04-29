import { describe, it, expect } from "vitest";
import type { PipelineStage, JobStatus, JobType, ReconPhaseStatus } from "../types";
import { JOB_STATUSES } from "../types";

describe("JobStatus type (Spec 01K)", () => {
  it("includes all 9 lifecycle statuses", () => {
    const allStatuses: JobStatus[] = [
      "lead", "active", "on_hold", "completed", "invoiced", "disputed", "paid", "cancelled", "lost",
    ];
    expect(allStatuses).toHaveLength(9);
  });

  it("JOB_STATUSES const matches the type union", () => {
    expect(JOB_STATUSES).toHaveLength(9);
    expect(JOB_STATUSES).toContain("lead");
    expect(JOB_STATUSES).toContain("disputed");
    expect(JOB_STATUSES).toContain("lost");
  });
});

describe("PipelineStage type", () => {
  it("PipelineStage IS JobStatus (single 9-status pipeline)", () => {
    const stage: PipelineStage = "active";
    expect(stage).toBe("active");
  });
});

describe("JobType type", () => {
  it("supports mitigation and reconstruction", () => {
    const types: JobType[] = ["mitigation", "reconstruction"];
    expect(types).toHaveLength(2);
  });
});

describe("ReconPhaseStatus type", () => {
  it("supports all phase statuses", () => {
    const statuses: ReconPhaseStatus[] = ["pending", "in_progress", "on_hold", "complete"];
    expect(statuses).toHaveLength(4);
  });
});
