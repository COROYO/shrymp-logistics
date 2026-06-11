import { describe, expect, it } from "vitest";
import {
  calendarDaysUntilExpiry,
  isBatchAssignableForShipping,
} from "./batch-assignability";

describe("batch assignability (Europe/Berlin calendar days)", () => {
  const ref = new Date("2026-06-01T12:00:00+02:00");

  it("blocks when MHD is exactly minDays away", () => {
    expect(calendarDaysUntilExpiry("2026-06-11", ref)).toBe(10);
    expect(isBatchAssignableForShipping("2026-06-11", 10, ref)).toBe(false);
  });

  it("allows when MHD is one day beyond the cutoff", () => {
    expect(isBatchAssignableForShipping("2026-06-12", 10, ref)).toBe(true);
  });

  it("respects a higher configured threshold", () => {
    expect(isBatchAssignableForShipping("2026-06-14", 10, ref)).toBe(true);
    expect(isBatchAssignableForShipping("2026-06-14", 14, ref)).toBe(false);
    expect(isBatchAssignableForShipping("2026-06-16", 14, ref)).toBe(true);
  });

  it("blocks expired or same-day MHD", () => {
    expect(isBatchAssignableForShipping("2026-06-01", 10, ref)).toBe(false);
    expect(isBatchAssignableForShipping("2026-05-31", 10, ref)).toBe(false);
  });
});
