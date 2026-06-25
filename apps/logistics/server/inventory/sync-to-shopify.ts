import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, ConfigDocs } from "@/server/firestore/schema";
import { log } from "@/lib/logger";

/**
 * Queue an INVENTORY_SET outbox entry to push the current `available`
 * quantity of a variant to Shopify.
 *
 * Call this after every batch mutation (receive, edit, delete) so Shopify's
 * inventory page reflects the truth our app holds.
 */
export async function queueInventoryPush(
  variantId: string,
  reason: string,
  referenceUri: string,
): Promise<{ queued: boolean }> {
  const db = adminDb();
  const [vSnap, metaSnap] = await Promise.all([
    db.collection(Collections.Variants).doc(variantId).get(),
    db.collection(Collections.Config).doc(ConfigDocs.ShopifyMeta).get(),
  ]);
  if (!vSnap.exists) {
    log.warn("inventory_push_skipped_variant_missing", { variantId });
    return { queued: false };
  }
  const v = vSnap.data() ?? {};
  const inventoryItemGid = v.inventory_item_gid as string | undefined;
  if (!inventoryItemGid) {
    log.warn("inventory_push_skipped_no_inventory_item", { variantId });
    return { queued: false };
  }
  const locationGid = metaSnap.data()?.location_gid as string | undefined;
  if (!locationGid) {
    log.warn("inventory_push_skipped_no_location", { variantId });
    return { queued: false };
  }
  const onHand = (v.on_hand_total as number) ?? 0;

  const ref = db.collection(Collections.ShopifyOutbox).doc();
  const now = FieldValue.serverTimestamp();
  await ref.set({
    id: ref.id,
    op: "INVENTORY_SET",
    payload: {
      reason,
      referenceDocumentUri: referenceUri,
      setQuantities: [
        {
          inventoryItemId: inventoryItemGid,
          locationId: locationGid,
          quantity: onHand,
        },
      ],
    },
    attempts: 0,
    next_retry_at: now,
    created_at: now,
  });
  return { queued: true };
}
