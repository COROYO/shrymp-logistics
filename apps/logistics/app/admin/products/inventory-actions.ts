"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Batch, type Variant } from "@/server/firestore/schema";
import { receiveBatch } from "@/server/inventory/receive";
import {
  archiveBatch as svcArchiveBatch,
  BatchEditError,
  editBatch as svcEditBatch,
} from "@/server/inventory/edit-batch";
import { log } from "@/lib/logger";

async function revalidateInventoryViews(opts: {
  variantId?: string;
  batchId?: string;
}): Promise<void> {
  revalidatePath("/admin/products");
  revalidatePath("/admin/lagerbestand");

  let variantId = opts.variantId;
  if (!variantId && opts.batchId) {
    const batchSnap = await adminDb()
      .collection(Collections.Batches)
      .doc(opts.batchId)
      .get();
    if (batchSnap.exists) {
      variantId = (batchSnap.data() as Batch).variant_id;
    }
  }
  if (!variantId) return;

  const variantSnap = await adminDb()
    .collection(Collections.Variants)
    .doc(variantId)
    .get();
  if (!variantSnap.exists) return;
  const productId = (variantSnap.data() as Variant).product_id;
  if (productId) revalidatePath(`/admin/products/${productId}`);
}

// ----------------------- create / receive -----------------------

const ReceiveSchema = z.object({
  variantId: z.string().min(1),
  locationId: z.string().min(1).optional(),
  chargeNumber: z.string().min(1).max(64),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  qty: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? Number(v) : v)),
  note: z.string().max(500).optional().or(z.literal("")),
});

export type ReceiveBatchActionState =
  | { ok: true; batchId: string; newOnHandTotal: number }
  | { ok: false; error: string }
  | null;

