import "server-only";
import { runtimeEnv } from "@/lib/runtime-env";

/**
 * Shared auth gate for scheduled (cron) endpoints.
 *
 * `CRON_SECRET` is mandatory: if it is not configured the endpoint refuses
 * (503) instead of running unauthenticated. Without this, allocation,
 * reconcile, health and cleanup would be publicly triggerable for every shop.
 */
export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 503 | 401; error: string };

export function checkCronAuth(req: Request): CronAuthResult {
  const expected = runtimeEnv("CRON_SECRET");
  if (!expected) {
    return { ok: false, status: 503, error: "cron_secret_not_configured" };
  }
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("secret");
  const fromHeader = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  const provided = fromQuery ?? fromHeader ?? "";
  if (provided !== expected) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}
