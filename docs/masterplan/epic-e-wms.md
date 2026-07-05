# Epic E — WMS-Ausbau: Retouren, Zählungen, Alerts, Multi-Lager

**Epic-Ziel:** Die verbleibenden Funktionen, die eine professionelle Lagersoftware abrunden und in der
Marktrecherche als „must-have" auftauchen, aber im aktuellen Code fehlen: Retouren/RMA,
Backorder-Benachrichtigung, Cycle-Counting, Scan-Audit, Low-Stock-/Anomalie-Alerts und (später)
Multi-Warehouse.

**Kontext (verifiziert):** Fehlt aktuell komplett. Teilweise sind Fundamente da:
`variant_location_stock` + `locations` (für Multi-Lager),
[`app/lager/scan/page.tsx`](../../apps/logistics/app/lager/scan/page.tsx) (Scan-Konsole, minimal),
Allocation-Re-Run bei Wareneingang (Basis für Backorder-Notify).

**Reihenfolge:** E ist Breite; einzelne Tasks können vorgezogen werden (z. B. E.5 Alerts früh, weil
billig und nützlich). E.6 (Multi-Lager) ist der größte Brocken → zuletzt.

---

## E.1 — Retouren / RMA-Workflow {#e1}

**Ziel:** Ein durchgängiger Retouren-Prozess: Retoure zu einer Order anlegen, Wareneingang prüfen,
über Wiedereinlagerung entscheiden (verkaufsfähig vs. beschädigt) und den Bestand korrekt buchen.

