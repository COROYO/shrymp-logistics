import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY } from "@/lib/lager/defaults";
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

/** Per-shop lager settings from `shops/{shopId}`, legacy fallback to config doc. */
export async function loadLagerConfig(shopId?: string): Promise<LagerConfig> {
  const id = resolveShopId(shopId);
  const shop = await getShop(id);
  if (shop) {
    return LagerConfigSchema.parse({
      batch_min_days_before_expiry: shop.batch_min_days_before_expiry,
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
    batch_min_days_before_expiry: DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY,
    updated_at: new Date(),
    updated_by_uid: null,
  });
}
