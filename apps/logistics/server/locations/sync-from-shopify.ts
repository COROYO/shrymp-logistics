import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Location } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import {
  getActiveLocations,
  resolvePrimaryFulfillmentLocation,
  type ShopifyLocationNode,
} from "@/server/shopify/queries";
import { numericIdFromGid } from "@/server/shopify/sync";
import { normalizeShopId } from "@/server/tenant/id";

export type SyncLocationsResult = {
  count: number;
  primaryLocationGid: string;
  primaryLocationId: string;
};

/**
 * Mirror all active Shopify locations into Firestore. Marks locations missing
 * from Shopify as inactive (soft-delete).
 */
export async function syncLocationsFromShopify(
  shopId: string,
): Promise<SyncLocationsResult> {
  const { runWithTenantAsync } = await import("@/server/tenant/context");
  const normalizedShopId = normalizeShopId(shopId);

  return runWithTenantAsync(normalizedShopId, async () => {
  const db = adminDb();
  const remote = await getActiveLocations();
  const primary = await resolvePrimaryFulfillmentLocation();
  const remoteIds = new Set<string>();

  let batch = db.batch();
  let ops = 0;
  const now = FieldValue.serverTimestamp();

  for (const loc of remote) {
    const id = numericIdFromGid(loc.id);
    remoteIds.add(id);
    const ref = db.collection(Collections.Locations).doc(id);
    batch.set(
      ref,
      {
        id,
        shop_id: normalizedShopId,
        shopify_gid: loc.id,
        name: loc.name,
        is_primary: loc.isPrimary,
        fulfills_online_orders: loc.fulfillsOnlineOrders,
        active: true,
        synced_at: now,
        updated_at: now,
      } satisfies Omit<Location, "synced_at" | "updated_at"> & {
        synced_at: FirebaseFirestore.FieldValue;
        updated_at: FirebaseFirestore.FieldValue;
      },
      { merge: true },
    );
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();

  const existing = await db
    .collection(Collections.Locations)
    .where("shop_id", "==", normalizedShopId)
    .get();

  batch = db.batch();
  ops = 0;
  for (const doc of existing.docs) {
    if (remoteIds.has(doc.id)) continue;
    batch.update(doc.ref, {
      active: false,
      updated_at: now,
    });
    ops++;
  }
  if (ops > 0) await batch.commit();

  log.info("locations_synced", {
    shopId: normalizedShopId,
    count: remote.length,
    primary: primary.id,
  });

  return {
    count: remote.length,
    primaryLocationGid: primary.id,
    primaryLocationId: numericIdFromGid(primary.id),
  };
  });
}

export async function listActiveLocations(shopId: string): Promise<Location[]> {
  const db = adminDb();
  const { locationsForShop } = await import("@/server/tenant/queries");
  const snap = await locationsForShop(db, shopId)
    .where("active", "==", true)
    .get();
  return snap.docs.map((d) => d.data() as Location);
}

export function toLocationNode(loc: Location): Pick<
  ShopifyLocationNode,
  "id" | "name" | "isPrimary" | "fulfillsOnlineOrders"
> {
  return {
    id: loc.shopify_gid,
    name: loc.name,
    isPrimary: loc.is_primary,
    fulfillsOnlineOrders: loc.fulfills_online_orders,
  };
}
