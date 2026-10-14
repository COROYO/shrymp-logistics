"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import {
  completeOnboarding,
  getOnboardingImport,
  getOnboardingStep,
  markOnboardingOrdersImported,
  markOnboardingProductsImported,
  resolveOnboardingImport,
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

/** Start product sync as part of onboarding import. Skips when the catalog is already in. */
export async function startOnboardingProductSyncAction(): Promise<
  | { ok: true; skipped: true; products: number; variants: number }
  | { ok: true; skipped: false; runId: string }
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
    const stored = await getOnboardingImport(shopId);
    const resolved = stored.productsDone
      ? stored
      : await resolveOnboardingImport(shopId);
    if (resolved.productsDone) {
      if (!stored.productsDone) {
        await markOnboardingProductsImported(
          shopId,
          resolved.productCount,
          resolved.variantCount,
        );
      }
      return {
        ok: true,
        skipped: true,
        products: resolved.productCount,
        variants: resolved.variantCount,
      };
    }

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
    return { ok: true, skipped: false, runId: started.runId };
  } catch (e) {
    log.error("onboarding_product_sync_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/** Remember a finished product sync so a later retry does not page Shopify again. */
export async function markOnboardingProductsImportedAction(
  productCount: number,
  variantCount: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    await markOnboardingProductsImported(shopId, productCount, variantCount);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/** Import one order stage after product sync. Stages run separately so the wizard can show progress. */
export async function runOnboardingOrdersImportAction(
  stage: "open" | "history",
): Promise<
  { ok: true; count: number; skipped: boolean } | { ok: false; error: string }
> {
  try {
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const imported = await getOnboardingImport(shopId);
    if (stage === "open" && imported.openOrdersDone) {
      return { ok: true, count: imported.openOrdersCount, skipped: true };
    }
    if (stage === "history" && imported.historyDone) {
      return { ok: true, count: imported.historyOrdersCount, skipped: true };
    }

    const { backfillOrders } = await import("@/server/shopify/sync-orders");
    const { runWithTenantAsync } = await import("@/server/tenant/context");

    if (stage === "open") {
      const { enqueueAllocationRun } = await import(
        "@/server/allocation/enqueue"
      );
      const open = await runWithTenantAsync(shopId, () =>
        backfillOrders({
          shopId,
          query: "fulfillment_status:unfulfilled AND status:open",
        }),
      );
      await enqueueAllocationRun({ shopId, triggeredBy: "MANUAL" });
      await markOnboardingOrdersImported(shopId, "open", open.mirroredCount);
      revalidatePath("/admin/orders");
      return { ok: true, count: open.mirroredCount, skipped: false };
    }

    const history = await runWithTenantAsync(shopId, () =>
      backfillOrders({
        shopId,
        query: "",
        maxPages: 20,
      }),
    );

    await markOnboardingOrdersImported(shopId, "history", history.mirroredCount);
    revalidatePath("/admin/orders");
    revalidatePath("/admin/customers");
    revalidatePath("/admin/products");
    return { ok: true, count: history.mirroredCount, skipped: false };
  } catch (e) {
    log.error("onboarding_orders_import_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
