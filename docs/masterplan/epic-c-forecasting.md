# Epic C — KI-Forecasting: Nachfrageprognose, Reorder-Points, MHD-Schutz

**Epic-Ziel:** Vorhersagen, wann welche Ware nachbestellt werden muss — auf Basis historischer
Verkäufe, Saisonalität, Feiertagen und Trend. Ausgabe: pro Variante eine Prognose plus
Reorder-Point/Safety-Stock, ABC/XYZ-Klasse und — entscheidend bei verderblicher Ware — eine
**MHD-bewusste Überbestandswarnung**.

**Entscheidung (gelockt):** **in-house statistisch in TypeScript**, als Cloud Function / Cron.
Günstig, erklärbar, deterministisch, keine Extra-Infra, kein Datenabfluss. Kein Python-Dienst, keine
externe API im ersten Wurf.

**Kontext (verifiziert):** Es existiert **nichts** dazu — keine ML-/Statistik-Libs, keine
Historien-Aggregation, keine Reorder-Logik. Deshalb hängt dieses Epic zwingend am Rollup-Layer
([0.4](epic-0-foundation.md#rollups)) und profitiert von sauberen Sales-Daten ([Epic A](epic-a-sync-hardening.md)).

**Datengrundlage (Marktrecherche):** Für jährliche Saisonalität sind 2–3 Zyklen ideal; für
wöchentliche reichen 8–12 Wochen. Feiertage als Kalender-Features. Reorder-Point = Lead-Time-Bedarf +
Safety-Stock; Safety-Stock = `Z(serviceLevel) × σ_Nachfrage × √Lead-Time`.

**Neues Server-Modul:** `apps/logistics/server/forecasting/`.

---

## ⚙️ Umsetzungsstand — v1 implementiert (2026-07-06)

Eine erste produktive Ausbaustufe ist **gebaut und getestet** (151 Tests grün):

| Baustein | Status | Dateien |
| --- | --- | --- |
| Demand-History inkl. **Bundle-Explosion** | ✅ | `server/forecasting/history.ts` |
| Engine: Holt-Winters (Wochensaison) + Croston/SBA + MA-Fallback, Holdout-Backtest | ✅ | `server/forecasting/engine.ts`, `models/` |
| `forecasts`-Collection + Run-Job (1 Orders-Scan → alle Varianten) | ✅ | `schema.ts`, `server/forecasting/run.ts` |
| Nightly-Cron (alle aktiven Shops) + Admin-Trigger (Job-Tray) | ✅ | `app/api/cron/forecast/route.ts`, `app/admin/forecasting/actions.ts` |
| Admin-UI „Forecast": Zeitraum X (7/14/30/60/90), Bedarf, Reichweite, Nachbestell-Badge, Modell, MAE | ✅ | `app/admin/forecasting/` |
| Tests (Unit + Property: nie negativ, deterministisch, Bundle-Explosion) | ✅ | `server/forecasting/**/*.test.ts` |

**Noch offen aus diesem Epic:** C.1-Teile (Stockout-Zensierung, Feiertags-Features),
Jahres-Saisonalität, C.3 (Reorder-Point/Safety-Stock/MHD-Deckel), C.4 (ABC/XYZ),
C.6-Teile (Forecast-vs-Ist-Chart je SKU, CSV-Export), C.7 (PO-Vorschlag).

### Stücklisten-Entscheidung (gelockt, 2026-07-06)

**Keine separate BOM-/Stücklisten-Verwaltung.** Shopify-Bundles fungieren als Stückliste
(Komponenten-Line-Items mit `bundle.group_id` → Parent). Der Forecast arbeitet auf
**Komponenten-Ebene**: Bundle-Parents sind virtuell (kein Bestand, kein Forecast); die
History-Pipeline **lernt die Stückliste aus beobachteten Orders** (neueste Zusammensetzung
gewinnt) und **explodiert Legacy-Verkäufe** aus der „1 Korb = 1 SKU"-Ära in
Komponenten-Nachfrage. Entbündelte SKUs erben so die volle Historie — exakt das Problem, an
dem externe Tools (VOIDS) beim Kunden gescheitert sind.

---

## C.1 — Sales-History-Feature-Builder {#c1}

**Ziel:** Aus `sales_daily` je Variante eine saubere, lückenlose Tages-Zeitreihe mit Kalender-Features
bauen — inkl. Behandlung von Stockout-Tagen und Feiertagen.

**Warum / Kontext:** Rohe Verkaufszahlen sind irreführend: Tage **ohne Bestand** zeigen 0 Verkäufe,
sind aber keine 0-Nachfrage (zensiert). Feiertage/Wochenenden verzerren. Ohne Aufbereitung prognostiziert
jedes Modell falsch.

**Betroffene Dateien:**
- `server/forecasting/history.ts` (neu) — Zeitreihen-Builder.
- `server/forecasting/calendar.ts` (neu) — deutsche Feiertage (bundeslandabhängig), Wochentag, Monat.
- `server/forecasting/types.ts` (neu).

**Umsetzung:**
1. **Lückenfüllung**: fehlende Tage als 0 einsetzen (kein Verkauf), damit die Reihe äquidistant ist.
2. **Stockout-Zensierung**: Tage, an denen `available == 0` war, als **zensiert** markieren (nicht als
   0-Nachfrage in σ/Level einrechnen; für Croston/Holt-Winters entweder überspringen oder mit
   Erwartungswert imputieren). Bestandshistorie aus `inventory_movements` rekonstruieren oder
   vereinfacht aus `variant.available`-Snapshots (Ansatz dokumentieren).
3. **Kalender-Features**: Wochentag, Monat, deutsche Feiertage (Feiertagsberechnung ohne externe
   Lib — Gauss/Osterformel für bewegliche Feiertage; Bundesland konfigurierbar, Default die
   Warehouse-Region). Promo-Fenster optional aus Order-`tags`/`note_attributes` ableiten (später).
4. **Aggregationsebene**: primär je **Variante**; optional Produkt-Ebene als Fallback bei zu wenig
   Varianten-Historie.

**Datenmodell:** keine neuen Collections (liest Rollups/Movements). Config: `shop.forecast_region`
(Bundesland für Feiertage).

**Tests:**
- Unit: Osterformel liefert korrekte Feiertage (Stichjahre).
- Unit: Lückenfüllung erzeugt äquidistante Reihe.
- Unit: Stockout-Tag wird als zensiert markiert, verfälscht σ nicht.

**Akzeptanzkriterien:** Für eine Variante entsteht eine lückenlose, feature-annotierte Tagesreihe mit
korrekt markierten Stockout-Tagen.

**Abhängigkeiten:** [0.4](epic-0-foundation.md#rollups), [0.5](epic-0-foundation.md).

---

## C.2 — Prognose-Engine (Holt-Winters + Croston) {#c2}

**Ziel:** Eine deterministische, erklärbare Forecast-Engine, die je nach Nachfragemuster das passende
Verfahren wählt und einen Horizont mit Prognoseintervall liefert.

**Warum / Kontext:** Ein einziges Modell passt nicht: Renner haben Saison/Trend (→ Holt-Winters),
Langsamdreher haben **intermittierende** Nachfrage mit vielen Null-Tagen (→ Croston/SBA). Beide sind
kompakt in TypeScript umsetzbar, ohne schwere Abhängigkeiten.

**Betroffene Dateien:**
- `server/forecasting/engine.ts` (neu) — Modellauswahl + Orchestrierung.
- `server/forecasting/models/holt-winters.ts` (neu) — Triple Exponential Smoothing
  (Level/Trend/Saison, additiv; wöchentliche Saison m=7, optional jährliche wenn genug Daten).
- `server/forecasting/models/croston.ts` (neu) — Croston + SBA-Korrektur für Intermittent Demand.
- `server/forecasting/models/moving-average.ts` (neu) — Fallback bei sehr kurzer Historie.

**Umsetzung:**
1. **Modellauswahl** anhand Datenlage: Anteil Null-Tage hoch → Croston/SBA; genug Historie mit
   erkennbarer Saison → Holt-Winters; sonst gleitender Durchschnitt/Naiv-Saison. Regeln explizit und
   testbar.
2. **Holt-Winters**: additive Variante, Glättungsparameter (α, β, γ) per einfacher Gittersuche über
   Backtest-Fehler bestimmen (deterministisch, feste Rasterung — **kein** `Math.random`).
3. **Prognoseintervall**: aus Residuen-σ des Backtests (z. B. ±z·σ) — für Safety-Stock in
   [C.3](#c3) wiederverwendbar.
4. **Determinismus**: gleiche Eingabe → gleiche Ausgabe. **Kein** `Math.random`, kein `Date.now`
   in der Berechnung (Zeit als Parameter reinreichen — auch wegen Testbarkeit/Reproduzierbarkeit).
5. **Backtest**: Holdout der letzten N Tage/Wochen; MAPE/MAE berechnen und je Variante mitspeichern
   (Qualitätssignal fürs UI und Modellauswahl).
6. **Output**: `{ horizonDays, dailyForecast[], weeklyForecast[], intervalLow[], intervalHigh[],
   method, backtestError }`.

**Datenmodell:** Output-Struktur (in [C.5](#c5) persistiert).

**Tests:**
- Property: Prognose nie negativ (auf 0 clippen).
- Unit: synthetische Reihe mit bekannter Wochensaison → Holt-Winters rekonstruiert die Saison
  (Fehler unter Schwelle).
- Unit: intermittierende Reihe → Croston wird gewählt und liefert plausible Rate.
- Determinismus: zwei Läufe, identische Ausgabe.

**Akzeptanzkriterien:** Engine liefert für Renner und Langsamdreher plausible, nicht-negative,
deterministische Prognosen mit Fehlermaß.

**Abhängigkeiten:** [C.1](#c1).

---

## C.3 — Reorder-Point & Safety-Stock (MHD-bewusst) {#c3}

**Ziel:** Pro Variante Reorder-Point, Safety-Stock und **empfohlene Bestellmenge** — mit
Verfallsschutz: nie mehr empfehlen, als vor Ablauf verkauft werden kann.

**Warum / Kontext:** Der eigentliche Geschäftswert. Standardformeln plus ein perishable-spezifischer
Deckel, der Monolith Lager von generischen Tools abhebt.

**Betroffene Dateien:**
- `server/forecasting/reorder.ts` (neu).
- Config: Lead-Time & Service-Level.

**Umsetzung:**
1. **Safety-Stock** = `Z(serviceLevel) × σ_Nachfrage × √(Lead-Time_Tage)`. `Z` aus konfigurierbarem
   Service-Level (Default 95 % → Z≈1,65). σ aus [C.2](#c2)-Residuen.
2. **Reorder-Point** = `Ø-Tagesnachfrage × Lead-Time + Safety-Stock`. Unterschreitet `available`
   den ROP → Nachbestellsignal.
3. **Empfohlene Bestellmenge**: Deckung bis nächster Bestellzyklus (Prognose-Summe über Lead-Time +
   Review-Periode) − aktueller Bestand + Safety-Stock; auf MOQ/Gebindegröße runden (falls konfiguriert).
4. **MHD-Deckel (Kern-Differenzierer)**: `maxSinnvolleMenge = prognostizierter Absatz innerhalb der
   Rest-Haltbarkeit der einzulagernden Charge`. Empfehlung wird auf dieses Maximum gedeckelt; wenn
   ROP-Bedarf > MHD-Deckel → Warnung „Nachfrage zu gering für Haltbarkeit" statt Überbestell-Empfehlung.
5. **Lead-Time**: neues Feld `variant.supplier_lead_time_days` (oder Shop-Default `shop.default_lead_time_days`).

**Datenmodell:** `variant.supplier_lead_time_days?`, `shop.default_lead_time_days`,
`shop.service_level` (Default 0.95). Ergebnisse in `forecasts` ([C.5](#c5)).

**Tests:**
- Unit: Safety-Stock/ROP mit bekannten σ/Lead-Time/Z stimmen mit Handrechnung.
- Unit: MHD-Deckel begrenzt Empfehlung, wenn Sell-Through vor Verfall kleiner als ROP-Bedarf.
- Property: empfohlene Menge nie negativ; nie über MHD-Deckel.

**Akzeptanzkriterien:** Für jede Variante existieren ROP, Safety-Stock und eine MHD-gedeckelte
Empfehlung; Verfallsrisiko wird nie durch Übermengen erhöht.

**Abhängigkeiten:** [C.2](#c2).

---

## C.4 — ABC/XYZ-Klassifikation {#c4}

**Ziel:** Jede Variante nach Wertbeitrag (ABC) und Nachfragevariabilität (XYZ) klassifizieren →
9-Felder-Matrix als Steuerungslogik für Bestandspolitik.

**Warum / Kontext:** Nicht jede SKU verdient dieselbe Aufmerksamkeit. AX (wertvoll + stabil) braucht
enge Kontrolle/hohen Service-Level; CZ (gering + sprunghaft) eher konservative Mindestmengen. Steuert
Service-Level in [C.3](#c3) und Priorisierung im UI.

**Betroffene Dateien:**
- `server/forecasting/classification.ts` (neu).

**Umsetzung:**
1. **ABC**: kumulierter Umsatz-/Absatzanteil (Pareto): A=Top ~80 %, B=nächste ~15 %, C=Rest
   (Schwellen konfigurierbar).
2. **XYZ**: Variationskoeffizient (CoV = σ/μ) der Nachfrage: X niedrig (stabil), Y mittel, Z hoch
   (sprunghaft) — Schwellen konfigurierbar.
3. Kombiniert 9 Klassen; je Klasse eine Default-Politik (Service-Level-Modifier für C.3).

**Datenmodell:** `forecast.abc`, `forecast.xyz` ([C.5](#c5)).

**Tests:** Unit: Pareto-Verteilung → korrekte A/B/C-Grenzen; stabile vs. sprunghafte Reihe → X vs. Z.

**Akzeptanzkriterien:** Jede Variante erhält ABC- und XYZ-Klasse; Klassen sind reproduzierbar.

**Abhängigkeiten:** [C.1](#c1), [C.2](#c2).

---

## C.5 — Forecast-Speicherung + Nightly-Job {#c5}

**Ziel:** Prognosen, Reorder-Kennzahlen und Klassen pro Variante persistieren und nächtlich
neu berechnen.

**Warum / Kontext:** Prognosen müssen abfragbar (UI, Alerts) und stabil sein — nicht bei jedem
Seitenaufruf neu gerechnet.

**Betroffene Dateien:**
- `server/firestore/schema.ts` (ändern) — `Forecast`-Schema + `Collections.forecasts`.
- `app/api/cron/forecast/route.ts` (neu) — Nightly-Job (Auth wie bestehende Cron-Routes).
- `server/forecasting/run.ts` (neu) — Orchestrierung über alle aktiven Varianten.

**Umsetzung:**
1. **Schema `forecasts/{shopId}_{variantId}`**: `horizon_days`, `daily_forecast[]`, `weekly_forecast[]`,
   `interval_low[]`, `interval_high[]`, `method`, `backtest_error`, `reorder_point`, `safety_stock`,
   `recommended_order_qty`, `expiry_risk` (Enum/Score), `abc`, `xyz`, `avg_daily_demand`,
   `days_of_cover`, `generated_at`.
2. **Nightly-Job**: iteriert aktive Varianten, ruft `history → engine → reorder → classification`,
   schreibt `forecasts`. Batching (Firestore-Limit) wie im Produkt-Sync. Idempotent (überschreibt je
   Variante).
3. **Skalierung**: bei vielen Varianten Zeitbudget beachten; ggf. in Chunks/über mehrere Invocations.
4. **Trigger**: zusätzlich Ad-hoc-Recompute nach großem Wareneingang (optional).

**Datenmodell:** `forecasts`-Collection + Index `(shop_id, reorder_point)`, `(shop_id, expiry_risk)`.

**Tests:** Unit: Run schreibt für Variante mit Historie ein vollständiges `forecast`-Doc;
Idempotenz (zweiter Lauf → gleiche Werte bei gleichem Input).

**Akzeptanzkriterien:** Nach dem Job existiert je aktiver Variante ein aktuelles `forecast`-Doc.

**Abhängigkeiten:** [C.1](#c1)–[C.4](#c4).

---

## C.6 — Admin-Forecasting-UI + Bestell-Vorschläge {#c6}

**Ziel:** Eine Admin-Seite, die Prognosen, Nachbestellsignale, MHD-Risiken und ABC/XYZ sichtbar macht
— mit „Jetzt bestellen"-Vorschlägen und Forecast-vs-Ist-Chart je SKU.

**Warum / Kontext:** Macht die KI greifbar und handlungsleitend.

**Betroffene Dateien:**
- `app/admin/forecasting/` (neu) — Liste + Detail.
- Sidebar-Eintrag in `app/admin/layout.tsx`.
- Charts aus [B.1](epic-b-analytics.md#b1) wiederverwenden.

**Umsetzung:**
1. **Tabelle**: Variante, Ø-Tagesabsatz, Reichweite (Days-of-Cover), ROP, `available`,
   Bestell-Empfehlung, ABC/XYZ-Badges, MHD-Risiko-Badge; sortier-/filterbar (z. B. „nur
   nachbestellen").
2. **Detail je SKV**: Forecast-vs-Ist-Chart (Prognose + Intervall + tatsächliche Sales), Methode,
   Backtest-Fehler, Kennzahlen.
3. **Bestell-Vorschläge**: gefilterte Liste „ROP unterschritten" mit Mengen; **CSV-Export** (Muster
   aus Lagerbestand-Export).
4. **Alerts**: Stockout-Risiko und MHD-Überbestand über die **Job-Tray** (`dispatchAdminJobError`/
   `…Success`), nicht als Inline-Banner.

**Datenmodell:** keine neuen (liest `forecasts`).

**Tests:** Loader-Unit (Filter „nachbestellen" liefert nur ROP-Unterschreiter); Render-Smoke.

**Akzeptanzkriterien:** Admin sieht pro SKU Prognose + Empfehlung, kann Bestellvorschläge exportieren,
erhält Alerts bei Risiko.

**Abhängigkeiten:** [C.5](#c5), [B.1](epic-b-analytics.md#b1).

---

## C.7 — Purchase-Order-Vorschlag (Fundament) {#c7}

**Ziel:** Aus den Bestell-Empfehlungen gruppierte Bestellvorschläge je Lieferant erzeugen
(MOQ-/Lead-Time-bewusst), als Grundlage für einen späteren vollen PO-Workflow.

**Warum / Kontext:** Erste Brücke von „Empfehlung" zu „Beschaffung". Voller PO-Workflow (Wareneingang
gegen Bestellung, Lieferantenverwaltung) ist [Epic E](epic-e-wms.md)/später.

**Betroffene Dateien:**
- `server/forecasting/purchase-suggestions.ts` (neu).
- Ansicht/Export in `app/admin/forecasting/`.

**Umsetzung:**
1. Empfehlungen je **Lieferant** gruppieren (neues optionales `variant.supplier`-Feld/Config).
2. MOQ/Gebinde runden; Lead-Time-Hinweis; Gesamtwert je Bestellung.
3. Export als CSV/druckbare Ansicht; **noch keine** automatische Bestellung an Lieferanten.

**Datenmodell:** optional `variant.supplier`, `variant.moq`.

**Tests:** Unit: Gruppierung + MOQ-Rundung korrekt.

**Akzeptanzkriterien:** Ein exportierbarer, nach Lieferant gruppierter Bestellvorschlag entsteht aus
den Forecasts.

**Abhängigkeiten:** [C.3](#c3), [C.6](#c6).
