import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { loadSlipBranding } from "@/server/slip/branding";
import { SlipBrandingForm } from "../slip-branding-form";

export const dynamic = "force-dynamic";

export default async function LieferscheinSettingsPage() {
  const { shopId } = await requireTenantPageContext(
    "/admin/settings/lieferschein",
  );
  const slipBranding = await loadSlipBranding(shopId);

  return (
    <section className="card p-6">
      <p className="eyebrow">Lieferschein</p>
      <h2 className="mt-1 text-sm font-semibold text-brand-navy">
        Branding & Layout
      </h2>
      <p className="mt-1 text-xs text-brand-navy/60">
        Markenname, Farben und Footer für den gedruckten Lieferschein — pro Shop
        individuell. Tabellen-Labels (Produkt, Menge, Charge) bleiben auf
        Deutsch.
      </p>
      <div className="mt-6">
        <SlipBrandingForm current={slipBranding} />
      </div>
    </section>
  );
}
