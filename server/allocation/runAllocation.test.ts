import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { allocate } from "./runAllocation";
import {
  type AllocationInput,
  type VariantAvail,
  EXPRESS_TAG,
  type OrderInput,
} from "./types";

function variant(variantId: string, available: number): VariantAvail {
  return { variantId, available };
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
   * Variant v-a has 10 units available. Orders processed oldest-first:
   *   #1001 A 3  → SHIP (7 left)
   *   #1002 A 4  → SHIP (3 left)
   *   #1003 A 5  → STOP (only 3 left) — skipped, stock untouched
   *   #1004 A 3  → SHIP (0 left)  ← later, smaller order still fits
   * Net: 3 SHIP, 1 STOP. An order that doesn't fit is stopped but does NOT
   * block later orders that still fit the remaining stock.
   */
  const input: AllocationInput = {
    variants: [variant("v-a", 10)],
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
    expect(byId.get("1004")?.status).toBe("SHIP");
  });
});

describe("allocate — EXPRESS_DHL priority", () => {
  it("ships an Express order before a smaller, older standard one", () => {
    const input: AllocationInput = {
      variants: [variant("v1", 3)],
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
      variants: [variant("v1", 2)],
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
  it("returns STOP/UNKNOWN_VARIANT when a line item's variant is unknown", () => {
    const input: AllocationInput = {
      variants: [variant("v1", 5)],
      orders: [order("o1", 1, [{ variantId: "v-missing", qty: 1 }])],
    };
    const { decisions } = allocate(input);
    const d = decisions[0];
    expect(d?.status).toBe("STOP");
    if (d?.status === "STOP") expect(d.reason).toBe("UNKNOWN_VARIANT");
  });

  it("returns STOP/INSUFFICIENT_STOCK when a known variant has zero available", () => {
    const input: AllocationInput = {
      variants: [variant("v1", 5), variant("v2", 0)],
      orders: [
        order("o1", 1, [
          { variantId: "v1", qty: 1 },
          { variantId: "v2", qty: 1 },
        ]),
      ],
    };
    const { decisions } = allocate(input);
    const d = decisions[0];
    expect(d?.status).toBe("STOP");
    if (d?.status === "STOP") expect(d.reason).toBe("INSUFFICIENT_STOCK");
  });

  it("aggregates demand across line items sharing a variant", () => {
    const input: AllocationInput = {
      variants: [variant("v1", 3)],
      orders: [
        order("o1", 1, [
          { variantId: "v1", qty: 2 },
          { variantId: "v1", qty: 2 }, // total 4 > 3 available
        ]),
      ],
    };
    expect(allocate(input).decisions[0]?.status).toBe("STOP");
  });

  it("does not consume any stock from a failed (all-or-nothing) order", () => {
    const input: AllocationInput = {
      variants: [variant("v1", 5), variant("v2", 0)],
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

  it("is deterministic for the same input (tiebreak by order id)", () => {
    const input: AllocationInput = {
      variants: [variant("v1", 8)],
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
  const arbVariant = fc.record({
    variantId: fc.constantFrom("vA", "vB", "vC"),
    available: fc.integer({ min: 0, max: 20 }),
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

  function dedupe(
    variants: VariantAvail[],
    orders: OrderInput[],
  ): { variants: VariantAvail[]; orders: OrderInput[] } {
    const seenV = new Set<string>();
    const uniqV = variants.filter(
      (v) => !seenV.has(v.variantId) && seenV.add(v.variantId),
    );
    const seenO = new Set<string>();
    const uniqO = orders.filter((o) => !seenO.has(o.id) && seenO.add(o.id));
    return { variants: uniqV, orders: uniqO };
  }

  it("Σ(shipped qty per variant) ≤ that variant's available", () => {
    fc.assert(
      fc.property(
        fc.array(arbVariant, { minLength: 1, maxLength: 3 }),
        fc.array(arbOrder, { minLength: 0, maxLength: 8 }),
        (variants, orders) => {
          const input = dedupe(variants, orders);
          const availById = new Map(
            input.variants.map((v) => [v.variantId, v.available]),
          );
          const { decisions } = allocate(input);
          const ordersById = new Map(input.orders.map((o) => [o.id, o]));

          const shippedByVariant = new Map<string, number>();
          for (const d of decisions) {
            if (d.status !== "SHIP") continue;
            const o = ordersById.get(d.orderId);
            if (!o) return false;
            for (const li of o.lineItems) {
              shippedByVariant.set(
                li.variantId,
                (shippedByVariant.get(li.variantId) ?? 0) + li.qty,
              );
            }
          }
          for (const [vid, shipped] of shippedByVariant) {
            if (shipped > (availById.get(vid) ?? 0)) return false;
          }
          return true;
        },
      ),
    );
  });

  it("a SHIP decision never references an unknown variant", () => {
    fc.assert(
      fc.property(
        fc.array(arbVariant, { minLength: 1, maxLength: 3 }),
        fc.array(arbOrder, { minLength: 0, maxLength: 8 }),
        (variants, orders) => {
          const input = dedupe(variants, orders);
          const known = new Set(input.variants.map((v) => v.variantId));
          const { decisions } = allocate(input);
          const ordersById = new Map(input.orders.map((o) => [o.id, o]));
          for (const d of decisions) {
            if (d.status !== "SHIP") continue;
            const o = ordersById.get(d.orderId)!;
            for (const li of o.lineItems) {
              if (!known.has(li.variantId)) return false;
            }
          }
          return true;
        },
      ),
    );
  });
});
