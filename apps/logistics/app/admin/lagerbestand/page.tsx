import { getTranslations } from "next-intl/server";
import { ImportExportBar } from "./import-export";
import { LagerbestandDataLoader } from "./lagerbestand-data-loader";

export default async function LagerbestandPage() {
  const t = await getTranslations("lagerbestand");

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
      </div>

      <ImportExportBar />

      <LagerbestandDataLoader />
    </div>
  );
}
