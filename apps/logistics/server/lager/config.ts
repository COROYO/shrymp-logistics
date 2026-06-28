import "server-only";
import { cache } from "react";
import { adminDb } from "@/server/firestore/admin";
import { DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY, DEFAULT_BATCHES_ENABLED, DEFAULT_INVENTORY_SOURCE } from "@/lib/lager/defaults";
import {
  Collections,
  ConfigDocs,
  LagerConfigSchema,
  type LagerConfig,
} from "@/server/firestore/schema";
import { getShop } from "@/server/tenant/shop";
import { normalizeShopId } from "@/server/tenant/id";
import { getTenantShopIdFromContext } from "@/server/tenant/context";

function resolveShopId(shopId?: string): string {
  const id = shopId ?? getTenantShopIdFromContext();
  if (!id) throw new Error("shopId required for lager config");
  return normalizeShopId(id);
}

async function loadLagerConfigUncached(shopId?: string): Promise<LagerConfig> {
  const id = resolveShopId(shopId);
  const shop = await getShop(id);
  if (shop) {
    return LagerConfigSchema.parse({
      batches_enabled: shop.batches_enabled,
      batch_min_days_before_expiry: shop.batch_min_days_before_expiry,
      inventory_source: shop.inventory_source ?? DEFAULT_INVENTORY_SOURCE,
      updated_at: shop.lager_updated_at ?? new Date(),
      updated_by_uid: shop.lager_updated_by_uid ?? null,
    });
  }

  const snap = await adminDb()
    .collection(Collections.Config)
    .doc(ConfigDocs.LagerConfig)
    .get();
  const parsed = LagerConfigSchema.safeParse(snap.data());
  if (parsed.success) return parsed.data;
  return LagerConfigSchema.parse({
    batches_enabled: DEFAULT_BATCHES_ENABLED,
    batch_min_days_before_expiry: DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY,
    inventory_source: DEFAULT_INVENTORY_SOURCE,
    updated_at: new Date(),
    updated_by_uid: null,
  });
}

/** Per-request cached — layout + page often load the same shop config. */
export const loadLagerConfig = cache(loadLagerConfigUncached);

/** Convenience guard — avoids loading full config at hot call sites. */
export async function isBatchesEnabled(shopId?: string): Promise<boolean> {
  const cfg = await loadLagerConfig(shopId);
  return cfg.batches_enabled;
}

/** True when our app pushes inventory to Shopify (APP is source of truth). */
export async function isAppInventorySource(shopId?: string): Promise<boolean> {
  const cfg = await loadLagerConfig(shopId);
  return cfg.inventory_source === "APP";
}
