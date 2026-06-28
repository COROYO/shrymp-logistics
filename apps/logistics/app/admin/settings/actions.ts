"use server";
import { revalidatePath } from "next/cache";
import { backfillOrders } from "@/server/shopify/sync-orders";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
import { pushAllLocationStockToShopify } from "@/server/locations/push-stock";

function normalizeBaseUrl(s: string): string {
  const trimmed = s.trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export async function pushAllInventoryAction(): Promise<
  | {
      ok: true;
      variantCount: number;
      queuedChunks: number;
      skipped: number;
      drained: { processed: number; failed: number; done: number };
    }
  | { ok: false; error: string }
> {
  try {
    const { requireRole } = await import("@/lib/auth/session");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const { runWithTenantAsync } = await import("@/server/tenant/context");
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const r = await runWithTenantAsync(shopId, () =>
      pushAllLocationStockToShopify(shopId),
    );
    revalidatePath("/admin/products");
    revalidatePath("/admin/settings");
    return {
      ok: true,
      variantCount: r.variantCount,
      queuedChunks: r.queuedChunks,
      skipped: r.skipped,
      drained: r.drained,
    };
  } catch (e) {
    const { log } = await import("@/lib/logger");
    log.error("bulk_inventory_push_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function backfillOrdersAction(): Promise<
  | { ok: true; mirroredCount: number; pages: number }
  | { ok: false; error: string }
> {
  try {
    const { requireRole } = await import("@/lib/auth/session");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const r = await backfillOrders({
      shopId,
      query: "fulfillment_status:unfulfilled AND status:open",
    });
    await enqueueAllocationRun({ shopId, triggeredBy: "MANUAL" });
    revalidatePath("/admin/orders");
    return { ok: true, ...r };
  } catch (e) {
    const { log } = await import("@/lib/logger");
    log.error("orders_backfill_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Pull ALL historical orders (no `query` filter) to populate the customer
 * history view. Idempotent — orders that already exist get merged with
 * preserved `internal_status`.
 */
export async function backfillAllOrdersAction(): Promise<
  | { ok: true; mirroredCount: number; pages: number }
  | { ok: false; error: string }
> {
  try {
    const { requireRole } = await import("@/lib/auth/session");
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const { requireRole } = await import("@/lib/auth/session");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const r = await backfillOrders({ shopId, query: "" });
    revalidatePath("/admin/customers");
    revalidatePath("/admin/orders");
    return { ok: true, ...r };
  } catch (e) {
    const { log } = await import("@/lib/logger");
    log.error("orders_full_backfill_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

import { requireRole } from "@/lib/auth/session";
import { registerAllWebhooks } from "@/server/shopify/register-webhooks";
import { runAllocationInFirestore } from "@/server/allocation/run";
import { log } from "@/lib/logger";

export async function runHealthCheckAction(): Promise<
  | {
      ok: boolean;
      tokenValid: boolean;
      webhooks: Array<{
        topic: string;
        present: boolean;
        repaired?: boolean;
      }>;
      errors: string[];
      checkedAt: string;
    }
  | { ok: false; error: string; checkedAt?: undefined }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const { checkShopifyHealth } = await import("@/server/shopify/health");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const r = await checkShopifyHealth({ autoHeal: true, shopId });
    revalidatePath("/admin/settings");
    return {
      ok: r.ok,
      tokenValid: r.tokenValid,
      webhooks: r.webhooks.map((w) => ({
        topic: w.topic,
        present: w.present,
        repaired: w.repaired,
      })),
      errors: r.errors,
      checkedAt: r.checkedAt,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function registerWebhooksAction(): Promise<
  | { ok: true; results: Array<{ topic: string; created: boolean; id: string }> }
  | { ok: false; error: string }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  // Callback host must come from server env only — never from the client,
  // otherwise an admin could point shop webhooks at an attacker-controlled URL.
  const envBaseUrl = process.env.APP_BASE_URL;
  if (!envBaseUrl) return { ok: false, error: "missing APP_BASE_URL env" };

  const callbackUrl = `${normalizeBaseUrl(envBaseUrl)}/api/webhooks/shopify`;

  try {
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const results = await registerAllWebhooks(shopId, callbackUrl);
    revalidatePath("/admin/settings");
    return { ok: true, results };
  } catch (e) {
    log.error("register_webhooks_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function runAllocationAction(): Promise<
  | {
      ok: true;
      runId: string;
      shipCount: number;
      stopCount: number;
      tagsPushed: number;
      tagsFailed: number;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const { runWithTenantAsync } = await import("@/server/tenant/context");
    const r = await runWithTenantAsync(shopId, () =>
      runAllocationInFirestore({ shopId, triggeredBy: "MANUAL" }),
    );
    revalidatePath("/admin/orders");
    revalidatePath("/admin/settings");
    return {
      ok: true,
      runId: r.runId,
      shipCount: r.shipCount,
      stopCount: r.stopCount,
      tagsPushed: r.outbox.processed,
      tagsFailed: r.outbox.failed,
    };
  } catch (e) {
    log.error("manual_allocation_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
