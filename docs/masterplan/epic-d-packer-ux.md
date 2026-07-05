# Epic D — Packer-UX & Auto-Label: „Etikett direkt aus dem Drucker"

**Epic-Ziel:** Der Packprozess wird ein flüssiger Ein-Scan-Ablauf, an dessen Ende das DHL-Etikett
**automatisch aus dem Drucker** kommt. Dazu Bulk- und Retouren-Labels und die ab April 2026
verpflichtende Routing-Code-Adressvalidierung.

**Entscheidung (gelockt):** **Browser-Direktdruck** an den (Thermo-)Drucker via Print-Pipeline. Kein
lokaler Print-Agent im ersten Wurf.

**Kontext (verifiziert):** DHL-Anbindung ist **real und modern** — Parcel DE Shipping **v2** (REST,
OAuth2) in [`server/dhl/`](../../apps/logistics/server/dhl/), erzeugt echte Labels, lädt das PDF nach
Firebase Storage und liefert eine **7-Tage-Signed-URL**. Der Packer-Flow
([`app/lager/packing/`](../../apps/logistics/app/lager/packing/)) zeigt danach „Etikett öffnen" →
neuer Tab → **manueller** Druck. Genau dieser letzte Schritt ist die Lücke. Gut: die alte SOAP-API
(Abschaltung 31.05.2026) ist **nicht** im Einsatz — kein Migrationsdruck.

---

## D.1 — Browser-Auto-Druck-Pipeline für Labels {#d1}

**Ziel:** Nach Label-Erstellung wird das Etikett automatisch an den hinterlegten Drucker geschickt —
ohne „Tab öffnen / Strg+P".

**Warum / Kontext:** Der einzige manuelle Reibungspunkt am Ende des Packens. Browser können ein
Dokument programmatisch an den (Standard-)Drucker senden; für Thermo-Etiketten muss das Format exakt
passen (sonst skaliert der Druck falsch).

**Betroffene Dateien:**
- `app/lager/packing/dhl-label-buttons.tsx` (ändern) — nach Erfolg Auto-Druck statt nur Link.
- `app/lager/_print/label-print.ts` (neu) — Druck-Helper (Hidden-Iframe + `@page`-Sizing).
- `app/lager/einstellungen/` (ändern) — Station-Setting „Label-Drucker/Format".
- [`server/dhl/labels.ts`](../../apps/logistics/server/dhl/labels.ts) / `storage.ts` (ggf. ändern) —
  Label-Format anfordern (Label-only, korrekte Größe).

**Umsetzung:**
1. **Format anfordern**: DHL-Label als **labelFormat** passend zum Thermo-Drucker (z. B. 910-300-xxx
   /100×150 mm) statt A4-Seite mit Label oben. Über die v2-`printFormat`-Optionen im Request-Builder.
2. **Auto-Druck**: Label (PDF → möglichst als Bild/definierte Seitengröße) in ein **Hidden-Iframe**
   laden und `iframe.contentWindow.print()` triggern. CSS `@page { size: 100mm 150mm; margin: 0 }`
   in der Druck-Route, damit der Browser die Thermo-Rolle korrekt bespielt.
3. **Station-Setting**: pro Arbeitsplatz „Label-Format" + „Auto-Druck an/aus" in `localStorage`
   (keine Server-Persistenz nötig, Drucker ist stationsgebunden). Fallback „Vorschau/manuell".
4. **Robustheit**: Popup-/Autoprint-Blocker abfangen → sichtbarer „Erneut drucken"-Button; Erfolg/
   Fehler klar anzeigen (Lager-UI, nicht Job-Tray — Job-Tray ist Admin).
5. **Reprint**: bestehende Idempotenz nutzen (Label bleibt in Storage) — Reprint zieht dieselbe
   Signed-URL/dasselbe PDF.

**Datenmodell:** keine (Station-Setting lokal). Ggf. `dhl_shipment.label_format` protokollieren.

**Tests:** Manuell/E2E (Druck ist geräteabhängig): Label erscheint in korrekter Größe; Auto-Druck
löst aus; Reprint funktioniert. Unit: Request-Builder setzt korrektes `printFormat`.

**Akzeptanzkriterien:** Packer klickt „Verpackt", das Etikett kommt ohne weitere Klicks in korrekter
Größe aus dem Drucker; manueller Reprint möglich.

**Abhängigkeiten:** keine (baut auf bestehender DHL-Integration auf).

---

## D.2 — Scan-to-Label One-Touch-Flow {#d2}

