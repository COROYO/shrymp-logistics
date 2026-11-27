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
      "Shopify bleibt unser Shop. Shrymp Logistics ist die Schicht dazwischen, die wir vorher mit Workarounds gebaut haben.",
    name: "Gründer",
    role: "D2C Food Brand",
  },
] as const;

export function TestimonialsSection() {
  return (
    <section className="section-pad" aria-labelledby="testimonials-heading">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Stimmen aus der Beta</p>
          <h2
            id="testimonials-heading"
            className="display-heading mt-4 text-[28px] leading-[1.15] sm:text-4xl"
          >
            Aus der Beta
          </h2>
        </div>

        <div className="mt-16 grid gap-4 md:grid-cols-3">
          {testimonials.map((item) => (
            <figure
              key={item.name}
              className="flex flex-col rounded-2xl border border-brand-ink/8 bg-white p-6"
            >
              <blockquote className="flex-1 text-sm leading-5 text-secondary">
                {item.quote}
              </blockquote>
              <figcaption className="mt-6 border-t border-brand-ink/8 pt-4">
                <p className="text-sm font-medium text-brand-navy">{item.name}</p>
                <p className="mt-1 text-xs text-muted">{item.role}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
