"use server";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { runWithTenantAsync } from "@/server/tenant/context";
import { resolveScan, type ScanResult } from "@/server/warehouse/scan-resolver";
import { log } from "@/lib/logger";

export type ScanActionResult =
  | { ok: true; result: ScanResult }
  | { ok: false; error: string };

export async function resolveScanAction(code: string): Promise<ScanActionResult> {
  let user;
  try {
    user = await requireRole("LAGER", "ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const shopId = await requireActiveShopId(user);
    const result = await runWithTenantAsync(shopId, () =>
      resolveScan(shopId, code),
    );
    return { ok: true, result };
  } catch (e) {
    log.warn("scan_resolve_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
