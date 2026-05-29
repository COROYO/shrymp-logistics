import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { allocate } from "./runAllocation";
import {
  type AllocationInput,
  type BatchAvail,
  EXPRESS_TAG,
  type OrderInput,
} from "./types";

const MS_PER_DAY = 86_400_000;

function batch(
  id: string,
  variantId: string,
  chargeNumber: string,
  remaining: number,
  daysToExpire: number,
): BatchAvail {
  return {
    id,
    variantId,
    chargeNumber,
    remaining,
    expiryDateMs: Date.now() + daysToExpire * MS_PER_DAY,
  };
}

function order(
  id: string,
  createdSeq: number,
  lineItems: { variantId: string; qty: number }[],
  tags: string[] = [],
): OrderInput {
  return {
    id,
    createdAtMs: 1_700_000_000_000 + createdSeq * 1000,
    tags,
    lineItems: lineItems.map((li, i) => ({
      id: `${id}-li-${i}`,
      variantId: li.variantId,
      qty: li.qty,
    })),
  };
}

describe("allocate — chronological standard allocation", () => {
  /**
   * Product A = 10 stk (Charge 0001: 5x @30d, 0002: 5x @60d).
   * Orders processed oldest-first (#1001 → #1004):
   *   #1001 A 3  → SHIP (0001: 5→2)
   *   #1002 A 4  → SHIP (0001: 2→0, 0002: 5→3)
   *   #1003 A 5  → STOP (only 3 left) — skipped, stock untouched
   *   #1004 A 3  → SHIP (0002: 3→0)  ← later, smaller order still fits
   * Net: 3 SHIP, 1 STOP. An order that doesn't fit is stopped but does NOT
   * block later orders that still fit the remaining stock.
   */
  const input: AllocationInput = {
    batches: [
      batch("b-a-1", "v-a", "0001", 5, 30),
      batch("b-a-2", "v-a", "0002", 5, 60),
    ],
    orders: [
      order("1001", 1, [{ variantId: "v-a", qty: 3 }]),
      order("1002", 2, [{ variantId: "v-a", qty: 4 }]),
      order("1003", 3, [{ variantId: "v-a", qty: 5 }]),
      order("1004", 4, [{ variantId: "v-a", qty: 3 }]),
    ],
  };

  const { decisions, stats } = allocate(input);
  const byId = new Map(decisions.map((d) => [d.orderId, d]));

  it("ships chronologically and skips the order that doesn't fit", () => {
    expect(stats.shipCount).toBe(3);
    expect(stats.stopCount).toBe(1);
    expect(byId.get("1001")?.status).toBe("SHIP");
    expect(byId.get("1002")?.status).toBe("SHIP");
    expect(byId.get("1003")?.status).toBe("STOP");
    expect(byId.get("1004")?.status).toBe("SHIP");
  });

  it("a stopped order does not consume stock (#1004 still ships after #1003 stops)", () => {
    const d = byId.get("1004");
    if (d?.status !== "SHIP") throw new Error("expected SHIP");
    expect(d.allocations).toEqual([
      { lineItemId: "1004-li-0", batchId: "b-a-2", qty: 3 },
    ]);
  });

  it("uses FEFO: #1001 takes only from batch 0001 (earliest MHD)", () => {
    const d = byId.get("1001");
    if (d?.status !== "SHIP") throw new Error("expected SHIP");
    expect(d.allocations).toEqual([
      { lineItemId: "1001-li-0", batchId: "b-a-1", qty: 3 },
    ]);
  });

  it("splits across batches FEFO when one is partially depleted (#1002)", () => {
    const d = byId.get("1002");
    if (d?.status !== "SHIP") throw new Error("expected SHIP");
    expect(d.allocations).toEqual([
      { lineItemId: "1002-li-0", batchId: "b-a-1", qty: 2 },
      { lineItemId: "1002-li-0", batchId: "b-a-2", qty: 2 },
    ]);
  });
});

describe("allocate — EXPRESS_DHL priority", () => {
  it("ships an Express order before a smaller standard one", () => {
    const input: AllocationInput = {
      batches: [batch("b1", "v1", "C1", 3, 10)],
      orders: [
        order("std-small", 1, [{ variantId: "v1", qty: 2 }]),
        order("express-big", 2, [{ variantId: "v1", qty: 3 }], [EXPRESS_TAG]),
      ],
    };
    const { decisions } = allocate(input);
    const byId = new Map(decisions.map((d) => [d.orderId, d]));
    expect(byId.get("express-big")?.status).toBe("SHIP");
    expect(byId.get("std-small")?.status).toBe("STOP");
  });

  it("does not block standard orders if Express cannot be fulfilled", () => {
    const input: AllocationInput = {
      batches: [batch("b1", "v1", "C1", 2, 10)],
      orders: [
        order("express-big", 1, [{ variantId: "v1", qty: 5 }], [EXPRESS_TAG]),
        order("std-fits", 2, [{ variantId: "v1", qty: 2 }]),
      ],
    };
    const { decisions } = allocate(input);
    const byId = new Map(decisions.map((d) => [d.orderId, d]));
    expect(byId.get("express-big")?.status).toBe("STOP");
    expect(byId.get("std-fits")?.status).toBe("SHIP");
  });
});

