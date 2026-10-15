import "server-only";
import { cache } from "react";
import { adminDb } from "@/server/firestore/admin";
import {
  DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY,
  DEFAULT_BATCHES_ENABLED,
  DEFAULT_CATALOG_SYNC_TO_SHOPIFY,
  DEFAULT_INVENTORY_SOURCE,
  DEFAULT_PRIORITY_TAGS,
  DEFAULT_SHOPIFY_FULFILLMENT_NOTIFY_CUSTOMER,
  DEFAULT_SHOPIFY_TAG_PACKED,
  DEFAULT_SHOPIFY_TAG_SHIP,
  DEFAULT_SHOPIFY_TAG_STOP,
  DEFAULT_SHOPIFY_WRITEBACK_FULFILLMENT,
  DEFAULT_SHOPIFY_WRITEBACK_INVENTORY,
  DEFAULT_SHOPIFY_WRITEBACK_TAGS,
} from "@/lib/lager/defaults";
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
      catalog_sync_to_shopify:
        shop.catalog_sync_to_shopify ?? DEFAULT_CATALOG_SYNC_TO_SHOPIFY,
      shopify_writeback_tags:
        shop.shopify_writeback_tags ?? DEFAULT_SHOPIFY_WRITEBACK_TAGS,
      shopify_writeback_fulfillment:
        shop.shopify_writeback_fulfillment ??
        DEFAULT_SHOPIFY_WRITEBACK_FULFILLMENT,
      shopify_fulfillment_notify_customer:
        shop.shopify_fulfillment_notify_customer ??
        DEFAULT_SHOPIFY_FULFILLMENT_NOTIFY_CUSTOMER,
      shopify_writeback_inventory:
        shop.shopify_writeback_inventory ?? DEFAULT_SHOPIFY_WRITEBACK_INVENTORY,
      shopify_tag_ship: shop.shopify_tag_ship ?? DEFAULT_SHOPIFY_TAG_SHIP,
      shopify_tag_stop: shop.shopify_tag_stop ?? DEFAULT_SHOPIFY_TAG_STOP,
      shopify_tag_packed: shop.shopify_tag_packed ?? DEFAULT_SHOPIFY_TAG_PACKED,
      priority_tags: shop.priority_tags ?? [...DEFAULT_PRIORITY_TAGS],
      ship_payment_statuses: shop.ship_payment_statuses,
      ship_fulfillment_statuses: shop.ship_fulfillment_statuses,
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
    catalog_sync_to_shopify: DEFAULT_CATALOG_SYNC_TO_SHOPIFY,
    shopify_writeback_tags: DEFAULT_SHOPIFY_WRITEBACK_TAGS,
    shopify_writeback_fulfillment: DEFAULT_SHOPIFY_WRITEBACK_FULFILLMENT,
    shopify_fulfillment_notify_customer:
      DEFAULT_SHOPIFY_FULFILLMENT_NOTIFY_CUSTOMER,
    shopify_writeback_inventory: DEFAULT_SHOPIFY_WRITEBACK_INVENTORY,
    shopify_tag_ship: DEFAULT_SHOPIFY_TAG_SHIP,
    shopify_tag_stop: DEFAULT_SHOPIFY_TAG_STOP,
    shopify_tag_packed: DEFAULT_SHOPIFY_TAG_PACKED,
    priority_tags: [...DEFAULT_PRIORITY_TAGS],
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

/**
 * True when a stock push should be queued. APP must own the numbers and the
 * merchant must have left inventory write-back on.
 */
export async function shouldPushInventoryToShopify(
  shopId?: string,
): Promise<boolean> {
  const cfg = await loadLagerConfig(shopId);
  return (
    cfg.inventory_source === "APP" && cfg.shopify_writeback_inventory
  );
}

/** German reason when a manual inventory push must be refused. Null = allowed. */
export async function inventoryPushBlockReason(
  shopId?: string,
): Promise<string | null> {
  const cfg = await loadLagerConfig(shopId);
  if (cfg.inventory_source !== "APP") {
    return "Bestandsführung liegt bei Shopify — Push ist deaktiviert.";
  }
  if (!cfg.shopify_writeback_inventory) {
    return "Bestands-Rückschreiben an Shopify ist ausgeschaltet.";
  }
  return null;
}

/** True when product edits should be pushed to Shopify by default. */
export async function isCatalogSyncToShopify(shopId?: string): Promise<boolean> {
  const cfg = await loadLagerConfig(shopId);
  return cfg.catalog_sync_to_shopify;
}
