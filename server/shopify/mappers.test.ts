import { describe, expect, it } from "vitest";
import { mapShopifyOrderToFirestore } from "./mappers";

const baseOrder = {
  id: 5001,
  admin_graphql_api_id: "gid://shopify/Order/5001",
  name: "#1001",
  tags: "EXPRESS_DHL, vip",
  created_at: "2026-05-26T10:00:00Z",
  updated_at: "2026-05-26T10:01:00Z",
  financial_status: "paid",
  fulfillment_status: null,
  shipping_address: {
    first_name: "Anna",
    last_name: "Müller",
    address1: "Musterstr. 1",
    zip: "10115",
    city: "Berlin",
    country: "Germany",
    country_code: "DE",
  },
  line_items: [
    {
      id: 7001,
      variant_id: 9001,
      title: "Black Cod 200g",
      quantity: 4,
      sku: "BC-200",
    },
  ],
};

describe("mapShopifyOrderToFirestore", () => {
  it("maps tags from CSV string and preserves order id as string", () => {
    const doc = mapShopifyOrderToFirestore(baseOrder, null);
    expect(doc.id).toBe("5001");
    expect(doc.tags).toEqual(["EXPRESS_DHL", "vip"]);
    expect(doc.internal_status).toBe("NEW");
  });

  it("accepts tags as array", () => {
    const doc = mapShopifyOrderToFirestore(
      { ...baseOrder, tags: ["A", "B"] },
      null,
    );
    expect(doc.tags).toEqual(["A", "B"]);
  });

  it("maps cancelled_at to internal_status=CANCELLED", () => {
    const doc = mapShopifyOrderToFirestore(
      { ...baseOrder, cancelled_at: "2026-05-26T11:00:00Z" },
      "SHIP",
    );
    expect(doc.internal_status).toBe("CANCELLED");
  });

  it("preserves previous internal_status on re-mirror", () => {
    const doc = mapShopifyOrderToFirestore(baseOrder, "SHIP");
    expect(doc.internal_status).toBe("SHIP");
  });

  it("converts variant_id to string and builds GID", () => {
    const doc = mapShopifyOrderToFirestore(baseOrder, null);
    expect(doc.line_items[0]?.variant_id).toBe("9001");
    expect(doc.line_items[0]?.variant_gid).toBe(
      "gid://shopify/ProductVariant/9001",
    );
  });

  it("filters out line items without a variant_id", () => {
    const doc = mapShopifyOrderToFirestore(
      {
        ...baseOrder,
        line_items: [
          ...baseOrder.line_items,
          {
            id: 7002,
            variant_id: null,
            title: "Custom Gift Note",
            quantity: 1,
          },
        ],
      },
      null,
    );
    expect(doc.line_items.length).toBe(1);
  });

  it("returns null shipping_address when not provided", () => {
    const doc = mapShopifyOrderToFirestore(
      { ...baseOrder, shipping_address: null },
      null,
    );
    expect(doc.shipping_address).toBeNull();
  });

  it("maps shipping method from first shipping line", () => {
    const doc = mapShopifyOrderToFirestore(
      {
        ...baseOrder,
        shipping_lines: [
          { title: "DHL Paket Nachnahme", code: "dhl_cod" },
        ],
      },
      null,
    );
    expect(doc.shipping_method).toEqual({
      title: "DHL Paket Nachnahme",
      code: "dhl_cod",
    });
  });
});
