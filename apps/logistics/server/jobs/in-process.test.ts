import { describe, expect, it } from "vitest";
import { msUntilNextUtcHour } from "./in-process";

describe("in-process schedule", () => {
  it("waits until the next 03:00 UTC", () => {
    expect(msUntilNextUtcHour(3, Date.parse("2026-01-01T02:00:00.000Z"))).toBe(
      60 * 60 * 1000,
    );
    expect(msUntilNextUtcHour(3, Date.parse("2026-01-01T04:00:00.000Z"))).toBe(
      23 * 60 * 60 * 1000,
    );
    expect(msUntilNextUtcHour(3, Date.parse("2026-01-01T03:00:00.000Z"))).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});
