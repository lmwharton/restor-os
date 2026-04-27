/**
 * Tests for onboarding API mapping helpers.
 *
 * Networking lives elsewhere — this just locks in the UI-label →
 * backend-enum translation per Decision Log #6.
 */

import { describe, expect, it } from "vitest";
import { jobTypeChoiceToBackend } from "../onboarding-api";

describe("jobTypeChoiceToBackend", () => {
  it("maps Water/Fire/Mold to mitigation jobs with their loss type", () => {
    expect(jobTypeChoiceToBackend("Water Damage")).toEqual({
      job_type: "mitigation",
      loss_type: "water",
    });
    expect(jobTypeChoiceToBackend("Fire Damage")).toEqual({
      job_type: "mitigation",
      loss_type: "fire",
    });
    expect(jobTypeChoiceToBackend("Mold Remediation")).toEqual({
      job_type: "mitigation",
      loss_type: "mold",
    });
  });

  it("maps Reconstruction to job_type=reconstruction with loss_type=other", () => {
    // Backend `loss_type` enum requires SOME value; `other` is the safe
    // catch-all used by Spec 01F's create flow as well.
    expect(jobTypeChoiceToBackend("Reconstruction")).toEqual({
      job_type: "reconstruction",
      loss_type: "other",
    });
  });
});
