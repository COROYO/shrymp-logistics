import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { loadProductEditorPayload } from "@/server/catalog/save-product";
import { ProductEditor } from "../product-editor";

export const dynamic = "force-dynamic";

export default async function AdminProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { shopId } = await requireTenantPageContext(`/admin/products/${id}`);
  const t = await getTranslations("productEditor");

  let payload;
  try {
    payload = await loadProductEditorPayload(shopId, id);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
      </div>
      <ProductEditor payload={payload} />
    </div>
  );
}
