import { resolveTenantShopId } from "@/server/tenant/context";
import { listBins, listVariantsWithBins } from "@/server/warehouse/bins";
import { BinsManager } from "./bins-manager";

export async function BinsContent() {
  const shopId = await resolveTenantShopId();
  const [bins, variants] = await Promise.all([
    listBins(shopId),
    listVariantsWithBins(shopId),
  ]);
  return <BinsManager initialBins={bins} initialVariants={variants} />;
}
