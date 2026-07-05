import { describe, expect, it } from "vitest";
import {
  mergeShopifyLinksOntoEditorVariants,
  prepareEditorInputForShopifyPush,
} from "./reconcile-shopify-push";

const baseProduct = {
  title: "Ring",
  handle: "ring",
  status: "ACTIVE" as const,
  description_html: null,
  vendor: null,
  product_type: null,
  tags: [] as string[],
  seo_title: null,
  seo_description: null,
  collection_ids: [] as string[],
  media: [],
  metafields: [],
};

describe("reconcile-shopify-push", () => {
  it("load: builds option matrix and links Shopify GIDs by option value", () => {
    const out = mergeShopifyLinksOntoEditorVariants(
      {
        ...baseProduct,
        options: [{ name: "Farbe", position: 1, values: ["Silber", "Gold"] }],
        variants: [],
      },
      {
        ...baseProduct,
        options: [{ name: "Farbe", position: 1, values: ["Silber"] }],
        variants: [
          {
            id: "111",
            shopify_gid: "gid://shopify/ProductVariant/111",
            title: "Silber",
            sku: "SKU-S",
            barcode: null,
            price_cents: 3495,
            compare_at_price_cents: null,
            image_url: null,
            option1: "Silber",
            option2: null,
            option3: null,
            position: 0,
          },
        ],
      },
    );

    expect(out.variants).toHaveLength(2);
    expect(out.variants[0]?.option1).toBe("Silber");
    expect(out.variants[0]?.shopify_gid).toBe("gid://shopify/ProductVariant/111");
    expect(out.variants[1]?.option1).toBe("Gold");
    expect(out.variants[1]?.shopify_gid).toBeUndefined();
  });

  it("push: sends all editor variants and creates new ones without Shopify ID", () => {
    const out = prepareEditorInputForShopifyPush(
      {
        ...baseProduct,
        sync_to_shopify: true,
        options: [{ name: "Farbe", position: 1, values: ["Silber", "Gold"] }],
        variants: [
          {
            id: "111",
            shopify_gid: "gid://shopify/ProductVariant/111",
            title: "Silber",
            sku: "SKU-S",
            barcode: null,
            price_cents: 3495,
            compare_at_price_cents: null,
            image_url: null,
            option1: "Silber",
            option2: null,
            option3: null,
            position: 0,
          },
          {
            title: "Gold",
            sku: "SKU-G",
            barcode: null,
            price_cents: 3495,
            compare_at_price_cents: null,
            image_url: null,
            option1: "Gold",
            option2: null,
            option3: null,
            position: 1,
          },
        ],
      },
      {
        ...baseProduct,
        options: [{ name: "Farbe", position: 1, values: ["Silber"] }],
        variants: [
          {
            id: "111",
            shopify_gid: "gid://shopify/ProductVariant/111",
            title: "Silber",
            sku: "SKU-S",
            barcode: null,
            price_cents: 3495,
            compare_at_price_cents: null,
            image_url: null,
            option1: "Silber",
            option2: null,
            option3: null,
            position: 0,
          },
        ],
      },
    );

    expect(out.variants).toHaveLength(2);
    expect(out.variants[0]?.shopify_gid).toBe("gid://shopify/ProductVariant/111");
    expect(out.variants[1]?.shopify_gid).toBeUndefined();
    expect(out.variants.some((v) => v.shopify_gid?.includes("54076371730645"))).toBe(
      false,
    );
  });
});
