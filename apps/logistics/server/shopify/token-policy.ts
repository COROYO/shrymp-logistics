/** Refresh this long before the access token's expires_at. */
export const REFRESH_BEFORE_EXPIRY_MS = 5 * 60_000;

/**
 * Shopify's Admin API rejection once a public app presents a non-expiring
 * offline token. Match the stable phrase; the rest of the message is a link.
 */
export const NON_EXPIRING_TOKEN_REJECTION =
  "Non-expiring access tokens are no longer accepted";

export type ExpiringTokenResponse = {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

export type ParsedExpiringToken = {
  accessToken: string;
  scope: string;
  refreshToken?: string;
  accessTokenExpiresAtMs?: number;
  refreshTokenExpiresAtMs?: number;
};

/**
 * An expiring offline token must be refreshed before `expires_in` elapses.
 * A stored refresh token with no access-token expiry is treated as due,
 * because the access token only lives an hour and we can no longer tell
 * when that hour started.
 */
export function isAccessTokenDueForRefresh(
  expiresAtMs: number | undefined,
  hasRefreshToken: boolean,
  now = Date.now(),
): boolean {
  if (!hasRefreshToken) return false;
  if (expiresAtMs === undefined) return true;
  return expiresAtMs - REFRESH_BEFORE_EXPIRY_MS <= now;
}

export function parseExpiringTokenResponse(
  data: ExpiringTokenResponse,
  now = Date.now(),
): ParsedExpiringToken {
  if (!data.access_token) {
    throw new Error("Shopify token response missing access_token");
  }
  const expiring = typeof data.expires_in === "number";
  if (expiring && !data.refresh_token) {
    throw new Error("Shopify expiring token response missing refresh_token");
  }
  return {
    accessToken: data.access_token,
    scope: data.scope ?? "",
    refreshToken: data.refresh_token,
    accessTokenExpiresAtMs: expiring ? now + data.expires_in! * 1000 : undefined,
    refreshTokenExpiresAtMs:
      typeof data.refresh_token_expires_in === "number"
        ? now + data.refresh_token_expires_in * 1000
        : undefined,
  };
}

export function readOAuthErrorCode(body: string): string | undefined {
  try {
    const json = JSON.parse(body) as { error?: unknown };
    return typeof json.error === "string" ? json.error : undefined;
  } catch {
    return undefined;
  }
}

/** 401 on an Admin API call, or the specific 403 for a non-expiring token. */
export function isShopifyTokenRejection(status: number, body: string): boolean {
  if (status === 401) return true;
  return status === 403 && body.includes(NON_EXPIRING_TOKEN_REJECTION);
}
