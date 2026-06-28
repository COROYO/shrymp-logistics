import { defineApiRoute } from "@/server/api/handler";
import { loadOrderRows } from "@/server/admin/orders-list";
import {
  ORDERS_LIST_FILTERS,
  type OrdersListFilter,
} from "@/app/admin/orders/filters";

export const GET = defineApiRoute(["orders:read"], async (ctx, req) => {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("status") ?? "ALL";
  const filter: OrdersListFilter = (ORDERS_LIST_FILTERS as string[]).includes(
    raw,
  )
    ? (raw as OrdersListFilter)
    : "ALL";

  const orders = await loadOrderRows(filter, ctx.shopId);
  return { orders };
});
