"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { log } from "@/lib/logger";

export async function triggerProductSyncAction(
  syncInventory = false,
): Promise<
  | {
      ok: true;
      started: true;
      runId: string;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  try {
    const user = await requireRole("ADMIN");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const {
      startProductSyncRun,
      kickProductSyncWorker,
    } = await import("@/server/shopify/product-sync-run");

    const started = await startProductSyncRun(shopId, syncInventory);
    if ("error" in started) {
      if (started.error === "sync_already_running") {
        return { ok: false, error: "sync_already_running" };
      }
      return { ok: false, error: "start_failed" };
    }

    void kickProductSyncWorker(started.runId, shopId);

    revalidatePath("/admin/settings/shopify");
    return { ok: true, started: true, runId: started.runId };
  } catch (e) {
    log.error("product_sync_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function listAdminJobsAction(): Promise<
  | {
      ok: true;
      jobs: Array<{
        id: string;
        kind: "product_sync";
        status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
        phase: string;
        productCount: number;
        variantCount: number;
        syncInventory: boolean;
        inventoryUpdated?: number;
        error?: string;
        cancelRequested?: boolean;
        finishedAtMs?: number;
      }>;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  try {
    const user = await requireRole("ADMIN");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const { listVisibleProductSyncJobs } = await import(
      "@/server/shopify/product-sync-run"
    );
    const rows = await listVisibleProductSyncJobs(shopId);
    return {
      ok: true,
      jobs: rows.map((r) => ({
        id: r.runId,
        kind: "product_sync" as const,
        status: r.status,
        phase: r.phase,
        productCount: r.productCount,
        variantCount: r.variantCount,
        syncInventory: r.syncInventory,
        inventoryUpdated: r.inventoryUpdated,
        error: r.error,
        cancelRequested: r.cancelRequested,
        finishedAtMs: r.finishedAtMs,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/** X on running job: cooperative cancel, then force-stop if already stopping. */
export async function cancelProductSyncRunAction(
  runId: string,
  force = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  try {
    const user = await requireRole("ADMIN");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const {
      requestCancelProductSyncRunById,
      forceCancelProductSyncRunById,
    } = await import("@/server/shopify/product-sync-run");

    const result = force
      ? await forceCancelProductSyncRunById(runId, shopId)
      : await requestCancelProductSyncRunById(runId, shopId);

    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/admin/products");
    revalidatePath("/admin/settings/shopify");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
