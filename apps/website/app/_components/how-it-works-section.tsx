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
    body: "Alles dokumentiert, rückverfolgbar, synchron. Bald: DHL-Labels direkt aus der App.",
  },
] as const;

export function HowItWorksSection() {
  return (
    <section id="ablauf" className="section-pad bg-primary text-on-primary">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            In vier Schritten
          </p>
          <h2 className="display-heading mt-3 text-3xl text-white sm:text-4xl">
            Von Shopify ins Lager — und zurück
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-stone-300">
            Kein monatelanges Onboarding. Verbinden, Chargen pflegen, loslegen.
          </p>
        </div>

        <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((item, index) => (
            <li
              key={item.step}
              className="relative rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
            >
              {index < steps.length - 1 ? (
                <span
                  className="absolute -right-3 top-1/2 hidden h-px w-6 -translate-y-1/2 bg-white/20 lg:block"
                  aria-hidden
                />
              ) : null}
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-accent">{item.step}</span>
                <item.icon className="h-5 w-5 text-stone-400" aria-hidden />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {item.body}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-12 text-center">
          <a
            href={logisticsUrl}
            className="btn-primary inline-flex bg-accent hover:bg-accent-hover"
          >
            Jetzt verbinden
            <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}
