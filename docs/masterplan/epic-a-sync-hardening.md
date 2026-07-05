# Epic A — Sync-Härtung: stabile, sichere Shopify-Synchronisation

**Epic-Ziel:** Teil-Refunds, Teil-Stornos, Teil-Lieferungen, Order-Edits und Statuswechsel korrekt
und ohne Bestandsdrift zwischen Shopify und Lager spiegeln. Dies ist die Datenbasis, auf die
Analytics und Forecasting vertrauen.

**Kontext (verifiziert):** Der Sync-Unterbau ist stark — Webhook-Dedup über `X-Shopify-Webhook-Id`,
Outbox-Retry-Queue, Status-Guards gegen Regress, 5-Min-Reconcile. Aber: **`refunds/create` ist nicht
abonniert** (das Wort „refund" kommt in `server/shopify/` nirgends vor), Fulfillment wird nur
**aggregiert** verarbeitet, und Order-Edits lösen keine Re-Allocation aus. Abonnierte Topics heute:
`orders/create|updated|edited|cancelled`, `inventory_levels/update`, `app/uninstalled`
([`server/shopify/topics.ts`](../../apps/logistics/server/shopify/topics.ts)).

**Zentrale Referenzdateien:**
[`webhook-handler.ts`](../../apps/logistics/server/shopify/webhook-handler.ts),
[`topics.ts`](../../apps/logistics/server/shopify/topics.ts),
[`register-webhooks.ts`](../../apps/logistics/server/shopify/register-webhooks.ts),
[`outbox.ts`](../../apps/logistics/server/shopify/outbox.ts),
[`status-guard.ts`](../../apps/logistics/server/allocation/status-guard.ts),
[`external-fulfillment.ts`](../../apps/logistics/server/picking/external-fulfillment.ts),
[`release.ts`](../../apps/logistics/server/picking/release.ts).

---

## A.1 — `refunds/create` abonnieren & verarbeiten (inkl. Restock) {#a1}

**Ziel:** Ein Refund in Shopify (voll oder teilweise, mit/ohne Restock) wird korrekt gespiegelt:
restockte Mengen erhöhen den Bestand, der Finanzstatus wird aktualisiert, freigewordener Bestand
triggert eine Re-Allocation.

**Warum / Kontext:** Refunds sind aktuell **unsichtbar**. Ein Merchant, der in Shopify einen Artikel
erstattet und zurück ins Lager bucht (`restock: true`), erzeugt bei uns keine Bestandsbewegung →
dauerhafte Drift. Shopify-Refund-Payload enthält `refund_line_items[]` mit `quantity`,
`restock_type` (`return`/`cancel`/`no_restock`) und `line_item_id`, plus `transactions[]` für den
erstatteten Betrag.

**Betroffene Dateien:**
- `topics.ts` (ändern) — `REFUNDS_CREATE: "refunds/create"` ergänzen.
- `register-webhooks.ts` (ändern) — Topic mitregistrieren (idempotent, bestehendes Muster).
- `webhook-handler.ts` (ändern) — Dispatch + neuer Handler `applyRefund()`.
- `server/inventory/apply-refund.ts` (neu) — Bestands-/Batch-Logik der Restock-Buchung.
- `server/firestore/schema.ts` (ändern) — Refund-Felder + Movement-Typ.
- `firestore.indexes.json` (ggf. ändern).

**Umsetzung:**
1. **Payload-Parsing**: nur `refund_line_items` mit `restock_type ∈ {return, cancel}` und
   `quantity > 0` erhöhen Bestand. `no_restock` beeinflusst nur den Finanzbetrag.
2. **Bestandsbuchung** (Transaktion): pro betroffener Variante `on_hand_total += qty`,
   `available` neu berechnen; **kein** automatisches Zurückschreiben in konkrete Chargen (Charge des
   Rücklaufs ist unbekannt) → als **neue** `ADJUSTMENT`/`REFUND_RESTOCK`-Bewegung ohne Batch, bzw.
   Admin entscheidet später Chargenzuordnung. (Sauber: neuer Movement-Typ `REFUND_RESTOCK`.)
3. **Finanzstatus**: `order.shopify_financial_status` aktualisieren, `refunded_amount_cents`
   aufaddieren, `refunds[]`-Eintrag mit Shopify-Refund-`id` speichern (Idempotenz je Refund-ID:
   bereits verarbeitete Refund-ID → no-op, zusätzlich zur Webhook-Dedup).
4. **Inventory-Push**: wenn `inventory_source = APP`, `INVENTORY_SET`-Outbox-Eintrag für die
   erhöhten Varianten (bestehendes `queueInventoryPush` wiederverwenden).
5. **Re-Allocation**: `enqueueAllocationRun({ triggeredBy: "REFUND_RESTOCK" })` — freier Bestand
   kann STOP-Orders zu SHIP machen.
6. **Idempotenz**: Webhook-Dedup greift; zusätzlich Refund-`id` in `order.refunds` prüfen, damit ein
   erneut zugestellter Refund nicht doppelt bucht.

**Datenmodell:**
- `Order`: `refunded_amount_cents: number` (default 0), `refunds: { id, created_at, amount_cents,
  restocked_line_items: {line_item_id, variant_id, qty}[] }[]`.
- `InventoryMovement.type`: `REFUND_RESTOCK` ergänzen.
- Neuer Movement bei jeder Restock-Buchung (Audit).

**Tests:**
- Unit: Refund mit `restock_type: return, qty 2` → `on_hand_total += 2`, Movement geschrieben,
  Finanzstatus aktualisiert.
- Unit: `restock_type: no_restock` → **kein** Bestandseffekt, nur Finanzbetrag.
- Property/Idempotenz: derselbe Refund zweimal zugestellt → Bestand steigt nur einmal.
- Unit: Refund auf bereits `PACKED` Order → Bestand steigt korrekt (Rücklauf), Order bleibt PACKED.

**Akzeptanzkriterien:**
- Teil-Refund mit Restock in Shopify → korrekter Bestand + Finanzstatus in der App, Audit-Movement
  vorhanden, ggf. STOP→SHIP-Flip.
- Doppelte Zustellung ohne Doppelbuchung.

**Abhängigkeiten:** keine harten; speist `refunded_*` in [0.4](epic-0-foundation.md#rollups).

---

## A.2 — Line-Item-Fulfillment-Tracking {#a2}

**Ziel:** Fulfillment wird pro Line-Item verfolgt. Eine Order gilt erst als vollständig `PACKED`,
wenn **alle** Positionen fulfilled sind; Teil-Fulfillment durch Shopify konsumiert nur die
tatsächlich versendeten Mengen.

**Warum / Kontext:** Heute sieht die App nur den **aggregierten** `fulfillment_status`
(`fulfilled`/`partial`/`pending`).
[`external-fulfillment.ts`](../../apps/logistics/server/picking/external-fulfillment.ts) behandelt
`partial` faktisch wie „ganze Order gepackt" → Bestand wird für nicht versendete Positionen zu früh
abgezogen und die Order verlässt fälschlich die Picking-Queue.

**Betroffene Dateien:**
- `topics.ts`, `register-webhooks.ts` (ändern) — `FULFILLMENTS_CREATE: "fulfillments/create"` und
  `FULFILLMENTS_UPDATE: "fulfillments/update"` ergänzen (liefern Line-Item-Ebene).
- `webhook-handler.ts` (ändern) — Handler, der pro Fulfillment die `line_items[].quantity`
  verrechnet.
- `external-fulfillment.ts` (ändern) — nur **neu** fulfillte Mengen konsumieren (Delta), nicht die
  ganze Order.
- `server/shopify/mappers.ts` (ändern) — Fulfillment-Line-Items mappen.
- `server/firestore/schema.ts` (ändern) — `line_items[].fulfilled_qty`.

**Umsetzung:**
1. **Datenfeld**: `OrderLineItem.fulfilled_qty` (default 0). Quelle: `fulfillments/create|update`
   Payloads bzw. GraphQL-Refetch der `fulfillmentOrders`/`fulfillments` (kanonisch, robuster als
   REST — bestehende GraphQL-Client-Infra nutzen).
2. **Delta-Konsum**: Beim Fulfillment-Event pro Line-Item `newlyFulfilled = fulfilled_qty_neu −
   fulfilled_qty_alt`. Nur `newlyFulfilled > 0` konsumiert Bestand (Batches/Variant) und schreibt
   `CONSUME`-Movements. Bestehende Konsum-Transaktion aus `confirmPacking`/`external-fulfillment`
   wiederverwenden, aber mengenscharf statt „ganze Order".
3. **Status**: `internal_status = PACKED` nur wenn **alle** Line-Items `fulfilled_qty == qty`. Sonst
   neues Flag `partially_fulfilled = true` (orthogonal zur State-Machine; `internal_status` bleibt
   `SHIP`/`PICKING`, damit die Allocation-Invarianten nicht brechen). Rest-Mengen bleiben
   allokierbar/pickbar.
4. **Idempotenz**: `externally_fulfilled`-Guard auf **Line-Item-Ebene** heben (pro Position
   verbrauchte Menge tracken), damit erneute Events nicht doppelt konsumieren.

**Datenmodell:** `OrderLineItem.fulfilled_qty`; `Order.partially_fulfilled`; ggf.
`Order.fulfillments[]` (Shopify-Fulfillment-IDs → verarbeitete Mengen) für Idempotenz.

**Tests:**
- Unit: Order mit 2 Positionen, Shopify fulfillt Position 1 (qty 1 von 1) → nur Position-1-Bestand
  konsumiert, Order **nicht** PACKED, `partially_fulfilled = true`.
- Unit: danach Position 2 fulfillt → Order PACKED.
- Property: Summe aller `CONSUME`-Movements einer Order == Summe der tatsächlich fulfillten Mengen,
  nie mehr.
- Idempotenz: dasselbe Fulfillment-Event zweimal → einmal konsumiert.

**Akzeptanzkriterien:** Teil-Fulfillment via Shopify spiegelt exakt die versendeten Mengen; nicht
versendete Positionen bleiben im Lager-Flow.

**Abhängigkeiten:** eng mit [A.3](#a3).

---

## A.3 — External-Fulfillment-Trigger präzisieren {#a3}

**Ziel:** Bestand wird nur konsumiert, wenn wirklich **neu** fulfillt wurde — keine False-Positives
durch bloße Order-Updates.

**Warum / Kontext:** In
[`webhook-handler.ts`](../../apps/logistics/server/shopify/webhook-handler.ts) triggert **jedes**
`orders/updated` mit `fulfillment_status ∈ {fulfilled, partial}` `applyExternalFulfillment()`. Ein
Update, das gar kein neues Fulfillment enthält (z. B. Tag-Änderung, Adress-Edit), kann die Order
fälschlich als extern fulfillt markieren.

**Betroffene Dateien:**
- `webhook-handler.ts` (ändern), `external-fulfillment.ts` (ändern).

**Umsetzung:**
1. Externen Konsum **nicht** mehr an den aggregierten Status koppeln, sondern an die
   Fulfillment-Events/Delta aus [A.2](#a2): nur wenn `newlyFulfilled > 0` für mindestens eine
   Position.
2. `orders/updated` bleibt für Mirror/Tags/Financial zuständig, löst aber **keinen** Konsum mehr aus.
3. Bestehenden `externally_fulfilled`-Guard beibehalten, aber mengenscharf (A.2).

**Datenmodell:** keine zusätzlichen (nutzt A.2-Felder).

**Tests:**
- Unit: `orders/updated` ohne neues Fulfillment (nur Tag geändert) → **kein** Konsum.
- Unit: echtes `fulfillments/create` → Konsum genau der Fulfillment-Menge.

**Akzeptanzkriterien:** Kein Bestandsabzug ohne reales Fulfillment-Delta.

**Abhängigkeiten:** [A.2](#a2).

---

## A.4 — Re-Allocation bei Order-Edit (Mengenänderung) {#a4}

**Ziel:** Ändert Shopify eine Order-Menge mitten im Flow, werden Reservierungen korrekt angepasst
(Überschuss freigeben, Fehlbestand → STOP), ohne laufendes Picking zu sabotieren.

**Warum / Kontext:** `orders/edited` wird empfangen und Line-Items via GraphQL neu geladen — aber
wenn die Order bereits `SHIP`/`PICKING` mit Allocations ist, bleibt die alte Reservierungsmenge
stehen (stale). Beispiel: Order von 5→2 reduziert → 3 Stück bleiben unnötig reserviert; 2→5 erhöht →
Bestand reicht evtl. nicht mehr.

**Betroffene Dateien:**
- `webhook-handler.ts` (ändern) — nach Line-Item-Refetch Re-Allocation-Entscheidung.
- [`server/picking/release.ts`](../../apps/logistics/server/picking/release.ts) (wiederverwenden) —
  Allocations freigeben.
- [`server/allocation/enqueue.ts`](../../apps/logistics/server/allocation/enqueue.ts)
  (wiederverwenden).

**Umsetzung (fallbasiert nach `internal_status`):**
1. **SHIP**: Allocations der Order freigeben (`release`) und `enqueueAllocationRun({ triggeredBy:
   "ORDER_EDITED" })` → sauber neu allokiert (kann zu STOP kippen, wenn Bestand fehlt).
2. **PICKING**: **nicht** automatisch umallokieren (Mitarbeiter hat die Ware in der Hand). Stattdessen
   Flag `edit_pending_review = true` + Alert in Lager-UI und Admin (Job-Tray), damit Personal
   entscheidet. Nach Pack/Storno normal weiter.
3. **PACKED/CANCELLED**: ignorieren (terminal) — Mengenänderung an fertiger Order ist über
   Refund/Fulfillment-Pfad zu behandeln, nicht über Allocation.
4. **Mengenreduktion** in SHIP: nur Überschuss-Allocations freigeben (Optimierung), sonst voller
   Re-Run (einfacher, deterministisch — bevorzugt, solange Volumen klein).

**Datenmodell:** `Order.edit_pending_review: boolean`.

**Tests:**
- Unit: SHIP-Order 2→5, Bestand nur 3 → nach Edit `STOP`.
- Unit: SHIP-Order 5→2 → 3 Stück Reservierung freigegeben, Order bleibt SHIP.
- Unit: PICKING-Order editiert → `edit_pending_review`, keine automatische Umallokierung.

**Akzeptanzkriterien:** Reservierungen entsprechen nach jedem Edit den echten Order-Mengen; laufendes
Picking wird nicht überrannt.

**Abhängigkeiten:** nutzt bestehende `release`/`enqueue`.

---

## A.5 — Teil-Stornierung sauber behandeln {#a5}

**Ziel:** Eine teilweise Stornierung (in Shopify meist als Refund-mit-Restock oder als
Edit-Positionsentfernung realisiert) wird korrekt gespiegelt — nicht als Voll-Storno.

**Warum / Kontext:** `orders/cancelled` (Voll-Storno) ist behandelt. „Teil-Storno" gibt es in Shopify
nicht als eigenes Event: Es entsteht durch (a) Refund mit Restock → [A.1](#a1) oder (b) Order-Edit,
der Positionen entfernt → [A.4](#a4). Diese Task stellt sicher, dass beide Pfade zusammen den
Bestand konsistent halten und dokumentiert das Verhalten.

**Betroffene Dateien:** primär Tests + kleine Ergänzungen in `webhook-handler.ts`; nutzt A.1/A.4.

**Umsetzung:**
1. Sicherstellen: Positionsentfernung via `orders/edited` gibt Allocations der entfernten Position
   frei (A.4-Logik deckt das ab, wenn `qty → 0`).
2. Sicherstellen: „Cancel + Restock"-Refund bucht Bestand zurück (A.1).
3. Kein Doppel-Effekt, falls Shopify sowohl Edit als auch Refund schickt (Idempotenz über
   Line-Item-Deltas und Refund-ID).

**Datenmodell:** keine neuen.

**Tests:**
- Integration (gemockt): Refund-mit-Restock einer Position einer 3-Positionen-Order → nur diese
  Position zurückgebucht, Rest unberührt.
- Edge: Edit entfernt Position **und** Refund für dieselbe → Bestand steigt nur einmal.

**Akzeptanzkriterien:** Teil-Storno-Szenarien halten Bestand und Order-Zustand konsistent; keine
Doppelbuchung.

**Abhängigkeiten:** [A.1](#a1), [A.4](#a4).

---

## A.6 — Outbox- & Webhook-Event-Cleanup verdrahten {#a6}

**Ziel:** `shopify_outbox` und `webhook_events` wachsen nicht unbegrenzt; erledigte/veraltete
Einträge werden periodisch entfernt.

**Warum / Kontext:** `cleanupOutbox()` existiert in
[`outbox.ts`](../../apps/logistics/server/shopify/outbox.ts), wird aber **nirgends aufgerufen**.
`webhook_events` hat trotz PROJECT.md-Behauptung **keinen** TTL/Cleanup → beide Collections wachsen
monoton.

**Betroffene Dateien:**
- `app/api/cron/outbox-cleanup/route.ts` (neu **oder** in bestehende Reconcile-Cron einhängen).
- `server/shopify/outbox.ts` (ggf. Retention-Parameter).
- `server/shopify/webhook-events.ts` (neu/ändern) — Cleanup für alte `PROCESSED`/`FAILED`-Events.
- Firestore-TTL-Policy (Alternative): TTL-Feld + Firestore-TTL statt Cron.

**Umsetzung:**
1. Cron ruft `cleanupOutbox()` (erledigt: 2 Tage; stale/failed: 14 Tage — bestehende Konstanten
   nutzen).
2. `webhook_events`: entweder Firestore-**TTL-Policy** auf ein `expires_at`-Feld (30 Tage) —
   bevorzugt, wartungsarm — oder Cron-Löschung. TTL-Feld beim Schreiben setzen.
3. Scheduling wie bestehende Cron-Routes (siehe `docs/scheduler.md`).

**Datenmodell:** `webhook_events.expires_at` (für TTL).

**Tests:** Unit: Cleanup entfernt `done`-Outbox älter als Retention, lässt offene Retries stehen.

**Akzeptanzkriterien:** Beide Collections stabilisieren sich; offene Retries werden nie fälschlich
gelöscht.

**Abhängigkeiten:** keine.

---

## A.7 — Explizite Webhook-Reihenfolge-Absicherung (`updated_at`) {#a7}

**Ziel:** Ein älteres Order-Update kann ein neueres nicht überschreiben (Out-of-Order-Zustellung).

**Warum / Kontext:** Shopify garantiert **keine** Reihenfolge. Heute schützen nur die Status-Guards
(`PICKING/PACKED/CANCELLED` werden nicht zurückgesetzt) + Reconcile. Für die reinen Mirror-Felder
(Tags, Adresse, Financial) fehlt eine Kausalitätsprüfung.

**Betroffene Dateien:** `webhook-handler.ts` (`mirrorOrder`), `mappers.ts`, `schema.ts`.

**Umsetzung:**
1. Pro Order das zuletzt angewandte `updated_at` (bzw. `X-Shopify-Triggered-At`) speichern
   (`last_shopify_updated_at`).
2. In der Mirror-Transaktion: wenn eingehendes `updated_at < last_shopify_updated_at`, Mirror-Write
   **überspringen** (nur loggen). Status-Guards bleiben als zusätzlicher Backstop.
3. `orders/edited`-Refetch (GraphQL) darf diese Regel überstimmen, da er den kanonischen Stand holt.

**Datenmodell:** `Order.last_shopify_updated_at: Timestamp`.

**Tests:** Unit: neueres Update, danach älteres → älteres wird ignoriert; Reihenfolge egal.

**Akzeptanzkriterien:** Bei vertauschter Zustellung bleibt der neueste Shopify-Stand erhalten.

**Abhängigkeiten:** keine.

---

## A.8 — Reconciliation-Report + Admin-Sichtbarkeit {#a8}

**Ziel:** Drift, die der Reconcile-Sweep findet und behebt, wird sichtbar (Report + Admin-Ansicht +
Job-Tray-Hinweis bei Anomalien).

**Warum / Kontext:**
[`reconcile/stuck-orders.ts`](../../apps/logistics/server/reconcile/stuck-orders.ts) korrigiert
still im Hintergrund. Für „beste Lagersoftware" braucht der Admin Transparenz: Was wurde korrigiert,
welche Bestandsvarianz gibt es zu Shopify, wie viele stale Outbox-Einträge etc.

**Betroffene Dateien:**
- `server/reconcile/report.ts` (neu) — Report-Aggregation.
- `reconcile/stuck-orders.ts` (ändern) — Report-Doc schreiben.
- `app/admin/reconcile/page.tsx` (neu) **oder** Erweiterung der Health-Settings-Seite.
- `schema.ts` — `reconcile_reports`-Collection.

**Umsetzung:**
1. Jeder Reconcile-Lauf schreibt ein Report-Doc: `{ ran_at, stuck_orders_fixed, tag_drift_fixed,
   expired_batches, stale_outbox, inventory_variance_vs_shopify }`.
2. **Bestandsvarianz** stichprobenartig gegen Shopify (bestehende Inventory-Query nutzen), nicht
   jede Variante jeden Lauf (Rate-Limit-schonend).
3. Admin-Ansicht: Liste der letzten Reports + Detail; bei Anomalie über Schwellwert
   `dispatchAdminJobError` in die Job-Tray.

**Datenmodell:** `reconcile_reports/{id}`.

**Tests:** Unit: seeded Drift (falscher Tag) → Report listet `tag_drift_fixed >= 1`.

**Akzeptanzkriterien:** Admin sieht pro Reconcile-Lauf, was gefunden/behoben wurde; Anomalien landen
in der Job-Tray.

**Abhängigkeiten:** profitiert von [A.6](#a6) (stale-Outbox-Zählung).
