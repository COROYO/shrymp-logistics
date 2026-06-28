import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { locationAdd } from "@/server/shopify/mutations";
import { numericIdFromGid } from "@/server/shopify/sync";
import { normalizeShopId } from "@/server/tenant/id";
import { variantsForShop } from "@/server/tenant/queries";
import {
  variantLocationStockDocId,
} from "./stock";
import { pushAllLocationStockToShopify } from "./push-stock";

export type CreateLocationInput = {
  name: string;
  address1: string;
  city: string;
  zip: string;
  countryCode?: string;
  phone?: string;
};

export async function createLocationAndSyncToShopify(
  shopId: string,
  input: CreateLocationInput,
): Promise<{ locationId: string; shopifyGid: string; name: string }> {
  const { runWithTenantAsync } = await import("@/server/tenant/context");
  const normalizedShopId = normalizeShopId(shopId);

  return runWithTenantAsync(normalizedShopId, async () => {
  const created = await locationAdd({
    name: input.name.trim(),
    address: {
      address1: input.address1.trim(),
      city: input.city.trim(),
      zip: input.zip.trim(),
      countryCode: (input.countryCode ?? "DE").toUpperCase(),
      ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
    },
  });

  const locationId = numericIdFromGid(created.id);
  const db = adminDb();
  const now = FieldValue.serverTimestamp();

  await db
    .collection(Collections.Locations)
    .doc(locationId)
    .set({
      id: locationId,
      shop_id: normalizedShopId,
      shopify_gid: created.id,
      name: created.name,
      is_primary: false,
      fulfills_online_orders: true,
      active: true,
      synced_at: now,
      updated_at: now,
    });

  const variantsSnap = await variantsForShop(db, normalizedShopId).get();
  let batch = db.batch();
  let ops = 0;

  for (const vDoc of variantsSnap.docs) {
    const ref = db
      .collection(Collections.VariantLocationStock)
      .doc(variantLocationStockDocId(vDoc.id, locationId));
    batch.set(ref, {
      id: ref.id,
      shop_id: normalizedShopId,
      variant_id: vDoc.id,
      location_id: locationId,
      on_hand: 0,
      updated_at: now,
    });
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  log.info("location_created", {
    shopId: normalizedShopId,
    locationId,
    variantRows: variantsSnap.size,
  });

  await pushAllLocationStockToShopify(normalizedShopId);

  return { locationId, shopifyGid: created.id, name: created.name };
  });
}
