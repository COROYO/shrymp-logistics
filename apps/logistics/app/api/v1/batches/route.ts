import { defineApiRoute } from "@/server/api/handler";
import { loadBatchesProductRows } from "@/server/admin/batches-list";
import { loadLagerConfig } from "@/server/lager/config";

export const GET = defineApiRoute(["batches:read"], async (ctx) => {
  const [payload, lagerCfg] = await Promise.all([
    loadBatchesProductRows(ctx.shopId),
    loadLagerConfig(ctx.shopId),
  ]);
  return {
    rows: payload.rows,
    locations: payload.locations,
    defaultLocationId: payload.defaultLocationId,
    batchesEnabled: lagerCfg.batches_enabled,
  };
});
