import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Package,
  Sparkles,
} from "lucide-react";
import { logisticsUrl } from "@/lib/config";

const stats = [
  { value: "Express", label: "Vorrang bei knappem Bestand" },
  { value: "Multi-Pick", label: "Mehrere Orders pro Lauf" },
  { value: "1-Klick", label: "Shopify-Sync" },
] as const;

const previewLines = [
  { name: "Bio Haferflocken 500g", qty: 2, picked: true, slot: "A-12" },
  { name: "Olivenöl extra virgin 750ml", qty: 1, picked: true, slot: "B-04" },
  { name: "Protein-Riegel Schoko", qty: 3, picked: false, slot: "C-07" },
] as const;

function AppPreview() {
  const pickedCount = previewLines.filter((line) => line.picked).length;

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
              Picking · Order #1042
            </p>
            <p className="mt-0.5 text-sm text-stone-200">
              3 Artikel ·{" "}
              <span className="font-mono text-brand-burgundy">SHIP</span>
            </p>
          </div>
          <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-300">
            Express
          </span>
        </div>

        <div className="space-y-2">
          {previewLines.map((line) => (
            <div
              key={line.name}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/5 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {line.name}
                </p>
                <p className="mt-0.5 font-mono text-xs text-stone-400">
                  ×{line.qty} · Lagerplatz {line.slot}
                </p>
              </div>
              {line.picked ? (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-emerald-400"
                  aria-hidden
                />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-stone-500" aria-hidden />
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-stone-300">
          <span>
            Gescannt{" "}
            <span className="font-mono text-white">
              {pickedCount}/{previewLines.length}
            </span>
          </span>
          <span className="text-stone-400">Multi-Pick · Slot 2/4</span>
        </div>

        <div className="flex items-center gap-2 rounded-xl bg-brand-burgundy/15 px-3 py-2 text-xs text-stone-200">
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Allocation: 4 von 6 Orders optimal erfüllbar</span>
        </div>
      </div>
    </div>
  );
}

export function HeroSection() {
  return (
    <section className="hero-glow relative overflow-hidden">
      <div className="container-narrow px-5 pb-20 pt-20 sm:px-6 sm:pb-24 lg:pb-28">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow inline-flex items-center gap-2">
              <Package className="h-3.5 w-3.5" aria-hidden />
              Beta für Shopify-Händler
            </p>
            <h1 className="display-heading mt-5 text-4xl leading-[1.08] sm:text-5xl lg:text-[3.25rem]">
              Die Lagerschicht,
              <span className="block text-brand-burgundy">die mitdenkt</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-secondary">
              Shrymp Logistics sitzt zwischen Shopify und deinem physischen Lager:
              intelligente Allocation, Picking mit Scanner-Prüfung, DHL-Versand
              und Bestandsführung in Echtzeit — Chargen und MHD inklusive, wenn
              du sie brauchst.
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
            <AppPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
