# Epic M — Finance & Steuern: OSS, DATEV, Rechnungen, Zahlungen

**Epic-Ziel:** Die finanzielle und steuerliche Abwicklung schließen — korrekte Umsatzsteuer inkl.
**OSS-Verfahren** fürs EU-Ausland, Rechnungen/Gutschriften (Finanzseite), Zahlungsabgleich und
**DATEV-Anbindung** für die Buchhaltung.

**Kontext (verifiziert):** **Vorhanden**: `server/orders/financial-status.ts` (Utility für unbezahlt/
bezahlt — Vorbereitung), `order.shopify_financial_status` (Spiegel), `order.cod_amount_cents`. **Fehlt**:
jede Steuerlogik (kein VAT/OSS), Rechnungen/Gutschriften (Finanzdaten), Zahlungsabgleich, DATEV-Export.
Belegausgabe (Rendering) liegt in [Epic K](epic-k-documents.md); hier die Finanz-/Steuerlogik.

**Machbarkeit (Recherche):**
- **OSS**: Destination-Prinzip (Steuersatz des Käuferlandes), EU-weite **10.000-€-Schwelle**, eine
  quartalsweise OSS-Meldung im Registrierungsland; Schemata Union/Non-Union/IOSS.
- **DATEV**: **EXTF-Buchungsstapel** ist ein dokumentiertes CSV-Format (Header + Buchungszeilen),
  in-house erzeugbar; Standard-Austausch mit dem Steuerberater.

---

## M.1 — Steuer-Engine / VAT-Determination {#m1}

**Ziel:** Pro Order/Position den korrekten Umsatzsteuersatz nach Zielland und Produkt-Steuerklasse
bestimmen und die Steueraufteilung führen.

**Warum / Kontext:** Fundament für OSS **und** Rechnungen. Heute nur Bruttospiegel ohne Steuersplit.

**Betroffene Dateien:**
- `server/tax/` (neu) — Steuersätze je Land + Produktklasse, Berechnung, Reverse-Charge.
- `server/firestore/schema.ts` — Steuerfelder auf Order/Position; `variant.tax_class`.

**Umsetzung:**
1. **Steuersätze**: Standard-/ermäßigte Sätze je EU-Land, gepflegt/aktualisierbar; Produkt-Steuerklasse
   je Variante.
2. **Determination**: Zielland → Satz; B2B mit gültiger USt-ID → Reverse-Charge (0 % + Hinweis);
   Kleinunternehmer/Ausnahmen konfigurierbar.
