"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import {
  cancelPicking,
  startPicking,
  TransitionError,
} from "@/server/picking/transitions";
import { log } from "@/lib/logger";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function startPickingAction(
  orderId: string,
): Promise<ActionResult> {
  let user;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    await startPicking(orderId, user.uid);
    revalidatePath("/lager/picking");
    revalidatePath(`/lager/picking/${orderId}`);
    return { ok: true };
  } catch (e) {
    log.warn("start_picking_failed", { orderId, error: String(e) });
    if (e instanceof TransitionError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function cancelPickingAction(
  orderId: string,
): Promise<ActionResult> {
  let user;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    await cancelPicking(orderId, user.uid);
    revalidatePath("/lager/picking");
    revalidatePath(`/lager/picking/${orderId}`);
    return { ok: true };
  } catch (e) {
    log.warn("cancel_picking_failed", { orderId, error: String(e) });
    if (e instanceof TransitionError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
