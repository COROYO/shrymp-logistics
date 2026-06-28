import "server-only";
import { FieldValue, type WriteBatch } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import type { ShopifyProductNode } from "./queries";
import { numericIdFromGid, parsePriceToCents } from "./sync";

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
    const productId = numericIdFromGid(p.id);
    const productImage = p.featuredMedia?.preview?.image?.url ?? null;

    batch.set(
      db.collection(Collections.Products).doc(productId),
      {
        id: productId,
        shop_id: shopId,
        shopify_gid: p.id,
        title: p.title,
        handle: p.handle,
        status: p.status,
        image_url: productImage,
        is_bundle: p.hasVariantsThatRequiresComponents === true,
        updated_at_shopify: new Date(p.updatedAt),
        synced_at: FieldValue.serverTimestamp(),
      } satisfies Omit<Product, "synced_at"> & {
        synced_at: FirebaseFirestore.FieldValue;
      },
      { merge: true },
    );
    opsInBatch++;
    productsAdded++;

    for (const v of p.variants.nodes) {
      const variantId = numericIdFromGid(v.id);
      const inventoryItemGid = v.inventoryItem?.id;
      if (!inventoryItemGid) {
        log.warn("variant_without_inventory_item", { variantGid: v.id });
        continue;
      }

      batch.set(
        db.collection(Collections.Variants).doc(variantId),
        {
          id: variantId,
          shop_id: shopId,
          product_id: productId,
          shopify_gid: v.id,
          inventory_item_gid: inventoryItemGid,
          sku: v.sku ?? null,
          barcode: v.barcode ?? null,
          title: v.title,
          image_url: v.image?.url ?? null,
          price_cents: parsePriceToCents(v.price),
          currency: null,
          updated_at: FieldValue.serverTimestamp(),
        } satisfies Omit<
          Variant,
          "updated_at" | "on_hand_total" | "reserved_total" | "available"
        > & { updated_at: FirebaseFirestore.FieldValue },
        { merge: true },
      );
      opsInBatch++;
      variantsAdded++;
      inventoryItems.push({ inventoryItemGid, variantId });

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
