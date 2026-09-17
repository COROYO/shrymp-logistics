import { resolveTenantShopId } from "@/server/tenant/context";
import { loadOrderRows } from "@/server/admin/orders-list";
import { loadLagerConfig } from "@/server/lager/config";
import { OrdersTable } from "./orders-table";
import type { OrdersListFilter } from "./filters";

export async function OrdersContent({ filter }: { filter: OrdersListFilter }) {
  const shopId = await resolveTenantShopId();
  const [orders, lagerCfg] = await Promise.all([
    loadOrderRows(filter, shopId),
    loadLagerConfig(shopId),
  ]);
  return (
    <OrdersTable orders={orders} priorityTags={lagerCfg.priority_tags} />
  );
}
