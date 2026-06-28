import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  StorageBinSchema,
  type StorageBin,
  type VariantBin,
} from "@/server/firestore/schema";
import {
  storageBinsForShop,
  variantBinsForShop,
} from "@/server/tenant/queries";
import { normalizeShopId } from "@/server/tenant/id";
import { log } from "@/lib/logger";

export class BinError extends Error {
  constructor(
    public readonly code:
      | "invalid_code"
      | "invalid_name"
      | "duplicate_code"
      | "not_found"
      | "bulk_too_large",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "BinError";
  }
}

const MAX_BULK = 500;

/** Bin codes are case-insensitive; we store and compare them uppercased. */
export function normalizeBinCode(code: string): string {
  return code.trim().toUpperCase();
}

export type BinRow = {
  id: string;
  code: string;
  name: string;
  zone: string | null;
  note: string | null;
  active: boolean;
  sortOrder: number;
  variantCount: number;
};

export async function listBins(shopId: string): Promise<BinRow[]> {
  const db = adminDb();
  const [binsSnap, assignSnap] = await Promise.all([
    storageBinsForShop(db, shopId).get(),
    variantBinsForShop(db, shopId).get(),
  ]);

  const countByBin = new Map<string, number>();
  for (const d of assignSnap.docs) {
    const vb = d.data() as VariantBin;
    countByBin.set(vb.bin_id, (countByBin.get(vb.bin_id) ?? 0) + 1);
  }

  const rows = binsSnap.docs.map<BinRow>((d) => {
    const b = d.data() as StorageBin;
    return {
      id: d.id,
      code: b.code,
      name: b.name,
      zone: b.zone ?? null,
      note: b.note ?? null,
      active: b.active !== false,
      sortOrder: b.sort_order ?? 0,
      variantCount: countByBin.get(d.id) ?? 0,
    };
  });

  rows.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, "de"),
  );
  return rows;
}

async function findBinByCode(
  shopId: string,
  code: string,
): Promise<{ id: string; data: StorageBin } | null> {
  const db = adminDb();
  const snap = await storageBinsForShop(db, shopId)
    .where("code", "==", normalizeBinCode(code))
    .limit(1)
    .get();
  const doc = snap.docs[0];
  return doc ? { id: doc.id, data: doc.data() as StorageBin } : null;
}

