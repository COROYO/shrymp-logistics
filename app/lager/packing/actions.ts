"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  confirmPacking,
  TransitionError,
  type TrackingInput,
} from "@/server/picking/transitions";
import { log } from "@/lib/logger";

const TrackingSchema = z
  .object({
    carrier: z.string().max(80).optional(),
    number: z.string().max(80).optional(),
    url: z.string().url().optional(),
  })
  .optional();

export type ConfirmPackingActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function confirmPackingAction(
  orderId: string,
  tracking: TrackingInput | null,
): Promise<ConfirmPackingActionResult> {
  let user;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsedTracking = TrackingSchema.safeParse(tracking ?? undefined);
  if (!parsedTracking.success) {
    return { ok: false, error: "invalid_tracking" };
  }

  try {
    await confirmPacking(orderId, user.uid, parsedTracking.data);
    revalidatePath("/lager/picking");
    revalidatePath("/admin/orders");
    return { ok: true };
  } catch (e) {
    log.warn("confirm_packing_failed", { orderId, error: String(e) });
    if (e instanceof TransitionError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
