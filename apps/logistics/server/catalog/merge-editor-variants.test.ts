import { describe, expect, it } from "vitest";
import { mapPushVariantsToFirestore, applyPushVariantGids } from "./merge-editor-variants";

describe("mapPushVariantsToFirestore", () => {
  it("keeps Firestore variant id when option combo matches", () => {
    const rows = mapPushVariantsToFirestore(
      [
        {
          id: "local-silber",
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
      [
        {
          variantId: "111",
          shopifyGid: "gid://shopify/ProductVariant/111",
          inventoryItemGid: "gid://shopify/InventoryItem/1",
          title: "Silber",
          sku: "SKU-S",
          barcode: null,
          priceCents: 3495,
          compareAtPriceCents: null,
          imageUrl: null,
          option1: "Silber",
          option2: null,
          option3: null,
          position: 0,
        },
        {
          variantId: "222",
          shopifyGid: "gid://shopify/ProductVariant/222",
          inventoryItemGid: "gid://shopify/InventoryItem/2",
          title: "Gold",
          sku: "SKU-G",
          barcode: null,
          priceCents: 3495,
          compareAtPriceCents: null,
          imageUrl: null,
          option1: "Gold",
          option2: null,
          option3: null,
          position: 1,
        },
      ],
    );

    expect(rows[0]?.variantId).toBe("local-silber");
    expect(rows[1]?.variantId).toBe("222");
    expect(rows[1]?.shopifyGid).toBe("gid://shopify/ProductVariant/222");
  });
});

describe("applyPushVariantGids", () => {
  it("assigns Shopify GIDs to new variants by option combination", () => {
    const out = applyPushVariantGids(
      {
        title: "Ring",
        handle: "ring",
        status: "ACTIVE",
        description_html: null,
        vendor: null,
        product_type: null,
        tags: [],
        seo_title: null,
        seo_description: null,
        collection_ids: [],
        media: [],
        options: [],
        metafields: [],
        sync_to_shopify: true,
        variants: [
          {
            title: "Gold",
            sku: null,
            barcode: null,
            price_cents: 1000,
            compare_at_price_cents: null,
            image_url: "https://cdn.shopify.com/gold.png",
            option1: "Gold",
            option2: null,
            option3: null,
            position: 1,
          },
        ],
      },
      [
        {
          variantId: "222",
          shopifyGid: "gid://shopify/ProductVariant/222",
          inventoryItemGid: null,
          title: "Gold",
          sku: null,
          barcode: null,
          priceCents: 1000,
          compareAtPriceCents: null,
          imageUrl: null,
          option1: "Gold",
          option2: null,
          option3: null,
          position: 1,
        },
      ],
    );

    expect(out.variants[0]?.shopify_gid).toBe("gid://shopify/ProductVariant/222");
    expect(out.variants[0]?.image_url).toBe("https://cdn.shopify.com/gold.png");
  });
});
