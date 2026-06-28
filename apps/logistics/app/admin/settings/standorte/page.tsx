import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { LocationsSection } from "../locations-section";

export const dynamic = "force-dynamic";

export default async function StandorteSettingsPage() {
  await requireTenantPageContext("/admin/settings/standorte");

  return <LocationsSection />;
}
