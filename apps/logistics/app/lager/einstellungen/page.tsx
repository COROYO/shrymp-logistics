import { getTranslations } from "next-intl/server";
import { LocaleSettings } from "@/app/_components/locale-settings";

export default async function LagerEinstellungenPage() {
  const t = await getTranslations("settings.language");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
        <p className="mt-2 text-sm text-brand-navy/70">{t("intro")}</p>
      </div>
      <section className="card p-6">
        <LocaleSettings />
      </section>
    </div>
  );
}