export async function receiveBatchAction(
  _prev: ReceiveBatchActionState,
  formData: FormData,
): Promise<ReceiveBatchActionState> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = ReceiveSchema.safeParse({
    variantId: formData.get("variantId"),
    locationId: formData.get("locationId") ?? undefined,
    chargeNumber: formData.get("chargeNumber"),
    expiryDate: formData.get("expiryDate"),
    productionDate: formData.get("productionDate") ?? undefined,
    qty: formData.get("qty"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  try {
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const result = await receiveBatch({
      shopId,
      variantId: parsed.data.variantId,
      locationId: parsed.data.locationId,
      chargeNumber: parsed.data.chargeNumber.trim(),
      expiryDate: parsed.data.expiryDate,
      productionDate: parsed.data.productionDate
        ? parsed.data.productionDate
        : undefined,
      qty: parsed.data.qty,
      note: parsed.data.note || undefined,
      userId: user.uid,
    });
    await revalidateInventoryViews({ variantId: parsed.data.variantId });
    return { ok: true, ...result };
  } catch (e) {
    log.warn("receive_batch_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ----------------------- edit -----------------------

const EditSchema = z.object({
  batchId: z.string().min(1),
  chargeNumber: z.string().min(1).max(64).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Empty string clears the field; YYYY-MM-DD sets it. */
  productionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(""))
    .optional(),
  remainingQty: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" && v !== "" ? Number(v) : v))
    .optional(),
  notes: z.string().max(500).optional().or(z.literal("")).optional(),
  /** Reason for a quantity change — recorded on the ADJUSTMENT movement. */
  reason: z.string().max(500).optional().or(z.literal("")).optional(),
});

export type EditBatchResult =
  | { ok: true; delta: number }
  | { ok: false; error: string };

export async function editBatchAction(
  payload: z.infer<typeof EditSchema>,
): Promise<EditBatchResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = EditSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  try {
    const { delta } = await svcEditBatch(
      parsed.data.batchId,
      {
        charge_number: parsed.data.chargeNumber,
        expiry_date: parsed.data.expiryDate,
        production_date:
          parsed.data.productionDate === undefined
            ? undefined
            : parsed.data.productionDate === ""
              ? null
              : parsed.data.productionDate,
        remaining_qty:
          typeof parsed.data.remainingQty === "number"
            ? parsed.data.remainingQty
            : undefined,
        notes:
          parsed.data.notes === undefined
            ? undefined
            : parsed.data.notes === ""
              ? null
              : parsed.data.notes,
        reason:
          parsed.data.reason && parsed.data.reason.trim()
            ? parsed.data.reason.trim()
            : undefined,
      },
      user.uid,
    );
    await revalidateInventoryViews({ batchId: parsed.data.batchId });
    return { ok: true, delta };
  } catch (e) {
    log.warn("edit_batch_failed", { error: String(e) });
    if (e instanceof BatchEditError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ----------------------- archive -----------------------

export type ArchiveBatchResult = { ok: true } | { ok: false; error: string };

export async function archiveBatchAction(
  batchId: string,
): Promise<ArchiveBatchResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    await svcArchiveBatch(batchId, user.uid);
    await revalidateInventoryViews({ batchId });
    return { ok: true };
  } catch (e) {
    log.warn("archive_batch_failed", { error: String(e) });
    if (e instanceof BatchEditError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ----------------------- history -----------------------

export type BatchHistoryActionResult =
  | { ok: true; entries: import("@/server/inventory/batch-history").BatchHistoryEntry[] }
  | { ok: false; error: string };

export async function getBatchHistoryAction(
  batchId: string,
): Promise<BatchHistoryActionResult> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const { getBatchHistory } = await import(
      "@/server/inventory/batch-history"
    );
    const entries = await getBatchHistory(batchId);
    return { ok: true, entries };
  } catch (e) {
    log.warn("batch_history_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ----------------------- variant stock (no batch tracking) -----------------------

const ReceiveVariantSchema = z.object({
  variantId: z.string().min(1),
  locationId: z.string().min(1).optional(),
  qty: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? Number(v) : v)),
  note: z.string().max(500).optional().or(z.literal("")),
});

export type ReceiveVariantActionState =
  | { ok: true; newOnHandTotal: number }
  | { ok: false; error: string }
  | null;

export async function receiveVariantStockAction(
  _prev: ReceiveVariantActionState,
  formData: FormData,
): Promise<ReceiveVariantActionState> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = ReceiveVariantSchema.safeParse({
    variantId: formData.get("variantId"),
    locationId: formData.get("locationId") ?? undefined,
    qty: formData.get("qty"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  try {
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const { receiveVariantStock } = await import(
      "@/server/inventory/variant-inventory"
    );
    const result = await receiveVariantStock({
      shopId,
      variantId: parsed.data.variantId,
      locationId: parsed.data.locationId,
      qty: parsed.data.qty,
      note: parsed.data.note || undefined,
      userId: user.uid,
    });
    await revalidateInventoryViews({ variantId: parsed.data.variantId });
    return { ok: true, ...result };
  } catch (e) {
    log.warn("receive_variant_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

const AdjustVariantSchema = z.object({
  variantId: z.string().min(1),
  locationId: z.string().min(1),
  onHand: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? Number(v) : v)),
  reason: z.string().max(500).optional().or(z.literal("")),
});

export type AdjustVariantResult =
  | { ok: true; delta: number }
  | { ok: false; error: string };

export async function adjustVariantStockAction(
  payload: z.infer<typeof AdjustVariantSchema>,
): Promise<AdjustVariantResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = AdjustVariantSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  try {
    const { adjustVariantStock } = await import(
      "@/server/inventory/variant-inventory"
    );
    const { delta } = await adjustVariantStock({
      variantId: parsed.data.variantId,
      locationId: parsed.data.locationId,
      newOnHand: parsed.data.onHand,
      reason: parsed.data.reason?.trim() || undefined,
      userId: user.uid,
    });
    await revalidateInventoryViews({ variantId: parsed.data.variantId });
    return { ok: true, delta };
  } catch (e) {
    log.warn("adjust_variant_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export type VariantHistoryActionResult =
  | {
      ok: true;
      entries: import("@/server/inventory/batch-history").BatchHistoryEntry[];
    }
  | { ok: false; error: string };

export async function getVariantHistoryAction(
  variantId: string,
): Promise<VariantHistoryActionResult> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const { getVariantHistory } = await import(
      "@/server/inventory/variant-history"
    );
    const entries = await getVariantHistory(variantId);
    return { ok: true, entries };
  } catch (e) {
    log.warn("variant_history_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
