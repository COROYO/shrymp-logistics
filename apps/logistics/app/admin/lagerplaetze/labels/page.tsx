import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { listBinsForLabels } from "@/server/warehouse/bins";
import { runWithTenantAsync } from "@/server/tenant/context";
import { LabelSheet } from "./label-sheet";

export const dynamic = "force-dynamic";

export default async function LabelsPage() {
  const { shopId } = await requireTenantPageContext("/admin/lagerplaetze/labels");
  const bins = await runWithTenantAsync(shopId, () => listBinsForLabels(shopId));
  const t = await getTranslations("binLabels");

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link
          href="/admin/lagerplaetze"
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-navy/60 transition hover:text-brand-burgundy"
        >
          {t("back")}
        </Link>
        <h1 className="h-display mt-3 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
      </div>

      <LabelSheet bins={bins} />
    </div>
  );
}
