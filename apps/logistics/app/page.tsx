import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getSessionUser } from "@/lib/auth/session";
import { hasAnyAdmin } from "@/lib/auth/bootstrap";
import { merchantNeedsShopifyConnect } from "@/lib/auth/merchant";
import { merchantNeedsOnboarding } from "@/server/onboarding/state";
import { ServerConfigError } from "@/app/_components/server-config-error";

export const dynamic = "force-dynamic";

export default async function RootRedirect() {
  try {
    if (!(await hasAnyAdmin())) redirect("/register");
    const user = await getSessionUser();
    if (!user) redirect("/login");
    if (user.role === "ADMIN") {
      if (await merchantNeedsShopifyConnect(user)) redirect("/onboarding");
      if (await merchantNeedsOnboarding(user)) redirect("/onboarding/setup");
      redirect("/admin");
    }
    if (user.role === "LAGER") redirect("/lager");
    redirect("/login?error=no_role");
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return (
      <ServerConfigError
        title="App-Start fehlgeschlagen"
        error={e instanceof Error ? e.message : String(e)}
        hint="Vermutlich fehlt die Server-seitige Firebase-Auth: setze FIREBASE_SERVICE_ACCOUNT_JSON oder logge dich mit `gcloud auth application-default login` ein."
      />
    );
  }
}
