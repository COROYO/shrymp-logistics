import {
  BarChart3,
  Boxes,
  Code2,
  GitBranch,
  Layers,
  ListChecks,
  MapPin,
  QrCode,
  RefreshCw,
  ScanLine,
  Truck,
  Users,
} from "lucide-react";

const features = [
  {
    icon: GitBranch,
    title: "Intelligente Allocation",
    body: "Bei knappem Bestand maximal viele Orders fulfillen — all-or-nothing pro Order, Express-Vorrang, SHIP/STOP automatisch zurück an Shopify.",
  },
  {
    icon: ListChecks,
    title: "Picking & Multi-Pick-Runs",
    body: "Picking-Queue, mehrere Orders in einem Lauf mit Wagen-Slots, Fortschritt und Fehlerliste — von der Pickliste bis zum Packen.",
  },
  {
    icon: ScanLine,
    title: "Scanner-Verifikation",
    body: "USB-, Bluetooth- oder Kamera-Scanner prüfen jeden Artikel gegen die Soll-Menge. Falscher Artikel oder Overpick fällt sofort auf.",
  },
  {
    icon: RefreshCw,
    title: "Shopify-native",
    body: "Orders, Bestand und Fulfillments bleiben synchron — inkl. Webhooks, Status-Tags, Bundle-Erkennung und Rückmeldung externer Fulfillments.",
  },
  {
    icon: Truck,
    title: "DHL-Versand",
    body: "Inland-Labels direkt aus dem Packing-Screen — mit Nachnahme, Standardgewicht und automatischer Tracking-Rückmeldung an die Order.",
  },
  {
    icon: Boxes,
    title: "Bestandsführung",
    body: "App oder Shopify als führende Quelle, Inline-Korrekturen mit Write-back, CSV-Import/-Export und ein lückenloses Bewegungs-Log.",
  },
  {
    icon: MapPin,
    title: "Standorte & Lagerplätze",
    body: "Mehrere Shopify-Locations, standortbezogener Bestand und Lagerplätze mit Barcode-Etiketten — direkt auf Pickliste und Scanner.",
  },
  {
    icon: Layers,
    title: "Chargen & MHD",
    body: "Wo nötig: Chargenführung mit FEFO-Zuweisung beim Packzettel-Druck und MHD-Rückverfolgbarkeit. Lässt sich pro Shop zu- oder abschalten.",
  },
  {
    icon: Users,
    title: "Kunden & Historie",
    body: "Aggregierte Kundenliste mit Umsatz und Bestellhistorie aus deinen Shopify-Orders — inklusive nachgeladener Alt-Bestellungen.",
  },
  {
    icon: BarChart3,
    title: "Dashboard & KPIs",
    body: "Offene Aufträge, Umsatz, verpackte Pakete und Ø Pick-zu-Pack-Zeit auf einen Blick — plus Bestands- und Statusverteilung.",
  },
  {
    icon: QrCode,
    title: "Etiketten & Barcodes",
    body: "Produkt- und Lagerplatz-Etiketten mit Barcode (Code 128), SKU-Generierung und Druckansicht — passend zum Scan-Workflow.",
  },
  {
    icon: Code2,
    title: "API, Rollen & Sprachen",
    body: "Read-API mit eigenen Keys, Rollen für Admin und Lager sowie Oberfläche in Deutsch, Englisch und Russisch.",
  },
] as const;

export function FeaturesSection() {
  return (
    <section id="features" className="section-pad">
      <div className="container-narrow">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Die Lösung</p>
          <h2 className="display-heading mt-3 text-3xl sm:text-4xl">
            Alles, was dein Lager braucht
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-secondary">
            Von der Bestellung bis zum Versand: Shrymp Logistics entscheidet,
            reserviert, pickt und verschickt — Shopify bleibt dein
            Shop-Frontend.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-border bg-surface p-6 transition duration-200 hover:border-brand-burgundy/30 hover:shadow-[0_8px_30px_rgba(15,27,51,0.06)]"
            >
              <div className="inline-flex rounded-xl bg-brand-navy-50 p-3 text-brand-navy">
                <feature.icon className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-brand-navy">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {feature.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
