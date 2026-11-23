import { describe, expect, it } from "vitest";
import { orderMatchesQuery, normalizeOrderSearchQuery } from "./order-search";
import type { Order } from "@/server/firestore/schema";

function order(partial: Partial<Order> & Pick<Order, "id" | "name">): Order {
  return {
    tags: [],
    line_items: [],
    ...partial,
  } as Order;
}

describe("normalizeOrderSearchQuery", () => {
  it("collapses whitespace and caps length", () => {
    expect(normalizeOrderSearchQuery("  Müller   Berlin  ")).toBe("Müller Berlin");
    expect(normalizeOrderSearchQuery("a".repeat(200))).toHaveLength(80);
    expect(normalizeOrderSearchQuery(undefined)).toBe("");
  });
});

describe("orderMatchesQuery", () => {
  const sample = order({
    id: "9001",
    name: "#1042",
    tags: ["EXPRESS_DHL"],
    lieferschein_no: "L00042/26",
    customer: {
      shopify_id: "c1",
      email: "anna@example.com",
      first_name: "Anna",
      last_name: "Müller",
    },
    shipping_address: {
      first_name: "Anna",
      last_name: "Müller",
      company: null,
      address1: "Hauptstr. 1",
      address2: null,
      zip: "10115",
      city: "Berlin",
      country: "Germany",
      country_code: "DE",
      phone: null,
    },
    line_items: [
      {
        id: "li1",
        variant_id: "v1",
        variant_gid: "gid://shopify/ProductVariant/1",
        qty: 1,
        title: "Kaviar",
        sku: "CAV-50",
      },
    ],
    dhl_shipment: {
      shipment_no: "00340434161012345678",
      product: "V01PAK",
      tracking_url: "https://example.com/track",
      label_storage_path: "dhl/1.pdf",
      weight_g: 500,
      created_at: {} as Order["created_at_shopify"],
      created_by_uid: "u1",
      sandbox: false,
    },
  });

  it("matches order number with or without the hash", () => {
    expect(orderMatchesQuery(sample, "1042")).toBe(true);
    expect(orderMatchesQuery(sample, "#1042")).toBe(true);
    expect(orderMatchesQuery(sample, "1043")).toBe(false);
  });

  it("requires every token", () => {
    expect(orderMatchesQuery(sample, "müller berlin")).toBe(true);
    expect(orderMatchesQuery(sample, "müller hamburg")).toBe(false);
  });

  it("matches email, sku, tag, lieferschein and tracking number", () => {
    expect(orderMatchesQuery(sample, "anna@example.com")).toBe(true);
    expect(orderMatchesQuery(sample, "cav-50")).toBe(true);
    expect(orderMatchesQuery(sample, "express_dhl")).toBe(true);
    expect(orderMatchesQuery(sample, "L00042")).toBe(true);
    expect(orderMatchesQuery(sample, "00340434161012345678")).toBe(true);
  });

  it("treats a blank query as match-all", () => {
    expect(orderMatchesQuery(sample, "   ")).toBe(true);
  });
});