export async function createBin(
  shopId: string,
  input: { code: string; name: string; zone?: string; note?: string },
  uid: string | null,
): Promise<BinRow> {
  const code = normalizeBinCode(input.code);
  const name = input.name.trim();
  if (!code) throw new BinError("invalid_code");
  if (!name) throw new BinError("invalid_name");

  const existing = await findBinByCode(shopId, code);
  if (existing) throw new BinError("duplicate_code");

  const db = adminDb();
  const ref = db.collection(Collections.StorageBins).doc();
  const doc = StorageBinSchema.parse({
    id: ref.id,
    shop_id: normalizeShopId(shopId),
    code,
    name,
    zone: input.zone?.trim() || null,
    note: input.note?.trim() || null,
    active: true,
    sort_order: Date.now(),
    created_at: new Date(),
    updated_at: new Date(),
    created_by_uid: uid,
  });
  await ref.set({
    ...doc,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  log.info("bin_created", { shopId, binId: ref.id, code });
  return {
    id: ref.id,
    code,
    name,
    zone: doc.zone ?? null,
    note: doc.note ?? null,
    active: true,
    sortOrder: doc.sort_order,
    variantCount: 0,
  };
}

/**
 * Bulk-generate sequential bins, e.g. prefix "A-", start 1, count 20, pad 2 →
 * A-01 … A-20. Codes that already exist are skipped (idempotent re-runs).
 */
export async function bulkCreateBins(
  shopId: string,
  input: {
    prefix: string;
    suffix?: string;
    start: number;
    count: number;
    padding: number;
    zone?: string;
    namePrefix?: string;
  },
  uid: string | null,
): Promise<{ created: number; skipped: number }> {
  const count = Math.floor(input.count);
  if (count <= 0 || count > MAX_BULK) throw new BinError("bulk_too_large");

  const db = adminDb();
  const existingSnap = await storageBinsForShop(db, shopId).get();
  const existingCodes = new Set(
    existingSnap.docs.map((d) => (d.data() as StorageBin).code),
  );

  const prefix = input.prefix ?? "";
  const suffix = input.suffix ?? "";
  const pad = Math.max(0, Math.floor(input.padding));
  const namePrefix = input.namePrefix?.trim() || "Lagerplatz";
  const zone = input.zone?.trim() || null;

  let batch = db.batch();
  let ops = 0;
  let created = 0;
  let skipped = 0;
  const base = Date.now();

  for (let i = 0; i < count; i++) {
    const n = input.start + i;
    const code = normalizeBinCode(
      `${prefix}${String(n).padStart(pad, "0")}${suffix}`,
    );
    if (!code || existingCodes.has(code)) {
      skipped++;
      continue;
    }
    existingCodes.add(code);
    const ref = db.collection(Collections.StorageBins).doc();
    batch.set(ref, {
      id: ref.id,
      shop_id: normalizeShopId(shopId),
      code,
      name: `${namePrefix} ${code}`,
      zone,
      note: null,
      active: true,
      sort_order: base + i,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      created_by_uid: uid,
    });
    created++;
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  log.info("bins_bulk_created", { shopId, created, skipped });
  return { created, skipped };
}

export async function updateBin(
  shopId: string,
  binId: string,
  patch: { code?: string; name?: string; zone?: string; note?: string; active?: boolean },
  uid: string | null,
): Promise<void> {
  const db = adminDb();
  const ref = db.collection(Collections.StorageBins).doc(binId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as StorageBin).shop_id !== normalizeShopId(shopId)) {
    throw new BinError("not_found");
  }

  const update: Record<string, unknown> = {
    updated_at: FieldValue.serverTimestamp(),
    updated_by_uid: uid,
  };
  let newCode: string | undefined;
  if (patch.code !== undefined) {
    newCode = normalizeBinCode(patch.code);
    if (!newCode) throw new BinError("invalid_code");
    const dup = await findBinByCode(shopId, newCode);
    if (dup && dup.id !== binId) throw new BinError("duplicate_code");
    update.code = newCode;
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new BinError("invalid_name");
    update.name = name;
  }
  if (patch.zone !== undefined) update.zone = patch.zone.trim() || null;
  if (patch.note !== undefined) update.note = patch.note.trim() || null;
  if (patch.active !== undefined) update.active = patch.active;

  await ref.update(update);

  // Keep denormalized code/name on assignments in sync.
  if (update.code !== undefined || update.name !== undefined) {
    const assignSnap = await variantBinsForShop(db, shopId)
      .where("bin_id", "==", binId)
      .get();
    if (!assignSnap.empty) {
      let b = db.batch();
      let ops = 0;
      for (const d of assignSnap.docs) {
        const p: Record<string, unknown> = {};
        if (update.code !== undefined) p.bin_code = update.code;
        if (update.name !== undefined) p.bin_name = update.name;
        b.update(d.ref, p);
        if (++ops >= 450) {
          await b.commit();
          b = db.batch();
          ops = 0;
        }
      }
      if (ops > 0) await b.commit();
    }
  }
  log.info("bin_updated", { shopId, binId });
}

export async function deleteBin(shopId: string, binId: string): Promise<void> {
  const db = adminDb();
  const ref = db.collection(Collections.StorageBins).doc(binId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as StorageBin).shop_id !== normalizeShopId(shopId)) {
    throw new BinError("not_found");
  }
  // Remove assignments pointing at this bin, then the bin itself.
  const assignSnap = await variantBinsForShop(db, shopId)
    .where("bin_id", "==", binId)
    .get();
  let b = db.batch();
  let ops = 0;
  for (const d of assignSnap.docs) {
    b.delete(d.ref);
    if (++ops >= 450) {
      await b.commit();
      b = db.batch();
      ops = 0;
    }
  }
  b.delete(ref);
  await b.commit();
  log.info("bin_deleted", { shopId, binId, unassigned: assignSnap.size });
}

/** Assign a variant to a bin (or clear it when binId is null). Doc id = variant id. */
export async function assignVariantToBin(
  shopId: string,
  variantId: string,
  binId: string | null,
  uid: string | null,
): Promise<void> {
  const db = adminDb();
  const ref = db.collection(Collections.VariantBins).doc(variantId);

  if (!binId) {
    await ref.delete().catch(() => undefined);
    return;
  }

  const binSnap = await db.collection(Collections.StorageBins).doc(binId).get();
  if (!binSnap.exists || (binSnap.data() as StorageBin).shop_id !== normalizeShopId(shopId)) {
    throw new BinError("not_found");
  }
  const bin = binSnap.data() as StorageBin;
  await ref.set({
    id: variantId,
    shop_id: normalizeShopId(shopId),
    variant_id: variantId,
    bin_id: binId,
    bin_code: bin.code,
    bin_name: bin.name,
    updated_at: FieldValue.serverTimestamp(),
    updated_by_uid: uid,
  });
}

export type VariantBinInfo = { binId: string; code: string; name: string };

/** variantId → its primary bin, for picklists and scan results. */
export async function loadBinsForVariants(
  variantIds: string[],
): Promise<Map<string, VariantBinInfo>> {
  const out = new Map<string, VariantBinInfo>();
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const db = adminDb();
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snaps = await db.getAll(
      ...chunk.map((id) => db.collection(Collections.VariantBins).doc(id)),
    );
    for (const s of snaps) {
      if (!s.exists) continue;
      const vb = s.data() as VariantBin;
      out.set(vb.variant_id, {
        binId: vb.bin_id,
        code: vb.bin_code,
        name: vb.bin_name,
      });
    }
  }
  return out;
}

