import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageLoadingShell } from "@/app/_components/page-loading-shell";
import { BinsContent } from "./bins-content";

export default async function LagerplaetzePage() {
  const t = await getTranslations("bins");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
            {t("intro")}
          </p>
        </div>
        <Link href="/admin/lagerplaetze/labels" className="btn-secondary text-sm">
          {t("toLabels")}
        </Link>
      </div>

      <Suspense fallback={<PageLoadingShell stats={0} rows={6} cols={4} />}>
        <BinsContent />
      </Suspense>
    </div>
  );
}
