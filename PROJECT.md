# Monolith Lager

Interne Kommissionierungs- und Chargenführungs-App für **Ikrinka / Monolith Caviar**. Sitzt zwischen Shopify (Bestellungs- und Bestands-Master) und dem physischen Lager (Picking, Packing, Versand).

---

## 1. Warum

Kaviar und Fisch sind Charge- und MHD-pflichtig. Shopify kann das nicht abbilden. Wir brauchen:

- **Chargenführung** mit MHD je Variante
- **Intelligente Allocation**: bei knappem Bestand möglichst viele Orders fulfillen, statt chronologisch abzuarbeiten (siehe Beispiel-Szenario unten)
- **FEFO-Picklisten**: älteste MHD zuerst, transparente Chargenzuweisung
- **Express-Vorrang** für `EXPRESS_DHL`-Orders
- **All-or-nothing** pro Order (Teilfulfillment ist ausgeschlossen)
- **Packing-Slips** mit Chargennummern pro Line Item
- Tag-Rückmeldung (`SHIP`/`STOP`) und Fulfillment-Push an Shopify

Später: DHL- und DHL-Express-Etiketten direkt aus der App.

### Allocation-Beispiel (vom Kunden)

Bestand: Black Cod 10 Stk (Charge 0001:5, 0002:5), Dorschrogen 5 Stk (Charge 0003:5).
Orders: #1001 BC 4 · #1002 BC 6 + DR 1 · #1003 DR 3 · #1004 BC 5 · #1005 BC 2 + DR 4 · #1006 DR 2.

