import { describe, expect, it } from "vitest";
import { allocationRunMayWriteStatus } from "./status-guard";

describe("allocationRunMayWriteStatus", () => {
  it("allows the run's own states (NEW/SHIP/STOP)", () => {
    expect(allocationRunMayWriteStatus("NEW")).toBe(true);
    expect(allocationRunMayWriteStatus("SHIP")).toBe(true);
    expect(allocationRunMayWriteStatus("STOP")).toBe(true);
  });

  it("refuses terminal / in-progress states — must never resurrect them", () => {
    // The core of the double-deduction fix: a stale run must NOT write over an
    // order that has already advanced past the allocation stage.
    expect(allocationRunMayWriteStatus("PICKING")).toBe(false);
    expect(allocationRunMayWriteStatus("PACKED")).toBe(false);
    expect(allocationRunMayWriteStatus("CANCELLED")).toBe(false);
  });

  it("refuses missing / unknown status", () => {
    expect(allocationRunMayWriteStatus(null)).toBe(false);
    expect(allocationRunMayWriteStatus(undefined)).toBe(false);
  });
});
