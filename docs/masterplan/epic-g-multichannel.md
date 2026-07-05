# Epic G — Multichannel-OMS: Marktplätze & Shops zentral

**Epic-Ziel:** Aus der Shopify-Lager-App eine **kanalunabhängige** Order-Management-Plattform machen und
alle relevanten Verkaufskanäle zentral anbinden: Amazon, eBay, Kaufland, Otto, WooCommerce — und, so
weit machbar, Temu/Metro/Hood. Ein Bestand, viele Kanäle, ohne Overselling.

**Kontext (verifiziert):** Heute ist **alles Shopify-gekoppelt**. `OrderSchema` enthält
`shopify_gid`, `shopify_financial_status`, `shopify_fulfillment_status`; Order-Pull läuft über
`server/shopify/sync-orders.ts`, Events nur über Shopify-Webhooks. Es gibt **keine** Channel-Ebene.
Das Fundament (Outbox, Webhook-Dedup, Status-Guards, Reconcile) ist aber generisch genug, um es hinter
eine Connector-Abstraktion zu heben.

**Machbarkeit je Marktplatz (Recherche):**
- **Amazon SP-API**, **eBay Sell API**, **Kaufland Seller API**, **Otto Market API**, **WooCommerce REST
  API** = offiziell, REST, gut integrierbar (Otto mit Sandbox + offiziellem SDK).
- **Temu/Metro/Hood** = aktuell **kein** durchgängig offener, dokumentierter Seller-API-Zugang.

**Grundsatz (Entscheidung): keine API → keine Anbindung.** Ein Marktplatz wird nur angebunden, wenn er
eine offizielle Seller-API bereitstellt. **Keine** Aggregatoren (API2Cart/M2E) und **keine**
CSV-Workarounds — sie bringen Kosten, Abhängigkeit und Fragilität ohne echte Kontrolle.

**Architektur-Leitplanke:** Shopify wird der **erste Connector** einer generischen Schnittstelle, nicht
der Sonderfall. Nichts Kanalspezifisches außerhalb eines Adapters.

---

## G.1 — Channel-Abstraktion / Order-Modell entkoppeln {#g1}

**Ziel:** Ein kanalneutrales Order- und Produkt-Datenmodell plus ein `channels`-Register; Shopify wird
zu einem Adapter dahinter.

**Warum / Kontext:** Ohne diese Abstraktion multipliziert jeder neue Marktplatz den Shopify-Spezialcode.
Dies ist das **Fundament** für G, H, I, K, M und muss zuerst kommen.

**Betroffene Dateien:**
- `server/firestore/schema.ts` (ändern) — `channels`-Collection; Order/Product um `channel_id` +
  generische `external_ref` erweitern; `shopify_*`-Felder in eine `channel_data`-Struktur kapseln
  (Shopify-Werte bleiben, aber als Channel-Daten, nicht als Top-Level-Wahrheit).
- `server/channels/` (neu) — Channel-Registry + gemeinsame Typen.
- `server/shopify/*` (refactor) — hinter den Connector-Vertrag (G.2) schieben, ohne Verhalten zu ändern.
- `firestore.indexes.json` (ändern) — Indizes mit `channel_id`.

**Umsetzung:**
1. **`channels/{id}`**: `type` (SHOPIFY|AMAZON|EBAY|KAUFLAND|OTTO|WOOCOMMERCE|…), `label`,
   `credentials_ref`, `status`, `inventory_buffer`, `default_location_id`, `settings`.
2. **Order/Product** bekommen `channel_id` + `external_id` (kanalneutral). Bestehende `shopify_gid` etc.
   nach `channel_data.shopify` migrieren (Migrationsskript; abwärtskompatibel lesen).
3. **Interne Status bleiben kanalneutral** (`internal_status`, Allocation) — nur die Spiegelung
   von/zu extern läuft je Connector.
4. **Migration**: bestehende Orders/Produkte auf `channel_id = <shopify-channel>` setzen (idempotent).

**Datenmodell:** `channels`-Collection; `order.channel_id`, `order.external_id`,
`order.channel_data`; analog für Produkte/Varianten (`external_id` je Kanal, da eine Variante auf
mehreren Marktplätzen gelistet ist → `variant.channel_listings[]`).

**Tests:** Property: bestehende Shopify-Orders nach Migration unverändert verarbeitbar (Allocation/
Picking laufen wie vorher). Unit: Channel-Registry-CRUD.

**Akzeptanzkriterien:** Der komplette bestehende Shopify-Flow läuft unverändert, aber über die
Channel-Abstraktion; ein zweiter Kanal ist rein additiv anlegbar.

**Abhängigkeiten:** keine — **Fundament**, blockiert die übrigen G-Tasks. Berührt [A](epic-a-sync-hardening.md)
(Sync-Felder) → idealerweise nach Epic A, damit die Partial-Sync-Logik gleich kanalneutral ist.

---

## G.2 — Connector-Framework + Multichannel-Bestandssync {#g2}

