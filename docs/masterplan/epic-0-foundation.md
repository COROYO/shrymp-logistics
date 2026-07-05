# Epic 0 — Fundament: Docs-Refresh + Rollup-Datenlayer

**Epic-Ziel:** Die Doku auf den echten Code-Stand heben (damit niemand — Mensch oder KI — auf
falschen Annahmen plant) und den gemeinsamen Rollup-Datenlayer schaffen, auf dem Analytics (B)
und Forecasting (C) aufsetzen.

**Reihenfolge im Epic:** 0.1–0.3 (Docs, unabhängig, schnell) parallel zu 0.4 (Datenlayer). 0.5
nach 0.4.

---

## 0.1 — PROJECT.md auf den echten Stand bringen

**Ziel:** [`PROJECT.md`](../../PROJECT.md) beschreibt den tatsächlichen Implementierungsstand;
kein „offen"-Eintrag, der in Wahrheit fertig ist.

**Warum / Kontext:** PROJECT.md §3 markiert M7 (Picking/Packing), M8 (Packing-Slip), M9
(Reconcile/Outbox) als „🚧 Offen" und DHL als „Später". Die Code-Analyse zeigt: **alles davon ist
gebaut** — inkl. Cluster-Picking, Lieferschein-Nummerierung, 5-Min-Reconcile, Outbox-Retry und
DHL Parcel DE v2. Auch das Datenmodell ist unvollständig dokumentiert und der „Aktueller
Run-State: 6 Orders"-Satz ist veralteter Test-Stand.

**Betroffene Dateien:**
- `PROJECT.md` (ändern)

**Umsetzung:**
1. §3 „Implementation Status": M7, M8, M9 nach „✅ Fertig" verschieben mit realen Dateiverweisen:
   - M7 → [`server/picking/transitions.ts`](../../apps/logistics/server/picking/transitions.ts),
     [`pick-runs.ts`](../../apps/logistics/server/picking/pick-runs.ts),
     [`assign-batches.ts`](../../apps/logistics/server/picking/assign-batches.ts),
     Lager-UI unter `app/lager/`.
   - M8 → **HTML-Druck** via `window.print()` (`app/lager/print-slips/`, `_slip/`,
     [`slip-data.ts`](../../apps/logistics/server/picking/slip-data.ts),
     [`lieferschein.ts`](../../apps/logistics/server/picking/lieferschein.ts)) — **nicht**
     `@react-pdf/renderer` wie ursprünglich geplant. Korrigieren.
   - M9 → [`server/reconcile/stuck-orders.ts`](../../apps/logistics/server/reconcile/stuck-orders.ts)
     (5-Min-Sweep), Outbox-Retry in [`server/shopify/outbox.ts`](../../apps/logistics/server/shopify/outbox.ts).
   - DHL → [`server/dhl/`](../../apps/logistics/server/dhl/) (Parcel DE v2, OAuth2, DE-Inland).
2. Datenmodell-Block (§2) vervollständigen: `shops/{id}`, `variant_location_stock`, `storage_bins`,
   `variant_bins`, `pick_runs`, `product_sync_runs`, `api_keys`, `locations`, DHL-Felder auf Order.
