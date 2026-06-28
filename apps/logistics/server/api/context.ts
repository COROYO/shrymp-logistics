import "server-only";

import { getSessionUser } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import {
  isApiKeyToken,
  lookupApiKey,
  touchApiKeyLastUsed,
} from "@/server/api/keys";
import type { ApiContext } from "@/server/api/types";
import type { ApiScope } from "@/server/firestore/schema";

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

/**
 * Resolve tenant + auth for `/api/v1/*`.
 * Session cookie (UI) or `Authorization: Bearer sk_live_…` (external).
 */
export async function resolveApiContext(
  req: Request,
  requiredScopes: ApiScope[] = [],
): Promise<ApiContext | null> {
  const token = bearerToken(req);

  if (token && isApiKeyToken(token)) {
    const key = await lookupApiKey(token);
    if (!key) return null;
    if (requiredScopes.some((s) => !key.scopes.includes(s))) return null;
    void touchApiKeyLastUsed(key.id);
    return {
      shopId: key.shop_id,
      auth: { kind: "api_key", keyId: key.id, scopes: key.scopes },
    };
  }

  const user = await getSessionUser();
  if (!user) return null;
  if (user.role !== "ADMIN" && user.role !== "LAGER") return null;

  try {
    const shopId = await requireActiveShopId(user);
    return {
      shopId,
      auth: { kind: "session", user },
    };
  } catch {
    return null;
  }
}
