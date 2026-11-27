import { ArrowRight } from "lucide-react";
import { contactEmail, logisticsUrl } from "@/lib/config";

export function BetaCtaSection() {
  return (
    <section className="section-pad border-t border-brand-ink/8">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Beta</p>
          <h2 className="display-heading mt-4 text-[28px] leading-[1.15] sm:text-4xl">
            Bereit, dein Lager zu verbinden?
          </h2>
          <p className="mt-4 text-lg leading-8 text-secondary">
            Verbinde deinen Shopify-Shop und teste Shrymp Logistics im echten Betrieb.
            Setup in Minuten — kein Sales-Call nötig.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={logisticsUrl} className="btn-primary min-w-48">
              Beta starten
              <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
            </a>
            <a href={`mailto:${contactEmail}`} className="btn-secondary min-w-48">
              Frage stellen
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
