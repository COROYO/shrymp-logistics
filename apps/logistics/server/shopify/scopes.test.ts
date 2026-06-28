import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getMissingOAuthScopes,
  parseOAuthScopeList,
  getConfiguredOAuthScopes,
} from "./scopes";

describe("scopes", () => {
  const prev = process.env.SHOPIFY_SCOPES;

  afterEach(() => {
    if (prev === undefined) delete process.env.SHOPIFY_SCOPES;
    else process.env.SHOPIFY_SCOPES = prev;
  });

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

  it("uses SHOPIFY_SCOPES env for required list", () => {
    process.env.SHOPIFY_SCOPES =
      "read_products,read_orders,write_orders,read_inventory";
    expect(getConfiguredOAuthScopes()).toEqual([
      "read_products",
      "read_orders",
      "write_orders",
      "read_inventory",
    ]);
  });

  it("returns no missing scopes when granted is empty (unknown)", () => {
    process.env.SHOPIFY_SCOPES = "read_products,read_orders";
    expect(getMissingOAuthScopes(null)).toEqual([]);
    expect(getMissingOAuthScopes("")).toEqual([]);
  });

  it("detects scopes missing from a non-empty grant", () => {
    process.env.SHOPIFY_SCOPES = "read_products,write_products,read_orders";
    expect(getMissingOAuthScopes("read_products,read_orders")).toEqual([
      "write_products",
    ]);
  });

  beforeEach(() => {
    delete process.env.SHOPIFY_SCOPES;
  });
});
