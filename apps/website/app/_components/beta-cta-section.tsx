import { ArrowRight, Sparkles } from "lucide-react";
import { logisticsUrl } from "@/lib/config";

export function BetaCtaSection() {
  return (
    <section className="section-pad">
      <div className="container-narrow">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy-soft px-6 py-14 text-center sm:px-12 sm:py-16">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(155,27,48,0.28),transparent_55%)]"
            aria-hidden
          />
          <div className="relative mx-auto max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-stone-200">
              <Sparkles className="h-3.5 w-3.5 text-brand-burgundy" aria-hidden />
              Beta-Zugang offen
            </p>
            <h2 className="display-heading mt-6 text-3xl text-white sm:text-4xl">
              Bereit, dein Lager zu verbinden?
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-stone-300">
              Verbinde deinen Shopify-Shop und teste Shrymp Logistics im echten Betrieb.
              Setup in Minuten — kein Sales-Call nötig.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href={logisticsUrl} className="btn-primary min-w-[200px]">
                Beta starten
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a
                href="mailto:hello@shrymp.de"
                className="btn-secondary min-w-[200px] border-white/20 bg-white/10 text-white hover:border-white/40 hover:bg-white/15"
              >
                Frage stellen
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
