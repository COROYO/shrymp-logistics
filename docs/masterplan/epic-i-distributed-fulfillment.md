# Epic I — Verteiltes Fulfillment: Multi-Warehouse, Split, 3PL

**Epic-Ziel:** Bestellungen über mehrere Lager und externe Fulfillment-Partner (3PL) hinweg abwickeln —
inkl. automatischer **Split-Bestellungen** und regelbasiertem Order-Routing.

**Kontext (verifiziert):** Das Fundament ist **teilweise** da: `LocationSchema` + `variant_location_stock`
(Bestand je Standort) existieren, Bestand wird pro Standort zu Shopify gepusht/gezogen. **Aber**: Die
Allocation ist **location-blind** (reserviert nur auf Varianten-Ebene), es gibt **kein** Split, **kein**
3PL-Modell (nur Erkennung von Shopify-seitigem External-Fulfillment). Diese Epic ersetzt/erweitert die
Platzhalter-Task [E.6 Multi-Warehouse](epic-e-wms.md#e6).

**Machbarkeit (Recherche):** OMS-Standard ist regelbasiertes Routing zum „besten Knoten" (Nähe/Kosten/
Bestand) mit Auto-Split und Label-Push. **Amazon MCF** kann sogar Nicht-Amazon-Orders aus FBA-Bestand
fulfillen — ein sofort nutzbarer 3PL-Kanal.

---

## I.1 — Standort-bewusste Allocation {#i1}

