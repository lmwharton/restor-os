import { describe, it, expect } from "vitest";
import type { PipelineStage, JobStatus, MitigationPipelineStage, ReconPipelineStage, JobType, ReconPhaseStatus } from "../types";

describe("PipelineStage type", () => {
  it("includes job_complete as a valid stage", () => {
    const stage: PipelineStage = "job_complete";
    expect(stage).toBe("job_complete");
  });

  it("includes all expected mitigation pipeline stages", () => {
    const allStages: MitigationPipelineStage[] = [
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

  it("includes all expected reconstruction pipeline stages", () => {
    const reconStages: ReconPipelineStage[] = [
      "new",
      "scoping",
      "in_progress",
      "job_complete",
      "submitted",
      "collected",
    ];
    expect(reconStages).toHaveLength(6);
    expect(reconStages).toContain("scoping");
    expect(reconStages).toContain("in_progress");
  });
});

describe("JobStatus type", () => {
  it("includes both mitigation and reconstruction statuses", () => {
    const allStatuses: JobStatus[] = [
      "new",
      "contracted",
      "mitigation",
      "drying",
      "job_complete",
      "submitted",
      "collected",
      "scoping",
      "in_progress",
    ];
    expect(allStatuses).toHaveLength(9);
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
