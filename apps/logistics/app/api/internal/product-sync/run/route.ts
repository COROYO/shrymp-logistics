import { z } from "zod";
import { checkCronAuth } from "@/lib/auth/cron";
import { log } from "@/lib/logger";
import {
  continueProductSyncAfterChunk,
  runProductSyncChunk,
} from "@/server/shopify/product-sync-run";
import { runWithTenantAsync } from "@/server/tenant/context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  runId: z.string().min(1),
  shopId: z.string().min(1),
});

export async function POST(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) {
    return new Response(auth.error, { status: auth.status });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return new Response("invalid_body", { status: 400 });
  }

  try {
    const result = await runWithTenantAsync(body.shopId, () =>
      runProductSyncChunk(body.runId, body.shopId),
    );
    void continueProductSyncAfterChunk(body.runId, body.shopId, result);
    return Response.json({ ok: true, runId: body.runId, done: result.done });
  } catch (e) {
    log.error("product_sync_run_endpoint_error", { error: String(e) });
    return new Response("run_failed", { status: 500 });
  }
}
