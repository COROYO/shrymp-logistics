import { describe, expect, it } from "vitest";
import {
  getMissingOAuthScopes,
  parseOAuthScopeList,
  OAUTH_SCOPES,
} from "./scopes";

describe("scopes", () => {
  it("parses comma- and space-separated scope strings", () => {
    expect(parseOAuthScopeList("read_orders,write_orders")).toEqual([
      "read_orders",
      "write_orders",
    ]);
    expect(parseOAuthScopeList("read_orders write_orders")).toEqual([
      "read_orders",
      "write_orders",
    ]);
  });

  it("returns no missing scopes when granted is empty (unknown)", () => {
    expect(getMissingOAuthScopes(null)).toEqual([]);
    expect(getMissingOAuthScopes("")).toEqual([]);
  });

  it("detects scopes missing from a non-empty grant", () => {
    expect(getMissingOAuthScopes("read_products,read_orders")).toEqual([
      "write_products",
      "write_orders",
      "read_inventory",
      "write_inventory",
      "read_fulfillments",
      "write_fulfillments",
      "read_locations",
      "write_locations",
    ]);
  });

  it("returns empty when all scopes granted", () => {
    expect(getMissingOAuthScopes(OAUTH_SCOPES.join(","))).toEqual([]);
  });
});
