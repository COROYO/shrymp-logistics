import { ArrowRight, Check, Circle } from "lucide-react";
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
    <div className="overflow-hidden rounded-2xl border border-brand-ink/8 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between bg-brand-navy px-5 py-4 text-white">
        <div>
          <p className="text-sm font-medium">Picking</p>
          <p className="mt-1 font-mono text-xs text-white/70">#1042 · Express</p>
        </div>
        <p className="font-mono text-sm">SHIP</p>
      </div>

      <ul>
        {previewLines.map((line) => (
          <li
            key={line.name}
            className="flex items-center gap-3 border-b border-brand-ink/8 px-5 py-3"
          >
            {line.picked ? (
              <Check
                className="size-4 shrink-0 text-[#16a34a]"
                strokeWidth={1.5}
                aria-hidden
              />
            ) : (
              <Circle className="size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-brand-navy">{line.name}</p>
              <p className="mt-1 font-mono text-xs tabular-nums text-muted">×{line.qty}</p>
            </div>
            <span className="rounded bg-brand-cream px-2 py-1 font-mono text-xs text-brand-navy">
              {line.slot}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between px-5 py-3 font-mono text-xs text-muted">
        <span className="tabular-nums">
          Gescannt {pickedCount}/{previewLines.length}
        </span>
        <span>4 von 6 auf SHIP</span>
      </div>
    </div>
  );
}

export function HeroSection() {
  return (
    <section>
      <div className="container-narrow px-6 pb-24 pt-24 lg:px-8 lg:pb-32 lg:pt-36">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow">Beta für Shopify-Händler</p>
            <h1 className="display-heading mt-4 text-[36px] leading-[1.08] sm:text-[44px] lg:text-[56px] lg:tracking-[-0.02em]">
              Die Lagerschicht zwischen Shopify und dem Lager
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-secondary">
              Shrymp Logistics sitzt zwischen Shopify und deinem physischen Lager:
              Allocation, Picking mit Scanner-Prüfung, DHL-Versand und
              Bestandsführung in Echtzeit — Chargen und MHD inklusive, wenn du sie
              brauchst.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={logisticsUrl} className="btn-primary">
                Beta starten
                <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
              </a>
              <a href="#features" className="btn-secondary">
                Lösung ansehen
              </a>
            </div>

            <dl className="mt-12 grid grid-cols-3 gap-4 border-t border-brand-ink/8 pt-8">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <dt className="font-mono text-lg font-medium text-brand-navy sm:text-xl">
                    {stat.value}
                  </dt>
                  <dd className="mt-1 text-xs leading-4 text-secondary sm:text-sm sm:leading-5">
                    {stat.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <AppPreview />
        </div>
      </div>
    </section>
  );
}
