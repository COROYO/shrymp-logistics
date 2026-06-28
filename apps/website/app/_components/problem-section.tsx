import { AlertTriangle, FileSpreadsheet, Shuffle } from "lucide-react";

const problems = [
  {
    icon: FileSpreadsheet,
    title: "Shopify kennt keine Chargen",
    body: "MHD und Rückverfolgbarkeit lassen sich im Shop nicht sauber abbilden — Excel und Notizen füllen die Lücke.",
  },
  {
    icon: Shuffle,
    title: "FIFO statt optimal",
    body: "Bei knappem Bestand erfüllst du chronologisch — und lässt Orders liegen, die du eigentlich noch shippen könntest.",
  },
  {
    icon: AlertTriangle,
    title: "Fehler beim Packen",
    body: "Ohne FEFO und feste Chargenzuweisung landet die falsche Charge im Paket — teuer und riskant.",
  },
] as const;

export function ProblemSection() {
  return (
    <section id="problem" className="section-pad bg-brand-stone/50">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Das Problem</p>
          <h2 className="display-heading mt-3 text-3xl sm:text-4xl">
            Shopify allein reicht nicht
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-secondary">
            Lebensmittel, Kaviar, Tiefkühlware: Dein Shop verwaltet SKUs —
            aber nicht die Charge, die heute raus muss.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-3">
          {problems.map((item) => (
            <article
              key={item.title}
              className="glass-panel group p-6 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(15,27,51,0.08)]"
            >
              <div className="inline-flex rounded-xl bg-brand-burgundy-soft p-3 text-brand-burgundy transition group-hover:bg-brand-burgundy group-hover:text-white">
                <item.icon className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-brand-navy">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
