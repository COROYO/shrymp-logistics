import { describe, expect, it } from "vitest";
import { parseShopifyAppCredentials } from "./app-credentials";

describe("parseShopifyAppCredentials", () => {
  it("accepts a trimmed client id and secret", () => {
    expect(
      parseShopifyAppCredentials("  abcdefghijklmnop  ", "  shpss_secret_value  "),
    ).toEqual({
      apiKey: "abcdefghijklmnop",
      apiSecret: "shpss_secret_value",
    });
  });

  it("rejects blank, short, or whitespace values", () => {
    expect(parseShopifyAppCredentials("", "shpss_secret_value")).toBeNull();
    expect(parseShopifyAppCredentials("short", "shpss_secret_value")).toBeNull();
    expect(parseShopifyAppCredentials("abcdefghijklmnop", "short")).toBeNull();
    expect(
      parseShopifyAppCredentials("abcd efghijklmnop", "shpss_secret_value"),
    ).toBeNull();
    expect(
      parseShopifyAppCredentials("abcdefghijklmnop", "secret with space"),
    ).toBeNull();
  });
});
