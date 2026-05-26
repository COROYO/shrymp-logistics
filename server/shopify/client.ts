import "server-only";
import { log } from "@/lib/logger";

/**
 * Shopify Admin GraphQL client (single Custom App, single shop).
 *
 * Credentials come straight from ENV — the app is already installed in the
 * shop; there is no OAuth dance.
 *
 *   SHOPIFY_SHOP_DOMAIN         e.g. "monolithcaviar.myshopify.com"
 *   SHOPIFY_ADMIN_ACCESS_TOKEN  the Custom App's Admin API access token
 *   SHOPIFY_API_VERSION         e.g. "2026-04" (optional, defaults below)
 */

export type ShopifyClientConfig = {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
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

export class ShopifyGraphQLError extends Error {
  constructor(
    message: string,
    public readonly errors: GraphQLResult<unknown>["errors"],
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ShopifyGraphQLError";
  }
}

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1000;

export function getShopifyConfig(): ShopifyClientConfig {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2026-04";
  if (!shopDomain) {
    throw new Error("SHOPIFY_SHOP_DOMAIN env var is required");
  }
  if (!accessToken) {
    throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN env var is required");
  }
  return { shopDomain, accessToken, apiVersion };
}

export async function shopifyGraphQL<TData = unknown, TVars = unknown>(
  query: string,
  variables?: TVars,
  override?: Partial<ShopifyClientConfig>,
): Promise<TData> {
  const cfg = { ...getShopifyConfig(), ...override };
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
        });
        await sleep(delay);
        continue;
      }

      const json = (await res.json()) as GraphQLResult<TData>;

      if (json.errors && json.errors.length > 0) {
        const throttled = json.errors.some(
          (e) => e.extensions?.["code"] === "THROTTLED",
        );
        if (throttled && attempt < MAX_ATTEMPTS) {
          const delay = backoffMs(attempt);
          log.warn("shopify_throttled", { attempt, delayMs: delay });
          await sleep(delay);
          continue;
        }
        throw new ShopifyGraphQLError(
          json.errors.map((e) => e.message).join("; "),
          json.errors,
          res.status,
        );
      }

      const avail = json.extensions?.cost?.throttleStatus?.currentlyAvailable;
      if (typeof avail === "number" && avail < 100) {
        log.warn("shopify_cost_low", { currentlyAvailable: avail });
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
