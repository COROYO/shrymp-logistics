"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { receiveBatch } from "@/server/inventory/receive";
import {
  archiveBatch as svcArchiveBatch,
  BatchEditError,
  editBatch as svcEditBatch,
} from "@/server/inventory/edit-batch";
import { log } from "@/lib/logger";

// ----------------------- create / receive -----------------------

const ReceiveSchema = z.object({
  variantId: z.string().min(1),
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
      chargeNumber: parsed.data.chargeNumber.trim(),
      expiryDate: parsed.data.expiryDate,
      productionDate: parsed.data.productionDate
        ? parsed.data.productionDate
        : undefined,
      qty: parsed.data.qty,
      note: parsed.data.note || undefined,
      userId: user.uid,
    });
    revalidatePath("/admin/batches");
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
    revalidatePath("/admin/batches");
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
    revalidatePath("/admin/batches");
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
