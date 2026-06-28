/**
 * OAuth scopes requested on install / reconnect.
 * Must match the Custom App configuration in the Shopify Partner Dashboard.
 */
export const OAUTH_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "write_orders",
  "read_inventory",
  "write_inventory",
  "read_fulfillments",
  "write_fulfillments",
  "read_locations",
  "write_locations",
] as const;

export function parseOAuthScopeList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getConfiguredOAuthScopes(): readonly string[] {
  return OAUTH_SCOPES;
}

export function getRequiredOAuthScopeString(): string {
  return OAUTH_SCOPES.join(",");
}

/** Used by OAuth authorize URLs. */
export const REQUIRED_OAUTH_SCOPE_STRING = getRequiredOAuthScopeString();

export function getMissingOAuthScopes(
  granted: string | null | undefined,
): string[] {
  if (!granted?.trim()) {
    // Shopify sometimes omits scope on refresh; empty means "unknown" — don't nag.
    return [];
  }
  const grantedSet = new Set(parseOAuthScopeList(granted));
  return OAUTH_SCOPES.filter((s) => !grantedSet.has(s));
}
