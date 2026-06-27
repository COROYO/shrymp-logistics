import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Allocation,
  type Batch,
} from "@/server/firestore/schema";
import { loadLagerConfig } from "@/server/lager/config";
import { isBatchAssignableForShipping } from "@/server/picking/batch-assignability";
import { allocationsForShop, batchesForShop } from "@/server/tenant/queries";
import { normalizeShopId } from "@/server/tenant/id";

/**
 * Versandfähiger Bestand pro Variante: Summe aus `remaining_qty` plus offenen
 * Zuweisungen auf Chargen, deren MHD noch versandfähig ist (FEFO-Cutoff).
 * Abgelaufene oder gesperrte Chargen zählen nicht.
 */
export function computeShippableQtyByVariant(
  batches: Batch[],
  openAllocQtyByBatch: Map<string, number>,
  minDaysBeforeExpiry: number,
  referenceDate: Date = new Date(),
): Map<string, number> {
  const byVariant = new Map<string, number>();
  for (const b of batches) {
    if (
      !isBatchAssignableForShipping(
        b.expiry_date,
        minDaysBeforeExpiry,
        referenceDate,
      )
    ) {
      continue;
    }
    const qty =
      (b.remaining_qty ?? 0) + (openAllocQtyByBatch.get(b.id) ?? 0);
    if (qty <= 0) continue;
    byVariant.set(b.variant_id, (byVariant.get(b.variant_id) ?? 0) + qty);
  }
  return byVariant;
}

/** Unassigned assignable units only — pool for the allocation run. */
export function computeAssignableRemainingByVariant(
  batches: Batch[],
  minDaysBeforeExpiry: number,
  referenceDate: Date = new Date(),
): Map<string, number> {
  return computeShippableQtyByVariant(
    batches,
    new Map(),
    minDaysBeforeExpiry,
    referenceDate,
  );
}

async function loadBatchesForVariants(
  variantIds: string[],
  shopId?: string,
): Promise<Batch[]> {
  const db = adminDb();
  const variantSet = new Set(variantIds);
  if (variantSet.size === 0) return [];

  if (shopId) {
    const snap = await batchesForShop(db, shopId).get();
    return snap.docs
      .map((d) => ({ ...(d.data() as Batch), id: d.id }))
      .filter((b) => variantSet.has(b.variant_id));
  }

  const batches: Batch[] = [];
  for (const c of chunk(variantIds, 30)) {
    const snap = await db
      .collection(Collections.Batches)
      .where("variant_id", "in", c)
      .get();
    for (const d of snap.docs) {
      batches.push({ ...(d.data() as Batch), id: d.id });
    }
  }
  return batches;
}

export async function loadAssignableRemainingByVariant(
  variantIds: string[],
  shopId?: string,
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();

  const lagerCfg = await loadLagerConfig(shopId);
  const minDays = lagerCfg.batch_min_days_before_expiry;
  const referenceDate = new Date();
  const batches = await loadBatchesForVariants(variantIds, shopId);
  return computeAssignableRemainingByVariant(
    batches,
    minDays,
    referenceDate,
  );
}

export async function loadShippableQtyByVariant(
  variantIds: string[],
  shopId?: string,
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();

  const lagerCfg = await loadLagerConfig(shopId);
  const minDays = lagerCfg.batch_min_days_before_expiry;
  const referenceDate = new Date();
  const batches = await loadBatchesForVariants(variantIds, shopId);

  const openAllocQtyByBatch = new Map<string, number>();
  const db = adminDb();
  const normalizedShop = shopId ? normalizeShopId(shopId) : null;

  if (normalizedShop) {
    const allocSnap = await allocationsForShop(db, normalizedShop).get();
    const variantSet = new Set(variantIds);
    for (const d of allocSnap.docs) {
      const a = d.data() as Allocation;
      if (!variantSet.has(a.variant_id)) continue;
      if (a.consumed_at || a.released) continue;
      openAllocQtyByBatch.set(
        a.batch_id,
        (openAllocQtyByBatch.get(a.batch_id) ?? 0) + a.qty,
      );
    }
  } else {
    for (const c of chunk(variantIds, 30)) {
      const allocSnap = await db
        .collection(Collections.Allocations)
        .where("variant_id", "in", c)
        .get();
      for (const d of allocSnap.docs) {
        const a = d.data() as Allocation;
        if (a.consumed_at || a.released) continue;
        openAllocQtyByBatch.set(
          a.batch_id,
          (openAllocQtyByBatch.get(a.batch_id) ?? 0) + a.qty,
        );
      }
    }
  }

  return computeShippableQtyByVariant(
    batches,
    openAllocQtyByBatch,
    minDays,
    referenceDate,
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
