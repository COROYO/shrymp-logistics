/**
 * OAuth scopes requested on install / reconnect.
 * Must match the Custom App configuration in the Shopify Partner Dashboard.
 * Override via SHOPIFY_SCOPES (comma- or space-separated).
 */
const DEFAULT_OAUTH_SCOPES = [
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

/** Scopes this deployment requests during OAuth. */
export function getConfiguredOAuthScopes(): string[] {
  const env = process.env.SHOPIFY_SCOPES?.trim();
  if (env) return parseOAuthScopeList(env);
  return [...DEFAULT_OAUTH_SCOPES];
}

export function getRequiredOAuthScopeString(): string {
  return getConfiguredOAuthScopes().join(",");
}

/** @deprecated use getRequiredOAuthScopeString — kept for imports that expect a string constant shape */
export const REQUIRED_OAUTH_SCOPE_STRING = getRequiredOAuthScopeString();

export function getMissingOAuthScopes(
  granted: string | null | undefined,
): string[] {
  const required = getConfiguredOAuthScopes();
  if (!granted?.trim()) {
    // Shopify sometimes omits scope on refresh; empty means "unknown" — don't nag.
    return [];
  }
  const grantedSet = new Set(parseOAuthScopeList(granted));
  return required.filter((s) => !grantedSet.has(s));
}
