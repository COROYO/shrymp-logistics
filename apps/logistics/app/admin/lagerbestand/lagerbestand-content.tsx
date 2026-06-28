import { resolveTenantShopId } from "@/server/tenant/context";
import { loadLagerbestandRows } from "@/server/admin/lagerbestand-list";
import { LagerbestandView } from "./lagerbestand-view";

export async function LagerbestandContent() {
  const shopId = await resolveTenantShopId();
  const rows = await loadLagerbestandRows(shopId);
  return <LagerbestandView initialRows={rows} />;
}
