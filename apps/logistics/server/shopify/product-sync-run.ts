import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type ProductSyncRun,
  type ProductSyncRunPhase,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { runtimeEnv } from "@/lib/runtime-env";
import { normalizeShopId } from "@/server/tenant/id";
import { runWithTenantAsync } from "@/server/tenant/context";
import { fetchProductsPage, fetchInventoryLevelsByItemGids } from "./queries";
import { numericIdFromGid } from "./sync";
import {
  clearPendingInventory,
  queuePendingInventoryItems,
  takePendingInventoryChunk,
  writeShopifyCatalogPage,
} from "./sync-catalog-page";

export type ProductSyncRunProgress = {
  phase?: ProductSyncRunPhase;
  product_count?: number;
  variant_count?: number;
};

export type ProductSyncStatusSnapshot = {
  runId: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  phase: ProductSyncRunPhase;
  productCount: number;
  variantCount: number;
  syncInventory: boolean;
  inventoryUpdated?: number;
  error?: string;
  cancelRequested?: boolean;
  startedAtMs?: number;
  finishedAtMs?: number;
};

const STALE_RUN_MS = 20 * 60 * 1000;
const CATALOG_PAGE_SIZE = 50;

type ChunkResult = { done: true } | { done: false };

export async function findRunningProductSyncRun(
  shopId: string,
): Promise<ProductSyncStatusSnapshot | null> {
  const db = adminDb();
  const normalizedShopId = normalizeShopId(shopId);
  const snap = await db
    .collection(Collections.ProductSyncRuns)
    .where("shop_id", "==", normalizedShopId)
    .where("status", "==", "RUNNING")
    .limit(1)
    .get();
  if (snap.empty) return null;
  return serializeRun(snap.docs[0]!.id, snap.docs[0]!.data());
}

async function loadRun(runId: string): Promise<ProductSyncRun | null> {
  const snap = await adminDb()
    .collection(Collections.ProductSyncRuns)
    .doc(runId)
    .get();
  if (!snap.exists) return null;
  return snap.data() as ProductSyncRun;
}

async function isRunCancelled(runId: string): Promise<boolean> {
  const snap = await adminDb()
    .collection(Collections.ProductSyncRuns)
    .doc(runId)
    .get();
  if (!snap.exists) return true;
  const data = snap.data()!;
  return data.cancel_requested === true || data.status !== "RUNNING";
}

export async function startProductSyncRun(
  shopId: string,
  syncInventory: boolean,
): Promise<{ runId: string } | { error: "sync_already_running" | "start_failed" }> {
  const db = adminDb();
  const normalizedShopId = normalizeShopId(shopId);

  const active = await findRunningProductSyncRun(normalizedShopId);
  if (active) {
    const stale =
      active.startedAtMs != null &&
      Date.now() - active.startedAtMs > STALE_RUN_MS;
    if (!stale) return { error: "sync_already_running" };
    await finishProductSyncRun(active.runId, "CANCELLED", {
      error: "stale_run_replaced",
    });
    await clearPendingInventory(active.runId);
  }

  const runRef = db.collection(Collections.ProductSyncRuns).doc();
  const now = FieldValue.serverTimestamp();
  try {
    await runRef.set({
      id: runRef.id,
      shop_id: normalizedShopId,
      sync_inventory: syncInventory,
      status: "RUNNING",
      phase: "starting",
      product_count: 0,
      variant_count: 0,
      cancel_requested: false,
      locations_synced: false,
      catalog_cursor: null,
      catalog_has_next: true,
      started_at: now,
      updated_at: now,
    });
    return { runId: runRef.id };
  } catch (e) {
    log.error("product_sync_run_create_failed", { error: String(e) });
    return { error: "start_failed" };
  }
}

export async function requestCancelProductSyncRun(
  shopId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const running = await findRunningProductSyncRun(normalizeShopId(shopId));
  if (!running) return { ok: false, error: "no_running_sync" };
  return requestCancelProductSyncRunById(running.runId, shopId);
}

