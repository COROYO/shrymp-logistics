"use server";
import { revalidatePath } from "next/cache";
import { backfillOrders } from "@/server/shopify/sync-orders";
import { enqueueAllocationRun } from "@/server/allocation/enqueue";
import { pushAllInventoryToShopify } from "@/server/inventory/push-all";

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
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const r = await pushAllInventoryToShopify();
    revalidatePath("/admin/batches");
    revalidatePath("/admin/settings");
    return { ok: true, ...r };
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
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    // Default: pull all unfulfilled, uncancelled orders. Adjust the query
    // string if you want a different cut.
    const r = await backfillOrders({
      query: "fulfillment_status:unfulfilled AND status:open",
    });
    // Run allocation once everything is mirrored.
    await enqueueAllocationRun({ triggeredBy: "MANUAL" });
    revalidatePath("/admin/orders");
    return { ok: true, ...r };
  } catch (e) {
    const { log } = await import("@/lib/logger");
    log.error("orders_backfill_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

import { requireRole } from "@/lib/auth/session";
import { ensureWebhookSubscription } from "@/server/shopify/mutations";
import { runAllocationInFirestore } from "@/server/allocation/run";
import { TOPICS } from "@/server/shopify/topics";
import { log } from "@/lib/logger";

const TOPIC_ENUM_BY_DOT: Record<string, string> = {
  [TOPICS.ORDERS_CREATE]: "ORDERS_CREATE",
  [TOPICS.ORDERS_UPDATED]: "ORDERS_UPDATED",
  [TOPICS.ORDERS_CANCELLED]: "ORDERS_CANCELLED",
  [TOPICS.INVENTORY_LEVELS_UPDATE]: "INVENTORY_LEVELS_UPDATE",
  [TOPICS.APP_UNINSTALLED]: "APP_UNINSTALLED",
};

export async function registerWebhooksAction(
  baseUrl: string,
): Promise<
  | { ok: true; results: Array<{ topic: string; created: boolean; id: string }> }
  | { ok: false; error: string }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!baseUrl) return { ok: false, error: "missing APP_BASE_URL env" };

  const callbackUrl = `${normalizeBaseUrl(baseUrl)}/api/webhooks/shopify`;

  try {
    const results = [];
    for (const dotTopic of Object.values(TOPICS)) {
      const enumTopic = TOPIC_ENUM_BY_DOT[dotTopic];
      if (!enumTopic) continue;
      const r = await ensureWebhookSubscription(enumTopic, callbackUrl);
      results.push({ topic: enumTopic, ...r });
    }
    revalidatePath("/admin/settings");
    return { ok: true, results };
  } catch (e) {
    log.error("register_webhooks_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function runAllocationAction(): Promise<
  | { ok: true; runId: string; shipCount: number; stopCount: number }
  | { ok: false; error: string }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const r = await runAllocationInFirestore({ triggeredBy: "MANUAL" });
    revalidatePath("/admin/orders");
    revalidatePath("/admin/settings");
    return {
      ok: true,
      runId: r.runId,
      shipCount: r.shipCount,
      stopCount: r.stopCount,
    };
  } catch (e) {
    log.error("manual_allocation_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
