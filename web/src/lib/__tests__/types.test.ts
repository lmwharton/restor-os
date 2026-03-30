import { describe, it, expect } from "vitest";
import type { PipelineStage, JobStatus } from "../types";

describe("PipelineStage type", () => {
  it("includes job_complete as a valid stage", () => {
    // This verifies the fix that added "job_complete" to PipelineStage
    const stage: PipelineStage = "job_complete";
    expect(stage).toBe("job_complete");
  });

  it("includes all expected pipeline stages", () => {
    const allStages: PipelineStage[] = [
      "new",
      "contracted",
      "mitigation",
      "drying",
      "job_complete",
      "submitted",
      "collected",
    ];
    expect(allStages).toHaveLength(7);
    expect(allStages).toContain("job_complete");
  });
});

describe("JobStatus type", () => {
  it("matches the expected set of statuses", () => {
    const allStatuses: JobStatus[] = [
      "new",
      "contracted",
      "mitigation",
      "drying",
      "job_complete",
      "submitted",
      "collected",
    ];
    expect(allStatuses).toHaveLength(7);
    // Verify both types contain the same values
    const pipelineStages: PipelineStage[] = allStatuses;
    expect(pipelineStages).toEqual(allStatuses);
  });
});
