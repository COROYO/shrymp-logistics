import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageLoadingShell } from "@/app/_components/page-loading-shell";
import { ImportExportBar } from "./import-export";
import { LagerbestandContent } from "./lagerbestand-content";

export default async function LagerbestandPage() {
  const t = await getTranslations("lagerbestand");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
        </div>
        <ImportExportBar />
      </div>

      <Suspense fallback={<PageLoadingShell stats={4} rows={12} cols={5} />}>
        <LagerbestandContent />
      </Suspense>
    </div>
  );
}
