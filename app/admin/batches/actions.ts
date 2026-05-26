"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { receiveBatch } from "@/server/inventory/receive";
import { log } from "@/lib/logger";

const FormSchema = z.object({
  variantId: z.string().min(1),
  chargeNumber: z.string().min(1).max(64),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

  const parsed = FormSchema.safeParse({
    variantId: formData.get("variantId"),
    chargeNumber: formData.get("chargeNumber"),
    expiryDate: formData.get("expiryDate"),
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
    const result = await receiveBatch({
      variantId: parsed.data.variantId,
      chargeNumber: parsed.data.chargeNumber.trim(),
      expiryDate: parsed.data.expiryDate,
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
