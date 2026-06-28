import { resolveTenantShopId } from "@/server/tenant/context";
import { loadBatchesProductRows } from "@/server/admin/batches-list";
import { loadLagerConfig } from "@/server/lager/config";
import { ProductsView } from "./products-view";

export async function ProductsContent() {
  const shopId = await resolveTenantShopId();
  const lagerCfg = await loadLagerConfig(shopId);
  const payload = await loadBatchesProductRows(shopId, lagerCfg);

  return (
    <ProductsView
      initialData={{
        rows: payload.rows,
        batchesEnabled: lagerCfg.batches_enabled,
        locations: payload.locations,
        defaultLocationId: payload.defaultLocationId,
      }}
    />
  );
}
