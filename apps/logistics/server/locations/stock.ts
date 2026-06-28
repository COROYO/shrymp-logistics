import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Location } from "@/server/firestore/schema";
import { numericIdFromGid } from "@/server/shopify/sync";
import { normalizeShopId } from "@/server/tenant/id";
import { getShop } from "@/server/tenant/shop";
import { locationsForShop } from "@/server/tenant/queries";

export function variantLocationStockDocId(
  variantId: string,
  locationId: string,
): string {
  return `${variantId}__${locationId}`;
}

export type LocationStockPull = {
  variantId: string;
  locationId: string;
  shopifyAvailable: number;
};

export type LocationOption = {
  id: string;
  name: string;
  isPrimary: boolean;
};

/** Sum location rows → variant on_hand_total / available (reserved stays variant-level). */
export async function recomputeVariantTotalsFromLocations(
  variantId: string,
): Promise<{ onHand: number; available: number; reserved: number } | null> {
  const db = adminDb();
  const variantRef = db.collection(Collections.Variants).doc(variantId);
  const vSnap = await variantRef.get();
  if (!vSnap.exists) return null;

  const stockSnap = await db
    .collection(Collections.VariantLocationStock)
    .where("variant_id", "==", variantId)
    .get();

  const onHand = stockSnap.docs.reduce(
    (sum, d) => sum + ((d.data().on_hand as number | undefined) ?? 0),
    0,
  );
  const reserved =
    (vSnap.data()?.reserved_total as number | undefined) ?? 0;
  const available = onHand - reserved;

  await variantRef.update({
    on_hand_total: onHand,
    available,
    updated_at: FieldValue.serverTimestamp(),
  });

  return { onHand, available, reserved };
}

export async function getPrimaryLocationId(
  shopId: string,
): Promise<string | null> {
  const db = adminDb();
  const snap = await locationsForShop(db, shopId)
    .where("active", "==", true)
    .get();

  const locs = snap.docs.map((d) => d.data() as Location);
  const primary = locs.find((l) => l.is_primary && l.fulfills_online_orders);
  if (primary) return primary.id;
  const fallback = locs.find((l) => l.fulfills_online_orders);
  return fallback?.id ?? locs[0]?.id ?? null;
}

/** Shop override, else Shopify primary fulfillment location. */
export async function getDefaultLocationId(
  shopId: string,
): Promise<string | null> {
  const shop = await getShop(shopId);
  if (shop?.default_location_id) {
    const db = adminDb();
    const snap = await db
      .collection(Collections.Locations)
      .doc(shop.default_location_id)
      .get();
    if (snap.exists && snap.data()?.active !== false) {
      return shop.default_location_id;
    }
  }
  return getPrimaryLocationId(shopId);
}

export async function listLocationOptions(
  shopId: string,
): Promise<LocationOption[]> {
  const db = adminDb();
  const snap = await locationsForShop(db, shopId)
    .where("active", "==", true)
    .get();
  return snap.docs
    .map((d) => d.data() as Location)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((l) => ({
      id: l.id,
      name: l.name,
      isPrimary: l.is_primary,
    }));
}

export async function loadLocationStockForVariants(
  variantIds: string[],
): Promise<Map<string, Array<{ locationId: string; onHand: number }>>> {
  const out = new Map<string, Array<{ locationId: string; onHand: number }>>();
  if (variantIds.length === 0) return out;

  const db = adminDb();
  const chunks: string[][] = [];
  for (let i = 0; i < variantIds.length; i += 30) {
    chunks.push(variantIds.slice(i, i + 30));
  }

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      db
        .collection(Collections.VariantLocationStock)
        .where("variant_id", "in", chunk)
        .get(),
    ),
  );

  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const data = doc.data();
      const variantId = data.variant_id as string;
      const locationId = data.location_id as string;
      const onHand = (data.on_hand as number | undefined) ?? 0;
      const list = out.get(variantId) ?? [];
      const existing = list.find((r) => r.locationId === locationId);
      if (existing) {
        existing.onHand += onHand;
      } else {
        list.push({ locationId, onHand });
      }
      out.set(variantId, list);
    }
  }

  return out;
}

/** Apply integer delta to one variant×location stock row. */
export async function applyDeltaToLocation(
  shopId: string,
  variantId: string,
  locationId: string,
  delta: number,
): Promise<void> {
  if (delta === 0) return;

  const db = adminDb();
  const normalizedShopId = normalizeShopId(shopId);
  const ref = db
    .collection(Collections.VariantLocationStock)
    .doc(variantLocationStockDocId(variantId, locationId));
  const snap = await ref.get();
  const prev = snap.exists ? ((snap.data()?.on_hand as number) ?? 0) : 0;
  const next = Math.max(0, prev + delta);

  await ref.set(
    {
      id: ref.id,
      shop_id: normalizedShopId,
      variant_id: variantId,
      location_id: locationId,
      on_hand: next,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Shift variant delta onto the default warehouse location row. */
export async function applyDeltaToPrimaryLocation(
  shopId: string,
  variantId: string,
  delta: number,
): Promise<void> {
  const locationId = await getDefaultLocationId(shopId);
  if (!locationId) return;
  await applyDeltaToLocation(shopId, variantId, locationId, delta);
}

export function locationIdFromWebhook(
  locationId: string | number,
): string {
  return String(locationId);
}

export function locationIdFromShopifyGid(gid: string): string {
  return numericIdFromGid(gid);
}
