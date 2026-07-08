import { describe, expect, it } from "vitest";
import {
  berlinDayKey,
  buildDemandHistory,
  dayNumFromKey,
  learnBundleCompositions,
  toDenseSeries,
  type HistoryOrder,
} from "./history";

const NOW_MS = Date.parse("2024-06-10T12:00:00Z");

function order(partial: Partial<HistoryOrder>): HistoryOrder {
  return {
    internal_status: "PACKED",
    created_at_shopify: "2024-06-05T10:00:00Z",
    line_items: [],
    ...partial,
  };
}

const bundleOrder = order({
  created_at_shopify: "2024-06-05T10:00:00Z",
  line_items: [
    {
      variant_id: "c1",
      qty: 2,
      bundle: { group_id: "g1", variant_id: "P", quantity: 1 },
    },
    {
      variant_id: "c2",
      qty: 1,
      bundle: { group_id: "g1", variant_id: "P", quantity: 1 },
    },
  ],
});

const legacyParentOrder = order({
  created_at_shopify: "2024-06-03T10:00:00Z",
  line_items: [{ variant_id: "P", qty: 3 }],
});

describe("learnBundleCompositions", () => {
  it("derives per-unit component quantities from grouped line items", () => {
    const bom = learnBundleCompositions([bundleOrder]);
    expect(bom.get("P")?.get("c1")).toBe(2);
    expect(bom.get("P")?.get("c2")).toBe(1);
  });

  it("normalizes by parent quantity and prefers the newest composition", () => {
    const older = order({
      created_at_shopify: "2024-01-01T10:00:00Z",
      line_items: [
        {
          variant_id: "c1",
          qty: 10,
          bundle: { group_id: "g9", variant_id: "P", quantity: 2 },
        },
      ],
    });
    const bom = learnBundleCompositions([older, bundleOrder]);
    // newest (bundleOrder) wins: c1 per unit = 2, not 5
    expect(bom.get("P")?.get("c1")).toBe(2);

    const bomOldOnly = learnBundleCompositions([older]);
    expect(bomOldOnly.get("P")?.get("c1")).toBe(5); // 10 units / 2 parents
  });
});

describe("buildDemandHistory", () => {
  it("counts components directly and explodes legacy parent-SKU sales", () => {
    const history = buildDemandHistory({
      orders: [bundleOrder, legacyParentOrder],
      nowMs: NOW_MS,
      windowDays: 30,
    });
    const sum = (variantId: string) => {
      const series = history.demandByVariant.get(variantId);
      if (!series) return 0;
      let total = 0;
      for (const units of series.values()) total += units;
      return total;
    };
    expect(sum("c1")).toBe(2 + 3 * 2); // component sale + exploded legacy
    expect(sum("c2")).toBe(1 + 3 * 1);
    expect(history.demandByVariant.has("P")).toBe(false); // parent is virtual
    expect(history.explodedVariants.has("c1")).toBe(true);
    expect(history.explodedVariants.has("c2")).toBe(true);
  });

  it("ignores cancelled orders and orders outside the window", () => {
    const cancelled = order({
      internal_status: "CANCELLED",
      line_items: [{ variant_id: "c1", qty: 5 }],
    });
    const tooOld = order({
      created_at_shopify: "2023-01-01T10:00:00Z",
      line_items: [{ variant_id: "c1", qty: 7 }],
    });
    const history = buildDemandHistory({
      orders: [cancelled, tooOld],
      nowMs: NOW_MS,
      windowDays: 30,
    });
    expect(history.demandByVariant.size).toBe(0);
    expect(history.ordersCounted).toBe(0);
  });

  it("buckets by Berlin calendar day (UTC evening rolls into the next day)", () => {
    // 22:30 UTC in June = 00:30 CEST next day
    expect(berlinDayKey(Date.parse("2024-06-01T22:30:00Z"))).toBe("2024-06-02");
    expect(berlinDayKey(Date.parse("2024-06-01T21:30:00Z"))).toBe("2024-06-01");
  });
});

describe("toDenseSeries", () => {
  it("materializes a dense series from first sale to the end day", () => {
    const base = dayNumFromKey("2024-06-01");
    const sparse = new Map<number, number>([
      [base, 2],
      [base + 3, 5],
    ]);
    expect(toDenseSeries(sparse, base + 5)).toEqual([2, 0, 0, 5, 0, 0]);
  });

  it("returns null when there is no demand", () => {
    expect(toDenseSeries(new Map(), 100)).toBeNull();
  });
});
