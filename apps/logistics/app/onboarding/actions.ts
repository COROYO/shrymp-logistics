"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import {
  completeOnboarding,
  getOnboardingStep,
  saveOnboardingStep,
} from "@/server/onboarding/state";
import { log } from "@/lib/logger";

export async function getOnboardingStateAction(): Promise<
  | { ok: true; step: number; completed: boolean }
  | { ok: false; error: string }
> {
  try {
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const { shopNeedsOnboarding } = await import("@/server/onboarding/state");
    const [step, needs] = await Promise.all([
      getOnboardingStep(shopId),
      shopNeedsOnboarding(shopId),
    ]);
    return { ok: true, step, completed: !needs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function saveOnboardingStepAction(
  step: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    await saveOnboardingStep(shopId, step);
    revalidatePath("/onboarding/setup");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function completeOnboardingAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    await completeOnboarding(shopId);
    revalidatePath("/onboarding/setup");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/** Start product sync as part of onboarding import. */
export async function startOnboardingProductSyncAction(): Promise<
  | { ok: true; runId: string }
  | { ok: false; error: string }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  try {
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const {
      startProductSyncRun,
      kickProductSyncWorker,
    } = await import("@/server/shopify/product-sync-run");

    const started = await startProductSyncRun(shopId, true);
    if ("error" in started) {
      if (started.error === "sync_already_running") {
        return { ok: false, error: "sync_already_running" };
      }
      return { ok: false, error: "start_failed" };
    }

    void kickProductSyncWorker(started.runId, shopId);
    return { ok: true, runId: started.runId };
  } catch (e) {
    log.error("onboarding_product_sync_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/** Import open orders + customer history after product sync. */
export async function runOnboardingOrdersImportAction(): Promise<
  | {
      ok: true;
      openOrders: number;
      historyOrders: number;
    }
  | { ok: false; error: string }
> {
  try {
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const { backfillOrders } = await import("@/server/shopify/sync-orders");
    const { enqueueAllocationRun } = await import("@/server/allocation/enqueue");
    const { runWithTenantAsync } = await import("@/server/tenant/context");

    const open = await runWithTenantAsync(shopId, () =>
      backfillOrders({
        shopId,
        query: "fulfillment_status:unfulfilled AND status:open",
      }),
    );

    await enqueueAllocationRun({ shopId, triggeredBy: "MANUAL" });

    const history = await runWithTenantAsync(shopId, () =>
      backfillOrders({
        shopId,
        query: "",
        maxPages: 20,
      }),
    );

    revalidatePath("/admin/orders");
    revalidatePath("/admin/customers");
    revalidatePath("/admin/products");

    return {
      ok: true,
      openOrders: open.mirroredCount,
      historyOrders: history.mirroredCount,
    };
  } catch (e) {
    log.error("onboarding_orders_import_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
