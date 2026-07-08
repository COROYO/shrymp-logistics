"use server";
import { revalidatePath } from "next/cache";
import type { ForecastRunSummary } from "@/server/forecasting/run";

export async function runForecastAction(): Promise<
  ({ ok: true } & ForecastRunSummary) | { ok: false; error: string }
> {
  try {
    const { requireRole } = await import("@/lib/auth/session");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const { runWithTenantAsync } = await import("@/server/tenant/context");
    const { runForecastForShop } = await import("@/server/forecasting/run");
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const summary = await runWithTenantAsync(shopId, () =>
      runForecastForShop(shopId),
    );
    revalidatePath("/admin/forecasting");
    return { ok: true, ...summary };
  } catch (e) {
    const { log } = await import("@/lib/logger");
    log.error("forecast_action_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
