import { describe, expect, it } from "vitest";
import { mergeEditorInputWithShopify } from "./merge-editor-input";

describe("mergeEditorInputWithShopify", () => {
  it("prefers Shopify metafield values over local duplicates", () => {
    const base = {
      title: "Salz",
      handle: "salz",
      status: "ACTIVE" as const,
      description_html: null,
      vendor: null,
      product_type: null,
      tags: [],
      seo_title: null,
      seo_description: null,
      collection_ids: [],
      media: [],
      options: [],
      variants: [],
    };
    const merged = mergeEditorInputWithShopify(
      {
        ...base,
        metafields: [
          {
            namespace: "custom",
            key: "origin",
            type: "single_line_text_field",
            value: "stale",
          },
        ],
      },
      {
        ...base,
        metafields: [
          {
            namespace: "custom",
            key: "origin",
            type: "single_line_text_field",
            value: "live",
          },
        ],
      },
    );
    expect(merged.metafields[0]?.value).toBe("live");
  });

  it("overlays Shopify compare-at price onto stale Firestore variant", () => {
    const local = {
      title: "Salz",
      handle: "salz",
      status: "ACTIVE" as const,
      description_html: "<p>alt</p>",
      vendor: null,
      product_type: null,
      tags: [],
      seo_title: null,
      seo_description: null,
      collection_ids: [],
      media: [],
      options: [],
      metafields: [],
      variants: [
        {
          id: "9239726555349",
          shopify_gid: "gid://shopify/ProductVariant/9239726555349",
          title: "",
          sku: "SALZ",
          barcode: null,
          price_cents: 990,
          compare_at_price_cents: null,
          image_url: null,
          option1: null,
          option2: null,
          option3: null,
          position: 0,
          on_hand: 12,
          inventory_tracked: true,
          inventory_policy: "DENY" as const,
          unit_cost_cents: null,
        },
      ],
    };

    const shopify = {
      ...local,
      variants: [
        {
          ...local.variants[0]!,
          compare_at_price_cents: 1290,
          price_cents: 990,
        },
      ],
    };

    const merged = mergeEditorInputWithShopify(local, shopify);
    expect(merged.variants[0]?.compare_at_price_cents).toBe(1290);
    expect(merged.variants[0]?.on_hand).toBe(12);
  });
});
