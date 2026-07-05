# Epic H — Automatisierungs- & Workflow-Engine

**Epic-Ziel:** Sehr viele Automatisierungen und individuelle Workflows ermöglichen — konfigurierbar,
ohne Code: unterschiedliche Prozesse je **Artikel**, **Bestellung** und **Marktplatz**, plus
verallgemeinerte Prioritäts-/Fast-Lane-Steuerung.

**Kontext (verifiziert):** Heute existiert nur eine **starre** State-Machine
(`server/picking/transitions.ts`) und **hartcodierte** Allocation-Trigger
(`server/allocation/types.ts`). Konfiguration ist minimal (`batches_enabled`, `inventory_source`,
`catalog_sync_to_shopify`). Priorität gibt es nur zweistufig über den `EXPRESS_DHL`-Tag
(`server/allocation/runAllocation.ts`). Es gibt **keine** Regel-Engine, keine bedingte Verzweigung,
keine per-Artikel/Order/Channel-Prozesse.

**Leitidee:** Eine deterministische, auditierbare **Trigger → Bedingung → Aktion**-Engine, die an die
bestehenden Lebenszyklus-Ereignisse andockt, ohne die Kern-Invarianten (Allocation-Determinismus) zu
brechen.

---

## H.1 — Rules-Engine-Kern {#h1}

**Ziel:** Ein Datenmodell + Auswertungskern für Regeln (Trigger/Bedingung/Aktion) mit Reihenfolge,
Dry-Run und Audit.

**Warum / Kontext:** Fundament aller Automatisierungen. Muss deterministisch und nachvollziehbar sein
(jede Regelausführung protokolliert).

**Betroffene Dateien:**
- `server/automation/engine.ts` (neu) — Regelauswertung.
- `server/automation/types.ts` (neu) — Trigger/Condition/Action-Typen.
- `server/firestore/schema.ts` (ändern) — `automation_rules` + `automation_runs` (Audit).

**Umsetzung:**
1. **`automation_rules/{id}`**: `name`, `enabled`, `trigger`, `conditions[]` (UND/ODER-Gruppen),
   `actions[]`, `priority` (Reihenfolge), `stop_on_match?`.
2. **Auswertung**: bei Trigger die aktiven Regeln in fixer Reihenfolge prüfen; passende Aktionen
   ausführen; alles in `automation_runs` protokollieren (welche Regel, welche Aktionen, Ergebnis).
3. **Determinismus & Sicherheit**: idempotente Aktionen; keine Endlosschleifen (Guard gegen Regeln,
   die sich gegenseitig triggern — Ausführungstiefe begrenzen).
4. **Dry-Run**: Regel gegen echte Order simulieren, ohne Nebenwirkungen (fürs Regel-Editor-Testen H.6).

**Datenmodell:** `automation_rules`, `automation_runs` (mit `expires_at`-TTL fürs Audit-Volumen).

**Tests:** Unit: Bedingungsauswertung (UND/ODER); Property: Regelkette terminiert (kein Endlos-Trigger);
Dry-Run ohne Seiteneffekte.

