import { describe, expect, it } from "vitest";
import { isActiveConsumption, orderHasActiveConsumption } from "./consume-guard";

describe("isActiveConsumption", () => {
  it("counts consumed, non-released rows", () => {
    expect(isActiveConsumption({ consumed_at: new Date() as never, released: false })).toBe(true);
  });

  it("ignores open allocations", () => {
    expect(isActiveConsumption({ consumed_at: undefined, released: false })).toBe(false);
  });

  it("ignores released rows (cancel after print audit trail)", () => {
    expect(
      isActiveConsumption({ consumed_at: new Date() as never, released: true }),
    ).toBe(false);
  });
});

describe("orderHasActiveConsumption", () => {
  it("returns true if any line was consumed", () => {
    expect(
      orderHasActiveConsumption([
        { consumed_at: undefined, released: false },
        { consumed_at: new Date() as never, released: false },
      ]),
    ).toBe(true);
  });

  it("returns false for all-open or all-released", () => {
    expect(orderHasActiveConsumption([{ consumed_at: undefined, released: false }])).toBe(
      false,
    );
    expect(
      orderHasActiveConsumption([
        { consumed_at: new Date() as never, released: true },
      ]),
    ).toBe(false);
  });
});