describe("allocate — edge cases", () => {
  it("returns STOP/UNKNOWN_VARIANT when a line item's variant has no batch at all", () => {
    const input: AllocationInput = {
      batches: [batch("b1", "v1", "C1", 5, 10)],
      orders: [order("o1", 1, [{ variantId: "v-missing", qty: 1 }])],
    };
    const { decisions } = allocate(input);
    const d = decisions[0];
    expect(d?.status).toBe("STOP");
    if (d?.status === "STOP") expect(d.reason).toBe("UNKNOWN_VARIANT");
  });

  it("all-or-nothing: a single missing item stops the entire order", () => {
    const input: AllocationInput = {
      batches: [batch("b1", "v1", "C1", 5, 10)], // v2 has zero
      orders: [
        order("o1", 1, [
          { variantId: "v1", qty: 1 },
          { variantId: "v2", qty: 1 },
        ]),
      ],
    };
    const { decisions } = allocate(input);
    expect(decisions[0]?.status).toBe("STOP");
  });

  it("does not consume any stock from a failed order's earlier line items", () => {
    const input: AllocationInput = {
      batches: [batch("b1", "v1", "C1", 5, 10), batch("b2", "v2", "C2", 0, 10)],
      orders: [
        order("o-fail", 1, [
          { variantId: "v1", qty: 5 },
          { variantId: "v2", qty: 1 },
        ]),
        order("o-after", 2, [{ variantId: "v1", qty: 5 }]),
      ],
    };
    const { decisions } = allocate(input);
    const byId = new Map(decisions.map((d) => [d.orderId, d]));
    expect(byId.get("o-fail")?.status).toBe("STOP");
    // o-after must still be able to take all 5 from v1
    expect(byId.get("o-after")?.status).toBe("SHIP");
  });

  it("is deterministic for the same input", () => {
    const input: AllocationInput = {
      batches: [
        batch("b1", "v1", "0001", 4, 10),
        batch("b2", "v1", "0002", 4, 20),
      ],
      orders: [
        order("oA", 1, [{ variantId: "v1", qty: 3 }]),
        order("oB", 1, [{ variantId: "v1", qty: 3 }]),
        order("oC", 1, [{ variantId: "v1", qty: 3 }]),
      ],
    };
    const r1 = allocate(input);
    const r2 = allocate(input);
    expect(r2.decisions).toEqual(r1.decisions);
  });
});

describe("allocate — invariants (property-based)", () => {
  const arbBatch = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    variantId: fc.constantFrom("vA", "vB", "vC"),
    chargeNumber: fc.string({ minLength: 1, maxLength: 4 }),
    remaining: fc.integer({ min: 0, max: 20 }),
    expiryDateMs: fc.integer({ min: 0, max: 1_000_000 }),
  });

  const arbOrder = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    createdAtMs: fc.integer({ min: 0, max: 1_000_000 }),
    tags: fc.subarray([EXPRESS_TAG, "other"]),
    lineItems: fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 8 }),
        variantId: fc.constantFrom("vA", "vB", "vC"),
        qty: fc.integer({ min: 1, max: 10 }),
      }),
      { minLength: 1, maxLength: 4 },
    ),
  });

  it("Σ(allocated per batch) ≤ that batch's remaining", () => {
    fc.assert(
      fc.property(
        fc.array(arbBatch, { minLength: 1, maxLength: 6 }),
        fc.array(arbOrder, { minLength: 0, maxLength: 8 }),
        (batches, orders) => {
          // Deduplicate ids — fast-check might emit collisions.
          const seenB = new Set<string>();
          const uniqB = batches.filter((b) => !seenB.has(b.id) && seenB.add(b.id));
          const seenO = new Set<string>();
          const uniqO = orders.filter((o) => !seenO.has(o.id) && seenO.add(o.id));

          const { decisions } = allocate({ batches: uniqB, orders: uniqO });

          const usedByBatch = new Map<string, number>();
          for (const d of decisions) {
            if (d.status === "SHIP") {
              for (const a of d.allocations) {
                usedByBatch.set(a.batchId, (usedByBatch.get(a.batchId) ?? 0) + a.qty);
              }
            }
          }
          for (const b of uniqB) {
            const used = usedByBatch.get(b.id) ?? 0;
            if (used > b.remaining) return false;
          }
          return true;
        },
      ),
    );
  });

  it("every SHIP order's allocations sum to the order's total demand per variant", () => {
    fc.assert(
      fc.property(
        fc.array(arbBatch, { minLength: 1, maxLength: 6 }),
        fc.array(arbOrder, { minLength: 0, maxLength: 8 }),
        (batches, orders) => {
          const seenB = new Set<string>();
          const uniqB = batches.filter((b) => !seenB.has(b.id) && seenB.add(b.id));
          const seenO = new Set<string>();
          const uniqO = orders.filter((o) => !seenO.has(o.id) && seenO.add(o.id));

          const { decisions } = allocate({ batches: uniqB, orders: uniqO });

          const byId = new Map(uniqO.map((o) => [o.id, o]));
          for (const d of decisions) {
            if (d.status !== "SHIP") continue;
            const order = byId.get(d.orderId);
            if (!order) return false;
            // Sum allocations by line-item id.
            const sumByLi = new Map<string, number>();
            for (const a of d.allocations) {
              sumByLi.set(a.lineItemId, (sumByLi.get(a.lineItemId) ?? 0) + a.qty);
            }
            for (const li of order.lineItems) {
              if ((sumByLi.get(li.id) ?? 0) !== li.qty) return false;
            }
          }
          return true;
        },
      ),
    );
  });
});
