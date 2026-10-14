import { requireTenantPageContext } from "@/lib/auth/tenant-page";
import { loadSlipBranding } from "@/server/slip/branding";
import { loadSlipQrDataUrl } from "@/server/slip/qr-image";
import { SlipBrandingForm } from "../slip-branding-form";

export const dynamic = "force-dynamic";

export default async function LieferscheinSettingsPage() {
  const { shopId } = await requireTenantPageContext(
    "/admin/settings/lieferschein",
  );
  const slipBranding = await loadSlipBranding(shopId);
  const qrPreview = await loadSlipQrDataUrl(shopId, slipBranding.qr_image);

  return (
    <section className="card p-6">
      <p className="eyebrow">Lieferschein</p>
      <h2 className="mt-1 text-sm font-semibold text-brand-navy">
        Branding & Layout
      </h2>
      <p className="mt-1 text-xs text-brand-navy/60">
        Briefkopf, Anschrift, Farben und sichtbare Angaben für den gedruckten
        Lieferschein — pro Shop. Tabellen-Labels bleiben auf Deutsch.
      </p>
      <div className="mt-6">
        <SlipBrandingForm current={slipBranding} qrPreview={qrPreview} />
      </div>
    </section>
  );
}
