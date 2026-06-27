import { Quote } from "lucide-react";

const testimonials = [
  {
    quote:
      "Endlich sehen wir beim Packen, welche Charge rausgeht — ohne Excel und ohne Rätselraten im Lager.",
    name: "Lagerleitung",
    role: "Feinkost mit MHD-Pflicht",
  },
  {
    quote:
      "Die Allocation hat uns gezeigt, dass wir mit dem gleichen Bestand mehr Orders shippen können als mit FIFO.",
    name: "Operations",
    role: "Shopify Plus Händler",
  },
  {
    quote:
      "Shopify bleibt unser Shop. Monolith ist die Schicht dazwischen, die wir vorher mit Workarounds gebaut haben.",
    name: "Gründer",
    role: "D2C Food Brand",
  },
] as const;

export function TestimonialsSection() {
  return (
    <section className="section-pad bg-muted/40" aria-labelledby="testimonials-heading">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Stimmen aus der Beta</p>
          <h2
            id="testimonials-heading"
            className="display-heading mt-3 text-3xl sm:text-4xl"
          >
            Vertrauen vor dem Start
          </h2>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {testimonials.map((item) => (
            <figure
              key={item.name}
              className="glass-panel flex flex-col p-6"
            >
              <Quote
                className="h-8 w-8 text-accent/40"
                aria-hidden
              />
              <blockquote className="mt-4 flex-1 text-base leading-relaxed text-secondary">
                &ldquo;{item.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-6 border-t border-border pt-4">
                <p className="font-semibold text-primary">{item.name}</p>
                <p className="mt-0.5 text-sm text-secondary">{item.role}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
