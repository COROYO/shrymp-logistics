# Masterplan — „Beste Lagersoftware, die je ein Shopify-Shop installiert hat"

> Status: **Planungsdokument.** Nichts hiervon ist implementiert. Jedes Todo enthält
> ein vollständiges, selbst-ausführbares KI-Briefing. Reihenfolge und Umfang siehe unten.
>
> Dieses Dokument-Set ersetzt den veralteten Roadmap-Teil von [`../../PROJECT.md`](../../PROJECT.md).

---

## 1. Vision

Monolith Lager (intern „Shrymp Logistics") sitzt zwischen Shopify (Bestell- und Bestands-Master)
und dem physischen Lager. Der Fulfillment-Kern ist bereits **produktionsreif**. Um zur besten
Lagersoftware für Shopify-Merchants zu werden, bauen wir vier Säulen aus:

1. **KI-Nachfrageprognose** — wann welche Ware nachbestellt werden muss (Saison, Feiertage,
   Trend), Reorder-Points/Safety-Stock, **MHD-bewusste Überbestandswarnung** (entscheidend bei
   Kaviar/Fisch), ABC/XYZ, Bestell-Vorschläge.
2. **Analytics** — echte Warehouse-KPIs mit Graphen (Pick-Rate, Order-Accuracy, Cycle-Time,
   Turnover, Perfect-Order-Rate), Trends, Produkt-Velocity, Picker-Leistung, Bestandsgesundheit.
3. **DHL / Packer-UX** — Etikett **direkt aus dem Drucker** (Browser-Direktdruck), Scan-to-Label,
   Bulk- und Retouren-Labels, Routing-Code-Compliance.
4. **Sync-Robustheit** — stabile, sichere Synchronisation von/zu Shopify bei Teil-Refunds,
   Teil-Stornos, Teil-Lieferungen, Order-Edits und Statuswechseln.

**Ambition:** höchste. Sequenz siehe §5 — erst korrekte Daten, dann sichtbare Gewinne, dann KI.

### Zweite Ausbaustufe — vom Lager-Tool zur Multichannel-Warenwirtschaft

Aus Kundenfeedback wächst der Plan über die vier Säulen hinaus zu einer kompletten **Multichannel-
Warenwirtschaft/ERP** (Epics F–N) — in der Liga von Billbee/Xentral/plentymarkets, aber enger
integriert und auf verderbliche Ware (Charge/MHD) zugeschnitten:

- **F** Produkt-Editor/PIM · **G** Multichannel (Amazon/eBay/Kaufland/Otto/WooCommerce/…) ·
  **H** Automatisierung & Workflows · **I** Verteiltes Fulfillment (Multi-Lager/Split/3PL) ·
  **J** Warenwirtschaft (Einkauf/PO/Inventur/Bewertung) · **K** Dokumente & Drucksteuerung ·
  **L** CRM & Service-Desk · **M** Finance & Steuern (OSS/DATEV/Rechnungen/Zahlungen) ·
  **N** Öffentliche API.

Dreh- und Angelpunkt ist **G.1 Channel-Abstraktion**: Heute ist alles Shopify-gekoppelt — G.1 macht
das Modell kanalneutral und ist Voraussetzung für G, H, I, K und M.

---

## 2. Ehrlicher Ist-Stand (Stand der Code-Analyse, Juli 2026)

**Stark und fertig** (die Docs behaupten teils „offen" — sie sind veraltet):

- Allocation-Engine (SHIP/STOP, `EXPRESS_DHL`-Vorrang, `reserved_total`, self-healing RECONCILE)
- Picking/Packing inkl. **Cluster-Picking** (Totes), FEFO-Chargenzuweisung bei Slip-Druck,
  Lieferschein-Nummerierung (`L00042/26`)
- **DHL Parcel DE Shipping v2** (REST, OAuth2) — echte Labels, PDF in Firebase Storage, DE-Inland
- Shopify-Sync: GraphQL `2026-04`, Webhook-Dedup (`X-Shopify-Webhook-Id`), **Outbox-Retry-Queue**,
  Status-Guards gegen Regress, 5-Minuten-**Reconcile-Sweep**
- Order-State-Machine `NEW→SHIP/STOP→PICKING→PACKED`, `CANCELLED` terminal
- Lager-UI (Picking-Queue, Einzel-/Cluster-Picking, Packing, Scan-Konsole, Packed-Liste)
- Admin-UI (Dashboard mit 5 KPIs + 14-Tage-SVG-Charts, Orders, Products, Lagerbestand,
  Lagerplätze, Allocations, Customers, Users, Settings)
- Inventar-Audit-Trail (`inventory_movements`)

**Die vier echten Lücken** (jeweils am Code verifiziert):

| Säule | Lücke |
| --- | --- |
| ① Forecasting | existiert **gar nicht** — keine ML/Statistik, keine Reorder-Points, keine Historien-Rollups |
| ② Analytics | nur 5 KPIs + selbstgebaute SVG-Balken, 30-Tage-Live-Scan, keine Charting-Lib, keine echten WMS-KPIs |
| ③ DHL/Packer | Label kommt als PDF-Signed-URL → Tab öffnen → **manuell drucken**; kein Auto-Druck, keine Retouren-Labels |
| ④ Sync | **kein `refunds/create`** (Refunds unsichtbar → Bestandsdrift), Fulfillment nur aggregiert, keine Re-Allocation bei Edit, Outbox-Cleanup nicht verdrahtet |

---

## 3. Architektur-Erweiterungen (querschnittlich)

Mehrere Epics hängen an denselben neuen Fundamenten. Diese zuerst (Epic 0), damit spätere Epics
nicht doppelt bauen:

- **Rollup-Datenlayer** (`sales_daily`, `ops_metrics_daily`) — durable Tages-Aggregate als
  gemeinsame Quelle für Analytics (②) **und** Forecasting (①). Ersetzt den teuren 30-Tage-Live-Scan.
- **Order-Fulfillment-Felder** — Line-Item-Fulfillment-Mengen + Refund-Spiegelung (④), Basis für
  korrekte Bestandsbuchung.
- **`forecasts`-Collection** — pro Variante Prognose, Reorder-Point, Safety-Stock, ABC/XYZ,
  MHD-Risiko (①).
- **`scan_events`-Collection** — Scan-Audit für Picker-Analytics und Traceability (② + E).
- **`returns` / RMA** — Retouren-Workflow (E), verknüpft mit DHL-Retouren-Labels (③).

Alle neuen Collections: in [`server/firestore/schema.ts`](../../apps/logistics/server/firestore/schema.ts)
via Zod definieren, in die `Collections`-Konstante eintragen, Indizes in
[`firestore.indexes.json`](../../firestore.indexes.json) ergänzen.

---

## 4. Konventionen für jede Umsetzung (verbindlich)

Jede KI, die ein Briefing ausführt, hält sich an [`../../CLAUDE.md`](../../CLAUDE.md) **und**:

- **Next.js 16**: `params`/`searchParams` sind Promises; Server Components default; kein
  `middleware.ts` (nur `proxy.ts`). Vor Guessen `node_modules/next/dist/docs/` lesen.
- **Geld & Mengen = Integer** (kleinste Einheit). Bestand = ganze Stück.
- **Timestamps**: `FieldValue.serverTimestamp()` beim Schreiben; Zod akzeptiert Firestore-Timestamp,
  ISO-String und `Date`.
- **Schemas** ausschließlich in `server/firestore/schema.ts`; Collection-Namen nur über die
  `Collections`-Konstante.
- **Default-deny Firestore**: alle Reads/Writes serverseitig über Admin SDK.
- **Logging** über [`lib/logger.ts`](../../apps/logistics/lib/logger.ts) (Single-Line-JSON).
- **Admin-Feedback** ausschließlich über die Job-Tray
  (`dispatchAdminJobSuccess`/`dispatchAdminJobError`) — **keine** Inline-Banner. Nach Start von
  Background-Jobs `ADMIN_JOBS_REFRESH_EVENT` dispatchen.
- **Determinismus**: Allocation bleibt deterministisch pro Snapshot; neue Batch-/Bestandslogik
  darf das nicht brechen.
- **Tests**: Vitest + fast-check (property-based). Neue Geld-/Mengen-/Prognose-Logik braucht
  Property-Tests (z. B. „nie `remaining_qty < 0`", „Prognose nie negativ").
- **Sprache**: UI-Texte Deutsch (via `next-intl`), Code/Kommentare Englisch, Kommentare sparsam
  (nur das _Warum_).

---

## 5. Reihenfolge & Abhängigkeiten

```
Epic 0  Fundament (Docs-Refresh + Rollup-Datenlayer)
   │
   ├─► Epic A  Sync-Härtung        (korrekte Daten — Basis für alles)
   │
   ├─► Epic B  Analytics-Cockpit   ─┐  (parallel möglich, sobald 0 + A stehen)
   ├─► Epic D  Packer-UX & Label   ─┘
   │
   ├─► Epic C  KI-Forecasting       (braucht saubere Historie aus 0 + A + B)
   │
   └─► Epic E  WMS-Ausbau           (Breite: Retouren, Cycle-Count, Alerts, Multi-Lager)
   │
   └─► Epic F  Produkt-Editor (PIM)  (Katalog pflegen + Shopify Write-Back; F.1 ✅)

── Welle 2: Multichannel-Warenwirtschaft (Kundenfeedback) ──
Epic G  Multichannel-OMS   (G.1 Channel-Abstraktion = Fundament für H/I/K/M)
   ├─► Epic H  Automatisierung & Workflows
   ├─► Epic I  Verteiltes Fulfillment (Multi-Lager/Split/3PL; löst E.6 ab)
   ├─► Epic J  Warenwirtschaft (Einkauf/PO/Inventur/Bewertung)
   ├─► Epic K  Dokumente & Drucksteuerung
   ├─► Epic L  CRM & Service-Desk
   ├─► Epic M  Finance & Steuern (OSS/DATEV/Rechnungen/Zahlungen)
   └─► Epic N  Öffentliche API
```

**Welle 1 (Shopify-Exzellenz):** `0 → A → (B ∥ D) → C → E`; **F** parallel (PIM, F.1 ✅). Begründung:
Analytics und Forecasting sind nur so gut wie die Daten — Rollups (0) und Sync-Integrität (A) zuerst.

**Welle 2 (Multichannel-Warenwirtschaft):** `G.1 → G → H → I → (J ∥ K) → L → M → N`. Die
Channel-Abstraktion **G.1** ist Voraussetzung für H, I, K und M und sollte **nach Epic A** kommen,
damit die Partial-Sync-Logik gleich kanalneutral gebaut wird. Welle 2 ist ein mehrmonatiges Programm;
jede Epic ist einzeln wertstiftend und eigenständig auslieferbar.

---

## 6. Getroffene Entscheidungen (gelockt)

- **Forecasting**: **in-house statistisch in TypeScript** (Holt-Winters/Saison + Croston für
  Intermittent Demand), als Cloud Function / Cron. Günstig, erklärbar, MHD-bewusst, keine
  Extra-Infra. Kein Python-Dienst, keine externe API im ersten Wurf.
- **Label-Druck**: **Browser-Direktdruck** an den (Thermo-)Drucker via Print-Pipeline. Kein
  lokaler Print-Agent im ersten Wurf.
- **Marktplätze**: **nur mit offizieller API** — **keine API, keine Anbindung**. Keine Aggregatoren
  (API2Cart/M2E) und keine CSV-Workarounds. Temu/Metro/Hood daher erst, sobald sie eine offizielle
  Seller-API bereitstellen.
- **E-Mail**: Provider = **Amazon SES**, aber **später** — nicht im ersten Umsetzungsschub. Bis dahin
  Benachrichtigungen über Job-Tray/UI.
- **Split-Bestellungen**: **merchant-konfigurierbare Policy** — `NO_SPLIT` (Default, wie heute) ·
  `SPLIT_MULTI_WAREHOUSE` (Multi-Paket über mehrere Lager) · `SHIP_WHEN_AVAILABLE` (ein Lager, sobald das
  Produkt da ist). Siehe [I.2](epic-i-distributed-fulfillment.md#i2).

---

## 7. So sind die Briefings aufgebaut

Jedes Todo folgt diesem Template, damit eine KI es kalt umsetzen kann:

- **Ziel** — was am Ende funktioniert.
- **Warum / Kontext** — Ist-Zustand, Problem, betroffene bestehende Logik.
- **Betroffene Dateien** — konkrete Pfade (neu/ändern).
- **Umsetzung** — Schritt-für-Schritt-Ansatz, inkl. Wiederverwendung bestehender Funktionen.
- **Datenmodell** — Schema-/Collection-/Index-Änderungen.
- **Tests** — Unit/Property/manuell.
- **Akzeptanzkriterien** — überprüfbare Definition-of-Done.
- **Abhängigkeiten** — welche Tasks vorher fertig sein müssen.

---

## 8. Task-Index

### [Epic 0 — Fundament](epic-0-foundation.md)
- 0.1 PROJECT.md auf den echten Stand bringen
- 0.2 AGENTS.md zum echten Onboarding ausbauen
- 0.3 CLAUDE.md um neue Subsysteme erweitern
- 0.4 Rollup-Datenlayer (`sales_daily`, `ops_metrics_daily`)
- 0.5 Historien-Backfill der Rollups

### [Epic A — Sync-Härtung](epic-a-sync-hardening.md)
- A.1 `refunds/create` abonnieren & verarbeiten (inkl. Restock)
- A.2 Line-Item-Fulfillment-Tracking
- A.3 External-Fulfillment-Trigger präzisieren
- A.4 Re-Allocation bei Order-Edit (Mengenänderung)
- A.5 Teil-Stornierung sauber behandeln
- A.6 Outbox- & Webhook-Event-Cleanup verdrahten
- A.7 Explizite Webhook-Reihenfolge-Absicherung (`updated_at`)
- A.8 Reconciliation-Report + Admin-Sichtbarkeit

### [Epic B — Analytics-Cockpit](epic-b-analytics.md)
- B.1 Charting-Library einführen (Recharts)
- B.2 KPI-Services auf dem Rollup-Layer
- B.3 Analytics-Dashboard-Seiten
- B.4 Bestandsgesundheit (Aging, Dead-Stock, MHD-Funnel)
- B.5 Picker-Leistung
- B.6 Export & geplante Reports

### [Epic C — KI-Forecasting](epic-c-forecasting.md)
- C.1 Sales-History-Feature-Builder (inkl. Stockout-Zensierung, Feiertage)
- C.2 Prognose-Engine (Holt-Winters + Croston)
- C.3 Reorder-Point & Safety-Stock (MHD-bewusst)
- C.4 ABC/XYZ-Klassifikation
- C.5 Forecast-Speicherung + Nightly-Job
- C.6 Admin-Forecasting-UI + Bestell-Vorschläge
- C.7 Purchase-Order-Vorschlag (Fundament)

### [Epic D — Packer-UX & Auto-Label](epic-d-packer-ux.md)
- D.1 Browser-Auto-Druck-Pipeline für Labels
- D.2 Scan-to-Label One-Touch-Flow
- D.3 Bulk-Label-Druck
- D.4 Retouren-Labels (DHL Parcel DE Returns API)
- D.5 Routing-Code-Compliance (Pflicht ab 01.04.2026)
- D.6 Gewichtserfassung / Waage (optional)
- D.7 International / DHL Express (später)
- D.8 Deutsche Post Briefversand / DV-Freimachung

### [Epic E — WMS-Ausbau](epic-e-wms.md)
- E.1 Retouren / RMA-Workflow
- E.2 Backorder / Restock-Benachrichtigung
- E.3 Cycle-Counting
- E.4 Scan-Audit-Trail
- E.5 Low-Stock- & Anomalie-Alerts
- E.6 Multi-Warehouse (später)

### [Epic F — Produkt-Editor (PIM)](epic-f-product-editor.md)
- F.1 Produkt-Editor + Shopify Push (MVP) ✅
- F.2 Produkt-Optionen im UI ✅
- F.3 Voll-Sync zieht Katalog-Inhalte ✅
- F.4 Bild-Upload (staged uploads) ✅
- F.5 products/update Webhook

### [Epic G — Multichannel-OMS](epic-g-multichannel.md)
- G.1 Channel-Abstraktion / Order-Modell entkoppeln (Fundament)
- G.2 Connector-Framework + Multichannel-Bestandssync
- G.3 Amazon-SP-API-Connector
- G.4 eBay-Sell-API-Connector
- G.5 Kaufland-Seller-API-Connector
- G.6 Otto-Market-API-Connector
- G.7 WooCommerce-Connector
- G.8 Weitere Marktplätze — nur mit offizieller API (kein Aggregator/CSV)

### [Epic H — Automatisierungs- & Workflow-Engine](epic-h-automation.md)
- H.1 Rules-Engine-Kern (Trigger/Bedingung/Aktion)
- H.2 Trigger-Integration in den Lebenszyklus
- H.3 Bedingungs- & Aktions-Bibliothek
- H.4 Prozessvarianten je Artikel/Order/Marktplatz
- H.5 Prioritäts- & Fast-Lane-Verallgemeinerung
- H.6 Regel-Editor-UI (No-Code)

### [Epic I — Verteiltes Fulfillment](epic-i-distributed-fulfillment.md)
- I.1 Standort-bewusste Allocation (löst E.6 ab)
- I.2 Split-Shipments
- I.3 3PL-/Fulfillment-Partner-Modell
- I.4 Order-Routing-Engine
- I.5 3PL-Order-Push + Status-Rückkanal
- I.6 3PL-Bestandsabgleich
- I.7 Per-Standort-Picking-Queues

### [Epic J — Warenwirtschaft / ERP-Kern](epic-j-warenwirtschaft.md)
- J.1 Lieferanten-Stammdaten
- J.2 Bestellwesen / Purchase Orders
- J.3 Wareneingang gegen Bestellung
- J.4 Inventur / Stocktaking (absorbiert E.3)
- J.5 Bestandsbewertung & Einkaufspreise
- J.6 Bulk-Wareneingang & Chargen-Import/-Merge/-Split
- J.7 Lieferanten-Rechnungsabgleich (Fundament)

### [Epic K — Dokumente & Drucksteuerung](epic-k-documents.md)
- K.1 Dokument-Engine & Templates
- K.2 Rechnungen & Gutschriften
- K.3 Pack-/Versandstationen-Modell
- K.4 Druckregel-Engine
- K.5 Automatische Dokumenten-Bündel
- K.6 Stationsgebundene Drucker & Routing

### [Epic L — CRM & Service-Desk](epic-l-crm.md)
- L.1 Kunden-Stammdaten / CRM-Kern
- L.2 E-Mail-Anbindung (Outbound + Inbound)
- L.3 Ticketsystem / Helpdesk
- L.4 KI-Antwortvorschläge (Claude)
- L.5 Kommunikations-Historie & Vorlagen

### [Epic M — Finance & Steuern](epic-m-finance.md)
- M.1 Steuer-Engine / VAT-Determination
- M.2 OSS-Verfahren
- M.3 Zahlungsabgleich
- M.4 DATEV-Export (EXTF-Buchungsstapel)
- M.5 Rechnungs- & Finanz-Datenmodell

### [Epic N — Öffentliche API & Integrationen](epic-n-public-api.md)
- N.1 Write-Endpoints
- N.2 Erweiterte Scopes (Produkte/Kunden/Forecasts/Webhooks)
- N.3 Outbound-Webhooks
- N.4 Rate-Limiting & Quotas
- N.5 API-Doku & Developer-Portal
