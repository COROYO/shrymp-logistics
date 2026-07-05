import { describe, expect, it } from "vitest";
import { buildVariantsFromOptions, cartesian } from "./variant-matrix";

describe("cartesian", () => {
  it("combines value lists", () => {
    expect(cartesian([["S", "M"], ["Red", "Blue"]])).toEqual([
      ["S", "Red"],
      ["S", "Blue"],
      ["M", "Red"],
      ["M", "Blue"],
    ]);
  });
});

describe("buildVariantsFromOptions", () => {
  it("returns default variant when no options", () => {
    const out = buildVariantsFromOptions([], []);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("");
  });

  it("clears option slots when options were removed", () => {
    const out = buildVariantsFromOptions(
      [],
      [
        {
          title: "",
          sku: "X",
          barcode: null,
          price_cents: 100,
          compare_at_price_cents: null,
          image_url: null,
          option1: "Default Title",
          option2: null,
          option3: null,
          position: 0,
          on_hand: 0,
          inventory_tracked: true,
          inventory_policy: "DENY",
          unit_cost_cents: null,
        },
      ],
    );
    expect(out[0]?.option1).toBeNull();
  });

  it("generates matrix and preserves matching sku", () => {
    const out = buildVariantsFromOptions(
      [
        { name: "Size", position: 1, values: ["S", "M"] },
        { name: "Color", position: 2, values: ["Red"] },
      ],
      [
        {
          id: "1",
          shopify_gid: "gid://shopify/ProductVariant/1",
          title: "S / Red",
          sku: "SKU-S-RED",
          barcode: null,
          price_cents: 1000,
          compare_at_price_cents: null,
          image_url: null,
          option1: "S",
          option2: "Red",
          option3: null,
          position: 0,
        },
      ],
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.sku).toBe("SKU-S-RED");
    expect(out[1]?.title).toBe("M / Red");
    expect(out[1]?.sku).toBeNull();
  });
});
