import { describe, expect, it } from "vitest";
import {
  metafieldDisplayLabel,
  metafieldTechnicalName,
  parseMetafieldDisplayValue,
  parseReferenceGids,
  referenceKindForMetafieldType,
  serializeMetafieldStorageValue,
  serializeReferenceGids,
} from "./metafield-editor";

describe("metafield-editor", () => {
  it("formats list values as comma-separated text", () => {
    expect(
      parseMetafieldDisplayValue(
        "list.single_line_text_field",
        '["Bio","Vegan","DE"]',
      ),
    ).toBe("Bio, Vegan, DE");
  });

  it("serializes comma-separated text to Shopify list JSON", () => {
    expect(
      serializeMetafieldStorageValue(
        "list.single_line_text_field",
        "Bio, Vegan , DE",
      ),
    ).toBe('["Bio","Vegan","DE"]');
  });

  it("humanizes key when definition name is missing", () => {
    expect(metafieldDisplayLabel({ key: "zutaten_liste" })).toBe(
      "Zutaten Liste",
    );
  });

  it("builds technical namespace.key label", () => {
    expect(
      metafieldTechnicalName({ namespace: "custom", key: "zutaten" }),
    ).toBe("custom.zutaten");
  });

  it("parses single and list reference GIDs", () => {
    const gid = "gid://shopify/Product/1";
    expect(parseReferenceGids(gid)).toEqual([gid]);
    expect(parseReferenceGids(JSON.stringify([gid, "gid://shopify/Product/2"]))).toEqual([
      gid,
      "gid://shopify/Product/2",
    ]);
  });

  it("serializes reference GIDs for single and list types", () => {
    const gid = "gid://shopify/Product/1";
    expect(serializeReferenceGids("product_reference", [gid])).toBe(gid);
    expect(serializeReferenceGids("list.product_reference", [gid])).toBe(
      JSON.stringify([gid]),
    );
    expect(serializeReferenceGids("product_reference", [])).toBe("");
  });

  it("maps reference metafield types to search kinds", () => {
    expect(referenceKindForMetafieldType("product_reference")).toBe("product");
    expect(referenceKindForMetafieldType("list.collection_reference")).toBe(
      "collection",
    );
    expect(referenceKindForMetafieldType("mixed_reference")).toBe("mixed");
  });
});
