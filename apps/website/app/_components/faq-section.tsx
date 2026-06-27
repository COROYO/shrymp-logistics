"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

const faqs = [
  {
    q: "Für wen ist Monolith gedacht?",
    a: "Für Shopify-Händler mit MHD-pflichtigen oder chargenrelevanten Produkten — Lebensmittel, Kaviar, Tiefkühlware und ähnliche Sortimente.",
  },
  {
    q: "Ersetzt Monolith mein Warenwirtschaftssystem?",
    a: "Nein. Monolith ergänzt Shopify um Chargenführung, Allocation und Lagerprozesse. Dein Shop bleibt der Verkaufskanal.",
  },
  {
    q: "Wie läuft die Beta?",
    a: "Du verbindest deinen Shop, richtest Chargen ein und nutzt Picking & Packing im echten Betrieb. Wir begleiten dich eng und sammeln Feedback.",
  },
  {
    q: "Was kostet Monolith?",
    a: "In der Beta-Phase ist die Nutzung kostenlos. Preise für den Launch kommunizieren wir rechtzeitig — transparent und ohne versteckte Kosten.",
  },
  {
    q: "Brauche ich technisches Know-how?",
    a: "Nein. Die App ist für Lager-Teams gebaut. Shopify-Verbindung per OAuth, Setup in wenigen Schritten.",
  },
] as const;

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="section-pad">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">FAQ</p>
          <h2 className="display-heading mt-3 text-3xl sm:text-4xl">
            Häufige Fragen
          </h2>
        </div>

        <div className="mx-auto mt-12 max-w-2xl divide-y divide-border rounded-2xl border border-border bg-surface">
          {faqs.map((item, index) => {
            const isOpen = openIndex === index;
            const panelId = `faq-panel-${index}`;
            const buttonId = `faq-button-${index}`;

            return (
              <div key={item.q}>
                <h3>
                  <button
                    id={buttonId}
                    type="button"
                    className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-primary transition hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                  >
                    {item.q}
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-secondary transition duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden
                    />
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  hidden={!isOpen}
                  className="px-5 pb-4 text-sm leading-relaxed text-secondary"
                >
                  {item.a}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
