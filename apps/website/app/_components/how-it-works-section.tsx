import { ArrowRight, Link2, PackageCheck, Settings, ShoppingBag } from "lucide-react";
import { logisticsUrl } from "@/lib/config";

const steps = [
  {
    step: "01",
    icon: Link2,
    title: "Shop verbinden",
    body: "Shopify-App installieren und OAuth abschließen. Produkte und Orders werden automatisch gespiegelt.",
  },
  {
    step: "02",
    icon: Settings,
    title: "Lager einrichten",
    body: "Chargen anlegen, Wareneingang buchen, Allocation laufen lassen. SHIP/STOP-Tags gehen zurück an Shopify.",
  },
  {
    step: "03",
    icon: ShoppingBag,
    title: "Picken & Packen",
    body: "Picklisten nach FEFO, Packzettel mit Chargennummern, Bestätigung zieht Bestand und pusht Fulfillment.",
  },
  {
    step: "04",
    icon: PackageCheck,
    title: "Versand",
    body: "Inland-Labels aus dem Packing-Screen. Tracking geht automatisch zurück an die Order.",
  },
] as const;

export function HowItWorksSection() {
  return (
    <section id="ablauf" className="section-pad scroll-mt-20 bg-brand-navy text-white">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium text-stone-300">In vier Schritten</p>
          <h2 className="mt-4 text-balance text-[28px] font-medium leading-[1.15] text-white sm:text-4xl">
            Von Shopify ins Lager — und zurück
          </h2>
          <p className="mt-4 text-lg leading-8 text-stone-300">
            Kein monatelanges Onboarding. Verbinden, Chargen pflegen, loslegen.
          </p>
        </div>

        <ol className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((item) => (
            <li
              key={item.step}
              className="rounded-2xl border border-white/10 bg-brand-navy-soft p-6"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-stone-300">{item.step}</span>
                <item.icon className="size-4 text-stone-300" strokeWidth={1.5} aria-hidden />
              </div>
              <h3 className="mt-4 text-base font-medium text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-5 text-stone-400">{item.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12 text-center">
          <a href={logisticsUrl} className="btn-primary">
            Jetzt verbinden
            <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}
