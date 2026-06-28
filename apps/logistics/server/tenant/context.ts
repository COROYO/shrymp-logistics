import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { getSessionUser } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";

/** Request-scoped tenant (shop) for server handlers without explicit params. */
export type TenantContext = { shopId: string };

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(shopId: string, fn: () => T): T {
  return storage.run({ shopId }, fn);
}

export async function runWithTenantAsync<T>(
  shopId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ shopId }, fn);
}

export function getTenantShopIdFromContext(): string | null {
  return storage.getStore()?.shopId ?? null;
}

export function requireTenantShopIdFromContext(): string {
  const shopId = getTenantShopIdFromContext();
  if (!shopId) {
    throw new Error("TENANT_REQUIRED: no active shop context");
  }
  return shopId;
}

/**
 * Active shop for server components. Prefer ALS when the admin layout set it;
 * Suspense/async children often resume outside that scope, so fall back to the
 * cached session + shop lookup (same request, no extra round-trips).
 */
export async function resolveTenantShopId(): Promise<string> {
  const fromContext = getTenantShopIdFromContext();
  if (fromContext) return fromContext;
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return requireActiveShopId(user);
}
