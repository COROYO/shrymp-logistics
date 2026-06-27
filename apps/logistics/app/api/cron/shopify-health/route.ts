import { NextResponse } from "next/server";
import { checkShopifyHealth } from "@/server/shopify/health";
import { checkCronAuth } from "@/lib/auth/cron";
import { log } from "@/lib/logger";

/**
 * Scheduled health check — keeps the Shopify connection alive.
 *
 * Trigger this every 15 min from Cloud Scheduler / Vercel Cron / GitHub
 * Actions / etc. Auto-heals missing webhook subscriptions (the most common
 * source of "the app stopped working"). Token revocation can't be self-
 * healed — only a fresh OAuth install fixes it — but it gets logged so the
 * admin knows to act.
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
    const result = await checkShopifyHealth({ autoHeal: true });
    if (!result.ok) {
      log.warn("shopify_health_unhealthy", {
        tokenValid: result.tokenValid,
        missingWebhooks: result.webhooks
          .filter((w) => !w.present)
          .map((w) => w.topic),
        errors: result.errors,
      });
    }
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("shopify_health_check_crashed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
