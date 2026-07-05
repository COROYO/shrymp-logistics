import { describe, expect, it } from "vitest";
import {
  canPushVariantsWithOptions,
  defaultSimpleProductSetOptionValues,
  defaultSimpleProductSetOptions,
  filterRealOptions,
  hasRealProductOptions,
  normalizeProductEditorInput,
  prepareCatalogInputForShopify,
  SHOPIFY_DEFAULT_OPTION_NAME,
  SHOPIFY_DEFAULT_VARIANT_TITLE,
  variantOptionValuesForShopify,
} from "./shopify-catalog-normalize";

describe("shopify-catalog-normalize", () => {
  it("filters placeholder Title/Default Title option", () => {
    expect(
      filterRealOptions([
        { name: "Title", position: 1, values: ["Default Title"] },
        { name: "Größe", position: 2, values: ["S", "M"] },
      ]),
    ).toEqual([{ name: "Größe", position: 1, values: ["S", "M"] }]);
  });

  it("normalizes simple product to single variant without default title in UI", () => {
    const out = normalizeProductEditorInput({
      title: "Test",
      handle: "test",
      status: "ACTIVE",
      description_html: null,
      vendor: null,
      product_type: null,
      tags: [],
      seo_title: null,
      seo_description: null,
      collection_ids: [],
      media: [],
      options: [{ name: "Title", position: 1, values: ["Default Title"] }],
      metafields: [],
      variants: [
        {
          title: SHOPIFY_DEFAULT_VARIANT_TITLE,
          sku: "ABC",
          barcode: null,
          price_cents: 990,
          compare_at_price_cents: null,
          image_url: null,
          option1: "Default Title",
          option2: null,
          option3: null,
          position: 0,
        },
      ],
    });
    expect(out.options).toEqual([]);
    expect(out.variants).toHaveLength(1);
    expect(out.variants[0]?.title).toBe("");
    expect(out.variants[0]?.sku).toBe("ABC");
    expect(out.variants[0]?.price_cents).toBe(990);
  });

  it("keeps all variants when product has no real options but multiple variants", () => {
    const out = normalizeProductEditorInput({
      title: "Test",
      handle: "test",
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
      variants: [
        {
          id: "1",
          title: "Default Title",
          sku: "A",
          barcode: null,
          price_cents: 1000,
          compare_at_price_cents: null,
          image_url: null,
          option1: null,
          option2: null,
          option3: null,
          position: 0,
        },
        {
          id: "2",
          title: "Silber",
          sku: null,
          barcode: null,
          price_cents: 1000,
          compare_at_price_cents: null,
          image_url: "https://cdn.shopify.com/s/image.png",
          option1: null,
          option2: null,
          option3: null,
          position: 1,
        },
      ],
    });
    expect(out.variants).toHaveLength(2);
    expect(out.variants[1]?.title).toBe("Silber");
    expect(out.variants[1]?.image_url).toContain("image.png");
  });

  it("prepares simple product without fake options for Shopify push", () => {
    const out = prepareCatalogInputForShopify({
      title: "Salz",
      handle: "salz",
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
      variants: [
        {
          title: "",
          sku: "SALZ-1",
          barcode: null,
          price_cents: 500,
          compare_at_price_cents: null,
          image_url: null,
          option1: null,
          option2: null,
          option3: null,
          position: 0,
          on_hand: 0,
          inventory_tracked: true,
          inventory_policy: "DENY",
          unit_cost_cents: null,
        },
      ],
      sync_to_shopify: true,
    });
    expect(out.options).toEqual([]);
    expect(out.variants).toHaveLength(1);
    expect(out.variants[0]?.option1).toBeNull();
    expect(hasRealProductOptions(out.options)).toBe(false);
  });

  it("provides Title/Default Title shim for productSet on simple products", () => {
    expect(defaultSimpleProductSetOptions()).toEqual([
      {
        name: SHOPIFY_DEFAULT_OPTION_NAME,
        position: 1,
        values: [{ name: SHOPIFY_DEFAULT_VARIANT_TITLE }],
      },
    ]);
    expect(defaultSimpleProductSetOptionValues()).toEqual([
      {
        optionName: SHOPIFY_DEFAULT_OPTION_NAME,
        name: SHOPIFY_DEFAULT_VARIANT_TITLE,
      },
    ]);
  });

  it("clears stale option values when Title option was removed", () => {
    const out = prepareCatalogInputForShopify({
      title: "Salz",
      handle: "salz",
      status: "ACTIVE",
      description_html: null,
      vendor: null,
      product_type: null,
      tags: [],
      seo_title: null,
      seo_description: null,
      collection_ids: [],
      media: [],
      options: [{ name: "Title", position: 1, values: ["Default Title"] }],
      metafields: [],
      variants: [
        {
          title: "",
          sku: "SALZ-1",
          barcode: null,
          price_cents: 500,
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
      sync_to_shopify: true,
    });
    expect(out.options).toEqual([]);
    expect(out.variants[0]?.option1).toBeNull();
    expect(canPushVariantsWithOptions(out.options, out.variants)).toBe(false);
    expect(
      variantOptionValuesForShopify(out.variants[0]!, ["Title"]),
    ).toBeUndefined();
  });
});
