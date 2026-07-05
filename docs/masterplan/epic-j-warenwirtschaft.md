# Epic J — Warenwirtschaft / ERP-Kern: Einkauf, Bestände, Inventur

**Epic-Ziel:** Die vollständige Warenwirtschaft schließen — Einkauf (Lieferanten, Bestellungen),
Wareneingang **gegen Bestellung**, Inventur/Stocktaking und Bestandsbewertung. Verkauf, Lager und
Bestände sind bereits stark; hier kommt die Beschaffungs- und Bewertungsseite dazu.

**Kontext (verifiziert):** **Vorhanden**: Chargen-/Varianten-Wareneingang (`server/inventory/receive.ts`,
`variant-inventory.ts`), Bestandskorrektur (`ADJUSTMENT`), Chargen-Edit, vollständiger
`inventory_movements`-Audit, Bestandsansichten/CSV-Export. **Fehlt**: Lieferanten-Stammdaten,
Bestellwesen (PO), Wareneingang-gegen-PO-Abgleich, geführte Inventur, Bestandsbewertung/Einkaufspreise,
Bulk-Import, Chargen-Merge/Split. Diese Epic absorbiert [C.7 PO-Vorschlag](epic-c-forecasting.md#c7) und
[E.3 Cycle-Counting](epic-e-wms.md#e3).

---

## J.1 — Lieferanten-Stammdaten {#j1}

**Ziel:** Lieferanten als Stammdaten mit Konditionen, Lieferzeiten und MOQ.

**Warum / Kontext:** Grundlage für Bestellwesen, Wareneingang-gegen-PO und Forecasting-Lead-Times
([C.3](epic-c-forecasting.md#c3)).

**Betroffene Dateien:**
- `server/firestore/schema.ts` (ändern) — `suppliers`; `variant.supplier_id`, `variant.moq`,
  `variant.supplier_lead_time_days` (teils in C.3 vorgesehen — hier konsolidieren).
- `app/admin/suppliers/` (neu) — Verwaltung.

**Umsetzung:** `suppliers/{id}` (Name, Kontakte, Zahlungsziel, Währung, Lieferzeit, MOQ, Artikelbezug);
Variante ↔ Lieferant (auch mehrere Lieferanten je Artikel, ein bevorzugter).

**Datenmodell:** `suppliers`-Collection; Lieferantenfelder auf Variante.

**Tests:** Unit: Supplier-CRUD; bevorzugter Lieferant je Variante.

**Akzeptanzkriterien:** Lieferanten pflegbar und Artikeln zuordenbar.

**Abhängigkeiten:** keine.

---

## J.2 — Bestellwesen / Purchase Orders {#j2}

**Ziel:** Bestellungen an Lieferanten erstellen, verwalten und versenden — gespeist aus den
Forecast-Vorschlägen.

**Warum / Kontext:** Kern des Einkaufs. Baut direkt auf [C.6](epic-c-forecasting.md#c6)/[C.7](epic-c-forecasting.md#c7)
(Bestell-Empfehlungen) auf.

**Betroffene Dateien:**
- `server/purchasing/` (neu) — PO-Logik & Lebenszyklus.
- `server/firestore/schema.ts` — `purchase_orders`.
- `app/admin/purchasing/` (neu) — PO-Liste/Editor.

**Umsetzung:**
1. **`purchase_orders/{id}`**: Lieferant, Positionen (Variante, Menge, EK-Preis), Status
   (DRAFT|SENT|PARTIALLY_RECEIVED|RECEIVED|CANCELLED), erwartetes Lieferdatum, Summen.
2. **Erzeugung** aus Forecast-Vorschlägen (ein Klick „PO aus Vorschlag"), MOQ/Gebinde beachtet.
3. **Versand** an Lieferanten (PDF/E-Mail via [L.2](epic-l-crm.md#l2)); Belegnummer.
4. Status wird durch Wareneingang ([J.3](#j3)) fortgeschrieben.

**Datenmodell:** `purchase_orders`-Collection; Belegnummernkreis (atomarer Zähler wie Lieferschein).

**Tests:** Unit: PO-Erzeugung aus Vorschlag (MOQ-Rundung); Statusübergänge.

**Akzeptanzkriterien:** PO aus Vorschlag erstellbar, an Lieferanten versendbar, Status nachvollziehbar.

**Abhängigkeiten:** [J.1](#j1), [C.6](epic-c-forecasting.md#c6)/[C.7](epic-c-forecasting.md#c7).

---

## J.3 — Wareneingang gegen Bestellung {#j3}

**Ziel:** Wareneingänge gegen offene Bestellungen buchen und Abweichungen (Über-/Unterlieferung)
erkennen.

**Warum / Kontext:** Heute läuft Wareneingang **losgelöst** von Bestellungen. Der PO-Abgleich schließt
den Kreis Einkauf→Lager.

**Betroffene Dateien:**
- `server/inventory/receive.ts` (erweitern) — optionaler `purchase_order_id`-Bezug.
- `server/purchasing/receive-against-po.ts` (neu).
- `app/admin/purchasing/[id]/receive` (neu) — Wareneingangs-UI zur PO (Scan-fähig).

**Umsetzung:**
1. Wareneingang optional gegen PO-Position buchen (bestehende `receiveBatch`/`receiveVariantStock`
   wiederverwenden, PO-Referenz ergänzen).
2. **Abgleich**: empfangen vs. bestellt; Teil-Lieferungen (PO bleibt `PARTIALLY_RECEIVED`); Über-/
   Unterlieferung markieren.
3. Scan-Unterstützung (PO/Artikel scannen) — nutzt [E.4](epic-e-wms.md#e4).

**Datenmodell:** `inventory_movements.ref` um `PURCHASE_ORDER` erweitern; PO-Positions-Fortschritt.

**Tests:** Unit: Teil-Wareneingang setzt PO auf `PARTIALLY_RECEIVED`; Überlieferung markiert.

**Akzeptanzkriterien:** Wareneingänge sind gegen Bestellungen buchbar; Abweichungen sichtbar.

**Abhängigkeiten:** [J.2](#j2); nutzt bestehenden Wareneingang.

---

## J.4 — Inventur / Stocktaking-Workflow {#j4}

**Ziel:** Geführte Bestandsaufnahme (Voll-Inventur und rollierende Zählung) mit Varianz-Buchung.
Absorbiert [E.3 Cycle-Counting](epic-e-wms.md#e3).

**Warum / Kontext:** Inventur ist Pflichtbestandteil einer Warenwirtschaft und hebt die
Inventory-Accuracy-KPI ([B.2](epic-b-analytics.md#b2)). Heute nur manuelle Einzelkorrektur.

**Betroffene Dateien:**
- `server/inventory/stocktake.ts` (neu).
- `app/lager/inventur/` (neu) — Zähl-UI (Bin scannen → zählen → Varianz).
- `app/admin/inventur/` (neu) — Planung/Freigabe.
- `server/firestore/schema.ts` — `stocktakes` / `cycle_counts`.

**Umsetzung:**
1. **Zählauftrag** (voll / nach Zone/Bin / nach ABC-Klasse aus [C.4](epic-c-forecasting.md#c4)).
2. **Zählung** per Scan; Soll/Ist-Varianz je Position/Charge.
3. **Freigabe**: Varianz → `ADJUSTMENT`-Movement mit Audit; MHD-/Chargenbezug wahren.
4. Sperr-/Quarantäne-Status für Zwischenprüfungen optional.

**Datenmodell:** `stocktakes/{id}` (Positionen, Soll/Ist, Varianz, Status, Zähler-uid).

**Tests:** Unit: Varianz korrekt; Freigabe erzeugt Adjustment in Höhe der Varianz.

**Akzeptanzkriterien:** Voll- und rollierende Inventur per Scan durchführbar; Varianzen sauber gebucht.

**Abhängigkeiten:** [E.4](epic-e-wms.md#e4) (Scan-Audit), [C.4](epic-c-forecasting.md#c4) (ABC).

---

## J.5 — Bestandsbewertung & Einkaufspreise {#j5}

**Ziel:** Einkaufspreise führen und den Lagerbestand bewerten (FIFO oder gleitender Durchschnitt).

**Warum / Kontext:** Basis für Marge, **GMROI** ([B.2](epic-b-analytics.md#b2)) und Buchhaltung
([Epic M](epic-m-finance.md)). Heute existiert nur der Verkaufspreis (`price_cents`).

**Betroffene Dateien:**
- `server/firestore/schema.ts` — `variant.cost_cents`, Charge-EK-Preis; Bewertungsfelder.
- `server/inventory/valuation.ts` (neu).

**Umsetzung:**
1. EK-Preis je Wareneingang/Charge erfassen (aus PO übernehmen); optional Shopify `InventoryItem.unitCost`
   synchronisieren.
2. Bewertung je Variante (FIFO über Chargen **oder** gleitender Durchschnitt — konfigurierbar).
3. Lagerwert-Report; Deckungsbeitrag je Verkauf (Verkaufspreis − EK) für Analytics.

**Datenmodell:** `variant.cost_cents`, `batch.cost_cents`, Bewertungsmethode je Shop.

**Tests:** Unit: FIFO-Bewertung über mehrere Chargen; Durchschnittsbewertung; nie negativ.

**Akzeptanzkriterien:** Lagerwert und Deckungsbeitrag sind korrekt berechenbar; GMROI in Analytics wird
möglich.

**Abhängigkeiten:** [J.3](#j3); speist [B.2](epic-b-analytics.md#b2), [M](epic-m-finance.md).

---

## J.6 — Bulk-Wareneingang & Chargen-Import/-Merge/-Split {#j6}

**Ziel:** Effiziente Massenerfassung von Wareneingängen und Chargenpflege.

**Warum / Kontext:** Bei vielen Positionen ist Einzelerfassung zu langsam; Chargen müssen teilbar/
zusammenführbar sein (z. B. Teil-Beschädigung).

**Betroffene Dateien:** `server/inventory/bulk-receive.ts` (neu); `app/admin/wareneingang/import`
(neu); Merge/Split in `server/inventory/`.

**Umsetzung:** CSV-Import für Multi-Position-Wareneingänge (bestehende `receiveBatch` je Zeile);
Chargen-Merge/Split transaktional (Mengen erhalten, Audit); Bulk-MHD-Update.

**Datenmodell:** keine neuen (nutzt Batch/Movement).

**Tests:** Property: Merge/Split erhält Gesamtmenge; Import idempotent gegen Doppel.

**Akzeptanzkriterien:** Mehrzeiliger Wareneingang per Datei erfassbar; Chargen teil-/zusammenführbar.

**Abhängigkeiten:** nutzt bestehenden Wareneingang.

---

## J.7 — Lieferanten-Rechnungsabgleich (Fundament) {#j7}

**Ziel:** Lieferantenrechnungen gegen Bestellung/Wareneingang abgleichen (3-Way-Match-Fundament).

**Warum / Kontext:** Verbindet Einkauf mit Buchhaltung ([Epic M](epic-m-finance.md)); voller
Rechnungsworkflow ist M.

**Betroffene Dateien:** `server/purchasing/invoice-match.ts` (neu).

**Umsetzung:** Lieferantenrechnung erfassen, gegen PO + Wareneingang matchen (Menge/Preis), Abweichungen
markieren; Übergabe an Buchhaltung/DATEV ([M.4](epic-m-finance.md#m4)).

**Datenmodell:** `supplier_invoices/{id}`.

**Tests:** Unit: Match erkennt Preis-/Mengenabweichung.

**Akzeptanzkriterien:** Lieferantenrechnung ist gegen PO/Wareneingang prüfbar.

**Abhängigkeiten:** [J.2](#j2), [J.3](#j3); [M](epic-m-finance.md).