**Ziel:** Ein Scan des Order-Barcodes/Lieferscheins öffnet die Order, erzeugt das Label und druckt es
automatisch — minimale Klicks, „Scannen & Drucken"-Modus.

**Warum / Kontext:** Höchster Alltagsgewinn fürs Lager. Die Scan-Infrastruktur existiert teilweise
([`app/lager/scan/page.tsx`](../../apps/logistics/app/lager/scan/page.tsx), Kamera + Keyboard-Wedge im
Cluster-Picking), ist aber nicht mit dem Pack-/Label-Flow verdrahtet.

**Betroffene Dateien:**
- `app/lager/scan/page.tsx` (ändern) — Scan → Routing zur Order/Pack-Action.
- `app/lager/packing/actions.ts` (ändern) — „Scannen & Drucken"-Pfad (Label + Auto-Print + Pack in
  einem Zug).
- Barcode-Auflösung: Lieferschein-Nummer / Order-Name / Order-ID.

**Umsetzung:**
1. **Scan-Auflösung**: gescannten Code (Lieferschein-Nr `L…/26`, Order-`#1001`, oder Order-ID) auf die
   Order mappen. Robust gegen Formate (Prefix-Erkennung).
2. **One-Touch-Modus**: Scan → (Gewicht default/letzter Wert) → `createDhlLabel` → Auto-Druck ([D.1](#d1))
   → `confirmPacking`. Bei COD/Nachnahme oder fehlendem Gewicht → gezielte Rückfrage, sonst
   durchlaufen.
3. **Eingabegeräte**: Kamera (Barcode Detection API) **und** Hardware-Scanner als Keyboard-Wedge —
   beides unterstützen (Marktrecherche: nicht auf ein Modell festlegen). Vorhandene Scan-Komponenten
   wiederverwenden.
4. **Feedback**: akustisch/haptisch (Vibration-API wie im Picking) bei Erfolg/Fehler.

**Datenmodell:** keine.

**Tests:** Unit: Barcode-Parser mappt alle drei Formate korrekt auf Order. E2E manuell:
Scan → Label aus Drucker → Order PACKED.

**Akzeptanzkriterien:** Ein Scan einer versandbereiten Order führt ohne weitere Klicks zu gedrucktem
Label + PACKED (außer bei nötiger COD-/Gewichts-Rückfrage).

**Abhängigkeiten:** [D.1](#d1).

---

## D.3 — Bulk-Label-Druck {#d3}

**Ziel:** Für eine Auswahl versandbereiter Orders (Welle) alle Labels auf einmal erzeugen und in Folge
drucken.

**Warum / Kontext:** Effizienz bei vielen Sendungen. Der DHL-Client behandelt bereits
**207-Multistatus** (Teilfehler pro Sendung), die Basis ist da.

**Betroffene Dateien:**
- `app/lager/packing/bulk/` (neu) oder Aktion in der Picking-/Packed-Liste.
- `server/dhl/labels.ts` (ändern) — Batch-Erstellung (mehrere Orders, Teilfehler-tolerant).
- Druck-Helper aus [D.1](#d1) (Sequenz-/Sammeldruck).

**Umsetzung:**
1. Mehrfachauswahl von Orders (SHIP/PICKING) → Labels erzeugen (pro Order ein DHL-Call; Teilfehler
   sauber melden).
2. Sammeldruck: entweder N Einzel-Labels nacheinander an den Drucker oder ein zusammengeführtes
   Druck-Dokument (mehrere `@page`-Label-Seiten).
3. Ergebnis-Liste: erfolgreich/fehlgeschlagen je Order, Retry für Fehlerfälle.

**Datenmodell:** keine.

**Tests:** Unit: Batch mit einem Fehler (207) → übrige Labels trotzdem erzeugt, Fehler markiert.

**Akzeptanzkriterien:** N ausgewählte Orders → N Labels erzeugt & gedruckt; Teilfehler transparent.

**Abhängigkeiten:** [D.1](#d1).

---

## D.4 — Retouren-Labels (DHL Parcel DE Returns API) {#d4}

**Ziel:** Auf Knopfdruck ein DHL-Retouren-Label erzeugen und drucken (bzw. dem Kunden bereitstellen).

**Warum / Kontext:** Retouren fehlen komplett. Ein Retouren-Label ist der erste, konkret nützliche
Baustein und verzahnt sich mit dem RMA-Workflow ([E.1](epic-e-wms.md#e1)). DHL bietet dafür die
**Parcel DE Returns**-API.

**Betroffene Dateien:**
- `server/dhl/returns.ts` (neu) — Returns-API-Client (OAuth-Setup aus
  [`server/dhl/auth.ts`](../../apps/logistics/server/dhl/auth.ts) wiederverwenden).
- `server/dhl/config.ts` (ändern) — Retouren-Empfänger/Retourenschein-Konfiguration.
- UI: Aktion im Admin-Order-Detail und/oder im RMA-Flow.

**Umsetzung:**
1. Returns-API anbinden (Endpoint/Contract analog Shipping v2, gleiche Auth). Retouren-Label + ggf.
   QR erzeugen, in Storage ablegen (bestehendes `storage.ts`-Muster), Signed-URL/Print.
2. Auslöser: manuell im Admin (Retoure zu Order) oder automatisch als Beileger (später).
3. Verknüpfung mit Order/Return-Record ([E.1](epic-e-wms.md#e1)).

**Datenmodell:** `order.dhl_return_shipment?` (analog `dhl_shipment`).

**Tests:** Unit: Request-Builder für Retoure korrekt; Fehlerpfad (Adresse ungültig) sauber gemeldet.

**Akzeptanzkriterien:** Für eine Order lässt sich ein gültiges DHL-Retouren-Label erzeugen und drucken.

**Abhängigkeiten:** verzahnt mit [E.1](epic-e-wms.md#e1); nutzt bestehende DHL-Auth/Storage.

---

## D.5 — Routing-Code-Compliance (Pflicht ab 01.04.2026) {#d5}

**Ziel:** Adressvalidierung/Routing-Code vor der Label-Erstellung, damit DHL-Kleinpaket-Labels weiter
erzeugt werden können.

**Warum / Kontext:** **Ab 01.04.2026** ist der Routing-Code-Service für DHL Kleinpaket verpflichtend
(Adressvalidierung vor Label). Ohne diese Integration schlagen betroffene Label-Erstellungen künftig
fehl. Zeitkritisch.

**Betroffene Dateien:**
- [`server/dhl/request-builder.ts`](../../apps/logistics/server/dhl/request-builder.ts) (ändern) —
  Adressvalidierung/Routing-Code integrieren.
- `server/dhl/address-validation.ts` (neu, falls separater Endpoint).
- Packer-UI: klare Fehlermeldung bei ungültiger Adresse.

**Umsetzung:**
1. Vor `createDhlLabel` die Empfängeradresse gegen den DHL-Validierungs-/Routing-Code-Service prüfen;
   Routing-Code in den Label-Request übernehmen (wo gefordert).
2. **Fehlerbehandlung**: ungültige Adresse → Label-Erstellung blocken, dem Packer verständlich melden
   (korrigierbar), nicht still fehlschlagen.
3. Für Kleinpaket-Produkte gezielt aktivieren; für andere Produkte kompatibel bleiben.

**Datenmodell:** ggf. `dhl_shipment.routing_code`.

**Tests:** Unit: gültige Adresse → Routing-Code im Request; ungültige → definierter Fehler, kein Label.

**Akzeptanzkriterien:** Kleinpaket-Labels enthalten ab Aktivierung den Routing-Code; ungültige
Adressen werden mit klarer Meldung geblockt.

**Abhängigkeiten:** keine (eigenständig, aber **zeitkritisch** — vor 01.04.2026 einplanen).

---

## D.6 — Gewichtserfassung / Waage (optional) {#d6}

**Ziel:** Paketgewicht wird vorbefüllt (Summe der Varianten-Gewichte) und optional live von einer
Waage übernommen.

**Warum / Kontext:** Aktuell tippt der Packer das Gewicht manuell. Vorbefüllung spart Zeit und Fehler.

**Betroffene Dateien:**
- `server/firestore/schema.ts` (ändern) — `variant.weight_g` (aus Shopify sync).
- `server/shopify/queries.ts` / `mappers.ts` (ändern) — Gewicht mitsynchronisieren.
- `app/lager/packing/` (ändern) — Default-Gewicht + optional WebSerial/WebHID-Waage.

**Umsetzung:**
1. `variant.weight_g` aus Shopify (`InventoryItem`/Variant-Gewicht) beim Produkt-Sync mitnehmen.
2. Default-Paketgewicht = Σ(Positionsgewichte) + konfigurierbarer Verpackungszuschlag; im Pack-Feld
   vorbefüllen.
3. Optional: Waage über **WebSerial/WebHID** auslesen und Feld live füllen (Progressive Enhancement,
   Fallback manuell).

**Datenmodell:** `variant.weight_g`, `shop.packaging_weight_g`.

**Tests:** Unit: Default-Gewicht = Summe + Zuschlag.

**Akzeptanzkriterien:** Gewicht ist beim Packen sinnvoll vorbefüllt; manuelle Korrektur bleibt möglich.

**Abhängigkeiten:** Produkt-Sync-Erweiterung.

---

## D.7 — International / DHL Express (später) {#d7}

**Ziel:** Auslandssendungen über die DHL-Express-API statt des heutigen externen Links.

**Warum / Kontext:** Nicht-DE zeigt derzeit nur einen Legacy-Link („DHL Express Commerce"), keine
API-Integration. Größerer Brocken (Zolldaten, andere API) → bewusst **später**.

**Betroffene Dateien:**
- `server/dhl/express/` (neu) — Express-API-Client.
- `request-builder.ts` (ändern) — Zoll-/Customs-Daten, internationale Adressen.

**Umsetzung:**
1. DHL-Express-API anbinden (eigene Auth/Endpoints).
2. Customs-/Zolldaten aus Order/Produkten ableiten (Warenwert, HS-Codes — Felder ergänzen).
3. Packer-UI: Auslandsorder → Express-Label-Flow statt externem Link.

**Datenmodell:** Customs-Felder (HS-Code, Ursprungsland) auf Variante/Produkt.

**Tests:** Unit: Express-Request-Builder inkl. Customs korrekt.

**Akzeptanzkriterien:** Auslandssendung erzeugt ein Express-Label direkt aus der App.

**Abhängigkeiten:** eigenständig; niedrigere Priorität.

---

## D.8 — Deutsche Post Briefversand / DV-Freimachung {#d8}

**Ziel:** Briefe und kleine Sendungen über die Deutsche Post frankieren (Matrixcode-Franking /
DV-Freimachung) — als eigener Carrier neben dem DHL-Paketversand.

**Warum / Kontext:** Für Brief-/Warenpost-Sendungen braucht es Deutsche-Post-Frankierung — ein
**spezielles System**, kein Standard-Feature. Das Matrixcode-Franking (z. B. für DIALOGPOST) wird
**ab 01.01.2026 Pflicht**; das alte **1C4A-SOAP-Webservice (Internetmarke V3) ist Ende 2025 EOL**.
Anbindung daher über die **aktuelle** Post-API bzw. den Frankierservice, Zugang über Deutsche Post
**CIS** (Customer Integration Services) — vertrags- und guthabengebunden (Portokasse).

**Betroffene Dateien:**
- `server/carriers/deutschepost/` (neu) — Post-API-Client (aktuelle API, **nicht** 1C4A-SOAP),
  Frankierung/Matrixcode, Portokasse/Guthaben.
- `server/dhl/*` bleibt unberührt (eigener Carrier).
- Integration in Druck-/Label-Flow ([K](epic-k-documents.md)) und Carrier-Auswahl-Regeln
  ([H.3](epic-h-automation.md#h3)).

**Umsetzung:**
1. **Vertrag/Zugang** über Dt. Post CIS klären (Frankierart: Portokasse/Frankierservice/DV-Freimachung).
2. **Aktuelle API** anbinden (Migrationsfalle 1C4A-SOAP vermeiden — EOL): Porto/Matrixcode für
   Briefprodukte, Guthaben-/Portokasse-Handling, Produktauswahl (Brief/Warenpost/Päckchen).
3. **Frankierung erzeugen + drucken** über die Auto-Druck-Pipeline ([D.1](#d1)).
4. Als **Carrier** in Routing-/Druckregeln ([H](epic-h-automation.md)/[K](epic-k-documents.md)) verfügbar
   machen; Carrier-Wahl je Sendung (Gewicht/Größe/Ziel).

**Datenmodell:** Carrier-/Konto-Config; `order.postage_shipment` (analog `dhl_shipment`).

**Tests:** Unit: Frankierrequest korrekt aufgebaut; Guthaben-/Portokasse-Fehler sauber behandelt.

**Akzeptanzkriterien:** Für geeignete Sendungen wird eine gültige Deutsche-Post-Frankierung
(Matrixcode) erzeugt und automatisch gedruckt; Carrier per Regel wählbar.

**Abhängigkeiten:** verzahnt mit [H](epic-h-automation.md) (Carrier-Wahl) und [K](epic-k-documents.md)
(Druck); zugang-/vertragsabhängig, **zeitkritisch** wegen Pflicht ab 01.01.2026 für DIALOGPOST.