3. Bekannte Ungenauigkeit korrigieren: `webhook_events` „TTL 30d" ist **nicht** implementiert
   (kein TTL/Cleanup) → als offenen Punkt markieren (wird in [A.6](epic-a-sync-hardening.md#a6)
   behoben).
4. Veralteten „Aktueller Run-State"-Satz entfernen oder als Beispiel kennzeichnen.
5. „🚧 Offen"-Liste ersetzen durch Verweis auf `docs/masterplan/` als neue Roadmap.

**Datenmodell:** keine Änderung.

**Tests:** keine (Doku). Review: jeder „Fertig"-Eintrag muss auf existierende Datei zeigen
(`ls` prüfen).

**Akzeptanzkriterien:**
- Kein „offen/später"-Item, das im Code existiert.
- Datenmodell listet alle real existierenden Collections aus `Collections` in `schema.ts`.
- Roadmap-Teil verweist auf dieses Masterplan-Set.

**Abhängigkeiten:** keine.

---

## 0.2 — AGENTS.md zum echten Onboarding ausbauen

**Ziel:** Eine frische KI orientiert sich allein aus [`AGENTS.md`](../../AGENTS.md) im Repo.

**Warum / Kontext:** AGENTS.md enthält heute nur den Next.js-Warnhinweis. Für autonome
Feature-Arbeit fehlt die Landkarte der Subsysteme.

**Betroffene Dateien:**
- `AGENTS.md` (ändern)

**Umsetzung:**
1. Next.js-Warnblock **behalten** (steht bereits, ist korrekt).
2. Ergänzen:
   - **Repo-Layout** (kurz): `apps/logistics/{app,server,lib}`, `functions/`, `docs/masterplan/`.
   - **Server-Subsystem-Landkarte**: `server/allocation`, `server/picking`, `server/dhl`,
     `server/shopify`, `server/inventory`, `server/locations`, `server/reconcile`,
     `server/analytics` (neu), `server/forecasting` (neu).
   - **Pflichtlektüre vor Änderungen**: `CLAUDE.md` (Invarianten), `server/firestore/schema.ts`
     (Datenmodell), das jeweilige Masterplan-Epic.
   - **Guardrails**: Allocation-Determinismus nicht brechen; Geld/Menge = Integer; Job-Tray statt
     Inline-Banner; default-deny Firestore.
   - **Commands**: `pnpm dev:logistics`, `pnpm build`, `pnpm lint`, `pnpm test`,
     `firebase emulators:start`.
3. Kein Duplikat von CLAUDE.md — nur Verweise + Navigation.

**Datenmodell:** keine.

**Tests:** keine.

**Akzeptanzkriterien:** AGENTS.md nennt jedes Server-Subsystem und die Pflichtlektüre; verweist auf
`docs/masterplan/`.

**Abhängigkeiten:** keine (kann mit 0.1 parallel).

---

## 0.3 — CLAUDE.md um neue Subsysteme erweitern

**Ziel:** [`CLAUDE.md`](../../CLAUDE.md) enthält verbindliche Konventionen für die neuen Bereiche
Analytics, Forecasting, Sync-Partials und DHL-Auto-Druck.

**Warum / Kontext:** CLAUDE.md ist aktuell und korrekt für den Kern, kennt aber die neuen Säulen
noch nicht. Neue Konventionen müssen hier verankert werden, weil CLAUDE.md automatisch in jeden
KI-Kontext geladen wird.

**Betroffene Dateien:**
- `CLAUDE.md` (ändern)

**Umsetzung:** Neue kurze Abschnitte anhängen (Stil: knapp, invariantenartig wie der Rest):
1. **Analytics/Rollups**: Kennzahlen kommen aus `sales_daily`/`ops_metrics_daily`, nicht aus
   Live-Scans; Rollups sind idempotent per `(shop,variant,date)`; Geld weiter in Cents.
2. **Forecasting**: in-house statistisch (TS); Prognosen nie negativ; MHD-bewusst (nie über
   Sell-Through-vor-Verfall empfehlen); deterministisch bei gleichem Input; alles in `forecasts/`.
3. **Sync-Invarianten (Partials)**: Refunds mit `restock=true` erhöhen Bestand; Order gilt erst als
   `PACKED`, wenn **alle** Line-Items fulfilled sind; `updated_at`-Monotonie gegen Out-of-Order.
4. **DHL-Auto-Druck**: Label-Druck läuft über die Browser-Print-Pipeline; Station-Drucker-Setting
   lokal (localStorage); Label-Format via `@page`.

**Datenmodell:** keine.

**Tests:** keine.

**Akzeptanzkriterien:** Jede neue Säule hat ihren Invarianten-Absatz in CLAUDE.md; nichts
widerspricht bestehenden Regeln.

**Abhängigkeiten:** keine.

---

## 0.4 — Rollup-Datenlayer (`sales_daily`, `ops_metrics_daily`) {#rollups}

**Ziel:** Durable Tages-Aggregate als **eine** Quelle für Analytics und Forecasting, idempotent
fortgeschrieben (inkrementell beim Packen + täglicher Sicherheits-Cron).

**Warum / Kontext:** Heute berechnet
[`server/admin/dashboard-stats.ts`](../../apps/logistics/server/admin/dashboard-stats.ts) alles per
Live-Scan über ~30 Tage. Das skaliert nicht, hält keine Historie und taugt nicht als
Forecast-Grundlage (Prognose braucht 2–3 Saisonzyklen). Wir brauchen persistente Tages-Rollups.

**Betroffene Dateien:**
- `server/analytics/rollups.ts` (neu) — Upsert-Logik.
- `server/analytics/types.ts` (neu) — Zod-Schemas re-exportiert aus `schema.ts`.
- `app/api/cron/rollup/route.ts` (neu) — täglicher/периodischer Cron-Endpoint (analog zu
  [`app/api/cron/reconcile/route.ts`](../../apps/logistics/app/api/cron/reconcile/route.ts)).
- [`server/picking/transitions.ts`](../../apps/logistics/server/picking/transitions.ts) (ändern) —
  `confirmPacking` triggert inkrementelles Rollup-Update (best-effort, außerhalb der Kern-Tx).
- [`server/firestore/schema.ts`](../../apps/logistics/server/firestore/schema.ts) (ändern) — neue
  Schemas + `Collections`.
- [`firestore.indexes.json`](../../firestore.indexes.json) (ändern) — Composite-Indizes.

**Umsetzung:**
1. **Schemas** (in `schema.ts`):
   - `SalesDaily`: `id` (`{shopId}_{variantId}_{YYYYMMDD}`), `shop_id`, `variant_id`, `product_id`,
     `date` (YYYYMMDD, Europe/Berlin), `units_sold`, `orders_count`, `revenue_cents`,
     `refunded_units`, `refunded_cents`, `updated_at`.
   - `OpsMetricsDaily`: `id` (`{shopId}_{YYYYMMDD}`), `shop_id`, `date`, `orders_packed`,
     `units_packed`, `lines_packed`, `pick_to_pack_ms_samples` (Array oder p50/p90 vorberechnet),
     `orders_shipped_count`, `orders_stopped_count`, `updated_at`.
2. **Quelle der Wahrheit** für Sales: **konsumierte** Mengen — d. h.
   `inventory_movements` vom Typ `CONSUME` (physischer Abgang) **plus** `packed_at` der Order,
   nicht der Bestellzeitpunkt (Lager-Sicht = Fulfillment). Refunds/Restock aus
   [A.1](epic-a-sync-hardening.md#a1) fließen in `refunded_units/_cents`.
   > Entscheidung dokumentieren: „Sales-Tag = Packtag". Alternative (Bestelltag) explizit verwerfen,
   > damit Analytics und Forecasting konsistent dieselbe Definition nutzen.
3. **Idempotenter Upsert**: `set(..., {merge:false})` mit **vollständig neu berechnetem** Tageswert
   je `(shop,variant,date)` — kein blindes Inkrement (sonst driftet es bei Retries). Der Cron liest
   die Movements/Orders eines Tages und schreibt den Tageswert deterministisch.
4. **Zeitzone**: Tagesgrenze `Europe/Berlin`. Zentralen Helper `dayKey(ts)` bereitstellen und
   überall verwenden.
5. **Inkrementell** in `confirmPacking`: nach erfolgreichem Pack den betroffenen `(shop,variant,heute)`
   -Rollup neu berechnen (kleiner, gezielter Recompute) — best-effort, Fehler nur loggen, nie den
   Pack-Vorgang blockieren.
6. **Cron** `/api/cron/rollup`: berechnet „gestern + heute" neu (fängt späte Movements) und einmal
   nächtlich den ganzen Vortag. Auth wie bestehende Cron-Routes.

**Datenmodell:** siehe oben; Indizes: `sales_daily` auf `(shop_id, variant_id, date)` und
`(shop_id, date)`; `ops_metrics_daily` auf `(shop_id, date)`.

**Tests:**
- Property (fast-check): Rollup ist **idempotent** — zweimaliger Lauf über denselben Tag ergibt
  identische Werte.
- Unit: `dayKey` respektiert Europe/Berlin inkl. Sommerzeit-Grenze.
- Unit: Refund senkt `units_sold` nicht, erhöht aber `refunded_units` (Netto separat berechenbar).

**Akzeptanzkriterien:**
- Nach Pack einer Order existiert der passende `sales_daily`-Eintrag mit korrekten Mengen.
- Cron-Doppellauf verändert keine Werte.
- 90+ Tage Historie sind abfragbar (nach 0.5).

**Abhängigkeiten:** Refund-Anteile brauchen [A.1](epic-a-sync-hardening.md#a1) — bis dahin
`refunded_*` = 0 (kein Blocker).

---

## 0.5 — Historien-Backfill der Rollups

**Ziel:** Vorhandene Order-/Movement-Historie einmalig in `sales_daily`/`ops_metrics_daily`
zurückrechnen, damit Analytics und Forecasting sofort Historie haben.

**Warum / Kontext:** Ohne Backfill starten die Rollups bei null; Forecasting braucht aber
Vergangenheit. Es existiert bereits ein Orders-Backfill-Mechanismus
([`server/shopify/sync-orders.ts`](../../apps/logistics/server/shopify/sync-orders.ts)); für tiefere
Historie ggf. Shopify-Order-History nachladen.

**Betroffene Dateien:**
- `server/analytics/backfill.ts` (neu) — iteriert Zeiträume, ruft die Upsert-Logik aus 0.4.
- Admin-Trigger: Button in `app/admin/settings/…` (Job-Tray-Pattern, Fortschritt wie
  `product_sync_runs`).

**Umsetzung:**
1. Parameter: `from`/`to` (Default: letzte 24 Monate). In Tages-Batches iterieren, je Tag die
   0.4-Upsert-Funktion aufrufen (Wiederverwendung, nicht duplizieren).
2. Lange Läufe als Background-Job mit Fortschritt (analog `product-sync-run.ts`); Job-Tray-Refresh
   dispatchen.
3. Falls lokale Order-Historie zu kurz: optional Shopify-Orders für den Zeitraum nachladen (bestehenden
   Backfill wiederverwenden), dann Rollups rechnen.

**Datenmodell:** optional `analytics_backfill_runs` (Fortschritt), analog `product_sync_runs`.

**Tests:** Unit: Backfill über Zeitraum ohne Daten erzeugt keine Fehler; mit Daten identisch zu
inkrementellem Ergebnis (Konsistenz-Property).

**Akzeptanzkriterien:** Nach Backfill zeigen Analytics-Trends echte Vergangenheit; erneuter Backfill
ändert nichts (idempotent).

**Abhängigkeiten:** [0.4](#rollups).
