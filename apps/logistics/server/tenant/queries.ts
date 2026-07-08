import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { Collections } from "@/server/firestore/schema";
import { normalizeShopId } from "./id";

/** Tenant-scoped orders query — always filter by shop_id. */
export function ordersForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.Orders)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function productsForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.Products)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function variantsForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.Variants)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function locationsForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.Locations)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function forecastsForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.Forecasts)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function variantLocationStockForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.VariantLocationStock)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function batchesForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.Batches)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function storageBinsForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.StorageBins)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function variantBinsForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.VariantBins)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function allocationRunsForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.AllocationRuns)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function allocationsForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.Allocations)
    .where("shop_id", "==", normalizeShopId(shopId));
}

export function pickRunsForShop(db: Firestore, shopId: string) {
  return db
    .collection(Collections.PickRuns)
    .where("shop_id", "==", normalizeShopId(shopId));
}
