import { AlertTriangle, FileSpreadsheet, Shuffle } from "lucide-react";

const problems = [
  {
    icon: FileSpreadsheet,
    title: "Manuelle Lagerprozesse",
    body: "Picklisten, Bestand und Versand laufen über Excel, Notizen und Bauchgefühl — fehleranfällig und schlecht skalierbar.",
  },
  {
    icon: Shuffle,
    title: "FIFO statt optimal",
    body: "Bei knappem Bestand erfüllst du chronologisch — und lässt Orders liegen, die du eigentlich noch shippen könntest.",
  },
  {
    icon: AlertTriangle,
    title: "Fehler beim Packen",
    body: "Ohne Scan-Prüfung und klare Zuweisung landet der falsche Artikel oder die falsche Charge im Paket — teuer und riskant.",
  },
] as const;

export function ProblemSection() {
  return (
    <section id="problem" className="section-pad scroll-mt-20 border-t border-brand-ink/8">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Das Problem</p>
          <h2 className="display-heading mt-4 text-[28px] leading-[1.15] sm:text-4xl">
            Shopify allein reicht nicht
          </h2>
          <p className="mt-4 text-lg leading-8 text-secondary">
            Dein Shop verwaltet SKUs und Bestellungen — aber nicht, welcher
            Artikel aus welchem Lagerplatz heute optimal raus muss.
          </p>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {problems.map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-brand-ink/8 bg-white p-6"
            >
              <item.icon className="size-4 text-secondary" strokeWidth={1.5} aria-hidden />
              <h3 className="mt-4 text-base font-medium text-brand-navy">{item.title}</h3>
              <p className="mt-2 text-sm leading-5 text-secondary">{item.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
