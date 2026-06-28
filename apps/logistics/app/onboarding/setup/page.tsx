import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import {
  merchantNeedsShopifyConnect,
} from "@/lib/auth/merchant";
import { merchantNeedsOnboarding } from "@/server/onboarding/state";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { loadLagerConfig } from "@/server/lager/config";
import { loadSlipBranding } from "@/server/slip/branding";
import { getShop } from "@/server/tenant/shop";
import { SetupWizard } from "./setup-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ installed?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/onboarding/setup");
  if (user.role !== "ADMIN") redirect("/lager");

  const needsConnect = await merchantNeedsShopifyConnect(user);
  if (needsConnect) redirect("/onboarding");

  const needsOnboarding = await merchantNeedsOnboarding(user);
  if (!needsOnboarding) redirect("/admin");

  const shopId = await requireActiveShopId(user);
  const sp = await searchParams;

  const [lagerCfg, slipBranding, shop, onboardingState] = await Promise.all([
    loadLagerConfig(shopId),
    loadSlipBranding(shopId),
    getShop(shopId),
    import("@/server/onboarding/state").then((m) => m.getOnboardingStep(shopId)),
  ]);

  return (
    <SetupWizard
      initialStep={onboardingState}
      justInstalled={sp.installed === "1"}
      shopDomain={shop?.shop_domain ?? shopId}
      lagerConfig={{
        batches_enabled: lagerCfg.batches_enabled,
        batch_min_days_before_expiry: lagerCfg.batch_min_days_before_expiry,
      }}
      slipBranding={slipBranding}
      userEmail={user.email ?? ""}
    />
  );
}
