import { defineApiRoute } from "@/server/api/handler";
import { loadLagerbestandRows } from "@/server/admin/lagerbestand-list";

export const GET = defineApiRoute(["inventory:read"], async (ctx) => {
  const rows = await loadLagerbestandRows(ctx.shopId);
  return { rows };
});