**Akzeptanzkriterien:** Eine einfache Regel („wenn Tag X → setze Priorität hoch") greift beim Trigger
und ist im Audit sichtbar.

**Abhängigkeiten:** keine harten; profitiert von [G.1](epic-g-multichannel.md#g1) (Channel als
Bedingung).

---

## H.2 — Trigger-Integration in den Lebenszyklus {#h2}

**Ziel:** Die Engine an alle relevanten Ereignisse andocken, ohne bestehende Abläufe zu brechen.

**Warum / Kontext:** Regeln müssen an echten Punkten feuern: Order importiert, bezahlt, allokiert
(SHIP/STOP), Picking gestartet, gepackt, storniert, refundet, Wareneingang.

**Betroffene Dateien:**
- `server/shopify/webhook-handler.ts`, `server/allocation/run.ts`, `server/picking/transitions.ts`,
  `server/inventory/receive.ts` (jeweils Hook-Aufruf ergänzen).
- `server/automation/dispatch.ts` (neu) — zentrale Ereignis-Dispatch-Stelle.

**Umsetzung:**
1. An bestehenden Ereignispunkten (wiederverwenden, nicht duplizieren) `dispatchAutomationEvent(event,
   context)` aufrufen — best-effort, Fehler nur loggen, nie den Kernablauf blockieren.
2. Event-Katalog: `ORDER_IMPORTED`, `ORDER_PAID`, `ORDER_SHIP`, `ORDER_STOP`, `PICKING_STARTED`,
   `PACKED`, `ORDER_CANCELLED`, `ORDER_REFUNDED`, `INBOUND`.
3. Kontext (Order/Variant/Channel) mitgeben, damit Bedingungen ausgewertet werden können.

**Datenmodell:** keine neuen.

**Tests:** Unit: jeder Ereignispunkt löst genau einen Dispatch aus; Fehler im Regelteil bricht den
Kernablauf nicht ab.

**Akzeptanzkriterien:** Regeln feuern an allen katalogisierten Ereignissen zuverlässig.

**Abhängigkeiten:** [H.1](#h1).

---

## H.3 — Bedingungs- & Aktions-Bibliothek {#h3}

**Ziel:** Ein reichhaltiger, erweiterbarer Satz an Bedingungen und Aktionen.

**Warum / Kontext:** Der Nutzwert der Engine steht und fällt mit den verfügbaren Bausteinen.

**Betroffene Dateien:** `server/automation/conditions/`, `server/automation/actions/` (neu).

**Umsetzung:**
1. **Bedingungen**: Channel/Marktplatz, Tag, SKU/Produkt, Kategorie/Produkttyp, Zielland, Bestellwert,
   Gewicht, Zahlart, Kundentyp (B2B/B2C), Express-Flag, Lagerbestand.
2. **Aktionen**: Tag setzen/entfernen, Priorität setzen, Order **einer Station** zuweisen
   ([K.3](epic-k-documents.md#k3)), **Lager/3PL** routen ([I.4](epic-i-distributed-fulfillment.md#i4)),
   Order **halten**/freigeben, **Carrier** wählen, **Dokumentenbündel** wählen
   ([K.4](epic-k-documents.md#k4)), **E-Mail** senden ([L.2](epic-l-crm.md#l2)), Webhook auslösen
   ([N.3](epic-n-public-api.md#n3)).
3. Jede Bedingung/Aktion als kleines, einzeln getestetes Modul (Registry-Muster, erweiterbar).

**Datenmodell:** keine neuen (Referenzen auf Stationen/Carrier/Templates).

**Tests:** Unit je Bedingung/Aktion; Registry-Vollständigkeit.

**Akzeptanzkriterien:** Die in H.4/H.5/K/L/I referenzierten Bedingungen und Aktionen existieren und
sind einzeln getestet.

**Abhängigkeiten:** [H.1](#h1); referenziert Stationen (K), Routing (I), E-Mail (L), Webhooks (N).

---

## H.4 — Prozessvarianten je Artikel/Order/Marktplatz {#h4}

**Ziel:** Unterschiedliche Abläufe abhängig von Artikel, Bestellung oder Kanal abbilden.

**Warum / Kontext:** Explizit gewünscht: „unterschiedliche Prozesse je nach Artikel, Bestellung oder
Marktplatz". Das ist die Anwendung der Engine auf konkrete Scopes.

**Betroffene Dateien:** nutzt H.1–H.3; ggf. `variant`/`product`-Felder für artikelbezogene Flags
(z. B. `fragile`, `oversized`, `hazmat`, `giftwrap_default`).

**Umsetzung:**
1. **Artikel-Scope**: Regeln auf Produkt-/Varianten-Eigenschaften (z. B. „fragil → Station 2 +
   Extra-Polster-Beileger", „übergroß → eigener Versand").
2. **Order-Scope**: z. B. „B2B → andere Packstation + Rechnung beilegen", „COD → COD-Instruktionsblatt".
3. **Channel-Scope**: z. B. „Amazon → FBA-/MCF-Logik", „eBay → Standardversand", „Otto → SLA-Fenster".
4. Beispiel-Regelsets als Vorlagen mitliefern (Onboarding).

**Datenmodell:** artikelbezogene Flags auf `variant`/`product` (optional).

**Tests:** Unit: Beispielregel je Scope greift korrekt.

**Akzeptanzkriterien:** Für Artikel, Order und Channel lässt sich je ein abweichender Prozess
konfigurieren und wird korrekt ausgeführt.

**Abhängigkeiten:** [H.1](#h1)–[H.3](#h3); [I](epic-i-distributed-fulfillment.md), [K](epic-k-documents.md).

---

## H.5 — Prioritäts- & Fast-Lane-Verallgemeinerung {#h5}

**Ziel:** Priorität von „ein Tag" zu einem konfigurierbaren Scoring mit SLA-Fenstern und getrennten
Pick-Lanes ausbauen.

**Warum / Kontext:** Heute nur `EXPRESS_DHL` (zweistufig in der Allocation). Kunden wollen echte
Fast-Lane-/Prioritätsprozesse (VIP, Same-Day, Marktplatz-SLA).

**Betroffene Dateien:**
- `server/allocation/runAllocation.ts` (ändern) — Priorität aus Score statt festem Tag.
- `server/automation/actions/set-priority.ts` (neu) — Aktion.
- Lager-Queue-UI (`app/lager/picking/`) — Prioritäts-Sortierung/Lane-Kennzeichnung.

**Umsetzung:**
1. **Priority-Score** je Order (0–100), gesetzt durch Regeln (H) oder SLA-Fristen (Marktplatz-Versandziel,
   Same-Day-Cutoff). `EXPRESS_DHL` bleibt als eine Regel, die hohen Score setzt (Abwärtskompatibilität).
2. **Allocation**: Phase-A nach Score statt nur nach Tag; Determinismus wahren (stabile Sortierung,
   Tiebreak Order-ID).
3. **Fast-Lane im Lager**: hohe Priorität optisch/organisatorisch getrennt (eigene Lane/Tote-Kennzeichnung).

**Datenmodell:** `order.priority_score`, optional `order.sla_ship_by`.

**Tests:** Property: Allocation bleibt deterministisch bei gleichem Score-Snapshot; höhere Priorität
wird zuerst allokiert. Unit: SLA→Score-Ableitung.

**Akzeptanzkriterien:** Priorität ist regel-/SLA-gesteuert, Allocation und Lager-Queue respektieren sie,
`EXPRESS_DHL` funktioniert weiter.

**Abhängigkeiten:** [H.1](#h1)–[H.3](#h3); berührt Allocation-Kern (sorgfältige Tests).

---

## H.6 — Regel-Editor-UI (No-Code) {#h6}

**Ziel:** Ein Admin-UI, in dem Regeln ohne Entwickler erstellt, getestet, priorisiert und aktiviert
werden.

**Warum / Kontext:** „Extrem viele Automatisierungen" nutzt nur, wenn der Merchant sie selbst pflegen
kann.

**Betroffene Dateien:** `app/admin/automation/` (neu) — Regelliste + Builder; Sidebar-Eintrag.

**Umsetzung:**
1. **Builder**: Trigger wählen → Bedingungsgruppen (UND/ODER) → Aktionen; Reihenfolge per Drag-Sort.
2. **Simulation**: Regel gegen eine echte/Beispiel-Order per Dry-Run ([H.1](#h1)) testen und Ergebnis
   zeigen.
3. **Governance**: aktiv/inaktiv, Änderungs-Audit, Vorlagen-Katalog.
4. Job-Tray für etwaige Massenaktionen; keine Inline-Banner.

**Datenmodell:** keine neuen (nutzt `automation_rules`).

**Tests:** Loader-/Render-Smoke; Dry-Run-Anzeige stimmt mit Engine-Ergebnis überein.

**Akzeptanzkriterien:** Ein Merchant erstellt, testet und aktiviert eine Regel vollständig im UI.

**Abhängigkeiten:** [H.1](#h1)–[H.3](#h3).