**Warum / Kontext:** Reverse-Logistik ist ein Kern-WMS-Baustein und fehlt. Verzahnt sich mit
Retouren-Labels ([D.4](epic-d-packer-ux.md#d4)) und Refund-Restock ([A.1](epic-a-sync-hardening.md#a1)).

**Betroffene Dateien:**
- `server/returns/` (neu) — Return-/RMA-Logik & Transitions.
- `server/firestore/schema.ts` (ändern) — `returns`-Collection.
- `app/admin/returns/` (neu) — Admin-Verwaltung.
- `app/lager/returns/` (neu) — Wareneingang-/Prüf-Screen fürs Lager.

**Umsetzung:**
1. **Return-Record**: `{ id, order_id, line_items[{variant_id, qty}], status
   (REQUESTED|IN_TRANSIT|RECEIVED|INSPECTED|RESTOCKED|REJECTED), reason, created_at, received_at }`.
2. **Wareneingang/Prüfung (Lager)**: Scan der Retoure → Positionen prüfen → je Position „verkaufsfähig"
   (Restock, `on_hand += qty`, Movement `RETURN_RESTOCK`) oder „defekt" (kein Restock, dokumentiert).
3. **Charge/MHD**: bei verderblicher Ware Retoure i. d. R. **nicht** automatisch wieder verkaufsfähig
   → Default „Prüfung nötig", bewusste Admin-Entscheidung.
4. **Verknüpfung**: mit Refund ([A.1](epic-a-sync-hardening.md#a1)) abgleichen (Doppelbuchung
   vermeiden) und mit Retouren-Label ([D.4](epic-d-packer-ux.md#d4)).
5. **Re-Allocation** nach Restock (freier Bestand kann STOP→SHIP).

**Datenmodell:** `returns`-Collection; `InventoryMovement.type += RETURN_RESTOCK` (falls nicht schon
über A.1 vorhanden — konsolidieren).

**Tests:** Unit: verkaufsfähige Retoure bucht Bestand + Movement; defekte nicht. Idempotenz mit
Refund-Restock (kein Doppel).

**Akzeptanzkriterien:** Retoure lässt sich anlegen, prüfen und entscheiden; Bestand stimmt; kein
Doppel-Effekt mit Refund.

**Abhängigkeiten:** [A.1](epic-a-sync-hardening.md#a1), [D.4](epic-d-packer-ux.md#d4).

---

## E.2 — Backorder / Restock-Benachrichtigung {#e2}

**Ziel:** Wenn ein Wareneingang eine zuvor gestoppte (STOP) Order versandfähig macht, wird das
sichtbar/gemeldet — plus eine Backorder-Übersicht.

**Warum / Kontext:** Die Allocation macht STOP→SHIP bei Wareneingang bereits automatisch; es fehlt die
**Sichtbarkeit** (welche Kunden warten, was wurde gerade freigeschaltet).

**Betroffene Dateien:**
- `app/admin/backorders/` (neu) oder Filter/Ansicht in Orders.
- `server/allocation/run.ts` (ändern) — Flip-Ereignisse (STOP→SHIP) für Notify sammeln.
- Job-Tray-Notice + optional Kundenmail (später, Mail-Infra nötig).

**Umsetzung:**
1. **Backorder-Liste**: alle STOP-Orders mit Fehlmenge je Variante, Wartezeit, betroffener Kunde.
2. **Flip-Notify**: nach Allocation-Run, der Orders von STOP→SHIP hebt, `dispatchAdminJobSuccess`
   („N Orders durch Wareneingang freigeschaltet").
3. **Kunden-Notify**: optional/später (E-Mail „wieder lieferbar/in Versand").

**Datenmodell:** keine neuen (nutzt Order-Status/Allocation-Ergebnis).

**Tests:** Unit: Wareneingang, der STOP→SHIP auslöst → Flip-Ereignis erfasst.

**Akzeptanzkriterien:** Admin sieht Backorders und erhält Hinweis, wenn Wareneingang Orders
freischaltet.

**Abhängigkeiten:** keine (nutzt bestehende Allocation).

---

## E.3 — Cycle-Counting {#e3}

**Ziel:** Regelmäßige/rollierende Bestandszählung per Scan mit Varianz-Erfassung und Freigabe →
verbessert die Inventory-Accuracy-KPI ([B.2](epic-b-analytics.md#b2)).

**Warum / Kontext:** Inventory-Accuracy ist eine der fünf Kern-KPIs; ohne Zählprozess bleibt sie
Schätzung. Bins/Locations existieren bereits (`storage_bins`, `variant_bins`).

**Betroffene Dateien:**
- `server/inventory/cycle-count.ts` (neu).
- `app/lager/cycle-count/` (neu) — Zähl-Screen (Bin scannen → zählen → Varianz).
- `app/admin/cycle-count/` (neu) — Planung/Freigabe.
- `schema.ts` — `cycle_counts`-Collection.

**Umsetzung:**
1. **Zählauftrag**: nach Bin/Zone oder ABC-Klasse (A-Artikel häufiger — nutzt [C.4](epic-c-forecasting.md#c4)).
2. **Zählung (Lager)**: Bin scannen → Ist-Menge erfassen → Soll/Ist-Varianz.
3. **Freigabe (Admin)**: Varianz prüfen → Bestandskorrektur als `ADJUSTMENT`-Movement mit Audit.
4. Ergebnis fließt in Inventory-Accuracy-KPI.

**Datenmodell:** `cycle_counts/{id}` (bin, geplante/gezählte Menge, Varianz, Status, Zähler-uid).

**Tests:** Unit: Varianz korrekt; Freigabe erzeugt Adjustment-Movement in Höhe der Varianz.

**Akzeptanzkriterien:** Zählung per Scan erfassbar, Varianz sichtbar, Freigabe bucht Korrektur;
Accuracy-KPI reagiert.

**Abhängigkeiten:** profitiert von [E.4](#e4) (Scan) und [C.4](epic-c-forecasting.md#c4) (ABC-Priorisierung).

---

## E.4 — Scan-Audit-Trail {#e4}

**Ziel:** Alle Scan-Ereignisse (Wareneingang, Picking, Packing, Zählung) persistent protokollieren —
Traceability + Datenquelle für Picker-Analytics.

**Warum / Kontext:** Scans passieren heute nur flüchtig im UI (Cluster-Picking); es gibt keinen
Audit/keine Historie. [B.5](epic-b-analytics.md#b5) (Picker-Leistung) und Traceability brauchen das.

**Betroffene Dateien:**
- `server/inventory/scan-events.ts` (neu).
- `schema.ts` — `scan_events`-Collection.
- Einbindung in die bestehenden Scan-Stellen (`app/lager/run/…`, `app/lager/scan/…`, Packing).

**Umsetzung:**
1. **Event**: `{ id, shop_id, uid, context (RECEIVING|PICKING|PACKING|COUNT), code, resolved_ref
   (order/variant/bin), result (OK|WRONG_ITEM|UNKNOWN), ts }`.
2. An allen Scan-Stellen ein Event schreiben (best-effort, nie den Flow blockieren).
3. Retention/TTL beachten (Volumen) — TTL-Feld wie bei `webhook_events` ([A.6](epic-a-sync-hardening.md#a6)).

**Datenmodell:** `scan_events/{id}` mit `expires_at` (TTL).

**Tests:** Unit: Scan schreibt Event mit korrektem Kontext/Ergebnis.

**Akzeptanzkriterien:** Scans landen im Audit-Log; Picker-Analytics kann darauf aufbauen.

**Abhängigkeiten:** keine harten; speist [B.5](epic-b-analytics.md#b5).

---

## E.5 — Low-Stock- & Anomalie-Alerts {#e5}

**Ziel:** Proaktive Warnungen bei niedrigem Bestand, drohendem MHD-Ablauf, Stockout-Risiko und
festhängenden Orders — über die Job-Tray (und optional E-Mail).

**Warum / Kontext:** Billig, hoher Nutzen, kann früh kommen. Schwellwert- **und** prognosegetrieben
(nutzt [C.5](epic-c-forecasting.md#c5), sobald vorhanden; vorher reine Schwellwerte).

**Betroffene Dateien:**
- `server/alerts/` (neu) — Alert-Auswertung.
- `app/api/cron/alerts/route.ts` (neu) — periodische Prüfung.
- Ausgabe: Job-Tray (`dispatchAdminJobError`/`…Success`), optional Mail (später).

**Umsetzung:**
1. **Regeln**: `available < Schwellwert` (statisch **oder** ROP aus C.3); MHD-Ablauf in ≤ N Tagen;
   Stockout-Risiko (Prognose > Bestand vor Nachschub); Orders zu lange in einem Status
   (Stuck-Detection ergänzend zum Reconcile).
2. **Deduplizierung**: gleiche Warnung nicht täglich neu spammen (Alert-State mit „zuletzt gemeldet").
3. **Ausgabe**: Job-Tray-Notice; optional E-Mail (später, Mail-Infra).

**Datenmodell:** `alerts/{id}` (Typ, Ref, Zustand, last_notified_at).

**Tests:** Unit: Regel feuert bei Unterschreitung; Dedup verhindert Doppelmeldung am selben Tag.

**Akzeptanzkriterien:** Relevante Risiken erscheinen rechtzeitig in der Job-Tray, ohne zu spammen.

**Abhängigkeiten:** optional [C.5](epic-c-forecasting.md#c5) (prognosegetrieben); Schwellwert-Variante
sofort möglich.

---

## E.6 — Multi-Warehouse (später) {#e6}

**Ziel:** Bestand, Allocation und Versand über mehrere Lagerstandorte hinweg — Standortwahl je Order,
ggf. Split-Shipments.

**Warum / Kontext:** Größter Brocken. Fundament vorhanden (`variant_location_stock`, `locations`), aber
Allocation und Fulfillment gehen heute von **einem** Fulfillment-Standort aus. Bewusst **zuletzt**.

**Betroffene Dateien:**
- `server/allocation/` (umfangreich ändern) — Standort-bewusste Allocation.
- `server/picking/`, `server/dhl/` (ändern) — standortabhängiges Picking/Versand.
- Shopify: FulfillmentOrders sind bereits standortbezogen — das nutzen.

**Umsetzung (Grobskizze — eigener Detailplan bei Start):**
1. Allocation entscheidet **Standort** je Order (Nähe zum Kunden, Bestand, MHD).
2. Optional Split-Shipment (mehrere FulfillmentOrders je Order) — konsistent mit
   [A.2](epic-a-sync-hardening.md#a2) (Line-Item-Fulfillment).
3. Picking-Queues/DHL je Standort; Determinismus der Allocation erhalten.
4. **Achtung**: berührt die Kern-Invarianten (globale Queue-Concurrency=1, reserved_total) → eigener
   sorgfältiger Plan + umfangreiche Tests vor Umsetzung.

**Datenmodell:** Allocation/Reservierung je Standort; Order-Standortzuordnung.

**Tests:** umfangreiche Allocation-Property-Tests (kein Über-Reservieren je Standort; Determinismus).

**Akzeptanzkriterien:** Orders werden korrekt einem Standort zugewiesen und von dort versendet;
Bestandsinvarianten je Standort gewahrt.

**Abhängigkeiten:** [A.2](epic-a-sync-hardening.md#a2); baut auf gehärtetem Sync + Analytics auf.
