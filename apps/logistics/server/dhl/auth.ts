import "server-only";
import { dhlAuthUrl } from "./config";
import type { DhlConfig } from "@/server/firestore/schema";
import { log } from "@/lib/logger";

/**
 * OAuth2 ROPC ("Resource Owner Password Credentials") token cache for
 * the DHL Parcel DE Shipping API.
 *
 * Tokens are valid ~1h. We cache per (sandbox, client_id, username) tuple
 * in-process and refresh a few minutes before expiry. There is no refresh
 * token in the ROPC flow — DHL just hands out a fresh access token on each
 * call to the token endpoint.
 */

type CacheKey = string;
type CacheEntry = { token: string; expiresAt: number };

const cache = new Map<CacheKey, CacheEntry>();

const REFRESH_BEFORE_EXPIRY_MS = 5 * 60_000; // refresh 5 min before expiry

function keyFor(
  cfg: Pick<DhlConfig, "sandbox" | "gkp_username">,
  clientId: string,
): CacheKey {
  return `${cfg.sandbox ? "sb" : "prod"}|${clientId}|${cfg.gkp_username ?? ""}`;
}

/** Drop the cached token for a given config — used after a 401 response. */
export function invalidateDhlAccessToken(cfg: DhlConfig): void {
  const clientId = process.env.DHL_API_KEY ?? "";
  cache.delete(keyFor(cfg, clientId));
}

export class DhlAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DhlAuthError";
  }
}

export async function getDhlAccessToken(cfg: DhlConfig): Promise<string> {
  const clientId = process.env.DHL_API_KEY ?? "";
  const clientSecret = process.env.DHL_API_SECRET ?? "";
  const username = cfg.gkp_username ?? "";
  const password = cfg.gkp_password ?? "";

  const key = keyFor(cfg, clientId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt - REFRESH_BEFORE_EXPIRY_MS > Date.now()) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(dhlAuthUrl(cfg), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log.warn("dhl_auth_failed", { status: res.status, body: text.slice(0, 500) });
    throw new DhlAuthError(
      res.status,
      `DHL OAuth2 token request failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  if (!json.access_token) {
    throw new DhlAuthError(500, "DHL OAuth2 response missing access_token");
  }
  // DHL sandbox is known to return very short-lived tokens (sometimes
  // under a minute). Cap the cache lifetime so we don't sit on a token
  // that the gateway will reject on the next call.
  const reportedMs = (json.expires_in ?? 0) * 1000;
  const cappedMs = Math.max(0, Math.min(reportedMs, 30 * 60_000));
  cache.set(key, {
    token: json.access_token,
    expiresAt: Date.now() + cappedMs,
  });
  return json.access_token;
}

/** Test hook — wipe the in-memory token cache. */
export function _resetDhlAuthCache(): void {
  cache.clear();
}
