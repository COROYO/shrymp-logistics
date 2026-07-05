import "server-only";
import type { QuerySnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
  type LagerConfig,
  type Location,
  type User,
  type Variant,
} from "@/server/firestore/schema";
import type { VariantRow } from "@/app/admin/products/product-accordion";
import {
  allocationsForShop,
  batchesForShop,
  locationsForShop,
} from "@/server/tenant/queries";
import { isBatchExpired } from "@/server/picking/batch-assignability";
import {
  loadLocationStockForVariants,
  type LocationOption,
} from "@/server/locations/stock";
import { getShop } from "@/server/tenant/shop";
import { loadLagerConfig } from "@/server/lager/config";
import { computeShippableQtyByVariant } from "@/server/inventory/shippable-stock";

function tsToIso(t: unknown): string | null {
  if (!t) return null;
  const o = t as { toDate?(): Date; seconds?: number };
  if (typeof o.toDate === "function")
    return o.toDate().toISOString().slice(0, 10);
  if (typeof o.seconds === "number")
    return new Date(o.seconds * 1000).toISOString().slice(0, 10);
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function aggregateLocationStock(
  rows: Array<{ locationId: string; onHand: number }>,
  locationNameById: Record<string, string>,
): Array<{ locationId: string; locationName: string; onHand: number }> {
  const byLocation = new Map<string, number>();
  for (const row of rows) {
    byLocation.set(
      row.locationId,
      (byLocation.get(row.locationId) ?? 0) + row.onHand,
    );
  }
  return Array.from(byLocation.entries())
    .map(([locationId, onHand]) => ({
      locationId,
      locationName: locationNameById[locationId] ?? locationId,
      onHand,
    }))
    .sort((a, b) => a.locationName.localeCompare(b.locationName));
}

function locationOptionsFromSnap(locationsSnap: QuerySnapshot): LocationOption[] {
  return locationsSnap.docs
    .map((d) => d.data() as Location)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((l) => ({
      id: l.id,
      name: l.name,
      isPrimary: l.is_primary,
    }));
}

async function defaultLocationFromSnap(
  shopId: string,
  locations: Location[],
): Promise<string | null> {
  const shop = await getShop(shopId);
  if (shop?.default_location_id) {
    const match = locations.find((l) => l.id === shop.default_location_id);
    if (match && match.active !== false) return shop.default_location_id;
  }
  const primary = locations.find((l) => l.is_primary && l.fulfills_online_orders);
  if (primary) return primary.id;
  const fallback = locations.find((l) => l.fulfills_online_orders);
  return fallback?.id ?? locations[0]?.id ?? null;
}

async function loadAllocationsForBatches(
  shopId: string,
  batchIds: string[],
): Promise<Allocation[]> {
  if (batchIds.length === 0) return [];
  const db = adminDb();
  const scoped = allocationsForShop(db, shopId);
  const snaps = await Promise.all(
    chunk(batchIds, 30).map((ids) =>
      scoped.where("batch_id", "in", ids).get(),
    ),
  );
  return snaps.flatMap((s) => s.docs.map((d) => d.data() as Allocation));
}

/** Tool-accurate inventory rows for product editor (matches Lagerbestand / Chargen). */
export async function loadProductEditorVariantInventory(
  shopId: string,
  variants: Variant[],
  lagerCfg?: LagerConfig,
): Promise<{
  rows: VariantRow[];
  locations: LocationOption[];
  defaultLocationId: string | null;
  batchesEnabled: boolean;
}> {
  const cfg = lagerCfg ?? (await loadLagerConfig(shopId));
  const variantIds = variants.map((v) => v.id).filter(Boolean);
  if (variantIds.length === 0) {
    return {
      rows: [],
      locations: [],
      defaultLocationId: null,
      batchesEnabled: cfg.batches_enabled,
    };
  }

  const referenceDate = new Date();
  const [batchesSnap, locationsSnap] = await Promise.all([
    cfg.batches_enabled
      ? batchesForShop(adminDb(), shopId)
          .where("variant_id", "in", variantIds.slice(0, 30))
          .get()
      : Promise.resolve(null),
    locationsForShop(adminDb(), shopId).where("active", "==", true).get(),
  ]);

  const activeLocations = locationsSnap.docs.map((d) => d.data() as Location);
  const locationNameById: Record<string, string> = {};
  for (const loc of activeLocations) {
    locationNameById[loc.id] = loc.name;
  }
  const locations = locationOptionsFromSnap(locationsSnap);

  const allBatches =
    batchesSnap?.docs.map((d) => ({
      ...(d.data() as Batch),
      id: d.id,
    })) ?? [];

  // Firestore `in` queries cap at 30 — fetch remaining variant batches if needed.
  if (cfg.batches_enabled && variantIds.length > 30) {
    for (const c of chunk(variantIds.slice(30), 30)) {
      const extra = await batchesForShop(adminDb(), shopId)
        .where("variant_id", "in", c)
        .get();
      for (const d of extra.docs) {
        allBatches.push({ ...(d.data() as Batch), id: d.id });
      }
    }
  }

  const batchIds = allBatches.map((b) => b.id);
  const receiverUids = cfg.batches_enabled
    ? Array.from(
        new Set(
          allBatches
            .map((b) => b.received_by_uid)
            .filter((uid): uid is string => !!uid),
        ),
      )
    : [];

  const [stockByVariant, defaultLocationId, allocs, userSnaps] =
    await Promise.all([
      loadLocationStockForVariants(variantIds),
      defaultLocationFromSnap(shopId, activeLocations),
      cfg.batches_enabled
        ? loadAllocationsForBatches(shopId, batchIds)
        : Promise.resolve([] as Allocation[]),
      receiverUids.length > 0
        ? adminDb().getAll(
            ...receiverUids.map((uid) =>
              adminDb().collection(Collections.Users).doc(uid),
            ),
          )
        : Promise.resolve([]),
    ]);

  const userNameByUid: Record<string, string> = {};
  for (const u of userSnaps) {
    if (!u.exists) continue;
    const data = u.data() as User;
    userNameByUid[u.id] = data.display_name || data.email || u.id;
  }

  const soldByBatch: Record<string, number> = {};
  const openAllocQtyByBatch = new Map<string, number>();
  for (const data of allocs) {
    if (data.released) continue;
    if (data.consumed_at) {
      soldByBatch[data.batch_id] = (soldByBatch[data.batch_id] ?? 0) + data.qty;
      continue;
    }
    openAllocQtyByBatch.set(
      data.batch_id,
      (openAllocQtyByBatch.get(data.batch_id) ?? 0) + data.qty,
    );
  }

  const shippableByVariant = cfg.batches_enabled
    ? computeShippableQtyByVariant(
        allBatches,
        openAllocQtyByBatch,
        cfg.batch_min_days_before_expiry,
        referenceDate,
      )
    : new Map<string, number>();

  const batchesByVariant: Record<string, Batch[]> = {};
  for (const b of allBatches) {
    (batchesByVariant[b.variant_id] ??= []).push(b);
  }

  const variantById = new Map(variants.map((v) => [v.id, v]));
  const rows = variantIds
    .map((id) => variantById.get(id))
    .filter((v): v is Variant => v != null)
    .map((v) => {
      const batches = (batchesByVariant[v.id] ?? [])
        .map((b) => ({
          id: b.id,
          chargeNumber: b.charge_number,
          expiryDateIso: tsToIso(b.expiry_date) ?? "",
          productionDateIso: tsToIso(b.production_date),
          receivedAtIso: tsToIso(b.received_at),
          receivedByUid: b.received_by_uid,
          receivedByName:
            userNameByUid[b.received_by_uid] ?? b.received_by_uid,
          remainingQty: b.remaining_qty,
          initialQty: b.initial_qty,
          soldQty: soldByBatch[b.id] ?? 0,
          status: b.status,
          expired:
            b.status === "EXPIRED" ||
            isBatchExpired(b.expiry_date, referenceDate),
          notes: b.notes ?? null,
          locationId: b.location_id ?? null,
          locationName: b.location_id
            ? (locationNameById[b.location_id] ?? b.location_id)
            : null,
        }))
        .sort((a, b) => {
          if (a.expiryDateIso === b.expiryDateIso) {
            return a.chargeNumber.localeCompare(b.chargeNumber);
          }
          if (!a.expiryDateIso) return 1;
          if (!b.expiryDateIso) return -1;
          return a.expiryDateIso.localeCompare(b.expiryDateIso);
        });

      const reserved = v.reserved_total ?? 0;
      const onHand = cfg.batches_enabled
        ? (shippableByVariant.get(v.id) ?? 0)
        : (v.on_hand_total ?? 0);
      const available = cfg.batches_enabled
        ? onHand - reserved
        : Math.max(0, onHand - reserved);

      return {
        id: v.id,
        title: v.title,
        sku: v.sku ?? null,
        barcode: v.barcode ?? null,
        priceCents: v.price_cents ?? null,
        currency: v.currency ?? null,
        imageUrl: v.image_url ?? null,
        onHand,
        reserved,
        available,
        locationStock: aggregateLocationStock(
          stockByVariant.get(v.id) ?? [],
          locationNameById,
        ),
        batches,
      };
    });

  return {
    rows,
    locations,
    defaultLocationId,
    batchesEnabled: cfg.batches_enabled,
  };
}
