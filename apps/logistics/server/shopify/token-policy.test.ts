import { describe, expect, it } from "vitest";
import {
  NON_EXPIRING_TOKEN_REJECTION,
  REFRESH_BEFORE_EXPIRY_MS,
  isAccessTokenDueForRefresh,
  isShopifyTokenRejection,
  parseExpiringTokenResponse,
  readOAuthErrorCode,
} from "./token-policy";

const NOW = 1_700_000_000_000;

describe("isAccessTokenDueForRefresh", () => {
  it("does not refresh a non-expiring token that has no refresh token", () => {
    expect(isAccessTokenDueForRefresh(undefined, false, NOW)).toBe(false);
  });

  it("refreshes when a refresh token exists but the access-token expiry was not stored", () => {
    expect(isAccessTokenDueForRefresh(undefined, true, NOW)).toBe(true);
  });

  it("refreshes inside the lead window and after expiry", () => {
    const soon = NOW + REFRESH_BEFORE_EXPIRY_MS - 1;
    const later = NOW + REFRESH_BEFORE_EXPIRY_MS + 60_000;
    expect(isAccessTokenDueForRefresh(soon, true, NOW)).toBe(true);
    expect(isAccessTokenDueForRefresh(NOW - 1, true, NOW)).toBe(true);
    expect(isAccessTokenDueForRefresh(later, true, NOW)).toBe(false);
  });
});

describe("parseExpiringTokenResponse", () => {
  it("stores access and refresh expiry from expires_in", () => {
    expect(
      parseExpiringTokenResponse(
        {
          access_token: "shpat_new",
          refresh_token: "shprt_new",
          expires_in: 3600,
          refresh_token_expires_in: 7776000,
          scope: "read_orders",
        },
        NOW,
      ),
    ).toEqual({
      accessToken: "shpat_new",
      refreshToken: "shprt_new",
      scope: "read_orders",
      accessTokenExpiresAtMs: NOW + 3600 * 1000,
      refreshTokenExpiresAtMs: NOW + 7776000 * 1000,
    });
  });

  it("rejects an expiring access token that has no refresh token", () => {
    expect(() =>
      parseExpiringTokenResponse({ access_token: "shpat_new", expires_in: 3600 }, NOW),
    ).toThrow(/refresh_token/);
  });

  it("keeps a legacy non-expiring token response so it can be migrated later", () => {
    expect(
      parseExpiringTokenResponse({ access_token: "shpat_old", scope: "read_orders" }, NOW),
    ).toEqual({
      accessToken: "shpat_old",
      scope: "read_orders",
      refreshToken: undefined,
      accessTokenExpiresAtMs: undefined,
      refreshTokenExpiresAtMs: undefined,
    });
  });
});

describe("isShopifyTokenRejection", () => {
  it("treats 401 as a signal to refresh once", () => {
    expect(isShopifyTokenRejection(401, "invalid")).toBe(true);
  });

  it("migrates only the non-expiring-token 403, not a missing scope", () => {
    expect(
      isShopifyTokenRejection(
        403,
        `{"errors":"${NON_EXPIRING_TOKEN_REJECTION} for the Admin API. See https://shopify.dev"}`,
      ),
    ).toBe(true);
    expect(isShopifyTokenRejection(403, "Required access: read_orders")).toBe(false);
  });
});

describe("readOAuthErrorCode", () => {
  it("reads Shopify's refresh rejection", () => {
    expect(readOAuthErrorCode('{"error":"invalid_request"}')).toBe("invalid_request");
    expect(readOAuthErrorCode("not-json")).toBeUndefined();
  });
});
