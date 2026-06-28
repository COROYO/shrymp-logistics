import { resolveTenantShopId } from "@/server/tenant/context";
import { loadOrderRows } from "@/server/admin/orders-list";
import { OrdersTable } from "./orders-table";
import type { OrdersListFilter } from "./filters";

export async function OrdersContent({ filter }: { filter: OrdersListFilter }) {
  const shopId = await resolveTenantShopId();
  const orders = await loadOrderRows(filter, shopId);
  return <OrdersTable orders={orders} />;
}
