import { getTranslations } from "next-intl/server";
import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { listAutomationRules } from "@/server/automation/rules-repo";
import { AutomationRulesPanel } from "./rules-panel";

export default async function AutomationPage() {
  const { shopId } = await requireTenantPageContext("/admin/automation");
  const [t, rules] = await Promise.all([
    getTranslations("automation"),
    listAutomationRules(shopId),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="h-display mt-1 text-3xl">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-brand-navy/70">{t("intro")}</p>
      </div>

      <AutomationRulesPanel initialRules={serializeRules(rules)} />
    </div>
  );
}

function serializeRules(
  rules: Awaited<ReturnType<typeof listAutomationRules>>,
) {
  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger,
    priority: r.priority,
    stop_on_match: r.stop_on_match,
    conditions: r.conditions ?? null,
    actions: r.actions,
  }));
}
