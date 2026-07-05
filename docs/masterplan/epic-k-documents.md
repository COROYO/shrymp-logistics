# Epic K — Dokumente & Drucksteuerung

**Epic-Ziel:** Umfangreiche, regelbasierte Drucklogik — automatisch entscheiden, **welche** Dokumente
(Rechnung, Lieferschein, Versandlabel, Retouren-/Begleitdokumente, Zollpapiere) **wann** und **an
welcher Packstation** gedruckt werden — plus ein Modell für unterschiedliche Pack-/Versandstationen mit
eigenen Regeln.

**Kontext (verifiziert):** **Vorhanden**: Lieferschein-Erzeugung + fortlaufende Nummerierung
(`server/picking/lieferschein.ts`, `L00042/26`), Slip-Branding je Shop, DHL-Label
(`server/dhl/labels.ts`), Produkt-/Bin-Labels. Der Druck läuft als **HTML + `window.print()`** (kein
`@react-pdf`). **Fehlt**: Rechnungen/Gutschriften, eine Dokument-Auswahl-Regel-Engine,
Mehrdokument-Bündel, ein Packstations-Modell, stationsgebundene Drucker. Ergänzt die Auto-Druck-Basis
aus [D.1](epic-d-packer-ux.md#d1).

---

## K.1 — Dokument-Engine & Templates {#k1}

**Ziel:** Ein einheitliches Rendering für alle Belegtypen mit Nummernkreisen und Branding — konsistent
zum bestehenden HTML-Druck.

**Warum / Kontext:** Statt Einzel-Lösungen je Beleg brauchen wir eine gemeinsame Engine (Lieferschein
existiert als Vorlage). Kein neuer PDF-Stack — HTML-Druck beibehalten.

**Betroffene Dateien:**
- `server/documents/` (neu) — Renderer + Nummernkreise je Belegtyp.
- `lib/slip/` (wiederverwenden/verallgemeinern) — gemeinsames Layout/Branding.
- `app/print/[docType]/` (neu) — Druckrouten (HTML, `window.print()`).

**Umsetzung:**
1. **Belegtypen**: Lieferschein (vorhanden), Rechnung, Gutschrift, Retourenschein, Beileger
   (Gruß/COD-Instruktion), Zollinhaltserklärung (CN22/CN23).
2. **Nummernkreise** je Typ (atomare Zähler wie Lieferschein), rechtssicher fortlaufend, je Jahr/Shop.
3. **Templates** mit Shop-Branding (bestehendes Slip-Branding erweitern).
4. **Archiv**: gerenderte Belege referenzierbar speichern (Storage-Muster wie DHL-Labels).

**Datenmodell:** `documents/{id}` (Typ, Nummer, order_id, Storage-Ref, created_at); Zähler in
`config/counters`.

**Tests:** Unit: Nummernkreis atomar/monoton je Typ; Render-Smoke je Belegtyp.

**Akzeptanzkriterien:** Jeder Belegtyp ist einheitlich renderbar, nummeriert und archiviert.

**Abhängigkeiten:** Rechnungsinhalte/Steuer aus [M.1](epic-m-finance.md#m1)/[M.5](epic-m-finance.md#m5).

---

## K.2 — Rechnungen & Gutschriften {#k2}

**Ziel:** Rechnungen und Gutschriften rechtssicher erzeugen — mit korrekter Steuer und Nummerierung.

**Warum / Kontext:** Kernbeleg jeder Warenwirtschaft; heute gar nicht vorhanden. Steuerlich an
[Epic M](epic-m-finance.md) gekoppelt (Rendering hier, Steuer-/Finanzdaten dort).

**Betroffene Dateien:** `server/documents/invoice.ts`, `server/documents/credit-note.ts` (neu);
Druckrouten; Auslöser in Pack-/Refund-Flow.

**Umsetzung:**
1. **Rechnung** bei Fulfillment/Zahlung (regelgesteuert, [K.4](#k4)): Positionen, Steuersätze je Land
   ([M.1](epic-m-finance.md#m1)), OSS-Hinweise, Rechnungsnummer.
2. **Gutschrift** bei Refund ([A.1](epic-a-sync-hardening.md#a1)): Bezug zur Rechnung, erstattete
   Positionen/Beträge.
3. Pflichtangaben (§14 UStG): Steuernummer/USt-ID, Leistungsdatum, Netto/Steuer/Brutto, fortlaufende
   Nummer.

**Datenmodell:** `invoices/{id}`, `credit_notes/{id}` (siehe [M.5](epic-m-finance.md#m5) für Finanzdaten).

**Tests:** Unit: Steuer korrekt je Land; Gutschrift referenziert Rechnung; Nummernkreis lückenlos.

**Akzeptanzkriterien:** Rechnung und Gutschrift werden korrekt erzeugt, nummeriert, archiviert und sind
steuerlich schlüssig.

**Abhängigkeiten:** [K.1](#k1), [M.1](epic-m-finance.md#m1), [M.5](epic-m-finance.md#m5),
[A.1](epic-a-sync-hardening.md#a1).

---

## K.3 — Pack-/Versandstationen-Modell {#k3}

**Ziel:** Mehrere Packstationen mit eigener Konfiguration (Drucker, Carrier, Regeln) modellieren.

**Warum / Kontext:** Heute ein einziger linearer Pack-Flow, kein Stationsbegriff. Kunden wollen
unterschiedliche Stationen mit individuellen Regeln.

**Betroffene Dateien:**
- `server/firestore/schema.ts` — `pack_stations`.
- `app/admin/stations/` (neu) — Verwaltung; `app/lager/packing/` (ändern) — Stationskontext.

**Umsetzung:**
1. **`pack_stations/{id}`**: Name, Standort ([I](epic-i-distributed-fulfillment.md)), zugeordnete
   **Drucker** (Label/Beleg, [K.6](#k6)), bevorzugte **Carrier**, **Dokumentenregeln** ([K.4](#k4)),
   Kapazität.
2. Station je Arbeitsplatz wählbar (lokal gemerkt, wie Drucker-Setting in
   [D.1](epic-d-packer-ux.md#d1)).
3. Order-Zuweisung an Station per Regel ([H.3](epic-h-automation.md#h3), Aktion „assign station").

**Datenmodell:** `pack_stations`-Collection; optional `order.station_id`.

**Tests:** Unit: Station-CRUD; Zuweisungsregel greift.

**Akzeptanzkriterien:** Stationen sind konfigurierbar; Orders landen regelbasiert an der richtigen
Station.

**Abhängigkeiten:** [H.3](epic-h-automation.md#h3); verzahnt mit [I](epic-i-distributed-fulfillment.md).

---

## K.4 — Druckregel-Engine {#k4}

**Ziel:** Regelbasiert festlegen, welche Dokumente wann und an welcher Station gedruckt werden.

**Warum / Kontext:** Der Kern des Kundenwunsches „umfangreiche Drucklogiken". Baut auf der
Automatisierungs-Engine ([H](epic-h-automation.md)) und der Dokument-Engine ([K.1](#k1)) auf.

**Betroffene Dateien:** `server/documents/print-rules.ts` (neu); Integration in
[H.3](epic-h-automation.md#h3) (Aktion „print documents").

**Umsetzung:**
1. Regeln: Trigger (z. B. PACKED, Label erstellt) + Bedingungen (Channel, Land, COD, B2B, Station) →
   **Dokumentenset** + Zielstation/-drucker.
2. Beispiele: „international → Label + CN23 + Rechnung", „COD → Label + COD-Beleg", „B2B → Lieferschein +
   Rechnung", „Amazon → nur Label (Rechnung via Amazon)".
3. Ausführung reiht Druckjobs an die stationsgebundenen Drucker ([K.6](#k6)); Auto-Druck aus
   [D.1](epic-d-packer-ux.md#d1) wiederverwenden.

**Datenmodell:** Druckregeln als Teil von `automation_rules` oder `print_rules`.

**Tests:** Unit: je Szenario korrektes Dokumentenset + Zielstation.

**Akzeptanzkriterien:** Für definierte Szenarien werden automatisch die richtigen Dokumente an der
richtigen Station gedruckt.

**Abhängigkeiten:** [K.1](#k1), [K.3](#k3), [H.3](epic-h-automation.md#h3), [D.1](epic-d-packer-ux.md#d1).

---

## K.5 — Automatische Dokumenten-Bündel {#k5}

**Ziel:** Pro Order das komplette, regelabhängige Belegbündel in einem Rutsch erzeugen und drucken.

**Warum / Kontext:** Der Packer soll nicht einzeln zusammenklicken — ein Auslöser produziert das ganze
Set.

**Betroffene Dateien:** `server/documents/bundle.ts` (neu); Pack-/Scan-Flow
([D.2](epic-d-packer-ux.md#d2)).

**Umsetzung:** Belegset aus [K.4](#k4) rendern, in korrekter Reihenfolge an die richtigen Drucker
(Label→Thermo, Belege→A4) senden; Teil-Fehler transparent (Reprint je Dokument).

**Datenmodell:** keine neuen.

**Tests:** Unit: Bündel enthält genau die Regel-Dokumente; Reihenfolge/Ziel korrekt.

**Akzeptanzkriterien:** Ein Auslöser erzeugt und druckt das vollständige, korrekte Belegbündel.

**Abhängigkeiten:** [K.4](#k4), [D.2](epic-d-packer-ux.md#d2).

---

## K.6 — Stationsgebundene Drucker & Routing {#k6}

**Ziel:** Druckjobs an den richtigen physischen Drucker der jeweiligen Station leiten.

**Warum / Kontext:** Ergänzt den Browser-Direktdruck ([D.1](epic-d-packer-ux.md#d1)) um Stations-/
Druckerkontext (Label-Thermo vs. A4-Beleg).

**Betroffene Dateien:** `app/lager/_print/` (erweitern); Stations-/Drucker-Settings.

**Umsetzung:**
1. Je Station Drucker registrieren (Label + Beleg getrennt), lokal je Arbeitsplatz gemerkt.
2. Druckjob wählt anhand Dokumenttyp + Station den Zieldrucker; passendes `@page`-Format je Typ.
3. Fallback Vorschau/manuell bei fehlender Druckerzuordnung.

**Datenmodell:** Drucker-Refs auf `pack_stations` bzw. lokal.

**Tests:** manuell/E2E (geräteabhängig): Label→Thermo, Beleg→A4 an der jeweiligen Station.

**Akzeptanzkriterien:** Dokumente laufen automatisch auf dem passenden Drucker der aktiven Station.

**Abhängigkeiten:** [K.3](#k3), [D.1](epic-d-packer-ux.md#d1).
