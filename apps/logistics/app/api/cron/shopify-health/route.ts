import { NextResponse } from "next/server";
import { checkShopifyHealth } from "@/server/shopify/health";
import { ensureShopifyTokensForAllShops } from "@/server/shopify/token";
import { listActiveShops } from "@/server/tenant/shop";
import { checkCronAuth } from "@/lib/auth/cron";
import { log } from "@/lib/logger";

/**
 * Scheduled health check — keeps the Shopify connection alive.
 *
 * Trigger this every 15 min from Cloud Scheduler / Vercel Cron / GitHub
 * Actions / etc. Migrates legacy tokens, refreshes expiring tokens, and
 * auto-heals missing webhook subscriptions.
 *
 * Authentication: set `CRON_SECRET` in env and pass it as
 * `?secret=...` or `Authorization: Bearer ...`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const tokenResults = await ensureShopifyTokensForAllShops();
    const shops = await listActiveShops();
    const healthResults = [];
    for (const shop of shops) {
      const result = await checkShopifyHealth({
        autoHeal: true,
        shopId: shop.id,
      });
      healthResults.push({ shopId: shop.id, ...result });
      if (!result.ok) {
        log.warn("shopify_health_unhealthy", {
          shopId: shop.id,
          tokenValid: result.tokenValid,
          missingWebhooks: result.webhooks
            .filter((w) => !w.present)
            .map((w) => w.topic),
          errors: result.errors,
        });
      }
    }
    return NextResponse.json({ tokenResults, healthResults });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("shopify_health_check_crashed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
