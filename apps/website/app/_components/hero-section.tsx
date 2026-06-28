import {
  ArrowRight,
  CheckCircle2,
  Package,
  Sparkles,
} from "lucide-react";
import { logisticsUrl } from "@/lib/config";

const stats = [
  { value: "FEFO", label: "Älteste MHD zuerst" },
  { value: "100%", label: "All-or-nothing pro Order" },
  { value: "1-Klick", label: "Shopify-Sync" },
] as const;

function DashboardPreview() {
  return (
    <div className="glass-panel-dark relative overflow-hidden p-5 sm:p-6">
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-brand-burgundy/20 blur-3xl"
        aria-hidden
      />
      <div className="relative space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-stone-400">
              Picking Queue
            </p>
            <p className="mt-0.5 font-mono text-sm text-stone-200">#1042 · SHIP</p>
          </div>
          <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-300">
            Express
          </span>
        </div>

        <div className="space-y-2">
          {[
            { sku: "Black Cod 250g", batch: "Charge 0001", mhd: "12.08.26" },
            { sku: "Dorschrogen 100g", batch: "Charge 0003", mhd: "05.09.26" },
          ].map((line) => (
            <div
              key={line.sku}
              className="flex items-center justify-between rounded-xl border border-white/8 bg-white/5 px-3 py-2.5"
            >
              <div>
                <p className="text-sm font-medium text-white">{line.sku}</p>
                <p className="mt-0.5 font-mono text-xs text-stone-400">
                  {line.batch} · MHD {line.mhd}
                </p>
              </div>
              <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-burgundy" aria-hidden />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-xl bg-brand-burgundy/15 px-3 py-2 text-xs text-stone-200">
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Allocation: 4 von 6 Orders optimal fulfillbar</span>
        </div>
      </div>
    </div>
  );
}

export function HeroSection() {
  return (
    <section className="hero-glow relative overflow-hidden pt-28 sm:pt-32">
      <div className="container-narrow section-pad">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow inline-flex items-center gap-2">
              <Package className="h-3.5 w-3.5" aria-hidden />
              Beta für Shopify-Händler
            </p>
            <h1 className="display-heading mt-5 text-4xl leading-[1.08] sm:text-5xl lg:text-[3.25rem]">
              Lagerlogistik,
              <span className="block text-brand-burgundy">die Chargen versteht</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-secondary">
              Shrymp Logistics sitzt zwischen Shopify und deinem physischen Lager:
              intelligente Allocation, FEFO-Picking und transparente
              Chargenzuweisung — für Produkte, bei denen MHD und
              Rückverfolgbarkeit zählen.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={logisticsUrl} className="btn-primary">
                Beta starten
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a href="#features" className="btn-secondary">
                Lösung ansehen
              </a>
            </div>

            <dl className="mt-12 grid grid-cols-3 gap-4 border-t border-border pt-8">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="font-mono text-lg font-semibold text-brand-navy sm:text-xl">
                    {stat.value}
                  </dt>
                  <dd className="mt-1 text-xs leading-snug text-secondary sm:text-sm">
                    {stat.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative lg:pl-4">
            <div
              className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-brand-burgundy/10 via-transparent to-brand-navy/10 blur-2xl"
              aria-hidden
            />
            <DashboardPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
