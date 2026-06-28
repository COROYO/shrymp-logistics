import { getTranslations } from "next-intl/server";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { LocaleSettings } from "@/app/_components/locale-settings";

export const dynamic = "force-dynamic";

export default async function SpracheSettingsPage() {
  await requireTenantPageContext("/admin/settings/sprache");
  const t = await getTranslations("settings.language");

  return (
    <section className="card p-6">
      <p className="eyebrow">{t("eyebrow")}</p>
      <h2 className="mt-1 text-sm font-semibold text-brand-navy">{t("title")}</h2>
      <p className="mt-1 text-xs text-brand-navy/60">{t("intro")}</p>
      <div className="mt-6 max-w-md">
        <LocaleSettings />
      </div>
    </section>
  );
}
