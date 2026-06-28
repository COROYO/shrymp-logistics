import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { isAppInventorySource } from "@/server/lager/config";
import { buildInventoryPushEntriesForVariant } from "@/server/locations/push-stock";

async function resolveVariantShopId(
  variantId: string,
): Promise<string | undefined> {
  const snap = await adminDb()
    .collection(Collections.Variants)
    .doc(variantId)
    .get();
  return snap.data()?.shop_id as string | undefined;
}

/**
 * Queue an INVENTORY_SET outbox entry to push stock to Shopify.
 * Writes one outbox row per variant with all location quantities.
 *
 * `shopId` is required to resolve the lager config; server actions don't run
 * inside a tenant context, so we fall back to the variant's `shop_id`.
 */
export async function queueInventoryPush(
  variantId: string,
  reason: string,
  referenceUri: string,
  shopId?: string,
): Promise<{ queued: boolean }> {
  const resolvedShopId = shopId ?? (await resolveVariantShopId(variantId));
  if (!resolvedShopId) {
    log.warn("inventory_push_skipped_no_shop", { variantId, reason });
    return { queued: false };
  }

  if (!(await isAppInventorySource(resolvedShopId))) {
    log.info("inventory_push_skipped_shopify_source", { variantId, reason });
    return { queued: false };
  }

  const setQuantities = await buildInventoryPushEntriesForVariant(
    variantId,
    resolvedShopId,
  );
  if (setQuantities.length === 0) {
    log.warn("inventory_push_skipped_no_entries", { variantId });
    return { queued: false };
  }

  const db = adminDb();
  const ref = db.collection(Collections.ShopifyOutbox).doc();
  const now = FieldValue.serverTimestamp();
  await ref.set({
    id: ref.id,
    op: "INVENTORY_SET",
    payload: {
      reason,
      referenceDocumentUri: referenceUri,
      setQuantities,
    },
    attempts: 0,
    next_retry_at: now,
    created_at: now,
  });
  return { queued: true };
}
