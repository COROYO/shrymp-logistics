import { describe, expect, it } from "vitest";
import type { Batch } from "@/server/firestore/schema";
import { isBatchExpired } from "@/server/picking/batch-assignability";

/** Mirrors mark-expired-batches selection logic (unit-testable without Firestore). */
function shouldMarkExpired(
  b: Pick<Batch, "remaining_qty" | "expiry_date">,
  ref: Date,
): boolean {
  return (b.remaining_qty ?? 0) > 0 && isBatchExpired(b.expiry_date, ref);
}

describe("mark-expired-batches selection", () => {
  const ref = new Date("2026-06-11T12:00:00Z");

  it("marks ACTIVE batch with stock past MHD", () => {
    expect(
      shouldMarkExpired(
        { remaining_qty: 1, expiry_date: new Date("2026-06-10") },
        ref,
      ),
    ).toBe(true);
  });

  it("skips empty batches", () => {
    expect(
      shouldMarkExpired(
        { remaining_qty: 0, expiry_date: new Date("2026-06-10") },
        ref,
      ),
    ).toBe(false);
  });

  it("skips still-valid MHD", () => {
    expect(
      shouldMarkExpired(
        { remaining_qty: 5, expiry_date: new Date("2026-06-20") },
        ref,
      ),
    ).toBe(false);
  });
});