/** All variant ids stored in a given bin (for the bin detail + scan view). */
export async function listVariantIdsInBin(
  shopId: string,
  binId: string,
): Promise<string[]> {
  const db = adminDb();
  const snap = await variantBinsForShop(db, shopId)
    .where("bin_id", "==", binId)
    .get();
  return snap.docs.map((d) => (d.data() as VariantBin).variant_id);
}

export type AssignableVariant = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  barcode: string | null;
  binId: string | null;
  binCode: string | null;
};

/** Variants (excl. bundle parents / archived) with their current bin, for assignment UI. */
export async function listVariantsWithBins(
  shopId: string,
): Promise<AssignableVariant[]> {
  const db = adminDb();
  const { productsForShop, variantsForShop } = await import(
    "@/server/tenant/queries"
  );
  const [productsSnap, variantsSnap, assignSnap] = await Promise.all([
    productsForShop(db, shopId).get(),
    variantsForShop(db, shopId).get(),
    variantBinsForShop(db, shopId).get(),
  ]);

  const products = new Map<string, { title: string; is_bundle?: boolean; status?: string }>();
  for (const p of productsSnap.docs) {
    const d = p.data() as { title: string; is_bundle?: boolean; status?: string };
    products.set(p.id, d);
  }
  const binByVariant = new Map<string, VariantBin>();
  for (const d of assignSnap.docs) {
    const vb = d.data() as VariantBin;
    binByVariant.set(vb.variant_id, vb);
  }

  const out: AssignableVariant[] = [];
  for (const v of variantsSnap.docs) {
    const variant = v.data() as {
      product_id: string;
      title: string;
      sku: string | null;
      barcode: string | null;
    };
    const product = products.get(variant.product_id);
    if (!product) continue;
    if (product.is_bundle === true || product.status === "ARCHIVED") continue;
    const bin = binByVariant.get(v.id);
    out.push({
      variantId: v.id,
      productTitle: product.title,
      variantTitle: variant.title,
      sku: variant.sku ?? null,
      barcode: variant.barcode ?? null,
      binId: bin?.bin_id ?? null,
      binCode: bin?.bin_code ?? null,
    });
  }

  out.sort(
    (a, b) =>
      a.productTitle.localeCompare(b.productTitle, "de") ||
      a.variantTitle.localeCompare(b.variantTitle, "de"),
  );
  return out;
}

export type BinLabel = {
  id: string;
  code: string;
  name: string;
  zone: string | null;
};

export async function listBinsForLabels(shopId: string): Promise<BinLabel[]> {
  const rows = await listBins(shopId);
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, zone: r.zone }));
}
