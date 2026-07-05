import { getTranslations } from "next-intl/server";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { loadProductEditorPayload } from "@/server/catalog/save-product";
import { ProductEditor } from "../product-editor";

export const dynamic = "force-dynamic";

export default async function AdminProductNewPage() {
  const { shopId } = await requireTenantPageContext("/admin/products/new");
  const t = await getTranslations("productEditor");
  const payload = await loadProductEditorPayload(shopId);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
      </div>
      <ProductEditor payload={payload} />
    </div>
  );
}
