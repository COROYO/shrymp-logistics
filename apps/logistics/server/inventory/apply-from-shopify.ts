import "server-only";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { numericIdFromGid } from "@/server/shopify/sync";
import { getShop } from "@/server/tenant/shop";
import { normalizeShopId } from "@/server/tenant/id";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";

const InventoryLevelsUpdatePayloadSchema = z.object({
  inventory_item_id: z.union([z.number(), z.string()]),
  location_id: z.union([z.number(), z.string()]),
  available: z.number().int().nullable().optional(),
  updated_at: z.string().optional(),
});

export type ApplyShopifyInventoryResult = {
  applied: boolean;
  variantId?: string;
  reason?: string;
};

export type VariantInventoryPull = {
  variantId: string;
  shopifyAvailable: number;
};

export type BulkApplyShopifyInventoryResult = {
  updated: number;
  unchanged: number;
  skipped: number;
};

export function mirrorShopifyAvailableQty(
  shopifyAvailable: number,
  reserved: number,
): { onHand: number; available: number } {
  const available = Math.max(0, shopifyAvailable);
  return { onHand: available + reserved, available };
}

/**
 * Apply Shopify available quantities to variant docs in bulk (e.g. after
 * catalog sync). Keeps `reserved_total` intact — same rules as the webhook.
 */
export async function applyShopifyInventoryBulk(
  shopId: string,
  pulls: VariantInventoryPull[],
  refId: string,
): Promise<BulkApplyShopifyInventoryResult> {
  if (pulls.length === 0) {
    return { updated: 0, unchanged: 0, skipped: 0 };
  }

  const db = adminDb();
  const normalizedShopId = normalizeShopId(shopId);
  let updated = 0;
  let unchanged = 0;

  for (const chunk of chunkArray(pulls, 50)) {
    const refs = chunk.map((p) =>
      db.collection(Collections.Variants).doc(p.variantId),
    );
    const snaps = await db.getAll(...refs);
    const pullByVariant = new Map(chunk.map((p) => [p.variantId, p]));

    let batch = db.batch();
    let ops = 0;

    for (const snap of snaps) {
      const pull = pullByVariant.get(snap.id);
      if (!pull || !snap.exists) continue;

      const v = snap.data() ?? {};
      const reserved = (v.reserved_total as number | undefined) ?? 0;
      const prevOnHand = (v.on_hand_total as number | undefined) ?? 0;
      const prevAvailable = (v.available as number | undefined) ?? 0;
      const { onHand, available } = mirrorShopifyAvailableQty(
        pull.shopifyAvailable,
        reserved,
      );

      if (prevOnHand === onHand && prevAvailable === available) {
        unchanged++;
        continue;
      }

      const delta = onHand - prevOnHand;
      batch.update(snap.ref, {
        on_hand_total: onHand,
        available,
        updated_at: FieldValue.serverTimestamp(),
      });
      ops++;

      if (delta !== 0) {
        const movementRef = db.collection(Collections.InventoryMovements).doc();
        batch.set(movementRef, {
          id: movementRef.id,
          shop_id: normalizedShopId,
          type: "ADJUSTMENT",
          batch_id: null,
          variant_id: snap.id,
          qty: delta,
          ref: { kind: "EXTERNAL", id: refId },
          user_id: null,
          note: `Shopify inventory sync (available=${available})`,
          created_at: FieldValue.serverTimestamp(),
        });
        ops++;
      }

      updated++;

      if (ops >= FIRESTORE_BATCH_MAX) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }

    if (ops > 0) await batch.commit();
  }

  if (updated > 0) {
    log.info("shopify_inventory_bulk_applied", {
      shopId: normalizedShopId,
      updated,
      unchanged,
      refId,
    });
    await enqueueAllocationRun({
      shopId,
      triggeredBy: "MANUAL",
      triggerEventId: refId,
    });
  }

  return { updated, unchanged, skipped: 0 };
}

const FIRESTORE_BATCH_MAX = 450;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Mirror Shopify's available quantity into our variant doc when Shopify is
 * configured as inventory source of truth.
 *
 * Keeps `reserved_total` intact: `on_hand_total = shopify_available + reserved`.
 */
export async function applyShopifyInventoryLevel(
  shopId: string,
  body: unknown,
  webhookId: string,
): Promise<ApplyShopifyInventoryResult> {
  const parsed = InventoryLevelsUpdatePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return { applied: false, reason: "invalid_payload" };
  }

  const { inventory_item_id, location_id, available } = parsed.data;
  if (available == null) {
    return { applied: false, reason: "not_tracked" };
  }

  const inventoryItemGid = `gid://shopify/InventoryItem/${inventory_item_id}`;
  const db = adminDb();
  const snap = await db
    .collection(Collections.Variants)
    .where("shop_id", "==", normalizeShopId(shopId))
    .where("inventory_item_gid", "==", inventoryItemGid)
    .limit(1)
    .get();

  if (snap.empty) {
    return { applied: false, reason: "variant_not_found" };
  }

  const variantId = snap.docs[0]!.id;
  const locationId = String(location_id);
  const shopifyAvailable = Math.max(0, available);

  const { applyShopifyInventoryByLocationBulk } = await import(
    "@/server/locations/inventory-pull"
  );
  const result = await applyShopifyInventoryByLocationBulk(
    shopId,
    [{ variantId, locationId, shopifyAvailable }],
    webhookId,
  );

  if (result.variantsUpdated === 0 && result.unchanged > 0) {
    return { applied: true, variantId, reason: "unchanged" };
  }
  if (result.variantsUpdated === 0) {
    return { applied: false, reason: "unchanged" };
  }

  log.info("shopify_inventory_applied", {
    variantId,
    locationId,
    shopifyAvailable,
    webhookId,
  });

  return { applied: true, variantId };
}