**Ziel:** Ein einheitliches `ChannelConnector`-Interface, in das jeder Kanal einklinkt, plus zentrale
Bestandsverteilung auf alle Kanäle mit Oversell-Schutz.

**Warum / Kontext:** Jeder Connector braucht dieselben Fähigkeiten: Orders ziehen, Fulfillment/Tracking
zurückmelden, Bestand pushen, (optional) Katalog pushen, Events empfangen. Die Shopify-Outbox/Webhook-/
Sync-Bausteine werden hierfür verallgemeinert.

**Betroffene Dateien:**
- `server/channels/connector.ts` (neu) — Interface: `pullOrders`, `pushFulfillment`, `pushInventory`,
  `pushCatalog?`, `verifyWebhook?`, `handleWebhook?`.
- `server/channels/inventory-fanout.ts` (neu) — ein Bestand → viele Kanäle.
- `server/shopify/*` (refactor) — Shopify implementiert das Interface (Referenz-Connector).
- `server/shopify/outbox.ts` (verallgemeinern) — Outbox pro Kanal (op-Typen kanalspezifisch).

**Umsetzung:**
1. **Interface** definieren; Shopify als erste Implementierung (Verhalten unverändert).
2. **Outbox** um `channel_id` erweitern; Retry/Idempotenz-Muster bleibt.
3. **Bestands-Fan-out**: bei Bestandsänderung (Pack, Refund-Restock, Wareneingang) den verfügbaren
   Bestand — abzüglich `channel.inventory_buffer` — an **alle** aktiven Kanäle pushen. Oversell-Schutz:
   ein Reservierungs-/Buffer-Modell, damit paralleler Verkauf auf zwei Kanälen nicht überbucht.