export async function requestCancelProductSyncRunById(
  runId: string,
  shopId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = await loadRun(runId);
  if (!run || run.shop_id !== normalizeShopId(shopId)) {
    return { ok: false, error: "not_found" };
  }
  if (run.status !== "RUNNING") return { ok: false, error: "not_running" };

  await adminDb()
    .collection(Collections.ProductSyncRuns)
    .doc(runId)
    .set(
      {
        cancel_requested: true,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  return { ok: true };
}

export async function forceCancelProductSyncRun(
  shopId: string,
): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const running = await findRunningProductSyncRun(normalizeShopId(shopId));
  if (!running) return { ok: false, error: "no_running_sync" };
  return forceCancelProductSyncRunById(running.runId, shopId);
}

export async function forceCancelProductSyncRunById(
  runId: string,
  shopId: string,
): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const run = await loadRun(runId);
  if (!run || run.shop_id !== normalizeShopId(shopId)) {
    return { ok: false, error: "not_found" };
  }
  if (run.status !== "RUNNING") return { ok: false, error: "not_running" };

  await finishProductSyncRun(runId, "CANCELLED", {
    error: "cancelled_by_user",
  });
  await clearPendingInventory(runId);
  return { ok: true, runId };
}

export async function updateProductSyncRunProgress(
  runId: string,
  patch: ProductSyncRunProgress,
): Promise<void> {
  await adminDb()
    .collection(Collections.ProductSyncRuns)
    .doc(runId)
    .set(
      {
        ...patch,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

async function finishProductSyncRun(
  runId: string,
  status: "COMPLETED" | "FAILED" | "CANCELLED",
  extra: Record<string, unknown>,
): Promise<void> {
  await adminDb()
    .collection(Collections.ProductSyncRuns)
    .doc(runId)
    .set(
      {
        status,
        phase:
          status === "COMPLETED"
            ? "done"
            : ((extra.phase as string | undefined) ?? "catalog"),
        finished_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
        ...extra,
      },
      { merge: true },
    );
}

/** Process a single chunk; caller schedules the next chunk when `done` is false. */
export async function runProductSyncChunk(
  runId: string,
  shopId: string,
): Promise<ChunkResult> {
  const normalizedShopId = normalizeShopId(shopId);
  const run = await loadRun(runId);
  if (!run || run.status !== "RUNNING") return { done: true };

  if (await isRunCancelled(runId)) {
    await finishProductSyncRun(runId, "CANCELLED", {
      error: run.cancel_requested ? "cancelled_by_user" : "run_stopped",
    });
    await clearPendingInventory(runId);
    return { done: true };
  }

  try {
    if (!run.locations_synced) {
      await updateProductSyncRunProgress(runId, { phase: "locations" });
      const { syncLocationsFromShopify } = await import(
        "@/server/locations/sync-from-shopify"
      );
      const locSync = await syncLocationsFromShopify(normalizedShopId);
      const { updateShopMeta } = await import("@/server/tenant/shop");
      await updateShopMeta(normalizedShopId, {
        location_gid: locSync.primaryLocationGid,
        api_version: process.env.SHOPIFY_API_VERSION ?? "2026-04",
      });
      await adminDb()
        .collection(Collections.ProductSyncRuns)
        .doc(runId)
        .set(
          {
            locations_synced: true,
            phase: "catalog",
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      return { done: false };
    }

    if (run.catalog_has_next !== false) {
      await updateProductSyncRunProgress(runId, {
        phase: "catalog",
        product_count: run.product_count,
        variant_count: run.variant_count,
      });

      const page = await fetchProductsPage(run.catalog_cursor ?? null, CATALOG_PAGE_SIZE);
      const written = await writeShopifyCatalogPage(normalizedShopId, page.products);
      const productCount = run.product_count + written.productsAdded;
      const variantCount = run.variant_count + written.variantsAdded;

      if (run.sync_inventory && written.inventoryItems.length > 0) {
        await queuePendingInventoryItems(runId, written.inventoryItems);
      }

      await adminDb()
        .collection(Collections.ProductSyncRuns)
        .doc(runId)
        .set(
          {
            product_count: productCount,
            variant_count: variantCount,
            catalog_cursor: page.endCursor,
            catalog_has_next: page.hasNextPage,
            phase: page.hasNextPage ? "catalog" : run.sync_inventory ? "inventory" : "done",
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

      if (page.hasNextPage) return { done: false };

      if (!run.sync_inventory) {
        await finishProductSyncRun(runId, "COMPLETED", {
          phase: "done",
          product_count: productCount,
          variant_count: variantCount,
          inventory_updated: 0,
        });
        log.info("product_sync_run_completed", { runId, productCount, variantCount });
        return { done: true };
      }

      return { done: false };
    }

    const pending = await takePendingInventoryChunk(runId);
    if (pending.length > 0) {
      await updateProductSyncRunProgress(runId, {
        phase: "inventory",
        product_count: run.product_count,
        variant_count: run.variant_count,
      });

      const itemToVariant = new Map(
        pending.map((p) => [p.inventoryItemGid, p.variantId]),
      );
      const pulls: {
        variantId: string;
        locationId: string;
        shopifyAvailable: number;
      }[] = [];

      for await (const row of fetchInventoryLevelsByItemGids([
        ...itemToVariant.keys(),
      ])) {
        const variantId = itemToVariant.get(row.inventoryItemGid);
        if (!variantId) continue;
        for (const loc of row.locations) {
          pulls.push({
            variantId,
            locationId: numericIdFromGid(loc.locationGid),
            shopifyAvailable: loc.available,
          });
        }
      }

      let inventoryUpdated = run.inventory_updated ?? 0;
      if (pulls.length > 0) {
        await updateProductSyncRunProgress(runId, {
          phase: "applying_inventory",
          product_count: run.product_count,
          variant_count: run.variant_count,
        });
        const { applyShopifyInventoryByLocationBulk } = await import(
          "@/server/locations/inventory-pull"
        );
        const inv = await applyShopifyInventoryByLocationBulk(
          normalizedShopId,
          pulls,
          `product-sync-${runId}`,
        );
        inventoryUpdated += inv.variantsUpdated;
      }

      await adminDb()
        .collection(Collections.ProductSyncRuns)
        .doc(runId)
        .set(
          {
            inventory_updated: inventoryUpdated,
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

      return { done: false };
    }

    await finishProductSyncRun(runId, "COMPLETED", {
      phase: "done",
      product_count: run.product_count,
      variant_count: run.variant_count,
      inventory_updated: run.inventory_updated ?? 0,
    });
    log.info("product_sync_run_completed", {
      runId,
      productCount: run.product_count,
      variantCount: run.variant_count,
    });
    return { done: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finishProductSyncRun(runId, "FAILED", { error: message });
    await clearPendingInventory(runId);
    log.error("product_sync_run_failed", { runId, error: message });
    return { done: true };
  }
}

export async function listVisibleProductSyncJobs(
  shopId: string,
): Promise<ProductSyncStatusSnapshot[]> {
  const normalizedShopId = normalizeShopId(shopId);
  const db = adminDb();
  const now = Date.now();
  const seen = new Set<string>();
  const out: ProductSyncStatusSnapshot[] = [];

  const runningSnap = await db
    .collection(Collections.ProductSyncRuns)
    .where("shop_id", "==", normalizedShopId)
    .where("status", "==", "RUNNING")
    .get();

  for (const doc of runningSnap.docs) {
    out.push(serializeRun(doc.id, doc.data()));
    seen.add(doc.id);
  }

  const recentSnap = await db
    .collection(Collections.ProductSyncRuns)
    .where("shop_id", "==", normalizedShopId)
    .orderBy("started_at", "desc")
    .limit(10)
    .get();

  for (const doc of recentSnap.docs) {
    if (seen.has(doc.id)) continue;
    const row = serializeRun(doc.id, doc.data());
    if (row.status === "RUNNING") continue;
    // Failed jobs stay until manually dismissed in the tray.
    if (row.status === "FAILED") {
      out.push(row);
      seen.add(doc.id);
      continue;
    }
    const finishedAtMs = row.finishedAtMs;
    if (finishedAtMs && now - finishedAtMs > 15_000) continue;
    out.push(row);
    seen.add(doc.id);
  }

  return out.sort(
    (a, b) => (b.startedAtMs ?? 0) - (a.startedAtMs ?? 0),
  );
}

export async function getLatestProductSyncStatus(
  shopId: string,
): Promise<ProductSyncStatusSnapshot | null> {
  const jobs = await listVisibleProductSyncJobs(shopId);
  return jobs[0] ?? null;
}

/** Latest successful full sync timestamp for admin UI (ms since epoch). */
export async function getLastCompletedProductSyncFinishedAtMs(
  shopId: string,
): Promise<number | null> {
  const normalizedShopId = normalizeShopId(shopId);
  const snap = await adminDb()
    .collection(Collections.ProductSyncRuns)
    .where("shop_id", "==", normalizedShopId)
    .orderBy("started_at", "desc")
    .limit(25)
    .get();

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.status !== "COMPLETED") continue;
    const ms = timestampToMs(data.finished_at);
    if (ms != null) return ms;
  }
  return null;
}

function serializeRun(
  id: string,
  data: FirebaseFirestore.DocumentData,
): ProductSyncStatusSnapshot {
  return {
    runId: id,
    status: data.status as ProductSyncStatusSnapshot["status"],
    phase: data.phase as ProductSyncRunPhase,
    productCount: (data.product_count as number | undefined) ?? 0,
    variantCount: (data.variant_count as number | undefined) ?? 0,
    syncInventory: data.sync_inventory === true,
    inventoryUpdated: data.inventory_updated as number | undefined,
    error: data.error as string | undefined,
    cancelRequested: data.cancel_requested === true,
    startedAtMs: timestampToMs(data.started_at),
    finishedAtMs: timestampToMs(data.finished_at),
  };
}

function timestampToMs(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if ("seconds" in value && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }
  return undefined;
}

async function scheduleProductSyncChunkHttp(
  runId: string,
  shopId: string,
): Promise<boolean> {
  const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
  const secret = runtimeEnv("CRON_SECRET");
  if (!baseUrl || !secret) return false;

  try {
    const res = await fetch(
      `${baseUrl}/api/internal/product-sync/run?secret=${encodeURIComponent(secret)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, shopId }),
      },
    );
    if (!res.ok) {
      log.error("product_sync_worker_http_failed", {
        runId,
        status: res.status,
        body: (await res.text()).slice(0, 300),
      });
      return false;
    }
    return true;
  } catch (e) {
    log.error("product_sync_worker_fetch_failed", { runId, error: String(e) });
    return false;
  }
}

async function runProductSyncChunkChain(
  runId: string,
  shopId: string,
): Promise<void> {
  try {
    for (let i = 0; i < 5000; i++) {
      const result = await runWithTenantAsync(shopId, () =>
        runProductSyncChunk(runId, shopId),
      );
      if (result.done) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    await finishProductSyncRun(runId, "FAILED", {
      error: "chunk_limit_exceeded",
    });
  } catch (e) {
    log.error("product_sync_chain_failed", { runId, error: String(e) });
  }
}

export async function kickProductSyncWorker(
  runId: string,
  shopId: string,
): Promise<void> {
  const scheduled = await scheduleProductSyncChunkHttp(runId, shopId);
  if (scheduled) return;
  void runProductSyncChunkChain(runId, shopId);
}

/** Called by the internal HTTP route after each chunk. */
export async function continueProductSyncAfterChunk(
  runId: string,
  shopId: string,
  result: ChunkResult,
): Promise<void> {
  if (result.done) return;
  const scheduled = await scheduleProductSyncChunkHttp(runId, shopId);
  if (!scheduled) {
    void runProductSyncChunkChain(runId, shopId);
  }
}

/** @deprecated Use runProductSyncChunk — kept for tests calling full sync inline. */
export async function executeProductSyncRun(
  runId: string,
  shopId: string,
  _syncInventory: boolean,
): Promise<void> {
  void _syncInventory;
  await runProductSyncChunkChain(runId, shopId);
}
