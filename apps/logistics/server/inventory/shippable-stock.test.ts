import { describe, expect, it } from "vitest";
import type { Batch } from "@/server/firestore/schema";
import { computeShippableQtyByVariant } from "./shippable-stock";

function batch(
  partial: Partial<Batch> & Pick<Batch, "id" | "variant_id" | "expiry_date">,
): Batch {
  return {
    charge_number: "C1",
    remaining_qty: 1,
    status: "ACTIVE",
    initial_qty: 1,
    received_at: new Date(),
    ...partial,
  } as Batch;
}

describe("computeShippableQtyByVariant", () => {
  const minDays = 3;
  const ref = new Date("2026-06-11T12:00:00Z");

  it("excludes expired batch remaining_qty", () => {
    const map = computeShippableQtyByVariant(
      [
        batch({
          id: "good",
          variant_id: "v1",
          expiry_date: new Date("2026-06-20"),
          remaining_qty: 2,
        }),
        batch({
          id: "bad",
          variant_id: "v1",
          expiry_date: new Date("2026-06-10"),
          remaining_qty: 1,
        }),
      ],
      new Map(),
      minDays,
      ref,
    );
    expect(map.get("v1")).toBe(2);
  });

  it("includes open allocations on shippable batches", () => {
    const map = computeShippableQtyByVariant(
      [
        batch({
          id: "b1",
          variant_id: "v1",
          expiry_date: new Date("2026-06-20"),
          remaining_qty: 0,
        }),
      ],
      new Map([["b1", 2]]),
      minDays,
      ref,
    );
    expect(map.get("v1")).toBe(2);
  });
});