**Ziel:** Die Allocation reserviert und entscheidet je **Standort**; die Quelle einer Order wird nach
Regeln gewählt. Löst [E.6](epic-e-wms.md#e6) ab.

**Warum / Kontext:** Ohne Standortdimension kann nichts sinnvoll gesplittet oder geroutet werden. Der
Kern-Determinismus muss erhalten bleiben.

**Betroffene Dateien:**
- `server/allocation/runAllocation.ts` + `run.ts` (umfangreich ändern) — Reservierung je
  `(variant, location)`.
- `server/allocation/types.ts` (ändern) — Standort im Snapshot.
- `server/locations/stock.ts` (wiederverwenden) — Per-Location-Bestand.

**Umsetzung:**
1. Snapshot enthält Bestand je `(variant, location)`; `reserved_total` wird je Standort geführt.
2. **Quellwahl** je Order per Routing-Regel ([I.4](#i4)): bevorzugter Standort, Nähe, Bestand, MHD.
3. **Determinismus**: fixe Sortierung/Tiebreak je Standort; Property-Tests gegen Über-Reservierung je
   Standort.
4. Rückwärtskompatibel: Ein-Standort-Betrieb verhält sich exakt wie heute.

**Datenmodell:** Reservierung je Standort (Feld/Sub-Collection); `order.fulfillment_location_id`.

**Tests:** Property: kein Standort über-reserviert; Determinismus pro Snapshot; Ein-Standort ==
heutiges Verhalten.

**Akzeptanzkriterien:** Orders werden einem Standort mit ausreichend Bestand zugewiesen; Invarianten je
Standort gewahrt.

**Abhängigkeiten:** berührt Allocation-Kern; idealerweise nach [Epic A](epic-a-sync-hardening.md).

---

## I.2 — Split-Shipments (merchant-konfigurierbare Policy) {#i2}

**Ziel:** Der Merchant stellt pro Shop (optional je Channel) ein, **wie** mit Bestellungen umgegangen
wird, die nicht vollständig aus einem Knoten lieferbar sind — über eine klare, einstellbare Split-Policy.

**Warum / Kontext:** Explizit gewünscht: „die Split-Bestellungen müssen einstellbar sein für den Kunden".
Split ist ein bewusster Eingriff in die bisherige **All-or-nothing-pro-Order**-Invariante und darf nie
stillschweigend passieren — deshalb eine Einstellung mit sicherem Default.

**Split-Policy (einstellbar durch den Merchant):**
- **`NO_SPLIT` (Default):** Eine Order wird **nie** gesplittet — sie geht komplett aus **einem** Knoten
  raus. Ist nichts vollständig verfügbar, bleibt sie STOP/warten (heutiges Verhalten; auch nötig für
  Marktplätze, die keine Teil-Sendungen erlauben).
- **`SPLIT_MULTI_WAREHOUSE`:** **Multi-Paket über mehrere Lager** — verfügbare Positionen werden von den
  Knoten versandt, an denen sie liegen (mehrere Teil-Sendungen je Order).
- **`SHIP_WHEN_AVAILABLE`:** aus **einem Lager, sobald das Produkt da ist** — verfügbare Positionen jetzt
  versenden (Multi-Paket über die Zeit), Restpositionen folgen beim nächsten Wareneingang.

**Betroffene Dateien:**
- `server/firestore/schema.ts` — `shop.split_policy` (+ optional `channel.split_policy`-Override).
- `app/admin/settings/…` (neu) — Policy-Einstellung im Admin.
- `server/fulfillment/split.ts` (neu) — setzt die gewählte Policy um.
- `server/picking/*` (ändern) — Teil-Picking/-Packing je Split; Shopify: mehrere **FulfillmentOrders**.

**Umsetzung:**
1. **Policy lesen** (Channel-Override vor Shop-Default). Bei `NO_SPLIT` bleibt der bestehende
   All-or-nothing-Pfad **unverändert** (kein Risiko am Kern).
2. **`SPLIT_MULTI_WAREHOUSE`:** Positionen nach Bestand auf Knoten aufteilen ([I.1](#i1)/[I.4](#i4)); je
   Teil ein eigener Pick/Pack + Label; Fulfillment/Tracking je Teil kanalneutral zurückmelden.
3. **`SHIP_WHEN_AVAILABLE`:** verfügbaren Teil aus einem Knoten sofort versenden, Restpositionen offen
   halten und bei Wareneingang re-allokieren/nachversenden.
4. **Konsistenz** mit [A.2](epic-a-sync-hardening.md#a2): Bestand nur je tatsächlich versandter Position;
   kein Doppelversand.
5. **Channel-Guard:** Marktplätze, die keine Teil-Sendungen zulassen, erzwingen effektiv `NO_SPLIT`
   (Override), unabhängig vom Shop-Default.

**Datenmodell:** `shop.split_policy` (Enum `NO_SPLIT|SPLIT_MULTI_WAREHOUSE|SHIP_WHEN_AVAILABLE`, Default
`NO_SPLIT`); optional `channel.split_policy`; `order.splits[]`/`fulfillment_groups`.

**Tests:** Property: `NO_SPLIT` verhält sich **exakt** wie das heutige All-or-nothing; Summe der
Split-Mengen == Order-Menge; kein Doppelversand. Unit: je Policy das erwartete Ergebnis; Channel-Override
erzwingt `NO_SPLIT`.

**Akzeptanzkriterien:** Der Merchant kann die Split-Policy einstellen; jeder Modus verhält sich wie
spezifiziert; Default `NO_SPLIT` ändert nichts am heutigen Verhalten.

**Abhängigkeiten:** [I.1](#i1), [A.2](epic-a-sync-hardening.md#a2); Channel-Info aus
[G.1](epic-g-multichannel.md#g1).

---

## I.3 — 3PL-/Fulfillment-Partner-Modell {#i3}

**Ziel:** Externe Lager/3PLs als erstklassige Fulfillment-Knoten modellieren.

**Warum / Kontext:** Heute kein 3PL-Modell. Wir brauchen Stammdaten + Fähigkeiten je Partner.

**Betroffene Dateien:**
- `server/firestore/schema.ts` (ändern) — `fulfillment_partners`.
- `server/fulfillment/partners/` (neu) — Partner-Registry + Connector-Interface.

**Umsetzung:**
1. **`fulfillment_partners/{id}`**: `name`, `type` (3PL|EXTERNAL_WAREHOUSE|AMAZON_MCF), `credentials_ref`,
   `capabilities` (Carrier, Länder, SLA, Gebühren), `endpoint`, `status`.
2. **Connector-Interface** analog [G.2](epic-g-multichannel.md#g2): `pushOrder`, `pullStatus`,
   `pullInventory`/`onInventoryWebhook`, `pushInventory?`.
3. Behandlung als „Standort" in der Allocation ([I.1](#i1)), aber ohne eigenes Picking bei uns.

**Datenmodell:** `fulfillment_partners`-Collection.

**Tests:** Unit: Partner-Registry; Capability-Matching (kann Partner Land/Carrier X?).

**Akzeptanzkriterien:** Ein 3PL ist als Knoten anlegbar und in Routing/Allocation berücksichtigt.

**Abhängigkeiten:** [I.1](#i1).

---

## I.4 — Order-Routing-Engine {#i4}

**Ziel:** Regelbasiert entscheiden, welcher Knoten (eigenes Lager / 3PL / MCF) eine Order oder
Teil-Order fulfillt.

**Warum / Kontext:** Kern des verteilten Fulfillments: „bester Knoten" nach Nähe/Kosten/Bestand/SLA.
Integriert mit der Automatisierungs-Engine ([H](epic-h-automation.md)).

**Betroffene Dateien:** `server/fulfillment/routing.ts` (neu); Integration in
[H.3](epic-h-automation.md#h3) (Aktion „route to node").

**Umsetzung:**
1. Routing-Strategie je Order: Kandidatенknoten mit Bestand ermitteln → nach Kriterien (Kundennähe,
   Versandkosten, Bestand, MHD, SLA, Channel-Regeln) bewerten → Knoten/Split wählen.
2. Als **Aktion** in der Regel-Engine verfügbar (H) und als Default-Strategie konfigurierbar.
3. Deterministisch bei gleichem Snapshot.

**Datenmodell:** `routing_rules` (oder Teil von `automation_rules`); Ergebnis in
`order.fulfillment_location_id`/`splits`.

**Tests:** Unit: Routing wählt den erwarteten Knoten je Szenario; Determinismus.

**Akzeptanzkriterien:** Orders werden nach konfigurierten Kriterien dem richtigen Knoten (oder Split)
zugewiesen.

**Abhängigkeiten:** [I.1](#i1), [I.3](#i3), [H.3](epic-h-automation.md#h3).

---

## I.5 — 3PL-Order-Push + Status-Rückkanal {#i5}

**Ziel:** Georoutete Orders an den 3PL/MCF übergeben und Status/Tracking zurücknehmen.

**Warum / Kontext:** Ohne Push/Status ist ein 3PL nur Deko. Amazon MCF als erster konkreter Partner.

**Betroffene Dateien:** `server/fulfillment/partners/<type>/` (neu, je Partnertyp); Outbox-Muster
wiederverwenden.

**Umsetzung:**
1. **Push**: Order an Partner-Endpoint (idempotent, Outbox/Retry wie Shopify).
2. **Status-Rückkanal**: Webhook oder Polling → Fulfillment/Tracking übernehmen, Order intern auf
   PACKED/versandt setzen, Tracking an den Verkaufskanal zurückspiegeln.
3. **Amazon MCF**: SP-API Fulfillment-Outbound (fulfillt Nicht-Amazon-Orders aus FBA-Bestand).

**Datenmodell:** `order.fulfillment_partner_id`, `channel_data`-analoge Partner-Refs.

**Tests:** Unit: Push idempotent; Status-Übernahme setzt korrekten internen Zustand.

**Akzeptanzkriterien:** Eine an einen 3PL geroutete Order wird dort beauftragt und ihr Versandstatus/
Tracking kommt korrekt zurück in System und Verkaufskanal.

**Abhängigkeiten:** [I.3](#i3), [I.4](#i4), [A.2](epic-a-sync-hardening.md#a2).

---

## I.6 — 3PL-Bestandsabgleich {#i6}

**Ziel:** Bestände externer Lager sichtbar und synchron halten.

**Warum / Kontext:** Routing/Oversell-Schutz brauchen den realen Bestand am 3PL.

**Betroffene Dateien:** `server/fulfillment/partners/inventory-sync.ts` (neu).

**Umsetzung:** Bestand je Partner pullen (Webhook/Polling), als Per-Location-Bestand führen; in den
Fan-out ([G.2](epic-g-multichannel.md#g2)) und die Allocation einbeziehen; Drift protokollieren.

**Datenmodell:** `variant_location_stock` mit Partner-Standorten.

**Tests:** Unit: Partner-Bestand fließt in Verfügbarkeit; Drift wird geloggt.

**Akzeptanzkriterien:** 3PL-Bestand ist im System sichtbar und beeinflusst Routing/Verfügbarkeit korrekt.

**Abhängigkeiten:** [I.3](#i3).

---

## I.7 — Per-Standort-Picking-Queues {#i7}

**Ziel:** Lagerpersonal sieht nur die Orders seines Standorts.

**Warum / Kontext:** Bei mehreren eigenen Lagern müssen die Picking-Queues standortgetrennt sein.

**Betroffene Dateien:** `app/lager/picking/` (ändern) — Standortfilter; Standort aus User/Session.

**Umsetzung:** Queue nach `order.fulfillment_location_id` filtern; Standortwahl je Nutzer/Station;
Cluster-Picking je Standort.

**Datenmodell:** optional `user.location_id`.

**Tests:** Unit: Queue zeigt nur Orders des gewählten Standorts.

**Akzeptanzkriterien:** Picker sehen und bearbeiten nur die Orders ihres Standorts.

**Abhängigkeiten:** [I.1](#i1).
