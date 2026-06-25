import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

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
