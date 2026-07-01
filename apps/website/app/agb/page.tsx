import Link from "next/link";
import {
  LegalPageShell,
  legalMetadata,
} from "@/app/_components/legal-page-shell";

export const metadata = legalMetadata(
  "AGB",
  "Allgemeine Geschäftsbedingungen der Shrymp Commerce GmbH.",
);

export default function AgbPage() {
  return (
    <LegalPageShell title="Allgemeine Geschäftsbedingungen">
      <h2>§ 1 Geltungsbereich</h2>
      <p>
        (1) Die nachstehenden Allgemeinen Geschäftsbedingungen (im Folgenden
        „AGB") gelten für alle Geschäftsbeziehungen zwischen der Shrymp
        Commerce GmbH (im Folgenden „Shrymp") und ihren Auftraggebern (im
        Folgenden „Kunde"). Shrymp erbringt Leistungen ausschließlich auf
        Grundlage dieser AGB.
      </p>
      <p>
        (2) Diese AGB gelten ausschließlich gegenüber Unternehmern im Sinne
        von § 14 BGB, juristischen Personen des öffentlichen Rechts oder
        öffentlich-rechtlichen Sondervermögen.
      </p>
      <p>
        (3) Abweichende, entgegenstehende oder ergänzende AGB des Kunden
        werden nur dann und insoweit Vertragsbestandteil, als Shrymp ihrer
        Geltung ausdrücklich schriftlich zugestimmt hat.
      </p>

      <h2>§ 2 Vertragsschluss und Angebot</h2>
      <p>
        (1) Angebote von Shrymp sind freibleibend und unverbindlich, sofern
        sie nicht ausdrücklich als verbindlich gekennzeichnet sind.
      </p>
      <p>
        (2) Ein Vertrag kommt durch schriftliche Auftragsbestätigung (auch per
        E-Mail) oder durch Aufnahme der vereinbarten Leistungserbringung
        zustande.
      </p>

      <h2>§ 3 Leistungsumfang</h2>
      <p>
        (1) Der Leistungsumfang ergibt sich aus dem jeweiligen Angebot, der
        Auftragsbestätigung oder einem separaten Leistungsschein (SOW). Soweit
        nicht anders vereinbart, erbringt Shrymp Dienstleistungen im Sinne
        eines Dienstvertrags (§§ 611 ff. BGB), nicht eines Werkvertrags.
      </p>
      <p>
        (2) Shrymp ist berechtigt, zur Erbringung der Leistungen Dritte
        (Subunternehmer) einzusetzen.
      </p>
      <p>
        (3) Änderungen und Erweiterungen des Leistungsumfangs bedürfen der
        Textform und werden gesondert vergütet.
      </p>

      <h2>§ 4 Mitwirkungspflichten des Kunden</h2>
      <p>
        (1) Der Kunde stellt Shrymp alle zur Leistungserbringung
        erforderlichen Informationen, Zugänge (z.&nbsp;B. Shop-Admin,
        Entwicklerzugänge, API-Keys) und Materialien rechtzeitig und
        vollständig zur Verfügung.
      </p>
      <p>
        (2) Der Kunde benennt einen verantwortlichen Ansprechpartner, der
        entscheidungsbefugt ist.
      </p>
      <p>
        (3) Verzögerungen, die auf einer Verletzung der Mitwirkungspflichten
        beruhen, gehen nicht zu Lasten von Shrymp. Daraus resultierender
        Mehraufwand kann nach Aufwand abgerechnet werden.
      </p>

      <h2>§ 5 Preise und Zahlungsbedingungen</h2>
      <p>
        (1) Es gelten die im Angebot bzw. in der Auftragsbestätigung
        vereinbarten Preise, zzgl. der jeweils gültigen gesetzlichen
        Umsatzsteuer.
      </p>
      <p>
        (2) Soweit nicht anders vereinbart, werden Leistungen monatlich nach
        tatsächlichem Aufwand abgerechnet. Zahlungen sind innerhalb von 14
        Tagen nach Rechnungsdatum ohne Abzug fällig.
      </p>
      <p>
        (3) Bei Zahlungsverzug ist Shrymp berechtigt, Verzugszinsen in
        gesetzlicher Höhe zu berechnen (§ 288 BGB).
      </p>

      <h2>§ 6 Nutzungsrechte</h2>
      <p>
        (1) Shrymp räumt dem Kunden an den im Rahmen des Auftrags erstellten
        Arbeitsergebnissen (Quellcode, Designs, Konzepte) mit vollständiger
        Bezahlung ein nicht ausschließliches, zeitlich und räumlich
        unbeschränktes Nutzungsrecht für die vertraglich vereinbarten Zwecke
        ein.
      </p>
      <p>
        (2) Shrymp bleibt berechtigt, generische Bestandteile (z.&nbsp;B.
        Bibliotheken, Frameworks, wiederverwendbare Code-Module) auch in
        anderen Projekten einzusetzen.
      </p>
      <p>
        (3) Shrymp ist berechtigt, den Kunden und die erbrachten Leistungen
        als Referenz (z.&nbsp;B. auf der eigenen Website, in Case Studies) zu
        nennen, sofern der Kunde dem nicht widerspricht.
      </p>

      <h2>§ 7 Gewährleistung</h2>
      <p>
        (1) Da Shrymp Dienstleistungen erbringt, schuldet sie keinen konkreten
        Erfolg. Zusagen über Conversion-Rates, Umsatz- oder Wachstumszahlen
        sind unverbindlich.
      </p>
      <p>
        (2) Mängel an individuell erstellten Arbeitsergebnissen sind
        unverzüglich, spätestens jedoch innerhalb von 14 Tagen nach Übergabe
        schriftlich zu rügen. Bei berechtigten Mängelrügen erfolgt
        Nachbesserung.
      </p>

      <h2>§ 8 Haftung</h2>
      <p>
        (1) Shrymp haftet unbeschränkt für Vorsatz und grobe Fahrlässigkeit
        sowie bei Schäden aus der Verletzung des Lebens, des Körpers oder der
        Gesundheit.
      </p>
      <p>
        (2) Bei einfacher Fahrlässigkeit haftet Shrymp nur bei Verletzung
        einer wesentlichen Vertragspflicht (Kardinalpflicht) und auf den bei
        Vertragsschluss vorhersehbaren, typischen Schaden.
      </p>
      <p>
        (3) Eine weitergehende Haftung ist ausgeschlossen. Die
        Haftungsbeschränkungen gelten auch zugunsten der Mitarbeiter und
        Erfüllungsgehilfen von Shrymp.
      </p>

      <h2>§ 9 Vertraulichkeit</h2>
      <p>
        Beide Parteien verpflichten sich, alle im Rahmen der Zusammenarbeit
        erlangten vertraulichen Informationen der jeweils anderen Partei
        geheim zu halten und nur für die Zwecke dieses Vertrags zu verwenden.
        Diese Pflicht besteht auch nach Beendigung des Vertragsverhältnisses
        fort.
      </p>

      <h2>§ 10 Datenschutz</h2>
      <p>
        Soweit Shrymp im Rahmen der Auftragserfüllung personenbezogene Daten
        im Auftrag des Kunden verarbeitet, wird ein gesonderter
        Auftragsverarbeitungsvertrag (AVV) gemäß Art. 28 DSGVO abgeschlossen.
        Im Übrigen gilt die{" "}
        <Link href="/datenschutz">Datenschutzerklärung</Link>.
      </p>

      <h2>§ 11 Laufzeit und Kündigung</h2>
      <p>
        (1) Bei laufenden Betreuungsverträgen (z.&nbsp;B. Shop-Optimierung,
        Retainer) beträgt die Mindestlaufzeit einen Monat. Der Vertrag
        verlängert sich automatisch um jeweils einen weiteren Monat, sofern er
        nicht mit einer Frist von 14 Tagen zum Monatsende in Textform
        gekündigt wird („monatlich kündbar").
      </p>
      <p>
        (2) Das Recht zur außerordentlichen Kündigung aus wichtigem Grund
        bleibt unberührt.
      </p>
      <p>
        (3) Projektverträge (z.&nbsp;B. Migrationen, Relaunches) enden mit
        Abnahme der vereinbarten Leistung oder nach den im Angebot
        festgelegten Bedingungen.
      </p>

      <h2>§ 12 Schlussbestimmungen</h2>
      <p>
        (1) Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss
        des UN-Kaufrechts.
      </p>
      <p>
        (2) Erfüllungsort und ausschließlicher Gerichtsstand für alle
        Streitigkeiten aus diesem Vertrag ist — soweit gesetzlich zulässig —
        Leverkusen.
      </p>
      <p>
        (3) Sollten einzelne Bestimmungen dieser AGB unwirksam sein oder
        werden, so wird dadurch die Wirksamkeit der übrigen Bestimmungen nicht
        berührt.
      </p>
      <p>(4) Änderungen und Ergänzungen dieser AGB bedürfen der Textform.</p>

      <p className="legal-meta">Stand: April 2026</p>
    </LegalPageShell>
  );
}
