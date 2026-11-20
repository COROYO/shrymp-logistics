import "server-only";
import { log } from "@/lib/logger";
import { allocationTick } from "@/server/allocation/cron-tick";
import { runForecastForShop } from "@/server/forecasting/run";
import { reconcileStuckOrders } from "@/server/reconcile/stuck-orders";
import { checkShopifyHealth } from "@/server/shopify/health";
import { cleanupOutbox, processOutbox } from "@/server/shopify/outbox";
import { ensureShopifyTokensForAllShops } from "@/server/shopify/token";
import { listActiveShops } from "@/server/tenant/shop";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let started = false;

export function msUntilNextUtcHour(hour: number, now = Date.now()): number {
  const date = new Date(now);
  let next = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
    0,
    0,
    0,
  );
  if (next <= now) next += DAY;
  return next - now;
}

async function runLogged(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    log.error("inprocess_job_failed", { name, error: String(error) });
  }
}

function every(ms: number, name: string, fn: () => Promise<unknown>): void {
  const timer = setInterval(() => {
    void runLogged(name, fn);
  }, ms);
  timer.unref?.();
}

async function shopifyHealth(): Promise<void> {
  await ensureShopifyTokensForAllShops();
  const shops = await listActiveShops();
  for (const shop of shops) {
    const result = await checkShopifyHealth({ autoHeal: true, shopId: shop.id });
    if (!result.ok) {
      log.warn("shopify_health_unhealthy", {
        shopId: shop.id,
        tokenValid: result.tokenValid,
        missingWebhooks: result.webhooks.filter((hook) => !hook.present).map((hook) => hook.topic),
        errors: result.errors,
      });
    }
  }
}

async function dailyMaintenance(): Promise<void> {
  await cleanupOutbox();
  const shops = await listActiveShops();
  for (const shop of shops) {
    try {
      await runForecastForShop(shop.id);
    } catch (error) {
      log.error("forecast_run_failed", { shopId: shop.id, error: String(error) });
    }
  }
}

export function startInProcessJobs(): void {
  if (started || process.env.INPROCESS_JOBS !== "1") return;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  started = true;
  every(2 * MINUTE, "allocate", () => allocationTick());
  every(5 * MINUTE, "reconcile", () => reconcileStuckOrders());
  every(5 * MINUTE, "outbox_retry", () => processOutbox(100));
  every(15 * MINUTE, "shopify_health", () => shopifyHealth());
  const timer = setTimeout(() => {
    void runLogged("daily_maintenance", () => dailyMaintenance());
    every(DAY, "daily_maintenance", () => dailyMaintenance());
  }, msUntilNextUtcHour(3));
  timer.unref?.();
  log.info("inprocess_jobs_started", {});
}
