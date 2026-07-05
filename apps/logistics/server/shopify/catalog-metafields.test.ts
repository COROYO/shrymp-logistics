import { describe, expect, it } from "vitest";
import {
  mergeMetafieldsWithDefinitions,
  mergeProductMetafieldValues,
  normalizeShopifyMetafieldNode,
} from "./catalog-metafields";

describe("catalog-metafields", () => {
  it("uses jsonValue when value is empty", () => {
    expect(
      normalizeShopifyMetafieldNode({
        namespace: "custom",
        key: "spec",
        type: { name: "json" },
        value: "",
        jsonValue: { weight: 120 },
      }),
    ).toEqual({
      namespace: "custom",
      key: "spec",
      type: "json",
      value: '{"weight":120}',
    });
  });

  it("merges remote values over local duplicates", () => {
    expect(
      mergeProductMetafieldValues(
        [
          {
            namespace: "custom",
            key: "old",
            type: "single_line_text_field",
            value: "stale",
          },
        ],
        [
          {
            namespace: "custom",
            key: "old",
            type: "single_line_text_field",
            value: "live",
          },
        ],
      ),
    ).toEqual([
      {
        namespace: "custom",
        key: "old",
        type: "single_line_text_field",
        value: "live",
      },
    ]);
  });

  it("adds empty slots for product metafield definitions", () => {
    expect(
      mergeMetafieldsWithDefinitions(
        [
          {
            namespace: "custom",
            key: "filled",
            type: "single_line_text_field",
            value: "abc",
          },
        ],
        [
          {
            namespace: "custom",
            key: "filled",
            name: "Filled",
            type: "single_line_text_field",
          },
          {
            namespace: "custom",
            key: "empty",
            name: "Empty slot",
            type: "number_integer",
          },
        ],
      ),
    ).toEqual([
      {
        namespace: "custom",
        key: "empty",
        type: "number_integer",
        value: "",
        name: "Empty slot",
        metaobject_definition_id: null,
      },
      {
        namespace: "custom",
        key: "filled",
        type: "single_line_text_field",
        value: "abc",
        name: "Filled",
        metaobject_definition_id: null,
      },
    ]);
  });

  it("dedupes global and product-scoped definitions", () => {
    expect(
      mergeMetafieldsWithDefinitions(
        [],
        [
          {
            namespace: "custom",
            key: "a",
            name: "A",
            type: "single_line_text_field",
          },
        ],
      ),
    ).toHaveLength(1);
  });
});
