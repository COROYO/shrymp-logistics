"use server";
import { revalidatePath } from "next/cache";
import { requireRole, type SessionUser } from "@/lib/auth/session";
import { listAccessibleShopIds } from "@/lib/auth/tenant";
import { normalizeShopId } from "@/server/tenant/id";
import {
  adjustPickSlot,
  cancelPickRun,
  completePicking,
  createPickRun,
  finishRunIfPacked,
  loadPickRun,
  recordPickScan,
  PickRunError,
  type ScanPickResult,
} from "@/server/picking/pick-runs";
import { log } from "@/lib/logger";

export type CreateRunActionResult =
  | { ok: true; runId: string; skipped: { orderId: string; reason: string }[] }
  | { ok: false; error: string };

export async function createPickRunAction(
  orderIds: string[],
): Promise<CreateRunActionResult> {
  let user: SessionUser;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const accessible = await listAccessibleShopIds(user);
    const res = await createPickRun(orderIds, user.uid, accessible);
    revalidatePath("/lager/picking");
    revalidatePath(`/lager/run/${res.runId}`);
    return { ok: true, runId: res.runId, skipped: res.skipped };
  } catch (e) {
    log.warn("create_pick_run_failed", { error: String(e) });
    if (e instanceof PickRunError) return { ok: false, error: e.code };
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/** Load a run only if the caller may access its shop — otherwise null (masked). */
async function loadAccessibleRunShop(
  runId: string,
  user: SessionUser,
): Promise<string | null> {
  const run = await loadPickRun(runId);
  if (!run) return null;
  const accessible = await listAccessibleShopIds(user);
  if (!accessible.includes(normalizeShopId(run.shop_id))) return null;
  return run.shop_id;
}

export type ScanActionResult =
  | { ok: false; error: string }
  | { ok: true; result: ScanPickResult };

export async function scanPickAction(
  runId: string,
  code: string,
): Promise<ScanActionResult> {
  let user: SessionUser;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const shop = await loadAccessibleRunShop(runId, user);
  if (!shop) return { ok: false, error: "not_found" };
  const result = await recordPickScan(runId, code);
  revalidatePath(`/lager/run/${runId}`);
  return { ok: true, result };
}

export type SimpleActionResult = { ok: boolean; error?: string };

export async function adjustPickSlotAction(
  runId: string,
  variantId: string,
  slot: number,
  delta: number,
): Promise<SimpleActionResult> {
  let user: SessionUser;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const shop = await loadAccessibleRunShop(runId, user);
  if (!shop) return { ok: false, error: "not_found" };
  const res = await adjustPickSlot(runId, variantId, slot, delta);
  revalidatePath(`/lager/run/${runId}`);
  return res;
}

export async function completePickingAction(
  runId: string,
): Promise<SimpleActionResult> {
  let user: SessionUser;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const shop = await loadAccessibleRunShop(runId, user);
  if (!shop) return { ok: false, error: "not_found" };
  const res = await completePicking(runId);
  revalidatePath(`/lager/run/${runId}`);
  revalidatePath(`/lager/run/${runId}/pack`);
  return res;
}

export async function cancelPickRunAction(
  runId: string,
): Promise<SimpleActionResult> {
  let user: SessionUser;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const shop = await loadAccessibleRunShop(runId, user);
  if (!shop) return { ok: false, error: "not_found" };
  const res = await cancelPickRun(runId, user.uid);
  revalidatePath("/lager/picking");
  revalidatePath(`/lager/run/${runId}`);
  return res;
}

export type FinishRunActionResult =
  | { ok: true; done: boolean }
  | { ok: false; error: string };

export async function finishRunAction(
  runId: string,
): Promise<FinishRunActionResult> {
  let user: SessionUser;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const shop = await loadAccessibleRunShop(runId, user);
  if (!shop) return { ok: false, error: "not_found" };
  const res = await finishRunIfPacked(runId);
  if (!res.ok) return { ok: false, error: res.reason ?? "unknown" };
  revalidatePath("/lager/picking");
  revalidatePath(`/lager/run/${runId}/pack`);
  return { ok: true, done: res.done };
}
