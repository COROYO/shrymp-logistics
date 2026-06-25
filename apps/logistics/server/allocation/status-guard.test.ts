import { describe, expect, it } from "vitest";
import {
  allocationRunMayWriteStatus,
  mirrorInternalStatus,
} from "./status-guard";

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

describe("mirrorInternalStatus", () => {
  it("preserves an existing order's status — never reverts PACKED/PICKING→SHIP", () => {
    for (const s of ["NEW", "SHIP", "STOP", "PICKING", "PACKED"] as const) {
      expect(mirrorInternalStatus(s, false)).toBe(s);
    }
  });

  it("initialises a brand-new order to NEW", () => {
    expect(mirrorInternalStatus(null, false)).toBe("NEW");
    expect(mirrorInternalStatus(undefined, false)).toBe("NEW");
  });

  it("moves forward to CANCELLED on cancellation, from any state", () => {
    for (const s of ["NEW", "SHIP", "PACKED", null] as const) {
      expect(mirrorInternalStatus(s, true)).toBe("CANCELLED");
    }
  });
});