4. **Konfliktregel**: welcher Kanal ist Bestands-Master (i. d. R. wir, „APP"), Kanäle sind Spiegel.

**Datenmodell:** `shopify_outbox` → generischer `channel_outbox` (oder `channel_id` ergänzen);
`channel.inventory_buffer`.

**Tests:** Property: Summe gepushter Verfügbarkeiten überschreitet nie den realen Bestand; Fan-out
idempotent. Unit: Connector-Interface-Contract-Test (Shopify).

**Akzeptanzkriterien:** Eine Bestandsänderung landet korrekt und oversell-sicher auf allen aktiven
Kanälen; neue Connectors implementieren nur das Interface.

**Abhängigkeiten:** [G.1](#g1); verzahnt mit [A.1](epic-a-sync-hardening.md#a1)/[A.2](epic-a-sync-hardening.md#a2).

---

## G.3 — Amazon-SP-API-Connector {#g3}

**Ziel:** Amazon-Bestellungen importieren, Bestand/Preise pushen, Fulfillment/Tracking zurückmelden.

**Warum / Kontext:** Größter Marktplatz, offizielle REST-**SP-API** (Orders, Listings, Inventory,
Reports). FBA/MCF (Amazon fulfillt) gehört zu [Epic I](epic-i-distributed-fulfillment.md).

**Betroffene Dateien:**
- `server/channels/amazon/` (neu) — Connector (Auth via LWA/SP-API, Orders-Pull, Fulfillment-Push,
  Inventory-Push), Mapper Amazon→kanalneutral.
- Credentials/Config in `channels/{id}` + sicherer Secret-Store.

**Umsetzung:**
1. **Auth**: SP-API (LWA-Token, rollenbasierter Zugriff). Rate-Limits/Backoff analog Shopify-Client.
2. **Orders-Pull**: periodisch (Reports/Orders-API); Mapping auf kanalneutrale Order (inkl.
   Marketplace-Gebühren/`channel_data.amazon`).
3. **Fulfillment-Push**: Versandbestätigung + Tracking an Amazon.
4. **Inventory-Push**: über den Fan-out aus [G.2](#g2).
5. **Besonderheiten**: Amazon-Adressanonymisierung, Versandfristen (SLA → [H.5](epic-h-automation.md#h5)).

**Datenmodell:** `channel_data.amazon` (order-id, marketplace-id, fee, ship-by).

**Tests:** Unit: Amazon-Order-Mapper (inkl. Steuern/Gebühren) → kanalneutral; Sandbox-Integration
(gemockt).

**Akzeptanzkriterien:** Amazon-Order erscheint im internen Flow, wird gepickt/gepackt, Tracking geht
zurück; Bestand bleibt synchron.

**Abhängigkeiten:** [G.1](#g1), [G.2](#g2).

---

## G.4 — eBay-Sell-API-Connector {#g4}

**Ziel:** eBay-Bestellungen, -Bestand und -Fulfillment über die Sell-APIs anbinden.

**Warum / Kontext:** Offizielle REST **Sell APIs** (Inventory API, Fulfillment/Order API), OAuth.

**Betroffene Dateien:** `server/channels/ebay/` (neu) — Connector + Mapper.

**Umsetzung:**
1. **OAuth** (User-Consent + Refresh). 2. **Orders** über Fulfillment-API ziehen → kanalneutral.
3. **Fulfillment/Tracking** zurückmelden. 4. **Inventory** via Fan-out. 5. Listings optional (später).

**Datenmodell:** `channel_data.ebay`.

**Tests:** Unit: eBay-Order-Mapper; OAuth-Refresh.

**Akzeptanzkriterien:** eBay-Order end-to-end im internen Flow, Bestand synchron, Tracking zurück.

**Abhängigkeiten:** [G.1](#g1), [G.2](#g2).

---

## G.5 — Kaufland-Seller-API-Connector {#g5}

**Ziel:** Kaufland-Marktplatz anbinden (Orders, Bestand, Fulfillment).

**Warum / Kontext:** Offizielle **REST Seller API**, Auth per Passwort + HMAC (Signatur je Request).

**Betroffene Dateien:** `server/channels/kaufland/` (neu).

**Umsetzung:** HMAC-Signatur-Client; Orders-Pull → kanalneutral; Fulfillment/Tracking zurück;
Inventory via Fan-out.

**Datenmodell:** `channel_data.kaufland`.

**Tests:** Unit: HMAC-Signatur korrekt; Order-Mapper.

**Akzeptanzkriterien:** Kaufland-Order end-to-end, Bestand synchron.

**Abhängigkeiten:** [G.1](#g1), [G.2](#g2).

---

## G.6 — Otto-Market-API-Connector {#g6}

**Ziel:** Otto Market anbinden (Orders, Bestand, Fulfillment).

**Warum / Kontext:** Offizielle **Otto Market API** (api.otto.market), Client-Credentials-OAuth (OPC
Self-App), Sandbox + offizielles SDK vorhanden.

**Betroffene Dateien:** `server/channels/otto/` (neu).

**Umsetzung:** Client-Credentials-Auth; Orders-Pull; Fulfillment/Tracking; Inventory via Fan-out;
Sandbox zuerst.

**Datenmodell:** `channel_data.otto`.

**Tests:** Unit: Order-Mapper; Auth-Flow (gemockt).

**Akzeptanzkriterien:** Otto-Order end-to-end, Bestand synchron.

**Abhängigkeiten:** [G.1](#g1), [G.2](#g2).

---

## G.7 — WooCommerce-Connector {#g7}

**Ziel:** WooCommerce-Shops (und via gleichem Muster weitere) zentral anbinden.

**Warum / Kontext:** **WooCommerce REST API** (Products/Orders/Customers), Consumer-Key/Secret;
unkompliziert. Belegt zugleich „weitere Shops zentral verwalten".

**Betroffene Dateien:** `server/channels/woocommerce/` (neu).

**Umsetzung:** Key/Secret-Auth; Orders-Pull (Webhooks optional); Fulfillment/Tracking zurück
(Order-Update); Inventory via Fan-out; Katalog-Push optional.

**Datenmodell:** `channel_data.woocommerce`.

**Tests:** Unit: Order-Mapper; Auth.

**Akzeptanzkriterien:** WooCommerce-Order end-to-end, Bestand synchron.

**Abhängigkeiten:** [G.1](#g1), [G.2](#g2).

---

## G.8 — Weitere Marktplätze — nur mit offizieller API {#g8}

**Ziel:** Zusätzliche Marktplätze (Temu, Metro, Hood, künftige) anbinden — **ausschließlich**, wenn sie
eine offizielle Seller-API bereitstellen. Jeder Kanal ist ein nativer Connector nach [G.2](#g2).

**Warum / Kontext:** **Grundsatz (Entscheidung): keine API → keine Anbindung.** Aggregatoren oder
CSV-Workarounds sind ausgeschlossen — sie bringen Kosten, Abhängigkeit und Fragilität ohne echte
Kontrolle. Ein Marktplatz wird angebunden, sobald (und nur wenn) er eine dokumentierte offizielle API
hat; sonst gar nicht.

**Betroffene Dateien:**
- `server/channels/<marktplatz>/` (neu, je nativem Connector) — **nur** bei vorhandener offizieller API.

**Umsetzung:**
1. **API-Prüfung je Plattform**: offizielle Seller-API vorhanden & dokumentiert? Ergebnis hier
   festhalten (Stand kann sich ändern). Temu/Metro/Hood: aktuell **kein** durchgängig offener
   Seller-API-Zugang → **nicht anbinden**, bis eine offizielle API existiert.
2. **Wenn API vorhanden**: nativer Connector exakt nach dem Muster von [G.3](#g3)–[G.7](#g7)
   (Auth, Orders-Pull, Fulfillment/Tracking-Push, Inventory via Fan-out).
3. **Keine** Aggregator-/CSV-Anbindung — bewusste, verbindliche Entscheidung.

**Datenmodell:** `channel.type` je nativem Marktplatz (kein `AGGREGATOR`/`CSV`).

**Tests:** Unit: Connector-Contract je tatsächlich angebundenem Marktplatz (wie G.3–G.7).

**Akzeptanzkriterien:** Nur Marktplätze mit offizieller API sind angebunden; ohne API erfolgt bewusst
**keine** Anbindung.

**Abhängigkeiten:** [G.1](#g1), [G.2](#g2).
