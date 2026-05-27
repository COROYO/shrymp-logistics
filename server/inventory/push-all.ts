import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  ConfigDocs,
  type Variant,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { processOutbox } from "@/server/shopify/outbox";

/**
 * Bulk-push all current variant inventories to Shopify.
 *
 * One Outbox row per chunk of `CHUNK_SIZE` variants — Shopify accepts up to
 * ~250 `setQuantities` entries per mutation, we stay well below that to keep
 * each retry small.
 *
 * Variants without `inventory_item_gid` are skipped (warnings logged).
 *
 * Pushes the *net available* (`on_hand_total - reserved_total`) so Shopify
 * shows what merchants can actually sell — reserved-but-not-packed stock is
 * hidden from the storefront.
 */

const CHUNK_SIZE = 50;
const PUSH_AVAILABLE = true; // false would push on_hand_total instead

export type BulkPushResult = {
  queuedChunks: number;
  variantCount: number;
  skipped: number;
  drained: { processed: number; failed: number; done: number };
};

export async function pushAllInventoryToShopify(): Promise<BulkPushResult> {
  const db = adminDb();
  const [variantsSnap, metaSnap] = await Promise.all([
    db.collection(Collections.Variants).get(),
    db.collection(Collections.Config).doc(ConfigDocs.ShopifyMeta).get(),
  ]);

  const locationGid = metaSnap.data()?.location_gid as string | undefined;
  if (!locationGid) {
    throw new Error(
      "Keine Location-GID in config/shopify_meta. Zuerst Produkt-Sync laufen lassen.",
    );
  }

  type Entry = {
    inventoryItemId: string;
    locationId: string;
    quantity: number;
  };

  const entries: Entry[] = [];
  let skipped = 0;
  for (const doc of variantsSnap.docs) {
    const v = doc.data() as Variant;
    if (!v.inventory_item_gid) {
      skipped++;
      continue;
    }
    const onHand = v.on_hand_total ?? 0;
    const reserved = v.reserved_total ?? 0;
    const qty = PUSH_AVAILABLE ? onHand - reserved : onHand;
    entries.push({
      inventoryItemId: v.inventory_item_gid,
      locationId: locationGid,
      quantity: Math.max(0, qty),
    });
  }

  if (entries.length === 0) {
    log.info("bulk_inventory_push_no_entries", { skipped });
    return { queuedChunks: 0, variantCount: 0, skipped, drained: { processed: 0, failed: 0, done: 0 } };
  }

  // Chunk + write Outbox entries in one batched write.
  const chunks: Entry[][] = [];
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    chunks.push(entries.slice(i, i + CHUNK_SIZE));
  }

  const now = FieldValue.serverTimestamp();
  let writeBatch = db.batch();
  let opsInBatch = 0;
  const runId = `bulk-${Date.now()}`;
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx]!;
    const ref = db.collection(Collections.ShopifyOutbox).doc();
    writeBatch.set(ref, {
      id: ref.id,
      op: "INVENTORY_SET",
      payload: {
        reason: "correction",
        referenceDocumentUri: `monolith-lager://bulk-push/${runId}/${idx}`,
        setQuantities: chunk,
      },
      attempts: 0,
      next_retry_at: now,
      created_at: now,
    });
    opsInBatch++;
    if (opsInBatch >= 450) {
      await writeBatch.commit();
      writeBatch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await writeBatch.commit();

  log.info("bulk_inventory_push_queued", {
    variantCount: entries.length,
    chunks: chunks.length,
    skipped,
    runId,
  });

  // Drain immediately so the user sees Shopify catch up. processOutbox()
  // limit is 50 — for very large catalogs we just drain up to chunks.length.
  const drained = await processOutbox(Math.min(chunks.length, 200));

  return {
    queuedChunks: chunks.length,
    variantCount: entries.length,
    skipped,
    drained,
  };
}