Naive Reihenfolge fulfillt 3 Orders, optimal sind **4** (#1001, #1003, #1004, #1006). Unsere Heuristik findet das ([server/allocation/runAllocation.ts](server/allocation/runAllocation.ts), [Test](server/allocation/runAllocation.test.ts)).

---

## 2. Architektur

| | |
|---|---|
| Frontend/Backend | Next.js 16 (App Router) + TypeScript + Tailwind 4 |
| DB | Firestore (default-deny rules, alle Writes über Admin SDK) |
| Auth | Firebase Auth, Rollen `ADMIN` / `LAGER` (Custom Claims) |
| Hosting | Firebase Hosting (App), Cloud Functions Gen 2 (Webhooks/Allocation) |
| Async | Cloud Tasks Queue `allocation-runs` (concurrency=1, deterministisch) |
| Shopify | Custom Distribution App, OAuth-Callback (`/api/shopify/callback`) holt Offline-Token → Firestore. Webhooks signiert mit App-Client-Secret. |
| Tests | Vitest + fast-check (property-based) |

### Datenmodell (Firestore)

```
products/{id}              Stammdaten aus Shopify
variants/{id}              Stammdaten + on_hand_total/reserved_total/available
batches/{id}               Charge: variant_id, charge_number, expiry_date, remaining_qty
orders/{id}                Order-Mirror + internal_status (NEW|SHIP|STOP|PICKING|PACKED|CANCELLED)
allocations/{id}           order_id × batch_id × line_item_id × qty (append-only)
inventory_movements/{id}   Audit: INBOUND|RESERVE|RELEASE|CONSUME|ADJUSTMENT|EXTERNAL_DRIFT
allocation_runs/{id}       Run-Metadata + Stats
webhook_events/{id}        Shopify-Webhook-Dedup (TTL 30d)
shopify_outbox/{id}        Retry-Queue für ausgehende Mutations
users/{uid}                role + email
config/shopify_meta        shop_domain, location_gid, api_version
config/shopify_token       access_token, scope, installed_at (aus OAuth)
```

### Allocation-Algorithmus (M5)

Zwei Phasen + optionaler Swap (M10):
1. **Phase A** — alle `EXPRESS_DHL`-Orders nach `created_at ASC`, hard greedy.
2. **Phase B** — Rest sortiert nach `totalDemand ASC`, dann `created_at ASC`, greedy.
3. **Phase C (M10)** — 1:1 / 1:2 Swap-Optimierung, deadline 2s, deterministisch.

Innerhalb einer SHIP-Entscheidung: FEFO über `batches.where(variant=X, status=ACTIVE).orderBy(expiry_date ASC, charge_number ASC)`. Deterministisch.

---

## 3. Implementation Status

### ✅ Fertig

| Milestone | Bereich | Wesentliche Dateien |
|---|---|---|
| M1 | Foundation: Next.js + Firebase + Auth-Rollen, Setup-Flow für ersten Admin | [proxy.ts](proxy.ts), [lib/auth/session.ts](lib/auth/session.ts), [app/setup/page.tsx](app/setup/page.tsx) |
| M2 | Shopify-Webhook-Empfang (HMAC, Dedup, Topic-Dispatch) + Outbound-Mutations (`tagsAdd`, `fulfillmentCreate`, `inventorySetOnHandQuantities`, `webhookSubscriptionCreate`) | [app/api/webhooks/shopify/route.ts](app/api/webhooks/shopify/route.ts), [server/shopify/](server/shopify/) |
| M2.5/M12 | Shopify OAuth (Custom Distribution): Single-Endpoint Callback, App-URL-Hit + OAuth-Code in derselben Route, Token in Firestore | [app/api/shopify/callback/route.ts](app/api/shopify/callback/route.ts), [server/shopify/auth.ts](server/shopify/auth.ts) |
| M3 | Products/Variants Sync, Location-Resolver | [server/shopify/queries.ts](server/shopify/queries.ts), [server/shopify/sync.ts](server/shopify/sync.ts), [app/admin/products/](app/admin/products/) |
| M3+ | **Orders-Backfill** (existing Orders aus Shopify pullen — Webhooks decken nur neue ab) | [server/shopify/sync-orders.ts](server/shopify/sync-orders.ts), Settings-Page |
| M4 | Wareneingang-UI (Admin): Charge + MHD + Qty, transactional batch + audit + Re-Allocation-Trigger | [server/inventory/receive.ts](server/inventory/receive.ts), [app/admin/batches/](app/admin/batches/) |
| M5 | Allocation-Kern (FEFO + Express + Greedy) + Customer-Szenario-Test + Property-Tests | [server/allocation/runAllocation.ts](server/allocation/runAllocation.ts), [runAllocation.test.ts](server/allocation/runAllocation.test.ts) |
| M6 | Firestore-Wrapper für Allocation, Cloud-Tasks-Enqueue mit Inline-Fallback, OIDC-Endpoint, Outbox-Drain, Admin-Settings + Orders-Page | [server/allocation/run.ts](server/allocation/run.ts), [server/allocation/enqueue.ts](server/allocation/enqueue.ts), [app/api/internal/allocation/run/route.ts](app/api/internal/allocation/run/route.ts), [server/shopify/outbox.ts](server/shopify/outbox.ts) |

Aktueller Run-State: 6 Orders gespiegelt (3 SHIP, 3 STOP), 3 Allocations geschrieben, 4 Batches im Lager. End-to-End läuft.

### 🚧 Offen — nach Priorität

1. **M7 — Picking/Packing-Workflow (Lager-Seite).** Größter offener Block, macht die App tatsächlich benutzbar fürs Lagerpersonal. Detailplan unten.
2. **M8 — Packing Slip PDF** mit Chargennummern. Voraussetzung für M7.3.
3. **M9 — Scheduled Reconcile + Outbox-Retry.** Geht über Cloud Functions Scheduler. Sicherheitsnetz, kein Funktions-Blocker.
4. **M10 — Phase-C Swap Local Search.** Allocation-Optimierung. Nice-to-have.
5. **Später** — DHL- und DHL-Express-Etiketten, Barcode-Scanner für Wareneingang & Picking.

---

## 4. M7 — Picking/Packing-Workflow (detaillierter Plan)

### 4.1 Status-Erweiterung

`OrderInternalStatus` bekommt einen zusätzlichen Wert: **`PICKING`**. Das ist der Zustand "ein Mitarbeiter hat die Order in der Hand". Allocation-Run **darf PICKING-Orders nicht anfassen** — sonst könnte ihm die Charge zwischen den Fingern wegrutschen.

State-Machine:

```
              ┌─────────── new Shopify order webhook
              ▼
            NEW ─────── Allocation-Run ───────► SHIP   (Bestand reicht, Reservierungen geschrieben)
                                          └──► STOP   (kein Bestand; bei nächstem Wareneingang wird re-evaluiert)

         SHIP ──"Picking starten"──► PICKING ──"Verpackt"──► PACKED  ✱
                                          │
                                          └──"Abbrechen"──► SHIP (Reservierungen bleiben)

         STOP ◄────── Allocation-Run ──── new INBOUND/Cancel
         SHIP ◄────── Allocation-Run ──── new INBOUND (möglich, falls zwei STOPs zusammen besser passen)

         *PACKED + CANCELLED sind terminal — niemals zurück.
```

Allocation-Filter: `internal_status in (NEW, SHIP, STOP)` — `PICKING`, `PACKED`, `CANCELLED` werden ignoriert.

**Files:**
- [server/firestore/schema.ts](server/firestore/schema.ts) — `OrderInternalStatusSchema` erweitern: `["NEW","SHIP","STOP","PICKING","PACKED","CANCELLED"]`.
- [server/allocation/run.ts](server/allocation/run.ts) — `ORDER_STATUSES_TO_REALLOCATE` bleibt wie ist (`["NEW","SHIP","STOP"]`); PICKING wird automatisch übersprungen.

### 4.2 Server-Actions

Drei atomare Transitionen, alle als Server-Actions in [server/picking/](server/picking/):

**`startPicking(orderId, user)`**
- Tx: read order → wenn `internal_status === "SHIP"` setze auf `PICKING`, sonst Fehler `not_shippable`
- Audit: log
- Kein Allocation-Trigger nötig.

**`cancelPicking(orderId, user)`**
- Tx: read order → wenn `internal_status === "PICKING"` zurück auf `SHIP`, sonst Fehler
- Audit: log

**`confirmPacking(orderId, user, tracking?)`**
- Eine Firestore-Transaction:
  1. read order → muss `PICKING` sein
  2. read alle `allocations.where(order_id=X, consumed_at=null)`
  3. für jede allocation:
     - `batches/{batch_id}.remaining_qty -= alloc.qty`
     - `batches.status = "DEPLETED"` falls `remaining_qty === 0`
     - `allocations/{a}.consumed_at = serverTimestamp`
  4. für jede variant der order:
     - `variants/{v}.on_hand_total -= consumedQty`
     - `variants/{v}.reserved_total -= consumedQty`
     - `available` recompute
  5. `orders/{order_id}.internal_status = "PACKED"`, plus optional `fulfillment_tracking`-Feld
- Außerhalb der Tx (best-effort, idempotent via Outbox):
  - `inventory_movements` CONSUME entries (eine pro batch)
  - Outbox: `FULFILLMENT_CREATE` mit tracking-Daten
  - Outbox: `INVENTORY_SET` mit neuem `available` an Shopify
  - Outbox: `TAGS_ADD ["LAGER_PACKED"]`, `TAGS_REMOVE ["LAGER_SHIP"]`
  - `enqueueAllocationRun({ triggeredBy: "PACKING_DONE" })` — andere STOP-Orders könnten jetzt SHIP werden? (eher nein, weil Bestand wurde nur konsumiert, nicht erhöht; aber harmless als Sicherheitsnetz)

### 4.3 UI-Routes

**Picking-Queue** — `/lager/picking/page.tsx`
- Tabelle: alle Orders mit `internal_status in ("SHIP","PICKING")`, sortiert: Express zuerst, dann nach `created_at ASC`
- Spalten: Order-Nr · Tags (mit Express-Highlight) · Items-Count · Stadt · Status-Badge · Action
- Action: "Picken starten" → server action `startPicking` → redirect zu `/lager/picking/[orderId]`
- Wer schon PICKING ist: Button "Weiter packen" → direkt zum Pack-Screen

**Picking-Detail** — `/lager/picking/[orderId]/page.tsx`
- Header: Order-Nr, Lieferadresse (knapp), Anzahl Items
- Tabelle pro Line Item:
  - SKU, Titel, Variant, **Menge**
  - Pro Allocation eine Sub-Zeile: **Chargennummer** + **MHD** + **Stk aus dieser Charge** + **Lagerort** (falls/wenn vorhanden — sonst leer)
- Tabelle ist FEFO sortiert (so wie der Mitarbeiter die Chargen aus dem Regal nehmen soll)
- "Druckbare Picklist" Button → öffnet `/lager/picking/[orderId]/print` (Single-Column-Layout, schwarz auf weiß, große Schrift, optimiert für DIN A5 oder A4)
- "Picking abgeschlossen — weiter zum Packen" → `/lager/packing/[orderId]`
- "Picken abbrechen" → `cancelPicking` → zurück zur Queue
- Optional: Pro Allocation-Zeile Checkbox "✓ entnommen" mit Persistierung in `sessionStorage` (kein Backend-State, nur visuelle Selbstkontrolle für den Mitarbeiter)

**Packing** — `/lager/packing/[orderId]/page.tsx`
- Header: Order-Nr, Status: PICKING
- Lieferadresse groß und kopierbar
- Items-Übersicht (knapper als Picking-Detail)
- "**Packing Slip drucken**" (M8) → öffnet PDF in neuem Tab
- Optionales Tracking-Feld (DHL Tracking-Nr, später automatisch aus DHL-API)
- "**Verpackt + versendet**" — Hauptbutton, ruft `confirmPacking`
  - Optimistic UI: Button → "Wird gebucht…" → Erfolgs-Toast → Redirect zur Queue
  - Bei Fehler (z.B. Charge inzwischen leer wegen Konkurrenz): rote Box mit Erklärung, Re-Allocation-Hinweis

### 4.4 Admin-Order-Detail

**`/admin/orders/[id]/page.tsx`** — read-only Detail-View für Admin-Debugging
- alle Order-Felder
- allocations (mit Charge + Batch-Link)
- inventory_movements gefiltert auf diese Order
- allocation_run history
- Knopf "Status zurücksetzen" (nur ADMIN) für Notfälle

### 4.5 Schritt-für-Schritt-Plan

1. Schema: `PICKING` Status hinzufügen, Test laufen lassen.
2. `server/picking/transitions.ts` — drei Tx-Functions (`startPicking`, `cancelPicking`, `confirmPacking`).
3. Server Actions in `app/lager/picking/actions.ts` und `app/lager/packing/actions.ts`.
4. Routes anlegen: `/lager/picking`, `/lager/picking/[orderId]`, `/lager/packing/[orderId]`.
5. `/lager/picking/[orderId]/print/page.tsx` — Druckansicht (HTML, `window.print()`).
6. **M8** — Packing-Slip-PDF mit react-pdf parallel oder direkt anschließend.
7. `/admin/orders/[id]/page.tsx` — Debug-View.
8. End-to-End-Smoke: Echte Order picken → packen → Shopify-Fulfillment-Status prüfen → `batches.remaining_qty` validieren → `inventory_movements` durchschauen.

### 4.6 Tests

- Unit: `confirmPacking` mit gemockter Tx — Bestand wird korrekt abgezogen, allocations konsumiert, idempotent.
- Property: keine `batches.remaining_qty < 0` nach beliebiger Pack-Reihenfolge.
- Integration (manuell): `roman@shrymp-commerce.com` → SHIP-Order → Picking starten → Packing-Slip drucken → Bestätigen → Shopify zeigt Fulfilled + reduzierte Inventory-Menge.

---

## 5. M8 — Packing Slip PDF (kurz)

`server/pdf/packingSlip.tsx` mit `@react-pdf/renderer`. Renderer als API-Route oder Server Component:
- Briefkopf mit Logo
- Lieferadresse (zum Aufkleben formatiert)
- Order-Nr, Datum
- Tabelle: Produkttitel + Variant + Menge + Chargennummer + MHD
- Footer: "Vielen Dank für Ihre Bestellung", Kontakt
- Aufruf: `/api/lager/packing/[orderId]/slip.pdf` (Route Handler, streamed PDF)

---

## 6. M9 — Reconcile + Outbox-Retry (kurz)

Zwei Cloud-Functions-Scheduler-Jobs (`firebase functions:config:set`):

- **`outboxRetry`** — alle 5 min: `processOutbox(100)`. Outbox-Drain läuft schon nach jedem Allocation-Run inline, aber als Sicherheitsnetz für Fälle wo Shopify mal nicht erreichbar war.
- **`nightlyReconcile`** — täglich 03:00 UTC: `backfillOrders({query:"updated_at:>=<24h ago>"})`. Fängt verpasste Webhooks ab.

---

## 7. M10 — Phase-C Swap Local Search

Optionale Allocation-Verbesserung. 1:1 und 1:2 Swap-Versuche: kann ein STOP-Order durch Verzicht auf einen anderen SHIP-Order zu zwei SHIPs werden? Wallclock 2s, fixe Iterationsreihenfolge → bleibt deterministisch. Erwarteter Gewinn: 5-10 % mehr SHIPs bei knappem Bestand. Wartet bis das Tag-Volumen dafür groß genug ist, dass sich die Komplexität lohnt.

---

## 8. Operating Manual

### Einmaliges Setup

1. **Firebase-Projekt** anlegen, Firestore-DB in `europe-west3`, Email/Password-Provider aktivieren.
2. **`.env.local`** aus `.env.local.example` befüllen — Firebase-Client-Config, `FIREBASE_SERVICE_ACCOUNT_JSON` (single-quoted!), `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`, `APP_BASE_URL`.
3. **Deploy**, App muss unter `APP_BASE_URL` öffentlich erreichbar sein.
4. Browser auf `/` → `/setup` → ersten Admin anlegen.
5. **Shopify Partner Dashboard** → App-Konfiguration: App URL und Allowed redirection URL beide = `<APP_BASE_URL>/api/shopify/callback`.
6. Install-Link aus dem Partner Dashboard im Browser öffnen → Shopify-Consent → Token wird automatisch in Firestore gespeichert.
7. Login → `/admin/settings`:
   - "Webhooks registrieren" klicken.
   - `/admin/products` → "Jetzt synchronisieren" → Produkte + Variants laden.
   - Zurück zu `/admin/settings` → "Existierende Orders nachladen" (Backfill) → bestehende Orders kommen rein.

### Täglicher Lager-Workflow (nach M7)

1. Mitarbeiter:in loggt sich ein → landet auf `/lager/picking`.
2. Sieht die SHIP-Queue (Express oben).
3. "Picken starten" → Picklist erscheint mit FEFO-Chargen.
4. Picklist drucken (oder am Tablet abhaken).
5. Items aus dem Regal nehmen, in den Pack-Bereich.
6. Im Pack-Bereich `/lager/packing/[orderId]` öffnen → Packing-Slip drucken.
7. Verpacken, Label auflicken (DHL kommt später aus der App).
8. "Verpackt + versendet" → Order ist PACKED, Bestand atomar gebucht, Shopify-Fulfillment + Inventory-Push laufen.

### Wareneingang (Admin)

1. `/admin/batches` → neue Charge mit MHD + Menge erfassen.
2. Automatisch: INBOUND-Movement geschrieben, `variants.on_hand_total` erhöht, Allocation-Run getriggert → STOP-Orders die jetzt passen werden zu SHIP, neue Tags an Shopify gepusht.

### Notfälle

- **STOP-Order bleibt trotz Wareneingang STOP** → Backfill nochmal triggern, dann manuell "Allocation manuell starten" im Settings.
- **Order in Shopify storniert, aber bei uns noch SHIP** → `orders/cancelled` Webhook sollte's fangen; falls nicht, nächtlicher Reconcile-Job (M9) holt's nach.
- **Bestandsdrift** (jemand ändert Inventory direkt in Shopify) → `INVENTORY_LEVELS_UPDATE`-Webhook loggt's als `EXTERNAL_DRIFT`-Movement. Admin entscheidet manuell, ob er den Drift übernimmt oder gegenpusht.

---

## 9. Verification & Commands

```bash
pnpm dev                  # Next.js dev server
pnpm build                # production build (incl. type generation)
pnpm typecheck            # tsc --noEmit
pnpm lint                 # ESLint
pnpm test                 # Vitest (Allocation + Schemas + HMAC + Mappers)
pnpm emulators            # Firebase Emulators (auth, firestore, functions)
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

Tests: aktuell 33 grün, davon allein 12 für die Allocation (Customer-Szenario + Properties).
