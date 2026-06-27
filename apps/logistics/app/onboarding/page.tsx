import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import {
  loadPendingShopDomain,
  merchantNeedsShopifyConnect,
} from "@/lib/auth/merchant";
import { BrandMark } from "@/app/_components/brand-mark";
import { ShopifyConnectForm } from "@/app/_components/shopify-connect-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ installed?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/onboarding");
  if (user.role !== "ADMIN") redirect("/lager");

  const needsConnect = await merchantNeedsShopifyConnect(user);
  if (!needsConnect) redirect("/admin/settings?installed=1");

  const pendingShop = await loadPendingShopDomain(user.uid);
  const sp = await searchParams;

  return (
    <div className="relative flex flex-1 items-center justify-center px-4 py-16">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-cream via-brand-cream to-brand-stone"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-brand-navy"
      />

      <div className="w-full max-w-md space-y-8 rounded-2xl border border-zinc-200 bg-white p-10 shadow-xl shadow-brand-navy/5">
        <div className="flex flex-col items-start gap-6">
          <BrandMark variant="dark" />
          <div>
            <p className="eyebrow">Schritt 2</p>
            <h1 className="h-display mt-1 text-2xl">Shopify verbinden</h1>
            <p className="mt-1 text-sm text-brand-navy/60">
              Gib deine Shop-Domain ein und klicke auf Verbinden — Shopify
              fragt nur die App-Freigabe ab, keine technischen Daten.
            </p>
          </div>
        </div>

        {sp.installed === "1" ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Shopify erfolgreich verbunden.
          </div>
        ) : null}
        {sp.error ? (
          <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-sm text-brand-burgundy-dark">
            {sp.error}
          </div>
        ) : null}

        <ShopifyConnectForm initialShopDomain={pendingShop} />

        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-brand-navy">
          <p className="font-semibold">Nach der Verbindung:</p>
          <ol className="mt-2 list-decimal list-inside space-y-1 text-xs text-brand-navy/70">
            <li>Produkte unter Admin → Produkte syncen</li>
            <li>Offene Orders in den Einstellungen nachladen</li>
            <li>Health-Check für Webhooks ausführen</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
