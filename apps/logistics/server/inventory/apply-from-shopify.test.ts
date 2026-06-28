import { describe, expect, it } from "vitest";
import { mirrorShopifyAvailableQty } from "@/server/inventory/apply-from-shopify";
import {
  shopifyAvailableByLocationFromVariantNode,
  shopifyAvailableFromVariantNode,
} from "@/server/shopify/queries";
import type { ShopifyVariantNode } from "@/server/shopify/queries";

describe("mirrorShopifyAvailableQty", () => {
  it("adds reserved to shopify available for on_hand", () => {
    expect(mirrorShopifyAvailableQty(10, 3)).toEqual({
      onHand: 13,
      available: 10,
    });
  });

  it("clamps negative shopify values to zero", () => {
    expect(mirrorShopifyAvailableQty(-2, 1)).toEqual({
      onHand: 1,
      available: 0,
    });
  });
});

const sampleNode = (levels: { gid: string; qty: number }[]): ShopifyVariantNode => ({
  id: "gid://shopify/ProductVariant/1",
  title: "Default",
  sku: null,
  barcode: null,
  price: "10.00",
  image: null,
  inventoryItem: {
    id: "gid://shopify/InventoryItem/1",
    inventoryLevels: {
      nodes: levels.map((l) => ({
        location: { id: l.gid },
        quantities: [{ quantity: l.qty }],
      })),
    },
  },
});

describe("shopifyAvailableByLocationFromVariantNode", () => {
  it("reads per-location available quantities", () => {
    const node = sampleNode([
      { gid: "gid://shopify/Location/1", qty: 7 },
      { gid: "gid://shopify/Location/2", qty: 3 },
    ]);
    expect(shopifyAvailableByLocationFromVariantNode(node)).toEqual([
      { locationGid: "gid://shopify/Location/1", available: 7 },
      { locationGid: "gid://shopify/Location/2", available: 3 },
    ]);
    expect(shopifyAvailableFromVariantNode(node)).toBe(10);
  });

  it("returns empty when inventory is not tracked", () => {
    const node: ShopifyVariantNode = {
      id: "gid://shopify/ProductVariant/1",
      title: "Default",
      sku: null,
      barcode: null,
      price: null,
      image: null,
      inventoryItem: { id: "gid://shopify/InventoryItem/1" },
    };
    expect(shopifyAvailableByLocationFromVariantNode(node)).toEqual([]);
    expect(shopifyAvailableFromVariantNode(node)).toBeNull();
  });
});
