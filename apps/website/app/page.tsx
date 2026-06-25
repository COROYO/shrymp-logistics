const logisticsUrl =
  process.env.NEXT_PUBLIC_LOGISTICS_URL ?? "http://localhost:3000";

const features = [
  {
    title: "Chargen & MHD",
    body: "Jede Variante mit Charge, MHD und FEFO — transparent bis zum Packzettel.",
  },
  {
    title: "Intelligente Allocation",
    body: "Bei knappem Bestand maximal viele Orders fulfillen, nicht nur FIFO.",
  },
  {
    title: "Shopify-native",
    body: "Orders, Bestand und Fulfillments bleiben synchron mit deinem Shop.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="min-h-full">
      <header className="border-b border-brand-navy/10 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-sm font-bold uppercase tracking-[0.18em] text-brand-navy">
            Monolith
          </span>
          <a
            href={logisticsUrl}
            className="rounded-md bg-brand-burgundy px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-brand-burgundy-dark"
          >
            Zur App
          </a>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-6 py-20 text-center sm:py-28">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-burgundy">
            Beta für Shopify-Händler
          </p>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-brand-navy sm:text-5xl">
            Lagerlogistik,
            <br />
            die Chargen versteht
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-brand-navy/75">
            Monolith sitzt zwischen Shopify und deinem physischen Lager:
            Allocation, Picking, Packing und Chargenzuweisung — für Produkte,
            bei denen MHD und Rückverfolgbarkeit zählen.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={logisticsUrl}
              className="inline-flex items-center justify-center rounded-md bg-brand-burgundy px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-brand-burgundy-dark"
            >
              Beta starten
            </a>
            <a
              href="#features"
              className="inline-flex items-center justify-center rounded-md border border-brand-navy px-6 py-3 text-sm font-semibold uppercase tracking-wide text-brand-navy transition hover:bg-brand-navy hover:text-white"
            >
              Mehr erfahren
            </a>
          </div>
        </section>

        <section
          id="features"
          className="border-t border-brand-navy/10 bg-white py-20"
        >
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-center text-2xl font-bold text-brand-navy">
              Was Monolith abdeckt
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-3">
              {features.map((feature) => (
                <article
                  key={feature.title}
                  className="rounded-lg border border-zinc-200 bg-brand-cream p-6"
                >
                  <h3 className="text-lg font-semibold text-brand-navy">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-brand-navy/70">
                    {feature.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-brand-navy/10 py-20">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <h2 className="text-2xl font-bold text-brand-navy">
              Bereit für die Testphase?
            </h2>
            <p className="mt-4 text-brand-navy/70">
              Verbinde deinen Shopify-Shop und richte dein Lager in wenigen
              Minuten ein. Die App übernimmt den Rest.
            </p>
            <a
              href={logisticsUrl}
              className="mt-8 inline-flex items-center justify-center rounded-md bg-brand-burgundy px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-brand-burgundy-dark"
            >
              Jetzt verbinden
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-brand-navy/10 py-8 text-center text-xs text-brand-navy/50">
        Monolith · Kommissionierung & Chargenführung
      </footer>
    </div>
  );
}
