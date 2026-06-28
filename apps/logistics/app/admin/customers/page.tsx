import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageLoadingShell } from "@/app/_components/page-loading-shell";
import { BackfillAllOrdersButton } from "./backfill-button";
import { CustomersContent } from "./customers-content";

export default async function CustomersPage() {
  const t = await getTranslations("customers");

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
      </div>

      <Suspense fallback={<PageLoadingShell stats={2} rows={8} cols={6} />}>
        <CustomersContent />
      </Suspense>

      <section className="card p-6">
        <p className="eyebrow">{t("backfill.eyebrow")}</p>
        <h2 className="mt-1 text-sm font-semibold text-brand-navy">
          {t("backfill.title")}
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-brand-navy/60">
          {t.rich("backfill.intro", { b: (chunks) => <strong>{chunks}</strong> })}
        </p>
        <div className="mt-5">
          <BackfillAllOrdersButton />
        </div>
      </section>
    </div>
  );
}
