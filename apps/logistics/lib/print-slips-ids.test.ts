import { describe, expect, it } from "vitest";
import {
  MAX_PRINT_SLIP_IDS,
  normalizeOrderId,
  parseOrderIds,
  parseOrderIdsFromHash,
} from "./print-slips-ids";

describe("normalizeOrderId", () => {
  it("passes through numeric Shopify ids", () => {
    expect(normalizeOrderId("1234567890")).toBe("1234567890");
  });

  it("extracts the numeric id from a Shopify GID", () => {
    expect(normalizeOrderId("gid://shopify/Order/1234567890")).toBe(
      "1234567890",
    );
  });

  it("decodes a percent-encoded GID", () => {
    expect(normalizeOrderId("gid%3A%2F%2Fshopify%2FOrder%2F1234567890")).toBe(
      "1234567890",
    );
  });
});

describe("parseOrderIds", () => {
  it("splits comma-separated ids and dedupes", () => {
    expect(parseOrderIds("1,2, 2,3")).toEqual(["1", "2", "3"]);
  });

  it("accepts an array mixed with GIDs", () => {
    expect(parseOrderIds(["gid://shopify/Order/11", "11", "22"])).toEqual([
      "11",
      "22",
    ]);
  });

  it("strips a leading ids= prefix", () => {
    expect(parseOrderIds("ids=10,20")).toEqual(["10", "20"]);
  });

  it("caps at MAX_PRINT_SLIP_IDS", () => {
    const many = Array.from({ length: MAX_PRINT_SLIP_IDS + 50 }, (_, i) =>
      String(i + 1),
    );
    expect(parseOrderIds(many)).toHaveLength(MAX_PRINT_SLIP_IDS);
  });

  it("accepts a 1000-order Shopify bulk selection", () => {
    const many = Array.from({ length: 1000 }, (_, i) => String(10_000 + i));
    expect(parseOrderIds(many)).toHaveLength(1000);
  });
});

describe("parseOrderIdsFromHash", () => {
  it("reads #ids=…", () => {
    expect(parseOrderIdsFromHash("#ids=1,2,3")).toEqual(["1", "2", "3"]);
  });

  it("reads a bare hash list", () => {
    expect(parseOrderIdsFromHash("#1,2")).toEqual(["1", "2"]);
  });
});
