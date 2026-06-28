import { getTranslations } from "next-intl/server";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { ProductsDataLoader } from "./products-data-loader";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  await requireTenantPageContext("/admin/products");
  const t = await getTranslations("products");

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
      </div>

      <ProductsDataLoader />
    </div>
  );
}
