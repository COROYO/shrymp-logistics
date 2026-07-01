import {
  LegalPageShell,
  legalMetadata,
} from "@/app/_components/legal-page-shell";
import { contactEmail } from "@/lib/config";

export const metadata = legalMetadata(
  "Impressum",
  "Impressum der Shrymp Commerce GmbH.",
);

export default function ImpressumPage() {
  return (
    <LegalPageShell title="Impressum">
      <h2>Angaben gemäß § 5 TMG</h2>
      <address>
        Shrymp Commerce GmbH
        <br />
        Ludwig-Erhard-Platz 1
        <br />
        51373 Leverkusen
        <br />
        Deutschland
      </address>

      <h2>Vertreten durch</h2>
      <p>
        Geschäftsführer: Kostas Strigkos, Roman Nenstiel, Martin Supplieth
      </p>

      <h2>Kontakt</h2>
      <p>
        Telefon: +49 163 5347130
        <br />
        E-Mail:{" "}
        <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
      </p>

      <h2>Registereintrag</h2>
      <p>
        Eintragung im Handelsregister.
        <br />
        Registergericht: Amtsgericht Köln
        <br />
        Registernummer: HRB 126486
      </p>

      <h2>Umsatzsteuer-ID</h2>
      <p>
        Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG:
        <br />
        DE462671948
      </p>

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <address>
        Shrymp Commerce GmbH
        <br />
        Ludwig-Erhard-Platz 1
        <br />
        51373 Leverkusen
      </address>

      <h2>EU-Streitschlichtung</h2>
      <p>
        Die Europäische Kommission stellt eine Plattform zur
        Online-Streitbeilegung (OS) bereit:{" "}
        <a
          href="https://ec.europa.eu/consumers/odr/"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://ec.europa.eu/consumers/odr/
        </a>
        .
        <br />
        Unsere E-Mail-Adresse finden Sie oben im Impressum.
      </p>

      <h2>Verbraucherstreitbeilegung / Universalschlichtungsstelle</h2>
      <p>
        Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren
        vor einer Verbraucherschlichtungsstelle teilzunehmen.
      </p>

      <h2>Haftung für Inhalte</h2>
      <p>
        Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte
        auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach
        §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht
        verpflichtet, übermittelte oder gespeicherte fremde Informationen zu
        überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige
        Tätigkeit hinweisen.
      </p>
      <p>
        Verpflichtungen zur Entfernung oder Sperrung der Nutzung von
        Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt.
        Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der
        Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden
        von entsprechenden Rechtsverletzungen werden wir diese Inhalte
        umgehend entfernen.
      </p>

      <h2>Haftung für Links</h2>
      <p>
        Unser Angebot enthält Links zu externen Websites Dritter, auf deren
        Inhalte wir keinen Einfluss haben. Deshalb können wir für diese
        fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der
        verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der
        Seiten verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der
        Verlinkung auf mögliche Rechtsverstöße überprüft. Rechtswidrige
        Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar.
      </p>

      <h2>Urheberrecht</h2>
      <p>
        Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen
        Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung,
        Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der
        Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des
        jeweiligen Autors bzw. Erstellers. Downloads und Kopien dieser Seite
        sind nur für den privaten, nicht kommerziellen Gebrauch gestattet.
      </p>

      <p className="legal-meta">Stand: April 2026</p>
    </LegalPageShell>
  );
}