3. **Aufteilung**: Netto/Steuer/Brutto je Position und Order (Integer-Cents) — Quelle für Rechnung
   ([K.2](epic-k-documents.md#k2)) und OSS ([M.2](#m2)).

**Datenmodell:** `tax_rates` (oder statische Tabelle + Overrides); `order.tax_lines[]`,
`variant.tax_class`.

**Tests:** Unit: DE→FR-Satz korrekt; B2B-Reverse-Charge; Netto+Steuer==Brutto (keine Rundungsdrift).

**Akzeptanzkriterien:** Jede Order hat eine korrekte, länderabhängige Steueraufteilung.

**Abhängigkeiten:** keine harten; speist [M.2](#m2), [K.2](epic-k-documents.md#k2).

---

## M.2 — OSS-Verfahren {#m2}

**Ziel:** Grenzüberschreitende B2C-EU-Verkäufe OSS-konform erfassen und die OSS-Meldung vorbereiten.

**Warum / Kontext:** Explizit gewünscht („OSS-Verfahren inkl. korrekter steuerlicher Abwicklung im
EU-Ausland"). Ohne korrekte VAT je Käuferland drohen Steuerfehler.

**Betroffene Dateien:** `server/tax/oss.ts` (neu); Report/Export in `app/admin/finance/oss/` (neu).

**Umsetzung:**
1. **Schwellen-Monitoring**: EU-weite 10.000-€-Grenze überwachen; Hinweis bei Überschreitung
   (ab dann Käuferland-VAT statt Inlands-VAT).
2. **Erfassung** je Verkauf: Käuferland, Netto, VAT-Satz, VAT-Betrag (aus [M.1](#m1)).
3. **OSS-Report**: quartalsweise Zusammenfassung je Zielland (Bemessungsgrundlage, Satz, Steuer) als
   Export (CSV/Format für das OSS-Portal); Union-Schema zuerst, IOSS (Import) als spätere Ausbaustufe.
4. Gutschriften/Refunds mindern die OSS-Bemessung korrekt.

**Datenmodell:** `oss_entries` (oder Ableitung aus `order.tax_lines`); `oss_reports/{quarter}`.

**Tests:** Unit: Schwellen-Trigger; Report summiert je Land korrekt; Refund mindert Bemessung.

**Akzeptanzkriterien:** OSS-relevante Umsätze werden je Land korrekt erfasst und als quartalsweiser
Report exportierbar.

**Abhängigkeiten:** [M.1](#m1); Refund-Bezug zu [A.1](epic-a-sync-hardening.md#a1).

---

## M.3 — Zahlungsabgleich {#m3}

**Ziel:** Zahlungen/Auszahlungen den Bestellungen zuordnen und offene Posten führen.

**Warum / Kontext:** Buchhaltung braucht „bezahlt/offen" belastbar. `financial-status.ts` ist der Anfang;
COD/Vorkasse/Marktplatz-Auszahlungen kommen hinzu.

**Betroffene Dateien:**
- `server/finance/reconciliation.ts` (neu); `server/orders/financial-status.ts` (wiederverwenden).
- Import: Zahlungsanbieter-/Bank-/Marktplatz-Auszahlungsdaten.

**Umsetzung:**
1. Zahlungseingänge erfassen (Provider-Payouts, Bank-CSV, COD-Rücklauf) und Orders matchen (Betrag/
   Referenz).
2. **Offene Posten**: unbezahlte/teilbezahlte Orders sichtbar; Mahnkandidaten (später).
3. Marktplatz-Auszahlungen inkl. Gebühren aufschlüsseln (aus `channel_data`, [G](epic-g-multichannel.md)).

**Datenmodell:** `payments/{id}` (Betrag, Quelle, order_id, matched_at).

**Tests:** Unit: Match bei exaktem Betrag; Teilzahlung → offener Rest.

**Akzeptanzkriterien:** Zahlungen sind Orders zugeordnet; offene Posten korrekt.

**Abhängigkeiten:** nutzt `financial-status.ts`; Marktplatzgebühren aus [G](epic-g-multichannel.md).

---

## M.4 — DATEV-Export {#m4}

**Ziel:** Buchungsdaten (Rechnungen, Gutschriften, Zahlungen) als DATEV-**EXTF-Buchungsstapel** für den
Steuerberater exportieren.

**Warum / Kontext:** Explizit gewünscht. EXTF-CSV ist dokumentiert und in-house erzeugbar; Standardweg
in die Kanzlei.

**Betroffene Dateien:** `server/finance/datev-export.ts` (neu); `app/admin/finance/datev/` (neu).

**Umsetzung:**
1. **EXTF-CSV** korrekt aufbauen: Header (Formatkennung/Version/Kategorie/Berater-/Mandantennr./
   Wirtschaftsjahr/…) + Buchungszeilen (Betrag, Soll/Haben, Konto/Gegenkonto, BU-Schlüssel/Steuer,
   Belegdatum, Belegnr., Buchungstext).
2. **Kontenmapping** (SKR03/SKR04 konfigurierbar): Erlöskonten je Steuersatz/Land (OSS!), Debitoren,
   Zahlungskonten.
3. Zeitraum-Export (Monat/Quartal), Rechnungen + Gutschriften + Zahlungen.

**Datenmodell:** Kontenmapping-Config je Shop; nutzt `invoices`/`credit_notes`/`payments`.

**Tests:** Unit: EXTF-Header/Zeilen exakt nach Spezifikation; Summen stimmen; Steuerschlüssel korrekt je
Land.

**Akzeptanzkriterien:** Ein Zeitraum ist als valider DATEV-EXTF-Buchungsstapel exportierbar und in DATEV
importierbar.

**Abhängigkeiten:** [M.1](#m1), [M.5](#m5), [M.3](#m3).

---

## M.5 — Rechnungs- & Finanz-Datenmodell {#m5}

**Ziel:** Rechnungen und Gutschriften als **Finanzobjekte** (nicht nur Belege) mit Steuer- und
Zahlungsbezug.

**Warum / Kontext:** [K.2](epic-k-documents.md#k2) rendert den Beleg; hier liegen die belastbaren
Finanzdaten für OSS/DATEV/Zahlungsabgleich.

**Betroffene Dateien:** `server/firestore/schema.ts` — `invoices`, `credit_notes`;
`server/finance/documents-link.ts` (neu).

**Umsetzung:** `invoices/{id}`/`credit_notes/{id}` mit Positionen, Netto/Steuer/Brutto je Satz,
Nummer, order_id, Zahlungsstatus, DATEV-Export-Flag; Verknüpfung zum gerenderten Beleg ([K.2](epic-k-documents.md#k2)).

**Datenmodell:** `invoices`, `credit_notes`.

**Tests:** Unit: Rechnung trägt korrekte Steuersummen; Gutschrift referenziert Rechnung; Zahlungsstatus
konsistent.

**Akzeptanzkriterien:** Rechnungen/Gutschriften sind als konsistente Finanzobjekte für OSS, DATEV und
Zahlungsabgleich nutzbar.

**Abhängigkeiten:** [M.1](#m1); Beleg-Rendering [K.2](epic-k-documents.md#k2).
