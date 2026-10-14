import { describe, expect, it } from "vitest";
import {
  SHOPIFY_FULFILLMENT_STATUSES,
  SHOPIFY_PAYMENT_STATUSES,
  normalizeFulfillmentStatus,
  normalizePaymentStatus,
  shipStatusBlockReason,
} from "./shopify-status";

describe("normalize shopify statuses", () => {
  it("uppercases payment statuses from REST and GraphQL", () => {
    expect(normalizePaymentStatus("paid")).toBe("PAID");
    expect(normalizePaymentStatus("PARTIALLY_PAID")).toBe("PARTIALLY_PAID");
    expect(normalizePaymentStatus(null)).toBeNull();
  });

  it("maps REST fulfillment null/partial onto the display enum", () => {
    expect(normalizeFulfillmentStatus(null)).toBe("UNFULFILLED");
    expect(normalizeFulfillmentStatus("")).toBe("UNFULFILLED");
    expect(normalizeFulfillmentStatus("partial")).toBe("PARTIALLY_FULFILLED");
    expect(normalizeFulfillmentStatus("fulfilled")).toBe("FULFILLED");
    expect(normalizeFulfillmentStatus("UNFULFILLED")).toBe("UNFULFILLED");
  });
});

describe("shipStatusBlockReason", () => {
  const paidOnly = ["PAID"] as const;
  const openOnly = ["UNFULFILLED"] as const;

  it("allows paid + unfulfilled, including REST null fulfillment", () => {
    expect(shipStatusBlockReason("paid", null, paidOnly, openOnly)).toBeNull();
    expect(
      shipStatusBlockReason("PAID", "UNFULFILLED", paidOnly, openOnly),
    ).toBeNull();
  });

  it("blocks the wrong payment before fulfillment", () => {
    expect(shipStatusBlockReason("pending", null, paidOnly, openOnly)).toBe(
      "PAYMENT_STATUS",
    );
    expect(shipStatusBlockReason("paid", "fulfilled", paidOnly, openOnly)).toBe(
      "FULFILLMENT_STATUS",
    );
  });

  it("treats a complete allowlist as no extra gate", () => {
    expect(
      shipStatusBlockReason(
        null,
        "something-new",
        SHOPIFY_PAYMENT_STATUSES,
        SHOPIFY_FULFILLMENT_STATUSES,
      ),
    ).toBeNull();
  });

  it("rejects null payment once the list is narrowed", () => {
    expect(shipStatusBlockReason(null, null, paidOnly, openOnly)).toBe(
      "PAYMENT_STATUS",
    );
  });
});
