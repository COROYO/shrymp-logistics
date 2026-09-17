import { describe, expect, it } from "vitest";
import { evaluateConditions } from "./conditions";
import type { EvalContext } from "./context";
import { mergeAutomationLineItems, effectiveOrderTags } from "./order-tags";

const baseCtx: EvalContext = {
  order: {
    id: "1",
    name: "#1001",
    tags: ["vip"],
    local_tags: [],
    effective_tags: ["vip"],
    total_price_cents: 12_000,
    currency: "EUR",
    shipping_country_code: "DE",
    shipping_method_code: null,
    shipping_method_title: null,
    skus: ["SKU-A"],
    variant_ids: ["v1"],
    product_ids: ["p1"],
    product_types: ["Food"],
    has_priority_tag: false,
    priority_score: 0,
    automation_hold: false,
    financial_status: "paid",
    has_fragile: false,
    has_oversized: false,
    has_hazmat: false,
  },
  customer: {
    shopify_id: "c1",
    email: "a@b.c",
    ltv_cents: 60_000,
    order_count: 25,
  },
  inbound: null,
};

describe("evaluateConditions", () => {
  it("matches empty conditions", () => {
    expect(evaluateConditions(undefined, baseCtx)).toBe(true);
  });

  it("AND: LTV and order count", () => {
    const node = {
      all: [
        { field: "customer.ltv_cents", op: "gt" as const, value: 50_000 },
        { field: "customer.order_count", op: "gt" as const, value: 20 },
      ],
    };
    expect(evaluateConditions(node, baseCtx)).toBe(true);
    expect(
      evaluateConditions(
        {
          all: [
            { field: "customer.ltv_cents", op: "gt" as const, value: 50_000 },
            { field: "customer.order_count", op: "gt" as const, value: 30 },
          ],
        },
        baseCtx,
      ),
    ).toBe(false);
  });

  it("OR groups", () => {
    const node = {
      any: [
        { field: "customer.ltv_cents", op: "gt" as const, value: 1_000_000 },
        { field: "order.tags", op: "contains" as const, value: "vip" },
      ],
    };
    expect(evaluateConditions(node, baseCtx)).toBe(true);
  });

  it("SKU contains", () => {
    expect(
      evaluateConditions(
        { field: "order.skus", op: "contains", value: "SKU-A" },
        baseCtx,
      ),
    ).toBe(true);
  });
});

describe("order-tags helpers", () => {
  it("merges local tags", () => {
    expect(
      effectiveOrderTags({ tags: ["A"], local_tags: ["A", "B"] }),
    ).toEqual(["A", "B"]);
  });

  it("preserves automation line items on mirror", () => {
    const shopify = [{ id: "1", source: "shopify" }];
    const prev = [
      { id: "1", source: "shopify" },
      { id: "auto:r:v", source: "automation" },
    ];
    expect(mergeAutomationLineItems(shopify, prev)).toEqual([
      { id: "1", source: "shopify" },
      { id: "auto:r:v", source: "automation" },
    ]);
  });
});
