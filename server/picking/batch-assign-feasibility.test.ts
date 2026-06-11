import { describe, expect, it } from "vitest";
import type { Batch } from "@/server/firestore/schema";
import { evaluateBatchAssignFeasibility } from "./batch-assign-feasibility";

function batch(
  partial: Partial<Batch> & Pick<Batch, "id" | "variant_id" | "expiry_date">,
): Batch {
  return {
    charge_number: "C1",
    remaining_qty: 10,
    status: "ACTIVE",
    on_hand_at_receipt: 10,
    production_date: null,
    notes: null,
    received_at: new Date(),
    ...partial,
  } as Batch;
}

describe("evaluateBatchAssignFeasibility", () => {
  const minDays = 3;
  const ref = new Date("2026-06-11T12:00:00Z");

  it("returns assignable when FEFO pool covers the order", () => {
    const result = evaluateBatchAssignFeasibility(
      [{ id: "li1", variant_id: "v1", qty: 2, sku: "S", title: "T" }],
      [
        batch({
          id: "b1",
          variant_id: "v1",
          expiry_date: new Date("2026-06-20"),
          remaining_qty: 5,
        }),
      ],
      minDays,
      ref,
    );
    expect(result).toEqual({ assignable: true });
  });

  it("returns BATCH_EXPIRED when only expired stock remains", () => {
    const result = evaluateBatchAssignFeasibility(
      [{ id: "li1", variant_id: "v1", qty: 1, sku: "S", title: "T" }],
      [
        batch({
          id: "b1",
          variant_id: "v1",
          expiry_date: new Date("2026-06-10"),
          remaining_qty: 5,
        }),
      ],
      minDays,
      ref,
    );
    expect(result).toEqual({ assignable: false, reason: "BATCH_EXPIRED" });
  });

  it("returns BATCH_NEAR_EXPIRY when stock is inside the cutoff window", () => {
    const result = evaluateBatchAssignFeasibility(
      [{ id: "li1", variant_id: "v1", qty: 1, sku: "S", title: "T" }],
      [
        batch({
          id: "b1",
          variant_id: "v1",
          expiry_date: new Date("2026-06-13"),
          remaining_qty: 5,
        }),
      ],
      minDays,
      ref,
    );
    expect(result).toEqual({ assignable: false, reason: "BATCH_NEAR_EXPIRY" });
  });
});
