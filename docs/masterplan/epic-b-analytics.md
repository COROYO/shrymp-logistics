# Epic B — Analytics-Cockpit: Graphen & echte Warehouse-KPIs

**Epic-Ziel:** Aus dem heutigen Mini-Dashboard (5 KPIs, selbstgebaute SVG-Balken, 30-Tage-Live-Scan)
ein professionelles Analytics-Cockpit machen — mit echter Charting-Library, den Kern-Warehouse-KPIs,
historischen Trends, Produkt-Velocity, Picker-Leistung und Bestandsgesundheit.

**Kontext (verifiziert):** Es gibt **keine** Charting-Library. Das Dashboard
([`app/admin/page.tsx`](../../apps/logistics/app/admin/page.tsx)) rendert Balken als Inline-SVG;
Kennzahlen kommen live aus
[`server/admin/dashboard-stats.ts`](../../apps/logistics/server/admin/dashboard-stats.ts) (rollende
14–30 Tage). Alle KPIs dieses Epics lesen aus dem **Rollup-Layer** ([0.4](epic-0-foundation.md#rollups)).

**Die fünf Kern-KPIs** (aus der Marktrecherche, unser Nordstern): Order-Accuracy (Ziel 99 %+),
Pick-Rate (Zeilen/Std), Dock-to-Stock-Zeit, Inventory-Accuracy, Order-Cycle-Time — plus
Perfect-Order-Rate.

---

## B.1 — Charting-Library einführen (Recharts)

**Ziel:** Eine wiederverwendbare, SSR-taugliche Charting-Grundlage mit Tailwind-Theming.

**Warum / Kontext:** Selbstgebaute SVGs skalieren nicht über einzelne Balken hinaus. Wir brauchen
Linien-, Balken-, Flächen- und Verteilungs-Charts. **Empfehlung: Recharts** (React-nativ, MIT,
breit erprobt, komponierbar). Alternative Tremor (fertige Dashboard-Blöcke, aber eigenes
Styling-Ökosystem). Entscheidung: Recharts, um volle Kontrolle über das bestehende Tailwind-4-Design
zu behalten.

**Betroffene Dateien:**
- `apps/logistics/package.json` (ändern) — `recharts` hinzufügen.
- `app/admin/_components/charts/` (neu) — `LineChart.tsx`, `BarChart.tsx`, `AreaChart.tsx`,
  `Sparkline.tsx`, `chart-theme.ts` (Farben aus Tailwind-Tokens).

**Umsetzung:**
1. `recharts` als Dependency. Prüfen, dass Charts als **Client Components** laufen (`"use client"`),
   Daten aber serverseitig aus Rollups geladen und als Props reingereicht werden.
2. Dünne Wrapper-Komponenten mit einheitlichem Design (Achsen, Grid, Tooltip, Farben, Empty-State,
   responsive `ResponsiveContainer`). Keine Chart-Konfiguration in Seiten duplizieren.
3. Theme-Tokens zentral, damit Dark-Mode/Branding konsistent bleibt.

**Datenmodell:** keine.

**Tests:** Render-Smoke (Vitest + Testing-Library): Wrapper rendert mit Beispiel-Daten ohne Fehler,
zeigt Empty-State bei leeren Daten.

**Akzeptanzkriterien:** Wiederverwendbare Chart-Primitives vorhanden; ein Beispiel-Chart rendert im
Admin.

**Abhängigkeiten:** keine (aber sinnvoll nach [0.4](epic-0-foundation.md#rollups) für echte Daten).

---

## B.2 — KPI-Services auf dem Rollup-Layer

**Ziel:** Ein Service-Layer, der alle Warehouse-KPIs aus `sales_daily`/`ops_metrics_daily` berechnet
— schnell, historienfähig, getestet.

**Warum / Kontext:** `dashboard-stats.ts` scannt live und kennt nur wenige Kennzahlen. Wir brauchen
die vollen WMS-KPIs und beliebige Zeiträume ohne teure Scans.

**Betroffene Dateien:**
- `server/analytics/kpis.ts` (neu) — reine Berechnungsfunktionen.
- `server/analytics/queries.ts` (neu) — Rollup-Reads mit Zeitraum/Granularität (Tag/Woche/Monat).
- `dashboard-stats.ts` (refactor) — auf den neuen Layer umstellen (Rückwärtskompatibilität wahren).

**Umsetzung — KPIs (jeweils Formel dokumentieren):**
1. **Order-Cycle-Time**: `packed_at − created_at_shopify`, Median + p90.
2. **Pick-Rate**: gepickte Zeilen / aktive Pickerstunden (aus `ops_metrics_daily` +
   `pick_to_pack_ms`).
3. **Dock-to-Stock**: Zeit `INBOUND`-Movement → verfügbar (aus `inventory_movements`).
4. **Order-Accuracy / Perfect-Order-Rate**: Anteil Orders ohne Storno/Refund-nach-Pack/Fehler
   (Proxy aus Refund-/Cancel-Rate nach Pack).
5. **Inventory-Turnover**: konsumierte Menge / Ø-Bestand im Zeitraum; **GMROI** wenn Einkaufspreis
   vorhanden (sonst als „später" markieren, Feld fehlt aktuell).
6. **Fill-Rate**: SHIP-fähige Orders / gesamte Orders (aus Allocation-Ergebnissen).
7. **Umsatz/AOV/Units** über Zeit (Tag/Woche/Monat), inkl. Netto nach Refunds.
8. **Out-of-Stock-Rate**, **Low-Stock-Count** (bestehende Logik übernehmen, aber aus Rollups/Variants).

**Datenmodell:** keine neuen (liest Rollups). GMROI braucht Einkaufspreis → optionales
`variant.cost_cents` (aus Shopify `InventoryItem.unitCost` synchronisierbar) als Vorbereitung notieren.

**Tests:** Unit je KPI mit Fixture-Rollups (bekannte Ein-/Ausgabe). Property: Netto-Umsatz =
Brutto − Refunds; Turnover ≥ 0.

**Akzeptanzkriterien:** Jede KPI ist aus Rollups berechenbar, dokumentierte Formel, Unit-getestet.

**Abhängigkeiten:** [0.4](epic-0-foundation.md#rollups); Refund-KPIs nutzen [A.1](epic-a-sync-hardening.md#a1).

---

## B.3 — Analytics-Dashboard-Seiten

**Ziel:** Ein aufgeräumtes Cockpit: Übersicht + dedizierte Analytics-Seite mit Tabs, Charts, Trends,
Schwellwert-Farben und Drill-downs.

**Warum / Kontext:** Der sichtbarste Business-Value für den Merchant. Muss sich ins bestehende
Admin-Layout/Sidebar einfügen.

**Betroffene Dateien:**
- `app/admin/page.tsx` (überarbeiten) — Übersicht mit KPI-Kacheln (Trend + Ampelfarben) und
  Haupt-Charts.
- `app/admin/analytics/` (neu) — Seite mit Tabs: **Sales**, **Fulfillment/Ops**,
  **Bestandsgesundheit**, **Produkte**, **Picker**.
- `app/admin/layout.tsx` (ändern) — Sidebar-Eintrag „Analytics".
- Server-Loader je Tab (nutzt B.2).

**Umsetzung:**
1. **Zeitraum-/Granularitäts-Umschalter** (7/30/90 Tage, Tag/Woche/Monat) global auf der Seite.
2. **KPI-Kacheln** mit Wert, Trend-Delta ggü. Vorperiode, Sparkline, Ampel (Schwellwerte aus B.2,
   z. B. Accuracy < 99 % rot).
3. **Charts**: Umsatz/Units über Zeit, Cycle-Time-Verteilung, Top-/Flop-Mover, SHIP-vs-STOP-Verlauf.
4. **Drill-down**: Klick auf KPI/Chart-Punkt → gefilterte Orders-/Produktliste (Query-Params
   wiederverwenden, bestehende Orders-Filter nutzen).
5. Job-Tray-Konvention für etwaige Export-/Refresh-Jobs.

**Datenmodell:** keine.

**Tests:** Loader-Unit (richtige Aggregation je Zeitraum); Render-Smoke der Tabs.

**Akzeptanzkriterien:** Merchant sieht KPIs mit Trend + Ampel, kann Zeitraum umschalten und per Klick
in die Details springen.

**Abhängigkeiten:** [B.1](#b1), [B.2](#b2).

---

## B.4 — Bestandsgesundheit (Aging, Dead-Stock, MHD-Funnel)

**Ziel:** Sichtbarkeit über „ungesunden" Bestand: alternde Ware, Ladenhüter, ablaufende Chargen mit
Wert-at-Risk.

**Warum / Kontext:** Bei Kaviar/Fisch ist MHD-Überbestand teuer. Diese Analyse ist Vorstufe und
Ergänzung zur MHD-bewussten Prognose ([C.3](epic-c-forecasting.md#c3)).

**Betroffene Dateien:**
- `server/analytics/inventory-health.ts` (neu).
- Tab „Bestandsgesundheit" in `app/admin/analytics/`.

**Umsetzung:**
1. **MHD-Funnel**: Einheiten & Warenwert, die in 7/14/30 Tagen ablaufen (aus `batches.expiry_date` +
   `remaining_qty`). „Wert at Risk" = Menge × Preis.
2. **Aging**: Bestandsalter je Charge (`received_at` → heute), Buckets.
3. **Dead-Stock**: Varianten ohne Verkauf in N Tagen (aus `sales_daily`), mit gebundenem Kapital.
4. **Überbestand ggü. Velocity**: `on_hand` / durchschnittl. Tagesabsatz = „Tage Reichweite";
   Ausreißer markieren.

**Datenmodell:** keine neuen (liest Batches/Rollups). Preis aus `variant.price_cents`.

**Tests:** Unit: MHD-Funnel bucketed korrekt; Dead-Stock erkennt Variante mit 0 Sales.

**Akzeptanzkriterien:** Admin sieht ablaufende Chargen mit Wert, Ladenhüter und Reichweiten auf einen
Blick.

**Abhängigkeiten:** [0.4](epic-0-foundation.md#rollups).

---

## B.5 — Picker-Leistung

**Ziel:** Kennzahlen zur Lager-Produktivität je Mitarbeiter/Zeitraum — fair, datenschutzbewusst.

**Warum / Kontext:** Aus `packed_by_uid`, `picking_started_*`, `pick_runs` und (später)
`scan_events` lässt sich Produktivität messen (Picks/Packs, Pick-to-Pack-Zeit, Storno-/Fehlerrate).

**Betroffene Dateien:**
- `server/analytics/picker-performance.ts` (neu).
- Tab „Picker" in `app/admin/analytics/`.

**Umsetzung:**
1. Aggregation je `uid`: Packs/Tag, Ø Pick-to-Pack, abgebrochene Pickings, Anteil Express.
2. Leaderboard + Zeitverlauf; nur ADMIN-sichtbar.
3. Datenschutz: aggregiert, keine Einzelaktions-Überwachung in Echtzeit; Hinweis in Doku.

**Datenmodell:** nutzt bestehende Order-/PickRun-Felder; profitiert später von [E.4](epic-e-wms.md#e4).

**Tests:** Unit: korrekte Zuordnung von Packs zu `uid`; Zeitraumfilter.

**Akzeptanzkriterien:** Admin sieht Picker-Leistung je Zeitraum; Werte stimmen mit Rohdaten überein.

**Abhängigkeiten:** [0.4](epic-0-foundation.md#rollups); optional [E.4](epic-e-wms.md#e4).

---

## B.6 — Export & geplante Reports

**Ziel:** Analytics als CSV/PDF exportierbar; optional wöchentliche E-Mail-Zusammenfassung.

**Warum / Kontext:** Merchants wollen Zahlen in ihre eigenen Tools/Buchhaltung ziehen. CSV-Export
existiert bereits für Lagerbestand ([`app/admin/lagerbestand/export/route.ts`](../../apps/logistics/app/admin/lagerbestand/export/route.ts))
— Muster wiederverwenden.

**Betroffene Dateien:**
- `app/admin/analytics/export/route.ts` (neu) — CSV-Streaming je Tab/Zeitraum.
- optional `app/api/cron/weekly-report/route.ts` (neu) — E-Mail-Versand (später, Mail-Provider nötig).

**Umsetzung:**
1. CSV-Export je Analytics-Ansicht (Zeitraum als Query-Param), Muster aus Lagerbestand-Export.
2. PDF optional (HTML-Druckansicht wie Slips, `window.print()` — konsistent mit bestehendem Ansatz,
   keine neue PDF-Lib).
3. E-Mail-Report als „später"-Ausbaustufe markieren (braucht Mail-Infra — noch nicht vorhanden).

**Datenmodell:** keine.

**Tests:** Unit: CSV enthält korrekte Header/Zeilen für Zeitraum.

**Akzeptanzkriterien:** Jede Analytics-Ansicht ist als CSV exportierbar.

**Abhängigkeiten:** [B.2](#b2), [B.3](#b3).
