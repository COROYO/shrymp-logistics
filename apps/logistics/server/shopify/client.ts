import "server-only";
import { log } from "@/lib/logger";
import { loadStoredToken } from "./auth";
import { getTenantShopIdFromContext } from "@/server/tenant/context";

/**
 * Shopify Admin GraphQL client. Token + shop come from `shops/{shopId}`,
 * populated per shop via OAuth callback.
 *
 *   SHOPIFY_API_VERSION         e.g. "2026-04" (optional, defaults below)
 */

export type ShopifyClientConfig = {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  shopId: string;
};

export type GraphQLResult<TData> = {
  data?: TData;
  errors?: Array<{
    message: string;
    locations?: unknown;
    path?: (string | number)[];
    extensions?: Record<string, unknown>;
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
};

export type GraphQLErrorItem = {
  message: string;
  locations?: unknown;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
};

export class ShopifyGraphQLError extends Error {
  constructor(
    message: string,
    public readonly errors: GraphQLErrorItem[] | undefined,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ShopifyGraphQLError";
  }
}

/** GraphQL uses an array; REST-style Shopify bodies use string or keyed objects. */
export function normalizeGraphQLErrors(raw: unknown): GraphQLErrorItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((entry) => {
      if (typeof entry === "string") return { message: entry };
      if (entry && typeof entry === "object" && "message" in entry) {
        return entry as GraphQLErrorItem;
      }
      return { message: JSON.stringify(entry) };
    });
  }
  if (typeof raw === "string") return [{ message: raw }];
  if (typeof raw === "object") {
    const out: GraphQLErrorItem[] = [];
    for (const [field, val] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(val)) {
        for (const m of val) {
          out.push({
            message: field === "base" ? String(m) : `${field}: ${String(m)}`,
          });
        }
      } else if (typeof val === "string") {
        out.push({
          message: field === "base" ? val : `${field}: ${val}`,
        });
      } else {
        out.push({ message: `${field}: ${JSON.stringify(val)}` });
      }
    }
    return out.length > 0 ? out : [{ message: JSON.stringify(raw) }];
  }
  return [{ message: String(raw) }];
}

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1000;
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422]);

export async function getShopifyConfig(
  shopId?: string,
): Promise<ShopifyClientConfig> {
  const resolvedShopId = shopId ?? getTenantShopIdFromContext();
  if (!resolvedShopId) {
    throw new Error(
      "SHOPIFY_TENANT_REQUIRED: shopId must be passed or set via runWithTenant",
    );
  }
  const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2026-04";
  const stored = await loadStoredToken(resolvedShopId);
  if (!stored) {
    throw new Error(
      `Shopify-App für ${resolvedShopId} noch nicht installiert. Install-Link aus dem Partner Dashboard öffnen.`,
    );
  }
  return {
    shopId: resolvedShopId,
    shopDomain: stored.shop_domain,
    accessToken: stored.access_token,
    apiVersion,
  };
}

export async function shopifyGraphQL<TData = unknown, TVars = unknown>(
  query: string,
  variables?: TVars,
  override?: Partial<ShopifyClientConfig> & { shopId?: string },
): Promise<TData> {
  const cfg = { ...(await getShopifyConfig(override?.shopId)), ...override };
  const url = `https://${cfg.shopDomain}/admin/api/${cfg.apiVersion}/graphql.json`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": cfg.accessToken,
          Accept: "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      if (res.status === 429 || res.status >= 500) {
        const delay = backoffMs(attempt, res.headers.get("retry-after"));
        log.warn("shopify_retry", {
          status: res.status,
          attempt,
          delayMs: delay,
          shopId: cfg.shopId,
        });
        await sleep(delay);
        continue;
      }

      const rawText = await res.text();
      let json: GraphQLResult<TData>;
      try {
        json = JSON.parse(rawText) as GraphQLResult<TData>;
      } catch {
        throw new ShopifyGraphQLError(
          `Shopify returned non-JSON (${res.status}): ${rawText.slice(0, 300)}`,
          undefined,
          res.status,
        );
      }

      const gqlErrors = normalizeGraphQLErrors(json.errors);

      if (NON_RETRYABLE_STATUSES.has(res.status)) {
        const msg =
          gqlErrors.map((e) => e.message).join("; ") ||
          rawText.slice(0, 300) ||
          `HTTP ${res.status}`;
        throw new ShopifyGraphQLError(msg, gqlErrors, res.status);
      }

      if (gqlErrors.length > 0) {
        const throttled = gqlErrors.some(
          (e) => e.extensions?.["code"] === "THROTTLED",
        );
        if (throttled && attempt < MAX_ATTEMPTS) {
          const delay = backoffMs(attempt);
          log.warn("shopify_throttled", { attempt, delayMs: delay, shopId: cfg.shopId });
          await sleep(delay);
          continue;
        }
        throw new ShopifyGraphQLError(
          gqlErrors.map((e) => e.message).join("; "),
          gqlErrors,
          res.status,
        );
      }

      const avail = json.extensions?.cost?.throttleStatus?.currentlyAvailable;
      if (typeof avail === "number" && avail < 100) {
        log.warn("shopify_cost_low", { currentlyAvailable: avail, shopId: cfg.shopId });
      }

      if (!json.data) {
        throw new ShopifyGraphQLError(
          "Empty data and no errors",
          undefined,
          res.status,
        );
      }
      return json.data;
    } catch (err) {
      lastErr = err;
      if (err instanceof ShopifyGraphQLError) throw err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }
    }
  }
  throw new ShopifyGraphQLError(
    `Shopify request failed after ${MAX_ATTEMPTS} attempts: ${String(lastErr)}`,
    undefined,
  );
}

function backoffMs(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 30_000);
  }
  const exp = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * 250;
  return Math.min(exp + jitter, 30_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
