import "server-only";
import { type WriteBatch } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { mapShopifyProductCatalogFields } from "./catalog-mapper";
import type { ShopifyProductNode } from "./queries";
import { numericIdFromGid } from "./sync";

const FIRESTORE_BATCH_MAX = 450;

export type WriteCatalogPageResult = {
  productsAdded: number;
  variantsAdded: number;
  inventoryItems: Array<{ inventoryItemGid: string; variantId: string }>;
};

/** Persist one Shopify products page into Firestore. */
export async function writeShopifyCatalogPage(
  shopId: string,
  products: ShopifyProductNode[],
): Promise<WriteCatalogPageResult> {
  const db = adminDb();
  let batch = db.batch();
  let opsInBatch = 0;
  let productsAdded = 0;
  let variantsAdded = 0;
  const inventoryItems: WriteCatalogPageResult["inventoryItems"] = [];

  const flush = async (b: WriteBatch) => {
    if (opsInBatch > 0) await b.commit();
  };

  for (const p of products) {
    const mapped = mapShopifyProductCatalogFields(p, shopId);

    batch.set(
      db.collection(Collections.Products).doc(mapped.productDoc.id),
      mapped.productDoc,
      { merge: true },
    );
    opsInBatch++;
    productsAdded++;

    for (const v of mapped.variants) {
      if (!v.inventoryItemGid) {
        log.warn("variant_without_inventory_item", { variantGid: v.doc.shopify_gid });
        continue;
      }

      batch.set(
        db.collection(Collections.Variants).doc(v.variantId),
        v.doc,
        { merge: true },
      );
      opsInBatch++;
      variantsAdded++;
      inventoryItems.push({
        inventoryItemGid: v.inventoryItemGid,
        variantId: v.variantId,
      });

      if (opsInBatch >= FIRESTORE_BATCH_MAX) {
        await flush(batch);
        batch = db.batch();
        opsInBatch = 0;
      }
    }
  }

  await flush(batch);
  return { productsAdded, variantsAdded, inventoryItems };
}

export function pendingInventoryCollection(runId: string) {
  return adminDb()
    .collection(Collections.ProductSyncRuns)
    .doc(runId)
    .collection("pending_inventory");
}

const INVENTORY_CHUNK = 25;

export async function queuePendingInventoryItems(
  runId: string,
  items: Array<{ inventoryItemGid: string; variantId: string }>,
): Promise<void> {
  if (items.length === 0) return;
  const col = pendingInventoryCollection(runId);
  let batch = adminDb().batch();
  let ops = 0;
  for (const item of items) {
    const ref = col.doc(numericIdFromGid(item.inventoryItemGid));
    batch.set(ref, {
      inventory_item_gid: item.inventoryItemGid,
      variant_id: item.variantId,
    });
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = adminDb().batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
}

export async function takePendingInventoryChunk(
  runId: string,
  limit = INVENTORY_CHUNK,
): Promise<Array<{ inventoryItemGid: string; variantId: string }>> {
  const snap = await pendingInventoryCollection(runId).limit(limit).get();
  if (snap.empty) return [];
  const batch = adminDb().batch();
  const out: Array<{ inventoryItemGid: string; variantId: string }> = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    out.push({
      inventoryItemGid: data.inventory_item_gid as string,
      variantId: data.variant_id as string,
    });
    batch.delete(doc.ref);
  }
  await batch.commit();
  return out;
}

export async function clearPendingInventory(runId: string): Promise<void> {
  const col = pendingInventoryCollection(runId);
  while (true) {
    const snap = await col.limit(200).get();
    if (snap.empty) return;
    const batch = adminDb().batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}
