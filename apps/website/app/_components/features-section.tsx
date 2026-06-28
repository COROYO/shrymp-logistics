import {
  Boxes,
  GitBranch,
  Layers,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";

const features = [
  {
    icon: Layers,
    title: "Chargen & MHD",
    body: "Jede Variante mit Charge, MHD und FEFO — transparent bis zum Packzettel und Lieferschein.",
  },
  {
    icon: GitBranch,
    title: "Intelligente Allocation",
    body: "Bei knappem Bestand maximal viele Orders fulfillen — nicht blind nach Bestelldatum.",
  },
  {
    icon: Zap,
    title: "Express-Vorrang",
    body: "EXPRESS_DHL-Orders werden zuerst berücksichtigt, ohne den Rest zu blockieren.",
  },
  {
    icon: ShieldCheck,
    title: "All-or-nothing",
    body: "Kein Teilfulfillment: Eine Order wird komplett SHIP oder STOP — klar für Lager und Kunde.",
  },
  {
    icon: RefreshCw,
    title: "Shopify-native",
    body: "Orders, Bestand und Fulfillments bleiben synchron. Tags, Inventory und Fulfillment-Push inklusive.",
  },
  {
    icon: Boxes,
    title: "FEFO beim Packen",
    body: "Chargen werden erst beim Packzettel-Druck fest zugewiesen — älteste MHD zuerst, deterministisch.",
  },
] as const;

export function FeaturesSection() {
  return (
    <section id="features" className="section-pad">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Die Lösung</p>
          <h2 className="display-heading mt-3 text-3xl sm:text-4xl">
            Alles, was dein Lager braucht
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-secondary">
            Von der Bestellung bis zum Versand: Shrymp Logistics entscheidet, reserviert
            und weist Chargen zu — Shopify bleibt dein Shop-Frontend.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-border bg-surface p-6 transition duration-200 hover:border-brand-burgundy/30 hover:shadow-[0_8px_30px_rgba(15,27,51,0.06)]"
            >
              <div className="inline-flex rounded-xl bg-brand-navy-50 p-3 text-brand-navy">
                <feature.icon className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-brand-navy">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {feature.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
