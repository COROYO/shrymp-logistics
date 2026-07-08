import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageLoadingShell } from "@/app/_components/page-loading-shell";
import { ForecastingContent } from "./forecasting-content";
import { RunForecastButton } from "./run-forecast-button";

export default async function ForecastingPage() {
  const t = await getTranslations("forecasting");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">
            {t("intro")}
          </p>
        </div>
        <RunForecastButton />
      </div>

      <Suspense fallback={<PageLoadingShell stats={2} rows={10} cols={8} />}>
        <ForecastingContent />
      </Suspense>
    </div>
  );
}
